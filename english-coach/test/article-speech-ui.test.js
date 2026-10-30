import assert from 'node:assert/strict'
import test from 'node:test'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const local = { voiceURI: 'article-local', name: 'Shelley', lang: 'en-US', localService: true }
const british = { voiceURI: 'article-british', name: 'Reed', lang: 'en-GB', localService: true }
function fixture() {
  const calls = [], media = [], urls = [], revoked = [], bookmarks = new Map(), spoken = []
  const state = {
    onboarded: true, profile: { goal: 'work', minutesPerDay: 30, interests: [] },
    settings: { audio: { provider: 'kokoro', kokoroVoice: 'af_heart', voiceURI: local.voiceURI, rate: 1 } }, review: { dueCount: 0 },
    todayLesson: { date: '2026-10-22', title: '非个人文章', status: 'active', sources: [], items: [
      { id: 'read', type: 'reading', title: '阅读文章', body: 'A small bird landed. It rested near the river. Then it flew home.', translations: ['一只小鸟落下。它在河边休息。然后飞回家。'] },
      { id: 'listen', type: 'listening', title: '听力文稿', transcript: 'The train arrived. The doors opened slowly. Everyone stepped outside.', translations: ['列车到了。车门缓缓打开。大家走了出来。'] }
    ] }
  }
  const synth = new EventTarget()
  Object.assign(synth, { spoken, paused: false, speaking: false, getVoices: () => [local, british],
    speak(value) { this.speaking = true; this.paused = false; spoken.push(value) },
    pause() { this.paused = true }, resume() { this.paused = false; spoken.at(-1)?.onresume?.() }, cancel() { this.speaking = this.paused = false } })
  const api = {
    state, calls, media, urls, revoked, bookmarks, synth, phase: 'queued', ready: true,
    setupWindow(window) {
      window.speechSynthesis = synth
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
      window.URL.createObjectURL = blob => { const url = `blob:article-${urls.length}`; urls.push({ url, blob }); return url }
      window.URL.revokeObjectURL = url => revoked.push(url)
      window.Audio = class {
        constructor() { this.src = ''; this.plays = 0; this.pauses = 0; this.currentTime = 0; media.push(this) }
        play() { this.plays++; return api.rejectPlay ? Promise.reject(new Error('user gesture required')) : Promise.resolve() }
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
      if (command === 'speech.assets.status') return { ok: true, data: { phase: api.ready ? 'ready' : 'unprepared', assetsReady: api.ready, runtimeAvailable: true, manifest: { revision: 'test', downloadBytes: 94453730 }, downloadedBytes: 94453730, validatedBytes: 94453730, diskBytes: 94453730 } }
      if (command === 'speech.synthesize') return { ok: true, data: { taskId: `task-${calls.filter(value => value.command === command).length}`, phase: 'queued' } }
      if (command === 'speech.status') return { ok: true, data: { taskId: payload.taskId, phase: api.phase, error: api.phase === 'error' ? { code: 'TEXT_TOO_LONG', message: '这段英文超过本地合成上限，请缩短后手动重试。' } : null } }
      if (command === 'speech.audio') return new Response(Buffer.from('RIFF0000WAVE'), { headers: { 'content-type': 'audio/wav' } })
      if (command === 'speech.cancel') return { ok: true, data: { taskId: payload.taskId, phase: 'cancelled' } }
      if (command === 'audio.bookmark.get') {
        const saved = bookmarks.get(payload.materialId)
        return { ok: true, data: { bookmark: saved?.contentFingerprint === payload.contentFingerprint ? saved : null, invalidated: !!saved && saved.contentFingerprint !== payload.contentFingerprint } }
      }
      if (command === 'audio.bookmark.save') { bookmarks.set(payload.materialId, structuredClone(payload)); return { ok: true, data: { bookmark: payload } } }
      return { ok: true, data: {} }
    }
  }
  return api
}
const requests = api => api.calls.filter(value => value.command === 'speech.synthesize' && value.payload.priority !== 'prefetch')
const prefetches = api => api.calls.filter(value => value.command === 'speech.synthesize' && value.payload.priority === 'prefetch')
const body = ui => ui.container.querySelector('.ec-item-body')
const row = (ui, title) => [...ui.container.querySelectorAll('.ec-li')].find(value => value.textContent.includes(title))
async function open(t, api = fixture()) {
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow })
  t.after(() => ui.close())
  return { ui, api }
}
async function ready(ui, api) { api.phase = 'ready'; await ui.poll() }

test('visible resource removal requires a second confirmation before stopping the caller and silently preserves its article', async t => {
  const api = fixture(), request = api.request
  api.request = async (command, payload, options) => {
    if (command === 'speech.assets.delete') { api.ready = false; api.calls.push({ command, payload, options }); return request('speech.assets.status', {}, options) }
    return request(command, payload, options)
  }
  const { ui } = await open(t, api)
  await ui.click('播放'); await ready(ui, api)
  await ui.flush(() => { api.media[0].onplaying(); api.media[0].onended() })
  await ready(ui, api)
  const current = api.media.at(-1)
  await ui.flush(() => current.onplaying())
  const ended = current.onended, playing = current.onplaying
  const before = requests(api).length, writes = api.calls.filter(value => value.command === 'settings.save').length
  await ui.click('删除 Kokoro 资源')
  const dialog = ui.container.querySelector('[role="dialog"][aria-label="确认删除 Kokoro 资源"]')
  assert.ok(dialog)
  assert.match(dialog.textContent, /共享.*DSH.*主机|DSH.*主机.*共享/)
  assert.match(dialog.textContent, /其他.*页面/)
  assert.match(dialog.textContent, /断线.*(?:无法|不能).*立即|断线.*不能.*瞬间/)
  assert.notEqual(current.src, '', 'opening confirmation must not pause or stop audio')
  assert.match(body(ui).textContent, /播放中/)
  assert.equal(api.calls.some(value => value.command === 'speech.assets.delete'), false)
  await ui.click('暂不删除')
  assert.notEqual(current.src, '')
  assert.match(body(ui).textContent, /播放中/)
  await ui.click('删除 Kokoro 资源'); await ui.click('确认删除此主机 Kokoro 资源')
  assert.equal(api.calls.filter(value => value.command === 'speech.assets.delete').length, 1)
  assert.equal(current.src, '')
  assert.equal(ui.field('文本进度').value, '1')
  assert.match(body(ui).textContent, /已暂停/)
  assert.match(ui.container.querySelector('[aria-label="朗读设置"]').textContent, /尚未准备/)
  assert.match(ui.container.querySelector('[aria-label="Kokoro 资源准备"]').textContent, /尚未准备/)
  await ui.flush(() => { ended(); playing() }); await ui.poll()
  assert.equal(requests(api).length, before)
  assert.equal(ui.field('文本进度').value, '1')
  assert.equal(api.bookmarks.values().next().value.position, 1)
  assert.equal(api.calls.filter(value => value.command === 'settings.save').length, writes)
  assert.equal(api.calls.some(value => /speech.assets.prepare|review.answer|lesson.complete/.test(value.command)), false)
})

test('the same active heartbeat stops remote playing paused and queued Kokoro on resource invalidation, not task TTL', async t => {
  for (const mode of ['playing', 'paused', 'queued']) {
    const api = fixture(), request = api.request
    let heartbeat = { active: false, leaseMs: 15000, assetsReady: true, resourceGeneration: 'original' }
    api.request = async (command, payload, options) => {
      if (command === 'speech.session.touch') { api.calls.push({ command, payload, options }); return { ok: true, data: { ...heartbeat } } }
      const response = await request(command, payload, options)
      if (command === 'speech.assets.status') response.data.resourceGeneration = 'original'
      return response
    }
    const { ui } = await open(t, api)
    await ui.input('文本进度', 1)
    await ui.click('播放')
    if (mode !== 'queued') { await ready(ui, api); await ui.flush(() => api.media.at(-1).onplaying()) }
    if (mode === 'paused') await ui.click('暂停')
    const current = api.media.at(-1), ended = current?.onended, playing = current?.onplaying
    const before = requests(api).length
    await ui.poll()
    assert.equal(ui.field('文本进度').value, '1')
    assert.equal(current?.src === '', false, 'absolute task TTL alone does not invalidate delivered media')
    if (mode === 'playing') assert.match(body(ui).textContent, /播放中/)
    heartbeat = mode === 'paused'
      ? { ...heartbeat, resourceGeneration: 'new-installation' } // Same-ready new generation is also invalid.
      : { ...heartbeat, assetsReady: false, resourceGeneration: null }
    api.ready = heartbeat.assetsReady
    await ui.poll()
    assert.equal(current?.src ?? '', '')
    assert.equal(ui.field('文本进度').value, '1')
    assert.match(body(ui).textContent, /已暂停/)
    assert.match(body(ui).textContent, /资源已失效/)
    if (mode === 'paused') assert.doesNotMatch(ui.container.querySelector('[aria-label="朗读设置"]').textContent, /运行时尚不可用/, 'partial touch must not invent runtimeAvailable=false')
    else assert.match(ui.container.querySelector('[aria-label="朗读设置"]').textContent, /尚未准备/)
    await ui.flush(() => { ended?.(); playing?.() }); api.phase = 'ready'; await ui.poll()
    assert.equal(requests(api).length, before, 'no stale continuation or automatic retry')
    assert.equal(api.bookmarks.values().next().value.position, 1)
    assert.equal(api.calls.some(value => /speech.assets.prepare|settings.save|review.answer|lesson.complete/.test(value.command)), false)
    await ui.close()
  }
})

test('confirmed resource deletion leaves active system speech and its position untouched even on a storage failure', async t => {
  const api = fixture(), request = api.request
  let completed = false
  api.state.settings.audio.provider = 'web-speech'
  api.request = async (command, payload, options) => {
    if (command === 'speech.assets.delete') { api.calls.push({ command, payload, options }); completed = true; return { ok: false, code: 'speech_storage', message: '删除未完成；无法清理归属资源，请检查主机权限后明确重试。' } }
    return request(command, payload, options)
  }
  const { ui } = await open(t, api)
  await ui.input('文本进度', 1); await ui.click('播放')
  const utterance = api.synth.spoken.at(-1)
  const before = api.synth.spoken.length
  assert.equal(api.synth.speaking, true)
  await ui.click('删除 Kokoro 资源'); await ui.click('确认删除此主机 Kokoro 资源')
  assert.equal(completed, true)
  assert.equal(api.synth.speaking, true, 'Kokoro global removal must not call system cancel')
  assert.equal(api.synth.spoken.length, before)
  assert.equal(ui.field('文本进度').value, '1')
  assert.equal(ui.field('音频来源').value, 'web-speech')
  assert.match(ui.container.querySelector('[aria-label="Kokoro 资源准备"]').textContent, /删除未完成/)
  await ui.flush(() => utterance.onend())
  assert.equal(ui.field('文本进度').value, '2', 'system reading continues normally')
})

test('Kokoro articles request only English segments and advance only after audible media ends', async t => {
  const { ui, api } = await open(t)
  assert.equal(requests(api).length, 0, 'opening the article is silent')
  await ui.click('播放')
  assert.deepEqual(requests(api)[0]?.payload, { text: 'A small bird landed.', voice: 'af_heart', rate: 1 })
  assert.match(body(ui).textContent, /排队/)
  assert.doesNotMatch(body(ui).textContent, /播放中/)
  assert.equal(ui.button('播放').disabled, true)
  assert.equal(ui.button('暂停').disabled, false)
  await ready(ui, api)
  assert.equal(api.media.length, 1)
  assert.equal(api.media[0].plays, 1)
  assert.equal(ui.field('文本进度').value, '0')
  assert.doesNotMatch(body(ui).textContent, /播放中/)
  await ui.flush(() => api.media[0].onplaying())
  assert.match(body(ui).textContent, /播放中/)
  await ui.flush(() => api.media[0].onended())
  assert.equal(ui.field('文本进度').value, '1')
  assert.equal(requests(api).at(-1).payload.text, 'It rested near the river.')
  assert.equal(api.synth.spoken.length, 0)
  assert.ok(requests(api).every(value => !/[\u3400-\u9fff]/.test(value.payload.text)))
  assert.equal(api.calls.some(value => /review.answer|lesson.complete|speech.assets.prepare/.test(value.command)), false)
})

test('reading and listening retain the current media through three pauses and finish without looping', async t => {
  const { ui, api } = await open(t)
  for (const [title, first, second] of [['阅读文章', 'A small bird landed.', 'It rested near the river.'], ['听力文稿', 'The train arrived.', 'The doors opened slowly.']]) {
    if (title === '听力文稿') await ui.click(row(ui, title))
    assert.equal(ui.field('文本进度').value, '0')
    await ui.click('播放'); await ready(ui, api)
    assert.equal(requests(api).at(-1).payload.text, first)
    await ui.flush(() => { api.media.at(-1).onplaying(); api.media.at(-1).onended() })
    await ready(ui, api)
    const current = api.media.at(-1), count = requests(api).length
    assert.equal(requests(api).at(-1).payload.text, second)
    await ui.flush(() => current.onplaying())
    current.currentTime = 1.25
    for (let n = 0; n < 3; n++) {
      const ended = current.onended, playing = current.onplaying
      await ui.click('暂停')
      assert.match(body(ui).textContent, /已暂停/)
      assert.equal(current.src, api.urls.at(-1).url)
      await ui.flush(() => { ended(); playing() })
      assert.equal(ui.field('文本进度').value, '1')
      assert.match(body(ui).textContent, /已暂停/)
      await ui.click('继续')
      assert.equal(requests(api).length, count, 'resume does not synthesize the segment again')
      assert.equal(current.currentTime, 1.25)
      assert.doesNotMatch(body(ui).textContent, /播放中/)
      await ui.flush(() => current.onplaying())
      assert.match(body(ui).textContent, /播放中/)
    }
    await ui.flush(() => current.onended()); await ready(ui, api)
    await ui.flush(() => { api.media.at(-1).onplaying(); api.media.at(-1).onended() })
    assert.equal(ui.field('文本进度').value, '3')
    assert.match(body(ui).textContent, /朗读已完成/)
    const finished = requests(api).length
    await ui.poll()
    assert.equal(requests(api).length, finished)
    await ui.click('从头播放')
    assert.equal(requests(api).at(-1).payload.text, first)
  }
})

test('seeks and configuration preserve queued intent but paused changes remain silent', async t => {
  const { ui, api } = await open(t)
  await ui.click('播放')
  await ui.input('文本进度', 2)
  assert.equal(requests(api).at(-1).payload.text, 'Then it flew home.')
  for (const rate of [0.5, 1, 1.5, 2]) {
    await ui.input('朗读语速', rate)
    assert.deepEqual(requests(api).at(-1).payload, { text: 'Then it flew home.', voice: 'af_heart', rate })
    assert.match(body(ui).textContent, /排队/)
  }
  await ui.input('英语音色', 'bm_george')
  assert.equal(requests(api).at(-1).payload.voice, 'bm_george')
  api.phase = 'generating'; await ui.poll()
  assert.match(body(ui).textContent, /生成/)
  await ui.input('文本进度', 1)
  assert.equal(requests(api).at(-1).payload.text, 'It rested near the river.')
  await ready(ui, api)
  const previous = api.media.at(-1), stale = { playing: previous.onplaying, ended: previous.onended, error: previous.onerror }
  await ui.flush(() => previous.onplaying())
  await ui.input('音频来源', 'web-speech')
  assert.equal(api.synth.spoken.at(-1).text, 'It rested near the river.')
  assert.equal(api.synth.spoken.at(-1).rate, 2)
  await ui.flush(() => { stale.playing(); stale.ended(); stale.error() })
  assert.equal(ui.field('文本进度').value, '1')
  await ui.click('暂停')
  const before = requests(api).length, systemBefore = api.synth.spoken.length
  await ui.input('文本进度', 0)
  await ui.input('音频来源', 'kokoro')
  for (const rate of [0.5, 1, 1.5, 2]) await ui.input('朗读语速', rate)
  await ui.input('英语音色', 'bf_emma')
  assert.equal(requests(api).length, before)
  assert.equal(api.synth.spoken.length, systemBefore)
  assert.match(body(ui).textContent, /已暂停/)
  await ui.click('继续')
  assert.deepEqual(requests(api).at(-1).payload, { text: 'A small bird landed.', voice: 'bf_emma', rate: 2 })
  await ui.click('暂停')
  assert.match(body(ui).textContent, /已暂停/)
  await ready(ui, api)
  assert.equal(api.media.length, 1, 'a paused queued task must never allocate late media')
  assert.equal(ui.field('文本进度').value, '0')
})

test('article playback rejection offers the same generated audio, and hiding releases media without progress', async t => {
  const api = fixture(); api.rejectPlay = true
  const { ui } = await open(t, api)
  await ui.input('文本进度', 1)
  await ui.click('播放'); await ready(ui, api)
  assert.match(body(ui).textContent, /浏览器需要.*再次点击/)
  assert.doesNotMatch(body(ui).textContent, /播放中/)
  assert.equal(ui.button('播放生成音频').closest('.ec-item-body'), body(ui))
  const count = requests(api).length, current = api.media.at(-1)
  api.rejectPlay = false
  await ui.click('播放生成音频')
  assert.equal(requests(api).length, count)
  assert.equal(current.plays, 2)
  await ui.flush(() => current.onplaying())
  const ended = current.onended
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('pagehide')))
  assert.equal(current.src, '')
  assert.match(body(ui).textContent, /已暂停/)
  assert.equal(ui.field('文本进度').value, '1')
  await ui.flush(() => ended())
  assert.equal(ui.field('文本进度').value, '1')
  assert.equal(api.revoked.length, 1)
})

test('pagehide and final unmount release the page session through the existing authenticated JSON transport', async t => {
  const { ui, api } = await open(t)
  await ui.click('播放'); await ready(ui, api)
  const current = api.media.at(-1)
  await ui.flush(() => current.onplaying())
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('pagehide')))
  const release = api.calls.find(value => value.command === 'speech.session.release')
  assert.ok(release, 'closing a page releases its Host owner, not just the current task')
  assert.deepEqual(release.payload, {})
  assert.equal(release.options.keepalive, true)
  assert.equal(release.options.headers['content-type'], 'application/json')
  assert.match(release.options.headers['x-english-coach-speech-session'], /^[a-f0-9]{48}$/)
  assert.ok(Buffer.byteLength(JSON.stringify(release.payload)) <= 4096)
  assert.equal(current.src, '')
  assert.equal(ui.field('文本进度').value, '0')
  const before = api.calls.filter(value => value.command === 'speech.session.release').length
  await ui.click('继续'); await ready(ui, api)
  await ui.close()
  assert.ok(api.calls.filter(value => value.command === 'speech.session.release').length > before, 'the last subscriber releases even without pagehide')
})

test('only an active visible Kokoro owner heartbeats through waiting, media and paused states', async t => {
  const { ui, api } = await open(t)
  const heartbeats = () => api.calls.filter(value => value.command === 'speech.session.touch')
  await ui.poll()
  assert.equal(heartbeats().length, 0, 'opening a learning page starts no session polling')
  await ui.click('播放'); await ui.poll()
  assert.ok(heartbeats().length > 0, 'queued or cold-loading owner renews its lease')
  await ready(ui, api)
  const current = api.media.at(-1)
  await ui.flush(() => current.onplaying())
  let count = heartbeats().length
  await ui.poll()
  assert.ok(heartbeats().length > count, 'delivered media keeps the same lightweight heartbeat')
  await ui.click('暂停'); count = heartbeats().length
  await ui.poll()
  assert.ok(heartbeats().length > count, 'paused retained media still observes resource lifecycle')
  assert.equal(api.media.length, 1)
  assert.ok(heartbeats().every(value => Object.keys(value.payload).length === 0))
  Object.defineProperty(ui.window.document, 'hidden', { configurable: true, value: true })
  await ui.flush(() => ui.window.document.dispatchEvent(new ui.window.Event('visibilitychange')))
  count = heartbeats().length; await ui.poll()
  assert.equal(heartbeats().length, count, 'hidden owner releases and stops heartbeat')
  Object.defineProperty(ui.window.document, 'hidden', { configurable: true, value: false })
  await ui.input('音频来源', 'web-speech'); await ui.click('继续'); await ui.poll()
  assert.equal(heartbeats().length, count, 'system source never polls Kokoro sessions')
  assert.equal(api.synth.spoken.length, 1)
})

test('long English clauses and expanding numbers use bounded segments without omitting text', async t => {
  const api = fixture()
  const text = 'We watch the river, '.repeat(24) + 'and count 9876543210 '.repeat(8) + 'before the last boat leaves.'
  api.state.todayLesson.items[0].body = text
  const { ui } = await open(t, api)
  await ui.click('播放')
  const total = Number(ui.field('文本进度').max), heard = []
  assert.ok(total > 3, 'a long single sentence must be split before reaching the Host')
  for (let n = 0; n < total; n++) {
    const current = requests(api).at(-1).payload.text
    assert.ok(current.length <= 400, `Host text limit: ${current.length}`)
    assert.ok((current.match(/\d/g) ?? []).length <= 32, 'number expansion needs smaller chunks than the character limit')
    heard.push(current)
    await ready(ui, api)
    await ui.flush(() => { api.media.at(-1).onplaying(); api.media.at(-1).onended() })
  }
  assert.equal(heard.join(' ').replace(/\s+/g, ' ').trim(), text.replace(/\s+/g, ' ').trim())
  assert.match(body(ui).textContent, /朗读已完成/)
  assert.equal(api.urls.length, api.revoked.length)
})

test('articles prefetch only one upcoming segment after audio delivery without allocating a second player', async t => {
  const { ui, api } = await open(t)
  await ui.click('播放')
  assert.equal(prefetches(api).length, 0)
  await ready(ui, api)
  assert.deepEqual(prefetches(api).map(value => value.payload), [{ text: 'It rested near the river.', voice: 'af_heart', rate: 1, priority: 'prefetch' }])
  assert.equal(api.media.length, 1)
  await ui.poll()
  assert.equal(api.media.length, 1, 'prefetched bytes are not a hidden second player')
  assert.equal(prefetches(api).length, 1, 'never precompute the third sentence')
  assert.equal(requests(api).length, 1)
  const first = api.media[0]
  await ui.flush(() => first.onplaying())
  await ui.flush(() => first.onended())
  assert.equal(ui.field('文本进度').value, '1')
  await ready(ui, api)
  assert.equal(api.media.length, 2)
  assert.equal(requests(api).length, 2, 'the next sentence gets an explicit foreground promotion')
  assert.deepEqual(prefetches(api).map(value => value.payload.text), ['It rested near the river.', 'Then it flew home.'])
  const prefetchedTask = api.calls.find(value => value.command === 'speech.status' && value.payload.taskId === 'task-4')?.payload.taskId ?? 'task-4'
  await ui.input('文本进度', 0)
  assert.ok(api.calls.some(value => value.command === 'speech.cancel' && value.payload.taskId === prefetchedTask))
  assert.equal(api.media[1].src, '')
  assert.equal(ui.field('文本进度').value, '0')
  await ui.click('暂停')
  const count = api.calls.filter(value => value.command === 'speech.synthesize').length
  await ui.poll()
  assert.equal(api.calls.filter(value => value.command === 'speech.synthesize').length, count)
  assert.match(body(ui).textContent, /已暂停/)
})

test('short pronunciation interrupts an article at its sentence and old async results stay silent', async t => {
  const api = fixture(), pendingAudio = deferred(), request = api.request
  let held = false, signal
  api.request = (command, payload, options) => command === 'speech.audio' && !held
    ? (held = true, signal = options.signal, pendingAudio.promise) : request(command, payload, options)
  const { ui } = await open(t, api)
  await ui.input('文本进度', 1)
  await ui.click('播放'); await ready(ui, api)
  await ui.click('试听音色')
  assert.equal(signal.aborted, true)
  assert.match(body(ui).textContent, /已暂停/)
  assert.equal(ui.field('文本进度').value, '1')
  await ready(ui, api)
  assert.equal(api.media.length, 1)
  const short = api.media[0], ended = short.onended, error = short.onerror
  await ui.flush(() => pendingAudio.resolve(new Response(Buffer.from('RIFF0000WAVE'), { headers: { 'content-type': 'audio/wav' } })))
  assert.equal(api.media.length, 1)
  await ui.flush(() => { short.onplaying(); short.onended() })
  assert.match(body(ui).textContent, /已暂停/)
  const count = requests(api).length
  await ui.poll()
  assert.equal(requests(api).length, count, 'short completion never resumes the article')
  await ui.click('继续'); await ready(ui, api)
  const current = api.media.at(-1), stale = { playing: current.onplaying, ended: current.onended, error: current.onerror }
  await ui.flush(() => { ended(); error(); current.onplaying() })
  assert.match(body(ui).textContent, /播放中/)
  await ui.input('文本进度', 2)
  await ui.input('文本进度', 0)
  await ui.input('文本进度', 1)
  await ui.flush(() => { stale.playing(); stale.ended(); stale.error() })
  assert.equal(ui.field('文本进度').value, '1')
  assert.doesNotMatch(body(ui).textContent, /朗读错误|朗读已完成/)
  api.phase = 'error'; await ui.poll()
  assert.match(body(ui).textContent, /超过本地合成上限/)
  assert.equal(ui.field('文本进度').value, '1')
  assert.equal(api.calls.some(value => /speech.assets.prepare|review.answer|lesson.complete/.test(value.command)), false)
})

test('pausing before a pending browser play rejection prevents late revival and paused seeking stays silent', async t => {
  const api = fixture(), rejected = deferred(), setup = api.setupWindow
  api.setupWindow = window => { setup(window); window.Audio.prototype.play = () => rejected.promise }
  const { ui } = await open(t, api)
  await ui.click('播放'); await ready(ui, api)
  await ui.click('暂停')
  await ui.flush(() => rejected.resolve(Promise.reject(new Error('late browser rejection'))))
  assert.match(body(ui).textContent, /已暂停/)
  assert.equal(ui.buttons('播放生成音频').length, 0)
  assert.equal(ui.field('文本进度').value, '0')
  await ui.input('文本进度', 2)
  assert.equal(requests(api).length, 1)
})

test('execute bookmarks restore silently by article and content version without changing learning records', async t => {
  const api = fixture(), root = await tempFixture(t, 'english-article-bookmark-')
  const now = new Date('2026-10-22T08:00:00+08:00'), run = (command, payload) => execute(root, command, payload, { now })
  assert.equal((await run('profile.save', api.state.profile)).ok, true)
  assert.equal((await run('settings.save', api.state.settings)).ok, true)
  const lesson = structuredClone(api.state.todayLesson)
  lesson.items[0].body = 'First sentence. Second sentence. Last sentence.'
  lesson.items[0].translations = ['第一句。第二句。最后一句。']
  lesson.sources = [{ id: 'synthetic', url: 'https://example.com/article-test', fetchedAt: now.toISOString(), license: 'Synthetic test text' }]
  for (const item of lesson.items) item.sourceId = 'synthetic'
  lesson.items.push({ id: 'expressions', type: 'expressions', expressions: [{ term: 'step outside', meaning: '走出去' }] }, { id: 'quiz', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['one', 'two', 'three', 'four'], answerIndex: 0 }] })
  assert.equal((await run('lesson.save', lesson)).ok, true)
  assert.equal((await run('lesson.start', { date: lesson.date })).ok, true)
  const before = await run('state.get'), beforeReview = await run('review.list'), beforeSettings = await run('settings.get')
  const pending = new Set(), bookmarkPayloads = [], transport = api.request
  const request = (command, payload, options) => {
    if (command.startsWith('speech.')) return transport(command, payload, options)
    if (command === 'audio.bookmark.save') bookmarkPayloads.push(payload)
    const promise = run(command, payload); pending.add(promise); promise.finally(() => pending.delete(promise)); return promise
  }
  let ui = await mountClient({ request, setupWindow: api.setupWindow }), closed = false
  disposeFixture(t, async () => { if (!closed) await ui.close(); await Promise.all([...pending]) })
  const settle = async () => { while (pending.size) await ui.flush(async () => { await Promise.all([...pending]) }) }
  await settle()
  await ui.click('播放'); await ready(ui, api)
  await ui.flush(() => { api.media.at(-1).onplaying(); api.media.at(-1).onended() })
  await settle()
  await ui.click(row(ui, '听力文稿')); await settle()
  await ui.input('文本进度', 2); await settle()
  await ui.click(row(ui, '阅读文章')); await settle()
  assert.equal(ui.field('文本进度').value, '1')
  assert.match(body(ui).textContent, /已暂停/)
  await ui.close(); await settle()
  const count = requests(api).length
  ui = await mountClient({ request, setupWindow: api.setupWindow }); await settle()
  assert.equal(requests(api).length, count)
  assert.equal(ui.field('文本进度').value, '1')
  assert.match(body(ui).textContent, /已静默恢复书签/)
  const readingBookmark = bookmarkPayloads.find(value => value.materialId.endsWith(':read'))
  assert.equal(readingBookmark.contentFingerprint, 's1-47-cc119d6a-9cb0b5aa', 'ordinary legacy sentence fingerprints remain compatible')
  assert.equal((await run('audio.bookmark.get', readingBookmark)).data.bookmark.position, 1)
  const unchanged = await run('state.get')
  assert.deepEqual(unchanged.data.todayLesson, before.data.todayLesson)
  assert.deepEqual(unchanged.data.review, before.data.review)
  assert.deepEqual(await run('review.list'), beforeReview)
  assert.deepEqual(await run('settings.get'), beforeSettings)
  await ui.close(); await settle()
  lesson.items[0].body = 'New content. Only this article changed.'
  lesson.items[0].translations = ['新正文。只有这篇文章变化。']
  assert.equal((await run('lesson.save', lesson)).ok, true)
  ui = await mountClient({ request, setupWindow: api.setupWindow }); await settle()
  assert.equal(requests(api).length, count)
  assert.equal(ui.field('文本进度').value, '0')
  assert.match(body(ui).textContent, /正文已变化/)
  await ui.click(row(ui, '听力文稿')); await settle()
  assert.equal(ui.field('文本进度').value, '2')
  await ui.close(); await settle(); closed = true
})
