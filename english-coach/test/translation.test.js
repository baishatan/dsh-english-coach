import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'

const now = new Date('2026-10-26T09:00:00+08:00')
const date = '2026-10-26'
async function fixture(t) {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-translation-'))
  t.after(async () => {
    assert.equal(dirname(root), temporary, 'Remove only this test’s isolated learner root')
    assert.ok(root.split('/').at(-1).startsWith('coach-translation-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, run: (command, payload = {}) => execute(root, command, payload, { now }) }
}
function lesson() {
  return {
    date, title: '合成段落译文课程',
    sources: [{ id: 'source', url: 'https://example.com/synthetic-translation', fetchedAt: now.toISOString(), license: 'Synthetic test fixture' }],
    items: [
      { id: 'read', type: 'reading', sourceId: 'source', body: 'First paragraph.\n\nSecond paragraph.' },
      { id: 'listen', type: 'listening', sourceId: 'source', transcript: 'Listen first.\n\nListen second.' },
      { id: 'express', type: 'expressions', expressions: [{ term: 'synthetic expression', meaning: '合成表达' }] },
      { id: 'quiz', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['甲', '乙', '丙', '丁'], answerIndex: 0 }] }
    ],
    reviewItems: [{ term: 'synthetic', meaning: '合成的', choices: ['合成的', '自然的', '过去的', '未来的'], answerIndex: 0 }]
  }
}

test('阅读和听力逐段译文通过课程提交保存并按原顺序读回', async t => {
  const { run } = await fixture(t)
  const payload = lesson()
  payload.items[0].translations = ['第一段。', '第二段。']
  payload.items[1].translations = ['先听。', '再听。']
  const result = await run('lesson.save', payload)
  assert.equal(result.ok, true, JSON.stringify(result))
  const saved = (await run('lesson.get', { date })).data.lesson
  assert.deepEqual(saved.items[0].translations, ['第一段。', '第二段。'])
  assert.deepEqual(saved.items[1].translations, ['先听。', '再听。'])
  assert.equal(saved.items[0].body, 'First paragraph.\n\nSecond paragraph.')
  assert.equal(saved.items[1].transcript, 'Listen first.\n\nListen second.')
  const state = (await run('state.get')).data.todayLesson
  assert.deepEqual(state.items[0].translations, ['第一段。', '第二段。'])
})

test('译文元素拒绝空白或非字符串并报告精确位置', async t => {
  const { run } = await fixture(t)
  for (const translations of [['第一段。', ' \t\n '], ['第一段。', 42], ['第一段。', null]]) {
    const payload = lesson()
    payload.items[1].translations = translations
    const result = await run('lesson.save', payload)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid_field')
    assert.equal(result.field, 'items[1].translations[1]')
  }
})

test('段落匹配兼容CRLF、单CR、空白行和段内换行且不改英文', async t => {
  const { run } = await fixture(t)
  const payload = lesson()
  payload.items[0].body = 'First line.\r\nSecond line.\r\n \t\r\n\r\nLast paragraph.'
  payload.items[0].translations = [' 第一段：保留段内换行。 ', '最后一段。']
  payload.items[1].transcript = 'Listen first.\r\t \r\rListen last.'
  payload.items[1].translations = ['听第一段。', '听最后一段。']
  assert.equal((await run('lesson.save', payload)).ok, true)
  const saved = (await run('lesson.get', { date })).data.lesson
  assert.equal(saved.items[0].body, payload.items[0].body)
  assert.equal(saved.items[1].transcript, payload.items[1].transcript)
  assert.deepEqual(saved.items[0].translations, ['第一段：保留段内换行。', '最后一段。'])
  assert.deepEqual(saved.items[1].translations, ['听第一段。', '听最后一段。'])
})

test('单换行仍属同段，前后与重复空白行不产生译文槽', async t => {
  const { run } = await fixture(t)
  const payload = lesson()
  payload.items[0].body = '\n \t\nFirst line.\nSecond line.\n\n \t\n'
  payload.items[0].translations = ['只有一段的译文。']
  payload.items[1].transcript = '\r\n\t\r\nFirst.\r\n\r\n\r\nSecond.\r\n \r\n'
  payload.items[1].translations = ['第一段。', '第二段。']
  assert.equal((await run('lesson.save', payload)).ok, true)
  const saved = (await run('lesson.get', { date })).data.lesson
  assert.equal(saved.items[0].body, 'First line.\nSecond line.')
  assert.equal(saved.items[1].transcript, 'First.\r\n\r\n\r\nSecond.')
  assert.deepEqual(saved.items[0].translations, ['只有一段的译文。'])
  assert.deepEqual(saved.items[1].translations, ['第一段。', '第二段。'])
})

test('译文字段容器与数量无效时拒绝整课，不静默吞译文', async t => {
  const { run } = await fixture(t)
  for (const translations of [null, '一整篇译文', {}, [], ['只有一段。'], ['一。', '二。', '多余。']]) {
    const payload = lesson()
    payload.items[0].translations = translations
    const result = await run('lesson.save', payload)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'invalid_field')
    assert.equal(result.field, 'items[0].translations')
  }
})

test('旧课省略译文仍可读写，不伪造字段或自动重做课程', async t => {
  const { root, run } = await fixture(t)
  assert.equal((await run('lesson.save', lesson())).ok, true)
  const jsonFile = join(root, 'lessons', `${date}.json`)
  const before = await fs.readFile(jsonFile, 'utf8')
  const first = (await run('lesson.get', { date })).data.lesson
  const second = (await run('state.get')).data.todayLesson
  for (const saved of [first, second]) {
    assert.ok(!Object.hasOwn(saved.items[0], 'translations'))
    assert.ok(!Object.hasOwn(saved.items[1], 'translations'))
  }
  assert.equal(await fs.readFile(jsonFile, 'utf8'), before)
  assert.ok(!(await fs.readFile(join(root, 'lessons', `${date}.md`), 'utf8')).includes('中文译文'))
})

test('坏译文拒绝后课程JSON、Markdown、来源与复习最终状态均不变', async t => {
  const { root, run } = await fixture(t)
  const payload = lesson()
  payload.items[0].translations = ['第一段。', '第二段。']
  assert.equal((await run('lesson.save', payload)).ok, true)
  const files = [`lessons/${date}.json`, `lessons/${date}.md`, 'sources/provenance.jsonl', 'review/items.json']
  const before = await Promise.all(files.map(file => fs.readFile(join(root, file), 'utf8')))
  const invalid = lesson()
  invalid.items[1].translations = ['译文不完整。']
  const result = await run('lesson.save', invalid)
  assert.equal(result.ok, false)
  assert.equal(result.field, 'items[1].translations')
  assert.deepEqual(await Promise.all(files.map(file => fs.readFile(join(root, file), 'utf8'))), before)
})

test('逐段译文出错的新课不产生课程、来源或复习文件', async t => {
  const { root, run } = await fixture(t)
  const payload = lesson()
  payload.items[0].translations = ['第一段。', '']
  assert.equal((await run('lesson.save', payload)).ok, false)
  assert.deepEqual(await fs.readdir(root), [])
})

test('已完成旧课显式补入译文仍保留完成记录和原英文', async t => {
  const { run } = await fixture(t)
  const payload = lesson()
  assert.equal((await run('lesson.save', payload)).ok, true)
  for (const itemId of ['read', 'listen', 'express', 'quiz']) await run('lesson.completeItem', { date, itemId })
  const before = (await run('lesson.get', { date })).data.lesson
  payload.items[0].translations = ['第一段。', '第二段。']
  payload.items[1].translations = ['先听。', '再听。']
  assert.equal((await run('lesson.save', payload)).ok, true)
  const after = (await run('lesson.get', { date })).data.lesson
  assert.equal(after.status, 'done')
  assert.deepEqual(after.items.map(item => [item.id, item.done, item.doneAt]), before.items.map(item => [item.id, item.done, item.doneAt]))
  assert.equal(after.startedAt, before.startedAt)
  assert.equal(after.finishedAt, before.finishedAt)
  assert.equal(after.items[0].body, before.items[0].body)
})

test('Markdown导出保留完整英文并在其后以默认收起译文块提供逐段对照', async t => {
  const { root, run } = await fixture(t)
  const payload = lesson()
  payload.items[0].translations = ['第一段。', '第二段。']
  assert.equal((await run('lesson.save', payload)).ok, true)
  const markdown = await fs.readFile(join(root, 'lessons', `${date}.md`), 'utf8')
  assert.ok(markdown.includes('First paragraph.\n\nSecond paragraph.'))
  assert.match(markdown, /<details>\n<summary>中文译文（逐段对照）<\/summary>/)
  assert.ok(markdown.indexOf('1. 第一段。') > markdown.indexOf('Second paragraph.'))
  assert.ok(markdown.indexOf('2. 第二段。') > markdown.indexOf('1. 第一段。'))
  assert.ok(!markdown.includes('<details open'))
})

test('译文数量必须与忽略空段后的英文段落一对一', async t => {
  const { run } = await fixture(t)
  const payload = lesson()
  payload.items[0].translations = ['缺少第二段译文。']
  const result = await run('lesson.save', payload)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'invalid_field')
  assert.equal(result.field, 'items[0].translations')
})
