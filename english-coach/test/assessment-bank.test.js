import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { tempFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T01:00:00.000Z')
const run = (root, command, payload) => execute(root, command, payload, { now })

async function rootFor(t) {
  return tempFixture(t, 'english-coach-bank-')
}

async function rejected(t, payload, { code = 'invalid_field', field = 'items' } = {}) {
  const root = await rootFor(t)
  const result = await run(root, 'assessment.saveBank', payload)
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal(result.code, code, JSON.stringify(result))
  assert.equal(result.field, field)
  assert.match(result.message, /重新准备/)
  assert.equal((await run(root, 'assessment.resume')).data, null, 'a rejected bank cannot leave a resumable attempt')
  await assert.rejects(fs.access(join(root, 'assessments', `bank-${payload.version}.json`)), { code: 'ENOENT' })
}

test('重新准备后采用最新成功提交的库，不由version字典序或失败提交决定', async t => {
  const root = await rootFor(t)
  const previous = assessmentBank('z-old')
  assert.equal((await run(root, 'assessment.saveBank', previous)).ok, true)
  const oldFile = join(root, 'assessments', 'bank-z-old.json')
  const damaged = JSON.parse(await fs.readFile(oldFile, 'utf8'))
  damaged.items[0].passage = 'An old article.'
  const original = JSON.stringify(damaged)
  await fs.writeFile(oldFile, original)
  assert.equal((await run(root, 'assessment.start', { kind: 'short' })).ok, false)

  const prepared = assessmentBank('a-current')
  prepared.items[8].prompt = 'The newly prepared question ___ here.'
  assert.equal((await run(root, 'assessment.saveBank', prepared)).ok, true)
  const failed = assessmentBank('zz-rejected')
  failed.items[0].skill = 'reading'
  assert.equal((await run(root, 'assessment.saveBank', failed)).ok, false)
  const started = await run(root, 'assessment.start', { kind: 'short' })
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.equal(started.data.question.prompt, prepared.items[8].prompt)
  assert.equal(await fs.readFile(oldFile, 'utf8'), original, 'a successful replacement keeps the old bank intact')
})

test('没有或损坏题库时开测提示重新准备，不创建可恢复测评', async t => {
  for (const content of [null, '{broken json', '{}', '{"items":{}}']) {
    const root = await rootFor(t)
    if (content !== null) {
      await fs.mkdir(join(root, 'assessments'), { recursive: true })
      await fs.writeFile(join(root, 'assessments', 'bank-broken.json'), content)
    }
    const started = await run(root, 'assessment.start', { kind: 'short' })
    assert.equal(started.ok, false, JSON.stringify(started))
    assert.match(started.message, /重新准备/)
    assert.match(started.message, /24|损坏|读/)
    assert.equal((await run(root, 'assessment.resume')).data, null)
  }
})

test('开测重新执行提交准入，旧库不能绕过且失败不改学习事实或留下半场', async t => {
  const invalidBanks = [
    payload => { payload.items.pop() },
    payload => { payload.items[0].difficulty = 2 },
    payload => { payload.items.forEach(item => { item.skill = 'grammar' }) },
    payload => { payload.items[0].skill = 'reading' },
    payload => { payload.items[0].prompt = '' },
    payload => { payload.items[0].choices[0] = ' ' },
    payload => { payload.items[0].choices = ['a', 'b', 'c'] },
    payload => { payload.items[0].prompt = 'word '.repeat(31) },
    payload => { payload.items[0].choices[0] = 'word '.repeat(13) },
    payload => { payload.items[0].passage = 'An old article.' },
    payload => { payload.items[0].prompt = 'A story begins. Which word fits?' },
    payload => { payload.items[0].id = 'anchor-01' },
    payload => { payload.items[0].id = payload.items[1].id },
    payload => { payload.items[0].answerIndex = null },
    payload => { payload.items[0] = null }
  ]
  for (const invalidate of invalidBanks) {
    const root = await rootFor(t)
    assert.equal((await run(root, 'profile.save', { goal: 'study', minutesPerDay: 20 })).ok, true)
    assert.equal((await run(root, 'review.add', { items: [{ term: 'preserve', meaning: '保留', choices: ['保留', '放弃', '删除', '重写'], answerIndex: 0 }] })).ok, true)
    const progress = (await run(root, 'progress.get')).data
    const review = (await run(root, 'review.list')).data
    const payload = assessmentBank('old-bank')
    invalidate(payload)
    const submission = await run(root, 'assessment.saveBank', payload)
    assert.equal(submission.ok, false)
    await fs.mkdir(join(root, 'assessments'), { recursive: true })
    const bankFile = join(root, 'assessments', 'bank-old-bank.json')
    const original = JSON.stringify(payload)
    await fs.writeFile(bankFile, original)
    const started = await run(root, 'assessment.start', { kind: 'full' })
    assert.equal(started.ok, false, JSON.stringify(started))
    assert.equal(started.code, submission.code)
    assert.equal(started.field, submission.field)
    assert.match(started.message, /重新准备/)
    assert.equal((await run(root, 'assessment.resume')).data, null)
    assert.deepEqual((await run(root, 'progress.get')).data, progress)
    assert.deepEqual((await run(root, 'review.list')).data, review)
    assert.deepEqual(await fs.readdir(join(root, 'assessments')), ['bank-old-bank.json'])
    assert.equal(await fs.readFile(bankFile, 'utf8'), original, 'admission never truncates or repairs an invalid bank')
  }
})

test('合法句子选择、引号内标点与常见缩写不会被当作文章拒绝', async t => {
  const examples = [
    ['Which sentence correctly uses "Stop!"?', ['"Stop!" is an exclamation.', '"Stop!" are an exclamation.', '"Stop!" be an exclamation.', '"Stop!" were an exclamation.']],
    ['Which sentence correctly uses “Don’t!”?', ['She said “Don’t!” loudly.', 'She say “Don’t!” loudly.', 'She saying “Don’t!” loudly.', 'She have said “Don’t!” loudly.']],
    ["Which sentence correctly uses 'e.g.'?", ['Fruit, e.g. apples, is healthy.', 'Fruit, e.g. apples, are healthy.', 'Fruit, e.g. apples, be healthy.', 'Fruit, e.g. apples, were healthy.']],
    ['Which sentence is correct?', ['"She does not like coffee."', '"She do not like coffee."', '"She not likes coffee."', '"She does not likes coffee."']],
    ['She likes to listen to music ___ working.', ['while', 'despite', 'unless', 'although']]
  ]
  for (const [prompt, choices] of examples) {
    const root = await rootFor(t)
    const payload = assessmentBank()
    Object.assign(payload.items[8], { prompt, choices })
    const saved = await run(root, 'assessment.saveBank', payload)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    const started = await run(root, 'assessment.start', { kind: 'short' })
    assert.equal(started.ok, true, JSON.stringify(started))
    assert.equal(started.data.question.prompt, prompt)
    assert.deepEqual(started.data.question.choices, choices)
  }
  const hiddenArticle = assessmentBank()
  hiddenArticle.items[0].prompt = 'Read "Maya left early. She missed the bus." and choose a word.'
  await rejected(t, hiddenArticle, { field: 'items[0].prompt' })
})

test('不能把文章、多轮对话、音频或外部材料藏进短题题干', async t => {
  const prompts = [
    'Maya left early. Why did she leave?',
    'First read the notice! Which word fits?',
    'The notice is on the door\n\nWhich word is missing?',
    'Tom: Are you ready?\nAmy: Yes\nTom: Which word fits?',
    'A: hello; B: goodbye; choose a reply',
    'Listen to the audio and choose the correct word.',
    'According to the passage, which word describes the writer?',
    'Look at the image and choose the missing word.',
    'Read the article at https://example.com and choose a word.'
  ]
  for (const prompt of prompts) {
    const payload = assessmentBank()
    payload.items[0].prompt = prompt
    await rejected(t, payload, { field: 'items[0].prompt' })
  }
  const payload = assessmentBank()
  payload.items[0].choices[0] = 'She went home. She slept.'
  await rejected(t, payload, { field: 'items[0].choices[0]' })

  const root = await rootFor(t)
  const valid = assessmentBank()
  valid.items[8].prompt = "Dr. Chen's U.S. team hasn’t ___ the state-of-the-art microphone yet."
  valid.items[8].choices = ['tested', 'testing', 'test', 'tests']
  assert.equal((await run(root, 'assessment.saveBank', valid)).ok, true)
  assert.equal((await run(root, 'assessment.start', { kind: 'short' })).data.question.prompt, valid.items[8].prompt)
})

test('非空passage在提交时拒绝，空白passage不要求额外材料', async t => {
  for (const passage of ['A short article.', ' \nA paragraph.\n ', true, 7, {}]) {
    const payload = assessmentBank()
    payload.items[0].passage = passage
    await rejected(t, payload, { field: 'items[0].passage' })
  }
  const root = await rootFor(t)
  const payload = assessmentBank()
  payload.items.forEach(item => { item.passage = ' \t ' })
  assert.equal((await run(root, 'assessment.saveBank', payload)).ok, true)
  assert.equal((await run(root, 'assessment.start', { kind: 'short' })).data.question.passage, '')
})

test('题干30词与选项12词可原样使用，缩写算一词且填空不计词', async t => {
  const prompt = "Although we don't know why the experienced editor rejected her proposal yesterday she still hopes that a revised version will receive a fair review from the committee next Monday morning ___."
  const choice = 'The U.S. team will review our carefully revised proposal next Monday morning'
  const payload = assessmentBank()
  payload.items[8].prompt = prompt
  payload.items[8].choices[0] = choice
  const root = await rootFor(t)
  assert.equal((await run(root, 'assessment.saveBank', payload)).ok, true)
  const started = await run(root, 'assessment.start', { kind: 'short' })
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.equal(started.data.question.prompt, prompt)
  assert.equal(started.data.question.choices[0], choice)

  payload.items[8].prompt = prompt.replace('morning', 'early morning')
  await rejected(t, payload, { field: 'items[8].prompt' })
  payload.items[8].prompt = prompt
  payload.items[8].choices[0] = `${choice} again`
  await rejected(t, payload, { field: 'items[8].choices[0]' })
})

test('稀疏题库的空槽不能算作普通题，也不能落盘为null', async t => {
  const payload = assessmentBank()
  payload.items.length = 25
  await rejected(t, payload, { field: 'items[24]' })
})

test('题干和四个选项必须是非空字符串且选项不能重复', async t => {
  for (const prompt of [undefined, null, '', ' \t ', 12, true, {}]) {
    const payload = assessmentBank()
    payload.items[0].prompt = prompt
    await rejected(t, payload, { field: 'items[0].prompt' })
  }
  for (const choices of [undefined, null, [], ['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e']]) {
    const payload = assessmentBank()
    payload.items[0].choices = choices
    await rejected(t, payload, { field: 'items[0].choices' })
  }
  for (const choice of [undefined, null, '', ' \t ', 12, true, {}]) {
    const payload = assessmentBank()
    payload.items[0].choices[2] = choice
    await rejected(t, payload, { field: 'items[0].choices[2]' })
  }
  const payload = assessmentBank()
  payload.items[0].choices = ['Go home', ' go   HOME ', 'stay here', 'wait outside']
  await rejected(t, payload, { field: 'items[0].choices' })
})

test('普通题ID必填、池内唯一且不能冒用冻结锚题身份', async t => {
  for (const id of [undefined, null, '', '  ', 12, true, 'anchor-01', 'anchor-12']) {
    const payload = assessmentBank()
    payload.items[0].id = id
    await rejected(t, payload, { field: 'items[0].id' })
  }
  const payload = assessmentBank()
  payload.items[1].id = payload.items[0].id
  await rejected(t, payload, { code: 'duplicate_item' })
})

test('每题只接受grammar/vocab和严格整数难度及答案下标', async t => {
  const invalid = [
    ['skill', [undefined, '', 'reading', 'listening', 'inference', 'general', true]],
    ['difficulty', [undefined, null, '', ' ', true, false, '3', 0, 7, 2.5]],
    ['answerIndex', [undefined, null, '', ' ', true, false, '0', -1, 4, 1.5]]
  ]
  for (const [field, values] of invalid) {
    for (const value of values) {
      const payload = assessmentBank()
      payload.items[0][field] = value
      await rejected(t, payload, { field: `items[0].${field}` })
    }
  }
})

test('六档各至少4题且全库两类覆盖，不要求每档比例', async t => {
  for (let difficulty = 1; difficulty <= 6; difficulty++) {
    const payload = assessmentBank()
    payload.items.find(item => item.difficulty === difficulty).difficulty = difficulty === 6 ? 1 : difficulty + 1
    await rejected(t, payload, { code: 'bank_difficulty_coverage' })
  }
  for (const skill of ['grammar', 'vocab']) {
    const payload = assessmentBank()
    payload.items.forEach(item => { item.skill = skill })
    await rejected(t, payload, { code: 'bank_skill_coverage' })
  }
  const root = await rootFor(t)
  const payload = assessmentBank()
  payload.items.forEach(item => { item.skill = item.difficulty === 1 ? 'vocab' : 'grammar' })
  payload.items.push({ ...payload.items[0], id: 'extra-vocab' })
  const saved = await run(root, 'assessment.saveBank', payload)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(saved.data.count, 25)
})

test('普通题库少于24题时提交被拒绝，24题可开始full和short', async t => {
  const undersized = assessmentBank()
  undersized.items.pop()
  await rejected(t, undersized, { code: 'bank_too_small' })

  for (const kind of ['full', 'short']) {
    const root = await rootFor(t)
    const payload = assessmentBank()
    const saved = await run(root, 'assessment.saveBank', payload)
    assert.equal(saved.ok, true, JSON.stringify(saved))
    assert.equal(saved.data.count, 24)
    const started = await run(root, 'assessment.start', { kind })
    assert.equal(started.ok, true, JSON.stringify(started))
    assert.equal(started.data.total, kind === 'full' ? 20 : 10)
    assert.equal(started.data.progress, 0)
    const item = payload.items.find(candidate => candidate.id === started.data.question.id)
    assert.equal(started.data.question.prompt, item.prompt)
    assert.deepEqual(started.data.question.choices, item.choices)
    assert.equal(started.data.question.passage, '')
  }
})
