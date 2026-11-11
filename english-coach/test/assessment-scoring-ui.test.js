import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { ANCHOR_POOL } from '../core/anchors.js'
import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { mountClient } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00.000Z')
const forbidden = /置信|四级|六级|长文|听力能力|口语能力|锚题|anchor-|有效题数|参与定档|排除理由|rawEstimate|scoringRule|theta/
async function fixture(t) {
  const root = await tempFixture(t, 'coach-scoring-ui-')
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  const bank = assessmentBank('scoring-ui')
  assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  assert.equal((await run('assessment.saveBank', bank)).ok, true)
  const pending = new Set()
  const api = { root, run, bank, ui: null, intercept: null }
  api.open = async () => {
    if (api.ui) await api.ui.close()
    const ui = await mountClient({ request(command, payload) {
      const task = Promise.resolve(api.intercept?.(command, payload) ?? run(command, payload))
      pending.add(task)
      void task.then(() => pending.delete(task), () => pending.delete(task))
      return task
    } })
    api.ui = ui
    ui.settle = async () => { do { await ui.flush(() => Promise.all([...pending])) } while (pending.size) }
    await ui.settle()
    return ui
  }
  disposeFixture(t, async () => { await Promise.all([...pending]); await api.ui?.close() })
  return api
}

test('real Client summarizes correct, incorrect and unable responses with inclusive accuracy and vocabulary-grammar scope', async t => {
  const api = await fixture(t)
  const ui = await api.open()
  const keys = new Map([...api.bank.items, ...ANCHOR_POOL].map(item => [item.id, item.answerIndex]))
  await ui.click('测评'); await ui.settle()
  await ui.click('短测（10 题）'); await ui.settle()
  for (let index = 0; index < 10; index++) {
    if (index < 5) {
      const question = (await api.run('assessment.resume')).data.question
      const key = keys.get(question.id)
      await ui.click([...ui.container.querySelectorAll('.ec-choice')][index < 2 ? key : (key + 1) % 4])
    } else await ui.click('不会，继续')
    await ui.settle()
  }
  assert.match(ui.text(), /你的档位.*入门/)
  assert.match(ui.text(), /正确\s*2.*错误\s*3.*不会\s*5/)
  assert.match(ui.text(), /本轮答对率\s*20%/)
  assert.match(ui.text(), /根据词汇与语法短题估计，仅供安排学习/)
  assert.match(ui.text(), /语法|词汇/)
  assert.doesNotMatch(ui.text(), /grammar|vocab|答对了|答错了|正确答案|逐题/)
  assert.doesNotMatch(ui.text(), forbidden)
  await ui.click('知道了'); await ui.settle()
  await ui.click('个人'); await ui.settle()
  await ui.click('查看记录'); await ui.settle()
  assert.match(ui.container.querySelector('[aria-label="学习记录详情"]').textContent, /根据词汇与语法短题估计，仅供安排学习/)
  assert.doesNotMatch(ui.container.querySelector('[aria-label="学习记录详情"]').textContent, forbidden)
})

test('real Client presents a coverage-limited result as a usable band without exposing its internal cap', async t => {
  const api = await fixture(t)
  const started = await api.run('assessment.start', { kind: 'short' })
  const target = join(api.root, 'assessments', `${started.data.attemptId}.json`)
  const attempt = JSON.parse(await fs.readFile(target, 'utf8'))
  attempt.anchors = []; attempt.anchorIds = []
  attempt.answers = Array.from({ length: 10 }, (_, index) => ({
    itemId: `coverage-${index}`, responseId: JSON.stringify([attempt.id, `coverage-${index}`]),
    responseType: 'choice', choice: 1, correct: true, difficulty: 1,
    skill: index % 2 ? 'grammar' : 'vocab', anchor: false, at: now.toISOString()
  }))
  attempt.order = attempt.answers.map(answer => answer.itemId); attempt.current = null
  await fs.writeFile(target, JSON.stringify(attempt))
  const finished = await api.run('assessment.finish', { attemptId: attempt.id })
  assert.equal(finished.ok, true)
  const ui = await api.open()
  await ui.click('测评'); await ui.settle()
  assert.match(ui.text(), /你的档位.*入门/)
  assert.match(ui.text(), /覆盖较窄/)
  assert.match(ui.text(), /本轮答对率\s*100%/)
  assert.doesNotMatch(ui.text(), /不能定档|必须复测|raw|coverageCap|3\.94/)
  assert.doesNotMatch(ui.text(), forbidden)
  await ui.click('知道了'); await ui.settle()
  await ui.click('个人'); await ui.settle()
  assert.match(ui.container.querySelector('[aria-label="当前与目标"]').textContent, /当前水平估计.*入门/)
})

test('real Client never turns non-vocabulary or grammar diagnostics into measured weak abilities', async t => {
  const api = await fixture(t)
  const actualState = (await api.run('state.get')).data
  api.intercept = command => command === 'state.get' ? { ok: true, data: { ...actualState, level: { latest: {
    band: '中级', finalBandIndex: 3, weaknesses: [{ skill: 'listening', missed: 9 }, { skill: 'reading', missed: 8 }, { skill: 'grammar', missed: 2 }]
  } } } } : null
  const ui = await api.open()
  await ui.click('个人'); await ui.settle()
  const suggestion = ui.container.querySelector('[aria-label="下一步建议"]')
  assert.match(suggestion.textContent, /语法/)
  assert.doesNotMatch(suggestion.textContent, /阅读|听力/)
  await ui.click('查看记录'); await ui.settle()
  const directions = ui.container.querySelector('.ec-profile-weaknesses')
  assert.match(directions.textContent, /语法/)
  assert.doesNotMatch(directions.textContent, /阅读|听力|listening|reading/)
})

test('real Client curve draws and compares capped bands even if an external Host includes inconsistent diagnostic decimals', async t => {
  const api = await fixture(t)
  const history = [
    { at: '2026-11-10T09:00:00Z', band: '初级', finalBandIndex: 2, estimate: 2.08 },
    { at: '2026-11-11T09:00:00Z', band: '初级', finalBandIndex: 2, estimate: 5.5 }
  ]
  api.intercept = command => command === 'progress.get' ? { ok: true, data: {
    completions: [], streak: { current: 0, best: 0 }, mastered: 0, learning: 0, curve: history, drift: { note: null }
  } } : null
  const ui = await api.open()
  await ui.click('个人'); await ui.settle()
  await ui.click('查看记录'); await ui.settle()
  const records = ui.container.querySelector('[aria-label="测评记录"]')
  assert.match(records.textContent, /与上次持平/)
  assert.doesNotMatch(records.textContent, /上升|下降/)
  const points = [...ui.container.querySelectorAll('svg[role="img"] circle')]
  assert.equal(points.length, 2)
  assert.equal(points[0].getAttribute('cy'), points[1].getAttribute('cy'))
  assert.doesNotMatch(ui.text(), /2\.08|5\.5/)
})
