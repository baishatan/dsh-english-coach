import assert from 'node:assert/strict'
import test from 'node:test'
import { execute } from '../core/index.js'
import { mountClient } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00Z')
async function fixture(t, intercept = null) {
  const root = await tempFixture(t, 'coach-learning-start-ui-')
  const api = { calls: [], intercept, ui: null }
  const pending = new Set()
  api.run = (command, payload = {}) => execute(root, command, payload, { now })
  assert.equal((await api.run('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '精通' })).ok, true)
  api.ui = await mountClient({ request(command, payload) {
    api.calls.push({ command, payload })
    const task = Promise.resolve().then(() => api.intercept?.(command, payload)
      ?? (command === 'job.status' ? { ok: true, data: null } : api.run(command, payload)))
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  } })
  api.ui.settle = async () => {
    do { await api.ui.flush(() => Promise.all([...pending])) } while (pending.size)
  }
  disposeFixture(t, async () => { await Promise.all([...pending]); await api.ui.close() })
  await api.ui.settle()
  return api
}

test('unassessed visible lesson and profile-word entries remain usable and describe an introductory starting point', async t => {
  const api = await fixture(t)
  const ui = api.ui
  assert.match(ui.text(), /未测评.*入门材料.*学习/)
  assert.equal(ui.button('生成今天').disabled, false)
  assert.equal(ui.button('继续学习').disabled, false)
  assert.equal(api.calls.some(call => ['generate', 'generate.vocab', 'assessment.start'].includes(call.command)), false)
  api.intercept = command => command === 'generate' || command === 'generate.vocab'
    ? { ok: false, message: '生成服务暂不可用，请稍后重试。' } : null
  await ui.click('生成今天'); await ui.settle()
  assert.match(ui.text(), /生成服务暂不可用/)
  await ui.click('继续学习'); await ui.settle()
  assert.equal(api.calls.filter(call => call.command === 'generate.vocab').length, 1)
  assert.equal(api.calls.find(call => call.command === 'generate.vocab').payload.continue, true)
  assert.doesNotMatch(ui.text(), /必须.*测评|先完成测评才能|已修复/)
  assert.equal(api.calls.some(call => call.command === 'assessment.start'), false)
  const state = (await api.run('state.get')).data
  assert.equal(state.level.latest, null)
  assert.equal(state.level.points.length, 0)
})

test('unavailable initial lesson task state has an explicit retry that restores the saved task', async t => {
  let response = { ok: false, message: '初次读取任务失败' }
  const api = await fixture(t, command => command === 'job.status' ? response : null)
  const ui = api.ui
  assert.match(ui.text(), /读取.*生成状态失败.*初次读取任务失败/)
  assert.equal(ui.button('重试生成状态').disabled, false)
  response = { ok: true, data: { id: 'saved-task', date: '2026-11-11', status: 'pending' } }
  await ui.click('重试生成状态'); await ui.settle()
  assert.match(ui.text(), /正在找素材/)
  assert.doesNotMatch(ui.text(), /初次读取任务失败/)
  assert.equal(api.calls.some(call => call.command === 'generate'), false)
})

test('lesson generation status read failure stays visible and retryable without starting a second task', async t => {
  const api = await fixture(t)
  const ui = api.ui
  let status = { ok: false, message: '调度状态暂不可用' }
  api.intercept = command => command === 'generate'
    ? { ok: true, data: { id: 'lesson-job', date: '2026-11-11', kind: 'lesson', status: 'pending' } }
    : command === 'job.status' ? status : null
  await ui.click('生成今天'); await ui.settle()
  await ui.poll(); await ui.settle()
  assert.match(ui.text(), /读取.*生成状态失败.*调度状态暂不可用/)
  assert.match(ui.text(), /正在找素材/)
  assert.equal(api.calls.filter(call => call.command === 'generate').length, 1)
  assert.doesNotMatch(ui.text(), /必须.*测评|已修复/)
  status = { ok: true, data: { id: 'lesson-job', status: 'failed', failure: '合成模型调用失败，请重试。' } }
  await ui.poll(); await ui.settle()
  assert.match(ui.text(), /合成模型调用失败/)
  assert.doesNotMatch(ui.text(), /调度状态暂不可用/)
  assert.equal(ui.button('生成今天').disabled, false)
})

test('profile vocabulary status errors are visible while polling can recover the same pending request', async t => {
  const api = await fixture(t)
  const ui = api.ui
  let status = { ok: false, message: '画像词汇任务状态暂不可读' }
  api.intercept = command => command === 'generate.vocab'
    ? { ok: true, data: { id: 'vocab-job', kind: 'vocab', mode: 'generated', status: 'pending' } }
    : command === 'job.status' ? status : null
  await ui.click('继续学习'); await ui.settle()
  await ui.poll(); await ui.settle()
  assert.match(ui.text(), /读取.*生成状态失败.*画像词汇任务状态暂不可读/)
  assert.equal(api.calls.filter(call => call.command === 'generate.vocab').length, 1)
  assert.doesNotMatch(ui.text(), /必须.*测评|已修复/)
  status = { ok: true, data: { id: 'vocab-job', status: 'failed', failure: '合成补词失败，请重试。' } }
  await ui.poll(); await ui.settle()
  assert.match(ui.text(), /合成补词失败/)
  assert.doesNotMatch(ui.text(), /画像词汇任务状态暂不可读/)
  assert.equal(ui.button('继续学习').disabled, false)
})
