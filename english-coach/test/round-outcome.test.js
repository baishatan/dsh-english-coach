import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'

const identity = batch => ({ roundId: batch.round.id, revision: batch.round.revision, presentationId: batch.round.current?.id })

test('超过最近二十条作答仍保留完整本批首次表现和重试，公开重读跨日不重计其他学习统计', async t => {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-round-outcome-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), temporary)
    assert.ok(root.split('/').at(-1).startsWith('coach-round-outcome-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const now = new Date(2026, 9, 29, 23, 50)
  const run = (command, payload = {}, date = now) => execute(root, command, payload, { now: date })
  assert.equal((await run('review.add', { items: [{ term: 'in fact', kind: 'expression', meaning: '事实上', choices: ['也许', '事实上', '从不', '立刻'], answerIndex: 1 }] })).ok, true)
  const progress = (await run('progress.get')).data
  let batch = (await run('study.batch')).data
  const roundId = batch.round.id
  for (let i = 0; i < 22; i++) {
    const wrong = await run('review.answer', { ...identity(batch), itemId: batch.round.current.itemId, choice: 0 })
    assert.equal(wrong.ok, true)
    batch = (await run('study.next', identity(wrong.data.batch))).data
  }
  const later = new Date(2026, 9, 30, 8)
  const correct = await run('review.answer', { ...identity(batch), itemId: batch.round.current.itemId, choice: 1 }, later)
  assert.equal(correct.ok, true)
  assert.deepEqual(correct.data.batch.round.summary, { total: 1, completed: 1, firstTryCorrect: 0, retryCount: 22 })
  const finished = await run('study.next', identity(correct.data.batch), later)
  assert.equal(finished.ok, true)
  assert.equal(finished.data.round.status, 'completed')
  for (let i = 0; i < 2; i++) {
    const reopened = await execute(root, 'study.batch', {}, { now: later })
    assert.equal(reopened.ok, true)
    assert.equal(reopened.data.round.id, roundId)
    assert.deepEqual(reopened.data.round.summary, { total: 1, completed: 1, firstTryCorrect: 0, retryCount: 22 })
  }
  const item = (await run('review.list', {}, later)).data.items[0]
  assert.equal(item.answerCount, 20, '个人词条保留最近20条，不是本批有效作答总数')
  assert.equal(item.box, 1)
  assert.equal(item.dueAt, new Date(2026, 9, 31, 8).toISOString())
  const after = (await run('progress.get', {}, later)).data
  for (const field of ['completions', 'streak', 'curve', 'drift', 'expiredDrafts']) assert.deepEqual(after[field], progress[field], field)
})
