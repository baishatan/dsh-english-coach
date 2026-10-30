import assert from 'node:assert/strict'
import { promises as fs, createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../index.js'

// Public registered Host route. Only Host services, downloads and the external
// runtime are adapters; readiness still requires all eight real fixed assets.
async function host(t, { directory, runtimeFactory, download } = {}) {
  const base = await fs.realpath(directory ?? await fs.mkdtemp(join(tmpdir(), 'english-coach-audio-')))
  const root = join(base, 'learning'), speechRoot = join(base, 'speech')
  await fs.mkdir(root, { recursive: true })
  const effects = [], intervals = [], events = new Map()
  let route, prompt
  const services = {
    webServer: { register(value) { route = value; return () => { route = null } } },
    systemPrompt: { context(value) { prompt = value; return () => {} } },
    connection: { admit(req) {
      if (req.headers.host !== 'localhost:55418' || (req.headers.origin !== undefined && req.headers.origin !== 'http://localhost:55418')) return { rejection: 403 }
      if (!req.headers.cookie || req.headers.cookie === 'unauthenticated') return { rejection: 401 }
      return { peer: { id: req.headers.cookie === 'other-peer' ? 'other-peer' : 'browser-peer', principal: { kind: req.headers.cookie === 'non-owner' ? 'agent' : 'owner' } } }
    } }
  }
  apply({
    get: name => services[name], tools: { register() { return () => {} } },
    timer: { interval(callback, delay) { intervals.push({ callback, delay }); return () => {} } },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') effects.push(cleanup) },
    on: (name, callback) => events.set(name, callback)
  }, { dataRoot: root, speechRoot, speechDownload: download, speechRuntimeFactory: runtimeFactory })
  for (const { callback } of intervals.filter(value => value.delay === 500)) callback()
  const startupDeadline = Date.now() + 10_000
  while (!prompt?.text()) { assert.ok(Date.now() < startupDeadline, 'isolated Host starts'); await new Promise(resolve => setTimeout(resolve, 5)) }
  async function request(command, payload = {}, { page = 'a'.repeat(48), headers = {}, query = '', method = 'POST' } = {}) {
    const req = Readable.from([JSON.stringify(payload)])
    req.url = `/english-coach/api/${command}${query}`; req.method = method
    req.headers = { host: 'localhost:55418', cookie: 'owner', 'content-type': 'application/json', 'x-english-coach-speech-session': page, ...headers }
    const responseHeaders = {}
    let status, body
    await route.handler(req, { set statusCode(value) { status = value }, setHeader(key, value) { responseHeaders[key.toLowerCase()] = value }, end(value) { body = value } })
    if (responseHeaders['content-type']?.startsWith('audio/')) return { httpStatus: status, headers: responseHeaders, bytes: Buffer.from(body) }
    return { ...JSON.parse(body), httpStatus: status, headers: responseHeaders }
  }
  let disposed = false
  async function dispose() { if (disposed) return; disposed = true; for (const cleanup of effects.reverse()) await cleanup(); await events.get('dispose')?.() }
  t.after(dispose)
  return { base, root, speechRoot, request, dispose, services }
}

async function waitFor(read, accept, label) {
  const deadline = Date.now() + 30_000
  let last
  do {
    last = await read()
    if (accept(last)) return last
    if (last.ok === false || last.data?.phase === 'error') assert.fail(`${label}: ${JSON.stringify(last)}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  } while (Date.now() < deadline)
  assert.fail(`${label} deadline: ${JSON.stringify(last)}`)
}
const realAssets = !process.env.ENGLISH_COACH_TEST_ASSETS && 'Requires explicit verified eight-asset fixture'
async function prepared(t, options = {}) {
  const h = await host(t, { download: (asset, { signal }) => createReadStream(join(process.env.ENGLISH_COACH_TEST_ASSETS, asset.path), { signal }), ...options })
  assert.equal((await h.request('speech.assets.prepare')).ok, true)
  await waitFor(() => h.request('speech.assets.status'), value => value.data?.assetsReady, 'prepare actual assets')
  return h
}

function wav(bytes = 240) {
  const buffer = Buffer.alloc(44 + bytes)
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(3, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(24000, 24); buffer.writeUInt32LE(96000, 28); buffer.writeUInt16LE(4, 32); buffer.writeUInt16LE(32, 34)
  buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40)
  return buffer
}

const sample = { text: 'Hello. Let us practise English together.', voice: 'af_heart', rate: 1 }

test('prepared manual speech returns an owned binary WAV rather than audio in JSON', { skip: realAssets }, async t => {
  let release, entered = false
  const pending = new Promise(resolve => { release = resolve })
  const output = wav()
  const h = await prepared(t, { runtimeFactory: ({ assetRoot }) => {
    assert.ok(assetRoot.startsWith(h.speechRoot + '/'))
    return { async synthesize(input) { entered = true; assert.deepEqual(input, sample); await pending; return output }, async dispose() {} }
  } })
  const before = await h.request('settings.get')
  const started = await h.request('speech.synthesize', sample)
  assert.equal(started.data.phase, 'queued')
  await waitFor(() => h.request('speech.status', { taskId: started.data.taskId }), value => entered && value.data?.phase === 'generating', 'generating')
  release()
  const ready = await waitFor(() => h.request('speech.status', { taskId: started.data.taskId }), value => value.data?.phase === 'ready', 'ready WAV')
  assert.doesNotMatch(JSON.stringify(ready), /practise|base64|assetRoot|RIFF/)
  const audio = await h.request('speech.audio', { taskId: started.data.taskId })
  assert.equal(audio.httpStatus, 200)
  assert.equal(audio.headers['content-type'], 'audio/wav')
  assert.equal(audio.headers['cache-control'], 'no-store')
  assert.equal(audio.headers['x-content-type-options'], 'nosniff')
  assert.deepEqual(audio.bytes, output)
  assert.deepEqual((await h.request('settings.get')).data, before.data)
})

test('one Host synthesis lane keeps each page latest without interrupting another page', { skip: realAssets }, async t => {
  const entries = [], pending = []
  let disposals = 0
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(input, { signal }) { entries.push({ ...input, signal }); return new Promise(resolve => pending.push(resolve)) },
    async dispose() { disposals++; for (const resolve of pending.splice(0)) resolve(wav()) }
  }) })
  const first = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: first.data.taskId }), value => value.data?.phase === 'generating', 'first active')
  const other = await h.request('speech.synthesize', { ...sample, text: 'Other page.' }, { page: 'b'.repeat(48) })
  const old = await h.request('speech.synthesize', { ...sample, text: 'Replaced same page.' })
  const latest = await h.request('speech.synthesize', { ...sample, text: 'Latest same page.' })
  assert.equal(entries.length, 1, 'a second page does not start a parallel runtime')
  assert.equal(entries[0].signal.aborted, true, 'same-page replacement cancels its own active work')
  assert.equal((await h.request('speech.status', { taskId: old.data.taskId })).httpStatus, 404)
  assert.equal((await h.request('speech.audio', { taskId: first.data.taskId })).httpStatus, 404)
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: other.data.taskId }, { page: 'b'.repeat(48) }), value => value.data?.phase === 'generating', 'other page gets FIFO turn')
  assert.equal(entries[1].text, 'Other page.')
  assert.equal(entries[1].signal.aborted, false)
  assert.equal((await h.request('speech.cancel', { taskId: other.data.taskId })).httpStatus, 404)
  assert.equal(entries[1].signal.aborted, false)
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: latest.data.taskId }), value => value.data?.phase === 'generating', 'latest turn')
  assert.equal(entries[2].text, 'Latest same page.')
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: latest.data.taskId }), value => value.data?.phase === 'ready', 'latest ready')
  assert.equal((await h.request('speech.audio', { taskId: first.data.taskId })).httpStatus, 404, 'late cancelled audio never revives')
  await h.dispose()
  assert.equal(disposals, 1, 'Host awaits the one runtime disposal')
})

test('audio reuse is page-private and byte-bounded and oversized WAV output is rejected', { skip: realAssets }, async t => {
  let generations = 0, size = 240
  const h = await prepared(t, { runtimeFactory: () => ({ async synthesize() { generations++; return wav(size) }, async dispose() {} }) })
  async function generate(input, page = 'a'.repeat(48)) {
    const job = await h.request('speech.synthesize', input, { page })
    return waitFor(() => h.request('speech.status', { taskId: job.data.taskId }, { page }), value => ['ready', 'error'].includes(value.data?.phase), 'generated or rejected')
  }
  const first = await generate(sample)
  const same = await generate(sample)
  assert.equal(same.data.phase, 'ready'); assert.equal(generations, 1, 'same-page same-content replay reuses temporary bytes')
  assert.equal((await h.request('speech.audio', { taskId: first.data.taskId })).httpStatus, 404, 'old task identity never revives')
  await generate(sample, 'b'.repeat(48))
  assert.equal(generations, 2, 'another page cannot share private cache')
  await generate({ ...sample, voice: 'bf_emma' }); await generate({ ...sample, rate: 2 })
  assert.equal(generations, 4, 'voice and rate are cache identity')
  size = 16 * 1024 * 1024
  const large = await generate({ ...sample, text: 'Too big.' })
  assert.equal(large.data.phase, 'error')
  assert.equal(large.data.error.code, 'speech_audio_too_large')
  assert.equal((await h.request('speech.audio', { taskId: large.data.taskId })).ok, false)
  size = 1024 * 1024
  for (let n = 0; n < 18; n++) await generate({ ...sample, text: `Bounded entry ${n}.` })
  const pressure = await generate({ ...sample, text: 'Bounded entry 0.' })
  assert.equal(pressure.data.phase, 'ready')
  assert.equal(generations, 24, '16 MiB owner cap evicts oldest audio even before the global 64 MiB cap')
})

test('global cache pressure, page capacity and task deadlines stay bounded through public handles', { skip: realAssets }, async t => {
  let blocked = false, release, activeSignal, disposeDone = false
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(_input, { signal }) { activeSignal = signal; return blocked ? new Promise(resolve => { release = resolve }) : Promise.resolve(wav(12 * 1024 * 1024)) },
    async dispose() { release?.(wav()); disposeDone = true }
  }) })
  const jobs = []
  for (let n = 0; n < 6; n++) {
    const page = `${n}`.repeat(48)
    const job = await h.request('speech.synthesize', sample, { page })
    await waitFor(() => h.request('speech.status', { taskId: job.data.taskId }, { page }), value => value.data?.phase === 'ready', 'global pressure')
    jobs.push({ page, taskId: job.data.taskId })
  }
  assert.equal((await h.request('speech.audio', { taskId: jobs[0].taskId }, { page: jobs[0].page })).httpStatus, 404, '64 MiB global cap evicts older owned handles')
  blocked = true
  const active = await h.request('speech.synthesize', sample, { page: 'x'.repeat(48) })
  await waitFor(() => h.request('speech.status', { taskId: active.data.taskId }, { page: 'x'.repeat(48) }), value => value.data?.phase === 'generating', 'deadline active')
  for (let n = 0; n < 10; n++) assert.equal((await h.request('speech.synthesize', sample, { page: `queued-${n}`.padEnd(48, 'q') })).ok, true)
  assert.equal((await h.request('speech.synthesize', sample, { page: 'z'.repeat(48) })).code, 'speech_capacity', 'at most 16 outstanding page owners')
  const now = Date.now()
  const clock = t.mock.method(Date, 'now', () => now + 120001)
  assert.equal((await h.request('speech.status', { taskId: active.data.taskId }, { page: 'x'.repeat(48) })).httpStatus, 404)
  assert.equal(activeSignal.aborted, true)
  clock.mock.restore()
  release(wav())
  await h.dispose()
  assert.equal(disposeDone, true)
})

test('public Host uses the real packaged runtime and a restarted Host reuses prepared assets offline', { skip: realAssets, timeout: 120000 }, async t => {
  const h = await prepared(t)
  const status = await h.request('speech.assets.status')
  assert.equal(status.data.runtimeAvailable, true)
  const settings = await h.request('settings.get')
  const records = []
  async function generate(current, voice, rate) {
    const startedAt = performance.now()
    const job = await current.request('speech.synthesize', { text: 'Opportunity.', voice, rate })
    assert.equal(job.data.phase, 'queued')
    await waitFor(() => current.request('speech.status', { taskId: job.data.taskId }), value => value.data?.phase === 'ready', `real runtime ${voice} ${rate}`)
    const audio = await current.request('speech.audio', { taskId: job.data.taskId })
    assert.equal(audio.httpStatus, 200)
    assert.equal(audio.bytes.toString('ascii', 0, 4), 'RIFF')
    assert.equal(audio.bytes.readUInt16LE(20), 3)
    assert.equal(audio.bytes.readUInt16LE(22), 1)
    assert.equal(audio.bytes.readUInt32LE(24), 24000)
    assert.equal(audio.bytes.readUInt32LE(40), audio.bytes.length - 44)
    let peak = 0
    for (let n = 44; n < audio.bytes.length; n += 4) {
      const value = audio.bytes.readFloatLE(n)
      assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value))
    }
    assert.ok(peak > 0.00001)
    records.push({ voice, rate, bytes: audio.bytes.length, peak, elapsedMs: Math.round(performance.now() - startedAt) })
    return job.data.taskId
  }
  const oldTask = await generate(h, 'af_heart', 1)
  await generate(h, 'am_michael', 0.5)
  await generate(h, 'bf_emma', 1.5)
  await generate(h, 'bm_george', 2)
  assert.deepEqual((await h.request('settings.get')).data, settings.data)
  await h.dispose()
  const reboot = await host(t, { directory: h.base, download() { assert.fail('restarted synthesis must not download') } })
  assert.equal((await reboot.request('speech.status', { taskId: oldTask })).httpStatus, 404)
  assert.equal((await reboot.request('speech.assets.status')).data.assetsReady, true)
  await generate(reboot, 'bf_emma', 1)
  assert.deepEqual((await reboot.request('settings.get')).data, settings.data)
  t.diagnostic(JSON.stringify({ actualPublicHostWav: records }))
})

test('all speech operations fail closed and reject paths, invalid voices, oversized text and cross-page handles', async t => {
  const h = await host(t)
  const started = await h.request('speech.synthesize', sample)
  const taskId = started.data.taskId
  for (const command of ['speech.synthesize', 'speech.status', 'speech.cancel', 'speech.audio', 'speech.unknown']) {
    const payload = command === 'speech.synthesize' ? sample : { taskId }
    for (const [headers, status] of [[{ cookie: undefined }, 401], [{ cookie: 'non-owner' }, 403], [{ origin: 'https://foreign.example' }, 403], [{ 'content-type': 'text/plain' }, 403], [{ 'x-english-coach-speech-session': '' }, 403]]) {
      assert.equal((await h.request(command, payload, { headers })).httpStatus, status, command)
    }
    assert.equal((await h.request(command, payload, { query: '?path=/etc/passwd' })).httpStatus, 403)
  }
  for (const payload of [{ ...sample, path: '/tmp/private' }, { ...sample, voice: '../private' }, { ...sample, rate: 1.2 }, { ...sample, text: 'a'.repeat(401) }, { ...sample, text: '' }, { ...sample, text: 'hello\u0000' }, { ...sample, text: '中文' }, null, []]) {
    assert.equal((await h.request('speech.synthesize', payload)).httpStatus, 400)
  }
  assert.equal((await h.request('speech.synthesize', { ...sample, text: 'a'.repeat(6000) })).httpStatus, 413)
  for (const command of ['speech.status', 'speech.cancel', 'speech.audio']) {
    assert.equal((await h.request(command, { taskId }, { page: 'b'.repeat(48) })).httpStatus, 404)
    assert.equal((await h.request(command, { taskId }, { headers: { cookie: 'other-peer' } })).httpStatus, 404)
    assert.equal((await h.request(command, { taskId, path: '/etc/passwd' })).httpStatus, 400)
  }
  delete h.services.connection
  assert.equal((await h.request('speech.status', { taskId })).httpStatus, 503)
})

test('a manual synthesis request returns immediately without preparing or loading absent assets', async t => {
  let runtimeCalls = 0, downloads = 0
  const h = await host(t, { runtimeFactory() { runtimeCalls++; assert.fail('unprepared must not construct a runtime') }, download() { downloads++; assert.fail('synthesis never prepares assets') } })
  const learningBefore = await fs.readdir(h.root)
  const response = await h.request('speech.synthesize', sample)
  assert.equal(response.ok, true)
  assert.equal(response.data.phase, 'queued')
  assert.match(response.data.taskId, /^[a-f0-9-]{36}$/)
  const failed = await waitFor(() => h.request('speech.status', { taskId: response.data.taskId }), value => value.data?.phase === 'error', 'missing assets')
  assert.equal(failed.data.error.code, 'ASSETS_NOT_READY')
  assert.doesNotMatch(JSON.stringify(failed), /practise|learning|speechRoot/)
  assert.equal(runtimeCalls, 0); assert.equal(downloads, 0)
  assert.deepEqual(await fs.readdir(h.root), learningBefore)
  await assert.rejects(fs.access(h.speechRoot), { code: 'ENOENT' })
})
