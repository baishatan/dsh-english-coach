import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { answerFixture, roundIdentity } from './answer-fixture.js'

function at(day, hour = 9) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, hour)
}
const now = at('2026-10-28')
const word = (term, extra = {}) => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有搭配讲解。', ...extra })
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'coach-due-correction-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, run: (command, payload = {}, date = now) => command === 'review.answer' ? answerFixture(root, payload, date) : execute(root, command, payload, { now: date }) }
}
async function learnToTwo(run, items = [word('reprieve')]) {
  const added = await run('review.add', { items }, at('2026-10-20'))
  assert.equal(added.ok, true, JSON.stringify(added))
  for (const item of added.data.added) {
    for (const day of ['2026-10-20', '2026-10-21']) {
      assert.equal((await run('review.answer', { itemId: item.id, choice: 1 }, at(day))).ok, true)
    }
  }
  return added.data.added
}

test('两格到期旧词和整块表达错→错→对不退格，纠正后从实际正确日排30天', async t => {
  for (const input of [word('reprieve'), word('in fact', { kind: 'expression' })]) {
    const { root, run } = await fixture(t)
    const [item] = await learnToTwo(run, [input])
    const before = (await run('review.list')).data.items.find(entry => entry.id === item.id)
    assert.equal(before.box, 2)
    for (const hour of [10, 11]) {
      const wrong = await run('review.answer', { itemId: item.id, choice: 0 }, at('2026-10-28', hour))
      assert.equal(wrong.ok, true, JSON.stringify(wrong))
      assert.equal(wrong.data.correct, false)
      assert.equal(wrong.data.box, 2)
      assert.equal(wrong.data.dueAt, before.dueAt)
      const saved = (await run('review.list')).data.items.find(entry => entry.id === item.id)
      assert.equal(saved.box, 2)
      assert.equal(saved.due, true)
      assert.ok((await run('study.batch')).data.items.some(entry => entry.id === item.id))
    }
    const correct = await run('review.answer', { itemId: item.id, choice: 1 }, at('2026-10-29', 7))
    assert.equal(correct.ok, true, JSON.stringify(correct))
    assert.equal(correct.data.box, 3)
    assert.equal(correct.data.dueAt, at('2026-11-28', 7).toISOString())
    const saved = (await run('review.list', {}, at('2026-10-29', 7))).data.items.find(entry => entry.id === item.id)
    assert.equal(saved.answerCount, 5)
    assert.equal(saved.lapses, 2)
    assert.equal(saved.due, false)
    assert.equal(saved.meaning, item.meaning)
    assert.equal(saved.explanation, item.explanation)
    const stored = JSON.parse(await fs.readFile(join(root, 'review/items.json'), 'utf8'))
    assert.deepEqual(stored.items[0].answers.map(answer => answer.correct), [true, true, false, false, true])
  }
})

test('旧档fresh真但已有作答仍是一格旧词，缺新增字段不回算、不重置且保留未知字段', async t => {
  const { root, run } = await fixture(t)
  const legacyAt = at('2026-10-20').toISOString()
  const legacy = {
    version: 1, extension: { keep: 'root' }, items: [
      { ...word('legacy-started'), id: 'legacy', box: 1, status: 'learning', fresh: true, dueAt: now.toISOString(), lastAt: legacyAt, answers: [{ at: legacyAt, correct: false }], custom: { keep: 'item' } },
      { ...word('missing-fields'), id: 'missing', box: 2, status: 'learning', dueAt: now.toISOString(), lastAt: legacyAt, answers: [{ at: legacyAt, correct: true }] },
      { ...word('legacy-mastered'), id: 'mastered', box: 4, status: 'mastered', dueAt: at('2026-12-01').toISOString(), masteredAt: legacyAt, answers: [{ at: legacyAt, correct: false }] },
      { ...word('duplicate-term'), id: 'duplicate-one', box: 3, status: 'learning', dueAt: at('2026-12-01').toISOString(), answers: [{ at: legacyAt, correct: false }] },
      { ...word('duplicate-term'), id: 'duplicate-two', box: 2, status: 'learning', dueAt: at('2026-12-01').toISOString(), answers: [{ at: legacyAt, correct: true }] }
    ]
  }
  const file = join(root, 'review/items.json')
  await fs.mkdir(join(root, 'review'), { recursive: true })
  await fs.writeFile(file, JSON.stringify(legacy))
  const before = await fs.readFile(file, 'utf8')
  for (const command of ['review.list', 'review.queue', 'study.batch', 'vocabulary.query']) {
    const result = await run(command)
    assert.equal(result.ok, true, JSON.stringify(result))
    const item = result.data.items.find(entry => entry.id === 'legacy')
    assert.equal(item.box, 1, command)
    assert.equal(item.fresh, false, '历史作答证据优先于旧fresh标记')
    assert.equal(result.data.items.find(entry => entry.id === 'missing').box, 2)
  }
  const { round, ...afterRead } = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.deepEqual(afterRead, JSON.parse(before), '首次批次元数据以外不迁移旧档或回拉历史错误')
  assert.deepEqual(round.facts.legacy.answers, [], '不从历史错误重建本批作答')
  assert.equal((await run('review.list')).data.items.find(entry => entry.id === 'mastered').due, false)
  const wrong = await run('review.answer', { itemId: 'legacy', choice: 0 })
  assert.equal(wrong.data.box, 1)
  assert.equal(wrong.data.fresh, false)
  assert.equal(wrong.data.dueAt, now.toISOString())
  let batch = wrong.data.batch
  batch = (await run('study.next', roundIdentity(batch))).data
  // The other due legacy item is answered normally before legacy returns from
  // the correction queue; untouched future/mastered/duplicate items stay intact.
  const missing = await run('review.answer', { ...roundIdentity(batch), itemId: 'missing', choice: 1 })
  batch = (await run('study.next', roundIdentity(missing.data.batch))).data
  const correct = await execute(root, 'review.answer', { ...roundIdentity(batch), itemId: 'legacy', choice: 1 }, { now })
  assert.equal(correct.data.box, 2, '不按旧错误重做初学，也不补发历史进度')
  assert.equal(correct.data.dueAt, at('2026-11-04').toISOString())
  const saved = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.deepEqual(saved.extension, legacy.extension)
  assert.deepEqual(saved.items[0].custom, legacy.items[0].custom)
  assert.deepEqual(saved.items[0].answers.map(answer => answer.correct), [false, false, true])
  assert.deepEqual(saved.items.slice(2), legacy.items.slice(2), '未作答的旧项和历史重复项不迁移')
  assert.equal(saved.items[1].box, 3, '另一个实际作答的到期词只推进一格')
})

test('已掌握表达抽检错后仍四格且保持掌握，最终正确只完成抽检并排90天', async t => {
  const { run } = await fixture(t)
  const [item] = await learnToTwo(run, [word('in fact', { kind: 'expression' })])
  assert.equal((await run('review.answer', { itemId: item.id, choice: 1 })).data.box, 3)
  const mastered = await run('review.answer', { itemId: item.id, choice: 1 }, at('2026-11-27'))
  assert.equal(mastered.data.box, 4)
  assert.equal(mastered.data.status, 'mastered')
  assert.equal(mastered.data.dueAt, at('2027-02-25').toISOString())
  const original = (await run('review.list', {}, at('2027-02-25'))).data.items[0]
  for (const hour of [10, 11]) {
    const wrong = await run('review.answer', { itemId: item.id, choice: 0 }, at('2027-02-25', hour))
    assert.equal(wrong.ok, true, JSON.stringify(wrong))
    assert.equal(wrong.data.correct, false)
    assert.equal(wrong.data.box, 4)
    assert.equal(wrong.data.status, 'mastered')
    assert.equal(wrong.data.mastered, 1)
    assert.equal(wrong.data.dueAt, original.dueAt)
    const saved = (await run('review.list', {}, at('2027-02-25', hour))).data.items[0]
    assert.equal(saved.due, true)
    assert.equal(saved.masteredAt, original.masteredAt)
    assert.equal(saved.checkups, 0)
    assert.equal((await run('progress.get', {}, at('2027-02-25', hour))).data.mastered, 1)
  }
  const correct = await run('review.answer', { itemId: item.id, choice: 1 }, at('2027-02-26', 7))
  assert.equal(correct.ok, true, JSON.stringify(correct))
  assert.equal(correct.data.box, 4)
  assert.equal(correct.data.status, 'mastered')
  assert.equal(correct.data.dueAt, at('2027-05-27', 7).toISOString())
  const saved = (await run('review.list', {}, at('2027-02-26', 7))).data.items[0]
  assert.equal(saved.masteredAt, original.masteredAt)
  assert.equal(saved.checkups, 1)
  assert.equal(saved.answerCount, 7)
  assert.equal(saved.lapses, 2)
  assert.equal(saved.due, false)
})

test('自然日排期跨夏令时回拨仍隔天到期，不能在同一学习日再次推进', async t => {
  const previousZone = process.env.TZ
  process.env.TZ = 'America/New_York'
  t.after(() => { if (previousZone === undefined) delete process.env.TZ; else process.env.TZ = previousZone })
  const { run } = await fixture(t)
  const early = new Date(2026, 10, 1, 0, 30)
  const nextMorning = new Date(2026, 10, 2, 0, 1)
  const added = await run('review.add', { items: [word('reprieve')] }, early)
  const itemId = added.data.added[0].id
  const learned = await run('review.answer', { itemId, choice: 1 }, early)
  assert.equal(learned.data.dueAt, new Date(2026, 10, 2, 0, 30).toISOString(), '一天是下一个自然日，不是24小时')
  const sameDay = new Date(2026, 10, 1, 23, 45)
  assert.equal((await run('review.answer', { itemId, choice: 1 }, sameDay)).code, 'not_due')
  assert.equal((await run('study.batch', {}, sameDay)).data.items.length, 0)
  assert.equal((await run('review.list', {}, sameDay)).data.items[0].answerCount, 1)
  const next = await run('review.answer', { itemId, choice: 1 }, nextMorning)
  assert.equal(next.ok, true, JSON.stringify(next))
  assert.equal(next.data.box, 2)
  assert.equal(next.data.dueAt, new Date(2026, 10, 9, 0, 1).toISOString())
})

test('正常入口每学习日只推进一次，次日不能提前绕过7／30／90天也不拿未到期词凑批', async t => {
  const { root, run } = await fixture(t)
  const [item] = await learnToTwo(run)
  for (const day of ['2026-10-21', '2026-10-22', '2026-10-27']) {
    const before = await fs.readFile(join(root, 'review/items.json'), 'utf8')
    const early = await run('review.answer', { itemId: item.id, choice: 1 }, at(day, 23))
    assert.equal(early.code, 'not_due')
    assert.equal((await run('study.batch', {}, at(day, 23))).data.items.length, 0)
    assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'review/items.json'), 'utf8')).items, JSON.parse(before).items, '允许首次批次元数据，不改词进度')
  }
  const invalid = await run('review.answer', { itemId: item.id, choice: 4 })
  assert.equal(invalid.code, 'invalid_field')
  assert.equal((await run('review.list')).data.items[0].answerCount, 2)
  const dueMorning = await run('review.answer', { itemId: item.id, choice: 0 }, at('2026-10-28', 0))
  assert.equal(dueMorning.ok, true)
  assert.equal(dueMorning.data.box, 2)
  const correct = await run('review.answer', { itemId: item.id, choice: 1 }, at('2026-10-28', 0))
  assert.equal(correct.data.box, 3)
  assert.equal(correct.data.dueAt, at('2026-11-27', 0).toISOString())
  for (const day of ['2026-10-28', '2026-10-29', '2026-11-26']) {
    assert.equal((await run('review.answer', { itemId: item.id, choice: 1 }, at(day, 23))).code, 'not_due')
    assert.equal((await run('study.batch', {}, at(day, 23))).data.items.length, 0)
  }
  const mastered = await run('review.answer', { itemId: item.id, choice: 1 }, at('2026-11-27', 0))
  assert.equal(mastered.data.box, 4)
  assert.equal(mastered.data.status, 'mastered')
  assert.equal(mastered.data.dueAt, at('2027-02-25', 0).toISOString())
  assert.equal((await run('review.answer', { itemId: item.id, choice: 1 }, at('2027-02-24'))).code, 'not_due')
  assert.equal((await run('study.batch', {}, at('2027-02-24'))).data.items.length, 0)
})
