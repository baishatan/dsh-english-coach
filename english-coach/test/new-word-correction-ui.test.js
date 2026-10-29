import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { mountClient } from './client-harness.js'

const now = new Date(2026, 9, 29, 9)
const word = (term, extra = {}) => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有搭配讲解。', ...extra })
async function fixture(t, items = [word('reprieve')]) {
  const root = await fs.mkdtemp(join(tmpdir(), 'coach-correction-ui-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  assert.equal((await run('profile.save', { goal: 'work', interests: [], minutesPerDay: 30 })).ok, true)
  assert.equal((await run('review.add', { items })).ok, true)
  const pending = new Set()
  const api = {
    calls: [], run,
    request(command, payload) {
      api.calls.push({ command, payload })
      const result = run(command, payload)
      pending.add(result)
      void result.finally(() => pending.delete(result))
      return result
    },
    get hasPending() { return pending.size > 0 },
    async settle() { while (pending.size) await Promise.all([...pending]) }
  }
  return api
}
async function open(t, api, options = {}) {
  const ui = await mountClient({ request: (command, payload) => api.request(command, payload), ...options })
  t.after(() => ui.close())
  ui.settle = async () => { do { await ui.flush(() => api.settle()) } while (api.hasPending) }
  await ui.settle()
  return ui
}
const choices = root => [...root.querySelectorAll('.ec-choice')]
const meaning = node => node.lastElementChild.textContent
const choose = (ui, root, text = '正确释义') => ui.click(choices(root).find(node => meaning(node) === text))
const term = root => root.querySelector('.ec-deck-term,.ec-pop-term')?.textContent

test('新词显示零格四圆点，首次保存正确反馈即时亮第一格', async t => {
  const api = await fixture(t)
  const ui = await open(t, api)
  assert.equal(ui.container.querySelectorAll('.ec-dots i').length, 4)
  assert.equal(ui.container.querySelectorAll('.ec-dots i[data-on="true"]').length, 0)
  await choose(ui, ui.container)
  await ui.settle()
  assert.match(ui.text(), /答对了/)
  assert.equal(ui.container.querySelectorAll('.ec-dots i[data-on="true"]').length, 1)
  assert.equal((await api.run('review.list')).data.items[0].box, 1)
})

test('A错后先练B/C再回A，重复错误及仅剩A也必须纠正后才完成', async t => {
  const api = await fixture(t, [word('alpha'), word('beta'), word('in fact', { kind: 'expression' })])
  const ui = await open(t, api)
  await choose(ui, ui.container, '另一释义')
  await ui.settle()
  assert.match(ui.text(), /答错了.*正确释义.*保留已有搭配讲解/)
  assert.equal(ui.buttons('完成复习').length, 0)
  await ui.click('下一个'); await ui.settle()
  assert.equal(term(ui.container), 'beta')
  await choose(ui, ui.container)
  await ui.settle()
  await ui.click('下一个'); await ui.settle()
  assert.equal(term(ui.container), 'in fact')
  await choose(ui, ui.container)
  await ui.settle()
  assert.equal(ui.buttons('完成复习').length, 0, '原题序走到末尾不代表本批完成')
  await ui.click('下一个'); await ui.settle()
  assert.equal(term(ui.container), 'alpha')
  assert.match(ui.text(), /已完成 2 \/ 3 项/)
  await choose(ui, ui.container, '另一释义')
  await ui.settle()
  await ui.click('下一个'); await ui.settle()
  assert.equal(term(ui.container), 'alpha')
  assert.match(ui.text(), /已完成 2 \/ 3 项/)
  await choose(ui, ui.container)
  await ui.settle()
  assert.equal(ui.container.querySelectorAll('.ec-dots i[data-on="true"]').length, 1)
  await ui.click('完成复习'); await ui.settle()
  assert.match(ui.text(), /已完成 3 \/ 3 项/)
  assert.equal(api.calls.filter(call => call.command === 'review.answer').length, 5)
  assert.equal(api.calls.some(call => call.command === 'generate.vocab'), false)
  assert.ok((await api.run('review.list')).data.items.every(item => item.box === 1 && !item.due))
})

test('每次纠正打乱原四选项，数字键、选中反馈和宿主答案映射一致', async t => {
  const api = await fixture(t)
  const ui = await open(t, api)
  let order = choices(ui.container).map(meaning)
  for (let attempt = 0; attempt < 2; attempt++) {
    const wrongPosition = order.indexOf('另一释义')
    await ui.key(ui.window.document.body, String(wrongPosition + 1))
    await ui.settle()
    assert.equal(choices(ui.container)[wrongPosition].getAttribute('data-state'), 'wrong')
    assert.equal(choices(ui.container).find(node => node.getAttribute('data-state') === 'right').lastElementChild.textContent, '正确释义')
    await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
    const retryOrder = choices(ui.container).map(meaning)
    assert.notDeepEqual(retryOrder, order, '重试不能沿用上一次的选项位置')
    assert.deepEqual([...retryOrder].sort(), ['另一释义', '正确释义', '第三释义', '第四释义'].sort())
    assert.equal(term(ui.container), 'reprieve')
    order = retryOrder
  }
  await ui.key(ui.window.document.body, String(order.indexOf('正确释义') + 1))
  await ui.settle()
  assert.match(ui.text(), /答对了/)
  assert.deepEqual(api.calls.filter(call => call.command === 'review.answer').map(call => call.payload.choice), [0, 0, 1])
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.match(ui.text(), /已完成 1 \/ 1 项/)
})

test('保存失败及not_due都保留未完成题目，不允许跳过或冒充本批完成', async t => {
  const api = await fixture(t)
  const request = api.request
  const ui = await open(t, api)
  for (const failure of [{ ok: false, message: '作答未保存，请重试' }, { ok: false, code: 'not_due', message: '当前还未到期' }]) {
    api.request = async (command, payload) => command === 'review.answer' ? failure : request(command, payload)
    await choose(ui, ui.container)
    await ui.settle()
    assert.match(ui.text(), new RegExp(failure.message))
    assert.equal(term(ui.container), 'reprieve')
    assert.equal(ui.buttons('下一个').length, 0)
    assert.equal(ui.buttons('完成复习').length, 0)
    assert.equal(ui.buttons('继续学习').length, 0)
    await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
    assert.equal(term(ui.container), 'reprieve')
    assert.equal(ui.container.querySelectorAll('.ec-dots i[data-on="true"]').length, 0)
    assert.equal((await api.run('review.list')).data.items[0].answerCount, 0)
  }
  api.request = request
  await choose(ui, ui.container)
  await ui.settle()
  await ui.click('完成复习'); await ui.settle()
  assert.match(ui.text(), /已完成 1 \/ 1 项/)
})

test('今日、单词与悬浮层共享错误反馈、纠正顺序及核心完成数，关闭不跳过', async t => {
  const api = await fixture(t, [word('alpha'), word('beta')])
  const ui = await open(t, api, { slot: ['main', 'shell.overlay'] })
  const main = () => ui.container.querySelector('[data-test-slot="main"]')
  const pop = () => ui.container.querySelector('.ec-pop')
  const action = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  await choose(ui, main(), '另一释义')
  await ui.settle()
  await ui.click('单词')
  await ui.settle()
  assert.match(main().textContent, /答错了/)
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.settle()
  assert.match(pop().textContent, /答错了.*保留已有搭配讲解/)
  assert.equal(pop().querySelectorAll('.ec-dots i').length, 4)
  assert.equal(pop().querySelectorAll('.ec-dots i[data-on="true"]').length, 0)
  assert.match(pop().textContent, /已完成 0 \/ 2 项/)
  await ui.click('收起')
  await ui.click('今日')
  await ui.settle()
  assert.equal(term(main()), 'alpha')
  assert.match(main().textContent, /答错了/)
  await ui.click(action(main(), '下一个')); await ui.settle()
  await choose(ui, main())
  await ui.settle()
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.settle()
  assert.equal(term(pop()), 'beta')
  assert.match(pop().textContent, /已完成 1 \/ 2 项/)
  await ui.click(action(pop(), '下一个')); await ui.settle()
  assert.equal(term(main()), 'alpha')
  assert.deepEqual(choices(main()).map(meaning), choices(pop()).map(meaning))
  await choose(ui, pop())
  await ui.settle()
  assert.equal(main().querySelectorAll('.ec-dots i[data-on="true"]').length, 1)
  assert.equal(pop().querySelectorAll('.ec-dots i[data-on="true"]').length, 1)
  await ui.click(action(pop(), '完成复习')); await ui.settle()
  assert.match(main().textContent, /已完成 2 \/ 2 项/)
  assert.match(pop().textContent, /已完成 2 \/ 2 项/)
  assert.equal(api.calls.filter(call => call.command === 'study.batch').length, 1)
  assert.equal(api.calls.filter(call => call.command === 'review.answer').length, 3)
})

test('独立窄悬浮入口可用数字键纠正，Enter继续，Esc收起不丢当前词', async t => {
  const api = await fixture(t)
  const ui = await open(t, api, { slot: 'shell.overlay', setupWindow(window) { Object.defineProperty(window, 'innerWidth', { value: 360 }) } })
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.settle()
  await ui.key(ui.window.document.body, '1')
  await ui.settle()
  assert.match(ui.text(), /答错了/)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.equal(term(ui.container), 'reprieve')
  assert.doesNotMatch(ui.text(), /答错了/)
  const order = choices(ui.container).map(meaning)
  await ui.key(ui.window.document.body, 'Escape')
  assert.equal(ui.container.querySelector('.ec-pop'), null)
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.settle()
  assert.deepEqual(choices(ui.container).map(meaning), order)
  await ui.key(ui.window.document.body, String(order.indexOf('正确释义') + 1))
  await ui.settle()
  assert.match(ui.text(), /答对了/)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.match(ui.text(), /已完成 1 \/ 1 项/)
})

test('纠正后焦点回到当前题，发音只朗读且保留错误反馈和零格', async t => {
  const api = await fixture(t)
  const spoken = []
  const ui = await open(t, api, { setupWindow(window) {
    const synth = new window.EventTarget()
    Object.assign(synth, { getVoices: () => [{ voiceURI: 'test-en', name: 'Test English', lang: 'en-US', localService: true }], cancel() {}, speak(utterance) { spoken.push(utterance.text) } })
    window.speechSynthesis = synth
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
  } })
  await choose(ui, ui.container, '另一释义')
  await ui.settle()
  await ui.click('朗读 reprieve')
  assert.deepEqual(spoken, ['reprieve'])
  assert.match(ui.text(), /答错了/)
  assert.equal(api.calls.filter(call => call.command === 'review.answer').length, 1)
  await ui.click('下一个'); await ui.settle()
  assert.ok(ui.window.document.activeElement === ui.container.querySelector('.ec-deck'), '继续后焦点应回到当前学习题')
  assert.equal(ui.container.querySelectorAll('.ec-dots i[data-on="true"]').length, 0)
  const position = choices(ui.container).map(meaning).indexOf('正确释义')
  await ui.key(ui.window.document.activeElement, String(position + 1))
  await ui.settle()
  assert.match(ui.text(), /答对了/)
})
