import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { answerFixture } from './answer-fixture.js'

const now = new Date(2026, 9, 29, 9)
const tomorrow = new Date(2026, 9, 30, 9)
const word = (term, extra = {}) => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有搭配讲解。', ...extra })
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'coach-new-word-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, run: (command, payload = {}, date = now) => command === 'review.answer' ? answerFixture(root, payload, date) : execute(root, command, payload, { now: date }) }
}

test('单词和整块表达尚未完成初学时，公开学习进度为零格', async t => {
  const { run } = await fixture(t)
  const added = await run('review.add', { items: [word('reprieve'), word('in fact', { kind: 'expression' })] })
  assert.equal(added.ok, true)
  assert.deepEqual(added.data.added.map(item => [item.kind, item.box]), [['word', 0], ['expression', 0]])
  for (const command of ['review.list', 'review.queue', 'study.batch', 'vocabulary.query']) {
    const result = await run(command)
    assert.equal(result.ok, true)
    assert.equal(result.data.items.length, 2)
    assert.ok(result.data.items.every(item => item.box === 0), command)
  }
})

test('新词错→错→对始终可纠正，最终只亮第一格并从答对日排隔天', async t => {
  const { root, run } = await fixture(t)
  const added = await run('review.add', { items: [word('in fact', { kind: 'expression' })] })
  const initial = added.data.added[0]
  for (let attempt = 1; attempt <= 2; attempt++) {
    const wrong = await run('review.answer', { itemId: initial.id, choice: 0 })
    assert.equal(wrong.ok, true, JSON.stringify(wrong))
    assert.equal(wrong.data.correct, false)
    assert.equal(wrong.data.dueAt, initial.dueAt, '错误不能安排到未来')
    const list = await run('review.list')
    assert.equal(list.data.dueCount, 1)
    assert.equal(list.data.items[0].box, 0)
    assert.equal(list.data.items[0].fresh, true)
    assert.equal(list.data.items[0].answerCount, attempt)
    assert.equal((await run('study.batch')).data.items[0].fresh, true)
  }
  const correct = await run('review.answer', { itemId: initial.id, choice: 1 })
  assert.equal(correct.ok, true, JSON.stringify(correct))
  assert.equal(correct.data.correct, true)
  assert.equal(correct.data.box, 1)
  assert.equal(correct.data.dueAt, tomorrow.toISOString())
  const saved = (await run('review.list')).data.items[0]
  assert.equal(saved.box, 1)
  assert.equal(saved.fresh, false)
  assert.equal(saved.due, false)
  assert.equal(saved.answerCount, 3)
  assert.equal(saved.meaning, initial.meaning)
  assert.equal(saved.explanation, initial.explanation)
  const log = (await fs.readFile(join(root, 'review/log.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.deepEqual(log.map(answer => answer.correct), [false, false, true])
})

test('初学错误响应与保存后的公开状态一致，仍为零格新词', async t => {
  const { run } = await fixture(t)
  const added = await run('review.add', { items: [word('reprieve')] })
  const wrong = await run('review.answer', { itemId: added.data.added[0].id, choice: 0 })
  assert.equal(wrong.ok, true)
  assert.equal(wrong.data.box, 0)
  assert.equal(wrong.data.fresh, true)
  const saved = (await run('review.list')).data.items[0]
  assert.equal(wrong.data.box, saved.box)
  assert.equal(wrong.data.fresh, saved.fresh)
  const correct = await run('review.answer', { itemId: saved.id, choice: 1 })
  assert.equal(correct.data.box, 1)
  assert.equal(correct.data.fresh, false)
})
