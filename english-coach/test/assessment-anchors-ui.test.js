import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { ANCHOR_POOL, anchorStore } from '../core/anchors.js'
import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { mountClient } from './client-harness.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00.000Z')
const hiddenDetails = /锚题|anchor-|参与定档|有效题数|污染|排除数量|复用数量/

async function fixture(t, remaining) {
  const root = await tempFixture(t, 'coach-anchor-fallback-ui-')
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
  assert.equal((await run('assessment.saveBank', assessmentBank('anchor-ui'))).ok, true)
  await fs.mkdir(join(root, 'anchors'), { recursive: true })
  await fs.writeFile(join(root, 'anchors', 'items.json'), JSON.stringify(anchorStore()))
  const prior = ANCHOR_POOL.slice(0, ANCHOR_POOL.length - remaining).map(item => ({
    anchorId: item.id, attemptId: `synthetic-prior-${item.id}`, at: '2026-11-10T09:00:00.000Z', correct: true, contaminated: false
  }))
  await fs.writeFile(join(root, 'anchors', 'responses.jsonl'), prior.map(item => JSON.stringify(item)).join('\n') + (prior.length ? '\n' : ''))
  const pending = new Set()
  const calls = []
  const ui = await mountClient({ request(command, payload) {
    calls.push({ command, payload })
    const task = run(command, payload)
    pending.add(task)
    void task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  } })
  disposeFixture(t, async () => { await Promise.all([...pending]); await ui.close() })
  ui.settle = async () => {
    do { await ui.flush(() => Promise.all([...pending])) } while (pending.size)
  }
  await ui.settle()
  return { root, run, ui, calls }
}

async function answerVisibleAssessment(ui, kind) {
  await ui.click('个人')
  await ui.click(ui.buttons('开始测评').length ? '开始测评' : '重新测评'); await ui.settle()
  await ui.click(kind === 'short' ? '短测（10 题）' : '开始测评（20 题）'); await ui.settle()
  const total = kind === 'short' ? 10 : 20
  for (let index = 1; index <= total; index++) {
    assert.ok(ui.text().includes(`第 ${index} / ${total} 题`), `visible progress must stay ${index}/${total}`)
    assert.doesNotMatch(ui.text(), hiddenDetails)
    assert.equal(ui.container.querySelectorAll('.ec-choice').length, 4)
    await ui.click('不会，继续'); await ui.settle()
  }
  assert.match(ui.text(), /你的档位/)
  assert.doesNotMatch(ui.text(), hiddenDetails)
  assert.doesNotMatch(ui.text(), /正确答案|答对了|答错了|逐题/)
  assert.equal(ui.container.querySelectorAll('.ec-choice').length, 0)
}

test('real Client completes 0/1/2/3-anchor full and short paths with ordinary progress and no internal anchor details', async t => {
  for (const remaining of [0, 1, 2, 3]) {
    for (const kind of ['full', 'short']) {
      const { ui, calls, run } = await fixture(t, remaining)
      await answerVisibleAssessment(ui, kind)
      const answers = calls.filter(call => call.command === 'assessment.answer')
      assert.equal(answers.length, kind === 'short' ? 10 : 20)
      assert.equal(new Set(answers.map(call => call.payload.itemId)).size, answers.length)
      assert.equal(answers.filter(call => call.payload.itemId.startsWith('anchor-')).length, remaining)
      await ui.click('知道了'); await ui.settle()
      assert.equal((await run('assessment.resume')).data, null)
      await ui.close()
    }
  }
})

test('real Client learning records do not present the old drift note after a no-anchor assessment', async t => {
  const { root, run, ui } = await fixture(t, 0)
  const note = 'Synthetic previous drift observation; not current.'
  const drift = { baseline: 1, streak: 3, note }
  await fs.writeFile(join(root, 'level.json'), JSON.stringify({ version: 1, points: [{
    id: 'synthetic-prior-level', at: '2026-11-10T09:00:00.000Z', band: '中级', estimate: 3, anchorAccuracy: 0
  }], drift }))
  await answerVisibleAssessment(ui, 'short')
  await ui.click('知道了'); await ui.settle()
  await ui.click('个人'); await ui.settle()
  await ui.click('查看记录'); await ui.settle()
  assert.doesNotMatch(ui.text(), /Synthetic previous drift observation|锚题|持续校准/)
  assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'level.json'), 'utf8')).drift, drift)
  assert.equal((await run('progress.get')).data.drift.note, null)
})
