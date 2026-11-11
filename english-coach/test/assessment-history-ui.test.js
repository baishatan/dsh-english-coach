import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { mountClient } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00Z')
async function fixture(t, status = 'in_progress', prepare = async () => {}) {
  const root = await tempFixture(t, 'coach-history-ui-')
  await fs.mkdir(join(root, 'assessments'), { recursive: true })
  const id = '2026-11-01-short-old'
  const original = { id, kind: 'short', items: 10, length: 10, createdAt: '2026-11-01T09:00:00Z', status, order: [], answers: [], anchorIds: [] }
  await fs.writeFile(join(root, 'assessments', `${id}.json`), JSON.stringify(original))
  await prepare(root, original)
  const calls = []
  const pending = new Set()
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 20 })).ok, true)
  assert.equal((await run('assessment.saveBank', assessmentBank('history-ui'))).ok, true)
  const ui = await mountClient({ request(command, payload) {
    calls.push({ command, payload })
    const task = run(command, payload)
    pending.add(task)
    void task.finally(() => pending.delete(task))
    return task
  } })
  const settle = async () => { do { await ui.flush(() => Promise.all([...pending])) } while (pending.size) }
  disposeFixture(t, async () => { await Promise.all([...pending]); await ui.close() })
  await settle()
  return { root, run, ui, calls, settle }
}

test('the real Client explains that the previous incomplete round ended and waits for an explicit new start', async t => {
  const { ui, calls, settle } = await fixture(t)
  await ui.click('测评'); await settle()
  assert.match(ui.text(), /上次未完成.*已结束.*开始新.*测评/)
  assert.equal(ui.container.querySelectorAll('.ec-choice').length, 0)
  assert.equal(calls.some(call => call.command === 'assessment.start'), false)
  assert.doesNotMatch(ui.text(), /不兼容|兼容|重算|旧评分/)
  await ui.click('短测（10 题）'); await settle()
  assert.equal(calls.filter(call => call.command === 'assessment.start').length, 1)
  assert.match(ui.text(), /第 1 \/ 10 题/)
  assert.equal(ui.container.querySelectorAll('.ec-choice').length, 4)
})

test('the real Client shows normal unassessed current together with an earlier valid history curve without compatibility UI', async t => {
  const { ui, run, settle } = await fixture(t, 'done', async (root, source) => {
    const good = { ...source, order: Array.from({ length: 10 }, (_, i) => `old-${i}`), result: { id: 'old-point-1', at: '2026-11-02T09:00:00Z', kind: 'short', band: '精通', estimate: 6 } }
    good.answers = good.order.map((itemId, i) => ({ itemId, correct: i < 5, difficulty: [1, 1, 2, 2, 3, 3, 4, 4, 5, 6][i], anchor: false, choice: i < 5 ? 1 : 0, skill: i % 2 ? 'grammar' : 'vocab', at: good.result.at }))
    const bad = structuredClone(good)
    bad.id = '2026-11-03-short-old'
    bad.result.id = 'old-point-2'
    bad.result.at = '2026-11-04T09:00:00Z'
    delete bad.answers[0].difficulty
    for (const attempt of [good, bad]) await fs.writeFile(join(root, 'assessments', `${attempt.id}.json`), JSON.stringify(attempt))
    await fs.writeFile(join(root, 'level.json'), JSON.stringify({ version: 1, points: [good.result, bad.result] }))
  })
  assert.equal((await run('state.get')).data.level.latest, null)
  await ui.click('个人'); await settle()
  assert.match(ui.text(), /未测评/)
  await ui.click('查看记录'); await settle()
  assert.match(ui.text(), /中级/)
  assert.doesNotMatch(ui.text(), /不兼容|兼容|重算|旧评分|rawEstimate|scoringRule/)
  assert.equal((await run('progress.get')).data.curve.length, 1)
})
