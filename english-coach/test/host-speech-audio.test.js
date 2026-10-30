import assert from 'node:assert/strict'
import { promises as fs, createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { apply } from '../index.js'
import { execute } from '../core/index.js'

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

test('confirmed global deletion invalidates both slots across pages and awaits actual runtime disposal', { skip: realAssets }, async t => {
  let finishGeneration, finishDispose, entered = false, disposing = false, downloads = 0
  const generating = new Promise(resolve => { finishGeneration = resolve })
  const disposal = new Promise(resolve => { finishDispose = resolve; setTimeout(resolve, 1000).unref() })
  const entries = []
  const h = await prepared(t, { download: (asset, { signal }) => {
    downloads++; return createReadStream(join(process.env.ENGLISH_COACH_TEST_ASSETS, asset.path), { signal })
  }, runtimeFactory: () => ({
    async synthesize(input, { signal }) { entries.push({ input, signal }); if (entries.length > 1) { entered = true; await generating }; return wav() },
    async dispose() { disposing = true; finishGeneration(); await disposal }
  }) })
  const a = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: a.data.taskId }), value => value.data?.phase === 'ready', 'delivered foreground')
  assert.equal((await h.request('speech.audio', { taskId: a.data.taskId })).httpStatus, 200)
  const prefetch = await h.request('speech.synthesize', { ...sample, text: 'Upcoming.', priority: 'prefetch' })
  await waitFor(() => h.request('speech.status', { taskId: prefetch.data.taskId }), value => entered, 'active speculative work')
  const pageB = { page: 'b'.repeat(48) }
  const b = await h.request('speech.synthesize', { ...sample, text: 'Other page waiting.' }, pageB)
  let completed = false
  const removed = h.request('speech.assets.delete', {}, pageB).then(value => { completed = true; return value })
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(disposing, true, 'confirmed global deletion actually disposes the shared runtime')
  assert.equal(completed, false, 'the response waits for actual disposal')
  for (const [job, page] of [[a, {}], [prefetch, {}], [b, pageB]]) {
    assert.equal((await h.request('speech.status', { taskId: job.data.taskId }, page)).httpStatus, 404)
    assert.equal((await h.request('speech.audio', { taskId: job.data.taskId }, page)).httpStatus, 404)
  }
  assert.equal(entries.at(-1).signal.aborted, true)
  assert.equal((await h.request('speech.synthesize', sample)).code, 'speech_assets_changing')
  finishDispose()
  assert.equal((await removed).data.phase, 'unprepared')
  assert.deepEqual(await fs.readdir(h.speechRoot), [])
  assert.deepEqual((await h.request('speech.session.touch')).data, { active: false, leaseMs: 15000, assetsReady: false, resourceGeneration: null })
  const after = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: after.data.taskId }), value => value.data?.phase === 'error', 'manual playback after deletion').catch(cause => {
    // waitFor rejects terminal errors by default; this branch is not used when
    // the accept predicate has observed the expected unavailable state.
    throw cause
  })
  assert.equal((await h.request('speech.status', { taskId: after.data.taskId })).data.error.code, 'ASSETS_NOT_READY')
  assert.equal(downloads, 8)
  assert.equal(entries.length, 2, 'late work never launches the queued page')
})

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

test('hot page latest clicks yield a round to both waiting pages after the current block', { skip: realAssets }, async t => {
  const entries = [], pending = []
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(input, { signal }) { entries.push({ ...input, signal }); return new Promise(resolve => pending.push(resolve)) },
    async dispose() { for (const resolve of pending.splice(0)) resolve(wav()) }
  }) })
  const pageA = { page: 'a'.repeat(48) }, pageB = { page: 'b'.repeat(48) }, pageC = { page: 'c'.repeat(48) }
  const status = (job, page) => h.request('speech.status', { taskId: job.data.taskId }, page)
  const a = await h.request('speech.synthesize', { ...sample, text: 'A current.' }, pageA)
  await waitFor(() => status(a, pageA), value => value.data?.phase === 'generating', 'A current block')
  let latest = await h.request('speech.synthesize', { ...sample, text: 'A latest 0.' }, pageA)
  const b = await h.request('speech.synthesize', { ...sample, text: 'B finite.' }, pageB)
  const c = await h.request('speech.synthesize', { ...sample, text: 'C finite.' }, pageC)
  pending.shift()(wav())
  await waitFor(async () => ({ ok: true, data: { count: entries.length } }), value => value.data.count === 2, 'next page turn')
  assert.equal(entries[1].text, 'B finite.', 'running page goes behind already waiting pages')
  for (let n = 1; n <= 6; n++) latest = await h.request('speech.synthesize', { ...sample, text: `A latest ${n}.` }, pageA)
  assert.equal(entries[1].signal.aborted, false, 'hot A cannot interrupt B')
  pending.shift()(wav())
  await waitFor(async () => ({ ok: true, data: { count: entries.length } }), value => value.data.count === 3, 'C round')
  assert.equal(entries[2].text, 'C finite.')
  for (let n = 7; n <= 12; n++) latest = await h.request('speech.synthesize', { ...sample, text: `A latest ${n}.` }, pageA)
  assert.equal(entries[2].signal.aborted, false, 'hot A cannot interrupt C')
  pending.shift()(wav())
  await waitFor(() => status(latest, pageA), value => value.data?.phase === 'generating', 'only latest A')
  assert.deepEqual(entries.map(value => value.text), ['A current.', 'B finite.', 'C finite.', 'A latest 12.'])
  pending.shift()(wav())
  await waitFor(() => status(latest, pageA), value => value.data?.phase === 'ready', 'latest A ready')
  for (const [job, page] of [[b, pageB], [c, pageC]]) assert.equal((await h.request('speech.audio', { taskId: job.data.taskId }, page)).httpStatus, 200)
})

test('replacing a queued page keeps its fair place while only its latest click can run', { skip: realAssets }, async t => {
  const entries = [], pending = []
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(input) { entries.push(input.text); return new Promise(resolve => pending.push(resolve)) },
    async dispose() { for (const resolve of pending.splice(0)) resolve(wav()) }
  }) })
  const blockerPage = { page: 'c'.repeat(48) }, otherPage = { page: 'b'.repeat(48) }
  const blocker = await h.request('speech.synthesize', { ...sample, text: 'Current small block.' }, blockerPage)
  await waitFor(() => h.request('speech.status', { taskId: blocker.data.taskId }, blockerPage), value => value.data?.phase === 'generating', 'current small block')
  const old = await h.request('speech.synthesize', { ...sample, text: 'A old.' })
  const other = await h.request('speech.synthesize', { ...sample, text: 'B waiting.' }, otherPage)
  const latest = await h.request('speech.synthesize', { ...sample, text: 'A latest.' })
  assert.equal((await h.request('speech.status', { taskId: old.data.taskId })).httpStatus, 404)
  pending.shift()(wav())
  await waitFor(async () => ({ ok: true, data: { count: entries.length } }), value => value.data.count === 2, 'preserved page turn')
  assert.equal(entries[1], 'A latest.', 'changing content does not move a waiting page behind B')
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: other.data.taskId }, otherPage), value => value.data?.phase === 'generating', 'B finite turn')
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: latest.data.taskId }), value => value.data?.phase === 'ready', 'latest ready')
  assert.deepEqual(entries, ['Current small block.', 'A latest.', 'B waiting.'])
})

test('public page release reclaims only admitted ownership and awaits the last runtime shutdown', { skip: realAssets }, async t => {
  const entries = [], pending = []
  let disposals = 0, finishDispose, holdDispose = false
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(input, { signal }) { entries.push({ ...input, signal }); return new Promise(resolve => pending.push(resolve)) },
    async dispose() {
      disposals++; for (const resolve of pending.splice(0)) resolve(wav())
      if (holdDispose) await new Promise(resolve => { const fallback = setTimeout(resolve, 1000); finishDispose = () => { clearTimeout(fallback); resolve() } })
    }
  }) })
  const otherPage = { page: 'b'.repeat(48) }
  const current = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: current.data.taskId }), value => value.data?.phase === 'generating', 'A foreground')
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: current.data.taskId }), value => value.data?.phase === 'ready', 'A ready')
  await h.request('speech.audio', { taskId: current.data.taskId })
  const other = await h.request('speech.synthesize', { ...sample, text: 'B continues.' }, otherPage)
  await waitFor(() => h.request('speech.status', { taskId: other.data.taskId }, otherPage), value => value.data?.phase === 'generating', 'B running')
  const next = await h.request('speech.synthesize', { ...sample, text: 'A upcoming.', priority: 'prefetch' })
  const released = await h.request('speech.session.release')
  assert.equal(released.ok, true, 'pagehide can release both slots through the public Host command')
  for (const job of [current, next]) assert.equal((await h.request('speech.status', { taskId: job.data.taskId })).httpStatus, 404)
  assert.equal(disposals, 0, 'another active page keeps its runtime')
  assert.equal(entries[1].signal.aborted, false)
  for (const payload of [{ owner: `browser-peer:${otherPage.page}` }, { page: otherPage.page }, { taskId: other.data.taskId }, null, []]) {
    assert.equal((await h.request('speech.session.release', payload)).httpStatus, 400, 'JSON cannot nominate another page')
  }
  assert.equal((await h.request('speech.session.release', {}, { page: otherPage.page, headers: { cookie: 'other-peer' } })).ok, true)
  assert.equal((await h.request('speech.session.release', {}, { page: 'f'.repeat(48) })).ok, true, 'unknown random identity cannot release B')
  assert.equal(entries[1].signal.aborted, false)
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: other.data.taskId }, otherPage), value => value.data?.phase === 'ready', 'B survives A close')
  assert.equal((await h.request('speech.audio', { taskId: other.data.taskId }, otherPage)).httpStatus, 200)
  let finished = false
  holdDispose = true
  const last = h.request('speech.session.release', {}, otherPage).then(value => { finished = true; return value })
  await waitFor(async () => ({ ok: true, data: { disposals } }), value => value.data.disposals === 1, 'last runtime shutdown')
  assert.equal(finished, false, 'release must await actual runtime termination')
  finishDispose()
  assert.equal((await last).ok, true)
  assert.equal((await h.request('speech.audio', { taskId: other.data.taskId }, otherPage)).httpStatus, 404)
  assert.equal((await h.request('speech.assets.status')).data.assetsReady, true, 'persistent assets remain prepared')
  assert.equal((await h.request('speech.session.release')).ok, true, 'release is idempotent')
})

test('unreachable page leases expire without releasing another page that is still active', { skip: realAssets }, async t => {
  const entries = [], pending = []
  let disposals = 0
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(input, { signal }) { entries.push({ ...input, signal }); return new Promise(resolve => pending.push(resolve)) },
    async dispose() { disposals++; for (const resolve of pending.splice(0)) resolve(wav()) }
  }) })
  const a = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: a.data.taskId }), value => value.data?.phase === 'generating', 'A leased block')
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: a.data.taskId }), value => value.data?.phase === 'ready', 'A retained audio')
  await h.request('speech.audio', { taskId: a.data.taskId })
  const pageB = { page: 'b'.repeat(48) }
  const b = await h.request('speech.synthesize', { ...sample, text: 'B remains connected.' }, pageB)
  await waitFor(() => h.request('speech.status', { taskId: b.data.taskId }, pageB), value => value.data?.phase === 'generating', 'B leased block')
  const now = Date.now()
  let elapsed = 10_000
  const clock = t.mock.method(Date, 'now', () => now + elapsed)
  assert.equal((await h.request('speech.status', { taskId: b.data.taskId }, pageB)).data.phase, 'generating')
  elapsed = 15_001
  assert.equal((await h.request('speech.audio', { taskId: a.data.taskId })).httpStatus, 404, 'lost close request has a bounded owner lease')
  assert.equal(entries[1].signal.aborted, false, 'A lease expiry cannot cancel active B')
  assert.equal(disposals, 0)
  elapsed = 25_002
  assert.equal((await h.request('speech.status', { taskId: b.data.taskId }, pageB)).httpStatus, 404)
  assert.equal(entries[1].signal.aborted, true)
  await waitFor(async () => ({ ok: true, data: { disposals } }), value => value.data.disposals === 1, 'expired last page runtime reclaimed')
  clock.mock.restore()
  assert.equal((await h.request('speech.assets.status')).data.assetsReady, true)
})

test('active page heartbeat exposes only resource identity and never extends absolute audio TTL', { skip: realAssets }, async t => {
  let disposals = 0
  const h = await prepared(t, { runtimeFactory: () => ({ async synthesize() { return wav() }, async dispose() { disposals++ } }) })
  const job = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: job.data.taskId }), value => value.data?.phase === 'ready', 'leased audio ready')
  await h.request('speech.audio', { taskId: job.data.taskId })
  const generation = (await h.request('speech.assets.status')).data.resourceGeneration
  const initial = await h.request('speech.session.touch')
  assert.equal(initial.ok, true, 'active media can renew its own lease without reading learning data')
  assert.deepEqual(initial.data, { active: true, leaseMs: 15_000, assetsReady: true, resourceGeneration: generation })
  assert.equal((await h.request('speech.session.touch', {}, { page: 'c'.repeat(48) })).data.active, false)
  assert.equal((await h.request('speech.session.touch', {}, { headers: { cookie: 'other-peer' } })).data.active, false)
  assert.doesNotMatch(JSON.stringify(initial.data), /text|taskId|owner|path|Hello/)
  const now = Date.now()
  let elapsed = 0
  const clock = t.mock.method(Date, 'now', () => now + elapsed)
  for (elapsed = 10_000; elapsed <= 110_000; elapsed += 10_000) assert.equal((await h.request('speech.session.touch')).data.active, true)
  elapsed = 120_001
  assert.equal((await h.request('speech.session.touch')).data.active, false, 'heartbeat does not keep old audio or owners alive beyond task TTL')
  assert.equal((await h.request('speech.audio', { taskId: job.data.taskId })).httpStatus, 404)
  assert.equal(disposals, 1)
  clock.mock.restore()
  for (const command of ['speech.session.touch', 'speech.session.release']) {
    for (const [headers, status] of [[{ cookie: undefined }, 401], [{ cookie: 'non-owner' }, 403], [{ origin: 'https://foreign.example' }, 403], [{ 'content-type': 'text/plain' }, 403], [{ 'x-english-coach-speech-session': '' }, 403]]) assert.equal((await h.request(command, {}, { headers })).httpStatus, status)
    assert.equal((await h.request(command, { page: 'b'.repeat(48) })).httpStatus, 400)
    assert.equal((await h.request(command, {}, { query: '?owner=someone' })).httpStatus, 403)
    assert.equal((await h.request(command, { padding: 'x'.repeat(4096) })).httpStatus, 413)
  }
})

test('a new page waits for last-page reclamation and cannot reuse a stopping runtime', { skip: realAssets }, async t => {
  let factories = 0, finishDispose
  const h = await prepared(t, { runtimeFactory: () => {
    factories++
    return { async synthesize() { return wav() }, async dispose() { await new Promise(resolve => { const fallback = setTimeout(resolve, 1000); finishDispose = () => { clearTimeout(fallback); resolve() } }) } }
  } })
  const first = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: first.data.taskId }), value => value.data?.phase === 'ready', 'first owner ready')
  const releasing = h.request('speech.session.release')
  await waitFor(async () => ({ ok: true, data: { started: !!finishDispose } }), value => value.data.started, 'worker stopping')
  const pageB = { page: 'b'.repeat(48) }
  const early = await h.request('speech.synthesize', { ...sample, text: 'New page during release.' }, pageB)
  assert.equal(early.code, 'speech_assets_changing')
  assert.equal(factories, 1)
  finishDispose(); await releasing
  const next = await h.request('speech.synthesize', { ...sample, text: 'New page after release.' }, pageB)
  await waitFor(() => h.request('speech.status', { taskId: next.data.taskId }, pageB), value => value.data?.phase === 'ready', 'new runtime after actual shutdown')
  assert.equal(factories, 2)
  assert.equal((await h.request('speech.audio', { taskId: first.data.taskId })).httpStatus, 404)
})

test('lease-triggered reclamation rejects a fresh page until actual shutdown finishes', { skip: realAssets }, async t => {
  let finishDispose, held = false
  const h = await prepared(t, { runtimeFactory: () => ({
    async synthesize() { return wav() },
    async dispose() { if (held) await new Promise(resolve => { const fallback = setTimeout(resolve, 1000); finishDispose = () => { clearTimeout(fallback); resolve() } }) }
  }) })
  const first = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: first.data.taskId }), value => value.data?.phase === 'ready', 'lease owner ready')
  held = true
  const now = Date.now(), clock = t.mock.method(Date, 'now', () => now + 15_001)
  const next = await h.request('speech.synthesize', { ...sample, text: 'New owner at expired lease.' }, { page: 'b'.repeat(48) })
  assert.equal(next.code, 'speech_assets_changing', 'a lease expiry must recheck admission after it starts asynchronous runtime shutdown')
  finishDispose(); clock.mock.restore()
})

test('bounded article prefetch retains delivered foreground audio and yields to queued foreground work', { skip: realAssets }, async t => {
  const entries = [], pending = []
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(input, { signal }) { entries.push({ ...input, signal }); return new Promise(resolve => pending.push(resolve)) },
    async dispose() { for (const resolve of pending.splice(0)) resolve(wav()) }
  }) })
  const status = job => h.request('speech.status', { taskId: job.data.taskId })
  const first = await h.request('speech.synthesize', sample)
  await waitFor(() => status(first), value => value.data?.phase === 'generating', 'first foreground')
  const premature = await h.request('speech.synthesize', { ...sample, text: 'Next sentence.', priority: 'prefetch' })
  assert.equal(premature.code, 'speech_not_ready', 'prefetch cannot replace an undelivered foreground task')
  pending.shift()(wav())
  await waitFor(() => status(first), value => value.data?.phase === 'ready', 'first ready')
  assert.equal((await h.request('speech.audio', { taskId: first.data.taskId })).httpStatus, 200)
  const otherPage = { page: 'b'.repeat(48) }
  const other = await h.request('speech.synthesize', { ...sample, text: 'Other foreground.' }, otherPage)
  await waitFor(() => h.request('speech.status', { taskId: other.data.taskId }, otherPage), value => value.data?.phase === 'generating', 'other active')
  const oldPrefetch = await h.request('speech.synthesize', { ...sample, text: 'Old upcoming sentence.', priority: 'prefetch' })
  assert.equal(oldPrefetch.ok, true)
  const next = await h.request('speech.synthesize', { ...sample, text: 'Next sentence.', priority: 'prefetch' })
  assert.equal(next.ok, true)
  assert.equal((await status(oldPrefetch)).httpStatus, 404, 'only one upcoming task per page')
  assert.equal((await h.request('speech.audio', { taskId: first.data.taskId })).httpStatus, 200, 'prefetch never steals foreground audio')
  const queuedPage = { page: 'c'.repeat(48) }
  const foreground = await h.request('speech.synthesize', { ...sample, text: 'Queued foreground.', priority: 'foreground' }, queuedPage)
  pending.shift()(wav())
  await waitFor(() => h.request('speech.status', { taskId: foreground.data.taskId }, queuedPage), value => value.data?.phase === 'generating', 'foreground before prefetch')
  assert.equal(entries.at(-1).text, 'Queued foreground.')
  pending.shift()(wav())
  await waitFor(() => status(next), value => value.data?.phase === 'generating', 'one upcoming turn')
  assert.equal(entries.at(-1).text, 'Next sentence.')
  const short = await h.request('speech.synthesize', { ...sample, text: 'apple' })
  assert.equal(entries.at(-1).signal.aborted, true, 'a short click cancels only its own prefetch')
  assert.equal((await status(next)).httpStatus, 404)
  assert.equal((await status(first)).httpStatus, 404)
  assert.equal((await h.request('speech.audio', { taskId: other.data.taskId }, otherPage)).httpStatus, 200)
  pending.shift()(wav())
  await waitFor(() => status(short), value => value.data?.phase === 'generating', 'short after cancelled work')
  pending.shift()(wav())
  await waitFor(() => status(short), value => value.data?.phase === 'ready', 'short ready')
  for (const priority of ['background', true, null, 1]) assert.equal((await h.request('speech.synthesize', { ...sample, priority })).httpStatus, 400)
})

test('cancelling a repeated-text prefetch cannot evict the delivered foreground audio', { skip: realAssets }, async t => {
  let generations = 0
  const h = await prepared(t, { runtimeFactory: () => ({ async synthesize() { generations++; return wav() }, async dispose() {} }) })
  const foreground = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: foreground.data.taskId }), value => value.data?.phase === 'ready', 'repeated foreground ready')
  assert.equal((await h.request('speech.audio', { taskId: foreground.data.taskId })).httpStatus, 200)
  const prefetch = await h.request('speech.synthesize', { ...sample, priority: 'prefetch' })
  await waitFor(() => h.request('speech.status', { taskId: prefetch.data.taskId }), value => value.data?.phase === 'ready', 'repeated prefetch ready')
  assert.equal(generations, 1, 'a repeated next sentence reuses the one private cache entry')
  assert.equal((await h.request('speech.cancel', { taskId: prefetch.data.taskId })).ok, true)
  assert.equal((await h.request('speech.audio', { taskId: foreground.data.taskId })).httpStatus, 200, 'canceling speculation leaves the real foreground handle usable')
  assert.equal((await h.request('speech.status', { taskId: prefetch.data.taskId })).httpStatus, 404)
})

test('an explicit resource replacement invalidates both article slots and regenerates the next foreground', { skip: realAssets }, async t => {
  let generations = 0, disposals = 0
  const h = await prepared(t, { runtimeFactory: () => ({ async synthesize() { generations++; return wav() }, async dispose() { disposals++ } }) })
  const current = await h.request('speech.synthesize', sample)
  await waitFor(() => h.request('speech.status', { taskId: current.data.taskId }), value => value.data?.phase === 'ready', 'article before repair')
  assert.equal((await h.request('speech.audio', { taskId: current.data.taskId })).httpStatus, 200)
  const next = await h.request('speech.synthesize', { ...sample, text: 'The next sentence.', priority: 'prefetch' })
  const prefetched = await waitFor(() => h.request('speech.status', { taskId: next.data.taskId }), value => value.data?.phase === 'ready', 'prefetch before repair')
  assert.equal((await h.request('speech.assets.repair')).ok, true)
  await waitFor(() => h.request('speech.assets.status'), value => value.data?.phase === 'ready', 'explicit replacement')
  for (const job of [current, next]) {
    assert.equal((await h.request('speech.status', { taskId: job.data.taskId })).httpStatus, 404)
    assert.equal((await h.request('speech.audio', { taskId: job.data.taskId })).httpStatus, 404)
  }
  assert.equal(disposals, 1)
  const replay = await h.request('speech.synthesize', { ...sample, text: 'The next sentence.' })
  const ready = await waitFor(() => h.request('speech.status', { taskId: replay.data.taskId }), value => value.data?.phase === 'ready', 'new generation foreground')
  assert.notEqual(ready.data.resourceGeneration, prefetched.data.resourceGeneration)
  assert.equal(generations, 3, 'the old private prefetch is not reused across resource installation generations')
  assert.equal((await h.request('speech.audio', { taskId: replay.data.taskId })).httpStatus, 200)
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

test('two visible clients share the actual Host adapter but never share media, status, errors or close ownership', { skip: realAssets }, async t => {
  const { mountClient } = await import('./client-harness.js')
  const entries = [], pending = [], requests = [], responses = [], inFlight = new Set()
  let disposals = 0, uiA, uiB
  t.after(async () => { await uiB?.close(); await uiA?.close(); await Promise.all([...inFlight]) })
  const h = await prepared(t, { runtimeFactory: () => ({
    synthesize(input, { signal }) { entries.push({ ...input, signal }); return new Promise((resolve, reject) => pending.push({ resolve, reject })) },
    async dispose() { disposals++; for (const value of pending.splice(0)) value.resolve(wav()) }
  }) })
  const now = new Date(), date = now.toLocaleDateString('en-CA')
  const run = (command, payload) => execute(h.root, command, payload, { now })
  assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  assert.equal((await run('settings.save', { audio: { provider: 'kokoro', kokoroVoice: 'af_heart', rate: 1 } })).ok, true)
  assert.equal((await run('lesson.save', { date, title: '多页非个人材料', sources: [{ id: 'synthetic', url: 'https://example.com/shared-host', fetchedAt: now.toISOString(), license: 'Synthetic test text' }], items: [
    { id: 'read', type: 'reading', sourceId: 'synthetic', body: 'A quiet bird landed. It rested by the river.' },
    { id: 'listen', type: 'listening', sourceId: 'synthetic', transcript: 'B takes a train. It arrives at noon.' },
    { id: 'express', type: 'expressions', expressions: [{ term: 'take a train', meaning: '乘火车' }] },
    { id: 'quiz', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['甲', '乙', '丙', '丁'], answerIndex: 0 }] }
  ] })).ok, true)
  assert.equal((await run('lesson.start', { date })).ok, true)
  const learningBefore = (await run('state.get')).data, settingsBefore = (await run('settings.get')).data
  function client() {
    const media = [], urls = []
    return { media, urls, setupWindow(window) {
      window.URL.createObjectURL = blob => { const url = `blob:client-${urls.length}`; urls.push({ url, blob }); return url }
      window.URL.revokeObjectURL = () => {}
      window.Audio = class {
        constructor() { this.src = ''; media.push(this) }
        play() { return Promise.resolve() }
        pause() {}
        removeAttribute(name) { if (name === 'src') this.src = '' }
        load() {}
      }
    }, request(command, payload, options) {
      const page = options.headers['x-english-coach-speech-session']
      requests.push({ command, payload, page, options })
      const task = h.request(command, payload, { page }).then(value => {
        responses.push({ command, page, value })
        return value.bytes ? new Response(value.bytes, { status: value.httpStatus, headers: value.headers }) : value
      })
      inFlight.add(task); task.then(() => inFlight.delete(task), () => inFlight.delete(task)); return task
    } }
  }
  const a = client(), b = client()
  uiA = await mountClient(a); uiB = await mountClient(b)
  async function settle(ui) { await ui.flush(async () => { while (inFlight.size) await Promise.all([...inFlight]) }) }
  const article = ui => ui.container.querySelector('.ec-item-body')
  async function pollUntil(ui, accept, label) {
    const deadline = Date.now() + 10000
    while (!accept()) { assert.ok(Date.now() < deadline, label); await ui.poll(); await settle(ui); await new Promise(resolve => setTimeout(resolve, 5)) }
  }
  await settle(uiA); await settle(uiB)
  await uiA.click('播放'); await settle(uiA)
  await pollUntil(uiA, () => /生成/.test(article(uiA).textContent), 'A visible generating')
  const listenRow = [...uiB.container.querySelectorAll('.ec-li')].find(value => value.textContent.includes('听力'))
  assert.ok(listenRow, 'the second client can open its listening article')
  await uiB.click(listenRow); await settle(uiB)
  await uiB.click('播放'); await settle(uiB)
  assert.match(article(uiB).textContent, /排队/)
  assert.doesNotMatch(article(uiB).textContent, /播放中/)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].signal.aborted, false, 'B cannot interrupt A')
  const front = requests.filter(value => value.command === 'speech.synthesize' && !value.payload.priority)
  assert.notEqual(front[0].page, front[1].page)
  assert.match(front[0].page, /^[a-f0-9]{48}$/)
  pending.shift().reject(Object.assign(new Error('synthetic external limit'), { code: 'TEXT_TOO_LONG' }))
  await pollUntil(uiA, () => /超过本地合成上限/.test(article(uiA).textContent), 'A own error')
  await pollUntil(uiB, () => /生成/.test(article(uiB).textContent), 'B own generating')
  assert.doesNotMatch(article(uiB).textContent, /超过本地合成上限/)
  assert.equal(entries[1].text, 'B takes a train.')
  pending.shift().resolve(wav())
  await pollUntil(uiB, () => b.media.length === 1, 'B receives only its own media')
  await uiB.flush(() => b.media[0].onplaying())
  assert.match(article(uiB).textContent, /播放中/)
  assert.equal(a.media.length, 0)
  const beforePoll = requests.length
  await uiB.poll(); await settle(uiB)
  assert.ok(requests.slice(beforePoll).some(value => value.command === 'speech.session.touch'))
  await uiA.close(); await settle(uiB)
  assert.match(article(uiB).textContent, /播放中/)
  assert.notEqual(b.media[0].src, '')
  assert.equal(disposals, 0)
  assert.ok(entries.filter(value => value.text.startsWith('It arrives')).every(value => !value.signal.aborted))
  const bJob = responses.find(value => value.command === 'speech.synthesize' && value.page === front[1].page).value.data.taskId
  assert.equal((await h.request('speech.audio', { taskId: bJob }, { page: front[0].page })).httpStatus, 404)
  await uiB.close(); await settle(uiA)
  assert.equal(disposals, 1)
  assert.equal(b.media[0].src, '')
  const final = (await run('state.get')).data
  assert.deepEqual(final.todayLesson, learningBefore.todayLesson)
  assert.deepEqual(final.review, learningBefore.review)
  assert.deepEqual((await run('settings.get')).data, settingsBefore)
})

test('two actual Host pages use one CPU worker and closing one leaves the other ready before final process reclamation', { skip: realAssets, timeout: 120000 }, async t => {
  // Observe only the real external fork: no runtime factory, fake process,
  // injected worker, IPC result, resource counters or memory substitutions.
  const childProcess = createRequire(import.meta.url)('node:child_process')
  const originalFork = childProcess.fork, children = []
  let live = 0, maxLive = 0
  childProcess.fork = (...args) => {
    const child = originalFork(...args)
    if (String(args[0]).endsWith('/speech/worker.js')) {
      const row = { child, pid: child.pid, closed: false }
      children.push(row); live++; maxLive = Math.max(maxLive, live)
      child.once('exit', () => { live--; row.exited = true })
      child.once('disconnect', () => { row.disconnected = true })
      child.once('close', () => { row.closed = true })
    }
    return child
  }
  syncBuiltinESMExports()
  let h
  try {
    h = await prepared(t)
    const before = (await h.request('settings.get')).data
    const pageB = { page: 'b'.repeat(48) }, startedAt = performance.now()
    const a = await h.request('speech.synthesize', { ...sample, text: 'A quiet bird.' })
    const b = await h.request('speech.synthesize', { ...sample, text: 'B takes a train.' }, pageB)
    const records = []
    await waitFor(async () => {
      const [one, two] = await Promise.all([
        h.request('speech.status', { taskId: a.data.taskId }),
        h.request('speech.status', { taskId: b.data.taskId }, pageB)
      ])
      assert.ok(one.ok && two.ok)
      assert.equal([one, two].filter(value => value.data.phase === 'generating').length <= 1, true)
      for (const value of [one, two]) if (value.data.phase === 'error') assert.fail(JSON.stringify(value))
      return { ok: true, data: { ready: one.data.phase === 'ready' && two.data.phase === 'ready' } }
    }, value => value.data.ready, 'two real CPU pages')
    for (const [job, page] of [[a, {}], [b, pageB]]) {
      const audio = await h.request('speech.audio', { taskId: job.data.taskId }, page)
      assert.equal(audio.httpStatus, 200); assert.equal(audio.bytes.readUInt32LE(24), 24000)
      let peak = 0
      for (let offset = 44; offset < audio.bytes.length; offset += 4) { const value = audio.bytes.readFloatLE(offset); assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)) }
      assert.ok(peak > 0.00001)
      records.push({ page: page.page ? 'B' : 'A', bytes: audio.bytes.length, peak })
    }
    assert.equal(children.length, 1, 'both pages reuse the same real model process')
    assert.equal(maxLive, 1)
    const worker = children[0]
    await h.request('speech.session.release')
    assert.doesNotThrow(() => process.kill(worker.pid, 0), 'closing A keeps B worker alive')
    assert.equal((await h.request('speech.audio', { taskId: b.data.taskId }, pageB)).httpStatus, 200)
    assert.equal((await h.request('speech.audio', { taskId: a.data.taskId })).httpStatus, 404)
    const cancel = await h.request('speech.synthesize', { ...sample, text: 'The final active page is cancelled.' }, pageB)
    await waitFor(() => h.request('speech.status', { taskId: cancel.data.taskId }, pageB), value => value.data?.phase === 'generating', 'cancel actual active final page')
    await h.request('speech.session.release', {}, pageB)
    assert.ok(worker.exited && worker.disconnected, 'release awaits real process exit and IPC disconnection')
    assert.throws(() => process.kill(worker.pid, 0), { code: 'ESRCH' })
    assert.equal((await h.request('speech.audio', { taskId: cancel.data.taskId }, pageB)).httpStatus, 404)
    assert.equal((await h.request('speech.assets.status')).data.assetsReady, true)
    assert.deepEqual((await h.request('settings.get')).data, before)
    const last = await h.request('speech.synthesize', { ...sample, text: 'Host unload cancels this block.' }, pageB)
    await waitFor(() => h.request('speech.status', { taskId: last.data.taskId }, pageB), value => value.data?.phase === 'generating' && children.length === 2, 'actual worker after released session')
    await h.dispose()
    for (const row of children) assert.throws(() => process.kill(row.pid, 0), { code: 'ESRCH' })
    assert.equal(maxLive, 1, 'last-session reload never overlaps actual heavy workers')
    t.diagnostic(JSON.stringify({ actualTwoPageCpu: { records, pids: children.map(value => value.pid), maxLiveWorkers: maxLive, elapsedMs: Math.round(performance.now() - startedAt), finalReleaseAndHostDisposeExited: true } }))
  } finally {
    await h?.dispose()
    childProcess.fork = originalFork; syncBuiltinESMExports()
  }
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

test('public Host synthesizes a bounded long article clause as finite CPU WAV without changing bookmarks', { skip: realAssets, timeout: 120000 }, async t => {
  const h = await prepared(t)
  const text = 'Along the quiet river, a small team watches the birds and records the changing weather, while another group checks the water and shares its observations with the local school.'
  assert.ok(text.length <= 180)
  const bookmark = { materialId: 'synthetic:long-reading', contentFingerprint: 'synthetic-article-v1', position: 2 }
  assert.equal((await h.request('audio.bookmark.save', bookmark)).ok, true)
  const before = await h.request('audio.bookmark.get', bookmark)
  const startedAt = performance.now()
  const job = await h.request('speech.synthesize', { text, voice: 'af_heart', rate: 1 })
  await waitFor(() => h.request('speech.status', { taskId: job.data.taskId }), value => value.data?.phase === 'ready', 'real bounded article clause')
  const audio = await h.request('speech.audio', { taskId: job.data.taskId })
  assert.equal(audio.httpStatus, 200)
  assert.equal(audio.bytes.readUInt16LE(20), 3)
  assert.equal(audio.bytes.readUInt32LE(24), 24000)
  assert.ok(audio.bytes.length > 44 && audio.bytes.length < 16 * 1024 * 1024)
  let peak = 0
  for (let n = 44; n < audio.bytes.length; n += 4) { const value = audio.bytes.readFloatLE(n); assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)) }
  assert.ok(peak > 0.00001)
  const artifact = join(h.base, 'bounded-article-heart-1.wav')
  await fs.writeFile(artifact, audio.bytes)
  assert.deepEqual((await h.request('audio.bookmark.get', bookmark)).data, before.data)
  t.diagnostic(JSON.stringify({ actualCpuArticle: { text, characters: text.length, voice: 'af_heart', rate: 1, bytes: audio.bytes.length, peak, elapsedMs: Math.round(performance.now() - startedAt), artifact } }))
})

test('failed replacement keeps the compatible installation usable by the actual public Host runtime', { skip: realAssets, timeout: 120000 }, async t => {
  let mode = 'normal', downloads = 0
  const h = await prepared(t, { download(asset, { signal }) {
    downloads++
    if (mode === 'offline') throw new Error('isolated replacement is offline')
    return createReadStream(join(process.env.ENGLISH_COACH_TEST_ASSETS, asset.path), { signal })
  } })
  const original = (await h.request('speech.assets.status')).data
  const settings = await h.request('settings.get')
  async function synthesize(text) {
    const job = await h.request('speech.synthesize', { text, voice: 'af_heart', rate: 1 })
    await waitFor(() => h.request('speech.status', { taskId: job.data.taskId }), value => value.data?.phase === 'ready', text)
    const audio = await h.request('speech.audio', { taskId: job.data.taskId })
    assert.equal(audio.httpStatus, 200)
    let peak = 0
    for (let n = 44; n < audio.bytes.length; n += 4) {
      const value = audio.bytes.readFloatLE(n)
      assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value))
    }
    assert.ok(peak > 0.00001, 'real synthesis remains non-silent')
    return { taskId: job.data.taskId, bytes: audio.bytes.length }
  }
  await synthesize('Before replacement.')
  mode = 'offline'
  assert.equal((await h.request('speech.assets.repair')).ok, true)
  const failed = await waitFor(() => h.request('speech.assets.status'), value => value.data?.phase === 'error', 'replacement failure')
  assert.equal(failed.data.error.code, 'speech_network')
  assert.equal(failed.data.assetsReady, true)
  assert.equal(failed.data.resourceGeneration, original.resourceGeneration)
  const actual = await synthesize('After failed replacement.')
  assert.equal(downloads, 9, 'synthesis does not retry the replacement download')
  assert.deepEqual((await h.request('settings.get')).data, settings.data)
  t.diagnostic(JSON.stringify({ realOldGenerationAfterFailure: actual }))
})

test('confirmed same-revision replacement invalidates old audio and reloads the actual runtime from its new generation', { skip: realAssets, timeout: 120000 }, async t => {
  const h = await prepared(t)
  // All learner fixtures are synthetic and created through the established
  // execute Interface, never by editing a real Profile or learning file.
  for (const [command, payload] of [
    ['settings.save', { audio: { rate: 1.5, kokoroVoice: 'bf_emma' }, study: { wordsPerDay: 7 } }],
    ['audio.bookmark.save', { materialId: 'synthetic-repair-article', contentFingerprint: 'fixture-v1', position: 2 }],
    ['review.add', { items: [{ term: 'synthetic example', meaning: '合成示例', choices: ['合成示例', '另外一个', '从不', '每天'], answerIndex: 0 }] }]
  ]) assert.equal((await execute(h.root, command, payload)).ok, true)
  async function learningFiles(directory, prefix = '') {
    const result = {}
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name), relative = prefix + entry.name
      if (entry.isDirectory()) Object.assign(result, await learningFiles(path, relative + '/'))
      else result[relative] = await fs.readFile(path, 'utf8')
    }
    return result
  }
  const learningBefore = await learningFiles(h.root)
  async function generate() {
    const job = await h.request('speech.synthesize', { text: 'Opportunity.', voice: 'af_heart', rate: 1 })
    await waitFor(() => h.request('speech.status', { taskId: job.data.taskId }), value => value.data?.phase === 'ready', 'real replacement WAV')
    const audio = await h.request('speech.audio', { taskId: job.data.taskId })
    assert.equal(audio.httpStatus, 200)
    assert.ok(audio.bytes.length > 44)
    assert.equal(audio.bytes.readUInt32LE(24), 24000)
    let peak = 0
    for (let n = 44; n < audio.bytes.length; n += 4) { const value = audio.bytes.readFloatLE(n); assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)) }
    assert.ok(peak > 0.00001)
    return { taskId: job.data.taskId, bytes: audio.bytes.length }
  }
  const old = await generate()
  const before = (await h.request('speech.assets.status')).data
  assert.equal((await h.request('speech.assets.repair')).ok, true)
  const replaced = await waitFor(() => h.request('speech.assets.status'), value => value.data?.phase === 'ready', 'replacement generation')
  assert.notEqual(replaced.data.resourceGeneration, before.resourceGeneration)
  assert.equal(replaced.data.manifest.revision, before.manifest.revision, 'no invented newer upstream version')
  assert.equal((await h.request('speech.audio', { taskId: old.taskId })).httpStatus, 404, 'old cache handles cannot cross the active installation switch')
  const current = await generate()
  assert.notEqual(current.taskId, old.taskId)
  const entries = await fs.readdir(h.speechRoot)
  assert.equal(entries.filter(name => name.startsWith('.generation-')).length, 1)
  await assert.rejects(fs.access(join(h.speechRoot, before.manifest.id)), { code: 'ENOENT' })
  assert.deepEqual(await learningFiles(h.root), learningBefore, 'repair and real synthesis preserve every synthetic learning, settings and bookmark byte')
  t.diagnostic(JSON.stringify({ realBeforeAndAfterGeneration: [old, current] }))
})

test('a compatible old generation synthesizes during a slow repair and after its owner cancels', { skip: realAssets, timeout: 120000 }, async t => {
  let blocked = false, activeSignal
  const h = await prepared(t, { download(asset, { signal }) {
    if (blocked) {
      activeSignal = signal
      const source = new Readable({ read() {} })
      signal.addEventListener('abort', () => source.destroy(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true })
      return source
    }
    return createReadStream(join(process.env.ENGLISH_COACH_TEST_ASSETS, asset.path), { signal })
  } })
  const original = (await h.request('speech.assets.status')).data
  blocked = true
  const repair = await h.request('speech.assets.repair')
  const downloading = await waitFor(() => h.request('speech.assets.status'), value => value.data?.phase === 'downloading', 'slow repair')
  assert.equal(downloading.data.assetsReady, true)
  const old = await h.request('speech.synthesize', { text: 'During replacement.', voice: 'bf_emma', rate: 1 })
  try {
    await waitFor(() => h.request('speech.status', { taskId: old.data.taskId }), value => value.data?.phase === 'ready', 'old generation before cancel')
  } catch (cause) { await h.request('speech.assets.cancel'); throw cause }
  assert.equal(activeSignal.aborted, false, 'old synthesis does not cancel or wait for the replacement transfer')
  assert.equal((await h.request('speech.assets.cancel', {}, { page: 'b'.repeat(48) })).code, 'speech_not_owner')
  assert.equal((await h.request('speech.assets.repair', {}, { page: 'b'.repeat(48) })).code, 'speech_busy')
  const cancelled = await h.request('speech.assets.cancel')
  assert.equal(cancelled.data.phase, 'cancelled')
  assert.equal(cancelled.data.assetsReady, true)
  assert.equal(cancelled.data.resourceGeneration, original.resourceGeneration)
  assert.equal((await h.request('speech.audio', { taskId: old.data.taskId })).httpStatus, 200, 'failed replacement keeps existing audio usable')
  const next = await h.request('speech.synthesize', { text: 'After canceled replacement.', voice: 'bf_emma', rate: 1 })
  await waitFor(() => h.request('speech.status', { taskId: next.data.taskId }), value => value.data?.phase === 'ready', 'old generation after cancel')
  const audio = await h.request('speech.audio', { taskId: next.data.taskId })
  assert.equal(audio.httpStatus, 200)
  assert.ok(audio.bytes.length > 44)
  assert.equal((await h.request('speech.assets.status')).data.resourceGeneration, original.resourceGeneration)
  assert.deepEqual((await fs.readdir(h.speechRoot)).sort(), [original.manifest.id])
  t.diagnostic(JSON.stringify({ actualOldGenerationDuringAndAfterCancel: { repair: repair.data.generation, bytes: audio.bytes.length } }))
})

test('a truncated regular active record can be explicitly repaired after reboot without an implicit download', { skip: realAssets, timeout: 120000 }, async t => {
  let downloads = 0, offline = false
  const download = (asset, { signal }) => {
    downloads++
    if (offline) throw new Error('isolated offline repair')
    return createReadStream(join(process.env.ENGLISH_COACH_TEST_ASSETS, asset.path), { signal })
  }
  const initial = await prepared(t, { download })
  await initial.request('speech.assets.repair')
  await waitFor(() => initial.request('speech.assets.status'), value => value.data?.phase === 'ready', 'first active generation')
  const pointer = join(initial.speechRoot, 'active.json')
  assert.equal(await fs.realpath(pointer), pointer, 'fault injection stays in the isolated fixed metadata file')
  await fs.writeFile(pointer, '{"id":')
  const identity = await fs.lstat(pointer)
  assert.equal(identity.isFile(), true); assert.equal(identity.nlink, 1)
  await initial.dispose()
  const h = await host(t, { directory: initial.base, download })
  const damaged = await h.request('speech.assets.status')
  assert.equal(damaged.data.assetsReady, false)
  assert.equal(damaged.data.repairRequired, true, 'metadata damage must expose the explicit repair entry')
  assert.equal((await h.request('speech.assets.prepare')).code, 'speech_repair_required')
  assert.equal(downloads, 16, 'read, reboot and ordinary prepare do not acquire download permission')
  offline = true
  const rejected = await h.request('speech.assets.repair')
  assert.equal(rejected.ok, true, JSON.stringify(rejected))
  const failed = await waitFor(() => h.request('speech.assets.status'), value => value.data?.phase === 'error', 'failed explicit metadata repair')
  assert.equal(failed.data.assetsReady, false)
  assert.equal(failed.data.repairRequired, true)
  assert.equal(await fs.readFile(pointer, 'utf8'), '{"id":', 'failed repair does not replace corrupt metadata')
  offline = false
  assert.equal((await h.request('speech.assets.repair')).ok, true)
  await waitFor(() => h.request('speech.assets.status'), value => value.data?.phase === 'ready', 'restored active generation')
  await h.dispose()
  const reboot = await host(t, { directory: h.base, download: () => assert.fail('restored synthesis must be offline') })
  assert.equal((await reboot.request('speech.assets.status')).data.assetsReady, true)
  const job = await reboot.request('speech.synthesize', { text: 'Opportunity.', voice: 'af_heart', rate: 1 })
  await waitFor(() => reboot.request('speech.status', { taskId: job.data.taskId }), value => value.data?.phase === 'ready', 'real restored speech')
  const audio = await reboot.request('speech.audio', { taskId: job.data.taskId })
  assert.equal(audio.httpStatus, 200)
  assert.equal(audio.bytes.readUInt32LE(24), 24000)
  let peak = 0
  for (let n = 44; n < audio.bytes.length; n += 4) { const value = audio.bytes.readFloatLE(n); assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)) }
  assert.ok(peak > 0.00001)
  t.diagnostic(JSON.stringify({ metadataRecoveryWav: { bytes: audio.bytes.length, peak, downloads } }))
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
