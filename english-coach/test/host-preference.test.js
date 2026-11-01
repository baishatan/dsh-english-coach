import assert from 'node:assert/strict'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply } from '../index.js'
import { execute } from '../core/index.js'
import { getWordCatalog } from '../core/catalog.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'

// External Host adapters only. Tests call the registered HTTP handler and public
// tools; no prompt helper, private dispatch export, or learner-data injection.
async function host(t, { beforeSession } = {}) {
  const root = await tempFixture(t, 'english-coach-host-preference-')
  const tools = new Map(), intervals = [], records = [], createdSessions = []
  const effects = [], events = new Map(), pending = new Set()
  let route, context, startup, closing = false, disposal, failSchedule = false, sessionEvents = []
  function track(operation) {
    assert.equal(closing, false, 'Cannot send a new request after Host shutdown')
    const task = Promise.resolve().then(operation)
    pending.add(task)
    task.then(() => pending.delete(task), () => pending.delete(task))
    return task
  }
  async function drain() {
    const errors = []
    while (pending.size) {
      for (const result of await Promise.allSettled([...pending])) if (result.status === 'rejected') errors.push(result.reason)
    }
    if (errors.length) throw new AggregateError(errors, 'Host requests did not finish')
  }
  function dispose() {
    return disposal ??= (async () => {
      closing = true
      for (const row of intervals) row.stopped = true
      const errors = []
      for (const shutdown of [() => startup, drain, ...effects.toReversed(), ...(events.get('dispose') ?? []), drain]) {
        try { await shutdown() } catch (cause) { errors.push(cause) }
      }
      if (errors.length) throw new AggregateError(errors, 'Host fixture shutdown failed')
    })()
  }
  // Register before startup so even an assertion during setup shuts the Host
  // down before tempFixture removes the owned learning and speech directories.
  disposeFixture(t, dispose)
  const services = {
    sessionController: {
      async create(request) { createdSessions.push(request); await beforeSession?.(); return { sessionId: 'isolated-session' } },
      async inspect() { return { events: sessionEvents } }
    },
    schedule: {
      async create(sessionId, request) {
        assert.equal(typeof request.prompt, 'string', 'Host schedule receives a resolved string')
        if (failSchedule) throw new Error('isolated schedule unavailable')
        const record = { id: `schedule-${records.length + 1}`, sessionId, ...request }
        records.push(record)
        return record
      },
      async delete() { return { deleted: true } }
    },
    webServer: { register(value) { route = value; return () => { route = null } } },
    systemPrompt: { context(value) { context = value; return () => { context = null } } }
  }
  apply({
    get: name => services[name],
    tools: { register(definition) {
      tools.set(definition.name, { ...definition, execute: args => track(() => definition.execute(args)) })
      return () => { tools.delete(definition.name) }
    } },
    timer: { interval(callback, delay) { const row = { callback, delay, stopped: false }; intervals.push(row); return () => { row.stopped = true } } },
    effect(fn) { const cleanup = fn(); if (typeof cleanup === 'function') effects.push(cleanup) },
    on(name, callback) { if (!events.has(name)) events.set(name, []); events.get(name).push(callback) }
  }, { dataRoot: root, speechRoot: join(root, 'speech') })
  for (const row of intervals.filter(row => row.delay === 500)) row.callback()
  // The visible context is set at the end of startup's awaited automation and
  // state writes. Do not launch the fire-and-forget periodic watcher in tests.
  startup = (async () => {
    for (let n = 0; n < 1000 && !context?.text(); n++) await new Promise(resolve => setTimeout(resolve, 5))
    assert.ok(context?.text(), 'startup completed in isolated root')
    assert.ok(route)
  })()
  await startup
  const request = (command, payload = {}) => track(async () => {
    const req = Readable.from([JSON.stringify(payload)])
    req.url = `/english-coach/api/${command}`
    req.method = 'POST'
    let result
    await route.handler(req, { setHeader() {}, end(body) { result = JSON.parse(body) } })
    return result
  })
  return {
    root, tools, records, createdSessions, request, dispose,
    tool: args => tools.get('english_vocabulary').execute(args),
    failSchedule: () => { failSchedule = true },
    endSession: (reason = { kind: 'completed' }) => { sessionEvents = [{ type: 'turn/end', time: Date.now() + 1, data: { reason } }] }
  }
}

function lesson(date) {
  return {
    date, title: '合成无词库命中课程', note: '合成验收素材；没有合适词库命中，不编造出处。',
    sources: [{ id: 'source', url: 'https://example.com/synthetic-host-test', fetchedAt: '2026-10-22T00:00:00.000Z', license: 'Synthetic test fixture' }],
    items: [
      { id: 'read', type: 'reading', sourceId: 'source', body: 'Quux works with zyzzyva.' },
      { id: 'listen', type: 'listening', sourceId: 'source', transcript: 'Quux works with zyzzyva.' },
      { id: 'express', type: 'expressions', expressions: [{ term: 'synthetic phrase', meaning: '合成表达' }] },
      { id: 'quiz', type: 'quiz', questions: [{ prompt: 'Who works?', choices: ['Quux', 'Other', 'None', 'Unknown'], answerIndex: 0 }] }
    ]
  }
}

test('lesson tool declares optional paragraph translations and shares domain validation', async t => {
  const h = await host(t)
  const tool = h.tools.get('english_save_lesson')
  const itemSchema = tool.parameters.properties.items.items
  const translations = itemSchema.properties.translations
  assert.equal(translations?.type, 'array')
  assert.equal(translations.items.type, 'string')
  assert.ok(!(itemSchema.required ?? []).includes('translations'), 'Old callers may omit translations')
  assert.match(translations.description, /一一对应/)
  const today = (await execute(h.root, 'state.get')).data.today
  const payload = lesson(today)
  payload.items[0].translations = ['合成阅读译文。']
  payload.items[1].translations = ['合成听力译文。']
  assert.equal((await tool.execute(payload)).ok, true)
  const saved = (await execute(h.root, 'lesson.get', { date: today })).data.lesson
  assert.deepEqual(saved.items[0].translations, ['合成阅读译文。'])
  assert.deepEqual(saved.items[1].translations, ['合成听力译文。'])
  payload.items[1].translations = []
  const failure = await tool.execute(payload)
  assert.equal(failure.ok, false)
  assert.equal(failure.code, 'invalid_field')
  assert.equal(failure.field, 'items[1].translations')
})

test('record tool requires stable vocabulary identity and preserves lesson-only completion', async t => {
  const h = await host(t)
  const tool = h.tools.get('english_record')
  const properties = tool.parameters.properties.reviewAnswers.items.properties
  for (const name of ['roundId', 'revision', 'presentationId', 'attemptId']) assert.ok(properties[name], name)
  assert.match(tool.description, /稳定.*身份/)
  assert.match(properties.at.description, /不.*历史/)
  await h.tools.get('english_add_words').execute({ items: [{ term: 'identity', meaning: '身份', choices: ['身份', '未来', '过去', '现在'], answerIndex: 0 }] })
  const itemId = (await execute(h.root, 'review.list')).data.items[0].id
  const refused = await tool.execute({ reviewAnswers: [{ itemId, correct: true }] })
  assert.equal(refused.data.applied.length, 0)
  assert.equal(refused.data.skipped[0].reason, 'answer_identity_required')
  const request = { reviewAnswers: [{ itemId, correct: false, attemptId: 'host-error', at: '2020-01-01T00:00:00.000Z' }] }
  assert.equal((await tool.execute(request)).data.applied.length, 1)
  assert.equal((await tool.execute(request)).data.applied.length, 0)
  assert.equal((await execute(h.root, 'review.list')).data.items[0].answerCount, 1)
  const today = (await execute(h.root, 'state.get')).data.today
  await h.tools.get('english_save_lesson').execute(lesson(today))
  assert.equal((await tool.execute({ lessonCompletions: [{ itemId: 'read', date: today }] })).ok, true)
  assert.equal((await execute(h.root, 'lesson.get', { date: today })).data.lesson.items[0].done, true)
})

test('manual lesson request contains actual full-catalog candidates and non-fabrication rules', async t => {
  const h = await host(t)
  assert.equal((await h.request('wordlists.select', { id: 'cet6' })).ok, true)
  await h.request('wordlists.query', { id: 'cet6', search: 'zzzz', page: 999, pageSize: 20 })
  const preference = await execute(h.root, 'study.preference')
  assert.equal(preference.ok, true)
  assert.ok(preference.data.candidates.length > 20)
  const before = await execute(h.root, 'review.list')
  const result = await h.request('generate')
  assert.equal(result.ok, true)
  const prompt = h.records.at(-1).prompt
  assert.match(prompt, /id=cet6/)
  assert.match(prompt, /六级学习参考词库/)
  for (const candidate of preference.data.candidates) assert.ok(prompt.includes(JSON.stringify(candidate)))
  assert.match(prompt, /不能伪造词语出处、改写来源原文/)
  assert.match(prompt, /前 60 个已有词只是提示摘要/)
  assert.match(prompt, /今天已有草稿、进行中或已完成课程就保留/)
  assert.match(prompt, /新课.*reading.*listening.*必须.*translations/)
  assert.match(prompt, /空白行.*段内单换行/)
  assert.match(prompt, /旧课缺译文.*不自动.*重做/)
  assert.deepEqual((await execute(h.root, 'review.list')).data, before.data)
})

test('a stored daily reminder refreshes current preference at delivery through a public tool', async t => {
  const h = await host(t)
  await h.tool({ action: 'select', id: 'cet4' })
  const enabled = await h.request('settings.save', { automation: { enabled: true, time: '08:00', timeZone: 'Asia/Shanghai' } })
  assert.equal(enabled.ok, true)
  const daily = h.records.find(record => record.daily)
  assert.ok(daily)
  assert.equal(typeof daily.prompt, 'string')
  assert.match(daily.prompt, /lesson_context/)
  assert.ok(!daily.prompt.includes('cet4'), 'rule does not freeze creation-time selection')
  await h.tool({ action: 'select', id: 'ielts' })
  // This simulates delivery's explicitly instructed tool call. It proves the
  // final tool response, not that a real external model will obey the reminder.
  const delivered = await h.tool({ action: 'lesson_context' })
  assert.equal(delivered.ok, true)
  assert.equal(typeof delivered.data.prompt, 'string')
  assert.match(delivered.data.prompt, /id=ielts/)
  assert.match(delivered.data.prompt, /雅思学习参考词库/)
  assert.match(delivered.data.prompt, /新课.*reading.*listening.*必须.*translations/)
  assert.match(delivered.data.prompt, /忠实.*中文.*不添加事实/)
  assert.match(delivered.data.prompt, /今天已有草稿、进行中或已完成课程就保留/)
  assert.doesNotMatch(delivered.data.prompt, /\[object Promise\]/)
  const actualTerms = new Set(getWordCatalog().entries.filter(e => e.listIds.includes('ielts')).map(e => e.term))
  const current = await execute(h.root, 'study.preference')
  assert.ok(current.data.candidates.every(e => actualTerms.has(e.term)))
  await h.tool({ action: 'select', id: null })
  const noPreference = await h.tool({ action: 'lesson_context' })
  assert.match(noPreference.data.prompt, /当前词库：不指定/)
  assert.doesNotMatch(noPreference.data.prompt, /id=ielts/)
  assert.equal(h.records.filter(record => record.daily).length, 1)
})

test('active-list supplement uses the shared domain operation without a model job', async t => {
  const h = await host(t)
  await h.tool({ action: 'select', id: 'cet4' })
  const before = (await execute(h.root, 'review.list')).data.items.length
  const result = await h.tool({ action: 'supplement' })
  assert.equal(result.ok, true)
  assert.equal(result.data.mode, 'static')
  assert.ok(result.data.addedCount > 0)
  assert.equal(h.records.length, 0)
  assert.equal(h.createdSessions.length, 0)
  assert.equal((await execute(h.root, 'review.list')).data.items.length, before + result.data.addedCount)
  const again = await h.request('generate.vocab')
  assert.equal(again.data.mode, 'static')
  assert.deepEqual(again.data.items, result.data.items)
  assert.equal(again.data.addedCount, 0)
  assert.equal(h.records.length, 0)
  const explicit = await h.request('generate.vocab', { profile: true })
  assert.equal(explicit.data.mode, 'static', '未完成原批优先于显式画像请求')
  assert.equal(h.records.length, 0)
  assert.equal((await execute(h.root, 'study.preference')).data.activeWordList.id, 'cet4')
})

test('without a list, ordinary supplementation reuses due items before requesting a model', async t => {
  const h = await host(t)
  await execute(h.root, 'review.add', { items: [{ term: 'existing', meaning: '已有', choices: ['已有', '将来', '过去', '现在'], answerIndex: 0 }] })
  const result = await h.tool({ action: 'supplement' })
  assert.equal(result.ok, true)
  assert.equal(result.data.items[0].term, 'existing')
  assert.equal(h.records.length, 0)
})

test('unfinished durable round blocks static and explicit profile generation at every Host entry', async t => {
  const h = await host(t)
  await execute(h.root, 'review.add', { items: [{ term: 'pending', meaning: '待完成', choices: ['待完成', '将来', '过去', '现在'], answerIndex: 0 }] })
  const original = (await h.request('study.batch')).data
  await h.tool({ action: 'select', id: 'ielts' })
  for (const invoke of [
    () => execute(h.root, 'study.supplement', { continue: true }),
    () => h.request('generate.vocab', { continue: true }),
    () => h.request('generate.vocab', { profile: true, continue: true }),
    () => h.tool({ action: 'supplement', profile: true })
  ]) {
    const result = await invoke()
    assert.equal(result.ok, true)
    assert.deepEqual(result.data.round, original.round, '所有入口只能续原批')
    assert.equal((await execute(h.root, 'review.list')).data.total, 1)
    assert.equal(h.records.length, 0, '未完成时不能悄悄启动模型')
    assert.equal(h.createdSessions.length, 0)
  }
})

test('only explicit continuation may fill an empty round from a completed generation', async t => {
  const h = await host(t)
  const empty = (await h.request('study.batch')).data
  const untouched = await h.request('generate.vocab', { profile: true })
  assert.deepEqual(untouched.data.round, empty.round)
  assert.equal(h.records.length, 0)
  const started = await h.request('generate.vocab', { profile: true, continue: true, roundId: empty.round.id, revision: empty.round.revision })
  assert.equal(started.data.mode, 'generated')
  assert.equal(h.records.length, 1)
  await h.tools.get('english_add_words').execute({ items: [{ term: 'generated', meaning: '生成词', choices: ['生成词', '将来', '过去', '现在'], answerIndex: 0 }] })
  h.endSession()
  assert.equal((await h.request('job.status', { kind: 'vocab' })).data.status, 'done')
  const loaded = (await h.request('study.batch')).data
  assert.equal(loaded.round.status, 'active')
  assert.equal(loaded.items[0].term, 'generated')
  assert.deepEqual((await h.request('study.batch')).data.round, loaded.round)
  await h.tools.get('english_add_words').execute({ items: [{ term: 'late generation', meaning: '迟到词', choices: ['迟到词', '将来', '过去', '现在'], answerIndex: 0 }] })
  assert.deepEqual((await h.request('study.batch')).data.items, loaded.items, '生成结束后的读取也不能替换进行中原批')
})

test('concurrent continuation token starts only one vocabulary schedule and stale token never restarts it', async t => {
  const h = await host(t)
  const empty = (await h.request('study.batch')).data
  const token = { continue: true, profile: true, roundId: empty.round.id, revision: empty.round.revision }
  const results = await Promise.all([h.request('generate.vocab', token), h.request('generate.vocab', token)])
  assert.equal(results.every(result => result.ok), true)
  assert.equal(h.records.length, 1)
  assert.equal(h.createdSessions.length, 1)
  assert.equal(results[0].data.mode, 'generated')
  assert.equal(results[1].data.mode, 'generated')
  assert.equal(results[0].data.id, results[1].data.id)
  h.endSession()
  await h.request('job.status', { kind: 'vocab' })
  await h.request('generate.vocab', token)
  assert.equal(h.records.length, 1)
})

test('vocabulary scheduling revalidates the saved round after asynchronous session creation', async t => {
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  const blocked = new Promise(resolve => { release = resolve })
  const h = await host(t, { beforeSession: async () => { entered(); await blocked } })
  const empty = (await h.request('study.batch')).data
  const generation = h.request('generate.vocab', { continue: true, profile: true, roundId: empty.round.id, revision: empty.round.revision })
  await started
  try {
    await h.tools.get('english_add_words').execute({ items: [{ term: 'arrived meanwhile', meaning: '已到达', choices: ['已到达', '未来', '过去', '现在'], answerIndex: 0 }] })
    const active = (await h.request('study.batch')).data
    assert.equal(active.round.status, 'active')
    release()
    const result = await generation
    assert.equal(result.ok, true)
    assert.equal(h.records.length, 0, '会话创建前一次guard不足以防TOCTOU')
    assert.deepEqual(result.data.round, active.round)
  } finally { release(); await generation }
})

test('no preference keeps model supplementation; generation failures remain visible', async t => {
  const h = await host(t)
  const empty = (await h.request('study.batch')).data
  const initial = await h.tool({ action: 'supplement' })
  assert.equal(initial.ok, true)
  assert.equal(initial.data.mode, 'generated', '显式工具补词读取最新空批身份后继续')
  assert.notEqual((await h.request('study.batch')).data.round.id, empty.round.id)
  assert.equal(h.records.length, 1)
  h.failSchedule()
  const result = await h.request('generate')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'generate_failed')
  assert.match(result.message, /isolated schedule unavailable/)
  assert.equal((await execute(h.root, 'state.get')).data.todayLesson, null)
})

test('unselected-list HTTP continuation reports vocabulary scheduling failure without a false batch', async t => {
  const h = await host(t)
  h.failSchedule()
  const result = await h.request('generate.vocab', {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'generate_failed')
  assert.match(result.message, /isolated schedule unavailable/)
  assert.equal((await execute(h.root, 'review.list')).data.total, 0)
  assert.equal(h.records.length, 0)
})

test('a completed agent turn without a saved lesson is not reported as generation success', async t => {
  const h = await host(t)
  assert.equal((await h.request('generate')).ok, true)
  h.endSession()
  const failed = await h.request('job.status', { kind: 'lesson' })
  assert.equal(failed.data.status, 'failed')
  assert.match(failed.data.failure, /未保存今天的课程/)
  assert.equal((await h.request('generate')).ok, true, 'failure allows explicit retry')
  const today = (await execute(h.root, 'state.get')).data.today
  await h.tools.get('english_save_lesson').execute(lesson(today))
  h.endSession()
  const done = await h.request('job.status', { kind: 'lesson' })
  assert.equal(done.data.status, 'done')
  assert.equal(done.data.failure, null)
})

test('tool and HTTP share query/select semantics and reject arbitrary command dispatch', async t => {
  const h = await host(t)
  const selected = await h.tool({ action: 'select', id: 'ielts' })
  assert.deepEqual(selected, await h.request('wordlists.select', { id: 'ielts' }))
  const query = { id: 'ielts', search: '火山', page: 1, pageSize: 20, filter: 'unjoined' }
  assert.deepEqual(await h.tool({ action: 'query', ...query }), await h.request('wordlists.query', query))
  assert.equal((await h.tool({ action: 'lesson.save' })).ok, false)
  assert.equal((await h.tool({ action: 'select' })).ok, false)
  assert.equal((await h.tool({ action: 'list', command: 'settings.save' })).ok, false)
  const stateBefore = await execute(h.root, 'review.list')
  await h.tool({ action: 'lesson_context' })
  assert.deepEqual((await execute(h.root, 'review.list')).data, stateBefore.data)
})

test('course submission protects a duplicate beyond the 60-term prompt summary', async t => {
  const h = await host(t)
  const items = Array.from({ length: 65 }, (_, index) => ({
    term: `fixture term ${index}`, meaning: '原有释义', choices: ['原有释义', '其他', '不同', '未知'], answerIndex: 0
  }))
  assert.equal((await h.tools.get('english_add_words').execute({ items })).ok, true)
  const before = (await execute(h.root, 'review.list')).data.items.find(item => item.term === 'fixture term 64')
  const snapshot = await h.tools.get('english_state').execute({})
  assert.ok(!snapshot.data.review.terms.includes('fixture term 64'))
  const payload = lesson(snapshot.data.today)
  payload.reviewItems = [{ term: '  FIXTURE   TERM 64  ', meaning: '不应覆盖', choices: ['不应覆盖', '其他', '不同', '未知'], answerIndex: 0 }]
  payload.items.find(item => item.type === 'expressions').expressions = [{ term: 'FIXTURE TERM 64', meaning: '表达也不覆盖' }]
  await h.tool({ action: 'select', id: 'cet4' })
  assert.equal((await h.tools.get('english_save_lesson').execute(payload)).ok, true)
  const result = (await execute(h.root, 'review.list')).data
  assert.equal(result.items.length, 65)
  const after = result.items.find(item => item.id === before.id)
  for (const field of ['meaning', 'choices', 'box', 'status', 'dueAt', 'answerCount', 'fresh']) assert.deepEqual(after[field], before[field])
})

test('preference requests do not rewrite existing courses or require material matches', async t => {
  const h = await host(t)
  const today = (await execute(h.root, 'state.get')).data.today
  assert.equal((await h.tools.get('english_save_lesson').execute(lesson(today))).ok, true)
  const before = (await execute(h.root, 'lesson.get', { date: today })).data
  await h.tool({ action: 'select', id: 'ielts' })
  await h.tool({ action: 'lesson_context' })
  await h.request('generate')
  const after = (await execute(h.root, 'lesson.get', { date: today })).data
  assert.deepEqual(after, before)
  assert.equal(after.lesson.items.find(item => item.type === 'reading').body, 'Quux works with zyzzyva.')
})
