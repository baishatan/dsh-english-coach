import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'

const now = new Date(2026, 9, 29, 23, 50)
const word = term => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有讲解。' })
const identity = batch => ({ roundId: batch.round.id, revision: batch.round.revision, presentationId: batch.round.current?.id })
async function fixture(t, terms = ['alpha']) {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-effective-result-'))
  t.after(async () => {
    assert.equal(dirname(root), temporary)
    assert.ok(root.split('/').at(-1).startsWith('coach-effective-result-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const run = (command, payload = {}, date = now) => execute(root, command, payload, { now: date })
  assert.equal((await run('review.add', { items: terms.map(word) })).ok, true)
  return { root, run }
}

test('同一错误呈现并发重发只保存一次，重开与真实再次呈现分别去重和计重试', async t => {
  const { root, run } = await fixture(t)
  const [opened, other] = await Promise.all([run('study.batch'), run('study.batch')])
  assert.deepEqual(opened.data, other.data)
  const batch = opened.data
  const answer = { ...identity(batch), itemId: batch.round.current.itemId, choice: 0 }
  const [first, duplicate] = await Promise.all([run('review.answer', answer), run('review.answer', answer)])
  assert.equal(first.ok, true)
  assert.equal(duplicate.ok, true)
  assert.deepEqual(duplicate.data.batch, first.data.batch)
  assert.equal((await run('review.list')).data.items[0].answerCount, 1)
  const retry = (await run('study.next', identity(first.data.batch))).data
  assert.notEqual(retry.round.current.id, batch.round.current.id)
  const second = await run('review.answer', { ...identity(retry), itemId: answer.itemId, choice: 0 })
  assert.equal(second.ok, true)
  const replay = await execute(root, 'review.answer', answer, { now })
  assert.equal(replay.ok, true)
  assert.equal(replay.data.correct, false)
  assert.deepEqual(replay.data.batch, second.data.batch, '回执返回原结果与最新权威批次，不返回旧快照')
  assert.deepEqual(replay.data.batch.round.summary, { total: 1, completed: 0, firstTryCorrect: 0, retryCount: 1 })
  const saved = (await run('review.list')).data.items[0]
  assert.equal(saved.answerCount, 2)
  assert.equal(saved.lapses, 2)
  assert.equal(saved.box, 0)
})

test('呈现身份和版本必须匹配，正确响应丢失重发先取回执，跨批旧请求不改新批', async t => {
  const { root, run } = await fixture(t, ['alpha', 'beta'])
  const batch = (await run('study.batch')).data
  const answer = { ...identity(batch), itemId: batch.round.current.itemId, choice: 1 }
  for (const invalid of [
    { ...answer, roundId: 'another-round' },
    { ...answer, revision: batch.round.revision - 1 },
    { ...answer, presentationId: 'another-presentation' },
    { ...answer, itemId: batch.items[1].id },
    { itemId: answer.itemId, choice: 1 }
  ]) {
    const refused = await run('review.answer', invalid)
    assert.equal(refused.ok, false, JSON.stringify(invalid))
    assert.equal((await run('review.list')).data.items.every(item => item.answerCount === 0), true)
  }
  const saved = await run('review.answer', answer)
  const replay = await execute(root, 'review.answer', answer, { now })
  assert.equal(replay.ok, true, '成功后已未到期，但回执应先于到期校验')
  assert.deepEqual(replay.data.batch, saved.data.batch)
  const otherChoice = await run('review.answer', { ...answer, choice: 0 })
  assert.equal(otherChoice.ok, true)
  assert.equal(otherChoice.data.correct, true, '同一呈现不能用另一个选项重写有效结果')
  let current = (await run('study.next', identity(saved.data.batch))).data
  const second = await run('review.answer', { ...identity(current), itemId: current.round.current.itemId, choice: 1 })
  current = (await run('study.next', identity(second.data.batch))).data
  await run('review.add', { items: [word('new batch')] })
  const fresh = (await run('study.supplement', { continue: true, ...identity(current) })).data
  assert.notEqual(fresh.round.id, batch.round.id)
  const old = await execute(root, 'review.answer', answer, { now })
  assert.equal(old.ok, true)
  assert.deepEqual(old.data.batch, (await run('study.batch')).data)
  assert.equal(old.data.batch.round.id, fresh.round.id)
  assert.deepEqual((await run('review.list')).data.items.map(item => item.answerCount).sort(), [0, 1, 1])
})

test('旧next不能跳过新反馈，旧revision或跨round继续不能重开，批次版本跨轮单调前进', async t => {
  const { run } = await fixture(t)
  const initial = (await run('study.batch')).data
  const wrong = (await run('review.answer', { ...identity(initial), itemId: initial.round.current.itemId, choice: 0 })).data.batch
  const nextPayload = identity(wrong)
  const retry = (await run('study.next', nextPayload)).data
  const right = (await run('review.answer', { ...identity(retry), itemId: retry.round.current.itemId, choice: 1 })).data.batch
  const staleNext = await run('study.next', nextPayload)
  assert.equal(staleNext.ok, true)
  assert.deepEqual(staleNext.data, right, '迟到next只同步，不能消费另一呈现的新反馈')
  const staleRevision = await run('study.next', { ...identity(right), revision: wrong.round.revision })
  assert.deepEqual(staleRevision.data, right)
  const complete = (await run('study.next', identity(right))).data
  assert.equal(complete.round.status, 'completed')
  const deniedContinue = await run('study.supplement', { continue: true, ...identity(right) })
  assert.equal(deniedContinue.data.round.id, complete.round.id, '最后反馈旧版本不能启动下一批')
  const empty = (await run('study.supplement', { continue: true, ...identity(complete) })).data
  assert.notEqual(empty.round.id, complete.round.id)
  assert.ok(empty.round.revision > complete.round.revision)
  const replay = await run('study.supplement', { continue: true, ...identity(complete) })
  assert.deepEqual(replay.data.round, empty.round, '旧继续不能反复建立空批')
  assert.equal((await run('review.list')).data.items[0].answerCount, 2)
})

test('补记与面板共享稳定身份和有效结果，缺身份不写入，旧时间戳不补历史格', async t => {
  const { root, run } = await fixture(t)
  const itemId = (await run('review.list')).data.items[0].id
  const legacy = await run('record.batch', { reviewAnswers: [{ itemId, correct: true, at: '2020-01-01T00:00:00.000Z' }] })
  assert.equal(legacy.ok, true)
  assert.equal(legacy.data.applied.length, 0)
  assert.equal(legacy.data.skipped[0].reason, 'answer_identity_required')
  const answer = { itemId, correct: false, attemptId: 'offline-error-1', at: '2020-01-01T00:00:00.000Z' }
  const saved = await run('record.batch', { reviewAnswers: [answer, answer] })
  assert.equal(saved.data.applied.length, 1)
  const replay = await execute(root, 'record.batch', { reviewAnswers: [answer] }, { now })
  assert.equal(replay.data.applied.length, 0)
  const panelReplay = await run('review.answer', { itemId, choice: 0, attemptId: answer.attemptId })
  assert.equal(panelReplay.ok, true)
  assert.equal(panelReplay.data.correct, false)
  assert.equal((await run('review.list')).data.items[0].answerCount, 1)
  const correct = { itemId, correct: true, attemptId: 'offline-correct-2', at: '2020-01-01T00:00:00.000Z' }
  assert.equal((await run('record.batch', { reviewAnswers: [correct] })).data.applied.length, 1)
  const learned = (await run('review.list')).data.items[0]
  assert.equal(learned.box, 1)
  assert.equal(learned.lastAt, now.toISOString())
  assert.equal(learned.dueAt, new Date(2026, 9, 30, 23, 50).toISOString())
  const early = await run('record.batch', { reviewAnswers: [{ ...correct, attemptId: 'too-early' }] })
  assert.equal(early.data.applied.length, 0)
  assert.equal(early.data.skipped[0].reason, 'not_due')
  const tomorrow = new Date(2026, 9, 30, 7)
  assert.equal((await run('record.batch', { reviewAnswers: [{ ...correct, attemptId: 'next-day' }] }, tomorrow)).data.applied.length, 1)
  const dayAfter = new Date(2026, 9, 31, 7)
  assert.equal((await run('record.batch', { reviewAnswers: [{ ...correct, attemptId: 'still-early' }] }, dayAfter)).data.skipped[0].reason, 'not_due')
  const current = (await run('study.batch', {}, new Date(2026, 10, 6, 8))).data
  const inRound = { ...identity(current), itemId, correct: false }
  assert.equal((await run('record.batch', { reviewAnswers: [inRound] }, new Date(2026, 10, 6, 8))).data.applied.length, 1)
  const shared = await run('review.answer', { ...identity(current), itemId, choice: 1 }, new Date(2026, 10, 6, 8))
  assert.equal(shared.data.correct, false, '补记先保存的错误不能由同呈现面板改写')
  assert.deepEqual(shared.data.batch.round.summary, { total: 1, completed: 0, firstTryCorrect: 0, retryCount: 0 })
  assert.equal((await run('review.list')).data.items[0].box, 2)
})

test('补记掌握抽检错误不扣格，正确只记实际完成日；损坏恢复不能伪造成功', async t => {
  const { root, run } = await fixture(t)
  const file = join(root, 'review/items.json')
  const original = JSON.parse(await fs.readFile(file, 'utf8'))
  original.extension = { keep: true }
  Object.assign(original.items[0], { box: 4, status: 'mastered', dueAt: now.toISOString(), masteredAt: '2026-01-01T00:00:00.000Z', answers: [{ at: '2026-01-01T00:00:00.000Z', correct: true }] })
  await fs.writeFile(file, JSON.stringify(original))
  const itemId = original.items[0].id
  const record = (correct, attemptId, date = now) => run('record.batch', { reviewAnswers: [{ itemId, correct, attemptId, at: '2020-01-01T00:00:00.000Z' }] }, date)
  assert.equal((await record(false, 'check-error')).data.applied.length, 1)
  const wrong = (await run('review.list')).data.items[0]
  assert.equal(wrong.box, 4)
  assert.equal(wrong.status, 'mastered')
  assert.equal(wrong.checkups, 0)
  const tomorrow = new Date(2026, 9, 30, 7)
  assert.equal((await record(true, 'check-correct', tomorrow)).data.applied.length, 1)
  const right = (await run('review.list')).data.items[0]
  assert.equal(right.checkups, 1)
  assert.equal(right.box, 4)
  assert.equal(right.dueAt, new Date(2027, 0, 28, 7).toISOString())
  assert.equal((await record(true, 'check-correct', tomorrow)).data.applied.length, 0)
  const saved = await fs.readFile(file, 'utf8')
  assert.deepEqual(JSON.parse(saved).extension, { keep: true })
  await fs.writeFile(file, '{broken')
  const refused = await record(true, 'cannot-recover')
  assert.equal(refused.data?.applied?.length ?? 0, 0)
  assert.match(JSON.stringify(refused), /round_recovery_failed/)
  assert.equal(await fs.readFile(file, 'utf8'), '{broken')
  await fs.writeFile(file, saved)
})

test('JSON已提交但日志失败仍成功，重读按有效作答key补投影且不重复学习事实', async t => {
  const { root, run } = await fixture(t)
  const batch = (await run('study.batch')).data
  const log = join(root, 'review/log.jsonl')
  assert.equal(resolve(log), `${root}/review/log.jsonl`)
  await fs.mkdir(log)
  const answer = { ...identity(batch), itemId: batch.round.current.itemId, choice: 1 }
  const committed = await run('review.answer', answer)
  assert.equal(committed.ok, true)
  assert.match(committed.warnings.join(' '), /答案已保存.*日志/)
  assert.equal(resolve(log), `${root}/review/log.jsonl`)
  await fs.rmdir(log)
  const restored = await run('study.batch')
  assert.equal(restored.data.round.summary.completed, 1)
  await run('review.answer', answer)
  await run('study.batch')
  const entries = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(entries.length, 1)
  assert.ok(entries[0].key)
  assert.equal(entries[0].correct, true)
  assert.equal((await run('review.list')).data.items[0].answerCount, 1)
})
