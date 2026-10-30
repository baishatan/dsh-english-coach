import assert from 'node:assert/strict'
import test from 'node:test'
import { mountClient } from './client-harness.js'

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
      if (command === 'speech.assets.status') return { ok: true, data: structuredClone(assetState) }
      if (command === 'speech.assets.prepare') {
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
  assert.match(section.textContent, /运行时尚不可用/)
  assert.match(section.textContent, /不会自动发声/)
  assert.equal(api.spoken.length, 0)
  assert.equal(api.calls.filter(call => /settings.save|review.answer|lesson.complete|speech.synth/.test(call.command)).length, 0)
})
