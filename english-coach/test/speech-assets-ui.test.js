import assert from 'node:assert/strict'
import test from 'node:test'
import { mountClient, deferred } from './client-harness.js'

function fixture() {
  const calls = [], spoken = []
  let assetState = {
    phase: 'unprepared', assetsReady: false, runtimeAvailable: false,
    manifest: { revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231', downloadBytes: 94453730 },
    downloadedBytes: 0, validatedBytes: 0, diskBytes: 0, canCancel: false
  }
  const api = {
    calls, spoken,
    setAssets(value) { assetState = { ...assetState, ...value } },
    setupWindow(window) {
      window.speechSynthesis = { getVoices: () => [{ voiceURI: 'fixture-system', name: 'Shelley', lang: 'en-US', localService: true }], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(value) { spoken.push(value) } }
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
    },
    async request(command, payload, options) {
      calls.push({ command, payload, options })
      if (command === 'state.get') return { ok: true, data: { onboarded: true, profile: { goal: 'work', minutesPerDay: 30, interests: [] }, settings: { audio: {} }, review: { dueCount: 0 } } }
      if (command === 'settings.get') return { ok: true, data: { audio: {} } }
      if (command === 'study.batch' || command === 'review.list') return { ok: true, data: { items: [], dueCount: 0 } }
      if (command === 'speech.assets.status' || command === 'speech.assets.check') return { ok: true, data: structuredClone(assetState) }
      if (command === 'speech.assets.prepare' || command === 'speech.assets.repair') {
        assetState = { ...assetState, phase: 'preparing', canCancel: true, error: null }
        return { ok: true, data: structuredClone(assetState) }
      }
      if (command === 'speech.assets.cancel') {
        assetState = { ...assetState, phase: 'cancelled', canCancel: false }
        return { ok: true, data: structuredClone(assetState) }
      }
      return { ok: true, data: {} }
    }
  }
  return api
}

test('准备只在本地音色下出现，切到系统期间进度保留，完成后可确认删除', async t => {
  const api = fixture(), setup = api.setupWindow, request = api.request
  api.setupWindow = window => {
    setup(window)
    window.speechSynthesis.getVoices = () => [{ voiceURI: 'fixture-system', name: 'Shelley', lang: 'en-US', localService: true }]
  }
  api.request = async (command, payload, options) => {
    if (command === 'speech.assets.delete') {
      api.calls.push({ command, payload, options })
      api.setAssets({ phase: 'unprepared', assetsReady: false, downloadedBytes: 0, canCancel: false })
      return request('speech.assets.status', {}, options)
    }
    return request(command, payload, options)
  }
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  const resources = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.ok(settings.contains(resources), '准备紧贴同一朗读设置卡')
  assert.match(resources.textContent, /94\.5 MB/)
  assert.equal(ui.buttons('删除资源').length, 0)
  assert.equal(api.calls.some(call => /speech.assets.prepare|speech.synthesize/.test(call.command)), false)
  await ui.click('准备')
  api.setAssets({ phase: 'downloading', downloadedBytes: 42000, canCancel: true })
  await ui.poll()
  assert.equal(resources.querySelector('progress').value, 42000)
  assert.equal(resources.querySelector('progress').max, 94453730)
  const menu = ui.field('英语音色')
  const system = [...menu.options].find(option => /Shelley.*en-US/.test(option.textContent))
  const heart = [...menu.options].find(option => /Heart.*（本地）/.test(option.textContent))
  await ui.input(menu, system.value)
  assert.equal(ui.buttons('取消准备').length, 0)
  api.setAssets({ phase: 'downloading', downloadedBytes: 84000, canCancel: true })
  await ui.poll()
  await ui.input(menu, heart.value)
  assert.equal(resources.querySelector('progress').value, 84000)
  await ui.click('取消准备')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.cancel').length, 1)
  await ui.click('准备')
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true, canCancel: false })
  await ui.poll()
  assert.equal(ui.buttons('准备').length, 0)
  await ui.click('删除资源')
  assert.match(ui.container.querySelector('[role="dialog"]').textContent, /共享.*主机|主机.*共享/)
  await ui.click('暂不删除')
  assert.equal(api.calls.some(call => call.command === 'speech.assets.delete'), false)
  await ui.click('删除资源'); await ui.click('确认删除此主机 Kokoro 资源')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.delete').length, 1)
  assert.equal(ui.buttons('准备').length, 1)
  assert.equal(api.spoken.length, 0)
})

test('准备遇到跨页变更时保留失败提示并刷新当前状态，不自动重试', async t => {
  const api = fixture(), request = api.request
  api.request = (command, payload, options) => {
    if (command === 'speech.assets.prepare') {
      api.calls.push({ command, payload, options })
      api.setAssets({ phase: 'error', repairRequired: true, error: { message: '资源损坏' } })
      return Promise.resolve({ ok: false, code: 'speech_repair_required', message: '资源需修复，请确认后重试。' })
    }
    return request(command, payload, options)
  }
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  await ui.click('准备')
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.match(section.textContent, /资源需修复，请确认后重试/)
  assert.equal(ui.buttons('修复').length, 1)
  assert.equal(ui.buttons('准备').length, 0)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 1)
  assert.equal(api.calls.some(call => call.command === 'speech.assets.repair'), false)
})

test('另一页面刚开始准备且无取消权时可确认删除共享资源，取消确认无副作用', async t => {
  const api = fixture(), request = api.request
  api.setAssets({ phase: 'preparing', assetsReady: false, canCancel: false, downloadedBytes: 0, diskBytes: 0 })
  api.request = async (command, payload, options) => {
    if (command === 'speech.assets.delete') {
      api.calls.push({ command, payload, options })
      api.setAssets({ phase: 'unprepared', assetsReady: false, canCancel: false })
      return request('speech.assets.status', {}, options)
    }
    return request(command, payload, options)
  }
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.match(section.textContent, /另一页面正在准备/)
  assert.equal(ui.buttons('取消准备').length, 0)
  await ui.click('删除资源')
  const dialog = ui.container.querySelector('[role="dialog"][aria-label="确认删除 Kokoro 资源"]')
  assert.match(dialog.textContent, /共享.*主机|主机.*共享/)
  await ui.click('暂不删除')
  assert.equal(api.calls.some(call => call.command === 'speech.assets.delete'), false)
  await ui.click('删除资源'); await ui.click('确认删除此主机 Kokoro 资源')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.delete').length, 1)
  assert.equal(ui.buttons('准备').length, 1)
  assert.equal(api.calls.some(call => /speech\.assets\.prepare|speech\.synthesize/.test(call.command)), false)
})

test('跨页删除遇到慢状态响应时轮询不会饿死，最终恢复准备入口', async t => {
  const api = fixture(), request = api.request, slow = []
  api.setAssets({ phase: 'deleting', assetsReady: false, canCancel: false, diskBytes: 100 })
  let delayStatus = false
  api.request = (command, payload, options) => {
    if (command === 'speech.assets.status' && delayStatus) {
      const pending = deferred()
      slow.push(pending)
      return pending.promise
    }
    return request(command, payload, options)
  }
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(async () => {
    await ui.close()
    for (const pending of slow) pending.resolve({ ok: false, message: 'fixture closed' })
  })
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.match(section.textContent, /正在删除/)
  delayStatus = true
  await ui.poll() // 1s: first slow request starts
  await ui.poll() // 2s: still pending; no overlapping status read
  await ui.poll() // 3s: still pending
  delayStatus = false
  api.setAssets({ phase: 'unprepared', assetsReady: false, diskBytes: 0 })
  await ui.flush(async () => slow[0].resolve(await request('speech.assets.status', {})))
  assert.equal(ui.buttons('准备').length, 1, 'a slow response still updates the visible state')
  assert.doesNotMatch(section.textContent, /正在删除/)
  assert.equal(slow.length, 1, 'status reads are single-flight rather than an unbounded queue')
  assert.equal(api.calls.some(call => /speech\.assets\.(prepare|delete)|speech\.synthesize/.test(call.command)), false)
})

test('跨页删除进行中继续读取直至完成，中断残留可确认删除，修复失败可重试', async t => {
  const api = fixture()
  api.setAssets({ phase: 'deleting', assetsReady: false, canCancel: false, diskBytes: 100 })
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.match(section.textContent, /正在删除/)
  assert.equal(ui.buttons('取消准备').length, 0)
  api.setAssets({ phase: 'unprepared', diskBytes: 0 })
  await ui.poll()
  assert.equal(ui.buttons('准备').length, 1)
  api.setAssets({ phase: 'interrupted', downloadedBytes: 0, diskBytes: 100 })
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('focus')))
  assert.equal(ui.buttons('删除资源').length, 1)
  await ui.click('删除资源'); await ui.click('暂不删除')
  assert.equal(api.calls.some(call => call.command === 'speech.assets.delete'), false)
  api.setAssets({ phase: 'error', operation: 'repair', assetsReady: true, repairRequired: false })
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('focus')))
  assert.equal(ui.buttons('修复').length, 1)
  await ui.click('修复'); await ui.click('暂不修复')
  assert.equal(api.calls.some(call => /speech\.assets\.(prepare|repair)/.test(call.command)), false)
})

test('试听前发现外页删除或损坏时资源区同步更新，手动准备或修复之前不会下载', async t => {
  const api = fixture()
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true })
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  api.setAssets({ phase: 'unprepared', assetsReady: false })
  await ui.click('试听音色')
  assert.equal(ui.buttons('准备').length, 1)
  assert.equal(ui.buttons('删除资源').length, 0)
  api.setAssets({ phase: 'error', assetsReady: false, repairRequired: true, error: { message: '资源损坏' } })
  await ui.click('试听音色')
  assert.equal(ui.buttons('修复').length, 1)
  assert.match(ui.container.querySelector('[aria-label="Kokoro 资源准备"]').textContent, /资源损坏/)
  assert.equal(api.calls.some(call => /speech\.assets\.(prepare|repair)|speech\.synthesize/.test(call.command)), false)
})

test('本地音色闲置期间外页删除，重新关注音色或返回窗口可刷新资源状态', async t => {
  const api = fixture()
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true })
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  assert.equal(ui.buttons('删除资源').length, 1)
  api.setAssets({ phase: 'unprepared', assetsReady: false })
  await ui.flush(() => ui.field('英语音色').focus())
  assert.equal(ui.buttons('准备').length, 1)
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true })
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('focus')))
  assert.equal(ui.buttons('删除资源').length, 1)
  assert.equal(api.calls.some(call => /speech\.assets\.(prepare|delete)|speech\.synthesize/.test(call.command)), false)
  assert.equal(api.spoken.length, 0)
})

test('切回本地音色会重新读取别页删除或准备后的共享状态，保持静默', async t => {
  const api = fixture()
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true })
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  assert.equal(ui.buttons('删除资源').length, 1)
  await ui.input('英语音色', 'system:fixture-system')
  assert.equal(ui.buttons('删除资源').length, 0)
  api.setAssets({ phase: 'unprepared', assetsReady: false, downloadedBytes: 0 }) // another page removed it
  await ui.input('英语音色', 'kokoro:af_heart')
  assert.equal(ui.buttons('准备').length, 1)
  assert.equal(ui.buttons('删除资源').length, 0)
  await ui.input('英语音色', 'system:fixture-system')
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true }) // another page prepared it
  await ui.input('英语音色', 'kokoro:af_heart')
  assert.equal(ui.buttons('准备').length, 0)
  assert.equal(ui.buttons('删除资源').length, 1)
  assert.equal(api.calls.some(call => /speech\.assets\.(prepare|delete)|speech\.synthesize/.test(call.command)), false)
  assert.equal(api.spoken.length, 0)
})

test('fresh prepared resources silently agree with the shared reading settings before any audition', async t => {
  const api = fixture()
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true })
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const resources = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  assert.match(resources.textContent, /资源已校验/)
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  assert.equal(api.calls.some(call => /speech\.(?:synthesize|audio)|speech\.assets\.(?:prepare|repair)/.test(call.command)), false)
  assert.equal(api.spoken.length, 0)
})

test('unknown resource status says checking until preparation completes silently and survives provider changes', async t => {
  const api = fixture(), pending = deferred(), request = api.request
  api.request = (command, payload, options) => command === 'speech.assets.status' && !api.firstStatusReturned
    ? pending.promise : request(command, payload, options)
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  assert.match(settings.textContent, /正在检查.*资源/)
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  api.firstStatusReturned = true
  await ui.flush(() => pending.resolve({ ok: true, data: { phase: 'unprepared', assetsReady: false, runtimeAvailable: true, manifest: { revision: 'fixed', downloadBytes: 94453730 } } }))
  assert.match(settings.textContent, /尚未准备.*「准备」/)
  await ui.click('准备')
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true, canCancel: false })
  await ui.poll()
  assert.doesNotMatch(settings.textContent, /尚未准备|正在检查/)
  assert.match(ui.container.querySelector('[aria-label="Kokoro 资源准备"]').textContent, /资源已校验/)
  await ui.input('英语音色', 'system:fixture-system')
  await ui.input('英语音色', 'kokoro:af_heart')
  assert.doesNotMatch(settings.textContent, /尚未准备|正在检查/)
  assert.equal(api.calls.some(call => /speech\.(?:synthesize|audio)/.test(call.command)), false)
  assert.equal(api.spoken.length, 0)
})

test('a failed resource recheck reports uncertainty without replacing confirmed resources or implying preparation', async t => {
  const api = fixture(), request = api.request
  api.setAssets({ phase: 'error', assetsReady: true, runtimeAvailable: true, repairRequired: true })
  api.request = (command, payload, options) => command === 'speech.assets.check'
    ? Promise.resolve({ ok: false, message: '状态读取暂时失败' }) : request(command, payload, options)
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  const resources = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  await ui.click('检查资源版本')
  assert.match(settings.textContent, /资源状态暂未确认/)
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  assert.match(resources.textContent, /资源损坏或不兼容/)
  assert.match(resources.textContent, /状态读取暂时失败/)
  await ui.click('重试资源状态')
  assert.doesNotMatch(settings.textContent, /尚未准备|暂未确认/)
  await ui.input('英语音色', 'system:fixture-system'); await ui.input('英语音色', 'kokoro:af_heart')
  assert.doesNotMatch(settings.textContent, /尚未准备|暂未确认/)
  assert.equal(api.calls.some(call => /speech\.(?:synthesize|audio)|speech\.assets\.(?:prepare|repair)/.test(call.command)), false)
  assert.equal(api.spoken.length, 0)
})

test('resource repair discloses the fixed target and shared-host impact before explicit confirmation', async t => {
  const api = fixture()
  api.setAssets({ phase: 'error', assetsReady: false, repairRequired: true,
    error: { message: '资源校验失败；请明确修复。' },
    manifest: { id: 'kokoro-82m-v1.0-q8-1939ad2a8e416c0acfeecc08a694d14ef25f2231', revision: '1939ad2a8e416c0acfeecc08a694d14ef25f2231', downloadBytes: 94453730 },
    update: { additionalDiskBytes: 94519266, maximumAssetBytes: 189038532, message: '没有已知更新；未联网检查。' }
  })
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  await ui.click('检查资源版本')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.check').length, 1)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.repair').length, 0)
  await ui.click('修复')
  const dialog = ui.container.querySelector('[role="dialog"][aria-label="确认修复 Kokoro 资源"]')
  assert.ok(dialog, 'a real visible confirmation is required')
  assert.match(dialog.textContent, /固定版本.*94\.5 MB/)
  assert.match(dialog.textContent, /额外.*94\.5 MB/)
  assert.match(dialog.textContent, /共享.*主机|主机.*共享/)
  assert.match(dialog.textContent, /可用.*旧.*保留|保留.*可用.*旧/)
  assert.match(dialog.textContent, /其他页面.*失效|停止其他页面/)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.repair').length, 0)
  await ui.click('暂不修复')
  assert.equal(ui.container.querySelector('[role="dialog"]'), null)
  await ui.click('修复')
  await ui.click('确认重新下载并修复')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.repair').length, 1)
  assert.equal(api.spoken.length, 0)
  assert.equal(api.calls.filter(call => /settings.save|review.answer|lesson.complete|speech.synth/.test(call.command)).length, 0)
})

test('过期的慢状态读取结束后，切回本地仍会按最新共享状态刷新', async t => {
  const api = fixture(), request = api.request, slow = deferred()
  api.setAssets({ phase: 'downloading', assetsReady: false, canCancel: true, downloadedBytes: 100 })
  let delayStatus = false
  api.request = (command, payload, options) => command === 'speech.assets.status' && delayStatus
    ? slow.promise : request(command, payload, options)
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(async () => { await ui.close(); slow.resolve({ ok: false, message: 'fixture closed' }) })
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  delayStatus = true
  await ui.poll()
  delayStatus = false
  await ui.click('取消准备')
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true, canCancel: false })
  await ui.input('英语音色', 'system:fixture-system')
  await ui.input('英语音色', 'kokoro:af_heart')
  await ui.flush(() => slow.resolve({ ok: true, data: {
    phase: 'downloading', assetsReady: false, canCancel: true, downloadedBytes: 100,
    manifest: { revision: 'fixture', downloadBytes: 94453730 }
  } }))
  assert.match(section.textContent, /资源已校验/)
  assert.equal(ui.buttons('删除资源').length, 1)
  assert.equal(ui.buttons('准备').length, 0)
  assert.equal(api.calls.some(call => /speech\.assets\.(prepare|delete)|speech\.synthesize/.test(call.command)), false)
})

test('慢状态读取早于明确取消或删除时不能覆盖用户操作结果', async t => {
  for (const action of ['cancel', 'delete']) {
    const api = fixture(), request = api.request, slow = deferred()
    api.setAssets({ phase: 'downloading', assetsReady: false, canCancel: true, downloadedBytes: 100 })
    let delayStatus = false
    api.request = (command, payload, options) => {
      if (command === 'speech.assets.status' && delayStatus) return slow.promise
      if (command === 'speech.assets.delete') {
        api.calls.push({ command, payload, options })
        api.setAssets({ phase: 'unprepared', assetsReady: false, canCancel: false, downloadedBytes: 0 })
        return request('speech.assets.status', {}, options)
      }
      return request(command, payload, options)
    }
    const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
    t.after(async () => { await ui.close(); slow.resolve({ ok: false, message: 'fixture closed' }) })
    const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
    delayStatus = true
    await ui.poll()
    delayStatus = false
    if (action === 'cancel') await ui.click('取消准备')
    else { await ui.click('删除资源'); await ui.click('确认删除此主机 Kokoro 资源') }
    assert.equal(api.calls.filter(call => call.command === `speech.assets.${action}`).length, 1)
    assert.match(section.textContent, action === 'cancel' ? /已取消/ : /尚未准备/)
    await ui.flush(() => slow.resolve({ ok: true, data: {
      phase: 'downloading', assetsReady: false, canCancel: true, downloadedBytes: 100,
      manifest: { revision: 'fixture', downloadBytes: 94453730 }
    } }))
    assert.doesNotMatch(section.textContent, /下载中/)
    assert.match(section.textContent, action === 'cancel' ? /已取消/ : /尚未准备/)
    assert.equal(ui.buttons('准备').length, 1)
    await ui.close()
  }
})

test('confirmed deletion during a download cannot lose its final result to the existing progress poll', async t => {
  const api = fixture(), pending = deferred(), request = api.request
  api.setAssets({ phase: 'downloading', canCancel: true, downloadedBytes: 1 })
  api.request = (command, payload, options) => {
    if (command === 'speech.assets.delete') { api.calls.push({ command, payload, options }); return pending.promise }
    return request(command, payload, options)
  }
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  await ui.click('删除资源'); await ui.click('确认删除此主机 Kokoro 资源')
  api.setAssets({ phase: 'deleting', assetsReady: false, canCancel: false })
  await ui.poll()
  api.setAssets({ phase: 'unprepared', assetsReady: false, resourceGeneration: null, downloadedBytes: 0, validatedBytes: 0, diskBytes: 0 })
  await ui.flush(async () => pending.resolve(await request('speech.assets.status', {})))
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.match(section.textContent, /尚未准备/)
  assert.doesNotMatch(section.textContent, /正在删除|下载中/)
  assert.equal(ui.button('准备').disabled, false)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.delete').length, 1)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 0)
})

test('visible local preparation remains explicit and silent through cancel and retry', async t => {
  const api = fixture()
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const section = ui.container.querySelector('section[aria-label="Kokoro 资源准备"]')
  assert.ok(section, 'resource entry is within reading settings without requiring a lesson')
  assert.match(section.textContent, /94\.5 MB/)
  assert.doesNotMatch(section.textContent, /1939ad2a|94,453,730/)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 0)
  assert.equal(api.spoken.length, 0)
  await ui.click('准备')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 1)
  const speechCalls = api.calls.filter(call => call.command.startsWith('speech.'))
  const owner = speechCalls[0].options?.headers?.['x-english-coach-speech-session']
  assert.match(owner ?? '', /^[a-f0-9]{48}$/, 'visible actions carry a secure shared page token')
  assert.ok(speechCalls.every(call => call.options.headers['x-english-coach-speech-session'] === owner))
  assert.equal(ui.button('取消准备').disabled, false)
  assert.equal(ui.buttons('准备').length, 0)
  api.setAssets({ phase: 'downloading', currentFile: 'onnx/model_quantized.onnx', downloadedBytes: 42000 })
  await ui.poll()
  assert.match(section.textContent, /42,000.*94,453,730/)
  const progress = section.querySelector('progress')
  assert.ok(progress)
  assert.equal(progress.value, 42000)
  assert.equal(progress.max, 94453730)
  await ui.click('取消准备')
  assert.match(section.textContent, /已取消/)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 1)
  await ui.click('准备')
  api.setAssets({ phase: 'error', canCancel: false, error: { message: '磁盘空间不足；请释放空间后明确重试。' } })
  await ui.poll()
  assert.match(section.textContent, /磁盘空间不足/)
  assert.equal(ui.button('准备').disabled, false)
  await ui.click('准备')
  api.setAssets({ phase: 'ready', assetsReady: true, canCancel: false, downloadedBytes: 94453730, diskBytes: 94453930, error: null })
  await ui.poll()
  assert.match(section.textContent, /资源已校验/)
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  assert.match(settings.textContent, /运行时尚不可用/)
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  assert.match(section.textContent, /运行时尚不可用/)
  assert.equal(api.spoken.length, 0)
  assert.equal(api.calls.filter(call => /settings.save|review.answer|lesson.complete|speech.synth/.test(call.command)).length, 0)
})
