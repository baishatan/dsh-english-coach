import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { mountClient } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T01:00:00.000Z')

async function openAssessment(t) {
  const root = await tempFixture(t, 'english-coach-bank-ui-')
  const run = (command, payload) => execute(root, command, payload, { now })
  assert.equal((await run('profile.save', { goal: 'study', minutesPerDay: 20 })).ok, true)
  const requests = [], pending = new Set()
  const drain = async () => { while (pending.size) await Promise.all([...pending]) }
  let ui
  disposeFixture(t, async () => { await ui?.close(); await drain() })
  // Generation and job status are external Host services. All learner-domain
  // commands and bank submissions use the production execute interface.
  ui = await mountClient({ request: (command, payload) => {
    requests.push({ command, payload })
    const result = Promise.resolve().then(() => {
      if (command === 'generate.assessment') return { ok: true, data: { id: 'synthetic-job', kind: 'assessment', status: 'pending' } }
      if (command === 'job.status') return { ok: true, data: { id: 'synthetic-job', status: 'done' } }
      return run(command, payload)
    })
    pending.add(result)
    result.then(() => pending.delete(result), () => pending.delete(result))
    return result
  } })
  const settle = () => ui.flush(drain)
  await settle()
  await ui.click('个人')
  await ui.click(ui.buttons('开始测评').length ? '开始测评' : '重新测评')
  await settle()
  return { root, run, ui, requests, settle }
}

for (const [label, total] of [['开始测评（20 题）', 20], ['短测（10 题）', 10]]) {
  test(`合格提交后从可见${total}题入口显示独立短题`, async t => {
    const { ui, run, requests, settle } = await openAssessment(t)
    const payload = assessmentBank()
    assert.equal((await run('assessment.saveBank', payload)).ok, true)
    await ui.click(label)
    await settle()
    assert.match(ui.text(), new RegExp(`第 1 / ${total} 题`))
    assert.match(ui.text(), /If it rains, we ___ indoors\./)
    assert.equal(ui.container.querySelectorAll('.ec-choice').length, 4)
    for (const option of ['stayed', 'will stay', 'staying', 'had stayed']) assert.ok(ui.text().includes(option))
    assert.equal(requests.filter(row => row.command === 'generate.assessment').length, 0)
  })
}

test('不合格旧库开测反馈可见且只有主动准备后才可开始', async t => {
  const { root, ui, run, requests, settle } = await openAssessment(t)
  const invalid = assessmentBank('old-bank')
  invalid.items[0].passage = 'An old article.'
  const refused = await run('assessment.saveBank', invalid)
  assert.equal(refused.ok, false)
  await fs.mkdir(join(root, 'assessments'), { recursive: true })
  await fs.writeFile(join(root, 'assessments', 'bank-old-bank.json'), JSON.stringify(invalid))
  await ui.click('开始测评（20 题）')
  await settle()
  assert.match(ui.text(), /重新准备题库.*passage/)
  assert.doesNotMatch(ui.text(), /第 1 \/ 20 题/)
  assert.equal((await run('assessment.resume')).data, null)
  assert.equal(requests.filter(row => row.command === 'generate.assessment').length, 0)

  await ui.click('生成测评题库')
  await settle()
  assert.match(ui.text(), /正在出题/)
  assert.equal(requests.filter(row => row.command === 'generate.assessment').length, 1)
  assert.equal((await run('assessment.saveBank', assessmentBank('a-prepared'))).ok, true)
  await ui.poll()
  await settle()
  assert.match(ui.text(), /题库已就绪/)
  assert.doesNotMatch(ui.text(), /第 1 \/ 20 题/)
  await ui.click('开始测评（20 题）')
  await settle()
  assert.match(ui.text(), /第 1 \/ 20 题/)
  assert.match(ui.text(), /If it rains, we ___ indoors\./)
})

test('无题库时可见提示说明24道短题并只在主动点击时准备题库', async t => {
  const { ui, requests, settle } = await openAssessment(t)
  await ui.click('短测（10 题）')
  await settle()
  assert.match(ui.text(), /还没有题库/)
  assert.match(ui.text(), /24.*独立.*词汇.*语法.*短题/)
  assert.match(ui.text(), /生成测评题库/)
  assert.equal(requests.filter(row => row.command === 'generate.assessment').length, 0)
  assert.equal(ui.buttons('生成测评题库').length, 1)
})
