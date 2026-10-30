import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'

const now = new Date('2026-10-30T08:00:00+08:00')
const localVoice = { voiceURI: 'short-shelley-gb', name: 'Shelley', lang: 'en-GB', localService: true }
const wav = () => new Response(Buffer.from('RIFF0000WAVE'), { headers: { 'content-type': 'audio/wav' } })

// Exercise the actual Client and execute with synthetic learning data. Only the
// external Host speech transport and browser media/voice devices are controlled.
async function fixture(t, { provider = 'kokoro' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'coach-short-ui-'))
  t.after(async () => {
    assert.equal(resolve(root), root)
    assert.ok(root.startsWith(join(tmpdir(), 'coach-short-ui-')))
    await rm(root, { recursive: true, force: true })
  })
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  const save = async (command, payload) => { const result = await run(command, payload); assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
  await save('profile.save', { goal: 'study', minutesPerDay: 20, interests: ['synthetic examples'] })
  await save('settings.save', { audio: { provider, kokoroVoice: 'bf_emma', voiceURI: localVoice.voiceURI, rate: 1.5 } })
  await save('review.add', { items: [
    { id: '00-orchard', term: 'orchard', kind: 'word', meaning: '果园', choices: ['果园', '港口', '山谷', '屋顶'], answerIndex: 0 },
    { id: '01-harvest', term: 'harvest', kind: 'word', meaning: '收获', choices: ['收获', '借用', '争论', '返回'], answerIndex: 0 }
  ] })
  await save('lesson.save', {
    date: '2026-10-30', title: '非个人合成朗读课',
    sources: [{ id: 'synthetic', url: 'https://example.com/short-reading', fetchedAt: now.toISOString(), license: '合成测试材料' }],
    items: [
      { id: 'reading', type: 'reading', title: '合成阅读', sourceId: 'synthetic', body: 'First sentence. Second sentence. Last sentence.', translations: ['第一句。第二句。最后一句。'] },
      { id: 'listening', type: 'listening', title: '合成听力', sourceId: 'synthetic', transcript: 'Listen first. Listen second.', translations: ['先听第一句，再听第二句。'] },
      { id: 'expressions', type: 'expressions', title: '合成表达', expressions: [{ term: 'keep going', meaning: '继续', example: 'We keep going.' }] },
      { id: 'quiz', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['甲', '乙', '丙', '丁'], answerIndex: 0 }] }
    ],
    cards: [{ id: 'course-card', front: 'take a break', back: '休息一下', choices: ['休息一下', '继续走', '做决定', '赶快'], answerIndex: 0 }]
  })
  await save('lesson.start', { date: '2026-10-30' })
  const pending = new Set(), calls = [], media = [], urls = [], revoked = [], spoken = []
  const api = {
    run, calls, media, urls, revoked, spoken, phase: 'queued', rejectPlay: false,
    assets: { phase: 'ready', assetsReady: true, runtimeAvailable: true, manifest: { revision: 'synthetic', downloadBytes: 94453730 }, downloadedBytes: 94453730, validatedBytes: 94453730, diskBytes: 94454000 },
    setupWindow(window) {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 })
      const synth = new window.EventTarget()
      Object.assign(synth, { voices: [localVoice], speaking: false, paused: false,
        getVoices() { return this.voices },
        speak(utterance) { this.speaking = true; spoken.push(utterance) },
        cancel() { this.speaking = false; this.paused = false },
        pause() { this.paused = true }, resume() { this.paused = false }
      })
      api.synth = window.speechSynthesis = synth
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
      window.URL.createObjectURL = blob => { const url = `blob:short-${urls.length}`; urls.push({ url, blob }); return url }
      window.URL.revokeObjectURL = url => revoked.push(url)
      window.Audio = class {
        constructor() { this.src = ''; this.plays = 0; this.pauses = 0; media.push(this) }
        play() { this.plays++; return api.rejectPlay ? Promise.reject(new Error('requires a user gesture')) : Promise.resolve() }
        pause() { this.pauses++ }
        removeAttribute(name) { if (name === 'src') this.src = '' }
        load() {}
      }
    },
    request(command, payload, options) {
      const promise = (async () => {
        calls.push({ command, payload, options })
        const override = api.intercept?.(command, payload, options)
        if (override !== undefined) return override
        if (command === 'job.status') return Response.json({ ok: true, data: null })
        if (command === 'speech.assets.status') return Response.json({ ok: true, data: structuredClone(api.assets) })
        if (command === 'speech.synthesize') return Response.json({ ok: true, data: { taskId: `short-${calls.filter(value => value.command === command).length}`, phase: 'queued' } })
        if (command === 'speech.status') return Response.json({ ok: true, data: { taskId: payload.taskId, phase: api.phase, error: api.phase === 'error' ? { message: '合成失败，请手动重试。' } : null } })
        if (command === 'speech.audio') return wav()
        if (command === 'speech.cancel') return Response.json({ ok: true, data: { taskId: payload.taskId, phase: 'cancelled' } })
        return Response.json(await run(command, payload))
      })()
      pending.add(promise)
      promise.then(() => pending.delete(promise), () => pending.delete(promise))
      return promise
    },
    async settle(ui) { while (pending.size) await ui.flush(async () => { await Promise.all([...pending]) }) },
    async snapshot() {
      const results = {}
      for (const command of ['state.get', 'review.list', 'review.queue', 'progress.get', 'study.batch', 'settings.get']) results[command] = await run(command)
      return results
    }
  }
  return api
}
async function open(t, api, slot = 'main') {
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow, slot })
  t.after(() => ui.close())
  await api.settle(ui)
  return ui
}
const entry = (ui, text, scope = ui.container) => {
  const button = scope.querySelector(`button[aria-label="朗读 ${text}"]`)
  assert.ok(button, `Visible pronunciation entry: ${text}; UI: ${ui.text()}`)
  return button
}
const feedback = button => button.closest('.ec-pronounce')

test('a missing Kokoro resource is explained only at the entry that requested it, without download or learning changes', async t => {
  const api = await fixture(t)
  api.assets = { ...api.assets, phase: 'unprepared', assetsReady: false, downloadedBytes: 0, validatedBytes: 0, diskBytes: 0 }
  const ui = await open(t, api)
  const before = await api.snapshot()
  const word = entry(ui, 'orchard'), courseCard = entry(ui, 'take a break')
  await ui.click(word); await api.settle(ui)
  assert.match(feedback(word).textContent, /Kokoro.*尚未准备.*朗读设置.*准备/)
  assert.equal(Boolean(feedback(courseCard).querySelector('[role="status"]')), false, 'another entry must not inherit this error')
  assert.equal(api.calls.some(({ command }) => /speech\.(?:synthesize|assets\.prepare)/.test(command)), false)
  assert.equal(api.spoken.length, 0)
  assert.equal(api.media.length, 0)
  assert.deepEqual(await api.snapshot(), before)
})

test('all short entries use the selected Kokoro English, voice and rate without answering, flipping, navigating or enrolling', async t => {
  const api = await fixture(t); api.phase = 'ready'
  const ui = await open(t, api)
  const baseline = await api.snapshot()
  assert.equal(api.media.length, 0)
  assert.equal(api.calls.some(({ command }) => command === 'speech.synthesize'), false)
  const pronounce = async (button, text) => {
    assert.equal(button.type, 'button')
    assert.ok(button.querySelector('svg[aria-hidden="true"]'))
    button.focus()
    for (const key of ['1', '2', '3', '4', 'Enter', ' ']) await ui.key(button, key)
    assert.equal(ui.window.document.activeElement === button, true)
    const before = await api.snapshot()
    await ui.click(button); await api.settle(ui)
    const requests = api.calls.filter(({ command }) => command === 'speech.synthesize')
    assert.deepEqual(requests.at(-1).payload, { text, voice: 'bf_emma', rate: 1.5 })
    await ui.poll(); await api.settle(ui)
    const audio = api.media.at(-1)
    assert.equal(audio.plays, 1)
    await ui.flush(() => audio.onplaying())
    assert.match(feedback(button).textContent, /正在播放本地朗读/)
    await ui.flush(() => audio.onended())
    assert.equal(audio.src, '')
    assert.deepEqual(await api.snapshot(), before)
    assert.equal(api.spoken.length, 0)
  }
  await pronounce(entry(ui, 'orchard', ui.container.querySelector('.ec-deck')), 'orchard')
  const course = entry(ui, 'take a break')
  await pronounce(course, 'take a break')
  assert.equal(ui.container.querySelector('.ec-flash-toggle').getAttribute('aria-expanded'), 'false')
  await ui.click(ui.container.querySelector('.ec-flash-toggle'))
  await pronounce(course, 'take a break')
  assert.equal(ui.container.querySelector('.ec-flash-toggle').getAttribute('aria-expanded'), 'true')
  const expressionRow = [...ui.container.querySelectorAll('button.ec-li')].find(node => node.textContent.includes('合成表达'))
  await ui.click(expressionRow)
  await pronounce(entry(ui, 'keep going'), 'keep going')
  const example = ui.button('朗读例句 We keep going.')
  await pronounce(example, 'We keep going.')
  await ui.click('单词'); await api.settle(ui)
  await pronounce(entry(ui, 'orchard', ui.container.querySelector('.ec-deck')), 'orchard')
  await ui.click('我的词汇'); await api.settle(ui)
  await pronounce(entry(ui, 'orchard', ui.container.querySelector('.ec-lib-list')), 'orchard')
  assert.equal(Boolean(ui.container.querySelector('[role="dialog"]')), false)
  await ui.click([...ui.container.querySelectorAll('.ec-lib-row')].find(node => node.querySelector('.ec-lib-term').textContent === 'orchard'))
  await pronounce(entry(ui, 'orchard', ui.container.querySelector('[role="dialog"]')), 'orchard')
  assert.equal(Boolean(ui.container.querySelector('[role="dialog"]')), true)
  await ui.click('关闭词汇详情')
  await ui.click('主题词库'); await api.settle(ui)
  for (const id of ['cet4', 'cet6', 'ielts']) {
    await ui.input('浏览词库', id); await api.settle(ui)
    const row = ui.container.querySelector('.ec-lib-row'), term = row.querySelector('.ec-lib-term').textContent
    await pronounce(entry(ui, term, row.parentElement), term)
    assert.equal(Boolean(ui.container.querySelector('[role="dialog"]')), false)
    await ui.click(row)
    await pronounce(entry(ui, term, ui.container.querySelector('[role="dialog"]')), term)
    await ui.key(entry(ui, term, ui.container.querySelector('[role="dialog"]')), 'Escape')
    assert.equal(Boolean(ui.container.querySelector('[role="dialog"]')), false)
  }
  assert.deepEqual(await api.snapshot(), baseline)
  assert.equal(api.calls.some(({ command }) => /review\.answer|lesson\.complete|review\.add|wordlists\.select|study\.supplement|speech\.assets\.prepare/.test(command)), false)
  assert.ok(api.calls.filter(({ command }) => command === 'speech.synthesize').every(({ payload }) => !/[\u3400-\u9fff]/.test(payload.text)))
})

test('system voice loss and a short utterance failure stay at the requesting entry and can be retried manually', async t => {
  const api = await fixture(t, { provider: 'web-speech' }), ui = await open(t, api)
  const before = await api.snapshot(), word = entry(ui, 'orchard'), card = entry(ui, 'take a break')
  await ui.click(word)
  assert.equal(api.spoken.at(-1).text, 'orchard')
  assert.equal(api.spoken.at(-1).voice.voiceURI, localVoice.voiceURI)
  assert.equal(api.spoken.at(-1).rate, 1.5)
  await ui.flush(() => api.spoken.at(-1).onerror())
  assert.match(feedback(word).textContent, /发音失败.*重试/)
  assert.equal(Boolean(feedback(card).querySelector('[role="status"]')), false)
  await ui.click(card)
  assert.equal(api.spoken.at(-1).text, 'take a break')
  assert.equal(Boolean(feedback(word).querySelector('[role="status"]')), false)
  await ui.flush(() => { api.synth.voices = []; api.synth.dispatchEvent(new ui.window.Event('voiceschanged')) })
  assert.match(feedback(card).textContent, /音色.*不可用/)
  const count = api.spoken.length
  await ui.click(word)
  assert.equal(api.spoken.length, count, 'a missing system voice never selects a default')
  assert.match(feedback(word).textContent, /暂无可用英语音色/)
  await ui.flush(() => { api.synth.voices = [localVoice]; api.synth.dispatchEvent(new ui.window.Event('voiceschanged')) })
  assert.equal(api.spoken.length, count, 'voice recovery is silent')
  await ui.click(word)
  assert.equal(api.spoken.length, count + 1)
  assert.equal(api.calls.some(({ command }) => command === 'speech.synthesize'), false)
  assert.deepEqual(await api.snapshot(), before)
})

test('leaving a failed short entry and returning does not retain or leak its error', async t => {
  const api = await fixture(t), ui = await open(t, api)
  api.assets.assetsReady = false
  const word = entry(ui, 'orchard')
  await ui.click(word); await api.settle(ui)
  assert.match(feedback(word).textContent, /尚未准备/)
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('pagehide')))
  assert.equal(Boolean(feedback(word).querySelector('[role="status"]')), false, 'hidden pages clear owner feedback even when failure already released its task')
  await ui.click(word); await api.settle(ui)
  await ui.click('单词'); await api.settle(ui)
  assert.equal(Boolean(feedback(entry(ui, 'orchard')).querySelector('[role="status"]')), false)
  await ui.click('今日'); await api.settle(ui)
  assert.equal(Boolean(feedback(entry(ui, 'orchard')).querySelector('[role="status"]')), false)
})

test('generation and media failures have entry-local feedback and only an explicit retry makes new audio', async t => {
  const api = await fixture(t), ui = await open(t, api)
  const before = await api.snapshot(), word = entry(ui, 'orchard'), card = entry(ui, 'take a break')
  api.phase = 'error'
  await ui.click(word); await api.settle(ui); await ui.poll(); await api.settle(ui)
  assert.match(feedback(word).textContent, /合成失败.*重试/)
  assert.equal(Boolean(feedback(card).querySelector('[role="status"]')), false)
  assert.equal(api.media.length, 0)
  api.phase = 'ready'
  await ui.poll(); await api.settle(ui)
  assert.equal(api.media.length, 0, 'resource/runtime recovery alone does not retry')
  await ui.click(card); await api.settle(ui); await ui.poll(); await api.settle(ui)
  const audio = api.media.at(-1)
  await ui.flush(() => audio.onerror())
  assert.match(feedback(card).textContent, /播放失败.*手动重试.*不会自动换源/)
  assert.equal(Boolean(feedback(word).querySelector('[role="status"]')), false)
  assert.equal(audio.src, '')
  assert.equal(api.spoken.length, 0)
  await ui.click(card); await api.settle(ui); await ui.poll(); await api.settle(ui)
  assert.equal(api.media.length, 2)
  assert.equal(api.calls.filter(({ command }) => command === 'speech.synthesize').length, 3)
  assert.deepEqual(await api.snapshot(), before)
})

test('different short entries replace stale requests and media without playing or displaying old responses', async t => {
  const api = await fixture(t), pending = deferred()
  const ui = await open(t, api), before = await api.snapshot()
  let holdFirst = true
  api.intercept = (command) => command === 'speech.synthesize' && holdFirst ? (holdFirst = false, pending.promise) : undefined
  const word = entry(ui, 'orchard'), card = entry(ui, 'take a break')
  await ui.click(word)
  const oldRequest = api.calls.find(({ command }) => command === 'speech.synthesize')
  await ui.click(card)
  const latest = api.calls.filter(({ command }) => command === 'speech.synthesize').at(-1)
  assert.equal(oldRequest.options.signal.aborted, true)
  assert.deepEqual(latest.payload, { text: 'take a break', voice: 'bf_emma', rate: 1.5 })
  await ui.flush(() => pending.resolve(Response.json({ ok: true, data: { taskId: 'late-old-task', phase: 'ready' } })))
  await api.settle(ui)
  assert.ok(api.calls.some(({ command, payload }) => command === 'speech.cancel' && payload.taskId === 'late-old-task'))
  assert.equal(api.media.length, 0)
  assert.equal(Boolean(feedback(word).querySelector('[role="status"]')), false)
  api.phase = 'ready'; await ui.poll(); await api.settle(ui)
  const oldMedia = api.media.at(-1), callbacks = [oldMedia.onplaying, oldMedia.onended, oldMedia.onerror]
  api.rejectPlay = true
  await ui.click(word); await api.settle(ui); await ui.poll(); await api.settle(ui)
  const manual = [...feedback(word).querySelectorAll('button')].find(node => node.textContent === '播放生成音频')
  assert.ok(manual)
  await ui.click(card); await api.settle(ui); await ui.poll(); await api.settle(ui)
  const current = api.media.at(-1), plays = current.plays
  await ui.click(manual)
  assert.equal(current.plays, plays, 'a detached retry from a replaced entry cannot play another entry audio')
  await ui.flush(() => callbacks.forEach(callback => callback()))
  assert.equal(oldMedia.src, '')
  assert.match(feedback(card).textContent, /再次点击播放/)
  assert.doesNotMatch(feedback(card).textContent, /播放失败|试听结束|正在播放/)
  assert.equal(Boolean(feedback(word).querySelector('[role="status"]')), false)
  assert.equal(api.calls.some(({ command }) => command === 'speech.assets.prepare'), false)
  assert.deepEqual(await api.snapshot(), before)
})

test('a card changing its English releases the old entry even when React keeps the pronunciation control mounted', async t => {
  const api = await fixture(t); api.phase = 'ready'
  const ui = await open(t, api, 'shell.overlay')
  await ui.click(ui.container.querySelector('.ec-pill-btn')); await api.settle(ui)
  await ui.click(entry(ui, 'orchard')); await api.settle(ui); await ui.poll(); await api.settle(ui)
  const audio = api.media.at(-1), oldEnded = audio.onended
  const choice = [...ui.container.querySelectorAll('.ec-choice')].find(node => node.textContent.includes('果园'))
  await ui.click(choice); await api.settle(ui)
  const afterAnswer = await api.snapshot()
  await ui.click('下一个'); await api.settle(ui)
  assert.ok(entry(ui, 'harvest'))
  assert.equal(audio.src, '', 'the old card no longer owns visible playback')
  assert.equal(api.media.length, 1, 'a new card does not automatically speak')
  await ui.flush(() => oldEnded())
  assert.deepEqual(await api.snapshot(), afterAnswer)
})

test('hiding, collapsing and unmounting short entries abort their media and ignore late binary audio', async t => {
  const api = await fixture(t); api.phase = 'ready'
  const pending = deferred()
  let holdAudio = true, oldOptions
  api.intercept = (command, _payload, options) => command === 'speech.audio' && holdAudio
    ? (holdAudio = false, oldOptions = options, pending.promise) : undefined
  const ui = await mountClient({ request: api.request, setupWindow: api.setupWindow, slot: 'shell.overlay' })
  let closed = false
  t.after(async () => { if (!closed) await ui.close() })
  await api.settle(ui)
  await ui.click(ui.container.querySelector('.ec-pill-btn')); await api.settle(ui)
  const before = await api.snapshot()
  await ui.click(entry(ui, 'orchard')); await api.settle(ui); await ui.poll()
  await ui.click('收起')
  assert.equal(oldOptions.signal.aborted, true)
  await ui.flush(() => pending.resolve(wav())); await api.settle(ui)
  assert.equal(api.media.length, 0, 'collapsed entry cannot play its late audio')
  assert.equal(api.urls.length, 0)
  await ui.click(ui.container.querySelector('.ec-pill-btn')); await api.settle(ui)
  assert.equal(api.media.length, 0, 'reopening is silent')
  await ui.click(entry(ui, 'orchard')); await api.settle(ui); await ui.poll(); await api.settle(ui)
  const first = api.media.at(-1), callbacks = [first.onplaying, first.onended, first.onerror]
  await ui.flush(() => {
    Object.defineProperty(ui.window.document, 'hidden', { configurable: true, value: true })
    ui.window.document.dispatchEvent(new ui.window.Event('visibilitychange'))
  })
  assert.equal(first.src, '')
  await ui.flush(() => callbacks.forEach(callback => callback()))
  assert.equal(Boolean(feedback(entry(ui, 'orchard')).querySelector('[role="status"]')), false)
  await ui.flush(() => {
    Object.defineProperty(ui.window.document, 'hidden', { configurable: true, value: false })
    ui.window.document.dispatchEvent(new ui.window.Event('visibilitychange'))
  })
  assert.equal(api.media.length, 1)
  await ui.click(entry(ui, 'orchard')); await api.settle(ui); await ui.poll(); await api.settle(ui)
  await ui.close(); closed = true
  assert.ok(api.media.every(audio => audio.src === '' && audio.pauses > 0))
  assert.equal(api.revoked.length, 2)
  assert.equal(api.calls.filter(({ command }) => command === 'speech.cancel').length, 3)
  assert.deepEqual(await api.snapshot(), before)
})

test('a pill pronunciation exposes its own waiting state and manual media retry without resynthesis or an answer', async t => {
  const api = await fixture(t); api.phase = 'ready'; api.rejectPlay = true
  const ui = await open(t, api, 'shell.overlay')
  await ui.click(ui.container.querySelector('.ec-pill-btn')); await api.settle(ui)
  const before = await api.snapshot(), button = entry(ui, 'orchard')
  await ui.click(button); await api.settle(ui)
  assert.match(feedback(button).textContent, /排队/)
  assert.doesNotMatch(feedback(button).textContent, /正在播放/)
  await ui.poll(); await api.settle(ui)
  assert.equal(api.media.length, 1)
  assert.match(feedback(button).textContent, /再次点击播放/)
  const retry = [...feedback(button).querySelectorAll('button')].find(node => node.textContent === '播放生成音频')
  assert.ok(retry, 'the pill has no settings card: the generated-audio retry belongs here')
  api.rejectPlay = false
  retry.focus(); await ui.key(retry, '1'); await ui.click(retry)
  assert.equal(api.media[0].plays, 2)
  assert.equal(api.calls.filter(({ command }) => command === 'speech.synthesize').length, 1)
  assert.equal(api.calls.filter(({ command }) => command === 'speech.audio').length, 1)
  await ui.flush(() => api.media[0].onplaying())
  assert.match(feedback(button).textContent, /正在播放本地朗读/)
  assert.deepEqual(await api.snapshot(), before)
})
