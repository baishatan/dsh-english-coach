import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { answerFixture } from './answer-fixture.js'
import { mountClient } from './client-harness.js'

function at(day) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, 9)
}
const now = at('2027-02-25')
const word = (term, extra = {}) => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有搭配讲解。', ...extra })
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'coach-due-correction-ui-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const run = (command, payload = {}, date = now) => execute(root, command, payload, { now: date })
  assert.equal((await run('profile.save', { goal: 'work', interests: [], minutesPerDay: 30 })).ok, true)
  const added = await run('review.add', { items: [word('alpha'), word('in fact', { kind: 'expression' }), word('on the whole', { kind: 'expression' })] }, at('2026-10-20'))
  for (const item of added.data.added) {
    for (const day of ['2026-10-20', '2026-10-21']) assert.equal((await answerFixture(root, { itemId: item.id, choice: 1 }, at(day))).ok, true)
  }
  const masteredId = added.data.added[2].id
  for (const day of ['2026-10-28', '2026-11-27']) assert.equal((await answerFixture(root, { itemId: masteredId, choice: 1 }, at(day))).ok, true)
  const pending = new Set()
  const api = {
    run, calls: [], failure: null,
    request(command, payload) {
      api.calls.push({ command, payload })
      if (command === 'review.answer' && api.failure) {
        const failure = api.failure
        api.failure = null
        return Promise.resolve(failure)
      }
      const result = run(command, payload)
      pending.add(result)
      void result.finally(() => pending.delete(result))
      return result
    },
    get hasPending() { return pending.size > 0 },
    async settle() { while (pending.size) await Promise.all([...pending]) }
  }
  const ui = await mountClient({ request: (command, payload) => api.request(command, payload), slot: ['main', 'shell.overlay'] })
  t.after(() => ui.close())
  ui.settle = async () => { do { await ui.flush(() => api.settle()) } while (api.hasPending) }
  await ui.settle()
  return { api, ui }
}
const choices = root => [...root.querySelectorAll('.ec-choice')]
const meaning = node => node.lastElementChild.textContent
const term = root => root.querySelector('.ec-deck-term,.ec-pop-term')?.textContent
const dots = root => root.querySelectorAll('.ec-dots i[data-on="true"]').length
const action = (root, text) => [...root.querySelectorAll('button')].find(node => node.textContent.trim() === text)
async function keyChoice(ui, root, text) {
  const index = choices(root).map(meaning).indexOf(text)
  assert.ok(index >= 0)
  await ui.key(ui.window.document.body, String(index + 1))
  await ui.settle()
}

test('旧词、表达与掌握抽检跨三入口共享纠正队尾、已保存圆点及完成数，失败不能跳过', async t => {
  const { api, ui } = await fixture(t)
  const main = () => ui.container.querySelector('[data-test-slot="main"]')
  const pop = () => ui.container.querySelector('.ec-pop')
  assert.equal(term(main()), 'alpha')
  assert.equal(dots(main()), 2)
  await keyChoice(ui, main(), '另一释义')
  assert.match(ui.text(), /答错了.*保留已有搭配讲解/)
  assert.equal(dots(main()), 2)
  await ui.click('单词')
  await ui.settle()
  assert.match(main().textContent, /答错了/)
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.settle()
  assert.equal(term(pop()), 'alpha')
  assert.equal(dots(pop()), 2)
  assert.match(pop().textContent, /已完成 0 \/ 3 项/)
  await ui.click('收起')
  await ui.click(action(main(), '下一个')); await ui.settle()
  assert.equal(term(main()), 'in fact')
  await ui.click(choices(main()).find(node => meaning(node) === '正确释义'))
  await ui.settle()
  assert.equal(dots(main()), 3, '旧表达正确反馈立即显示新格')
  await ui.click(action(main(), '下一个')); await ui.settle()
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.settle()
  assert.equal(term(pop()), 'on the whole')
  assert.equal(dots(pop()), 4)
  await keyChoice(ui, pop(), '另一释义')
  assert.equal(dots(pop()), 4)
  assert.equal(dots(main()), 4)
  assert.match(pop().textContent, /已完成 1 \/ 3 项/)
  assert.equal((await api.run('progress.get')).data.mastered, 1)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.equal(term(pop()), 'alpha')
  assert.equal(dots(pop()), 2)
  assert.deepEqual(choices(main()).map(meaning), choices(pop()).map(meaning))
  assert.deepEqual(choices(pop()).map(meaning).sort(), ['另一释义', '正确释义', '第三释义', '第四释义'].sort())
  await keyChoice(ui, pop(), '另一释义')
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.equal(term(pop()), 'on the whole')
  await keyChoice(ui, pop(), '正确释义')
  assert.equal(dots(pop()), 4)
  assert.match(pop().textContent, /已完成 2 \/ 3 项/)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.equal(term(pop()), 'alpha')
  await ui.click('收起')
  await ui.click('今日')
  await ui.settle()
  api.failure = { ok: false, message: '合成Host通信失败，作答未保存' }
  await keyChoice(ui, main(), '正确释义')
  assert.match(main().textContent, /作答未保存/)
  assert.equal(dots(main()), 2)
  assert.match(main().textContent, /已完成 2 \/ 3 项/)
  assert.equal(ui.buttons('下一个').length, 0)
  assert.equal(ui.buttons('完成复习').length, 0)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.equal(term(main()), 'alpha')
  await keyChoice(ui, main(), '正确释义')
  assert.equal(dots(main()), 3)
  await ui.click('完成复习'); await ui.settle()
  assert.match(main().textContent, /已完成 3 \/ 3 项/)
  const saved = (await api.run('review.list')).data.items
  assert.deepEqual(saved.map(item => [item.term, item.box, item.answerCount, item.due]), [
    ['alpha', 3, 5, false], ['in fact', 3, 3, false], ['on the whole', 4, 6, false]
  ])
  assert.equal(api.calls.filter(call => call.command === 'study.batch').length, 5, '跨入口只同步保存批次')
  assert.equal(api.calls.filter(call => call.command === 'review.answer').length, 7)
  assert.equal(api.calls.some(call => call.command === 'generate.vocab'), false)
})
