import { fork } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

const failure = (code, message) => Object.assign(new Error(message), { code })
const aborted = () => Object.assign(new Error('Local speech synthesis was canceled'), { name: 'AbortError', code: 'ABORT_ERR' })

// Host-only constructor: assetRoot is never part of a learner's speech payload.
// Import/construction do no I/O. Each instance owns one reclaimable heavy lane;
// the Host owns cross-page scheduling, fairness, and audio ownership above it.
export function createSpeechRuntime({ assetRoot, idleMs = 30000 } = {}) {
  if (typeof assetRoot !== 'string' || !isAbsolute(assetRoot) || assetRoot.includes('\0')) {
    throw new TypeError('assetRoot must be an absolute Host-owned local directory')
  }
  if (!Number.isSafeInteger(idleMs) || idleMs < 1 || idleMs > 300000) {
    throw new TypeError('idleMs must be a Host-configured integer from 1 to 300000')
  }
  let disposed = false, busy = false, worker, stopping, idleTimer, sequence = 0

  function settle(slot, error, bytes) {
    const pending = slot.pending
    if (!pending) return
    slot.pending = undefined
    clearTimeout(pending.timer)
    error ? pending.reject(error) : pending.resolve(bytes)
  }

  function stop(slot, error = failure('WORKER_STOPPED', 'Local speech worker stopped')) {
    if (!slot) return stopping ?? Promise.resolve()
    if (slot.stopping) return slot.stopping
    clearTimeout(idleTimer)
    slot.rejectReady(error)
    settle(slot, error)
    slot.stopping = (async () => {
      if (slot.child.exitCode !== null || slot.child.signalCode !== null) { await slot.closed; return }
      slot.child.kill('SIGTERM')
      const force = setTimeout(() => slot.child.kill('SIGKILL'), 2000)
      force.unref()
      try { await slot.closed } finally { clearTimeout(force) }
    })().finally(() => {
      if (worker === slot) worker = undefined
      if (stopping === slot.stopping) stopping = undefined
    })
    stopping = slot.stopping
    return slot.stopping
  }

  async function acquire() {
    await stopping
    if (disposed) throw failure('RUNTIME_DISPOSED', 'Local speech runtime is disposed')
    if (worker) { await worker.ready; return worker }
    let root
    try {
      root = await fs.realpath(assetRoot)
      if (!(await fs.stat(root)).isDirectory()) throw new Error('Not a directory')
    } catch {
      throw failure('ASSETS_NOT_READY', 'Local speech assets are not ready; prepare them explicitly')
    }
    if (disposed) throw failure('RUNTIME_DISPOSED', 'Local speech runtime is disposed')
    const child = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [root], {
      execPath: process.execPath, execArgv: [], serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc']
    })
    const slot = { child }
    // Node can omit 'close' after an explicitly disconnected advanced IPC
    // channel. Actual process exit AND channel disconnect is the equivalent
    // completion boundary; neither event alone is sufficient.
    slot.closed = new Promise(resolve => {
      let exited = false, disconnected = !child.connected
      const check = () => { if (exited && disconnected) resolve() }
      child.once('exit', () => { exited = true; check() })
      child.once('disconnect', () => { disconnected = true; check() })
      child.once('close', resolve)
    })
    slot.ready = new Promise((resolve, reject) => { slot.resolveReady = resolve; slot.rejectReady = reject })
    // Always attach a handler: cancellation can reject readiness before acquire awaits it.
    slot.ready.catch(() => {})
    worker = slot
    const helloTimer = setTimeout(() => {
      void stop(slot, failure('WORKER_TIMEOUT', 'Local speech worker did not start in time'))
    }, 10000)
    child.on('message', message => {
      if (message?.type === 'ready' && message.protocol === 1) {
        clearTimeout(helloTimer)
        slot.resolveReady()
      } else if (message?.id === slot.pending?.id && message?.type === 'result' &&
        Buffer.isBuffer(message.bytes) && message.bytes.length > 44 && message.bytes.length <= 16 * 1024 * 1024) {
        settle(slot, null, message.bytes)
      } else if (message?.id === slot.pending?.id && message?.type === 'error' &&
        typeof message.code === 'string' && typeof message.message === 'string' && message.message.length <= 300) {
        settle(slot, failure(message.code, message.message))
      } else {
        void stop(slot, failure('WORKER_PROTOCOL', 'Local speech worker returned an invalid response'))
      }
    })
    child.once('error', () => {
      void stop(slot, failure('WORKER_FAILED', 'Local speech worker could not run'))
    })
    slot.closed.then(() => {
      clearTimeout(helloTimer)
      slot.rejectReady(failure('WORKER_FAILED', 'Local speech worker exited before becoming ready'))
      settle(slot, failure('WORKER_FAILED', 'Local speech worker exited before returning audio'))
      if (worker === slot) worker = undefined
    })
    await slot.ready
    return slot
  }

  return {
    async synthesize(request, { signal } = {}) {
      if (disposed) throw failure('RUNTIME_DISPOSED', 'Local speech runtime is disposed')
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => !['text', 'voice', 'rate'].includes(key)) ||
        typeof request.text !== 'string' || !request.text.trim() || request.text.length > 400 ||
        !/^[\x20-\x7e\t\r\n\u00a0\u00a3\u2010-\u2015\u2018-\u201f\u2026]+$/.test(request.text) ||
        !/[A-Za-z0-9]/.test(request.text) ||
        !['af_heart', 'am_michael', 'bf_emma', 'bm_george'].includes(request.voice) ||
        ![0.5, 1, 1.5, 2].includes(request.rate)) {
        throw failure('INVALID_REQUEST', 'Use bounded English text, a curated voice, and rate 0.5, 1, 1.5, or 2')
      }
      if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) {
        throw failure('INVALID_REQUEST', 'Use an AbortSignal to cancel local speech')
      }
      if (signal?.aborted) throw aborted()
      if (busy) throw failure('RUNTIME_BUSY', 'Local speech is busy; the Host must schedule one request at a time')
      busy = true
      clearTimeout(idleTimer)
      const cancel = () => { if (worker) void stop(worker, aborted()) }
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        const slot = await acquire()
        if (signal?.aborted) { await stop(slot, aborted()); throw aborted() }
        if (disposed) throw failure('RUNTIME_DISPOSED', 'Local speech runtime is disposed')
        const id = String(++sequence)
        return await new Promise((resolve, reject) => {
          slot.pending = { id, resolve, reject,
            timer: setTimeout(() => { void stop(slot, failure('WORKER_TIMEOUT', 'Local speech synthesis exceeded its time limit')) }, 120000) }
          slot.child.send({ type: 'synthesize', id, text: request.text, voice: request.voice, rate: request.rate }, error => {
            if (error) void stop(slot, failure('WORKER_FAILED', 'Local speech worker IPC is unavailable'))
          })
        })
      } finally {
        signal?.removeEventListener('abort', cancel)
        // Cancellation/protocol failure must finish reclaiming the actual OS
        // child before releasing this synthesis lane to another request.
        await stopping
        busy = false
        if (!disposed && worker && !worker.stopping) {
          const slot = worker
          idleTimer = setTimeout(() => { void stop(slot) }, idleMs)
          idleTimer.unref()
        }
      }
    },
    async dispose() {
      disposed = true
      clearTimeout(idleTimer)
      await stop(worker, failure('RUNTIME_DISPOSED', 'Local speech runtime is disposed'))
    }
  }
}
