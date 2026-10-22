import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'

const now = new Date('2026-10-22T09:00:00+08:00')
async function fixture(t) {
  const root = await fs.mkdtemp(join(tmpdir(), 'coach-experience-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { root, run: (command, payload = {}, date = now) => execute(root, command, payload, { now: date }) }
}
function word(term, extra = {}) {
  return { term, meaning: '事实上', choices: ['事实上', '因此', '然而', '尽管'], answerIndex: 0, ...extra }
}
function lesson(date, reviewItems, expressions = []) {
  return { date, title: '隔离测试课程', sources: [{ id: 's', url: `https://example.com/${date}`, fetchedAt: now.toISOString(), license: '合成测试材料' }], items: [
    { id: 'r', type: 'reading', sourceId: 's', body: 'A synthetic reading.' },
    { id: 'l', type: 'listening', sourceId: 's', transcript: 'A synthetic transcript.' },
    { id: 'e', type: 'expressions', expressions: expressions.length ? expressions : [{ term: 'sample', meaning: '示例' }] },
    { id: 'q', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['甲', '乙', '丙', '丁'], answerIndex: 0 }] }
  ], reviewItems }
}

test('跨课程与补词规范词面去重，仅追加来源且保护既有作答及未知字段', async (t) => {
  const { root, run } = await fixture(t)
  const first = await run('review.add', { items: [word(' In   Fact ')] })
  assert.equal(first.ok, true)
  const id = first.data.added[0].id
  assert.equal((await run('review.answer', { itemId: id, choice: 0 })).ok, true)
  const file = join(root, 'review/items.json')
  const original = JSON.parse(await fs.readFile(file, 'utf8'))
  original.extension = { preserved: true }
  original.items[0].custom = 'keep'
  await fs.writeFile(file, JSON.stringify(original))
  const old = original.items[0]
  const submission = lesson('2026-10-22', [word('in fact', { id: 'different-id', meaning: '实际上', choices: ['实际上', '首先', '终于', '偶尔'] }), word('IN FACT', { id: 'another-id' })])
  const result = await run('lesson.save', submission)
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.data.reviewAdded, 0)
  assert.equal(result.data.reviewLinked, 1)
  assert.equal((await run('lesson.save', submission)).data.reviewLinked, 0)
  const duplicate = await run('review.add', { items: [word(' IN\tFACT ')] })
  assert.equal(duplicate.data.addedCount, 0)
  assert.equal(duplicate.data.skipped.length, 1)
  const saved = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.deepEqual(saved.extension, original.extension)
  assert.equal(saved.items.length, 1)
  const { sources, ...content } = saved.items[0]
  const { sources: oldSources, ...oldContent } = old
  assert.deepEqual(content, oldContent)
  assert.deepEqual(sources, [{ kind: 'supplement' }, { kind: 'lesson', id: '2026-10-22' }])
})

test('课程新增练习无效时拒绝全部写入；同id不同词面保留两份独立身份', async (t) => {
  const { root, run } = await fixture(t)
  const bad = await run('lesson.save', lesson('2026-10-22', [word('bad', { choices: ['事实上', '事实上', '然而', '尽管'] })]))
  assert.equal(bad.ok, false)
  assert.equal(bad.field, 'reviewItems[0].choices')
  assert.equal((await run('lesson.get', { date: '2026-10-22' })).data.lesson, null)
  await run('lesson.save', lesson('2026-10-22', [word('cat', { id: 'same' }), word('cats', { id: 'same' }), word('CAT', { id: 'other' })]))
  const result = await run('review.list')
  assert.deepEqual(result.data.items.map(item => item.term), ['cat', 'cats'])
  assert.notEqual(result.data.items[0].id, result.data.items[1].id)
})

test('我的词汇全量搜索与分页独立于完整学习队列', async (t) => {
  const { run } = await fixture(t)
  await run('review.add', { items: Array.from({ length: 121 }, (_, i) => word(`entry-${String(i).padStart(3, '0')}`, i === 120 ? { meaning: '远处目标', choices: ['远处目标', '因此', '然而', '尽管'] } : {})) })
  const first = await run('vocabulary.query')
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.data.total, 121)
  assert.equal(first.data.page, 1)
  assert.equal(first.data.pageSize, 50)
  assert.equal(first.data.items.length, 50)
  const last = await run('vocabulary.query', { page: 99, pageSize: 20 })
  assert.equal(last.data.page, 7)
  assert.equal(last.data.items.length, 1)
  for (const search of ['ENTRY-120', '远处']) {
    const found = await run('vocabulary.query', { search, page: 3 })
    assert.equal(found.data.total, 1)
    assert.equal(found.data.page, 1)
    assert.equal(found.data.items[0].term, 'entry-120')
  }
  const empty = await run('vocabulary.query', { filter: 'mastered' })
  assert.equal(empty.data.total, 0)
  assert.equal(empty.data.page, 1)
  assert.equal(empty.data.pages, 1)
  assert.equal((await run('review.list')).data.items.length, 121)
  assert.equal((await run('review.queue')).data.dueCount, 121)
})

test('编辑目标保留旧画像未知字段，校验失败保留最终保存态', async t => {
  const { root, run } = await fixture(t)
  await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: ['研究'] })
  const file = join(root, 'profile.json')
  const stored = JSON.parse(await fs.readFile(file, 'utf8'))
  stored.profile.futurePreference = 'keep'
  stored.extension = true
  await fs.writeFile(file, JSON.stringify(stored))
  const saved = await run('profile.save', { goal: 'study', goalNote: '读论文', minutesPerDay: 45, interests: ['研究'] })
  assert.equal(saved.data.profile.futurePreference, 'keep')
  const before = await fs.readFile(file, 'utf8')
  assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 0 })).ok, false)
  assert.equal(await fs.readFile(file, 'utf8'), before)
  assert.equal(JSON.parse(before).extension, true)
})

test('语音偏好与书签独立保存，正文变更仅使本篇书签静默失效', async (t) => {
  const { root, run } = await fixture(t)
  await fs.writeFile(join(root, 'settings.json'), JSON.stringify({ version: 1, custom: true, audio: { provider: 'web-speech', extension: 7 }, study: { wordsPerDay: 12, future: 'keep' } }))
  const settings = await run('settings.save', { audio: { voiceURI: 'english-local', rate: 1.5 } })
  assert.equal(settings.data.audio.rate, 1.5)
  assert.equal(settings.data.audio.extension, 7)
  assert.equal(settings.data.study.wordsPerDay, 12)
  assert.equal((await run('settings.save', { audio: { rate: 0.8 } })).ok, false)
  await run('audio.bookmark.save', { materialId: 'a', contentFingerprint: 'version-a', position: 3 })
  await run('audio.bookmark.save', { materialId: 'b', contentFingerprint: 'version-b', position: 7 })
  assert.equal((await run('audio.bookmark.get', { materialId: 'a', contentFingerprint: 'version-a' })).data.bookmark.position, 3)
  const changed = await run('audio.bookmark.get', { materialId: 'a', contentFingerprint: 'changed' })
  assert.equal(changed.data.invalidated, true)
  assert.equal(changed.data.bookmark, null)
  assert.equal((await run('audio.bookmark.get', { materialId: 'b', contentFingerprint: 'version-b' })).data.bookmark.position, 7)
  assert.equal((await run('audio.bookmark.save', { materialId: 'b', contentFingerprint: 'version-b', position: -1 })).ok, false)
  const batch = await run('settings.save', { study: { wordsPerDay: 3 } })
  assert.equal(batch.data.audio.voiceURI, 'english-local')
  assert.equal(batch.data.study.future, 'keep')
  assert.equal(batch.data.custom, true)
})

test('真实主题库成员完整，浏览分页和保存偏好不把目录变为个人进度', async (t) => {
  const { run } = await fixture(t)
  const catalog = await run('wordlists.list')
  assert.equal(catalog.ok, true, JSON.stringify(catalog))
  assert.deepEqual(catalog.data.lists.map(list => [list.id, list.total]), [['cet4', 3849], ['cet6', 5805], ['ielts', 5040]])
  const first = await run('wordlists.query', { id: 'cet6' })
  assert.equal(first.data.items.length, 50)
  assert.equal(first.data.total, 5805)
  assert.ok(first.data.items.every(entry => entry.sourceTags.includes('cet4') || entry.sourceTags.includes('cet6')))
  assert.equal((await run('wordlists.query', { id: 'ielts', search: 'ZOO' })).data.items[0].term, 'zoo')
  const selected = await run('wordlists.select', { id: 'ielts' })
  assert.equal(selected.data.activeWordListId, 'ielts')
  assert.equal((await run('settings.get')).data.study.activeWordListId, 'ielts')
  assert.equal((await run('wordlists.select', { id: 'unknown' })).ok, false)
  assert.equal((await run('wordlists.list')).data.activeWordListId, 'ielts')
  assert.equal((await run('review.list')).data.total, 0)
  assert.equal((await run('wordlists.query', { id: 'ielts', filter: 'joined' })).data.total, 0)
  assert.equal((await run('wordlists.select', { id: null })).data.activeWordListId, null)
})

test('统一学习批次先旧词再当前库fresh，批量无每日上限且读取不改进度', async (t) => {
  const { root, run } = await fixture(t)
  const result = await run('review.add', { items: [word('other-new'), word('zoo'), word('overdue-one'), word('overdue-two'), word('overdue-three')] })
  for (const entry of result.data.added.slice(2)) await run('review.answer', { itemId: entry.id, choice: 0 })
  await run('settings.save', { study: { wordsPerDay: 3 } })
  await run('wordlists.select', { id: 'ielts' })
  const file = join(root, 'review/items.json')
  const before = await fs.readFile(file, 'utf8')
  const tomorrow = new Date('2026-10-23T09:00:00+08:00')
  const old = await run('study.batch', {}, tomorrow)
  assert.equal(old.ok, true, JSON.stringify(old))
  assert.deepEqual(old.data.items.map(item => item.term), ['overdue-one', 'overdue-three', 'overdue-two'])
  assert.equal(old.data.items.length, 3)
  assert.equal(await fs.readFile(file, 'utf8'), before)
  for (const entry of old.data.items) await run('review.answer', { itemId: entry.id, choice: 0 }, tomorrow)
  const fresh = await run('study.batch', {}, tomorrow)
  assert.deepEqual(fresh.data.items.map(item => item.term), ['zoo', 'other-new'])
  await run('wordlists.select', { id: null })
  assert.deepEqual((await run('study.batch', {}, tomorrow)).data.items.map(item => item.term), ['other-new', 'zoo'])
  assert.equal((await run('settings.get')).data.study.wordsPerDay, 3)
})

test('缺fresh字段且从未作答的历史词排在真实到期旧词之后，不迁移旧档', async t => {
  const { root, run } = await fixture(t)
  const added = await run('review.add', { items: [word('never-answered'), word('answered')] })
  await run('review.answer', { itemId: added.data.added[1].id, choice: 0 })
  const file = join(root, 'review/items.json')
  const review = JSON.parse(await fs.readFile(file, 'utf8'))
  delete review.items[0].fresh
  review.items[0].dueAt = '2026-10-01T00:00:00Z'
  await fs.writeFile(file, JSON.stringify(review))
  const before = await fs.readFile(file, 'utf8')
  const batch = await run('study.batch', {}, new Date('2026-10-23T09:00:00+08:00'))
  assert.deepEqual(batch.data.items.map(item => item.term), ['answered', 'never-answered'])
  assert.equal(batch.data.items[1].fresh, true)
  assert.equal(await fs.readFile(file, 'utf8'), before)
  const answer = await run('review.answer', { itemId: added.data.added[0].id, choice: 0 }, new Date('2026-10-23T09:00:00+08:00'))
  assert.equal(answer.data.box, 1)
})

test('静态补词只填缺额，固定顺序跨隔离重开一致，重试并发不重复入队', async (t) => {
  const a = await fixture(t), b = await fixture(t)
  for (const { run } of [a, b]) {
    await run('wordlists.select', { id: 'cet4' })
    await run('settings.save', { study: { wordsPerDay: 3 } })
  }
  const [first, retry] = await Promise.all([a.run('study.supplement'), a.run('study.supplement')])
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.data.addedCount, 3)
  assert.equal(retry.data.addedCount, 0)
  assert.equal((await a.run('review.list')).data.total, 3)
  assert.deepEqual(first.data.items.map(item => item.term), (await b.run('study.supplement')).data.items.map(item => item.term))
  for (const entry of first.data.items) await a.run('review.answer', { itemId: entry.id, choice: entry.answerIndex })
  const second = await a.run('study.supplement')
  assert.equal(second.data.addedCount, 3)
  assert.ok(second.data.items.every(item => !first.data.items.some(before => before.id === item.id)))
  assert.equal((await a.run('review.list')).data.total, 6)
  const preference = await a.run('study.preference')
  assert.equal(preference.data.activeWordList.id, 'cet4')
  assert.equal(preference.data.batchSize, 3)
  assert.ok(preference.data.candidates.length > 3)
  assert.ok(preference.data.candidates.length <= 60)
})

test('用尽区分未备题、全部加入仍在学、全部掌握且不隐式换源', async (t) => {
  const { root, run } = await fixture(t)
  await run('wordlists.select', { id: 'cet4' })
  const entries = []
  for (let page = 1; ; page++) {
    const result = await run('wordlists.query', { id: 'cet4', page })
    entries.push(...result.data.items)
    if (page >= result.data.pages) break
  }
  const synthetic = entry => ({ id: entry.id, term: entry.term, meaning: '合成历史释义', choices: ['合成历史释义', '因此', '然而', '尽管'], answerIndex: 0, status: 'learning', box: 2, fresh: false, dueAt: '2099-01-01T00:00:00Z', answers: [{ correct: true, at: now.toISOString() }] })
  const path = join(root, 'review/items.json')
  await fs.mkdir(join(root, 'review'), { recursive: true })
  await fs.writeFile(path, JSON.stringify({ version: 1, items: entries.filter(e => e.practice.status === 'ready').map(synthetic) }))
  let result = await run('study.supplement')
  assert.equal(result.data.exhaustion, 'unavailable')
  assert.equal(result.data.addedCount, 0)
  await fs.writeFile(path, JSON.stringify({ version: 1, items: entries.map(synthetic) }))
  result = await run('study.supplement')
  assert.equal(result.data.exhaustion, 'all_joined')
  await fs.writeFile(path, JSON.stringify({ version: 1, items: entries.map(e => ({ ...synthetic(e), status: 'mastered', box: 4 })) }))
  result = await run('study.supplement')
  assert.equal(result.data.exhaustion, 'all_mastered')
  assert.equal(result.data.activeWordListId, 'cet4')
  assert.equal(result.data.shortfall, 10)
  assert.equal((await run('settings.get')).data.study.activeWordListId, 'cet4')
})
