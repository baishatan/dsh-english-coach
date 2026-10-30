import { constants, promises as fs } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join, parse, resolve, sep } from 'node:path'
import { assetManifest } from './asset-manifest.js'

const error = (code, message) => Object.assign(new Error(message), { code })
const success = data => ({ ok: true, data, warnings: [] })
const failure = (code, message) => ({ ok: false, code, message })
const cancelled = () => error('speech_cancelled', '准备已取消；需要时请明确重试。')

async function inspectPath(path, { create = false } = {}) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || resolve(path) !== path || path === parse(path).root) {
    throw error('speech_invalid_path', '朗读资源目录无效；请检查插件主机配置。')
  }
  let current = parse(path).root
  for (const part of path.slice(current.length).split(sep)) {
    current = join(current, part)
    let stat
    try { stat = await fs.lstat(current) } catch (cause) {
      if (cause.code !== 'ENOENT') throw cause
      if (!create) return false
      try { await fs.mkdir(current, { mode: 0o700 }) } catch (cause) { if (cause.code !== 'EEXIST') throw cause }
      stat = await fs.lstat(current)
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw error('speech_unsafe_path', '朗读资源目录包含符号链接或非目录；未写入或清理该位置。')
  }
  return true
}

// Production uses only fixed HTTPS manifest URLs and streams bytes directly.
// No shell, package manager, developer cache or local-file URL is consulted.
async function downloadAsset(asset, { signal }) {
  const response = await fetch(asset.url, { signal, redirect: 'follow' })
  if (!response.ok || !response.body) throw error('speech_network', '下载失败；请检查网络后明确重试。')
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) !== asset.bytes) {
    await response.body.cancel()
    throw error('speech_size_mismatch', '下载文件大小与固定清单不一致；请稍后明确重试。')
  }
  return response.body
}

function describeError(cause) {
  if (cause?.code === 'ENOSPC' || cause?.code === 'EDQUOT') return { code: 'speech_disk_full', message: '磁盘空间不足；请释放空间后明确重试。' }
  if (['EACCES', 'EPERM', 'EROFS', 'EIO'].includes(cause?.code)) return { code: 'speech_storage', message: '无法写入朗读资源；请检查磁盘与目录权限后明确重试。' }
  if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EEXIST', 'ENOTEMPTY'].includes(cause?.code) || cause instanceof SyntaxError) return { code: 'speech_invalid_manifest', message: '已保存资源不完整或就绪记录无效；未加载资源，请明确修复。' }
  if (typeof cause?.code === 'string' && cause.code.startsWith('speech_')) return { code: cause.code, message: cause.message.slice(0, 240) }
  return { code: 'speech_network', message: '下载中断或超时；请检查网络后明确重试。' }
}

// One Host owns the resource lifecycle. All paths stay inside this Module.
// The download adapter is an external boundary for isolated fault injection.
export function createSpeechAssets({ root, download = downloadAsset, onActivate = async () => {}, onDelete = async () => {} } = {}) {
  let disposed = false, task = null, deleting = false, deletion = null
  let state = {
    phase: 'unprepared', assetsReady: false, runtimeAvailable: false,
    manifest: assetManifest, downloadedBytes: 0, validatedBytes: 0, diskBytes: 0,
    generation: null, resourceGeneration: null, repairRequired: false, diskBytesKnown: true, currentFile: null, error: null
  }
  const snapshot = owner => ({ ...state, ...(deleting ? { phase: 'deleting', assetsReady: false } : {}), canCancel: !deleting && !!task && task.owner === owner, update: {
    available: false, networkChecked: false, targetId: assetManifest.id,
    downloadBytes: assetManifest.downloadBytes,
    additionalDiskBytes: assetManifest.downloadBytes + 65536,
    maximumAssetBytes: 2 * (assetManifest.downloadBytes + 65536),
    message: '本插件仅提供当前固定版本，没有已知更新；未联网检查。可明确修复并重新下载同一固定版本。'
  } })
  const finalRoot = join(root, assetManifest.id), pointerPath = join(root, 'active.json')
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)
  let currentRoot = finalRoot, verifiedFingerprint = null, checking = null

  const sameFile = (left, right) => left?.dev === right?.dev && left?.ino === right?.ino && left?.size === right?.size && left?.mtimeMs === right?.mtimeMs && left?.ctimeMs === right?.ctimeMs
  async function pointerIdentity() {
    const stat = await fs.lstat(pointerPath).catch(cause => { if (cause.code !== 'ENOENT') throw cause })
    if (!stat) return null
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024) throw error('speech_unsafe_path', '活动资源记录无效或包含链接；未加载或清理资源。')
    return stat
  }

  async function readActive({ repair = false } = {}) {
    if (!await inspectPath(root)) return { path: finalRoot, identity: null }
    const stat = await pointerIdentity()
    if (!stat) return { path: finalRoot, identity: null } // 03's fixed installation directory.
    // Even before JSON parsing, the fixed active record means this is a damaged
    // installation, not a fresh one. Diagnostics still never grant a download.
    state.repairRequired = true
    state.diskBytesKnown = false
    const handle = await fs.open(pointerPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    let text
    try {
      if (!sameFile(await handle.stat(), stat)) throw error('speech_assets_changed', '活动记录在检查时改变；请重新检查。')
      text = await handle.readFile('utf8')
      if (!sameFile(await handle.stat(), stat)) throw error('speech_assets_changed', '活动记录在检查时改变；请重新检查。')
    } finally { await handle.close() }
    let pointer
    try { pointer = JSON.parse(text) } catch (cause) {
      // A regular, bounded fixed-name metadata file can be replaced only by an
      // explicit repair. Do not infer a root or ownership from damaged bytes.
      if (repair && cause instanceof SyntaxError) return { path: null, identity: stat }
      throw cause
    }
    if (!pointer || pointer.id !== assetManifest.id || pointer.revision !== assetManifest.revision || !uuid(pointer.generation)) throw error('speech_invalid_manifest', '活动资源版本不符合固定清单；请明确修复。')
    return { path: join(root, `.generation-${pointer.generation}`), identity: stat }
  }

  // Only this finite tree can be reclaimed. Missing/truncated known files are
  // repairable; foreign names, links, hard links and unknown ownership are not.
  async function ownedDirectory(path, expectedGeneration) {
    await inspectPath(path)
    const identity = await fs.lstat(path)
    const allowed = new Map(assetManifest.files.map(asset => [asset.path, asset.bytes]))
    allowed.set('_owner.json', 1024); allowed.set('ready.json', 1024)
    let bytes = 0
    async function scan(directory, prefix = '') {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const relative = prefix + entry.name, full = join(directory, entry.name)
        const stat = await fs.lstat(full)
        if (stat.isSymbolicLink()) throw error('speech_unowned_partial', '资源包含链接；未清理归属不明的位置。')
        if (stat.isDirectory() && ['onnx', 'voices'].includes(relative)) await scan(full, relative + '/')
        else if (stat.isFile() && stat.nlink === 1 && allowed.has(relative) && stat.size <= allowed.get(relative)) bytes += stat.size
        else throw error('speech_unowned_partial', '资源包含非清单文件或超限文件；未清理归属不明的位置。')
      }
    }
    await scan(path)
    let owner
    try {
      const file = await fs.open(join(path, '_owner.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
      try { owner = JSON.parse(await file.readFile('utf8')) } finally { await file.close() }
    } catch { throw error('speech_unowned_partial', '资源缺少有效归属记录；未清理或新增文件。') }
    if (owner.id !== assetManifest.id || !uuid(owner.generation) || (expectedGeneration && owner.generation !== expectedGeneration)) throw error('speech_unowned_partial', '资源归属记录不符；未清理或新增文件。')
    return { path, identity, bytes, generation: owner.generation }
  }

  async function removeOwned(entry) {
    if (entry.path !== finalRoot && entry.path !== join(root, `.generation-${entry.generation}`)) throw error('speech_unsafe_path', '无法安全清理旧资源。')
    await inspectPath(root)
    const current = await ownedDirectory(entry.path, entry.generation)
    if (current.identity.ino !== entry.identity.ino || current.identity.dev !== entry.identity.dev) throw error('speech_unsafe_path', '资源目录已改变；未清理。')
    await fs.rm(entry.path, { recursive: true })
  }

  async function replacements() {
    if (!await inspectPath(root)) return { directories: [], pointers: [] }
    const names = await fs.readdir(root)
    const generations = names.filter(name => name.startsWith('.generation-') || name === assetManifest.id)
    const pointerNames = names.filter(name => name.startsWith('.active-'))
    if (generations.length > 2 || pointerNames.length > 2) throw error('speech_unowned_partial', '资源代际或切换残留超过安全限额；未清理或新增文件。')
    const directories = []
    for (const name of generations) {
      const generation = name === assetManifest.id ? undefined : name.slice('.generation-'.length)
      if (generation !== undefined && !uuid(generation)) throw error('speech_unowned_partial', '存在归属不明的资源代际；未清理或新增文件。')
      directories.push(await ownedDirectory(join(root, name), generation))
    }
    const pointers = []
    for (const name of pointerNames) {
      const generation = name.slice('.active-'.length, -'.json'.length)
      if (!name.endsWith('.json') || !uuid(generation)) throw error('speech_unowned_partial', '切换残留归属不明；未清理。')
      const path = join(root, name), identity = await fs.lstat(path)
      if (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1 || identity.size > 1024) throw error('speech_unowned_partial', '切换残留包含链接或超限文件；未清理。')
      let pointer
      try { pointer = JSON.parse(await fs.readFile(path, 'utf8')) } catch { throw error('speech_unowned_partial', '切换残留记录不完整；未清理。') }
      if (pointer.id !== assetManifest.id || pointer.revision !== assetManifest.revision || pointer.generation !== generation) throw error('speech_unowned_partial', '切换残留身份不符；未清理。')
      pointers.push({ path, identity, generation })
    }
    return { directories, pointers }
  }

  async function removePointer(entry) {
    if (entry.path !== join(root, `.active-${entry.generation}.json`)) throw error('speech_unsafe_path', '切换残留路径无效；未清理。')
    await inspectPath(root)
    const stat = await fs.lstat(entry.path).catch(cause => { if (cause.code !== 'ENOENT') throw cause })
    if (!stat) return
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.ino !== entry.identity.ino || stat.dev !== entry.identity.dev) throw error('speech_unsafe_path', '切换残留文件已改变；未清理。')
    await fs.unlink(entry.path)
  }

  async function partials() {
    if (!await inspectPath(root)) return []
    const entries = await fs.readdir(root)
    const stages = entries.filter(name => name.startsWith('.prepare-'))
    if (stages.length > 2) throw error('speech_unowned_partial', '准备目录残留超出安全限额；未清理或新增文件，请检查主机资源目录。')
    const results = []
    for (const name of stages) {
      const generation = name.slice('.prepare-'.length)
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(generation)) throw error('speech_unowned_partial', '存在归属不明的准备目录；未清理或新增文件。')
      const path = join(root, name)
      await inspectPath(path)
      const identity = await fs.lstat(path)
      const allowed = new Map(assetManifest.files.map(asset => [asset.path, asset.bytes]))
      allowed.set('_owner.json', 1024)
      allowed.set('ready.json', 1024)
      let bytes = 0
      async function scan(directory, prefix = '') {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const relative = prefix + entry.name
          const full = join(directory, entry.name)
          const stat = await fs.lstat(full)
          if (stat.isSymbolicLink()) throw error('speech_unowned_partial', '准备残留包含链接；未清理归属不明的位置。')
          if (stat.isDirectory() && ['onnx', 'voices'].includes(relative)) await scan(full, relative + '/')
          else if (stat.isFile() && stat.nlink === 1 && allowed.has(relative) && stat.size <= allowed.get(relative)) bytes += stat.size
          else throw error('speech_unowned_partial', '准备残留包含非清单文件；未清理归属不明的位置。')
        }
      }
      try {
        await scan(path)
        const owner = JSON.parse(await fs.readFile(join(path, '_owner.json'), 'utf8'))
        if (owner.id !== assetManifest.id || owner.generation !== generation) throw new Error('owner mismatch')
      } catch (cause) {
        if (cause.code?.startsWith('speech_')) throw cause
        throw error('speech_unowned_partial', '准备残留缺少有效归属记录；未清理或新增文件。')
      }
      results.push({ generation, staging: path, stagingIdentity: identity, bytes })
    }
    return results
  }

  async function inventory() {
    if (!await inspectPath(root)) return null
    const active = await readActive()
    currentRoot = active.path
    if (!await inspectPath(currentRoot)) {
      if (active.identity) throw error('speech_invalid_manifest', '活动资源集合缺失；请明确确认修复，状态检查不会下载。')
      return null
    }
    state.repairRequired = true
    state.diskBytesKnown = false
    const paths = ['ready.json', '_owner.json', ...assetManifest.files.map(asset => asset.path)]
    const rows = []
    for (const path of paths) {
      const full = join(currentRoot, path)
      await inspectPath(full.slice(0, full.lastIndexOf(sep)))
      const stat = await fs.lstat(full)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw error('speech_unsafe_path', '朗读资源包含非普通文件或链接；未加载资源。')
      if (['ready.json', '_owner.json'].includes(path) && stat.size > 1024) throw error('speech_invalid_manifest', '资源就绪记录无效；未加载资源。')
      rows.push({ path, stat })
    }
    return rows
  }

  async function verifyExisting() {
    const rows = await inventory()
    if (!rows) {
      verifiedFingerprint = null
      const leftovers = await partials()
      if (state.assetsReady) state = { ...state, phase: 'unprepared', assetsReady: false, repairRequired: false, resourceGeneration: null, validatedBytes: 0, diskBytes: 0 }
      if (leftovers.length) state = { ...state, phase: 'interrupted', assetsReady: false, diskBytes: leftovers.reduce((total, stage) => total + stage.bytes, 0), error: null }
      return false
    }
    state.diskBytes = rows.reduce((total, row) => total + row.stat.size, 0)
    state.diskBytesKnown = true
    const fingerprint = rows.map(({ path, stat }) => `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).join('|')
    if (fingerprint !== verifiedFingerprint) {
      const ready = JSON.parse(await fs.readFile(join(currentRoot, 'ready.json'), 'utf8'))
      if (ready.id !== assetManifest.id || ready.revision !== assetManifest.revision || ready.downloadBytes !== assetManifest.downloadBytes) {
        throw error('speech_invalid_manifest', '资源版本与固定清单不符；未加载资源。')
      }
      for (const asset of assetManifest.files) {
        const row = rows.find(row => row.path === asset.path)
        if (row.stat.size !== asset.bytes) throw error('speech_size_mismatch', '已保存资源大小不符；未加载资源，请明确修复。')
        const file = await fs.open(join(currentRoot, asset.path), constants.O_RDONLY | constants.O_NOFOLLOW)
        const hash = createHash('sha256')
        try {
          const buffer = Buffer.alloc(64 * 1024)
          while (true) {
            if (disposed) throw cancelled()
            const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
            if (!bytesRead) break
            hash.update(buffer.subarray(0, bytesRead))
          }
          if (hash.digest('hex') !== asset.sha256) throw error('speech_checksum_mismatch', '已保存资源校验失败；未加载资源，请明确修复。')
        } finally { await file.close() }
      }
      // Do not cache readiness if the set changed while it was being checked.
      const after = await inventory()
      const next = after?.map(({ path, stat }) => `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).join('|')
      if (next !== fingerprint) throw error('speech_assets_changed', '校验时资源发生改变；请重新检查。')
      verifiedFingerprint = fingerprint
    }
    const owner = JSON.parse(await fs.readFile(join(currentRoot, '_owner.json'), 'utf8'))
    if (owner.id !== assetManifest.id || !uuid(owner.generation) || (currentRoot !== finalRoot && currentRoot !== join(root, `.generation-${owner.generation}`))) throw error('speech_invalid_manifest', '资源安装归属无效；未加载资源。')
    const failedReplacement = state.operation === 'repair' && ['error', 'cancelled'].includes(state.phase)
    state = { ...state, phase: failedReplacement ? state.phase : 'ready', assetsReady: true, repairRequired: false, resourceGeneration: owner.generation, validatedBytes: assetManifest.downloadBytes, diskBytes: rows.reduce((total, row) => total + row.stat.size, 0), error: failedReplacement ? state.error : null }
    return true
  }

  // Readiness belongs to the active set; storage usage covers every bounded,
  // owned set, partial and metadata file. An untrusted leftover makes the total
  // incomplete, but must not disable an independently verified active set.
  async function updateDiskUsage() {
    try {
      if (!await inspectPath(root)) { state.diskBytes = 0; state.diskBytesKnown = true; return }
      const names = await fs.readdir(root)
      const sets = await replacements(), stages = await partials()
      const ownedNames = new Set([
        ...sets.directories.map(entry => entry.path.slice(root.length + 1)),
        ...sets.pointers.map(entry => entry.path.slice(root.length + 1)),
        ...stages.map(entry => entry.staging.slice(root.length + 1))
      ])
      let bytes = sets.directories.reduce((total, entry) => total + entry.bytes, 0) +
        sets.pointers.reduce((total, entry) => total + entry.identity.size, 0) +
        stages.reduce((total, entry) => total + entry.bytes, 0)
      const active = await pointerIdentity()
      if (active) {
        const file = await fs.open(pointerPath, constants.O_RDONLY | constants.O_NOFOLLOW)
        try {
          const pointer = JSON.parse(await file.readFile('utf8'))
          if (!sameFile(await file.stat(), active) || pointer.id !== assetManifest.id || pointer.revision !== assetManifest.revision || !uuid(pointer.generation)) throw error('speech_invalid_manifest', '活动资源记录无效，无法完整统计占用。')
        } finally { await file.close() }
        ownedNames.add('active.json')
        bytes += active.size
      }
      state.diskBytes = bytes
      state.diskBytesKnown = names.length === ownedNames.size && names.every(name => ownedNames.has(name))
    } catch { state.diskBytesKnown = false }
  }

  async function checkExisting() {
    if (deleting || state.operation === 'delete' && state.phase === 'error') return false
    if (task) return state.assetsReady
    if (!checking) checking = verifyExisting().catch(cause => {
      verifiedFingerprint = null
      state = { ...state, phase: 'error', assetsReady: false, error: describeError(cause) }
      return false
    }).finally(async () => { await updateDiskUsage(); checking = null })
    return checking
  }

  async function removeStaging(job) {
    if (!job.stagingIdentity) return
    await inspectPath(root)
    const expected = join(root, `.prepare-${job.generation}`)
    if (job.staging !== expected || resolve(expected) !== expected) throw error('speech_unsafe_path', '无法安全清理准备目录。')
    const stat = await fs.lstat(expected).catch(cause => { if (cause.code !== 'ENOENT') throw cause })
    if (!stat) return
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino !== job.stagingIdentity.ino || stat.dev !== job.stagingIdentity.dev) {
      throw error('speech_unsafe_path', '准备目录已改变；未清理归属不明的位置。')
    }
    // Recheck the finite allowlist and marker immediately before cleanup, not
    // only when the directory was created or first observed after a restart.
    const owned = await ownedDirectory(expected, job.generation)
    if (owned.identity.ino !== stat.ino || owned.identity.dev !== stat.dev) throw error('speech_unsafe_path', '准备目录已改变；未清理。')
    await fs.rm(expected, { recursive: true, force: true })
    state.diskBytes = job.previous?.bytes ?? 0
  }

  async function run(job) {
    const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(15 * 60_000)])
    const check = () => { if (signal.aborted || disposed) throw cancelled() }
    try {
      check()
      await inspectPath(root, { create: true })
      const final = await fs.lstat(finalRoot).catch(cause => { if (cause.code !== 'ENOENT') throw cause })
      if (final && !job.repair) throw error('speech_repair_required', '已有资源损坏或版本不符；请明确确认修复后重新下载。')
      const staleSets = await replacements()
      const staleStages = await partials()
      for (const stale of staleStages) { check(); await removeStaging(stale) }
      for (const stale of staleSets.directories) {
        if (stale.path === job.previous?.path) continue
        check(); await removeOwned(stale)
      }
      for (const stale of staleSets.pointers) { check(); await removePointer(stale) }
      state.diskBytes = job.previous?.bytes ?? 0
      const disk = await fs.statfs(root)
      if (disk.bavail * disk.bsize < assetManifest.downloadBytes + 65536) throw error('speech_disk_full', '磁盘空间不足；需要约 94.5 MB 资源空间和少量校验元数据。')
      check()
      await fs.mkdir(job.staging, { mode: 0o700 })
      job.stagingIdentity = await fs.lstat(job.staging)
      const ownerFile = await fs.open(join(job.staging, '_owner.json'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        const ownerBytes = JSON.stringify({ id: assetManifest.id, generation: job.generation })
        await ownerFile.writeFile(ownerBytes)
        state.diskBytes += Buffer.byteLength(ownerBytes)
        await ownerFile.sync()
      } finally { await ownerFile.close() }
      for (const asset of assetManifest.files) {
        check()
        const path = join(job.staging, asset.path)
        await inspectPath(path.slice(0, path.lastIndexOf(sep)), { create: true })
        const handle = await fs.open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
        let source, bytes = 0
        const hash = createHash('sha256')
        try {
          source = await download(asset, { signal })
          check()
          state.phase = 'downloading'
          state.currentFile = asset.path
          const abort = () => { source.destroy?.(cancelled()) }
          signal.addEventListener('abort', abort, { once: true })
          try {
            for await (const chunk of source) {
              check()
              const data = Buffer.from(chunk)
              if (bytes + data.length > asset.bytes) throw error('speech_size_mismatch', '下载文件超出固定大小；已停止，不能作为就绪资源。')
              await handle.writeFile(data)
              hash.update(data)
              bytes += data.length
              state.downloadedBytes += data.length
              state.diskBytes += data.length
            }
          } finally { signal.removeEventListener('abort', abort) }
          check()
          state.phase = 'validating'
          if (bytes !== asset.bytes) throw error('speech_size_mismatch', '下载文件不完整；请检查网络后明确重试。')
          if (hash.digest('hex') !== asset.sha256) throw error('speech_checksum_mismatch', '资源校验失败；未将损坏文件标为就绪，请明确重试。')
          await handle.sync()
          state.validatedBytes += bytes
        } finally {
          // An aborted download handshake can still return a Node stream that
          // emits its abort error before an iterator was attached. Cleanup owns
          // that late error; it cannot publish bytes or escape as uncaught I/O.
          source?.on?.('error', () => {})
          source?.destroy?.()
          await handle.close()
        }
      }
      check()
      const marker = await fs.open(join(job.staging, 'ready.json'), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        const bytes = JSON.stringify({ id: assetManifest.id, revision: assetManifest.revision, downloadBytes: assetManifest.downloadBytes })
        await marker.writeFile(bytes)
        await marker.sync()
        state.diskBytes += Buffer.byteLength(bytes)
      } finally { await marker.close() }
      check()
      // Only this completely verified directory acquires the fixed ready name.
      // Failed or cancelled generations can never publish their partial files.
      await inspectPath(root)
      if (job.repair) {
        const replacement = join(root, `.generation-${job.generation}`)
        await fs.rename(job.staging, replacement)
        const pointer = await fs.open(job.pointer, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
        try {
          job.pointerIdentity = await pointer.stat()
          await pointer.writeFile(JSON.stringify({ id: assetManifest.id, revision: assetManifest.revision, generation: job.generation }))
          await pointer.sync()
        } finally { await pointer.close() }
        check()
        // A single rename is the publication point. No reader sees a partial
        // generation, and failures before it leave the old pointer untouched.
        const activeIdentity = await pointerIdentity()
        if (job.activeIdentity ? !activeIdentity || !sameFile(activeIdentity, job.activeIdentity) : activeIdentity) throw error('speech_assets_changed', '活动记录在修复时改变；未覆盖，请重新检查。')
        await fs.rename(job.pointer, pointerPath)
        job.activated = true
        currentRoot = replacement
        verifiedFingerprint = null
        state.phase = 'activating'
        state.assetsReady = false
        state.resourceGeneration = job.generation
        await onActivate({ resourceGeneration: job.generation })
        if (job.previous) await removeOwned(job.previous)
      } else await fs.rename(job.staging, finalRoot)
      state.phase = 'ready'
      state.resourceGeneration = job.generation
      state.assetsReady = true
    } catch (cause) {
      state.phase = job.controller.signal.aborted || disposed ? 'cancelled' : 'error'
      state.error = state.phase === 'error' ? describeError(cause) : null
    } finally {
      try {
        await removeStaging(job)
        if (job.repair && !job.activated) {
          const replacement = join(root, `.generation-${job.generation}`)
          if (await inspectPath(replacement)) await removeOwned(await ownedDirectory(replacement, job.generation))
          if (job.pointerIdentity) await removePointer({ path: job.pointer, identity: job.pointerIdentity, generation: job.generation })
        }
      } catch (cause) {
        state.phase = 'error'
        state.error = describeError(cause)
      }
      if (task === job) task = null
      state.currentFile = null
    }
  }

  return {
    get deleting() { return deleting },
    async status(owner) {
      if (deleting) return snapshot(owner)
      if (task && ['ready', 'error', 'cancelled'].includes(state.phase)) await task.done
      await checkExisting()
      return snapshot(owner)
    },
    async getReadyRoot() {
      if (deleting) return null
      // A compatible current set remains usable throughout the download. Do
      // not subscribe a playback request to its eventual replacement (or make
      // activation's runtime disposal wait on its own preparation promise).
      if (task) return state.assetsReady && task.previous ? task.previous.path : null
      return await checkExisting() && state.assetsReady ? currentRoot : null
    },
    async prepare(owner) {
      if (disposed) return failure('speech_disposed', '插件已停止，无法准备资源。')
      if (deleting) return failure('speech_assets_deleting', '正在删除共享 Kokoro 资源；完成后才能明确重新准备。')
      const ready = await checkExisting()
      if (deleting) return failure('speech_assets_deleting', '正在删除共享 Kokoro 资源；完成后才能明确重新准备。')
      if (ready) return success(snapshot(owner))
      if (task) return task.owner === owner ? success(snapshot(owner)) : failure('speech_busy', '另一页面正在准备共享朗读资源，请等待或由该页面取消。')
      try {
        if (state.repairRequired || await inspectPath(root) && (
          await fs.lstat(pointerPath).catch(cause => { if (cause.code !== 'ENOENT') throw cause }) ||
          await fs.lstat(finalRoot).catch(cause => { if (cause.code !== 'ENOENT') throw cause }))) {
          return failure('speech_repair_required', '已有资源损坏或版本不符，未重新下载；请明确确认修复。')
        }
      } catch (cause) { return failure(describeError(cause).code, describeError(cause).message) }
      // Filesystem validation above awaits. Recheck the public operation owner
      // before the synchronous generation allocation to serialize rapid clicks.
      if (deleting) return failure('speech_assets_deleting', '正在删除共享 Kokoro 资源；完成后才能明确重新准备。')
      if (task) return task.owner === owner ? success(snapshot(owner)) : failure('speech_busy', '另一页面正在准备共享朗读资源，请等待或由该页面取消。')
      const generation = randomUUID()
      const job = { generation, owner, controller: new AbortController(), staging: join(root, `.prepare-${generation}`) }
      state = { ...state, phase: 'preparing', generation, downloadedBytes: 0, validatedBytes: 0, diskBytes: 0, error: null }
      task = job
      job.done = run(job)
      return success(snapshot(owner))
    },
    async repair(owner) {
      if (disposed) return failure('speech_disposed', '插件已停止，无法修复资源。')
      if (deleting) return failure('speech_assets_deleting', '正在删除共享 Kokoro 资源；完成后才能明确重新准备。')
      if (task) return task.owner === owner ? success(snapshot(owner)) : failure('speech_busy', '另一页面正在准备共享朗读资源，请等待或由该页面取消。')
      await checkExisting()
      let previous, activeRecord
      try {
        activeRecord = await readActive({ repair: true })
        const active = activeRecord.path
        if (active && await inspectPath(active)) previous = await ownedDirectory(active, active === finalRoot ? undefined : active.slice(active.lastIndexOf('.generation-') + 12))
        await replacements()
      } catch (cause) { const described = describeError(cause); return failure(described.code, described.message) }
      if (task) return task.owner === owner ? success(snapshot(owner)) : failure('speech_busy', '另一页面正在准备共享朗读资源，请等待或由该页面取消。')
      if (deleting) return failure('speech_assets_deleting', '正在删除共享 Kokoro 资源；完成后才能明确重新准备。')
      const generation = randomUUID()
      const job = { generation, owner, repair: true, previous, activeIdentity: activeRecord.identity, controller: new AbortController(), staging: join(root, `.prepare-${generation}`), pointer: join(root, `.active-${generation}.json`) }
      state = { ...state, phase: 'preparing', generation, operation: 'repair', downloadedBytes: 0, validatedBytes: 0, error: null }
      task = job
      job.done = run(job)
      return success(snapshot(owner))
    },
    delete(owner) {
      if (disposed) return Promise.resolve(failure('speech_disposed', '插件已停止，无法删除资源。'))
      if (deletion) return deletion
      // The gate closes before the first await, including preparation requests
      // that are currently checking the filesystem before allocating a job.
      deleting = true
      state = { ...state, operation: 'delete', assetsReady: false }
      verifiedFingerprint = null
      const job = task
      job?.controller.abort()
      // Invalidate synchronously, but never wait for a job from the audio side:
      // an activating repair can itself already be awaiting this same drain.
      const retiring = onDelete()
      deletion = (async () => {
        try {
          await Promise.all([job?.done, checking, retiring])
          const active = await readActive({ repair: true })
          const sets = await replacements()
          const stages = await partials()
          for (const entry of stages) await removeStaging(entry)
          for (const entry of sets.directories) await removeOwned(entry)
          for (const entry of sets.pointers) await removePointer(entry)
          if (active.identity) {
            await inspectPath(root)
            const identity = await pointerIdentity()
            if (!identity || !sameFile(identity, active.identity)) throw error('speech_assets_changed', '活动记录在删除时改变；未清理该记录，请重新检查。')
            await fs.unlink(pointerPath)
          }
          currentRoot = finalRoot
          state = { ...state, phase: 'unprepared', assetsReady: false, resourceGeneration: null, generation: null,
            repairRequired: false, diskBytesKnown: true, diskBytes: 0, downloadedBytes: 0, validatedBytes: 0, currentFile: null, error: null }
          verifiedFingerprint = null
          deleting = false
          return success(snapshot(owner))
        } catch (cause) {
          const described = describeError(cause)
          state = { ...state, phase: 'error', assetsReady: false, diskBytesKnown: false, error: described }
          return failure(described.code, described.message)
        } finally { deleting = false; deletion = null }
      })()
      return deletion
    },
    async cancel(owner) {
      if (!task) return success(snapshot(owner))
      if (task.owner !== owner) return failure('speech_not_owner', '只能取消本页面发起的准备。')
      const job = task
      job.controller.abort()
      await job.done
      return success(snapshot(owner))
    },
    async dispose() {
      disposed = true
      if (task) { task.controller.abort(); await task.done }
      if (checking) await checking
      if (deletion) await deletion
    }
  }
}
