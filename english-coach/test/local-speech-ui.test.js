import assert from 'node:assert/strict'
import test from 'node:test'
import { mountClient, deferred } from './client-harness.js'

function fixture() {
  const calls = [], media = [], revoked = [], urls = []
  let phase = 'queued'
  const state = { onboarded: true, profile: { goal: 'work', minutesPerDay: 30, interests: [] }, settings: { audio: { provider: 'kokoro', kokoroVoice: 'af_heart', rate: 1 } }, review: { dueCount: 0 } }
  const assets = { phase: 'ready', assetsReady: true, runtimeAvailable: true, manifest: { revision: 'test', downloadBytes: 94453730 }, downloadedBytes: 94453730, validatedBytes: 94453730, diskBytes: 94454000 }
  const api = {
    calls, media, revoked, urls, state, assets,
    setPhase(value) { phase = value },
    setupWindow(window) {
      window.speechSynthesis = { getVoices: () => [], addEventListener() {}, removeEventListener() {}, cancel() {}, speak() { assert.fail('Kokoro never falls back to system speech') } }
      window.SpeechSynthesisUtterance = class {}
      window.URL.createObjectURL = blob => { const value = `blob:owned-${urls.length}`; urls.push({ value, blob }); return value }
      window.URL.revokeObjectURL = value => revoked.push(value)
      window.Audio = class {
        constructor() { this.src = ''; this.pauses = 0; this.plays = 0; media.push(this) }
        play() { this.plays++; return api.rejectPlay ? Promise.reject(Object.assign(new Error('requires user gesture'), { name: 'NotAllowedError' })) : Promise.resolve() }
        pause() { this.pauses++ }
        removeAttribute(name) { if (name === 'src') this.src = '' }
        load() {}
      }
    },
    async request(command, payload, options) {
      calls.push({ command, payload, options })
      if (command === 'state.get') return { ok: true, data: structuredClone(state) }
      if (command === 'settings.get') return { ok: true, data: structuredClone(state.settings) }
      if (command === 'settings.save') { Object.assign(state.settings.audio, payload.audio); return { ok: true, data: state.settings } }
      if (['study.batch', 'review.list'].includes(command)) return { ok: true, data: { items: [], dueCount: 0 } }
      if (command === 'speech.assets.status') return { ok: true, data: structuredClone(assets) }
      if (command === 'speech.synthesize') return { ok: true, data: { taskId: `task-${calls.filter(value => value.command === command).length}`, phase: 'queued' } }
      if (command === 'speech.status') return { ok: true, data: { taskId: payload.taskId, phase, error: phase === 'error' ? { code: 'speech_generation_failed', message: '生成失败，请手动重试。' } : null } }
      if (command === 'speech.audio') return new Response(Buffer.from('RIFF0000WAVE'), { headers: { 'content-type': 'audio/wav' } })
      if (command === 'speech.cancel') return { ok: true, data: { taskId: payload.taskId, phase: 'cancelled' } }
      return { ok: true, data: {} }
    }
  }
  return api
}

test('a browser play rejection keeps generated audio for an explicit manual playback retry', async t => {
  const api = fixture(); api.rejectPlay = true; api.setPhase('ready')
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  await ui.click('试听音色'); await ui.poll()
  assert.equal(api.media.length, 1)
  assert.match(ui.text(), /浏览器需要.*再次点击/)
  assert.doesNotMatch(ui.text(), /正在播放本地朗读/)
  assert.equal(ui.button('播放生成音频').disabled, false)
  api.rejectPlay = false
  await ui.click('播放生成音频')
  assert.equal(api.calls.filter(value => value.command === 'speech.synthesize').length, 1)
  assert.equal(api.calls.filter(value => value.command === 'speech.audio').length, 1)
  assert.equal(api.media[0].plays, 2)
  await ui.flush(() => api.media[0].onplaying())
  assert.match(ui.text(), /正在播放本地朗读/)
  await ui.click('停止试听')
  assert.deepEqual(api.revoked, [api.urls[0].value])
  assert.equal(api.media[0].src, '')
})

test('replacement, hidden pages and unmount cancel only their own task and ignore late callbacks', async t => {
  const api = fixture(), pendingAudio = deferred(), original = api.request
  api.setPhase('ready')
  api.request = (command, payload, options) => command === 'speech.audio' && !api.firstAudioRequested
    ? (api.firstAudioRequested = true, api.firstAudioOptions = options, pendingAudio.promise) : original(command, payload, options)
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  let closed = false
  t.after(async () => { if (!closed) await ui.close() })
  await ui.click('试听音色'); await ui.poll()
  await ui.click('试听音色'); await ui.poll()
  assert.equal(api.firstAudioOptions.signal.aborted, true)
  assert.ok(api.calls.some(value => value.command === 'speech.cancel' && value.payload.taskId === 'task-1'))
  assert.equal(api.media.length, 1)
  await ui.flush(() => pendingAudio.resolve(new Response(Buffer.from('RIFF0000WAVE'), { headers: { 'content-type': 'audio/wav' } })))
  assert.equal(api.media.length, 1, 'late old bytes do not allocate media or objectURL')
  const oldPlaying = api.media[0].onplaying, oldEnded = api.media[0].onended, oldError = api.media[0].onerror
  await ui.input('英语音色', 'kokoro:bm_george')
  await ui.flush(() => { oldPlaying(); oldEnded(); oldError() })
  assert.doesNotMatch(ui.text(), /正在播放本地朗读|试听结束|播放失败/)
  assert.equal(api.media[0].src, '')
  assert.equal(api.revoked.length, 1)
  await ui.click('试听音色'); await ui.poll()
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('pagehide')))
  assert.equal(api.media[1].src, '')
  await ui.click('试听音色'); await ui.poll()
  await ui.close(); closed = true
  assert.equal(api.media[2].src, '')
  assert.equal(api.revoked.length, 3)
  const cancels = api.calls.filter(value => value.command === 'speech.cancel')
  assert.ok(cancels.every(value => /^task-\d+$/.test(value.payload.taskId)))
})

test('resource checks update readiness without clearing an actual audition media error', async t => {
  const api = fixture(), request = api.request
  api.setPhase('ready')
  api.assets.phase = 'error' // compatible old generation is still playable while recovery is needed
  api.assets.repairRequired = true
  api.request = (command, payload, options) => command === 'speech.assets.check'
    ? Promise.resolve({ ok: true, data: structuredClone(api.assets) }) : request(command, payload, options)
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const settings = ui.container.querySelector('[aria-label="朗读设置"]')
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  await ui.click('试听音色'); await ui.poll()
  assert.equal(api.media.length, 1)
  await ui.flush(() => api.media[0].onerror())
  assert.match(settings.textContent, /播放失败/)
  await ui.click('检查资源版本')
  assert.match(settings.textContent, /播放失败/)
  assert.doesNotMatch(settings.textContent, /尚未准备/)
  assert.equal(api.calls.filter(value => value.command === 'speech.synthesize').length, 1)
  assert.equal(api.calls.filter(value => value.command === 'speech.audio').length, 1)
})

test('manual Kokoro audition shows real waiting and only media events can mark playback', async t => {
  const api = fixture()
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  const section = ui.container.querySelector('[aria-label="朗读设置"]')
  assert.equal(api.media.length, 0)
  assert.equal(api.calls.some(value => value.command === 'speech.synthesize'), false)
  await ui.input('英语音色', 'kokoro:bf_emma'); await ui.input('朗读语速', 0.5)
  assert.equal(api.calls.some(value => value.command === 'speech.synthesize'), false)
  await ui.click('试听音色')
  const request = api.calls.find(value => value.command === 'speech.synthesize')
  assert.deepEqual(request?.payload, { text: 'Hello. Let us practise English together.', voice: 'bf_emma', rate: 0.5 })
  assert.match(section.textContent, /排队/)
  assert.doesNotMatch(section.textContent, /正在播放/)
  api.setPhase('generating'); await ui.poll()
  assert.match(section.textContent, /生成/)
  api.setPhase('ready'); await ui.poll()
  assert.equal(api.media.length, 1)
  assert.equal(api.media[0].plays, 1)
  assert.match(api.media[0].src, /^blob:owned-/)
  assert.doesNotMatch(section.textContent, /正在播放/)
  await ui.flush(() => api.media[0].onplaying())
  assert.match(section.textContent, /正在播放/)
  await ui.flush(() => api.media[0].onended())
  assert.match(section.textContent, /试听结束/)
  assert.deepEqual(api.revoked, [api.urls[0].value])
  assert.equal(api.media[0].src, '')
  const speechCalls = api.calls.filter(value => value.command.startsWith('speech.'))
  const owner = speechCalls[0].options.headers['x-english-coach-speech-session']
  assert.match(owner, /^[a-f0-9]{48}$/)
  assert.ok(speechCalls.every(value => value.options.headers['x-english-coach-speech-session'] === owner))
  assert.equal(api.calls.some(value => /review.answer|lesson.complete/.test(value.command)), false)
})
