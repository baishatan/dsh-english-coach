import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient, deferred } from './client-harness.js'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execute } from '../core/index.js'

const local = { voiceURI: 'local-en', name: 'Local English', lang: 'en-US', localService: true, default: true }
const online = { voiceURI: 'online-en', name: 'Network English', lang: 'en-GB', localService: false }
function speechAdapter() {
  const spoken = []
  const synth = new EventTarget()
  Object.assign(synth, {
    voices: [local, online], spoken, paused: false, speaking: false, pauses: 0, resumes: 0,
    getVoices() { return this.voices },
    speak(utterance) { this.speaking = true; this.paused = false; spoken.push(utterance) },
    cancel() { this.speaking = false; this.paused = false },
    pause() { this.pauses++; this.paused = true },
    resume() { this.resumes++; if (!this.failResume) { this.paused = false; if (!this.silentResume) spoken.at(-1)?.onresume?.() } }
  })
  return { synth, setupWindow(window) { window.speechSynthesis = synth; window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } } } }
}
function fixture() {
  const state = {
    onboarded: true, profile: { goal: 'work', minutesPerDay: 30, interests: [] }, now: '2026-10-22T00:00:00Z',
    settings: { audio: { voiceURI: null, rate: 1 }, study: { wordsPerDay: 10 } }, review: { dueCount: 1 },
    todayLesson: { date: '2026-10-22', title: '合成语音课', status: 'active', sources: [], items: [
      { id: 'read', type: 'reading', title: '阅读材料', body: 'First sentence. Second sentence. Last sentence.', minutes: 2 },
      { id: 'listen', type: 'listening', title: '听力材料', transcript: 'Listen first. Listen second. Listen last.', minutes: 2 },
      { id: 'expressions', type: 'expressions', title: '表达材料', expressions: [{ term: 'keep going', meaning: '继续', example: 'We keep going.' }] }
    ] }
  }
  const words = [{ id: 'word', term: 'apple', kind: 'word', meaning: '苹果', choices: ['苹果', '梨', '香蕉', '橙子'], answerIndex: 0, due: true, box: 1 }]
  const calls = [], bookmarks = new Map()
  const api = { state, calls, bookmarks, words, async request(command, payload) {
    calls.push({ command, payload })
    if (command === 'state.get') return { ok: true, data: structuredClone(state) }
    if (command === 'review.list') return { ok: true, data: { items: words, dueCount: 1 } }
    if (command === 'settings.get') return { ok: true, data: structuredClone(state.settings) }
    if (command === 'settings.save') { Object.assign(state.settings.audio, payload.audio); return { ok: true, data: state.settings } }
    if (command === 'audio.bookmark.get') {
      const saved = bookmarks.get(payload.materialId)
      return { ok: true, data: { bookmark: saved?.contentFingerprint === payload.contentFingerprint ? saved : null, invalidated: !!saved && saved.contentFingerprint !== payload.contentFingerprint } }
    }
    if (command === 'audio.bookmark.save') {
      if (api.failSave) return { ok: false, message: '保存失败' }
      bookmarks.set(payload.materialId, structuredClone(payload)); return { ok: true, data: { bookmark: payload } }
    }
    if (command === 'vocabulary.query') return { ok: true, data: { items: words, total: 1, page: 1, pageSize: 50 } }
    if (command === 'wordlists.list') return { ok: true, data: { lists: ['cet4', 'cet6', 'ielts'].map(id => ({ id, title: id })), activeWordListId: null } }
    if (command === 'wordlists.query') return { ok: true, data: { items: [{ id: `${payload.id}-entry`, term: `${payload.id} example`, meaning: '参考', joined: false, listIds: [payload.id], sourceTags: [payload.id], practice: { status: 'unavailable', reason: '合成不可练夹具' } }], total: 1, page: 1, pages: 1, pageSize: 50, list: { id: payload.id, total: 1, playableCount: 0, unavailableCount: 1 } } }
    if (command === 'study.batch') return { ok: true, data: { items: words, dueCount: 1, batchSize: 10, activeWordListId: null } }
    throw new Error(`Unexpected host request ${command}`)
  } }
  return api
}
async function open(t, api = fixture(), adapter = speechAdapter(), options = {}) {
  const ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow, ...options })
  t.after(() => ui.close())
  return { ui, api, ...adapter }
}
test('可用英语声源选择与试听，四档速度保持句段和播放意图，延迟/失效有反馈', async t => {
  const adapter = speechAdapter()
  adapter.synth.voices = []
  const { ui, synth, api } = await open(t, fixture(), adapter)
  assert.match(ui.text(), /英语音色.*尚未就绪|暂无.*英语音色/)
  await ui.click('播放')
  assert.equal(synth.spoken.length, 0)
  await ui.flush(() => { synth.voices = [local, online]; synth.dispatchEvent(new Event('voiceschanged')) })
  assert.match(ui.text(), /本地/)
  assert.match(ui.text(), /联网.*外发/)
  await ui.click('重试朗读')
  await ui.flush(() => synth.spoken.at(-1).onend())
  for (const rate of [0.5, 1, 1.5, 2]) {
    await ui.input('朗读语速', rate)
    assert.equal(synth.spoken.at(-1).rate, rate)
    assert.equal(synth.spoken.at(-1).text, 'Second sentence.')
  }
  await ui.input('英语音色', online.voiceURI)
  assert.equal(synth.spoken.at(-1).voice.voiceURI, online.voiceURI)
  await ui.click('暂停')
  const count = synth.spoken.length
  for (const rate of [0.5, 1, 1.5, 2]) await ui.input('朗读语速', rate)
  await ui.input('英语音色', local.voiceURI)
  assert.equal(synth.spoken.length, count)
  await ui.click('试听音色')
  assert.equal(synth.spoken.at(-1).text, 'Hello. Let us practise English together.')
  await ui.flush(() => synth.spoken.at(-1).onend())
  assert.match(ui.text(), /已暂停/)
  assert.equal(api.state.settings.audio.rate, 2)
  assert.equal(api.state.settings.audio.voiceURI, local.voiceURI)
  await ui.flush(() => { synth.voices = [online]; synth.dispatchEvent(new Event('voiceschanged')) })
  assert.match(ui.text(), /偏好音色.*不可用/)
  assert.equal(ui.field('英语音色').value, online.voiceURI)
})

test('偏好读取迟到时修改语速只保存该字段，不覆盖既有音色', async t => {
  const api = fixture(), pending = deferred(), request = api.request
  api.state.settings.audio.voiceURI = online.voiceURI
  api.request = (command, payload) => command === 'settings.get' ? pending.promise : request(command, payload)
  const { ui, synth } = await open(t, api)
  await ui.input('朗读语速', 1.5)
  assert.equal(api.state.settings.audio.voiceURI, online.voiceURI)
  await ui.flush(() => pending.resolve({ ok: true, data: { audio: { voiceURI: online.voiceURI, rate: 1 } } }))
  assert.equal(ui.field('英语音色').value, online.voiceURI)
  assert.equal(ui.field('朗读语速').value, '1.5')
  await ui.click('播放')
  assert.equal(synth.spoken.at(-1).voice.voiceURI, online.voiceURI)
})

test('书签跨折叠和重开静默恢复，正文变化仅重置该篇，隐藏暂停并显示保存失败', async t => {
  const api = fixture(), adapter = speechAdapter()
  let ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow })
  t.after(() => ui.close())
  await ui.input('文本进度', 1)
  await ui.click('播放')
  await ui.click(articleRow(ui, '听力材料'))
  await ui.input('文本进度', 2)
  await ui.click('播放')
  await ui.click(articleRow(ui, '阅读材料'))
  assert.equal(ui.field('文本进度').value, '1')
  assert.match(ui.text(), /已暂停/)
  await ui.close()
  const before = adapter.synth.spoken.length
  ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow })
  assert.equal(adapter.synth.spoken.length, before)
  assert.equal(ui.field('文本进度').value, '1')
  await ui.click('继续')
  assert.equal(adapter.synth.spoken.at(-1).text, 'Second sentence.')
  await ui.flush(() => { Object.defineProperty(ui.window.document, 'hidden', { configurable: true, value: true }); ui.window.document.dispatchEvent(new ui.window.Event('visibilitychange')) })
  assert.match(ui.text(), /已暂停/)
  api.failSave = true
  await ui.input('文本进度', 2)
  assert.match(ui.text(), /书签保存失败/)
  api.failSave = false
  await ui.click('重试保存书签')
  assert.doesNotMatch(ui.text(), /书签保存失败/)
  await ui.close()
  api.state.todayLesson.items[0].body = 'Changed first. Changed last.'
  ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow })
  assert.equal(ui.field('文本进度').value, '0')
  assert.match(ui.text(), /正文已变化/)
  await ui.click(articleRow(ui, '听力材料'))
  assert.equal(ui.field('文本进度').value, '2')
})

test('今日卡片和表达例句手动发音抢占文章，不误答、不自动恢复，旧回调失效', async t => {
  const { ui, synth, api } = await open(t)
  await ui.click('播放')
  await ui.flush(() => synth.spoken.at(-1).onend())
  await ui.click(ui.container.querySelector('button[aria-label="朗读 apple"]'))
  assert.equal(synth.spoken.at(-1).text, 'apple')
  assert.match(ui.text(), /已暂停/)
  assert.equal(ui.field('文本进度').value, '1')
  const stale = synth.spoken.at(-1)
  await ui.key(ui.container.querySelector('button[aria-label="朗读 apple"]'), '1')
  await ui.click(ui.container.querySelector('button[aria-label="朗读 apple"]'))
  const latest = synth.spoken.at(-1)
  await ui.flush(() => { stale.onerror(); stale.onend() })
  assert.doesNotMatch(ui.text(), /发音失败/)
  await ui.flush(() => latest.onend())
  assert.match(ui.text(), /已暂停/)
  await ui.click('继续')
  assert.equal(synth.spoken.at(-1).text, 'Second sentence.')
  await ui.click(articleRow(ui, '表达材料'))
  await ui.click(ui.container.querySelector('button[aria-label="朗读 keep going"]'))
  assert.equal(synth.spoken.at(-1).text, 'keep going')
  await ui.click(ui.container.querySelector('button[aria-label="朗读例句 We keep going."]'))
  assert.equal(synth.spoken.at(-1).text, 'We keep going.')
  await ui.flush(() => synth.spoken.at(-1).onerror())
  assert.match(ui.text(), /发音失败/)
  await ui.click(ui.container.querySelector('button[aria-label="朗读例句 We keep going."]'))
  assert.equal(synth.spoken.at(-1).text, 'We keep going.')
  assert.equal(api.calls.filter(c => /review.answer|lesson.complete|review.add/.test(c.command)).length, 0)
})

test('课上卡片发音不翻卡，悬浮碎片卡发音不作答且收起停止短词', async t => {
  const api = fixture()
  api.state.todayLesson.cards = [{ id: 'flash', front: 'take care', back: '保重' }]
  let adapter = speechAdapter()
  let ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow })
  t.after(() => ui.close())
  await ui.click(ui.container.querySelector('button[aria-label="朗读 take care"]'))
  assert.equal(adapter.synth.spoken.at(-1).text, 'take care')
  assert.doesNotMatch(ui.text(), /保重/)
  await ui.close()
  adapter = speechAdapter()
  ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow, slot: 'shell.overlay' })
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  assert.equal(adapter.synth.spoken.length, 0)
  await ui.click(ui.container.querySelector('button[aria-label="朗读 apple"]'))
  assert.equal(adapter.synth.spoken.at(-1).text, 'apple')
  await ui.click('收起')
  assert.equal(adapter.synth.speaking, false)
  assert.equal(api.calls.filter(c => /review.answer|lesson.complete/.test(c.command)).length, 0)
})

test('真实execute隔离课程下发音与书签只写音频位置，不改复习或课程完成', async t => {
  const root = await mkdtemp(join(tmpdir(), 'english-speech-ui-'))
  const now = new Date('2026-10-22T08:00:00+08:00')
  const run = (command, payload) => execute(root, command, payload, { now })
  const api = fixture()
  assert.equal((await run('profile.save', api.state.profile)).ok, true)
  const lesson = structuredClone(api.state.todayLesson)
  lesson.sources = [{ id: 'synthetic', url: 'https://example.com/synthetic', fetchedAt: now.toISOString(), license: 'Synthetic test text' }]
  for (const item of lesson.items) if (item.type === 'reading' || item.type === 'listening') item.sourceId = 'synthetic'
  lesson.items.push({ id: 'quiz', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['one', 'two', 'three', 'four'], answerIndex: 0 }] })
  assert.equal((await run('lesson.save', lesson)).ok, true)
  assert.equal((await run('lesson.start', { date: lesson.date })).ok, true)
  assert.equal((await run('review.add', { items: api.words })).ok, true)
  const beforeReview = await run('review.list')
  const beforeState = await run('state.get')
  const pending = new Set(), bookmarkPayloads = []
  const request = (command, payload) => {
    if (command === 'audio.bookmark.save') bookmarkPayloads.push(payload)
    const promise = run(command, payload)
    pending.add(promise)
    promise.finally(() => pending.delete(promise))
    return promise
  }
  const { ui, synth } = await open(t, { request })
  const settle = async () => { while (pending.size) await ui.flush(async () => { await Promise.all([...pending]) }) }
  await settle()
  assert.ok(ui.buttons('播放').length, ui.text())
  await ui.click('播放')
  await ui.flush(() => synth.spoken.at(-1).onend())
  await ui.click(ui.container.querySelector('button[aria-label="朗读 apple"]'))
  await ui.flush(() => synth.spoken.at(-1).onend())
  assert.deepEqual(await run('review.list'), beforeReview)
  const afterState = await run('state.get')
  assert.deepEqual(afterState.data.todayLesson, beforeState.data.todayLesson)
  assert.deepEqual(afterState.data.review, beforeState.data.review)
  await settle()
  const saves = await run('audio.bookmark.get', bookmarkPayloads.at(-1))
  assert.equal(saves.ok, true)
  assert.equal(saves.data.bookmark.position, 1)
  await ui.click('暂停')
  await settle()
})

test('播放中声源消失立即停止并保留句段，手动换声重试；暂停期间结束事件不推进', async t => {
  const { ui, synth } = await open(t)
  await ui.click('播放')
  await ui.flush(() => synth.spoken.at(-1).onend())
  await ui.flush(() => { synth.voices = [online]; synth.dispatchEvent(new Event('voiceschanged')) })
  assert.equal(synth.speaking, false)
  assert.match(ui.text(), /音色.*不可用/)
  assert.equal(ui.field('文本进度').value, '1')
  await ui.click('重试朗读')
  assert.equal(synth.spoken.at(-1).voice.voiceURI, online.voiceURI)
  const paused = synth.spoken.at(-1)
  await ui.click('暂停')
  await ui.flush(() => paused.onend())
  assert.equal(ui.field('文本进度').value, '1')
  const count = synth.spoken.length
  await ui.click('继续')
  assert.equal(synth.spoken.length, count + 1)
  assert.equal(synth.spoken.at(-1).text, 'Second sentence.')
})

test('原生resume表面成功却不回调时只重建一次当前句段，不计时推进文本', async t => {
  const { ui, synth } = await open(t)
  await ui.click('播放')
  await ui.flush(() => synth.spoken.at(-1).onend())
  await ui.click('暂停')
  synth.silentResume = true
  const count = synth.spoken.length
  await ui.click('继续')
  await ui.flush(async () => { await new Promise(resolve => setTimeout(resolve, 850)) })
  assert.equal(synth.spoken.length, count + 1)
  assert.equal(synth.spoken.at(-1).text, 'Second sentence.')
  assert.equal(ui.field('文本进度').value, '1')
})

test('完成终点与语音偏好重开保留；无Web Speech明确报错且空正文禁用进度', async t => {
  const api = fixture(), adapter = speechAdapter()
  let ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow })
  t.after(() => ui.close())
  await ui.input('英语音色', online.voiceURI)
  await ui.input('朗读语速', 1.5)
  await ui.click('播放')
  for (let i = 0; i < 3; i++) await ui.flush(() => adapter.synth.spoken.at(-1).onend())
  await ui.close()
  const count = adapter.synth.spoken.length
  ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow })
  assert.equal(adapter.synth.spoken.length, count)
  assert.equal(ui.field('文本进度').value, '3')
  assert.match(ui.text(), /朗读已完成/)
  assert.equal(ui.field('英语音色').value, online.voiceURI)
  assert.equal(ui.field('朗读语速').value, '1.5')
  await ui.input('朗读语速', 0.5)
  assert.equal(adapter.synth.spoken.length, count)
  assert.equal(ui.field('文本进度').value, '3')
  await ui.input('文本进度', 1)
  assert.equal(adapter.synth.spoken.length, count)
  await ui.click('继续')
  assert.equal(adapter.synth.spoken.at(-1).text, 'Second sentence.')
  await ui.close()
  ui = await mountClient({ request: api.request })
  await ui.click('继续')
  assert.match(ui.text(), /没有可用的语音合成/)
  await ui.close()
  api.state.todayLesson.items[0].body = ''
  ui = await mountClient({ request: api.request, setupWindow: adapter.setupWindow })
  assert.equal(ui.field('文本进度').disabled, true)
  assert.equal(ui.button('播放').disabled, true)
})

test('单词页学习卡、我的词汇及三套主题库列表详情发音不导航、不入队、不选库', async t => {
  const { ui, synth, api } = await open(t)
  await ui.click('单词')
  assert.equal(synth.spoken.length, 0)
  const cardButton = ui.container.querySelector('.ec-deck button[aria-label="朗读 apple"]')
  await ui.click(cardButton)
  assert.equal(synth.spoken.at(-1).text, 'apple')
  const listButton = ui.container.querySelector('.ec-lib-list button[aria-label="朗读 apple"]')
  await ui.click(listButton)
  assert.equal(ui.container.querySelector('[role="dialog"]'), null)
  await ui.click(ui.container.querySelector('.ec-lib-row'))
  await ui.click(ui.container.querySelector('[role="dialog"] button[aria-label="朗读 apple"]'))
  assert.equal(synth.spoken.at(-1).text, 'apple')
  await ui.click('关闭词汇详情')
  await ui.click('主题词库')
  for (const id of ['cet4', 'cet6', 'ielts']) {
    await ui.input('浏览词库', id)
    assert.match(ui.text(), /暂不可练/)
    const text = `${id} example`
    await ui.click(ui.container.querySelector(`.ec-lib-list button[aria-label="朗读 ${text}"]`))
    assert.equal(synth.spoken.at(-1).text, text)
    assert.equal(ui.container.querySelector('[role="dialog"]'), null)
    await ui.click(ui.container.querySelector('.ec-lib-row'))
    const button = ui.container.querySelector(`[role="dialog"] button[aria-label="朗读 ${text}"]`)
    await ui.key(button, '1')
    await ui.click(button)
    assert.equal(synth.spoken.at(-1).text, text)
    await ui.key(button, 'Escape')
    assert.equal(Boolean(ui.container.querySelector('[role="dialog"]')), false)
  }
  assert.equal(api.calls.filter(c => /review.answer|review.add|wordlists.select|study.supplement/.test(c.command)).length, 0)
})

test('无标点换行保留每段；cancel保留原生暂停标志时短词仍实际开始', async t => {
  const api = fixture(), adapter = speechAdapter()
  api.state.todayLesson.items[0].body = 'First line\nSecond line\nLast line'
  adapter.synth.cancel = function () { this.speaking = false }
  adapter.synth.speak = function (utterance) { this.spoken.push(utterance); this.speaking = !this.paused }
  const { ui, synth } = await open(t, api, adapter)
  await ui.click('播放')
  assert.equal(synth.spoken.at(-1).text, 'First line')
  await ui.flush(() => synth.spoken.at(-1).onend())
  assert.equal(synth.spoken.at(-1).text, 'Second line')
  await ui.click(ui.container.querySelector('button[aria-label="朗读 apple"]'))
  assert.equal(synth.spoken.at(-1).text, 'apple')
  assert.equal(synth.speaking, true)
  assert.equal(synth.paused, false)
  await ui.click('继续')
  synth.pause = function () { /* Host ignores native pause */ }
  await ui.click('暂停')
  assert.equal(synth.speaking, false)
  assert.match(ui.text(), /已暂停/)
})

test('晚到书签读取不得覆盖手动定位；换正文后的旧回调不得改新内容', async t => {
  const api = fixture(), waiting = deferred()
  const request = api.request
  let blocked = true
  api.request = (command, payload) => command === 'audio.bookmark.get' && blocked ? waiting.promise : request(command, payload)
  const { ui, synth } = await open(t, api)
  await ui.input('文本进度', 2)
  await ui.flush(() => waiting.resolve({ ok: true, data: { bookmark: { position: 1 }, invalidated: false } }))
  assert.equal(ui.field('文本进度').value, '2')
  blocked = false
  await ui.click('播放')
  const old = synth.spoken.at(-1)
  api.state.todayLesson.items[0].body = 'New first. New last.'
  await ui.poll()
  assert.equal(ui.field('文本进度').value, '0')
  assert.match(ui.text(), /正文已变化/)
  const count = synth.spoken.length
  await ui.flush(() => { old.onend(); old.onerror(); old.onboundary?.({ charIndex: 99 }) })
  assert.equal(synth.spoken.length, count)
  assert.equal(ui.field('文本进度').value, '0')
  await ui.click('播放')
  assert.equal(synth.spoken.at(-1).text, 'New first.')
})

test('三套真实内置目录的首条词库词条可发音且不产生个人复习项', async t => {
  const root = await mkdtemp(join(tmpdir(), 'english-speech-catalog-'))
  const now = new Date('2026-10-22T08:00:00+08:00')
  const run = (command, payload) => execute(root, command, payload, { now })
  await run('profile.save', { goal: 'study', minutesPerDay: 20, interests: [] })
  const pending = new Set()
  const request = (command, payload) => { const promise = run(command, payload); pending.add(promise); promise.finally(() => pending.delete(promise)); return promise }
  const { ui, synth } = await open(t, { request })
  const settle = async () => { while (pending.size) await ui.flush(async () => { await Promise.all([...pending]) }) }
  await settle()
  await ui.click('单词'); await settle()
  await ui.click('主题词库'); await settle()
  for (const id of ['cet4', 'cet6', 'ielts']) {
    await ui.input('浏览词库', id); await settle()
    const row = ui.container.querySelector('.ec-lib-row')
    const term = row.querySelector('.ec-lib-term').textContent
    const button = row.parentElement.querySelector('button[aria-label^="朗读 "]')
    await ui.click(button)
    assert.equal(synth.spoken.at(-1).text, term)
    assert.equal(Boolean(ui.container.querySelector('[role="dialog"]')), false)
  }
  assert.equal((await run('review.list')).data.total, 0)
  assert.equal((await run('settings.get')).data.study.activeWordListId, null)
  await settle()
})

test('缺失旧偏好只回退到真实声源，不自动试听；无英语音色错误后可手动恢复', async t => {
  const api = fixture(), adapter = speechAdapter()
  api.state.settings.audio = { voiceURI: 'removed-voice', rate: 99 }
  adapter.synth.voices = [{ voiceURI: 'zh', name: '中文', lang: 'zh-CN', localService: true }]
  const { ui, synth } = await open(t, api, adapter)
  assert.equal(synth.spoken.length, 0)
  assert.equal(ui.field('朗读语速').value, '1')
  await ui.click('播放')
  assert.equal(synth.spoken.length, 0)
  assert.match(ui.text(), /暂无可用英语音色/)
  await ui.flush(() => { synth.voices = [local]; synth.dispatchEvent(new Event('voiceschanged')) })
  assert.equal(synth.spoken.length, 0)
  assert.match(ui.text(), /偏好音色当前不可用/)
  await ui.click('重试朗读')
  assert.equal(synth.spoken.at(-1).voice.voiceURI, local.voiceURI)
  assert.equal(synth.spoken.at(-1).rate, 1)
})

function articleRow(ui, title) { return [...ui.container.querySelectorAll('.ec-li')].find(node => node.textContent.includes(title)) }

test('阅读和听力手动播放，原生暂停继续三次不会重播全文，句段结束保持终点', async t => {
  const { ui, synth } = await open(t)
  assert.equal(synth.spoken.length, 0)
  for (const [title, first, second] of [['阅读材料', 'First sentence.', 'Second sentence.'], ['听力材料', 'Listen first.', 'Listen second.']]) {
    if (title === '听力材料') await ui.click(articleRow(ui, title))
    await ui.click('播放')
    assert.equal(synth.spoken.at(-1).text, first)
    await ui.flush(() => synth.spoken.at(-1).onend())
    assert.equal(synth.spoken.at(-1).text, second)
    const before = synth.spoken.length
    for (let i = 0; i < 3; i++) { await ui.click('暂停'); assert.match(ui.text(), /已暂停/); await ui.click('继续') }
    assert.equal(synth.spoken.length, before)
    await ui.flush(() => synth.spoken.at(-1).onend())
    await ui.flush(() => synth.spoken.at(-1).onend())
    assert.match(ui.text(), /朗读已完成/)
    await ui.click('从头播放')
    assert.equal(synth.spoken.at(-1).text, first)
  }
  assert.equal(synth.resumes, 6)
})

test('文本跳播保持静默意图，原生恢复失效重建当前句，迟到事件不能覆盖新位置', async t => {
  const { ui, synth, api } = await open(t)
  await ui.input('文本进度', 1)
  assert.equal(synth.spoken.length, 0)
  await ui.click('播放')
  assert.equal(synth.spoken.at(-1).text, 'Second sentence.')
  const stale = synth.spoken.at(-1)
  await ui.input('文本进度', 2)
  assert.equal(synth.spoken.at(-1).text, 'Last sentence.')
  await ui.click('暂停')
  await ui.flush(() => { stale.onend(); stale.onerror(); stale.onboundary?.({ charIndex: 8 }) })
  assert.equal(ui.field('文本进度').value, '2')
  assert.match(ui.text(), /已暂停/)
  synth.failResume = true
  await ui.click('继续')
  assert.equal(synth.spoken.at(-1).text, 'Last sentence.')
  await ui.click('暂停')
  const count = synth.spoken.length
  await ui.input('文本进度', 0)
  assert.equal(synth.spoken.length, count)
  await ui.click('继续')
  assert.equal(synth.spoken.at(-1).text, 'First sentence.')
  await ui.flush(() => synth.spoken.at(-1).onerror({ error: 'network' }))
  assert.match(ui.text(), /朗读失败/)
  await ui.click('重试朗读')
  assert.equal(synth.spoken.at(-1).text, 'First sentence.')
  assert.equal(api.calls.filter(c => /review.answer|lesson.complete/.test(c.command)).length, 0)
})
