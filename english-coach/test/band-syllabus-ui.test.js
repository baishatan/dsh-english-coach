import assert from 'node:assert/strict'
import test from 'node:test'
import { execute } from '../core/index.js'
import { ANCHOR_POOL } from '../core/anchors.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { mountClient, deferred } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00Z')
async function fixture(t) {
  const root = await tempFixture(t, 'coach-band-syllabus-ui-')
  const api = { calls: [], intercept: null }
  const pending = new Set()
  api.run = (command, payload = {}) => execute(root, command, payload, { now })
  assert.equal((await api.run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  assert.equal((await api.run('syllabus.generate')).ok, true)
  api.ui = await mountClient({ request(command, payload) {
    api.calls.push({ command, payload })
    const task = Promise.resolve(api.intercept?.(command, payload) ?? api.run(command, payload))
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  } })
  api.reopen = async () => {
    await api.ui.close()
    api.ui = await mountClient({ request(command, payload) {
      const task = api.run(command, payload)
      pending.add(task)
      void task.then(() => pending.delete(task), () => pending.delete(task))
      return task
    } })
    await api.settle()
    await api.ui.click('计划'); await api.settle()
  }
  api.settle = async () => {
    const tasks = () => [...pending].filter(task => task !== api.ignored)
    do { await api.ui.flush(() => Promise.all(tasks())) } while (tasks().length)
  }
  disposeFixture(t, async () => { api.release?.(); await Promise.all([...pending]); await api.ui.close() })
  await api.settle()
  await api.ui.click('计划'); await api.settle()
  return api
}
const checks = ui => [...ui.container.querySelectorAll('input[type="checkbox"]')]

test('weekly goals reject an old page click after regeneration and tell the learner to use the refreshed goals', async t => {
  const api = await fixture(t)
  const ui = api.ui
  const gate = deferred()
  api.ignored = gate.promise
  api.release = () => gate.resolve({ ok: false, message: 'fixture closing' })
  api.intercept = (command) => command === 'syllabus.toggleGoal' ? gate.promise : null
  await ui.click(checks(ui)[0]); await api.settle()
  const stale = api.calls.find(call => call.command === 'syllabus.toggleGoal').payload
  const regenerated = await api.run('syllabus.generate')
  assert.equal(regenerated.ok, true)
  api.intercept = null
  const rejected = await api.run('syllabus.toggleGoal', stale)
  assert.equal(rejected.ok, false, 'the external Host must reject the old goal identity')
  await ui.flush(() => gate.resolve(rejected)); await api.settle()
  assert.equal(checks(ui).length, 3)
  assert.equal(checks(ui).every(input => input.checked === false), true)
  assert.match(ui.text(), /目标已变化|目标已更新|旧目标/)
  assert.doesNotMatch(ui.text(), /已保存/)
  await ui.click(checks(ui)[0]); await api.settle()
  assert.equal((await api.run('state.get')).data.syllabus.weekly.completedGoals, 1, 'the refreshed goal remains usable')
})

test('visible route regeneration explains new unchecked goals without implying lost study facts', async t => {
  const api = await fixture(t)
  const ui = api.ui
  await ui.click(checks(ui)[0]); await api.settle()
  assert.equal(checks(ui)[0].checked, true)
  assert.match(ui.text(), /本周目标.*重新开始/)
  assert.match(ui.text(), /实际学习记录.*保留/)
  assert.doesNotMatch(ui.text(), /本周已勾选的目标会保留/)
  await ui.click('重写大纲'); await api.settle()
  assert.equal(checks(ui).every(input => input.checked === false), true)
  assert.match(ui.text(), /0 \/ 3/)
})

test('real Client first, same-band, upward and downward reassessments keep route checks only for the same band', async t => {
  const api = await fixture(t)
  const bank = assessmentBank('route-ui')
  await api.run('assessment.saveBank', bank)
  const keys = new Map([...bank.items, ...ANCHOR_POOL].map(item => [item.id, item.answerIndex]))
  const assess = async correct => {
    const ui = api.ui
    await ui.click('测评'); await api.settle()
    await ui.click('短测（10 题）'); await api.settle()
    for (let index = 0; index < 10; index++) {
      const current = (await api.run('assessment.resume')).data
      if (correct) await ui.click([...ui.container.querySelectorAll('.ec-choice')][keys.get(current.question.id)])
      else await ui.click('不会，继续')
      await api.settle()
    }
    assert.match(ui.text(), /你的档位/)
    await ui.click('知道了'); await api.settle()
    await ui.click('计划'); await api.settle()
    return (await api.run('state.get')).data
  }
  await api.ui.click(checks(api.ui)[0]); await api.settle()
  const first = await assess(false)
  assert.equal(first.level.latest.finalBandIndex, 1)
  assert.equal(checks(api.ui).every(input => !input.checked), true, 'first valid introductory resets the unassessed goals')
  assert.match(api.ui.text(), /巩固「入门」/)
  await api.ui.click(checks(api.ui)[0]); await api.settle()
  const same = await assess(false)
  assert.equal(same.syllabus.weekly.goals[0].id, first.syllabus.weekly.goals[0].id)
  assert.equal(checks(api.ui)[0].checked, true)
  const raised = await assess(true)
  assert.ok(raised.level.latest.finalBandIndex > 1)
  assert.equal(raised.syllabus.currentPhase.targetBand, raised.level.latest.band)
  assert.equal(checks(api.ui).every(input => !input.checked), true)
  await api.ui.click(checks(api.ui)[0]); await api.settle()
  await api.reopen()
  assert.equal(checks(api.ui)[0].checked, true, 'fresh Client reading the same Host does not rebuild')
  const lowered = await assess(false)
  assert.equal(lowered.syllabus.currentPhase.targetBand, '入门')
  assert.equal(checks(api.ui).every(input => !input.checked), true)
  assert.notEqual(lowered.syllabus.weekly.goals[0].id, raised.syllabus.weekly.goals[0].id)
})
