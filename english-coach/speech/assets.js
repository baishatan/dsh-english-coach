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
export function createSpeechAssets({ root, download = downloadAsset } = {}) {
  let disposed = false, task = null
  let state = {
    phase: 'unprepared', assetsReady: false, runtimeAvailable: false,
    manifest: assetManifest, downloadedBytes: 0, validatedBytes: 0, diskBytes: 0,
    generation: null, currentFile: null, error: null
  }
  const snapshot = owner => ({ ...state, canCancel: !!task && task.owner === owner })
  const finalRoot = join(root, assetManifest.id)
  let verifiedFingerprint = null, checking = null

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
    if (!await inspectPath(finalRoot)) return null
    const paths = ['ready.json', '_owner.json', ...assetManifest.files.map(asset => asset.path)]
    const rows = []
    for (const path of paths) {
      const full = join(finalRoot, path)
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
      if (state.assetsReady) state = { ...state, phase: 'unprepared', assetsReady: false, validatedBytes: 0, diskBytes: 0 }
      if (leftovers.length) state = { ...state, phase: 'interrupted', assetsReady: false, diskBytes: leftovers.reduce((total, stage) => total + stage.bytes, 0), error: null }
      return false
    }
    const fingerprint = rows.map(({ path, stat }) => `${path}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`).join('|')
    if (fingerprint !== verifiedFingerprint) {
      const ready = JSON.parse(await fs.readFile(join(finalRoot, 'ready.json'), 'utf8'))
      if (ready.id !== assetManifest.id || ready.revision !== assetManifest.revision || ready.downloadBytes !== assetManifest.downloadBytes) {
        throw error('speech_invalid_manifest', '资源版本与固定清单不符；未加载资源。')
      }
      for (const asset of assetManifest.files) {
        const row = rows.find(row => row.path === asset.path)
        if (row.stat.size !== asset.bytes) throw error('speech_size_mismatch', '已保存资源大小不符；未加载资源，请明确修复。')
        const file = await fs.open(join(finalRoot, asset.path), constants.O_RDONLY | constants.O_NOFOLLOW)
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
    state = { ...state, phase: 'ready', assetsReady: true, validatedBytes: assetManifest.downloadBytes, diskBytes: rows.reduce((total, row) => total + row.stat.size, 0), error: null }
    return true
  }

  async function checkExisting() {
    if (task) return state.assetsReady
    if (!checking) checking = verifyExisting().catch(cause => {
      verifiedFingerprint = null
      state = { ...state, phase: 'error', assetsReady: false, error: describeError(cause) }
      return false
    }).finally(() => { checking = null })
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
    // rm does not follow nested symlinks. The top-level directory identity and
    // its plugin-owned parent have both been checked before recursive cleanup.
    await fs.rm(expected, { recursive: true, force: true })
    state.diskBytes = 0
  }

  async function run(job) {
    const signal = AbortSignal.any([job.controller.signal, AbortSignal.timeout(15 * 60_000)])
    const check = () => { if (signal.aborted || disposed) throw cancelled() }
    try {
      check()
      await inspectPath(root, { create: true })
      const final = await fs.lstat(finalRoot).catch(cause => { if (cause.code !== 'ENOENT') throw cause })
      if (final) throw error('speech_repair_required', '已有资源损坏或版本不符，未重新下载；需要明确修复，当前版本尚未提供该操作。')
      for (const stale of await partials()) { check(); await removeStaging(stale) }
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
      await fs.rename(job.staging, finalRoot)
      state.phase = 'ready'
      state.assetsReady = true
    } catch (cause) {
      state.phase = job.controller.signal.aborted || disposed ? 'cancelled' : 'error'
      state.error = state.phase === 'error' ? describeError(cause) : null
    } finally {
      try { await removeStaging(job) } catch (cause) {
        state.phase = 'error'
        state.error = describeError(cause)
      }
      if (task === job) task = null
      state.currentFile = null
    }
  }

  return {
    async status(owner) {
      if (task && ['ready', 'error', 'cancelled'].includes(state.phase)) await task.done
      await checkExisting()
      return snapshot(owner)
    },
    async getReadyRoot() {
      if (task) await task.done
      return await checkExisting() && state.assetsReady ? finalRoot : null
    },
    async prepare(owner) {
      if (disposed) return failure('speech_disposed', '插件已停止，无法准备资源。')
      if (await checkExisting()) return success(snapshot(owner))
      if (task) return task.owner === owner ? success(snapshot(owner)) : failure('speech_busy', '另一页面正在准备共享朗读资源，请等待或由该页面取消。')
      try {
        if (await inspectPath(root) && await fs.lstat(finalRoot).catch(cause => { if (cause.code !== 'ENOENT') throw cause })) {
          return failure('speech_repair_required', '已有资源损坏或版本不符，未重新下载；需要明确修复，当前版本尚未提供该操作。')
        }
      } catch (cause) { return failure(describeError(cause).code, describeError(cause).message) }
      // Filesystem validation above awaits. Recheck the public operation owner
      // before the synchronous generation allocation to serialize rapid clicks.
      if (task) return task.owner === owner ? success(snapshot(owner)) : failure('speech_busy', '另一页面正在准备共享朗读资源，请等待或由该页面取消。')
      const generation = randomUUID()
      const job = { generation, owner, controller: new AbortController(), staging: join(root, `.prepare-${generation}`) }
      state = { ...state, phase: 'preparing', generation, downloadedBytes: 0, validatedBytes: 0, diskBytes: 0, error: null }
      task = job
      job.done = run(job)
      return success(snapshot(owner))
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
    }
  }
}
