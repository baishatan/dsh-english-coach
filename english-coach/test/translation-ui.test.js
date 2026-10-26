import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient } from './client-harness.js'

function fixture() {
  const read = { id: 'read', type: 'reading', title: '阅读材料', body: 'First paragraph.\r\nA continued line.\r\n \t\r\nSecond paragraph.', translations: ['第一段译文。\n同段另一行。', '第二段译文。'] }
  const listen = { id: 'listen', type: 'listening', title: '听力材料', transcript: 'Listen first.\n\nListen second.', translations: ['听力第一段译文。', '听力第二段译文。'] }
  const state = { onboarded: true, now: '2026-10-26', profile: { goal: 'work', interests: [] }, settings: {}, review: { dueCount: 0 }, todayLesson: { date: '2026-10-26', title: '合成双语课', status: 'active', sources: [{ id: 'source', title: '合成来源', url: 'https://example.com/article', fetchedAt: '2026-10-26T00:00:00Z', license: '合成测试' }], items: [read, listen] } }
  read.sourceId = 'source'; listen.sourceId = 'source'
  const calls = [], spoken = []
  return { state, read, listen, calls, spoken,
    setupWindow(window) {
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
      window.speechSynthesis = { getVoices: () => [{ voiceURI: 'test', lang: 'en-US', name: 'Synthetic', localService: true }], speak: value => spoken.push(value), cancel() {}, pause() {}, addEventListener() {}, removeEventListener() {} }
    },
    async request(command, payload) {
      calls.push({ command, payload })
      if (command === 'state.get') return { ok: true, data: structuredClone(state) }
      if (command === 'study.batch' || command === 'review.list') return { ok: true, data: { items: [], dueCount: 0, batchSize: 3 } }
      if (command === 'settings.get') return { ok: true, data: {} }
      if (command === 'audio.bookmark.get') return { ok: true, data: { bookmark: null } }
      if (command === 'audio.bookmark.save') return { ok: true, data: payload }
      throw new Error(`Unexpected Host request: ${command}`)
    }
  }
}
const row = (ui, title) => [...ui.container.querySelectorAll('button.ec-li')].find(node => node.textContent.includes(title))

test('阅读按原文段落显示，译文默认不渲染且独立点击才展开与收起', async t => {
  const api = fixture()
  const ui = await mountClient(api)
  t.after(() => ui.close())
  const body = ui.container.querySelector('.ec-item-body')
  assert.match(body.textContent, /First paragraph.*A continued line/s)
  assert.match(body.textContent, /Second paragraph/)
  const toggles = [...body.querySelectorAll('button')].filter(button => button.textContent === '译文')
  assert.equal(toggles.length, 2, 'Each nonempty English paragraph needs its own translation toggle')
  assert.doesNotMatch(body.textContent, /第一段译文|第二段译文/)
  for (const toggle of toggles) {
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.ok(toggle.getAttribute('aria-controls'))
  }
  await ui.click(toggles[1])
  assert.match(body.textContent, /第二段译文/)
  assert.doesNotMatch(body.textContent, /第一段译文/)
  assert.equal(toggles[1].getAttribute('aria-expanded'), 'true')
  assert.equal(ui.window.document.getElementById(toggles[1].getAttribute('aria-controls')).textContent, '第二段译文。')
  await ui.click(toggles[0])
  assert.match(body.textContent, /第一段译文/)
  await ui.click(toggles[1])
  assert.doesNotMatch(body.textContent, /第二段译文/)
  assert.match(body.textContent, /第一段译文/)
  assert.equal(api.calls.filter(({ command }) => /review.answer|lesson.complete/.test(command)).length, 0)
})

test('听力每段译文独立折叠，不自动播放或把中文加入英文朗读', async t => {
  const api = fixture()
  const ui = await mountClient(api)
  t.after(() => ui.close())
  await ui.click(row(ui, '听力材料'))
  const body = ui.container.querySelector('.ec-item-body')
  const toggles = [...body.querySelectorAll('.ec-translation-toggle')]
  assert.equal(toggles.length, 2)
  assert.doesNotMatch(body.textContent, /听力第一段译文|听力第二段译文/)
  assert.equal(api.spoken.length, 0)
  toggles[0].focus()
  await ui.key(toggles[0], '1')
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 0)
  await ui.click(toggles[0])
  assert.equal(ui.window.document.activeElement, toggles[0], 'Toggling keeps keyboard focus on its control')
  assert.match(body.textContent, /听力第一段译文/)
  assert.doesNotMatch(body.textContent, /听力第二段译文/)
  assert.equal(api.spoken.length, 0)
  await ui.click('播放')
  assert.equal(api.spoken[0].text, 'Listen first.')
  await ui.flush(() => api.spoken[0].onend())
  assert.equal(api.spoken[1].text, 'Listen second.')
  assert.ok(api.spoken.every(value => !/[\u3400-\u9fff]/.test(value.text)))
  assert.equal(api.calls.filter(({ command }) => /review.answer|lesson.complete/.test(command)).length, 0)
})

test('旧课没有译文及数量错位时如实提示，不错配或触发生成', async t => {
  const api = fixture()
  delete api.read.translations
  api.listen.translations = ['不可错配的中文']
  const ui = await mountClient(api)
  t.after(() => ui.close())
  assert.equal(ui.container.querySelectorAll('.ec-translation-toggle').length, 0)
  assert.equal(ui.container.querySelectorAll('.ec-translation-missing').length, 2)
  assert.match(ui.text(), /First paragraph/)
  await ui.click(row(ui, '听力材料'))
  assert.equal(ui.container.querySelectorAll('.ec-translation-toggle').length, 0)
  assert.equal(ui.container.querySelectorAll('.ec-translation-missing').length, 2)
  assert.doesNotMatch(ui.text(), /不可错配的中文/)
  assert.equal(api.calls.filter(({ command }) => /generate|lesson.save/.test(command)).length, 0)
})

test('译文作为纯文本呈现，折叠与正文版本更换后默认隐藏', async t => {
  const api = fixture()
  api.read.translations[0] = '<img src=x onerror=alert(1)> & 中文'
  const ui = await mountClient(api)
  t.after(() => ui.close())
  await ui.click(ui.buttons('译文')[0])
  assert.equal(ui.container.querySelector('.ec-translation').textContent, '<img src=x onerror=alert(1)> & 中文')
  assert.equal(ui.container.querySelector('.ec-translation img'), null)
  await ui.poll()
  assert.equal(ui.container.querySelectorAll('.ec-translation').length, 1, 'An ordinary poll does not collapse an opened translation')
  api.read.body = 'Changed first.\n\nChanged second.'
  api.read.translations = ['更新第一段。', '更新第二段。']
  await ui.poll()
  assert.equal(ui.container.querySelectorAll('.ec-translation').length, 0)
  assert.match(ui.text(), /Changed first/)
  await ui.click(ui.buttons('译文')[0])
  assert.match(ui.text(), /更新第一段/)
  await ui.click(row(ui, '阅读材料'))
  await ui.click(row(ui, '阅读材料'))
  assert.equal(ui.container.querySelectorAll('.ec-translation').length, 0)
  assert.equal(api.spoken.length, 0)
})

for (const [separator, count] of [['\n', 1], ['\n\n', 2], ['\r\n \t\r\n\r\n', 2], ['\r\r', 2]]) {
  test(`正文分段与可选译文契约一致 ${JSON.stringify(separator)}`, async t => {
    const api = fixture()
    api.read.body = `  \n\nFirst.${separator}Second.\n\n `
    api.read.translations = count === 1 ? ['合并一段译文。'] : ['首段译文。', '末段译文。']
    const ui = await mountClient(api)
    t.after(() => ui.close())
    assert.equal(ui.container.querySelectorAll('.ec-translation-toggle').length, count)
    assert.equal(ui.container.querySelectorAll('.ec-translation').length, 0)
  })
}
