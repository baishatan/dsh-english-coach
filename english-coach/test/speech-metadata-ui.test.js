import assert from 'node:assert/strict'
import { promises as fs, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../index.js'
import { execute } from '../core/index.js'
import { mountClient } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

// Actual registered Host route plus the actual visible Client. Only Host
// admission/transport and the fixed-byte external download are Adapters.
async function host(t) {
  const base = await tempFixture(t, 'coach-metadata-ui-')
  const root = join(base, 'learning'), speechRoot = join(base, 'speech')
  await fs.mkdir(root)
  assert.equal((await execute(root, 'profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  const effects = [], intervals = [], events = new Map(), calls = []
  let route, downloads = 0, offline = true
  const pending = new Set()
  const services = {
    webServer: { register(value) { route = value; return () => {} } },
    systemPrompt: { context() { return () => {} } },
    connection: { admit() { return { peer: { id: 'isolated-owner', principal: { kind: 'owner' } } } } }
  }
  apply({
    get: name => services[name], tools: { register() { return () => {} } },
    timer: { interval(callback, delay) { intervals.push({ callback, delay }); return () => {} } },
    effect(callback) { const cleanup = callback(); if (typeof cleanup === 'function') effects.push(cleanup) },
    on(name, callback) { events.set(name, callback) }
  }, { dataRoot: root, speechRoot, speechDownload(asset, { signal }) {
    downloads++
    if (offline) throw new Error('isolated offline')
    return createReadStream(join(process.env.ENGLISH_COACH_TEST_ASSETS, asset.path), { signal })
  } })
  for (const { callback } of intervals.filter(value => value.delay === 500)) callback()
  disposeFixture(t, async () => { for (const cleanup of effects.reverse()) await cleanup(); await events.get('dispose')?.() })
  function request(command, payload = {}, options = {}) {
    const task = (async () => {
      calls.push(command)
      const req = Readable.from([JSON.stringify(payload)])
      req.url = `/english-coach/api/${command}`; req.method = 'POST'
      req.headers = { host: 'localhost:55418', 'content-type': 'application/json', 'x-english-coach-speech-session': 'a'.repeat(48), ...options.headers }
      let result
      await route.handler(req, { setHeader() {}, end(value) { result = JSON.parse(value) } })
      return result
    })()
    pending.add(task); task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }
  async function settle(ui) { while (pending.size) await ui.flush(async () => { await Promise.all([...pending]) }) }
  return { speechRoot, request, settle, calls, downloads: () => downloads, online() { offline = false } }
}

test('a missing active generation is visibly damaged and recovery requires confirmation before fixed-asset download', {
  skip: !process.env.ENGLISH_COACH_TEST_ASSETS && 'Requires explicit verified eight-asset fixture'
}, async t => {
  const h = await host(t)
  const manifest = (await h.request('speech.assets.status')).data.manifest
  await fs.mkdir(h.speechRoot)
  const pointer = join(h.speechRoot, 'active.json')
  const original = JSON.stringify({ id: manifest.id, revision: manifest.revision, generation: '12345678-1234-4234-9234-123456789abc' })
  await fs.writeFile(pointer, original)
  const ui = await mountClient({ request: h.request, setupWindow(window) {
    window.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak() { assert.fail('resource recovery must stay silent') } }
    window.SpeechSynthesisUtterance = class {}
  } })
  disposeFixture(t, async () => { await ui.close(); await h.settle(ui) })
  await h.settle(ui)
  const deadline = performance.now() + 30000
  let section
  while (!(section = ui.container.querySelector('section[aria-label="Kokoro 资源准备"]')) || !section.textContent.includes('资源损坏或不兼容')) {
    assert.ok(performance.now() < deadline, 'registered Host responses reach the visible resource card')
    await ui.flush(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  assert.match(section.textContent, /资源损坏或不兼容/, 'a missing pointed-to directory is not a fresh unprepared installation')
  assert.equal(ui.buttons('准备').length, 0)
  assert.equal(h.downloads(), 0)
  assert.equal((await h.request('speech.assets.prepare')).code, 'speech_repair_required')
  await ui.click('修复')
  assert.equal(h.downloads(), 0, 'opening confirmation does not download')
  await ui.click('确认重新下载并修复')
  await ui.flush(async () => {
    while (h.downloads() !== 1 || (await h.request('speech.assets.status')).data.phase !== 'error') {
      assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10))
    }
  })
  await ui.poll()
  assert.equal((await h.request('speech.assets.status')).data.assetsReady, false)
  assert.equal(await fs.readFile(pointer, 'utf8'), original)
  assert.equal(h.downloads(), 1)
  h.online()
  await ui.click('修复')
  await ui.click('确认重新下载并修复')
  await ui.flush(async () => {
    while ((await h.request('speech.assets.status')).data.phase !== 'ready') {
      assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10))
    }
  })
  while (!section.textContent.includes('资源已校验')) {
    assert.ok(performance.now() < deadline, 'verified Host status becomes visible')
    await ui.poll()
    await ui.flush(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  assert.match(section.textContent, /资源已校验/)
  assert.equal(h.downloads(), 9, 'only the explicit failed attempt and then all eight fixed downloads')
  assert.equal(h.calls.filter(command => /speech\.synthesize|review\.answer|lesson\.complete|settings\.save/.test(command)).length, 0)
})
