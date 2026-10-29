import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'

const now = new Date(2026, 9, 29, 23, 50)
const word = term => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有讲解。' })
async function fixture(t, terms = ['alpha', 'beta', 'in fact']) {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-durable-round-'))
  t.after(async () => {
    assert.equal(dirname(root), temporary)
    assert.ok(root.split('/').at(-1).startsWith('coach-durable-round-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const run = (command, payload = {}, date = now) => execute(root, command, payload, { now: date })
  assert.equal((await run('settings.save', { study: { wordsPerDay: 3 } })).ok, true)
  assert.equal((await run('review.add', { items: terms.map(word) })).ok, true)
  return { root, run }
}

test('首次打开保存未答呈现，重读不换批且设置和新增候选只影响下一批', async t => {
  const { root, run } = await fixture(t)
  const before = (await run('review.list')).data
  const first = await run('study.batch')
  assert.equal(first.ok, true)
  assert.ok(first.data.round?.id, '公开批次须有持久身份')
  assert.equal(first.data.round.status, 'active')
  assert.equal(first.data.round.at, 0)
  assert.deepEqual(first.data.round.summary, { total: 3, completed: 0, firstTryCorrect: 0, retryCount: 0 })
  assert.deepEqual(first.data.round.current.choiceOrder, [0, 1, 2, 3])
  assert.equal(first.data.round.current.picked, null)
  assert.equal(first.data.round.current.feedback, null)
  assert.deepEqual((await run('review.list')).data, before, '建立批次不得改变词的进度')
  await run('settings.save', { study: { wordsPerDay: 7 } })
  await run('wordlists.select', { id: 'ielts' })
  await run('review.add', { items: [word('new arrival')] })
  const reopened = await execute(root, 'study.batch', {}, { now })
  // Use a separate call with no client memory; execute reads the isolated root.
  assert.equal(reopened.ok, true)
  assert.deepEqual(reopened.data.round, first.data.round)
  assert.deepEqual(reopened.data.items, first.data.items)
  assert.equal(reopened.data.batchSize, 3)
  assert.equal(reopened.data.activeWordListId, null)
})

const identity = batch => ({ roundId: batch.round.id, revision: batch.round.revision, presentationId: batch.round.current?.id })

test('错误反馈与选中位置重开后一致，继续保存队尾及重试选项映射', async t => {
  const { root, run } = await fixture(t)
  const first = (await run('study.batch')).data
  const answered = await run('review.answer', { ...identity(first), itemId: first.items[0].id, choice: 0 })
  assert.equal(answered.ok, true)
  assert.ok(answered.data.batch, '作答须返回同次原子保存的批次')
  const wrong = answered.data.batch
  assert.deepEqual(wrong.round.summary, { total: 3, completed: 0, firstTryCorrect: 0, retryCount: 0 })
  assert.equal(wrong.round.current.picked, 0)
  assert.deepEqual(wrong.round.current.feedback, { correct: false, explanation: '保留已有讲解。' })
  assert.deepEqual((await execute(root, 'study.batch', {}, { now })).data, wrong)
  const next = await run('study.next', identity(wrong))
  assert.equal(next.ok, true)
  assert.deepEqual(next.data.items.map(item => item.term), ['beta', 'in fact', 'alpha'])
  assert.equal(next.data.round.current.itemId, first.items[1].id)
  assert.equal(next.data.round.current.picked, null)
  assert.deepEqual((await run('study.batch')).data, next.data)
  let batch = next.data
  for (let index = 0; index < 2; index++) {
    const item = batch.items[batch.round.at]
    const saved = await run('review.answer', { ...identity(batch), itemId: item.id, choice: 1 })
    batch = (await run('study.next', identity(saved.data.batch))).data
  }
  const retry = batch.items[batch.round.at]
  assert.equal(retry.term, 'alpha')
  assert.notDeepEqual(retry.choiceOrder, [0, 1, 2, 3])
  assert.equal(retry.choices[retry.answerIndex], '正确释义')
  assert.equal(retry.choiceOrder[retry.answerIndex], 1)
  assert.deepEqual((await execute(root, 'study.batch', {}, { now })).data, batch)
})

test('昨晚十词完成八词，隔天和隔多日只续原批，完成态保持到显式继续', async t => {
  const { root, run } = await fixture(t, Array.from({ length: 10 }, (_, i) => `word ${i}`))
  await run('settings.save', { study: { wordsPerDay: 10 } })
  let batch = (await run('study.batch')).data
  const original = batch.round.id
  for (let i = 0; i < 8; i++) {
    const saved = await run('review.answer', { ...identity(batch), itemId: batch.round.current.itemId, choice: 1 })
    batch = (await run('study.next', identity(saved.data.batch))).data
  }
  const midnight = new Date(2026, 9, 30, 0, 5)
  const later = new Date(2026, 10, 2, 8)
  await run('review.add', { items: [word('newly due')] }, midnight)
  await run('settings.save', { study: { wordsPerDay: 3 } }, midnight)
  await run('wordlists.select', { id: 'ielts' }, midnight)
  for (const date of [midnight, later]) {
    const reopened = await execute(root, 'study.batch', {}, { now: date })
    assert.equal(reopened.data.round.id, original)
    assert.equal(reopened.data.round.summary.completed, 8)
    assert.equal(reopened.data.round.at, 8)
    assert.equal(reopened.data.items.length, 10)
    assert.equal(reopened.data.items.some(item => item.term === 'newly due'), false)
  }
  for (let i = 0; i < 2; i++) {
    const saved = await run('review.answer', { ...identity(batch), itemId: batch.round.current.itemId, choice: 1 }, later)
    assert.equal(saved.ok, true)
    assert.equal(saved.data.dueAt, new Date(2026, 10, 3, 8).toISOString())
    const feedback = (await execute(root, 'study.batch', {}, { now: later })).data
    assert.deepEqual(feedback.round.current, saved.data.batch.round.current)
    batch = (await run('study.next', identity(feedback), later)).data
  }
  assert.equal(batch.round.status, 'completed')
  assert.deepEqual(batch.round.summary, { total: 10, completed: 10, firstTryCorrect: 10, retryCount: 0 })
  assert.deepEqual((await run('study.batch', {}, later)).data, batch)
  assert.deepEqual((await run('study.supplement', {}, later)).data.round, batch.round, '普通读取或补词不自动开下一批')
  const next = await run('study.supplement', { continue: true, roundId: original }, later)
  assert.equal(next.ok, true)
  assert.notEqual(next.data.round.id, original)
  assert.equal(next.data.batchSize, 3)
  assert.equal(next.data.activeWordListId, 'ielts')
  assert.equal(next.data.items.length, 3)
  assert.equal(next.data.items.every(item => item.term !== 'word 8' && item.term !== 'word 9'), true)
  assert.equal(next.data.items[0].fresh, false, '新批按实时到期旧词优先')
})

test('原子保存失败不推进词或清除反馈；JSON保存后的日志失败返回警告而非重答', async t => {
  const { root, run } = await fixture(t, ['alpha'])
  const batch = (await run('study.batch')).data
  const backup = join(root, 'review/items.json.bak')
  assert.equal(resolve(backup), `${resolve(root)}/review/items.json.bak`)
  await fs.rm(backup, { force: true })
  await fs.mkdir(backup)
  const answer = { ...identity(batch), itemId: batch.round.current.itemId, choice: 1 }
  const failed = await run('review.answer', answer)
  assert.equal(failed.ok, false)
  assert.deepEqual((await run('study.batch')).data, batch)
  assert.equal((await run('review.list')).data.items[0].box, 0)
  assert.equal(resolve(backup), `${resolve(root)}/review/items.json.bak`)
  await fs.rmdir(backup)
  await fs.mkdir(join(root, 'review/log.jsonl'))
  const committed = await run('review.answer', answer)
  assert.equal(committed.ok, true, '日志失败不能把权威JSON已提交误报为作答失败')
  assert.match(committed.warnings.join(' '), /答案已保存.*日志/)
  const feedback = (await run('study.batch')).data
  assert.deepEqual(feedback, committed.data.batch)
  assert.equal(feedback.round.summary.completed, 1)
  assert.equal((await run('review.list')).data.items[0].box, 1)
  assert.equal(resolve(backup), `${resolve(root)}/review/items.json.bak`)
  await fs.rm(backup)
  await fs.mkdir(backup)
  const next = await run('study.next', identity(feedback))
  assert.equal(next.ok, false)
  assert.deepEqual((await run('study.batch')).data, feedback, '继续保存失败应仍恢复正确反馈而非完成画面')
})

test('损坏批次读取拒绝新建或覆盖，不能把恢复失败冒充空态或完成态', async t => {
  const { root, run } = await fixture(t, ['alpha'])
  await run('study.batch')
  const target = join(root, 'review/items.json')
  const saved = await fs.readFile(target, 'utf8')
  await fs.writeFile(target, '{broken')
  for (const command of ['study.batch', 'study.supplement', 'study.next', 'review.answer']) {
    const failed = await run(command, { continue: true, itemId: 'rv-alpha', choice: 1 })
    assert.equal(failed.ok, false, command)
    assert.match(failed.message, /恢复.*失败/)
    assert.equal(await fs.readFile(target, 'utf8'), '{broken', '不覆盖故障现场或从备份重新加格')
  }
  await fs.writeFile(target, saved)
  const restored = await run('study.batch')
  assert.equal(restored.data.round.summary.completed, 0)
  assert.equal(restored.data.items[0].box, 0)
})

test('每次真实纠正的排列均不同于该词上一呈现，固定随机数也不会偶发沿用', async t => {
  const { run } = await fixture(t, ['alpha'])
  t.mock.method(Math, 'random', () => 0)
  let batch = (await run('study.batch')).data
  for (let i = 0; i < 3; i++) {
    const previous = batch.round.current.choiceOrder
    const wrong = await run('review.answer', { ...identity(batch), itemId: batch.round.current.itemId, choice: 0 })
    batch = (await run('study.next', identity(wrong.data.batch))).data
    assert.notDeepEqual(batch.round.current.choiceOrder, previous)
    assert.equal(batch.items[0].choices[batch.items[0].answerIndex], '正确释义')
  }
})
