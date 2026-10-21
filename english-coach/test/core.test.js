import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ANCHOR_HASH, ANCHOR_POOL } from '../core/anchors.js'
import { execute } from '../core/index.js'

// ------------------------------------------------------------------ fixtures

async function makeRoot() {
  return await fs.mkdtemp(join(tmpdir(), 'english-coach-test-'))
}

function at(dateText, hour = 9) {
  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(year, month - 1, day, hour, 0, 0)
}

function plusDays(date, days) {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next
}

function run(root, command, payload, now) {
  return execute(root, command, payload, { now })
}

function source(overrides = {}) {
  return {
    id: 'src-1',
    kind: 'reading',
    url: 'https://example.com/article-one',
    title: 'An article',
    fetchedAt: '2026-10-20T08:00:00.000Z',
    license: '公开网页，仅作学习引用，原文版权归原作者',
    ...overrides
  }
}

function lessonPayload(date = '2026-10-20', overrides = {}) {
  return {
    date,
    title: '今日一课',
    summary: '',
    sources: [source()],
    items: [
      { id: 'item-reading', type: 'reading', title: '读一段', sourceId: 'src-1', body: 'Hello world.' },
      { id: 'item-listening', type: 'listening', title: '听一段', sourceId: 'src-1', transcript: 'Hello there.' },
      {
        id: 'item-expressions',
        type: 'expressions',
        title: '记表达',
        expressions: [{ term: 'in fact', meaning: '事实上', example: 'In fact, it worked.' }]
      },
      {
        id: 'item-quiz',
        type: 'quiz',
        title: '做两道',
        questions: [
          {
            id: 'q1',
            prompt: 'Pick the right one.',
            choices: ['a', 'b', 'c', 'd'],
            answerIndex: 1,
            explanation: 'b 是对的'
          }
        ]
      }
    ],
    reviewItems: [
      {
        id: 'rv-1',
        term: 'in fact',
        kind: 'expression',
        meaning: '事实上',
        choices: ['事实上', '因此', '然而', '尽管'],
        answerIndex: 0,
        explanation: 'in fact 是插入语，表示"事实上"。'
      }
    ],
    cards: [
      {
        id: 'fc-1',
        kind: 'review',
        front: 'in fact',
        back: '事实上',
        explanation: '插入语。',
        choices: ['事实上', '因此', '然而', '尽管'],
        answerIndex: 0
      }
    ],
    ...overrides
  }
}

function bank(count = 24) {
  const items = []
  for (let index = 0; index < count; index += 1) {
    items.push({
      id: `q-${index + 1}`,
      difficulty: (index % 6) + 1,
      skill: ['grammar', 'vocab', 'reading'][index % 3],
      prompt: `Question ${index + 1}: pick one.`,
      choices: ['alpha', 'beta', 'gamma', 'delta'],
      answerIndex: index % 4,
      explanation: 'this one is right'
    })
  }
  return { version: 'fixture-1', items }
}

function answerIndexFor(id) {
  const fromBank = bank().items.find((item) => item.id === id)
  if (fromBank) return fromBank.answerIndex
  const anchor = ANCHOR_POOL.find((item) => item.id === id)
  return anchor ? anchor.answerIndex : 0
}

/** Run one assessment start-to-finish; `decide` chooses the answer per item. */
async function fullAssessment(root, now, { kind = 'short', decide } = {}) {
  let response = await run(root, 'assessment.start', { kind }, now)
  assert.equal(response.ok, true, JSON.stringify(response))
  const attemptId = response.data.attemptId
  const chosen = decide ?? ((id) => answerIndexFor(id))

  while (!response.data.done) {
    const question = response.data.question
    assert.ok(question, 'every step must offer a question until done')
    response = await run(
      root,
      'assessment.answer',
      { attemptId, itemId: question.id, choice: chosen(question.id) },
      now
    )
    assert.equal(response.ok, true, JSON.stringify(response))
  }
  return { attemptId, result: response.data.result }
}

// --------------------------------------------------------------------- tests

test('同一日期提交两次，最终只有一课，内容是第二次的', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')

  const first = await run(root, 'lesson.save', lessonPayload('2026-10-20', { title: '第一版' }), now)
  assert.equal(first.ok, true, JSON.stringify(first))
  const second = await run(root, 'lesson.save', lessonPayload('2026-10-20', { title: '第二版' }), now)
  assert.equal(second.ok, true, JSON.stringify(second))

  const files = await fs.readdir(join(root, 'lessons'))
  assert.deepEqual(files.filter((name) => name.endsWith('.json')), ['2026-10-20.json'])

  const stored = await run(root, 'lesson.get', { date: '2026-10-20' }, now)
  assert.equal(stored.data.lesson.title, '第二版')
  // 复习项按 id 去重，不因为重复提交而翻倍
  const queue = await run(root, 'review.queue', {}, now)
  assert.equal(queue.data.total, 1)
})

test('补充词当天就能学，第一次作答只排下一次复习', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), day0)

  const added = await run(
    root,
    'review.add',
    {
      items: [
        {
          term: 'put a strain on',
          meaning: '给……带来压力',
          choices: ['给……带来压力', '彻底解决', '视而不见', '推迟到以后'],
          answerIndex: 0,
          explanation: 'strain 是负担'
        },
        {
          term: 'reprieve',
          meaning: '暂时的缓解',
          choices: ['暂时的缓解', '主要流程', '性能问题', '安全漏洞'],
          answerIndex: 0
        }
      ]
    },
    day0
  )
  assert.equal(added.data.addedCount, 2)
  assert.equal(added.data.added[0].fresh, true)
  assert.equal(added.data.added[0].kind, 'expression')
  assert.equal(added.data.added[1].kind, 'word')

  const list = await run(root, 'review.list', {}, day0)
  assert.equal(list.data.dueCount, 2, '补充词立刻到期')

  const answered = await run(root, 'review.answer', { itemId: added.data.added[0].id, choice: 0 }, day0)
  assert.equal(answered.data.correct, true)
  assert.equal(answered.data.box, 1, '第一次是认识，不是复习，不该推盒子')
  assert.equal(answered.data.dueAt, plusDays(day0, 1).toISOString())

  const after = await run(root, 'review.list', {}, day0)
  const item = after.data.items.find((entry) => entry.term === 'put a strain on')
  assert.equal(item.fresh, false)
  assert.equal(item.due, false)
  assert.equal(item.answerCount, 1)

  // 第二次到期后再答对，才回到 1 / 7 / 30 的正常推进
  const day1 = plusDays(day0, 1)
  const second = await run(root, 'review.answer', { itemId: item.id, choice: 0 }, day1)
  assert.equal(second.data.box, 2)
  assert.equal(second.data.dueAt, plusDays(day1, 7).toISOString())
})

test('补充词去重，选项不合法时报字段', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')

  const first = await run(
    root,
    'review.add',
    {
      items: [
        {
          term: 'pan out',
          meaning: '如预期发展',
          choices: ['如预期发展', '突然取消', '反复确认', '公开宣布'],
          answerIndex: 0
        }
      ]
    },
    day0
  )
  assert.equal(first.data.addedCount, 1)

  const again = await run(
    root,
    'review.add',
    {
      items: [
        {
          term: 'Pan Out',
          meaning: '如预期发展',
          choices: ['如预期发展', '突然取消', '反复确认', '公开宣布'],
          answerIndex: 0
        }
      ]
    },
    day0
  )
  assert.equal(again.data.addedCount, 0)
  assert.equal(again.data.skipped[0].reason, 'duplicate')

  const bad = await run(
    root,
    'review.add',
    {
      items: [
        {
          term: 'reprieve',
          meaning: '暂时的缓解',
          choices: ['暂时的缓解', '严厉批评', '永久禁止'],
          answerIndex: 0
        }
      ]
    },
    day0
  )
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'invalid_field')
  assert.equal(bad.field, 'items[0].choices')
})

test('每天学几个词可配置，旧设置文件补齐新字段', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')

  const initial = await run(root, 'settings.get', {}, day0)
  assert.equal(initial.data.study.wordsPerDay, 10)

  const saved = await run(root, 'settings.save', { study: { wordsPerDay: 12 } }, day0)
  assert.equal(saved.data.study.wordsPerDay, 12)

  const bad = await run(root, 'settings.save', { study: { wordsPerDay: 2 } }, day0)
  assert.equal(bad.ok, false)
  assert.equal(bad.field, 'study.wordsPerDay')

  // 早先写下的设置文件没有 study 字段，读取时要补上默认值
  await fs.writeFile(
    join(root, 'settings.json'),
    JSON.stringify({ version: 1, audio: { provider: 'web-speech' } })
  )
  const legacy = await run(root, 'settings.get', {}, day0)
  assert.equal(legacy.data.study.wordsPerDay, 10)
  assert.equal(legacy.data.automation.enabled, false)
})

test('词库给出全部词、到期标记和下一次到期', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')

  await run(root, 'lesson.save', lessonPayload('2026-10-20'), day0)

  const before = await run(root, 'review.list', {}, day0)
  assert.equal(before.data.total, 1)
  assert.equal(before.data.dueCount, 0, '新项不当天到期')
  assert.equal(before.data.items[0].due, false)
  assert.equal(before.data.nextDueAt, plusDays(day0, 1).toISOString())
  assert.equal(before.data.nextDueCount, 1)

  const day1 = plusDays(day0, 1)
  const due = await run(root, 'review.list', {}, day1)
  assert.equal(due.data.dueCount, 1)
  assert.equal(due.data.items[0].due, true)
  assert.equal(due.data.nextDueAt, null)

  await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day1)
  const after = await run(root, 'review.list', {}, day1)
  assert.equal(after.data.dueCount, 0)
  assert.equal(after.data.items[0].due, false)
  assert.equal(after.data.items[0].box, 2)
  assert.equal(after.data.items[0].sourceLesson, '2026-10-20')
  assert.equal(after.data.nextDueAt, plusDays(day0, 8).toISOString())
  assert.equal(after.data.nextDueCount, 1)
})

test('到期按自然日算：隔天一早就能复习，不必等上次作答的钟点', async () => {
  const root = await makeRoot()
  // 上午 11 点存的词，1 天后到期 = 第二天 11:46 左右
  const day0 = at('2026-10-20', 11)
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), day0)

  // 第二天早上 8 点，早于昨天的作答钟点，但已经是新的一天
  const nextMorning = at('2026-10-21', 8)
  const list = await run(root, 'review.list', {}, nextMorning)
  assert.equal(list.data.dueCount, 1, '新的一天就应该到期')
  assert.equal(list.data.items[0].due, true)
  assert.equal(list.data.nextDueAt, null)

  // 列表说到期，答题就不能再以 not_due 拒绝
  const answered = await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, nextMorning)
  assert.equal(answered.ok, true, JSON.stringify(answered))
  assert.equal(answered.data.box, 2)
  assert.equal(answered.data.dueCount, 0)
})

test('复习项在 1 / 7 / 30 天各答对一次后变为掌握', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')

  await run(root, 'lesson.save', lessonPayload('2026-10-20'), day0)

  const day1 = plusDays(day0, 1)
  const due1 = await run(root, 'review.queue', {}, day1)
  assert.equal(due1.data.dueCount, 1, '新项应在 1 天后到期')
  const answer1 = await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day1)
  assert.equal(answer1.data.correct, true)
  assert.equal(answer1.data.box, 2)
  assert.equal(answer1.data.status, 'learning')

  const day8 = plusDays(day0, 8)
  assert.equal((await run(root, 'review.queue', {}, day8)).data.dueCount, 1)
  const answer2 = await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day8)
  assert.equal(answer2.data.box, 3)

  const day38 = plusDays(day0, 38)
  assert.equal((await run(root, 'review.queue', {}, day38)).data.dueCount, 1)
  const answer3 = await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day38)
  assert.equal(answer3.data.box, 4)
  assert.equal(answer3.data.status, 'mastered')
  assert.equal(answer3.data.mastered, 1)

  // 掌握后进入 90 天抽检
  const progress = await run(root, 'progress.get', {}, day38)
  assert.equal(progress.data.mastered, 1)
  assert.equal((await run(root, 'review.queue', {}, plusDays(day38, 89))).data.dueCount, 0)
  assert.equal((await run(root, 'review.queue', {}, plusDays(day38, 90))).data.dueCount, 1)

  // 抽检答错退回 30 天盒
  const failed = await run(
    root,
    'review.answer',
    { itemId: 'rv-1', choice: 2 },
    plusDays(day38, 90)
  )
  assert.equal(failed.data.correct, false)
  assert.equal(failed.data.box, 3)
  assert.equal(failed.data.status, 'learning')
})

test('复习中途答错回到第一盒，掌握不成立', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), day0)

  const day1 = plusDays(day0, 1)
  await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day1)
  const day8 = plusDays(day0, 8)
  const wrong = await run(root, 'review.answer', { itemId: 'rv-1', choice: 3 }, day8)
  assert.equal(wrong.data.correct, false)
  assert.equal(wrong.data.box, 1)
  assert.equal(wrong.data.status, 'learning')

  const nextDay = plusDays(day8, 1)
  assert.equal((await run(root, 'review.queue', {}, nextDay)).data.dueCount, 1)
  assert.equal((await run(root, 'progress.get', {}, nextDay)).data.mastered, 0)
})

test('缺素材来源的课程被拒绝，错误指明字段，目录不变', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')

  const noSources = await run(
    root,
    'lesson.save',
    lessonPayload('2026-10-20', { sources: [] }),
    now
  )
  assert.equal(noSources.ok, false)
  assert.equal(noSources.code, 'missing_sources')
  assert.equal(noSources.field, 'sources')

  const noLicense = lessonPayload('2026-10-20')
  noLicense.sources[0].license = ''
  const rejected = await run(root, 'lesson.save', noLicense, now)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.field, 'sources[0].license')

  const noFetchTime = lessonPayload('2026-10-20')
  delete noFetchTime.sources[0].fetchedAt
  const neither = await run(root, 'lesson.save', noFetchTime, now)
  assert.equal(neither.ok, false)
  assert.equal(neither.field, 'sources[0].fetchedAt')

  await assert.rejects(fs.readdir(join(root, 'lessons')), { code: 'ENOENT' })
  const state = await run(root, 'state.get', {}, now)
  assert.equal(state.data.todayLesson, null)
})

test('过去 7 天用过的素材会被拒绝，8 天前的可以再用', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')
  assert.equal((await run(root, 'lesson.save', lessonPayload('2026-10-20'), day0)).ok, true)

  const day3 = at('2026-10-23')
  const reused = await run(root, 'lesson.save', lessonPayload('2026-10-23'), day3)
  assert.equal(reused.ok, false)
  assert.equal(reused.code, 'source_reused')

  const day9 = at('2026-10-29')
  const later = lessonPayload('2026-10-29')
  later.sources[0].url = 'https://example.com/article-two'
  later.items[0].sourceId = 'src-1'
  assert.equal((await run(root, 'lesson.save', later, day9)).ok, true)
})

test('测评结果追加为新点，旧点保留，曲线按时间排序', async () => {
  const root = await makeRoot()
  const bankResult = await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))
  assert.equal(bankResult.ok, true, JSON.stringify(bankResult))

  const first = await fullAssessment(root, at('2026-10-20'))
  const firstLevel = await run(root, 'state.get', {}, at('2026-10-20'))
  assert.equal(firstLevel.data.level.points.length, 1)
  assert.equal(typeof first.result.band, 'string')
  assert.equal(typeof first.result.reference, 'string')

  await fullAssessment(root, at('2026-10-21'))
  const after = await run(root, 'progress.get', {}, at('2026-10-21'))
  assert.equal(after.data.curve.length, 2)
  assert.ok(Date.parse(after.data.curve[0].at) <= Date.parse(after.data.curve[1].at))
  assert.ok(
    ['入门', '初级', '中级', '中高级', '高级', '精通'].includes(after.data.curve[1].band)
  )
})

test('测评按难度自适应：答对升档、答错降档，且不重复出题', async () => {
  async function collect(alwaysCorrect) {
    const root = await makeRoot()
    await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))
    let response = await run(root, 'assessment.start', { kind: 'full' }, at('2026-10-20'))
    const attemptId = response.data.attemptId
    const seen = new Set()
    const difficulties = []

    while (!response.data.done) {
      const question = response.data.question
      assert.equal(seen.has(question.id), false, '同一次测评不能重复出题')
      seen.add(question.id)
      if (!ANCHOR_POOL.some((anchor) => anchor.id === question.id)) {
        difficulties.push(question.difficulty)
      }
      const correct = answerIndexFor(question.id)
      const choice = alwaysCorrect ? correct : (correct + 1) % 4
      response = await run(
        root,
        'assessment.answer',
        { attemptId, itemId: question.id, choice },
        at('2026-10-20')
      )
      assert.equal(response.ok, true, JSON.stringify(response))
    }
    assert.equal(seen.size, 20, '完整测评应出满 20 题')
    return { difficulties, result: response.data.result }
  }

  const right = await collect(true)
  const wrong = await collect(false)

  assert.equal(right.difficulties[0], 3, '从中档起步')
  assert.equal(wrong.difficulties[0], 3, '从中档起步')

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
  assert.ok(
    mean(right.difficulties) - mean(wrong.difficulties) >= 1,
    `全对应显著高于全错：${right.difficulties.join(',')} vs ${wrong.difficulties.join(',')}`
  )
  assert.ok(right.result.estimate > wrong.result.estimate)
  assert.ok(right.result.band !== wrong.result.band)
})

test('第一次测评会把冻结的锚题池落盘并记录哈希', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))
  const started = await run(root, 'assessment.start', { kind: 'full' }, at('2026-10-20'))
  assert.equal(started.ok, true, JSON.stringify(started))

  const stored = JSON.parse(await fs.readFile(join(root, 'anchors', 'items.json'), 'utf8'))
  assert.equal(stored.frozen, true)
  assert.equal(stored.hash, ANCHOR_HASH)
  assert.equal(stored.items.length, 12)
  assert.deepEqual(stored.retired, [])
})

test('没有选项的碎片卡会从同名复习项借来选项', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  const payload = lessonPayload('2026-10-20', {
    cards: [
      { id: 'fc-ok', kind: 'quiz', front: 'in fact', back: '事实上', choices: ['a', 'b', 'c', 'd'], answerIndex: 2 },
      { id: 'fc-exact', kind: 'review', front: 'in fact', back: '事实上' },
      { id: 'fc-contains', kind: 'review', front: 'In fact, it worked out', back: '事实上' },
      { id: 'fc-orphan', kind: 'review', front: 'no such term', back: '无对应复习项' }
    ]
  })
  const saved = await run(root, 'lesson.save', payload, now)
  assert.equal(saved.ok, true, JSON.stringify(saved))

  const lesson = JSON.parse(await fs.readFile(join(root, 'lessons', '2026-10-20.json'), 'utf8'))
  const ids = lesson.cards.map((card) => card.id)
  assert.deepEqual(ids, ['fc-ok', 'fc-exact', 'fc-contains'])
  for (const id of ['fc-exact', 'fc-contains']) {
    const card = lesson.cards.find((candidate) => candidate.id === id)
    assert.equal(card.answerIndex, 0, '借来的答案应与复习项一致')
    assert.equal(card.choices.length, 4)
  }
  assert.ok(
    saved.warnings.some((warning) => warning.includes('no such term')),
    `应说明跳过了哪张卡，实际 ${JSON.stringify(saved.warnings)}`
  )
})

test('已完成课程重新提交时保留已完成的学习项', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), now)
  for (const itemId of ['item-reading', 'item-listening', 'item-expressions', 'item-quiz']) {
    await run(root, 'lesson.completeItem', { date: '2026-10-20', itemId }, now)
  }
  const before = await run(root, 'lesson.get', { date: '2026-10-20' }, now)
  assert.equal(before.data.lesson.status, 'done')

  const resubmitted = await run(
    root,
    'lesson.save',
    lessonPayload('2026-10-20', { summary: '补充了一句说明' }),
    now
  )
  assert.equal(resubmitted.ok, true, JSON.stringify(resubmitted))

  const after = await run(root, 'lesson.get', { date: '2026-10-20' }, now)
  assert.equal(after.data.lesson.status, 'done')
  assert.equal(after.data.lesson.items.every((item) => item.done), true)
  assert.equal(after.data.lesson.summary, '补充了一句说明')
})

test('同一道锚题第二次遇到时被标记污染，不进入漂移统计', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))

  // 锚题池 12 道、每次取 3 道，第 5 次测评会再次抽到第 1 批
  for (let round = 0; round < 5; round += 1) {
    await fullAssessment(root, at(`2026-11-${String(round + 1).padStart(2, '0')}`))
  }

  const log = await fs.readFile(join(root, 'anchors', 'responses.jsonl'), 'utf8')
  const entries = log
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

  const repeated = entries.filter((entry) => entry.anchorId === 'anchor-01')
  assert.equal(repeated.length, 2, '第 1 道锚题应在第 1 次与第 5 次测评中出现')
  assert.equal(repeated[0].contaminated, false)
  assert.equal(repeated[1].contaminated, true)

  const clean = entries.filter((entry) => !entry.contaminated)
  assert.equal(clean.length, 12, '只有每道锚题的首次暴露是干净样本')
})

test('锚题连续三次偏离基线后只加提示，不改分数', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))

  // 第一次：锚题全对 → 基线 1.0
  await fullAssessment(root, at('2026-10-20'), { decide: (id) => answerIndexFor(id) })

  // 接下来三次：锚题全错 → 每次偏离 1.0
  for (let round = 1; round <= 3; round += 1) {
    await fullAssessment(root, at(`2026-10-2${round}`), {
      decide: (id) => {
        const correct = answerIndexFor(id)
        const isAnchor = ANCHOR_POOL.some((item) => item.id === id)
        return isAnchor ? (correct + 1) % 4 : correct
      }
    })
  }

  const progress = await run(root, 'progress.get', {}, at('2026-10-25'))
  assert.ok(progress.data.drift.note, '连续三次偏离后应出现提示')
  assert.equal(progress.data.curve.length, 4)
  const estimates = progress.data.curve.map((point) => point.estimate)
  assert.ok(estimates.every((value) => Number.isFinite(value)), '分数不应被自动改动或清空')
})

test('未到期的复习项不能推进盒子，到了才能答', async () => {
  const root = await makeRoot()
  const day0 = at('2026-10-20')
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), day0)

  const tooEarly = await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day0)
  assert.equal(tooEarly.ok, false)
  assert.equal(tooEarly.code, 'not_due')
  assert.equal((await run(root, 'progress.get', {}, day0)).data.mastered, 0)

  // 同一天连答三次也到不了掌握，因为盒子根本没动
  await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day0)
  await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day0)
  assert.equal((await run(root, 'progress.get', {}, day0)).data.mastered, 0)

  const day1 = plusDays(day0, 1)
  const ok = await run(root, 'review.answer', { itemId: 'rv-1', choice: 0 }, day1)
  assert.equal(ok.ok, true, JSON.stringify(ok))
  assert.equal(ok.data.box, 2)
})

test('过期草稿不能被重新开始或完成', async () => {
  const root = await makeRoot()
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), at('2026-10-20'))

  const nextDay = at('2026-10-21')
  const started = await run(root, 'lesson.start', { date: '2026-10-20' }, nextDay)
  assert.equal(started.ok, false)
  assert.equal(started.code, 'lesson_expired')

  const completed = await run(
    root,
    'lesson.completeItem',
    { date: '2026-10-20', itemId: 'item-reading' },
    nextDay
  )
  assert.equal(completed.ok, false)
  assert.equal(completed.code, 'lesson_expired')

  const progress = await run(root, 'progress.get', {}, nextDay)
  assert.equal(progress.data.completions.length, 0)
  const lesson = await run(root, 'lesson.get', { date: '2026-10-20' }, nextDay)
  assert.equal(lesson.data.lesson.status, 'expired')
})

test('重复提交不再追加素材来源记录', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), now)
  await run(root, 'lesson.save', lessonPayload('2026-10-20', { title: '改过的一版' }), now)

  const lines = (await fs.readFile(join(root, 'sources', 'provenance.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).date, '2026-10-20')
})

test('两次测评不会出完全相同的题', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))

  const orders = []
  for (let round = 0; round < 2; round += 1) {
    let response = await run(root, 'assessment.start', { kind: 'full' }, at('2026-10-20'))
    const attemptId = response.data.attemptId
    const ids = []
    while (!response.data.done) {
      const question = response.data.question
      ids.push(question.id)
      response = await run(
        root,
        'assessment.answer',
        { attemptId, itemId: question.id, choice: answerIndexFor(question.id) },
        at('2026-10-20')
      )
    }
    orders.push(ids)
  }
  assert.equal(orders[0].length, orders[1].length)
  assert.notDeepEqual(orders[0], orders[1], '第二次测评的题目顺序应轮换')
})

test('课程里的表达会自动进入复习队列', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  const payload = lessonPayload('2026-10-20', {
    items: [
      lessonPayload('2026-10-20').items[0],
      lessonPayload('2026-10-20').items[1],
      {
        id: 'item-expressions',
        type: 'expressions',
        title: '四个表达',
        expressions: [
          { term: 'put a strain on', meaning: '给……带来压力' },
          { term: 'pan out', meaning: '结果是、成功' },
          { term: 'leave room for', meaning: '给……留出余地' },
          { term: 'at the expense of', meaning: '以……为代价' }
        ]
      },
      lessonPayload('2026-10-20').items[3]
    ],
    reviewItems: []
  })
  const saved = await run(root, 'lesson.save', payload, now)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  assert.equal(saved.data.reviewAdded, 4)

  const queue = await run(root, 'review.queue', {}, plusDays(now, 1))
  const items = JSON.parse(await fs.readFile(join(root, 'review', 'items.json'), 'utf8')).items
  assert.equal(items.length, 4)
  for (const item of items) {
    assert.equal(item.choices.length, 4)
    assert.equal(item.choices[item.answerIndex], item.meaning)
  }
})

test('被污染的锚题作答不进入漂移判断', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))

  // 前四次测评锚题全对，都是干净样本
  for (let round = 0; round < 4; round += 1) {
    await fullAssessment(root, at(`2026-10-2${round}`), { decide: (id) => answerIndexFor(id) })
  }
  const before = await run(root, 'progress.get', {}, at('2026-10-25'))
  assert.equal(before.data.drift.streak, 0)
  const baseline = before.data.drift.baseline

  // 第五次又抽到 1–3 号锚题（已污染），全部答错；这些作答不应推动漂移
  await fullAssessment(root, at('2026-10-25'), {
    decide: (id) => {
      const correct = answerIndexFor(id)
      return ANCHOR_POOL.some((anchor) => anchor.id === id) ? (correct + 1) % 4 : correct
    }
  })

  const after = await run(root, 'progress.get', {}, at('2026-10-25'))
  assert.equal(after.data.drift.streak, 0, '污染样本不应计入漂移')
  assert.equal(after.data.drift.baseline, baseline)
  const level = JSON.parse(await fs.readFile(join(root, 'level.json'), 'utf8'))
  assert.equal(level.points[level.points.length - 1].anchorAccuracy, null, '污染样本不产生锚题准确率')
})

test('数据文件被截断时回退到上一个可用版本并给出警告', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  await run(root, 'profile.save', { goal: 'work', minutesPerDay: 30, interests: ['工程'] }, now)
  await run(root, 'profile.save', { goal: 'travel', minutesPerDay: 45, interests: ['旅行'] }, now)

  const file = join(root, 'profile.json')
  const intact = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.equal(intact.profile.goal, 'travel')

  await fs.writeFile(file, '{"profile": {"goal": "wo', 'utf8')

  const recovered = await run(root, 'profile.get', {}, now)
  assert.equal(recovered.ok, true, JSON.stringify(recovered))
  assert.equal(recovered.data.profile.goal, 'work', '应回退到备份里的上一版')
  assert.ok(
    recovered.warnings.some((warning) => warning.includes('回退')),
    `应给出警告，实际 ${JSON.stringify(recovered.warnings)}`
  )
})

test('过期草稿转为 expired，不进入已完成统计', async () => {
  const root = await makeRoot()
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), at('2026-10-20'))

  const nextDay = at('2026-10-21')
  const state = await run(root, 'state.get', {}, nextDay)
  assert.equal(state.data.todayLesson, null)

  const yesterday = await run(root, 'lesson.get', { date: '2026-10-20' }, nextDay)
  assert.equal(yesterday.data.lesson.status, 'expired')

  const progress = await run(root, 'progress.get', {}, nextDay)
  assert.equal(progress.data.completions.length, 0)
  assert.equal(progress.data.expiredDrafts, 1)
})

test('逐项完成四类学习项后课程转为已完成，才计入进度', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), now)

  for (const itemId of ['item-reading', 'item-listening', 'item-expressions']) {
    const step = await run(root, 'lesson.completeItem', { date: '2026-10-20', itemId }, now)
    assert.equal(step.data.done, false)
    assert.equal((await run(root, 'progress.get', {}, now)).data.completions.length, 0)
  }
  const final = await run(
    root,
    'lesson.completeItem',
    { date: '2026-10-20', itemId: 'item-quiz' },
    now
  )
  assert.equal(final.data.done, true)
  assert.equal(final.data.lesson.status, 'done')
  assert.deepEqual((await run(root, 'progress.get', {}, now)).data.completions, ['2026-10-20'])
})

test('选词排序的打散顺序永远不等于正确顺序', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  const payload = lessonPayload('2026-10-20', {
    items: [
      ...lessonPayload('2026-10-20').items,
      {
        id: 'item-order',
        type: 'ordering',
        title: '排一句',
        prompt: '把这几个词排成一句话',
        answer: 'She has been working here since 2019',
        explanation: '现在完成进行时 + since。'
      }
    ]
  })
  const saved = await run(root, 'lesson.save', payload, now)
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const lesson = (await run(root, 'lesson.get', { date: '2026-10-20' }, now)).data.lesson
  const ordering = lesson.items.find((item) => item.type === 'ordering')
  assert.notEqual(ordering.words.join(' '), ordering.answer)
  assert.deepEqual([...ordering.words].sort(), [...ordering.answer.split(' ')].sort())
})

test('测评中途退出再进来，已答的题不丢', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))
  const started = await run(root, 'assessment.start', { kind: 'full' }, at('2026-10-20'))
  const attemptId = started.data.attemptId
  const firstId = started.data.question.id
  await run(
    root,
    'assessment.answer',
    { attemptId, itemId: firstId, choice: answerIndexFor(firstId) },
    at('2026-10-20')
  )

  const resumed = await run(root, 'assessment.resume', {}, at('2026-10-20'))
  assert.equal(resumed.ok, true, JSON.stringify(resumed))
  assert.equal(resumed.data.attemptId, attemptId)
  assert.equal(resumed.data.progress, 1)
  assert.notEqual(resumed.data.question.id, firstId, '应接着出下一题')
})

test('第一次测评完成后自动生成一份不含日期的大纲', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))
  await fullAssessment(root, at('2026-10-20'))

  const state = await run(root, 'state.get', {}, at('2026-10-20'))
  const phases = state.data.syllabus.phases
  assert.equal(phases.length, 3)
  const dateLike = /\d{4}-\d{2}-\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日/
  for (const phase of phases) {
    assert.equal(dateLike.test(phase.name), false, `阶段名不能含日期：${phase.name}`)
    assert.equal(dateLike.test(phase.goal), false, `阶段目标不能含日期：${phase.goal}`)
  }
  assert.equal(state.data.syllabus.weekly.totalGoals, 3)
  assert.equal(state.data.syllabus.currentPhase.id, 'phase-1')
})

test('重新生成大纲不丢失本周已勾选的目标', async () => {
  const root = await makeRoot()
  await run(root, 'assessment.saveBank', bank(), at('2026-10-20'))
  await fullAssessment(root, at('2026-10-20'))

  const before = await run(root, 'state.get', {}, at('2026-10-20'))
  const goalId = before.data.syllabus.weekly.goals[0].id
  await run(root, 'syllabus.toggleGoal', { goalId, done: true }, at('2026-10-20'))

  const regenerated = await run(root, 'syllabus.generate', {}, at('2026-10-20'))
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated))
  const after = await run(root, 'state.get', {}, at('2026-10-20'))
  assert.equal(after.data.syllabus.weekly.goals[0].done, true)
  assert.equal(after.data.syllabus.phases.length, 3)
})

test('大纲拒绝写入具体日期', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  const bad = await run(
    root,
    'syllabus.save',
    { phases: [{ id: 'p1', name: '第 1 阶段', goal: '2026-11-01 前读完 10 篇' }] },
    now
  )
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'syllabus_has_date')

  const good = await run(
    root,
    'syllabus.save',
    {
      phases: [
        { id: 'p1', name: '打基础', goal: '能读懂一般新闻短讯', focus: ['读新闻', '抓主句'] },
        { id: 'p2', name: '上难度', goal: '能读专栏与评论' }
      ],
      currentPhaseId: 'p1'
    },
    now
  )
  assert.equal(good.ok, true, JSON.stringify(good))
  const state = await run(root, 'state.get', {}, now)
  assert.equal(state.data.syllabus.currentPhase.name, '打基础')
  assert.equal(state.data.syllabus.weekly.totalGoals, 2)
})

test('连续天数允许跳过一天而不断签', async () => {
  const root = await makeRoot()
  const dates = ['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05']

  for (const date of dates) {
    const payload = lessonPayload(date)
    payload.sources[0].url = `https://example.com/${date}`
    await run(root, 'lesson.save', payload, at(date))
    for (const itemId of ['item-reading', 'item-listening', 'item-expressions', 'item-quiz']) {
      await run(root, 'lesson.completeItem', { date, itemId }, at(date))
    }
  }

  const progress = await run(root, 'progress.get', {}, at('2026-10-05'))
  assert.equal(progress.data.streak.current, 4, '10-03 跳过一天不应断签')
  assert.equal(progress.data.completions.length, 4)
})

test('数据目录可迁移，迁移后读写指向新位置', async () => {
  const root = await makeRoot()
  const target = await makeRoot()
  const now = at('2026-10-20')
  await run(root, 'profile.save', { goal: 'work', minutesPerDay: 30 }, now)

  const moved = await run(root, 'settings.migrateRoot', { target: join(target, 'coach') }, now)
  assert.equal(moved.ok, true, JSON.stringify(moved))
  const nextRoot = moved.data.dataRoot

  const readBack = await run(nextRoot, 'profile.get', {}, now)
  assert.equal(readBack.data.profile.goal, 'work')

  const inside = await run(nextRoot, 'settings.migrateRoot', { target: join(nextRoot, 'nested') }, now)
  assert.equal(inside.ok, false)
})

test('工具失败统一返回错误码与字段名，成功返回数据与警告列表', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')

  const failure = await run(root, 'lesson.save', { date: 'not-a-date' }, now)
  assert.equal(failure.ok, false)
  assert.equal(typeof failure.code, 'string')
  assert.equal(typeof failure.message, 'string')
  assert.equal(failure.field, 'date')
  assert.ok(Array.isArray(failure.warnings))

  const success = await run(root, 'lesson.save', lessonPayload('2026-10-20'), now)
  assert.equal(success.ok, true)
  assert.equal(typeof success.data.date, 'string')
  assert.ok(Array.isArray(success.warnings))

  const unknown = await run(root, 'nope', {}, now)
  assert.equal(unknown.code, 'unknown_command')
})

test('重复触发同一日期的生成只保留一份草稿', async () => {
  const root = await makeRoot()
  const now = at('2026-10-20')
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), now)
  await run(root, 'lesson.save', lessonPayload('2026-10-20'), now)

  const lessons = await fs.readdir(join(root, 'lessons'))
  assert.equal(lessons.filter((name) => name.endsWith('.json')).length, 1)

  const progress = await run(root, 'progress.get', {}, now)
  assert.equal(progress.data.completions.length, 0, '草稿不计入进度')
})
