import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, promises as fs } from 'node:fs'
import { registerHooks } from 'node:module'
import { isAbsolute, join, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Legacy admission fixture, not a product runtime, current-Profile test, or audio-quality admission.
// Requires the historical extracted probe-20261029/ and gpl-free/ payload layout and pack manifest.
if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/check-speech-worker.mjs <extracted-candidate-root> <pack-summary.json>
Both paths must be absolute. Requires the historical probe-20261029/ and gpl-free/ payload layout.
Legacy worker-lifecycle fixture only; not a product, current-Profile, or audio-quality admission.
Normal execution validates the payload, forks synthesis workers, and writes to .scratch/speech-admission/.
--help only prints usage; it reads no payload and starts no worker.`)
  process.exit(0)
}
const isWorker = process.argv[2] === '--worker'
const candidateRoot = process.argv[isWorker ? 3 : 2]
const manifestPath = process.argv[3]
assert.ok(candidateRoot && isAbsolute(candidateRoot),
  'Usage: node scripts/check-speech-worker.mjs <extracted-candidate-root> <pack-summary.json> (absolute paths)')
const [major, minor] = process.versions.node.split('.').map(Number)
assert.ok(major === 24 && minor >= 21, 'Use Node 24.21+')

async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(path)) hash.update(bytes)
  return hash.digest('hex')
}

async function worker() {
  assert.equal(typeof process.send, 'function', 'The worker requires its parent IPC channel')
  process.once('disconnect', () => process.exit(0))
  let fetchAttempts = 0
  globalThis.fetch = async () => { fetchAttempts++; throw new Error('Offline admission worker forbids fetch') }
  const boundary = pathToFileURL(`${await fs.realpath(candidateRoot)}${sep}`).href
  const imports = new Set()
  registerHooks({ resolve(specifier, context, next) {
    const resolved = next(specifier, context)
    if (resolved.url.startsWith('file:')) assert.ok(resolved.url.startsWith(boundary), 'Use the extracted payload only')
    assert.ok(!resolved.url.endsWith('.node'))
    assert.ok(!/\/node_modules\/(?:phonemizer|kokoro-js|onnxruntime-node)\//.test(resolved.url))
    imports.add(resolved.url)
    return resolved
  } })
  const probe = join(candidateRoot, 'probe-20261029')
  const assets = join(probe, 'assets/model')
  const manifest = JSON.parse(await fs.readFile(join(probe, 'assets-verified.json'), 'utf8'))
  const modelPath = join(assets, 'onnx/model_quantized.onnx')
  assert.equal(await sha256File(modelPath), manifest.find(item => item.path === 'onnx/model_quantized.onnx').sha256)
  for (const name of ['tokenizer.json', 'tokenizer_config.json']) {
    assert.equal(await sha256File(join(assets, name)), manifest.find(item => item.path === name).sha256)
  }
  const voices = new Map()
  for (const name of ['af_heart', 'am_michael', 'bf_emma', 'bm_george']) {
    const bytes = await fs.readFile(join(assets, `voices/${name}.bin`))
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
      manifest.find(item => item.path === `voices/${name}.bin`).sha256)
    assert.equal(bytes.length, 522240)
    voices.set(name, new Float32Array(Uint8Array.from(bytes).buffer))
  }
  const runtimeRoot = join(probe, 'runtime-candidate-1.31.1/node_modules/onnxruntime-web')
  assert.equal(JSON.parse(await fs.readFile(join(runtimeRoot, 'package.json'), 'utf8')).version, '1.31.1')
  const ort = await import(pathToFileURL(join(runtimeRoot, 'dist/ort.node.min.mjs')).href)
  const { createFrontend } = await import(pathToFileURL(join(candidateRoot, 'gpl-free/extended/frontend.mjs')).href)
  delete ort.env.wasm.wasmPaths
  ort.env.wasm.numThreads = 4
  const session = await ort.InferenceSession.create(await fs.readFile(modelPath), {
    executionProviders: ['wasm'], enableCpuMemArena: false, enableMemPattern: false
  })
  const vocab = JSON.parse(await fs.readFile(join(assets, 'tokenizer.json'), 'utf8')).model.vocab
  const frontend = createFrontend(ort, vocab)
  const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()))
  let busy = false, idleTimer
  const armIdle = () => {
    // One second is a probe fixture, not the production idle timeout.
    idleTimer = setTimeout(async () => {
      try {
        await frontend.release()
        await session.release()
        await send({ type: 'idle-exit', fetchAttempts, maxRssKiB: process.resourceUsage().maxRSS, imports: imports.size })
        process.exit(0)
      } catch (error) { console.error(error); process.exit(1) }
    }, 1000)
  }
  process.on('message', async request => {
    clearTimeout(idleTimer)
    try {
      assert.equal(busy, false, 'Only one admission request at a time')
      assert.ok(request && typeof request.id === 'string' && request.id.length > 0 && request.id.length <= 80)
      assert.ok(request && typeof request.text === 'string' && request.text.trim() && request.text.length <= 400)
      assert.ok(['af_heart', 'am_michael', 'bf_emma', 'bm_george'].includes(request.voice))
      assert.ok([0.5, 1, 1.5, 2].includes(request.speed))
      busy = true
      const result = await frontend.phonemize(request.text, request.voice.startsWith('b') ? 'gb' : 'us')
      assert.ok(result.phonemes.length > 0 && result.phonemes.length <= 510)
      const ids = [0, ...[...result.phonemes].map(char => vocab[char]), 0]
      const row = Math.min(result.phonemes.length, 509)
      const style = voices.get(request.voice).slice(row * 256, (row + 1) * 256)
      assert.equal(style.length, 256)
      await send({ type: 'inference-started', id: request.id })
      const { waveform } = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
        style: new ort.Tensor('float32', style, [1, 256]), speed: new ort.Tensor('float32', [request.speed], [1])
      })
      const data = waveform.data
      assert.ok(data.length > 0 && data.length * 4 + 44 <= 16 * 1024 * 1024 && data.every(Number.isFinite))
      assert.ok(data.some(sample => Math.abs(sample) > 0.00001), 'Reject silent output')
      const bytes = Buffer.alloc(44 + data.length * 4)
      bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
      bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(1, 22)
      bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(4, 32)
      bytes.writeUInt16LE(32, 34); bytes.write('data', 36); bytes.writeUInt32LE(data.length * 4, 40)
      data.forEach((sample, i) => bytes.writeFloatLE(sample, 44 + i * 4))
      assert.equal(fetchAttempts, 0)
      await send({
        type: 'result', id: request.id, voice: request.voice, bytes, phonemes: result.phonemes,
        fallbackWords: result.fallbackWords, audioSha256: createHash('sha256').update(bytes).digest('hex'),
        fetchAttempts, maxRssKiB: process.resourceUsage().maxRSS
      })
      busy = false
      armIdle()
    } catch (error) {
      process.send({ type: 'rejected', id: request?.id, message: error.message }, () => process.exit(1))
    }
  })
  process.send({ type: 'ready', rss: process.memoryUsage().rss, fetchAttempts })
  armIdle()
}

function waitMessage(child, type) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); child.off('message', message); child.off('exit', exited); child.off('error', failed) }
    const message = value => { if (value.type === type) { cleanup(); resolve(value) } }
    const exited = (code, signal) => { cleanup(); reject(new Error(`Worker exited before ${type}: ${code}/${signal}`)) }
    const failed = error => { cleanup(); reject(error) }
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${type}`)) }, 30000)
    child.on('message', message); child.once('exit', exited); child.once('error', failed)
  })
}

async function check() {
  assert.ok(manifestPath && isAbsolute(manifestPath), 'Pass the absolute pack-summary.json path')
  const root = await fs.realpath(candidateRoot)
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  assert.ok(Array.isArray(manifest.inventory) && manifest.inventory.length > 0 && manifest.inventory.length <= 2000)
  const names = new Set()
  let totalBytes = 0
  for (const item of manifest.inventory) {
    assert.ok(typeof item.path === 'string' && item.path.startsWith('candidate/'))
    const relative = item.path.slice('candidate/'.length)
    assert.ok(relative && !relative.includes('\\') && relative.split('/').every(part => part && part !== '.' && part !== '..'))
    assert.ok(!names.has(relative)); names.add(relative)
    assert.ok(Number.isSafeInteger(item.bytes) && item.bytes >= 0 && /^[a-f0-9]{64}$/.test(item.sha256))
    totalBytes += item.bytes
    assert.ok(totalBytes <= 512 * 1024 * 1024, 'Use the bounded admission payload')
    const path = await fs.realpath(join(root, relative))
    assert.ok(path.startsWith(`${root}${sep}`), 'Reject files outside the extracted payload')
    const info = await fs.stat(path)
    assert.ok(info.isFile() && info.size === item.bytes)
    assert.equal(await sha256File(path), item.sha256, relative)
  }
  const outputRoot = fileURLToPath(new URL('../../.scratch/speech-admission/', import.meta.url))
  await fs.mkdir(outputRoot, { recursive: true })
  const output = await fs.mkdtemp(join(outputRoot, 'worker-'))
  const rows = []
  for (const mode of ['idle', 'cancel', 'invalid', 'disconnect-idle']) {
    const child = fork(fileURLToPath(import.meta.url), ['--worker', root], {
      execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc']
    })
    let stderr = '', resultSeen = false
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4000) })
    child.on('message', value => { if (value.type === 'result') resultSeen = true })
    // Exit alone can precede IPC closure; require both public lifecycle signals.
    const exited = Promise.all([once(child, 'exit'), once(child, 'disconnect')]).then(([result]) => result)
    exited.catch(() => {})
    const started = performance.now()
    try {
      const ready = await waitMessage(child, 'ready')
      const readyMs = performance.now() - started
      assert.equal(ready.fetchAttempts, 0)
      if (mode === 'idle') {
        const stopping = waitMessage(child, 'idle-exit')
        stopping.catch(() => {})
        const samples = []
        for (const voice of ['af_heart', 'bf_emma']) {
          const id = `idle-${voice}`
          const completing = waitMessage(child, 'result')
          child.send({ id, text: 'The ormex arrived at 10:30.', voice, speed: 1 })
          const audio = await completing
          assert.equal(audio.id, id)
          assert.equal(audio.voice, voice)
          assert.ok(Buffer.isBuffer(audio.bytes), 'Advanced IPC must preserve the WAV Buffer')
          assert.equal(audio.bytes.toString('ascii', 0, 4), 'RIFF')
          assert.equal(audio.bytes.toString('ascii', 8, 12), 'WAVE')
          assert.equal(audio.fetchAttempts, 0)
          assert.ok(audio.fallbackWords.includes('ormex'))
          assert.equal(createHash('sha256').update(audio.bytes).digest('hex'), audio.audioSha256)
          await fs.writeFile(join(output, `worker-${voice}.wav`), audio.bytes)
          samples.push({ id, voice, bytes: audio.bytes.length, audioSha256: audio.audioSha256,
            parentReceivedMs: performance.now() - started, fallbackWords: audio.fallbackWords })
        }
        const stopped = await stopping
        assert.equal(stopped.fetchAttempts, 0)
        assert.deepEqual(await exited, [0, null])
        rows.push({ mode, pid: child.pid, loadedRss: ready.rss, maxRssKiB: stopped.maxRssKiB,
          readyMs, samples, imports: stopped.imports, elapsedMs: performance.now() - started,
          fetchAttempts: stopped.fetchAttempts, exitCode: 0 })
      } else if (mode === 'cancel') {
        const computing = waitMessage(child, 'inference-started')
        child.send({ id: 'cancel-job', text: 'She thought the weather would improve by Thursday.', voice: 'af_heart', speed: 0.5 })
        assert.equal((await computing).id, 'cancel-job')
        await delay(50)
        assert.equal(resultSeen, false, 'Cancel before synthesis has returned')
        const cancelStarted = performance.now()
        assert.equal(child.kill('SIGTERM'), true)
        const [code, signal] = await exited
        assert.equal(signal, 'SIGTERM')
        assert.equal(resultSeen, false)
        assert.ok(performance.now() - cancelStarted < 5000)
        rows.push({ mode, pid: child.pid, exitCode: code, signal, lateResult: resultSeen,
          terminateMs: performance.now() - cancelStarted })
      } else if (mode === 'invalid') {
        const rejected = waitMessage(child, 'rejected')
        child.send({ id: 'invalid-voice', text: 'Opportunity.', voice: 'not-a-curated-voice', speed: 1 })
        assert.equal((await rejected).id, 'invalid-voice')
        assert.deepEqual(await exited, [1, null])
        assert.equal(resultSeen, false)
        rows.push({ mode, pid: child.pid, exitCode: 1, resultSeen })
      } else {
        const disconnectStarted = performance.now()
        child.disconnect()
        assert.deepEqual(await exited, [0, null])
        assert.equal(resultSeen, false)
        rows.push({ mode, pid: child.pid, exitCode: 0, resultSeen,
          disconnectMs: performance.now() - disconnectStarted })
      }
      assert.equal(child.connected, false)
      assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
    } catch (error) {
      throw new Error(`${mode}: ${error.message}\n${stderr}`, { cause: error })
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      await exited.catch(() => {})
    }
  }
  const summary = { node: process.version, candidateRoot: root, manifestPath,
    verifiedFiles: names.size, verifiedBytes: totalBytes, output, rows,
    scope: 'Extracted GPL-free candidate in signed-Node child IPC; real US/GB synthesis, idle exit, cancellation and idle parent disconnect',
    notVerified: ['production idle timeout and queue', 'active-parent-crash cleanup', 'Desktop renderer playback',
      'licence and production runtime admission'] }
  await fs.writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
}

if (isWorker) await worker()
else await check()
