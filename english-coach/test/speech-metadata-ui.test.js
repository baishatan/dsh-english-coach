import assert from 'node:assert/strict'
import { promises as fs, createReadStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../index.js'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

// Actual registered Host route plus the actual visible Client. Only Host
// admission/transport and the fixed-byte external download are Adapters.
async function host(t, { directory, online = false, runtimeDispose = async () => {} } = {}) {
  const base = await tempFixture(t, 'coach-metadata-ui-', directory)
  const root = join(base, 'learning'), speechRoot = join(base, 'speech')
  await fs.mkdir(root, { recursive: true })
  if (!directory) assert.equal((await execute(root, 'profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  const effects = [], intervals = [], events = new Map(), calls = [], runtimeRoots = []
  let route, downloads = 0, offline = !online
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
  }, speechRuntimeFactory({ assetRoot }) {
    runtimeRoots.push(assetRoot)
    return { async synthesize() { const wav = Buffer.alloc(44); wav.write('RIFF', 0); wav.write('WAVE', 8); return wav }, dispose: runtimeDispose }
  } })
  for (const { callback } of intervals.filter(value => value.delay === 500)) callback()
  let disposed = false
  async function dispose() {
    if (disposed) return
    disposed = true
    for (const cleanup of effects.reverse()) await cleanup()
    await events.get('dispose')?.()
  }
  disposeFixture(t, dispose)
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
  return { base, root, speechRoot, request, settle, dispose, calls, runtimeRoots, downloads: () => downloads, online() { offline = false } }
}

test('删除共享资源中及归属改变导致删除失败时，公开状态和界面不再误称可用', {
  skip: !process.env.ENGLISH_COACH_TEST_ASSETS && 'Requires explicit verified eight-asset fixture'
}, async t => {
  const runtimeGate = deferred(), h = await host(t, { online: true, runtimeDispose: () => runtimeGate.promise })
  // Release the external runtime even if an assertion fails, before Host cleanup.
  disposeFixture(t, () => runtimeGate.resolve())
  const deadline = performance.now() + 30000
  await h.request('speech.assets.prepare')
  let original
  do {
    assert.ok(performance.now() < deadline)
    original = (await h.request('speech.assets.status')).data
    if (original.phase !== 'ready') await new Promise(resolve => setTimeout(resolve, 10))
  } while (original.phase !== 'ready')
  const generation = '12345678-1234-4234-9234-123456789abc'
  const stage = join(h.speechRoot, `.prepare-${generation}`)
  await fs.mkdir(stage)
  await fs.writeFile(join(stage, '_owner.json'), JSON.stringify({ id: original.manifest.id, generation }))
  await fs.writeFile(join(stage, 'config.json'), '{')
  assert.equal((await h.request('speech.assets.status')).data.cleanupRequired, true)
  const ui = await mountClient({ request: h.request, setupWindow(window) {
    window.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak() { assert.fail('must not use system speech') } }
    window.SpeechSynthesisUtterance = class {}
    window.URL.createObjectURL = () => 'blob:isolated-delete'
    window.URL.revokeObjectURL = () => {}
    window.Audio = class { play() { return Promise.resolve() } pause() {} removeAttribute() {} load() {} }
  } })
  disposeFixture(t, async () => { runtimeGate.resolve(); await ui.close(); await h.settle(ui) })
  await h.settle(ui)
  assert.equal(ui.buttons('修复').length, 1)
  await ui.click('试听音色')
  for (let i = 0; i < 100 && h.runtimeRoots.length === 0; i++) { await ui.poll(); await h.settle(ui); await ui.flush(() => new Promise(resolve => setTimeout(resolve, 10))) }
  assert.equal(h.runtimeRoots.length, 1)
  // Ownership changes after the previous valid status, before global deletion.
  const ownerPath = join(stage, '_owner.json')
  await fs.writeFile(ownerPath, JSON.stringify({ id: 'foreign-model', generation }))
  const deletion = h.request('speech.assets.delete')
  const deleting = (await h.request('speech.assets.status')).data
  assert.equal(deleting.phase, 'deleting')
  assert.equal(deleting.assetsReady, false)
  assert.equal(deleting.cleanupRequired, false, 'in-flight deletion cannot claim a usable generation')
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('focus')))
  while (!ui.container.querySelector('[aria-label="Kokoro 资源准备"]').textContent.includes('正在删除')) {
    assert.ok(performance.now() < deadline, 'in-flight Host status reaches the visible client')
    await ui.flush(() => new Promise(resolve => setTimeout(resolve, 10)))
  }
  assert.equal(ui.buttons('修复').length, 0)
  assert.doesNotMatch(ui.container.querySelector('[aria-label="Kokoro 资源准备"]').textContent, /当前音色仍可用/)
  runtimeGate.resolve()
  const refused = await deletion
  assert.equal(refused.ok, false)
  const failed = (await h.request('speech.assets.status')).data
  assert.equal(failed.phase, 'error')
  assert.equal(failed.assetsReady, false)
  assert.equal(failed.diskBytesKnown, false)
  assert.equal(failed.cleanupRequired, false, 'a refused deletion must not retain an earlier trusted inventory')
  assert.match(await fs.readFile(ownerPath, 'utf8'), /foreign-model/)
  await ui.poll(); await h.settle(ui)
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.doesNotMatch(section.textContent, /当前音色仍可用/)
  assert.equal(ui.buttons('修复').length, 0)
  assert.equal(ui.buttons('删除资源').length, 1)
})

test('重启后保留可用旧代并提示确认修复已识别残留，正常已准备保持简洁', {
  skip: !process.env.ENGLISH_COACH_TEST_ASSETS && 'Requires explicit verified eight-asset fixture'
}, async t => {
  const h = await host(t, { online: true })
  const deadline = performance.now() + 30000
  async function waitFor(host, phase) {
    let value
    do {
      assert.ok(performance.now() < deadline, `Host reaches ${phase}`)
      value = await host.request('speech.assets.status')
      if (value.data.phase !== phase) await new Promise(resolve => setTimeout(resolve, 10))
    } while (value.data.phase !== phase)
    return value.data
  }
  assert.equal((await h.request('speech.assets.prepare')).ok, true)
  const original = await waitFor(h, 'ready')
  assert.equal(h.downloads(), 8)
  assert.equal(original.cleanupRequired, false)
  const adapter = window => {
    window.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak() { assert.fail('must not use system speech') } }
    window.SpeechSynthesisUtterance = class {}
    window.URL.createObjectURL = () => 'blob:isolated-recovery'
    window.URL.revokeObjectURL = () => {}
    window.Audio = class { play() { return Promise.resolve() } pause() {} removeAttribute() {} load() {} }
  }
  const normal = await mountClient({ request: h.request, setupWindow: adapter })
  disposeFixture(t, async () => { await normal.close(); await h.settle(normal) })
  await h.settle(normal)
  assert.equal(normal.buttons('删除资源').length, 1)
  assert.equal(normal.buttons('修复').length, 0, 'normal owner metadata is not a leftover')
  assert.equal(normal.buttons('检查资源版本').length, 0)
  const unknown = join(h.speechRoot, 'foreign-test.txt')
  await fs.writeFile(unknown, 'untrusted fixture')
  const uncertain = (await h.request('speech.assets.status')).data
  assert.equal(uncertain.assetsReady, true)
  assert.equal(uncertain.diskBytesKnown, false)
  assert.equal(uncertain.cleanupRequired, false)
  await normal.click('试听音色')
  for (let i = 0; i < 100 && h.runtimeRoots.length === 0; i++) { await normal.poll(); await h.settle(normal); await normal.flush(() => new Promise(resolve => setTimeout(resolve, 10))) }
  assert.deepEqual(h.runtimeRoots, [join(h.speechRoot, original.manifest.id)], 'unknown files do not prevent use of the verified active set')
  assert.equal(await fs.readFile(unknown, 'utf8'), 'untrusted fixture')
  assert.equal(unknown, join(h.speechRoot, 'foreign-test.txt'))
  await fs.unlink(unknown)
  await normal.close(); await h.settle(normal); await h.dispose()

  // Synthetic owned stage and pending pointer are the persisted disk state of
  // an interrupted replacement. No real profile or existing install is used.
  const generation = '12345678-1234-4234-9234-123456789abc'
  const stage = join(h.speechRoot, `.prepare-${generation}`)
  await fs.mkdir(stage)
  await fs.writeFile(join(stage, '_owner.json'), JSON.stringify({ id: original.manifest.id, generation }))
  await fs.writeFile(join(stage, 'config.json'), '{')
  await fs.writeFile(join(h.speechRoot, `.active-${generation}.json`), JSON.stringify({ id: original.manifest.id, revision: original.manifest.revision, generation }))
  const reboot = await host(t, { directory: h.base, online: true })
  const status = (await reboot.request('speech.assets.status')).data
  assert.equal(status.assetsReady, true)
  assert.equal(status.resourceGeneration, original.resourceGeneration)
  assert.equal(status.cleanupRequired, true)
  assert.equal(status.diskBytesKnown, true)
  const ui = await mountClient({ request: reboot.request, setupWindow: adapter })
  disposeFixture(t, async () => { await ui.close(); await reboot.settle(ui) })
  await reboot.settle(ui)
  assert.equal(ui.buttons('删除资源').length, 1)
  assert.equal(ui.buttons('修复').length, 1, 'owned interrupted replacement must be recoverable without deleting the valid generation')
  assert.equal(reboot.downloads(), 0)
  await ui.click('试听音色')
  for (let i = 0; i < 100 && reboot.runtimeRoots.length === 0; i++) { await ui.poll(); await reboot.settle(ui); await ui.flush(() => new Promise(resolve => setTimeout(resolve, 10))) }
  assert.deepEqual(reboot.runtimeRoots, [join(h.speechRoot, original.manifest.id)], 'old validated model is still usable')
  await ui.click('修复')
  assert.match(ui.container.querySelector('[role="dialog"]').textContent, /共享.*主机|主机.*共享/)
  await ui.click('暂不修复')
  assert.equal(reboot.downloads(), 0)
  await ui.click('修复'); await ui.click('确认重新下载并修复'); await reboot.settle(ui)
  assert.ok(reboot.calls.includes('speech.assets.repair'), 'confirmation reached the actual registered Host')
  await ui.flush(async () => { await waitFor(reboot, 'ready') })
  await ui.poll(); await reboot.settle(ui)
  assert.equal(reboot.downloads(), 8)
  assert.equal(ui.buttons('修复').length, 0)
  assert.equal(ui.buttons('删除资源').length, 1)
  const finalStatus = (await reboot.request('speech.assets.status')).data
  assert.equal(finalStatus.assetsReady, true)
  assert.equal(finalStatus.cleanupRequired, false)
  assert.deepEqual((await fs.readdir(h.speechRoot)).filter(name => name.startsWith('.prepare-') || name.startsWith('.active-')), [])
  assert.equal(reboot.calls.some(command => /review\.answer|lesson\.complete|settings\.save|speech\.assets\.delete/.test(command)), false)
})

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
