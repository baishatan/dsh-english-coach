import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import test from 'node:test'

import { apply } from '../index.js'

// Exercise the registered Host route, including the actual request headers.
// Only the external downloader and host services are controlled adapters.
async function host(t, { directory, download } = {}) {
  const base = await fs.realpath(directory ?? await fs.mkdtemp(join(tmpdir(), 'english-coach-speech-')))
  const root = join(base, 'learning'), speechRoot = join(base, 'speech')
  await fs.mkdir(root, { recursive: true })
  const intervals = [], effects = [], events = new Map()
  let route, prompt
  const services = {
    webServer: { getOrigin: () => 'http://127.0.0.1:55418', register(value) { route = value; return () => { route = null } } },
    systemPrompt: { context(value) { prompt = value; return () => {} } },
    connection: { admit(req) {
      // External admission adapter mirrors the Host's trust/auth rejection.
      const origin = req.headers.origin
      if (!['localhost:55418', '127.0.0.1:55418'].includes(req.headers.host) ||
          (origin !== undefined && origin !== `http://${req.headers.host}`) || req.headers['sec-fetch-site'] === 'cross-site') return { rejection: 403 }
      if (req.headers.cookie === 'unauthenticated') return { rejection: 401 }
      return { peer: { id: req.headers.cookie === 'other-peer' ? 'other-peer' : 'owner-peer', principal: { kind: req.headers.cookie === 'non-owner' ? 'agent' : 'owner' } } }
    } }
  }
  apply({
    get: name => services[name],
    tools: { register() { return () => {} } },
    timer: { interval(callback, delay) { const row = { callback, delay }; intervals.push(row); return () => {} } },
    effect: fn => { const cleanup = fn(); if (typeof cleanup === 'function') effects.push(cleanup) },
    on: (name, callback) => events.set(name, callback)
  }, { dataRoot: root, speechRoot, speechDownload: download })
  for (const row of intervals.filter(row => row.delay === 500)) row.callback()
  for (let n = 0; n < 100 && !prompt?.text(); n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(prompt?.text(), 'isolated Host startup completed')
  const request = async (command, payload = {}, { session = 'page-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', headers = {}, method = 'POST' } = {}) => {
    const req = Readable.from([JSON.stringify(payload)])
    req.url = `/english-coach/api/${command}`
    req.method = method
    req.headers = {
      host: 'localhost:55418', origin: 'http://localhost:55418',
      'content-type': 'application/json', 'x-english-coach-speech-session': session, ...headers
    }
    let body, statusCode
    await route.handler(req, { set statusCode(value) { statusCode = value }, setHeader() {}, end(text) { body = JSON.parse(text) } })
    return { ...body, httpStatus: statusCode }
  }
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    for (const cleanup of effects.reverse()) await cleanup()
    await events.get('dispose')?.()
  }
  t.after(dispose)
  return { base, root, speechRoot, request, dispose }
}

test('asset status reports the fixed curated download without creating resources or fetching', async t => {
  const downloads = []
  const h = await host(t, { download: async (...args) => { downloads.push(args); throw new Error('must not download') } })
  const learningBefore = await fs.readdir(h.root)
  const status = await h.request('speech.assets.status')
  assert.equal(status.ok, true)
  assert.equal(status.data.phase, 'unprepared')
  assert.equal(status.data.assetsReady, false)
  assert.equal(status.data.runtimeAvailable, false)
  assert.equal(status.data.manifest.revision, '1939ad2a8e416c0acfeecc08a694d14ef25f2231')
  assert.equal(status.data.manifest.downloadBytes, 94_453_730)
  assert.equal(status.data.manifest.files.length, 8)
  assert.deepEqual(status.data.manifest.voices, ['af_heart', 'am_michael', 'bf_emma', 'bm_george'])
  assert.equal(status.data.downloadedBytes, 0)
  assert.equal(status.data.diskBytes, 0)
  assert.equal(downloads.length, 0)
  await assert.rejects(fs.access(h.speechRoot), { code: 'ENOENT' })
  assert.deepEqual(await fs.readdir(h.root), learningBefore)
  assert.equal((await h.request('speech.assets.status')).data.phase, 'unprepared')
  assert.equal(downloads.length, 0)
})

test('speech resource routes reject foreign origins, simple requests and remote paths', async t => {
  const h = await host(t)
  for (const [payload, options] of [
    [{}, { headers: { origin: 'https://other.example' } }],
    [{}, { headers: { origin: 'null' } }],
    [{}, { headers: { 'content-type': 'text/plain' } }],
    [{}, { session: '' }],
    [{}, { headers: { host: 'attacker.example', origin: 'http://attacker.example' } }],
    [{ path: '/tmp/not-owned' }, {}],
    [{ speechRoot: '/tmp/not-owned' }, {}],
    [{ url: 'https://other.example/model' }, {}]
  ]) {
    const denied = await h.request('speech.assets.status', payload, options)
    assert.equal(denied.ok, false)
    assert.ok([400, 403].includes(denied.httpStatus), JSON.stringify(denied))
  }
  assert.equal((await h.request('speech.assets.status', {}, { headers: { origin: 'dsh-app://app' } })).httpStatus, 403, 'desktop main forwards without Origin after its own checks')
  await assert.rejects(fs.access(h.speechRoot), { code: 'ENOENT' })
})

test('authenticated desktop-forwarded requests work without browser Origin headers', async t => {
  const h = await host(t, { download: async () => { throw new Error('isolated offline') } })
  assert.equal((await h.request('speech.assets.status', {}, { headers: { origin: undefined } })).ok, true)
  assert.equal((await h.request('speech.assets.prepare', {}, { headers: { origin: undefined } })).ok, true)
  assert.equal((await settle(h, 'error')).error.code, 'speech_network')
})

test('resource mutations require an admitted owner Peer and page ownership is Peer-scoped', async t => {
  const h = await host(t, { download: async (_asset, { signal }) => {
    const stream = new Readable({ read() {} })
    signal.addEventListener('abort', () => stream.destroy(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true })
    return stream
  } })
  for (const command of ['speech.assets.status', 'speech.assets.prepare', 'speech.assets.cancel']) {
    const denied = await h.request(command, {}, { headers: { cookie: 'unauthenticated' } })
    assert.equal(denied.httpStatus, 401)
    assert.equal(denied.ok, false)
    assert.equal((await h.request(command, {}, { headers: { cookie: 'non-owner' } })).httpStatus, 403)
  }
  assert.equal((await h.request('speech.assets.prepare')).ok, true)
  await settle(h, 'downloading')
  assert.equal((await h.request('speech.assets.cancel', {}, { headers: { cookie: 'other-peer' } })).code, 'speech_not_owner')
  assert.equal((await h.request('speech.assets.cancel')).data.phase, 'cancelled')
})

async function settle(h, phase) {
  const deadline = performance.now() + 30_000
  let current = null
  do {
    const result = await h.request('speech.assets.status')
    assert.equal(result.ok, true, JSON.stringify(result))
    current = result.data
    if (current.phase === phase) return current
    if (current.phase === 'error' && phase !== 'error') assert.fail(JSON.stringify(current.error))
    // Yield to the real streaming I/O. Count elapsed time, not polling turns:
    // checksum and disk work can take longer under concurrent test workloads.
    await new Promise(resolve => setTimeout(resolve, 10))
  } while (performance.now() < deadline)
  assert.fail(`Host did not reach ${phase} within 30s: ${JSON.stringify({
    phase: current?.phase, currentFile: current?.currentFile, error: current?.error,
    downloadedBytes: current?.downloadedBytes, validatedBytes: current?.validatedBytes,
    diskBytes: current?.diskBytes
  })}`)
}

test('simultaneous prepare requests share one generation and one bounded transfer', async t => {
  let downloads = 0
  const h = await host(t, { download: async (_asset, { signal }) => {
    downloads++
    const stream = new Readable({ read() {} })
    signal.addEventListener('abort', () => stream.destroy(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true })
    return stream
  } })
  const results = await Promise.all(Array.from({ length: 8 }, () => h.request('speech.assets.prepare')))
  assert.ok(results.every(result => result.ok))
  assert.equal(new Set(results.map(result => result.data.generation)).size, 1)
  await settle(h, 'downloading')
  assert.equal(downloads, 1)
  await h.request('speech.assets.cancel')
})

test('explicit preparation downloads once, exposes actual bytes, owns cancellation and requires explicit retry', async t => {
  const attempts = [], streams = []
  const h = await host(t, { download: async (asset, { signal }) => {
    attempts.push(asset)
    const stream = new Readable({ read() {} })
    streams.push(stream)
    signal.addEventListener('abort', () => stream.destroy(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true })
    return stream
  } })
  const begin = await h.request('speech.assets.prepare')
  assert.equal(begin.ok, true)
  assert.equal(begin.data.phase, 'preparing')
  assert.match(begin.data.generation, /^[a-f0-9-]{36}$/)
  const duplicate = await h.request('speech.assets.prepare')
  assert.equal(duplicate.data.generation, begin.data.generation)
  const progress = await settle(h, 'downloading')
  assert.equal(progress.currentFile, 'config.json')
  streams[0].push(Buffer.from('{'))
  for (let n = 0; n < 100; n++) {
    const current = (await h.request('speech.assets.status')).data
    if (current.downloadedBytes === 1) break
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.equal((await h.request('speech.assets.status')).data.downloadedBytes, 1)
  const outsider = { session: 'page-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }
  assert.equal((await h.request('speech.assets.cancel', {}, outsider)).code, 'speech_not_owner')
  assert.equal((await h.request('speech.assets.prepare', {}, outsider)).code, 'speech_busy')
  const cancelled = await h.request('speech.assets.cancel')
  assert.equal(cancelled.data.phase, 'cancelled')
  assert.equal(cancelled.data.assetsReady, false)
  assert.equal(cancelled.data.diskBytes, 0)
  assert.deepEqual(await fs.readdir(h.speechRoot), [])
  await h.request('speech.assets.status')
  assert.equal(attempts.length, 1)
  const retry = await h.request('speech.assets.prepare')
  assert.notEqual(retry.data.generation, begin.data.generation)
  await settle(h, 'downloading')
  await h.request('speech.assets.cancel')
  assert.equal(attempts.length, 2)
})

test('unsafe symlink resource roots are rejected without following or cleaning foreign files', async t => {
  const h = await host(t, { download: async () => { assert.fail('unsafe roots must not download') } })
  const outside = join(h.base, 'foreign')
  await fs.mkdir(outside)
  await fs.writeFile(join(outside, 'keep.txt'), 'do not touch')
  await fs.symlink(outside, h.speechRoot)
  const status = (await h.request('speech.assets.status')).data
  assert.equal(status.assetsReady, false)
  assert.equal(status.error.code, 'speech_unsafe_path')
  await h.request('speech.assets.prepare')
  assert.equal((await settle(h, 'error')).error.code, 'speech_unsafe_path')
  assert.equal(await fs.readFile(join(outside, 'keep.txt'), 'utf8'), 'do not touch')
  assert.equal((await fs.lstat(h.speechRoot)).isSymbolicLink(), true)
})

test('effect disposal cancels the external transfer and cleans only its own partial generation', async t => {
  let signal
  const h = await host(t, { download: async (_asset, options) => {
    signal = options.signal
    const stream = new Readable({ read() {} })
    signal.addEventListener('abort', () => stream.destroy(Object.assign(new Error('cancelled'), { name: 'AbortError' })), { once: true })
    return stream
  } })
  await h.request('speech.assets.prepare')
  await settle(h, 'downloading')
  await h.dispose()
  assert.equal(signal.aborted, true)
  assert.deepEqual(await fs.readdir(h.speechRoot), [])
  const reboot = await host(t, { directory: h.base, download: async () => assert.fail('restart cannot redownload') })
  assert.equal((await reboot.request('speech.assets.status')).data.assetsReady, false)
})

test('a restart reports owned partial bytes and explicit retry reclaims them without touching other files', async t => {
  const h = await host(t, { download: async () => { throw new Error('offline after reclamation') } })
  const manifest = (await h.request('speech.assets.status')).data.manifest
  const generation = '12345678-1234-4234-9234-123456789abc'
  const partial = join(h.speechRoot, `.prepare-${generation}`)
  await fs.mkdir(partial, { recursive: true })
  const marker = JSON.stringify({ id: manifest.id, generation })
  await fs.writeFile(join(partial, '_owner.json'), marker)
  await fs.writeFile(join(partial, 'config.json'), '{')
  const stale = (await h.request('speech.assets.status')).data
  assert.equal(stale.assetsReady, false)
  assert.equal(stale.phase, 'interrupted')
  assert.equal(stale.diskBytes, Buffer.byteLength(marker) + 1)
  assert.equal(await fs.readFile(join(partial, 'config.json'), 'utf8'), '{', 'status does not clean partials')
  await h.request('speech.assets.prepare')
  assert.equal((await settle(h, 'error')).error.code, 'speech_network')
  assert.deepEqual(await fs.readdir(h.speechRoot), [])
  await fs.mkdir(partial)
  await fs.writeFile(join(partial, 'foreign.txt'), 'do not delete')
  await h.request('speech.assets.prepare')
  assert.equal((await settle(h, 'error')).error.code, 'speech_unowned_partial')
  assert.equal(await fs.readFile(join(partial, 'foreign.txt'), 'utf8'), 'do not delete')
  assert.deepEqual(await fs.readdir(h.speechRoot), [`.prepare-${generation}`], 'no extra generation grows storage')
})

test('a partial final directory or mismatched version is never ready and explicit preparation does not silently repair it', async t => {
  const h = await host(t, { download: async () => assert.fail('invalid final assets need explicit repair, not a hidden redownload') })
  const manifest = (await h.request('speech.assets.status')).data.manifest
  const final = join(h.speechRoot, manifest.id)
  await fs.mkdir(final, { recursive: true })
  await fs.writeFile(join(final, 'ready.json'), '{broken')
  const partial = (await h.request('speech.assets.status')).data
  assert.equal(partial.assetsReady, false)
  assert.equal(partial.phase, 'error')
  assert.equal(partial.error.code, 'speech_invalid_manifest')
  assert.equal((await h.request('speech.assets.prepare')).code, 'speech_repair_required')
  assert.equal(await fs.readFile(join(final, 'ready.json'), 'utf8'), '{broken')
})

test('removing a ready directory invalidates cached readiness without downloading', {
  skip: !process.env.ENGLISH_COACH_TEST_ASSETS && 'Requires explicit verified assets fixture'
}, async t => {
  const h = await host(t, { download: (asset, { signal }) => createReadStream(join(process.env.ENGLISH_COACH_TEST_ASSETS, asset.path), { signal }) })
  await h.request('speech.assets.prepare')
  const ready = await settle(h, 'ready')
  const owned = join(h.speechRoot, ready.manifest.id)
  assert.ok(owned.startsWith(h.speechRoot + '/'), 'fixture move stays in the isolated root')
  await fs.rename(owned, join(h.base, 'removed-fixture-set'))
  const missing = (await h.request('speech.assets.status')).data
  assert.equal(missing.assetsReady, false)
  assert.equal(missing.phase, 'unprepared')
})

test('network, full disk, truncated, oversized and checksum failures stay unavailable with bounded errors', async t => {
  const failures = [
    [async () => { throw new Error('/private/secret ' + 'x'.repeat(4000)) }, 'speech_network'],
    [async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }) }, 'speech_disk_full'],
    [async () => Readable.from([Buffer.from('{')]), 'speech_size_mismatch'],
    [async () => Readable.from([Buffer.alloc(45)]), 'speech_size_mismatch'],
    [async () => Readable.from([Buffer.alloc(44)]), 'speech_checksum_mismatch']
  ]
  for (const [download, code] of failures) {
    const h = await host(t, { download })
    await h.request('speech.assets.prepare')
    const failed = await settle(h, 'error')
    assert.equal(failed.assetsReady, false)
    assert.equal(failed.error.code, code)
    assert.ok(failed.error.message.length < 240)
    assert.ok(!failed.error.message.includes('/private/secret'))
    assert.ok(failed.downloadedBytes <= 44)
    assert.equal(failed.diskBytes, 0)
    assert.deepEqual(await fs.readdir(h.speechRoot), [])
    assert.equal((await h.request('speech.assets.status')).data.phase, 'error')
    await h.dispose()
  }
})

test('preparation can complete after a slow external download handshake without masking real errors', {
  skip: !process.env.ENGLISH_COACH_TEST_ASSETS && 'Requires explicit verified assets fixture'
}, async t => {
  const fixture = process.env.ENGLISH_COACH_TEST_ASSETS
  const h = await host(t, { download: async (asset, { signal }) => {
    if (asset.path === 'config.json') await new Promise(resolve => setTimeout(resolve, 3200))
    return createReadStream(join(fixture, asset.path), { signal })
  } })
  await h.request('speech.assets.prepare')
  const ready = await settle(h, 'ready')
  assert.equal(ready.assetsReady, true)
  assert.equal(ready.validatedBytes, 94_453_730)
})

test('all eight fixed assets become ready atomically and a rebuilt Host validates and reuses them offline', {
  skip: !process.env.ENGLISH_COACH_TEST_ASSETS && 'Set ENGLISH_COACH_TEST_ASSETS to an explicitly verified eight-asset fixture directory'
}, async t => {
  const requests = []
  const fixture = process.env.ENGLISH_COACH_TEST_ASSETS
  const h = await host(t, { download: async (asset, { signal }) => {
    requests.push(asset.url)
    return createReadStream(join(fixture, asset.path), { signal })
  } })
  await h.request('settings.save', { audio: { rate: 1.5 } })
  const before = await h.request('settings.get')
  assert.equal((await h.request('speech.assets.prepare')).ok, true)
  const ready = await settle(h, 'ready')
  assert.equal(ready.assetsReady, true)
  assert.equal(ready.runtimeAvailable, false, '03 downloads assets; the synthesis runtime is packaged separately')
  assert.equal(ready.downloadedBytes, 94_453_730)
  assert.equal(ready.validatedBytes, 94_453_730)
  assert.ok(ready.diskBytes >= 94_453_730 && ready.diskBytes < 94_460_000)
  assert.equal(requests.length, 8)
  assert.ok(requests.every(url => url.startsWith('https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/')))
  assert.deepEqual(await h.request('settings.get'), before)
  const same = await h.request('speech.assets.prepare')
  assert.equal(same.data.assetsReady, true)
  assert.equal(requests.length, 8, 'compatible resources are not downloaded again')
  await h.dispose()
  const reboot = await host(t, { directory: h.base, download: async () => { assert.fail('reboot must be offline') } })
  const reused = (await reboot.request('speech.assets.status')).data
  assert.equal(reused.assetsReady, true)
  assert.equal(reused.phase, 'ready')
  assert.equal(reused.validatedBytes, 94_453_730)
  assert.equal((await reboot.request('speech.assets.prepare')).data.assetsReady, true)
  const [set] = (await fs.readdir(reboot.speechRoot)).filter(name => name.startsWith('kokoro-'))
  assert.ok(set)
  const voice = join(reboot.speechRoot, set, 'voices/af_heart.bin')
  const changed = await fs.open(voice, 'r+')
  await changed.write(Buffer.from('x'), 0, 1, 0)
  await changed.close()
  const corrupt = (await reboot.request('speech.assets.status')).data
  assert.equal(corrupt.assetsReady, false)
  assert.equal(corrupt.phase, 'error')
  assert.equal(corrupt.error.code, 'speech_checksum_mismatch')
  assert.equal((await reboot.request('speech.assets.prepare')).code, 'speech_repair_required')
  await reboot.dispose()
  const third = await host(t, { directory: h.base, download: async () => { assert.fail('corruption status must not repair') } })
  assert.equal((await third.request('speech.assets.status')).data.assetsReady, false)
})
