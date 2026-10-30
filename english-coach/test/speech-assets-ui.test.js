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
      window.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak(value) { spoken.push(value) } }
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

test('fresh prepared resources silently agree with the shared reading settings before any audition', async t => {
  const api = fixture()
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true })
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const resources = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  assert.match(resources.textContent, /资源与运行时可用/)
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
  assert.match(settings.textContent, /尚未准备.*「Kokoro 资源准备」/)
  await ui.click('准备 Kokoro')
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true, canCancel: false })
  await ui.poll()
  assert.doesNotMatch(settings.textContent, /尚未准备|正在检查/)
  assert.match(ui.container.querySelector('[aria-label="Kokoro 资源准备"]').textContent, /资源与运行时可用/)
  await ui.input('音频来源', 'web-speech')
  await ui.input('音频来源', 'kokoro')
  assert.doesNotMatch(settings.textContent, /尚未准备|正在检查/)
  assert.equal(api.calls.some(call => /speech\.(?:synthesize|audio)/.test(call.command)), false)
  assert.equal(api.spoken.length, 0)
})

test('a failed resource recheck reports uncertainty without replacing confirmed resources or implying preparation', async t => {
  const api = fixture(), request = api.request
  api.setAssets({ phase: 'ready', assetsReady: true, runtimeAvailable: true })
  api.request = (command, payload, options) => command === 'speech.assets.check'
    ? Promise.resolve({ ok: false, message: '状态读取暂时失败' }) : request(command, payload, options)
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  const resources = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  await ui.click('检查资源版本')
  assert.match(settings.textContent, /资源状态暂未确认/)
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  assert.match(resources.textContent, /资源与运行时可用/)
  assert.match(resources.textContent, /状态读取暂时失败/)
  await ui.input('音频来源', 'web-speech'); await ui.input('音频来源', 'kokoro')
  assert.match(settings.textContent, /资源状态暂未确认/)
  await ui.click('重试资源状态')
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
  await ui.click('修复 Kokoro 资源')
  const dialog = ui.container.querySelector('[role="dialog"][aria-label="确认修复 Kokoro 资源"]')
  assert.ok(dialog, 'a real visible confirmation is required')
  assert.match(dialog.textContent, /kokoro-82m-v1\.0-q8-1939ad2a8e416c0acfeecc08a694d14ef25f2231/)
  assert.match(dialog.textContent, /94,453,730/)
  assert.match(dialog.textContent, /94,519,266/)
  assert.match(dialog.textContent, /189,038,532/)
  assert.match(dialog.textContent, /共享.*主机|主机.*共享/)
  assert.match(dialog.textContent, /旧.*可用.*保留|保留.*可用.*旧/)
  assert.match(dialog.textContent, /其他页面.*失效|其他页面.*停止/)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.repair').length, 0)
  await ui.click('暂不修复')
  assert.equal(ui.container.querySelector('[role="dialog"]'), null)
  await ui.click('修复 Kokoro 资源')
  await ui.click('确认重新下载并修复')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.repair').length, 1)
  assert.equal(api.spoken.length, 0)
  assert.equal(api.calls.filter(call => /settings.save|review.answer|lesson.complete|speech.synth/.test(call.command)).length, 0)
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
  await ui.click('删除 Kokoro 资源'); await ui.click('确认删除此主机 Kokoro 资源')
  api.setAssets({ phase: 'deleting', assetsReady: false, canCancel: false })
  await ui.poll()
  api.setAssets({ phase: 'unprepared', assetsReady: false, resourceGeneration: null, downloadedBytes: 0, validatedBytes: 0, diskBytes: 0 })
  await ui.flush(async () => pending.resolve(await request('speech.assets.status', {})))
  const section = ui.container.querySelector('[aria-label="Kokoro 资源准备"]')
  assert.match(section.textContent, /尚未准备/)
  assert.doesNotMatch(section.textContent, /正在删除|下载中/)
  assert.equal(ui.button('准备 Kokoro').disabled, false)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.delete').length, 1)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 0)
})

test('visible preparation is independent of voice settings, explicit and silent through cancel and retry', async t => {
  const api = fixture()
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const section = ui.container.querySelector('section[aria-label="Kokoro 资源准备"]')
  assert.ok(section, 'standalone resource entry exists without a lesson or system voice')
  assert.match(section.textContent, /94,453,730/)
  assert.match(section.textContent, /1939ad2a/)
  assert.match(section.textContent, /DSH 主机/)
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 0)
  assert.equal(api.spoken.length, 0)
  await ui.click('准备 Kokoro')
  assert.equal(api.calls.filter(call => call.command === 'speech.assets.prepare').length, 1)
  const speechCalls = api.calls.filter(call => call.command.startsWith('speech.'))
  const owner = speechCalls[0].options?.headers?.['x-english-coach-speech-session']
  assert.match(owner ?? '', /^[a-f0-9]{48}$/, 'visible actions carry a secure shared page token')
  assert.ok(speechCalls.every(call => call.options.headers['x-english-coach-speech-session'] === owner))
  assert.equal(ui.button('取消准备').disabled, false)
  assert.equal(ui.buttons('准备 Kokoro').length, 0)
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
  await ui.click('重新准备 Kokoro')
  api.setAssets({ phase: 'error', canCancel: false, error: { message: '磁盘空间不足；请释放空间后明确重试。' } })
  await ui.poll()
  assert.match(section.textContent, /磁盘空间不足/)
  assert.equal(ui.button('重试准备 Kokoro').disabled, false)
  await ui.click('重试准备 Kokoro')
  api.setAssets({ phase: 'ready', assetsReady: true, canCancel: false, downloadedBytes: 94453730, diskBytes: 94453930, error: null })
  await ui.poll()
  assert.match(section.textContent, /资源已校验/)
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  assert.match(settings.textContent, /运行时尚不可用/)
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  assert.match(section.textContent, /运行时尚不可用/)
  assert.match(section.textContent, /不会自动发声/)
  assert.equal(api.spoken.length, 0)
  assert.equal(api.calls.filter(call => /settings.save|review.answer|lesson.complete|speech.synth/.test(call.command)).length, 0)
})
