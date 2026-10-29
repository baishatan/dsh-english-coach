import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'

const word = (term, extra = {}) => ({ term, kind: 'word', meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有讲解。', ...extra })
const choices = ui => [...ui.container.querySelectorAll('.ec-choice')]
const meaning = node => node.lastElementChild.textContent
async function fixture(t, items = [word('in fact', { kind: 'expression' })], now = new Date(2026, 9, 29, 23, 50)) {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-round-outcome-ui-'))
  const api = { now, calls: [], intercept: null }
  const run = (command, payload = {}, now = api.now) => execute(root, command, payload, { now })
  assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  assert.equal((await run('review.add', { items })).ok, true)
  const pending = new Set()
  let ui
  api.run = run
  api.open = async (entry = 'today') => {
    if (ui) { await ui.close(); ui = null }
    const current = await mountClient({ slot: entry === 'overlay' ? 'shell.overlay' : 'main', setupWindow(window) {
      Object.defineProperty(window, 'innerWidth', { value: 360 })
    }, request(command, payload) {
      api.calls.push({ command, payload })
      const result = Promise.resolve(api.intercept?.(command, payload) ?? run(command === 'generate.vocab' ? 'study.supplement' : command, payload))
      pending.add(result)
      void result.finally(() => pending.delete(result))
      return result
    } })
    ui = current
    current.settle = async () => {
      const remaining = () => [...pending].filter(promise => promise !== api.ignored)
      do { await current.flush(() => Promise.all(remaining())) } while (remaining().length)
    }
    await current.settle()
    if (entry === 'words') { await current.click('单词'); await current.settle() }
    if (entry === 'overlay') { await current.click(current.container.querySelector('.ec-pill-btn')); await current.settle() }
    return current
  }
  t.after(async () => {
    api.release?.()
    await Promise.all([...pending])
    if (ui) await ui.close()
    assert.equal(dirname(resolve(root)), temporary)
    assert.ok(root.split('/').at(-1).startsWith('coach-round-outcome-ui-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  return api
}
async function choose(ui, text) {
  const node = choices(ui).find(node => meaning(node) === text)
  assert.ok(node, `缺少可见选项：${text}`)
  await ui.click(node)
  await ui.settle()
}
async function next(ui) {
  await ui.click(ui.buttons('完成复习')[0] ?? ui.button('下一个'))
  await ui.settle()
}
function assertOutcome(ui, completed, total, firstTryCorrect, retryCount) {
  assert.match(ui.text(), new RegExp(`已完成 ${completed} / ${total} 项`))
  assert.match(ui.text(), new RegExp(`首次答对 ${firstTryCorrect} 项`))
  assert.match(ui.text(), new RegExp(`重试 ${retryCount} 次`))
  assert.doesNotMatch(ui.text(), /最终.*100%|正确率.*100%/)
}

test('今日和单词页在未答及错错对反馈中分别显示项完成、首次答对和有效重试', async t => {
  const api = await fixture(t)
  const ui = await api.open()
  assertOutcome(ui, 0, 1, 0, 0)
  await choose(ui, '另一释义')
  assertOutcome(ui, 0, 1, 0, 0)
  await ui.click('单词'); await ui.settle()
  assertOutcome(ui, 0, 1, 0, 0)
  await next(ui)
  await choose(ui, '另一释义')
  assertOutcome(ui, 0, 1, 0, 1)
  await next(ui)
  await choose(ui, '正确释义')
  assertOutcome(ui, 1, 1, 0, 2)
  assert.match(ui.text(), /答对了/)
  assert.doesNotMatch(ui.text(), /这一批学完了/)
  assert.equal((await api.run('study.batch')).data.round.status, 'active', '最后正确反馈仍待显式继续保存')
})

test('十项混合初学和到期复习共十五次有效作答，完成与重开仍保留首次表现及五次重试', async t => {
  const api = await fixture(t, [word('old word'), word('old expression', { kind: 'expression' })], new Date(2026, 9, 28, 9))
  const oldItems = (await api.run('review.list')).data.items
  for (const item of oldItems) assert.equal((await api.run('review.answer', { itemId: item.id, choice: 1, attemptId: `prepare-old-${item.id}` })).ok, true)
  api.now = new Date(2026, 9, 29, 23, 50)
  assert.equal((await api.run('review.add', { items: Array.from({ length: 8 }, (_, i) => word(`new ${i}`)) })).ok, true)
  const original = (await api.run('study.batch')).data
  assert.equal(original.items.filter(item => !item.fresh).length, 2)
  assert.equal(original.items.filter(item => item.kind === 'expression').length, 1)
  let ui = await api.open()
  for (let i = 0; i < 10; i++) {
    await choose(ui, i < 4 ? '另一释义' : '正确释义')
    await next(ui)
  }
  assertOutcome(ui, 6, 10, 6, 0)
  await choose(ui, '另一释义'); await next(ui)
  for (let i = 0; i < 4; i++) { await choose(ui, '正确释义'); await next(ui) }
  assert.deepEqual((await api.run('study.batch')).data.round.summary, { total: 10, completed: 10, firstTryCorrect: 6, retryCount: 5 })
  assertOutcome(ui, 10, 10, 6, 5)
  assert.match(ui.text(), /这一批学完了/)
  assert.doesNotMatch(ui.text(), /这批答对 10 个/)
  api.now = new Date(2026, 9, 30, 8)
  for (const entry of ['today', 'words']) {
    ui = await api.open(entry)
    assertOutcome(ui, 10, 10, 6, 5)
    assert.equal(ui.container.querySelector('.ec-deck-term'), null)
    assert.equal((await api.run('study.batch')).data.round.id, original.round.id)
  }
  assert.equal(api.calls.filter(call => call.command === 'generate.vocab').length, 0)
})

test('窄悬浮层从新VM恢复未答和跨日错错对成绩，键盘继续后完成态仍列首次与重试', async t => {
  const api = await fixture(t)
  let ui = await api.open('overlay')
  assertOutcome(ui, 0, 1, 0, 0)
  await choose(ui, '另一释义')
  ui = await api.open('overlay')
  assert.match(ui.text(), /答错了/)
  assertOutcome(ui, 0, 1, 0, 0)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  await choose(ui, '另一释义')
  api.now = new Date(2026, 9, 30, 8)
  ui = await api.open('overlay')
  assertOutcome(ui, 0, 1, 0, 1)
  assert.match(ui.text(), /答错了/)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  const position = choices(ui).map(meaning).indexOf('正确释义')
  await ui.key(ui.window.document.body, String(position + 1)); await ui.settle()
  assertOutcome(ui, 1, 1, 0, 2)
  ui = await api.open('overlay')
  assert.match(ui.text(), /答对了/)
  assertOutcome(ui, 1, 1, 0, 2)
  await ui.key(ui.window.document.body, 'Enter'); await ui.settle()
  assert.equal(ui.container.querySelector('.ec-pop-term'), null)
  assertOutcome(ui, 1, 1, 0, 2)
  await ui.key(ui.window.document.body, 'Escape')
  await ui.click(ui.container.querySelector('.ec-pill-btn')); await ui.settle()
  assertOutcome(ui, 1, 1, 0, 2)
  ui = await api.open('overlay')
  assertOutcome(ui, 1, 1, 0, 2)
  assert.equal(api.calls.filter(call => call.command === 'generate.vocab').length, 0)
})

test('完成批次保持到显式继续，下一批跨入口与新VM只显示新批成绩而不累加旧重试', async t => {
  const api = await fixture(t)
  let ui = await api.open()
  for (let i = 0; i < 2; i++) { await choose(ui, '另一释义'); await next(ui) }
  await choose(ui, '正确释义'); await next(ui)
  const previous = (await api.run('study.batch')).data.round.id
  assert.equal((await api.run('review.add', { items: ['alpha', 'beta', 'gamma'].map(term => word(term)) })).ok, true)
  ui = await api.open('words')
  assertOutcome(ui, 1, 1, 0, 2)
  assert.equal(ui.container.querySelector('.ec-deck-term'), null)
  await ui.click('继续学习'); await ui.settle()
  assertOutcome(ui, 0, 3, 0, 0)
  const current = (await api.run('study.batch')).data.round.id
  assert.notEqual(current, previous)
  await choose(ui, '正确释义')
  assertOutcome(ui, 1, 3, 1, 0)
  await ui.click('今日'); await ui.settle()
  assertOutcome(ui, 1, 3, 1, 0)
  ui = await api.open('overlay')
  assertOutcome(ui, 1, 3, 1, 0)
  assert.equal((await api.run('study.batch')).data.round.id, current)
  assert.equal(api.calls.filter(call => call.command === 'generate.vocab').length, 1)
})

test('读取及未保存通信失败不伪造成绩，pending重复点击和已保存快照再传输不累加显示', async t => {
  const api = await fixture(t)
  api.intercept = command => command === 'study.batch' ? { ok: false, message: '本批成绩读取失败' } : null
  const ui = await api.open()
  assert.match(ui.text(), /本批成绩读取失败/)
  assert.doesNotMatch(ui.text(), /已完成 \d+ \/ \d+ 项|首次答对|重试 \d+ 次|这一批学完了/)
  api.intercept = null
  await ui.click('重试'); await ui.settle()
  await choose(ui, '另一释义'); await next(ui)
  api.intercept = command => command === 'review.answer' ? { ok: false, message: '通信失败，作答未保存' } : null
  await choose(ui, '正确释义')
  assert.match(ui.text(), /作答未保存/)
  assertOutcome(ui, 0, 1, 0, 0)
  assert.equal(ui.buttons('完成复习').length, 0)
  assert.deepEqual((await api.run('study.batch')).data.round.summary, { total: 1, completed: 0, firstTryCorrect: 0, retryCount: 0 })
  const response = deferred()
  api.ignored = response.promise
  api.release = () => response.resolve({ ok: false, message: '合成在途请求已释放' })
  api.intercept = command => command === 'review.answer' ? response.promise : null
  const correct = choices(ui).find(node => meaning(node) === '正确释义')
  await ui.flush(() => { correct.click(); correct.click() })
  assert.equal(correct.disabled, true)
  assertOutcome(ui, 0, 1, 0, 0)
  const answer = api.calls.filter(call => call.command === 'review.answer').at(-1).payload
  const committed = await api.run('review.answer', answer)
  assert.equal(committed.ok, true)
  await ui.flush(() => response.resolve(committed)); await ui.settle()
  assertOutcome(ui, 1, 1, 0, 1)
  assert.equal(api.calls.filter(call => call.command === 'review.answer').length, 3, '重复点击不发第二次学习作答')
  api.intercept = command => command === 'study.next' ? { ok: true, data: committed.data.batch } : null
  await next(ui)
  assertOutcome(ui, 1, 1, 0, 1)
  assert.match(ui.text(), /答对了/)
  assert.equal((await api.run('review.list')).data.items[0].answerCount, 2, '快照再传输没有产生新的领域作答')
  api.intercept = null
  await next(ui)
  assertOutcome(ui, 1, 1, 0, 1)
})
