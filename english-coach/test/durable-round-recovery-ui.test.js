import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'

const word = term => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有讲解。' })
const choices = root => [...root.querySelectorAll('.ec-choice')]
const meaning = node => node.lastElementChild.textContent
const term = ui => ui.container.querySelector('.ec-deck-term,.ec-pop-term')?.textContent
async function fixture(t, terms = ['alpha', 'beta']) {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-durable-ui-'))
  const api = { now: new Date(2026, 9, 29, 23, 50), calls: [], intercept: null }
  const run = (command, payload = {}) => execute(root, command, payload, { now: api.now })
  await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })
  await run('review.add', { items: terms.map(word) })
  const pending = new Set()
  let ui
  api.run = run
  api.open = async (slot = 'main') => {
    if (ui) { await ui.close(); ui = null }
    ui = await mountClient({ slot, setupWindow(window) { Object.defineProperty(window, 'innerWidth', { value: 360 }) }, request(command, payload) {
      api.calls.push({ command, payload })
      const result = Promise.resolve(api.intercept?.(command, payload) ?? (command === 'generate.vocab' ? run('study.supplement', payload) : run(command, payload)))
      pending.add(result)
      void result.finally(() => pending.delete(result))
      return result
    } })
    ui.settle = async () => {
      const remaining = () => [...pending].filter(promise => promise !== api.ignored)
      do { await ui.flush(() => Promise.all(remaining())) } while (remaining().length)
    }
    await ui.settle()
    if (slot === 'shell.overlay') { await ui.click(ui.container.querySelector('.ec-pill-btn')); await ui.settle() }
    return ui
  }
  t.after(async () => {
    await Promise.all([...pending])
    if (ui) await ui.close()
    assert.equal(dirname(root), temporary)
    assert.ok(root.split('/').at(-1).startsWith('coach-durable-ui-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  return api
}
async function choose(ui, text) {
  await ui.click(choices(ui.container).find(node => meaning(node) === text))
  await ui.settle()
}

test('全新VM从持久态恢复未答、错误反馈、正确反馈及完成四态，跨入口跨天仍续原批', async t => {
  const api = await fixture(t)
  let ui = await api.open()
  const initialOrder = choices(ui.container).map(meaning)
  assert.equal(term(ui), 'alpha')
  ui = await api.open('shell.overlay')
  assert.equal(term(ui), 'alpha')
  assert.deepEqual(choices(ui.container).map(meaning), initialOrder)
  await choose(ui, '另一释义')
  const wrongStates = choices(ui.container).map(node => node.getAttribute('data-state'))
  ui = await api.open()
  assert.equal(term(ui), 'alpha')
  assert.match(ui.text(), /答错了.*保留已有讲解/)
  assert.deepEqual(choices(ui.container).map(meaning), initialOrder)
  assert.deepEqual(choices(ui.container).map(node => node.getAttribute('data-state')), wrongStates)
  assert.match(ui.text(), /已完成 0 \/ 2 项/)
  await ui.click('下一个'); await ui.settle()
  assert.equal(term(ui), 'beta')
  await choose(ui, '正确释义')
  api.now = new Date(2026, 10, 2, 8)
  await api.run('review.add', { items: [word('newly due')] })
  ui = await api.open()
  await ui.click('单词'); await ui.settle()
  assert.equal(term(ui), 'beta')
  assert.match(ui.text(), /答对了/)
  assert.match(ui.text(), /已完成 1 \/ 2 项/)
  assert.equal(ui.container.querySelectorAll('.ec-dots i[data-on="true"]').length, 1)
  await ui.click('下一个'); await ui.settle()
  assert.equal(term(ui), 'alpha')
  const retryOrder = choices(ui.container).map(meaning)
  assert.notDeepEqual(retryOrder, initialOrder)
  ui = await api.open('shell.overlay')
  assert.equal(term(ui), 'alpha')
  assert.deepEqual(choices(ui.container).map(meaning), retryOrder)
  await ui.key(ui.window.document.body, String(retryOrder.indexOf('正确释义') + 1)); await ui.settle()
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.match(ui.text(), /已完成 2 \/ 2 项/)
  ui = await api.open()
  assert.match(ui.text(), /已完成 2 \/ 2 项/)
  assert.equal(term(ui), undefined)
  assert.equal(api.calls.filter(call => call.command === 'generate.vocab').length, 0)
  const items = (await api.run('review.list')).data.items
  assert.equal(items.find(item => item.term === 'alpha').dueAt, new Date(2026, 10, 3, 8).toISOString())
  assert.equal(items.find(item => item.term === 'beta').answerCount, 1)
  assert.deepEqual((await api.run('study.batch')).data.round.summary, { total: 2, completed: 2, firstTryCorrect: 1, retryCount: 1 })
  await ui.click('继续学习'); await ui.settle()
  assert.equal(term(ui), 'beta', '明确继续才可按实时到期选下一批')
})

test('恢复读取和下一题保存失败均可重试，关闭在途请求后新VM只恢复已保存事实', async t => {
  const api = await fixture(t, ['alpha'])
  let failRead = true
  api.intercept = command => command === 'study.batch' && failRead ? { ok: false, message: '恢复批次暂时失败，请重试' } : null
  let ui = await api.open()
  assert.match(ui.text(), /恢复批次暂时失败/)
  assert.equal(ui.buttons('继续学习').length, 0)
  failRead = false
  await ui.click('重试'); await ui.settle()
  assert.equal(term(ui), 'alpha')
  const pending = deferred()
  api.ignored = pending.promise
  api.intercept = command => command === 'review.answer' ? pending.promise : null
  await ui.click(choices(ui.container).find(node => meaning(node) === '正确释义'))
  assert.equal(choices(ui.container)[0].disabled, true)
  ui = await api.open('shell.overlay')
  assert.equal(term(ui), 'alpha')
  assert.doesNotMatch(ui.text(), /答对了|已完成 1 \/ 1 项/)
  await ui.flush(() => pending.resolve({ ok: false, message: '关闭前的请求未保存' })); await ui.settle()
  assert.equal(term(ui), 'alpha')
  api.intercept = null
  await choose(ui, '正确释义')
  api.intercept = command => command === 'study.next' ? { ok: false, message: '下一题未保存，请重试' } : null
  await ui.click('完成复习'); await ui.settle()
  assert.match(ui.text(), /下一题未保存/)
  assert.match(ui.text(), /答对了/)
  assert.equal(term(ui), 'alpha')
  ui = await api.open()
  assert.equal(term(ui), 'alpha')
  assert.match(ui.text(), /答对了/)
  api.intercept = null
  await ui.click('完成复习'); await ui.settle()
  assert.match(ui.text(), /已完成 1 \/ 1 项/)
  assert.equal((await api.run('review.list')).data.items[0].answerCount, 1)
})
