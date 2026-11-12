import assert from 'node:assert/strict'
import test from 'node:test'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00Z')
const choices = ui => [...ui.container.querySelectorAll('.ec-choice')]
async function fixture(t) {
  const root = await tempFixture(t, 'coach-assessment-ui-')
  const api = { calls: [], intercept: null, ui: null }
  const pending = new Set()
  api.run = (command, payload = {}) => execute(root, command, payload, { now })
  assert.equal((await api.run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  assert.equal((await api.run('assessment.saveBank', { version: 'ui', items: Array.from({ length: 24 }, (_, index) => ({
    id: `ui-q-${index + 1}`, difficulty: index % 6 + 1, skill: index % 2 ? 'grammar' : 'vocab',
    prompt: `Choose the suitable word for task ${index + 1}.`, choices: ['alpha', 'beta', 'gamma', 'delta'],
    answerIndex: 1, explanation: 'This explanation must not reach the assessment UI.'
  })) })).ok, true)
  api.open = async () => {
    if (api.ui) await api.ui.close()
    const ui = await mountClient({ request(command, payload) {
      api.calls.push({ command, payload })
      const task = Promise.resolve(api.intercept?.(command, payload) ?? api.run(command, payload))
      pending.add(task)
      void task.then(() => pending.delete(task), () => pending.delete(task))
      return task
    } })
    api.ui = ui
    ui.settle = async () => {
      const remaining = () => [...pending].filter(task => task !== api.ignored)
      do { await ui.flush(() => Promise.all(remaining())) } while (remaining().length)
    }
    await ui.settle()
    await ui.click('个人')
    await ui.click(ui.buttons('开始测评').length ? '开始测评' : '重新测评'); await ui.settle()
    return ui
  }
  api.commits = []
  disposeFixture(t, async () => { api.release?.(); await Promise.all([...pending, ...api.commits]); if (api.ui) await api.ui.close() })
  return api
}

test('assessment offers a distinct unable action and advances only after its saved acknowledgement without teaching an answer', async t => {
  const api = await fixture(t)
  const ui = await api.open()
  await ui.click('短测（10 题）'); await ui.settle()
  assert.equal(choices(ui).length, 4)
  const first = (await api.run('assessment.resume')).data
  await ui.click('不会，继续'); await ui.settle()
  const submission = api.calls.find(call => call.command === 'assessment.answer')
  assert.deepEqual(submission.payload, { attemptId: first.attemptId, itemId: first.question.id, responseType: 'unable' })
  assert.match(ui.text(), /第 2 \/ 10 题/)
  assert.doesNotMatch(ui.text(), /答对了|答错了|This explanation|正确答案/)
  assert.equal(choices(ui).some(node => node.getAttribute('data-state')), false)
  await ui.click(choices(ui)[0]); await ui.settle()
  assert.match(ui.text(), /第 3 \/ 10 题/)
  assert.equal(api.calls.filter(call => call.command === 'assessment.answer').at(-1).payload.responseType, 'choice')
  assert.doesNotMatch(ui.text(), /答对了|答错了|This explanation/)
})

test('busy assessment blocks duplicate clicks and keeps the original response available for safe retry after a lost acknowledgement', async t => {
  const api = await fixture(t)
  const ui = await api.open()
  await ui.click('短测（10 题）'); await ui.settle()
  const gate = deferred()
  api.ignored = gate.promise
  const commits = api.commits
  api.release = () => gate.resolve({ ok: false, message: 'fixture closing' })
  api.intercept = (command, payload) => {
    if (command !== 'assessment.answer') return null
    const committed = api.run(command, payload)
    commits.push(committed)
    return gate.promise
  }
  const button = choices(ui)[0]
  await ui.flush(() => { button.click(); button.click() })
  assert.equal(api.calls.filter(call => call.command === 'assessment.answer').length, 1)
  assert.equal(choices(ui).every(node => node.disabled), true)
  assert.equal(ui.button('不会，继续').disabled, true)
  assert.match(ui.text(), /第 1 \/ 10 题/)
  await Promise.all(commits)
  await ui.flush(() => gate.resolve({ ok: false, message: '确认丢失，请重试' })); await ui.settle()
  assert.match(ui.text(), /确认丢失，请重试/)
  assert.match(ui.text(), /第 1 \/ 10 题/)
  api.intercept = null
  assert.equal(choices(ui).every(node => node.disabled), true, 'ambiguous submissions retain the original response for retry')
  await ui.click('重试'); await ui.settle()
  assert.match(ui.text(), /第 2 \/ 10 题/)
  const submissions = api.calls.filter(call => call.command === 'assessment.answer')
  assert.equal(submissions.length, 2)
  assert.deepEqual(submissions[1].payload, submissions[0].payload, 'after an ambiguous failure retry the same response, not a newly picked answer')
  assert.equal((await api.run('assessment.resume')).data.progress, 1)
  assert.doesNotMatch(ui.text(), /答对了|答错了|This explanation|确认丢失/)
})

test('continue-later pauses without finishing or abandoning and a fresh Client resumes the same unanswered item', async t => {
  const api = await fixture(t)
  let ui = await api.open()
  await ui.click('开始测评（20 题）'); await ui.settle()
  await ui.click('不会，继续'); await ui.settle()
  const saved = (await api.run('assessment.resume')).data
  assert.match(ui.text(), /第 2 \/ 20 题/)
  await ui.click('稍后继续'); await ui.settle()
  assert.equal(ui.buttons('不会，继续').length, 0)
  ui = await api.open()
  assert.match(ui.text(), /第 2 \/ 20 题/)
  assert.ok(ui.text().includes(saved.question.prompt))
  assert.deepEqual((await api.run('assessment.resume')).data, saved)
  assert.equal(api.calls.some(call => ['assessment.abandon', 'assessment.finish'].includes(call.command)), false)
  assert.equal((await api.run('state.get')).data.level.points.length, 0)
})

test('last-answer acknowledgement loss resumes a completed summary and dismiss failure retains it until an explicit retry succeeds', async t => {
  const api = await fixture(t)
  let ui = await api.open()
  await ui.click('短测（10 题）'); await ui.settle()
  for (let index = 0; index < 9; index++) { await ui.click('不会，继续'); await ui.settle() }
  api.intercept = async (command, payload) => {
    if (command !== 'assessment.answer') return api.run(command, payload)
    const saved = await api.run(command, payload)
    assert.equal(saved.data.done, true)
    return { ok: false, message: '最后确认丢失，请重试或稍后继续' }
  }
  await ui.click('不会，继续'); await ui.settle()
  assert.match(ui.text(), /第 10 \/ 10 题/)
  assert.match(ui.text(), /最后确认丢失/)
  api.intercept = null
  ui = await api.open()
  assert.match(ui.text(), /你的档位/)
  assert.equal(choices(ui).length, 0)
  assert.doesNotMatch(ui.text(), /This explanation|正确答案|逐题|答对了|答错了/)
  api.intercept = (command, payload) => command === 'assessment.acknowledge' ? { ok: false, message: '确认未保存，请重试' } : null
  await ui.click('知道了'); await ui.settle()
  assert.match(ui.text(), /确认未保存，请重试/)
  assert.match(ui.text(), /你的档位/)
  api.intercept = null
  await ui.click('知道了'); await ui.settle()
  assert.equal((await api.run('assessment.resume')).data, null)
  ui = await api.open()
  assert.equal(ui.buttons('短测（10 题）').length, 1)
  assert.equal((await api.run('state.get')).data.level.points.length, 1)
})

test('a delayed or failed resume cannot start a replacement session and offers a visible recovery retry', async t => {
  const api = await fixture(t)
  const gate = deferred()
  api.ignored = gate.promise
  api.release = () => gate.resolve({ ok: false, message: 'fixture closing' })
  api.intercept = command => command === 'assessment.resume' ? gate.promise : null
  const ui = await api.open()
  assert.equal(ui.buttons('短测（10 题）').some(button => !button.disabled), false)
  assert.match(ui.text(), /恢复测评/)
  await ui.flush(() => gate.resolve({ ok: false, message: '恢复失败，请重试' })); await ui.settle()
  assert.match(ui.text(), /恢复失败，请重试/)
  assert.equal(ui.buttons('短测（10 题）').some(button => !button.disabled), false)
  api.intercept = null
  await ui.click('重试'); await ui.settle()
  await ui.click('短测（10 题）'); await ui.settle()
  assert.match(ui.text(), /第 1 \/ 10 题/)
})

test('a stale Client response conflict preserves the first fact and can restore saved progress without choosing for the next item', async t => {
  const api = await fixture(t)
  const ui = await api.open()
  await ui.click('短测（10 题）'); await ui.settle()
  const current = (await api.run('assessment.resume')).data
  const saved = await api.run('assessment.answer', { attemptId: current.attemptId, itemId: current.question.id, responseType: 'unable' })
  assert.equal(saved.ok, true)
  await ui.click(choices(ui)[0]); await ui.settle()
  assert.match(ui.text(), /不同响应/)
  assert.match(ui.text(), /第 1 \/ 10 题/)
  await ui.click('恢复已保存进度'); await ui.settle()
  assert.match(ui.text(), /第 2 \/ 10 题/)
  assert.ok(ui.text().includes(saved.data.question.prompt))
  assert.equal(api.calls.filter(call => call.command === 'assessment.answer').length, 1)
  assert.equal((await api.run('assessment.resume')).data.progress, 1)
})
