import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'

const identity = batch => ({ roundId: batch.round.id, revision: batch.round.revision, presentationId: batch.round.current?.id })
const word = (id, term, extra = {}) => ({ id, term, kind: 'word', meaning: '原有释义', choices: ['另一释义', '原有释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '原有搭配讲解。', ...extra })

test('合成旧档与新词表达同批跨日纠正，补记重放不改成绩且历史重复项留待显式续批', async t => {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-word-retry-acceptance-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), temporary)
    assert.ok(root.split('/').at(-1).startsWith('coach-word-retry-acceptance-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  const now = new Date(2026, 9, 29, 23, 50)
  const midnight = new Date(2026, 9, 30, 0, 5)
  const later = new Date(2026, 10, 2, 8)
  const oldAt = new Date(2026, 9, 22, 9).toISOString()
  const masteredAt = new Date(2026, 8, 1, 9).toISOString()
  const legacy = {
    version: 1, extension: { keep: 'legacy-root' }, items: [
      word('old-word', 'reprieve', { box: 2, status: 'learning', dueAt: new Date(2026, 9, 29, 0).toISOString(), lastAt: oldAt, answers: [{ at: oldAt, correct: true }, { at: oldAt, correct: false }], custom: 'keep' }),
      word('old-mastered', 'by and large', { kind: 'expression', box: 4, status: 'mastered', dueAt: new Date(2026, 9, 29, 0, 1).toISOString(), masteredAt, answers: [{ at: oldAt, correct: false }, { at: oldAt, correct: true }] }),
      word('old-expression', 'in fact', { kind: 'expression', box: 1, status: 'learning', fresh: true, dueAt: new Date(2026, 9, 29, 0, 2).toISOString(), lastAt: oldAt, answers: [{ at: oldAt, correct: true }] }),
      word('legacy-new-expression', 'on the whole', { kind: 'expression', box: 1, status: 'learning', dueAt: new Date(2026, 9, 29, 0, 3).toISOString() }),
      word('duplicate-one', 'keep together', { box: 3, status: 'learning', dueAt: new Date(2026, 9, 30, 9).toISOString(), answers: [{ at: oldAt, correct: false }], custom: 'first duplicate' }),
      word('duplicate-two', ' KEEP   TOGETHER ', { box: 2, status: 'learning', dueAt: new Date(2026, 11, 1, 9).toISOString(), answers: [{ at: oldAt, correct: true }], custom: 'second duplicate' })
    ]
  }
  const file = join(root, 'review/items.json')
  await fs.mkdir(join(root, 'review'), { recursive: true })
  await fs.writeFile(file, JSON.stringify(legacy))
  const run = async (command, payload = {}, date = now) => {
    const result = await execute(root, command, payload, { now: date })
    assert.equal(result.ok, true, `${command}: ${JSON.stringify(result)}`)
    return result.data
  }
  await run('settings.save', { study: { wordsPerDay: 5 } })
  const added = await run('review.add', { items: [word('modern-new-word', 'new arrival')] })
  assert.equal(added.addedCount, 1)
  const newId = added.added[0].id
  const progressBefore = await run('progress.get')
  let batch = await run('study.batch')
  const roundId = batch.round.id
  assert.deepEqual(batch.items.map(item => item.id), ['old-word', 'old-mastered', 'old-expression', 'legacy-new-expression', newId])
  assert.deepEqual(batch.items.map(item => item.box), [2, 4, 1, 0, 0])
  assert.deepEqual(batch.items.map(item => item.fresh), [false, false, false, true, true])
  assert.deepEqual(batch.round.summary, { total: 5, completed: 0, firstTryCorrect: 0, retryCount: 0 }, '历史错误不回拉或重建本批成绩')

  const firstRecord = { ...identity(batch), itemId: 'old-word', correct: false, at: '2020-01-01T00:00:00.000Z' }
  const wrongRecord = await run('record.batch', { reviewAnswers: [firstRecord, firstRecord] })
  assert.equal(wrongRecord.applied.length, 1)
  assert.deepEqual(wrongRecord.skipped.map(item => item.reason), ['duplicate'])
  const replay = await run('review.answer', { ...identity(batch), itemId: 'old-word', choice: 1 })
  assert.equal(replay.correct, false, '同呈现补记和面板共享第一次已保存结果')
  batch = await run('study.next', identity(replay.batch))
  const answerAndNext = async (itemId, choice, date = now) => {
    assert.equal(batch.round.current.itemId, itemId)
    const saved = await run('review.answer', { ...identity(batch), itemId, choice }, date)
    batch = await run('study.next', identity(saved.batch), date)
    return saved
  }
  const wrongMastered = await answerAndNext('old-mastered', 0)
  assert.equal(wrongMastered.box, 4)
  assert.equal(wrongMastered.status, 'mastered')
  assert.equal(wrongMastered.dueAt, legacy.items[1].dueAt)
  await answerAndNext('old-expression', 1)
  await answerAndNext('legacy-new-expression', 0)
  await answerAndNext(newId, 1)
  assert.deepEqual(batch.round.summary, { total: 5, completed: 2, firstTryCorrect: 2, retryCount: 0 })

  // No client memory: both a new execute call and a later-day read keep the
  // original unfinished batch instead of inserting newly due duplicate-one.
  for (const date of [midnight, later]) {
    const reopened = await run('study.batch', {}, date)
    assert.equal(reopened.round.id, roundId)
    assert.deepEqual(reopened.round, batch.round)
    assert.deepEqual(reopened.items.map(item => item.id), batch.items.map(item => item.id))
  }
  assert.equal(batch.round.current.itemId, 'old-word')
  const correction = { ...identity(batch), itemId: 'old-word', correct: true, at: '2020-01-01T00:00:00.000Z' }
  const corrected = await run('record.batch', { reviewAnswers: [correction, correction] }, later)
  assert.equal(corrected.applied.length, 1)
  assert.deepEqual(corrected.skipped.map(item => item.reason), ['duplicate'])
  batch = await run('study.next', identity(corrected.batch), later)
  await answerAndNext('old-mastered', 0, later)
  const learnedExpression = await answerAndNext('legacy-new-expression', 1, later)
  assert.equal(learnedExpression.box, 1)
  assert.equal(learnedExpression.dueAt, new Date(2026, 10, 3, 8).toISOString())
  const mastered = await answerAndNext('old-mastered', 1, later)
  assert.equal(mastered.box, 4)
  assert.equal(mastered.status, 'mastered')
  assert.equal(mastered.dueAt, new Date(2027, 0, 31, 8).toISOString())
  assert.equal(batch.round.status, 'completed')
  assert.deepEqual(batch.round.summary, { total: 5, completed: 5, firstTryCorrect: 2, retryCount: 4 }, '九次有效作答包含四次真实重试，不含传输重放')
  for (const date of [later, new Date(2026, 10, 3, 8)]) {
    assert.deepEqual((await run('study.batch', {}, date)).round, batch.round)
  }

  const vocabulary = await run('review.list', {}, later)
  assert.equal(vocabulary.total, 7, '不合并既有重复项')
  const byId = new Map(vocabulary.items.map(item => [item.id, item]))
  assert.deepEqual(['old-word', 'old-mastered', 'old-expression', 'legacy-new-expression', newId].map(id => byId.get(id).answerCount), [4, 5, 2, 2, 1])
  assert.equal(byId.get('old-word').box, 3)
  assert.equal(byId.get('old-word').lastAt, later.toISOString())
  assert.equal(byId.get('old-word').dueAt, new Date(2026, 11, 2, 8).toISOString())
  assert.equal(byId.get('old-expression').box, 2)
  assert.equal(byId.get('old-expression').dueAt, new Date(2026, 10, 5, 23, 50).toISOString())
  assert.equal(byId.get('old-mastered').masteredAt, masteredAt)
  assert.equal(byId.get('old-mastered').checkups, 1)
  const stored = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.deepEqual(stored.extension, legacy.extension)
  assert.equal(stored.items.find(item => item.id === 'old-word').custom, 'keep')
  for (const old of legacy.items.slice(4)) assert.deepEqual(stored.items.find(item => item.id === old.id), old)
  for (const old of legacy.items.slice(0, 3)) {
    const saved = stored.items.find(item => item.id === old.id)
    assert.equal(saved.meaning, old.meaning)
    assert.equal(saved.explanation, old.explanation)
    assert.deepEqual(saved.answers.slice(0, old.answers.length), old.answers, '不回算或改写旧答案')
  }
  const events = (await fs.readFile(join(root, 'review/log.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line))
  assert.equal(events.length, 9)
  assert.equal(events.filter(event => event.correct).length, 5)
  assert.equal(new Set(events.map(event => event.key)).size, 9)
  const progressAfter = await run('progress.get', {}, later)
  for (const field of ['completions', 'streak', 'curve', 'drift', 'expiredDrafts']) assert.deepEqual(progressAfter[field], progressBefore[field], field)

  const next = await run('study.supplement', { continue: true, ...identity(batch) }, later)
  assert.notEqual(next.round.id, roundId)
  assert.ok(next.round.revision > batch.round.revision)
  assert.deepEqual(next.items.map(item => item.id), ['duplicate-one', newId], '只有显式下一批才纳入实时到期项，不拿未到期词凑批')
  assert.deepEqual(next.round.summary, { total: 2, completed: 0, firstTryCorrect: 0, retryCount: 0 })
  const lateRecord = await run('record.batch', { reviewAnswers: [firstRecord, correction] }, later)
  assert.equal(lateRecord.applied.length, 0)
  assert.deepEqual(lateRecord.skipped.map(item => item.reason), ['duplicate', 'duplicate'])
  assert.deepEqual(lateRecord.batch.round, next.round, '跨批回执不把旧成绩注入新批')
  assert.equal((await fs.readFile(join(root, 'review/log.jsonl'), 'utf8')).trim().split('\n').length, 9)
})
