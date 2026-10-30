import { createHash, randomUUID } from 'node:crypto'
import { assetManifest } from './asset-manifest.js'

const success = data => ({ ok: true, data, warnings: [] })
const failure = (code, message) => ({ ok: false, code, message })
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const invalid = () => failure('invalid_speech_request', '朗读参数无效；只接受不超过 400 字符的英文、固定音色与四档语速，不接受路径或地址。')
const validHandle = payload => plain(payload) && Object.keys(payload).length === 1 && typeof payload.taskId === 'string' && /^[a-f0-9-]{36}$/.test(payload.taskId)
const notFound = () => failure('speech_not_found', '朗读任务不存在或已过期。')
const TTL_MS = 120_000
const PAGE_LEASE_MS = 15_000
const MAX_PAGES = 16
const MAX_AUDIO_BYTES = 16 * 1024 * 1024
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MAX_OWNER_BYTES = 16 * 1024 * 1024
const MAX_CACHE_ENTRIES = 64

// One Host owns the heavy synthesis lane. Pages share models, not private
// tasks or audio. No files, learning writes, downloads or client paths here.
export function createSpeechAudio({ assets, runtimeFactory } = {}) {
  const tasks = new Map(), pages = new Map(), cache = new Map()
  let queue = [], active = null, runtime = null, disposed = false, disposal = null, cacheBytes = 0
  let epoch = 0, invalidation = null, runtimeRoot = null
  const snapshot = task => ({ taskId: task.id, phase: task.phase, error: task.error, resourceGeneration: task.resourceGeneration ?? null })
  const live = task => !disposed && task.epoch === epoch && tasks.get(task.id) === task && !task.controller.signal.aborted
  function remove(task) {
    task.controller.abort()
    tasks.delete(task.id)
    const page = pages.get(task.owner)
    if (page?.[task.priority] === task) {
      page[task.priority] = null
      if (!page.foreground && !page.prefetch) pages.delete(task.owner)
    }
    queue = queue.filter(value => value !== task)
    task.payload = null
  }
  function reapRuntime() {
    if (invalidation) return invalidation
    if (pages.size || !runtime && !active) return Promise.resolve()
    const previousRuntime = runtime, previousTask = active
    runtime = null; runtimeRoot = null
    invalidation = (async () => { await previousRuntime?.dispose(); await previousTask?.done })()
      .finally(() => { invalidation = null; pump() })
    return invalidation
  }
  function evict(key) {
    const entry = cache.get(key)
    if (!entry) return
    cacheBytes -= entry.audio.length
    cache.delete(key)
    for (const task of tasks.values()) if (task.cacheKey === key && task.phase === 'ready') remove(task)
  }
  function releaseOwner(owner) {
    for (const task of tasks.values()) if (task.owner === owner) remove(task)
    for (const [key, entry] of cache) if (entry.owner === owner) evict(key)
  }
  function touch(owner) {
    const page = pages.get(owner)
    if (page) page.leaseExpires = Date.now() + PAGE_LEASE_MS
  }
  function expire() {
    for (const [owner, page] of pages) if (page.leaseExpires <= Date.now()) releaseOwner(owner)
    for (const task of tasks.values()) if (task.expires <= Date.now()) remove(task)
    for (const [key, entry] of cache) if (entry.expires <= Date.now()) evict(key)
    // HTTP cannot detect a vanished page. Its bounded lease eventually releases
    // only that owner, and the final owner reaps the actual worker as well.
    void reapRuntime()
  }
  function retain(task, audio) {
    const ownerBytes = () => [...cache.values()].filter(entry => entry.owner === task.owner).reduce((total, entry) => total + entry.audio.length, 0)
    for (const [key, entry] of cache) {
      if (ownerBytes() + audio.length <= MAX_OWNER_BYTES) break
      if (entry.owner === task.owner) evict(key)
    }
    while (cache.size && (cacheBytes + audio.length > MAX_CACHE_BYTES || cache.size >= MAX_CACHE_ENTRIES)) evict(cache.keys().next().value)
    cache.set(task.cacheKey, { owner: task.owner, audio, expires: task.expires })
    cacheBytes += audio.length
  }
  const timer = setInterval(expire, 1000)
  timer.unref?.()

  async function run(task) {
    try {
      // A synthesis click never waits for or subscribes to a preparation job.
      // Completion remains silent; only a later explicit click can use it.
      const status = await assets.status(task.owner)
      const assetRoot = status.assetsReady ? await assets.getReadyRoot() : null
      if (!live(task)) return
      if (!assetRoot) {
        task.phase = 'error'
        task.payload = null
        task.error = { code: 'ASSETS_NOT_READY', message: 'Kokoro 尚未准备；请先明确准备资源，再手动播放。' }
        return
      }
      task.resourceGeneration = status.resourceGeneration
      task.cacheKey = createHash('sha256').update(`${task.cacheKey}:${status.resourceGeneration}`).digest('hex')
      const cached = cache.get(task.cacheKey)
      if (cached) { task.payload = null; task.phase = 'ready'; return }
      task.phase = 'loading'
      if (runtime && runtimeRoot !== assetRoot) { await runtime.dispose(); runtime = null; runtimeRoot = null; if (!live(task)) return }
      if (!runtime) {
        const factory = runtimeFactory ?? (await import('./runtime.js')).createSpeechRuntime
        if (!live(task)) return
        runtime = factory({ assetRoot })
        runtimeRoot = assetRoot
      }
      task.phase = 'generating'
      const audio = await runtime.synthesize(task.payload, { signal: task.controller.signal })
      if (!live(task)) return
      if (!Buffer.isBuffer(audio) || audio.length > MAX_AUDIO_BYTES) throw Object.assign(new Error('output limit'), { code: 'speech_audio_too_large' })
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('invalid WAV')
      retain(task, audio)
      task.payload = null
      task.phase = 'ready'
    } catch (cause) {
      if (!live(task)) return
      task.phase = 'error'
      task.payload = null
      const known = {
        ASSETS_NOT_READY: '朗读资源不可用；请检查资源后手动重试，不会自动下载。',
        TEXT_TOO_LONG: '这段英文超过本地合成上限，请缩短后手动重试。',
        speech_audio_too_large: '生成音频超过 16 MiB 上限；未保留音频，请缩短英文后手动重试。',
        RUNTIME_BUSY: '本地朗读仍在结束上一任务，请稍后手动重试。',
        RUNTIME_DISPOSED: '本地朗读已停止，请重新打开后手动重试。'
      }
      const code = Object.hasOwn(known, cause?.code) ? cause.code : 'speech_generation_failed'
      task.error = { code, message: known[code] ?? '本地朗读生成失败，请手动重试。' }
    }
  }
  function pump() {
    if (active || disposed || invalidation) return
    expire()
    // One upcoming task per page is speculative. It never passes an already
    // queued foreground request and never interrupts the running small task.
    const foreground = queue.findIndex(task => task.priority === 'foreground')
    const task = queue.splice(foreground < 0 ? 0 : foreground, 1)[0]
    if (!task) return
    active = task
    task.done = run(task).finally(() => {
      // A page may replace its running block many times. Its latest pending
      // request gets the next round, behind every other page already waiting.
      queue = [...queue.filter(value => value.owner !== task.owner), ...queue.filter(value => value.owner === task.owner)]
      active = null; pump()
    })
  }
  return {
    request(owner, payload) {
      if (!plain(payload) || !['rate,text,voice', 'priority,rate,text,voice'].includes(Object.keys(payload).sort().join(',')) ||
          Object.hasOwn(payload, 'priority') && !['foreground', 'prefetch'].includes(payload.priority) ||
          typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 400 ||
          !/[A-Za-z0-9]/.test(payload.text) || !/^[\x20-\x7e\t\r\n\u00a0\u00a3\u2010-\u2015\u2018-\u201f\u2026]+$/.test(payload.text) ||
          !assetManifest.voices.includes(payload.voice) || ![0.5, 1, 1.5, 2].includes(payload.rate)) return invalid()
      if (disposed) return failure('RUNTIME_DISPOSED', '插件已停止，请重新打开后手动播放。')
      if (invalidation || assets.deleting) return failure('speech_assets_changing', '共享朗读资源正在切换或删除；请完成后重新点击播放。')
      expire()
      if (invalidation || assets.deleting) return failure('speech_assets_changing', '共享朗读资源正在切换或删除；请完成后重新点击播放。')
      if (!pages.has(owner) && pages.size >= MAX_PAGES) return failure('speech_capacity', '朗读页面已达上限，请稍后手动重试。')
      const priority = payload.priority ?? 'foreground'
      let page = pages.get(owner)
      const previousIndex = queue.indexOf(page?.[priority])
      if (priority === 'prefetch') {
        if (!page?.foreground?.delivered) return failure('speech_not_ready', '当前朗读音频尚未领取，不能预取下一句段。')
        if (page.prefetch) remove(page.prefetch)
      } else {
        if (page?.prefetch) remove(page.prefetch)
        if (page?.foreground) remove(page.foreground)
      }
      page = pages.get(owner) ?? { foreground: null, prefetch: null }
      const cacheKey = createHash('sha256').update(JSON.stringify([owner, assetManifest.id, assetManifest.revision, 'wav-f32-24k-v1', payload.text, payload.voice, payload.rate])).digest('hex')
      const task = { id: randomUUID(), owner, priority, delivered: false, cacheKey, payload: { text: payload.text, voice: payload.voice, rate: payload.rate }, phase: 'queued', error: null, epoch, expires: Date.now() + TTL_MS, controller: new AbortController() }
      page[priority] = task
      tasks.set(task.id, task); pages.set(owner, page); touch(owner)
      if (previousIndex < 0) queue.push(task)
      else queue.splice(Math.min(previousIndex, queue.length), 0, task)
      pump()
      return success(snapshot(task))
    },
    status(owner, payload) {
      if (!validHandle(payload)) return invalid()
      expire()
      const task = tasks.get(payload.taskId)
      if (task?.owner !== owner) return notFound()
      touch(owner)
      return success(snapshot(task))
    },
    cancel(owner, payload) {
      if (!validHandle(payload)) return invalid()
      expire()
      const task = tasks.get(payload.taskId)
      if (task?.owner !== owner) return notFound()
      remove(task)
      if (![...tasks.values()].some(value => value.cacheKey === task.cacheKey && value.phase === 'ready')) evict(task.cacheKey)
      return success({ taskId: task.id, phase: 'cancelled', error: null })
    },
    audio(owner, payload) {
      if (!validHandle(payload)) return invalid()
      expire()
      const task = tasks.get(payload.taskId)
      if (task?.owner !== owner) return notFound()
      touch(owner)
      if (task.phase !== 'ready' || !cache.has(task.cacheKey)) return failure('speech_not_ready', '生成音频尚未就绪。')
      task.delivered = true
      return { ok: true, audio: cache.get(task.cacheKey).audio }
    },
    heartbeat(owner, payload) {
      if (!plain(payload) || Object.keys(payload).length) return invalid()
      expire()
      touch(owner)
      return success({ active: pages.has(owner), leaseMs: PAGE_LEASE_MS })
    },
    async release(owner, payload) {
      if (!plain(payload) || Object.keys(payload).length) return invalid()
      releaseOwner(owner)
      await reapRuntime()
      return success({ released: true })
    },
    invalidate() {
      if (invalidation) return invalidation
      epoch++
      for (const task of tasks.values()) remove(task)
      cache.clear(); cacheBytes = 0
      const previousRuntime = runtime, previousTask = active
      runtime = null; runtimeRoot = null
      invalidation = (async () => { await previousRuntime?.dispose(); await previousTask?.done })()
        .finally(() => { invalidation = null; pump() })
      return invalidation
    },
    dispose() {
      if (disposal) return disposal
      disposed = true
      clearInterval(timer)
      for (const task of tasks.values()) remove(task)
      cache.clear(); cacheBytes = 0
      // Capture both before awaiting. A cancelled late import cannot construct
      // a runtime, and cleanup awaits real worker termination, not just a map.
      disposal = (async () => { await runtime?.dispose(); await invalidation; await active?.done })()
      return disposal
    }
  }
}
