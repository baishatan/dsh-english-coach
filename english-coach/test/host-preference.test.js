import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply } from '../index.js'
import { execute } from '../core/index.js'
import { getWordCatalog } from '../core/catalog.js'
import { tempFixture, disposeFixture } from './temp-fixture.js'
import { assessmentBank } from './assessment-bank-fixture.js'

// External Host adapters only. Tests call the registered HTTP handler and public
// tools; no prompt helper, private dispatch export, or learner-data injection.
async function host(t, { beforeSession, directory, prepare, savedTasks = [], history } = {}) {
  const root = await tempFixture(t, 'english-coach-host-preference-', directory)
  await prepare?.(root)
  const tools = new Map(), intervals = [], records = [], createdSessions = [], edits = [], historyReads = []
  const tasks = new Map(savedTasks.map(task => [task.id, structuredClone(task)]))
  const effects = [], events = new Map(), pending = new Set()
  let route, context, startup, closing = false, disposal, failSchedule = false, failEdit = null, sessionEvents = []
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
      async events(request, signal) {
        assert.deepEqual(request.address, { kind: 'session', sessionId: 'isolated-session' })
        assert.ok(signal instanceof AbortSignal, 'Passive Host history requires an explicit cancellation signal')
        historyReads.push(structuredClone(request))
        if (history) return history(request, signal)
        const cursor = request.throughSeq ?? sessionEvents.at(-1)?.seq ?? -1
        const page = sessionEvents.filter(event => event.seq <= cursor && (request.beforeSeq === undefined || event.seq < request.beforeSeq))
        return { cursor, records: page.map(event => ({ type: 'event', event })), hasMore: false }
      }
    },
    schedule: {
      async create(request) {
        assert.equal(typeof request?.prompt, 'string', 'Host schedule receives a request object and resolved prompt')
        assert.deepEqual(Object.keys(request).sort(), ['prompt', 'target', 'timing', 'title'])
        assert.deepEqual(request.target, { kind: 'session', sessionId: 'isolated-session' })
        assert.ok(['after', 'daily'].includes(request.timing.kind))
        if (failSchedule) throw new Error('isolated schedule unavailable')
        const { timing, ...fields } = request
        const record = { id: `schedule-${records.length + 1}`, ...fields, ...timing, status: 'active', scheduledAt: '2099-01-01T00:00:00.000Z' }
        records.push(structuredClone(record))
        tasks.set(record.id, record)
        return record
      },
      async view({ id }) { return structuredClone(tasks.get(id) ?? { id, code: 'schedule_not_found' }) },
      async edit(request) {
        edits.push(structuredClone(request))
        if (failEdit === 'throw') throw new Error('isolated schedule edit unavailable')
        if (failEdit) return { id: request.id, code: failEdit }
        const current = tasks.get(request.id)
        if (!current) return { id: request.id, code: 'schedule_not_found' }
        if (request.action === 'delete') {
          tasks.delete(request.id)
          return { id: request.id, deleted: true }
        }
        assert.equal(request.action, 'update')
        assert.ok(!Object.hasOwn(request.patch, 'active'), 'Changing the rule must not implicitly resume a paused task')
        const { timing, ...patch } = request.patch
        const next = { ...current, ...patch, ...timing }
        tasks.set(request.id, next)
        return structuredClone(next)
      }
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
    root, tools, records, createdSessions, request, dispose, tasks, edits, historyReads,
    tool: args => tools.get('english_vocabulary').execute(args),
    failSchedule: () => { failSchedule = true },
    failEdits: code => { failEdit = code },
    setSessionEvents: value => { sessionEvents = value },
    endSession: (reason = { kind: 'completed' }, id = records.at(-1)?.id) => {
      const task = tasks.get(id)
      const turn = sessionEvents.filter(event => event.type === 'turn/start').length + 1
      const messageId = `delivery-${id}`
      task.lastDelivery = { messageId, targetSessionId: 'isolated-session', deliveredAt: new Date().toISOString(), scheduledAt: task.scheduledAt }
      for (const [type, data] of [
        ['turn/start', { turn }],
        ['user/message', { id: messageId, source: { kind: 'schedule' }, content: [{ type: 'text', text: `schedule_id_json: ${JSON.stringify(id)}` }] }],
        ['turn/end', { turn, reason }]
      ]) sessionEvents.push({ type, seq: sessionEvents.length, time: Date.now() + 1, data })
    }
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

test('assessment preparation and submission tool declare the same short-bank admission contract', async t => {
  const h = await host(t)
  const tool = h.tools.get('english_save_assessment')
  const schema = tool.parameters.properties.items
  assert.equal(schema.minItems, 24)
  assert.deepEqual(schema.items.properties.skill.enum, ['grammar', 'vocab'])
  assert.ok(schema.items.required.includes('skill'))
  assert.equal(schema.items.properties.prompt.minLength, 1)
  assert.equal(schema.items.properties.choices.items.minLength, 1)
  assert.match(schema.items.properties.passage.description, /必须.*空|禁止/)
  const generated = await h.request('generate.assessment')
  assert.equal(generated.ok, true, JSON.stringify(generated))
  const prompt = h.records.at(-1).prompt
  for (const contract of [tool.description, prompt]) {
    assert.match(contract, /至少 24/)
    assert.match(contract, /1.*6.*各至少 4/)
    assert.match(contract, /grammar.*vocab/)
    assert.match(contract, /两类.*覆盖|同时.*包含/)
    assert.match(contract, /不.*比例/)
    assert.match(contract, /独立单句/)
    assert.match(contract, /30.*英文词/)
    assert.match(contract, /12.*英文词/)
    assert.match(contract, /缩写.*一词/)
    assert.match(contract, /填空.*不计/)
    assert.match(contract, /文章.*对话.*音频.*外部材料/)
    assert.match(contract, /passage.*空/)
    assert.match(contract, /ID.*唯一.*锚题/)
    assert.match(contract, /不.*截断/)
  }
  const payload = assessmentBank()
  payload.items[0].skill = 'reading'
  const rejected = await tool.execute(payload)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.field, 'items[0].skill')
  assert.match(rejected.message, /重新准备/)
  assert.equal((await h.request('assessment.start', { kind: 'short' })).ok, false)
  payload.items[0].skill = 'grammar'
  assert.equal((await tool.execute(payload)).ok, true)
  const started = await h.request('assessment.start', { kind: 'short' })
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.equal(started.data.total, 10)
  assert.equal(started.data.question.passage, '')
})

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

test('manual generation uses typed Host timing and explicitly reuses the saved Session', async t => {
  const h = await host(t)
  for (const command of ['generate', 'generate.assessment']) assert.equal((await h.request(command)).ok, true)
  assert.equal(h.createdSessions.length, 1)
  assert.equal(h.records.length, 2)
  for (const record of h.records) {
    assert.equal(record.kind, 'after')
    assert.equal(record.after_seconds, 2)
    assert.deepEqual(record.target, { kind: 'session', sessionId: 'isolated-session' })
  }
})

test('daily edits and disabling use the Host-wide API without replacing the task identity', async t => {
  const h = await host(t)
  assert.equal((await h.request('settings.save', { automation: { enabled: true, time: '08:00', timeZone: 'Asia/Shanghai' } })).warnings.length, 0)
  const daily = h.records.at(-1)
  assert.deepEqual(daily.daily, { time: '08:00:00', time_zone: 'Asia/Shanghai' })
  assert.equal((await h.request('settings.save', { automation: { enabled: true, time: '09:30', timeZone: 'America/New_York' } })).warnings.length, 0)
  assert.equal(h.records.length, 1, 'Editing preserves task identity and history')
  assert.equal(h.edits.at(-1).id, daily.id)
  assert.equal(h.edits.at(-1).action, 'update')
  assert.deepEqual(h.tasks.get(daily.id).daily, { time: '09:30:00', time_zone: 'America/New_York' })
  assert.equal((await h.request('settings.save', { automation: { enabled: false } })).warnings.length, 0)
  assert.deepEqual(h.edits.at(-1), { id: daily.id, action: 'delete' })
  assert.equal(h.tasks.size, 0)
  assert.equal(JSON.parse(await fs.readFile(join(h.root, 'jobs.json'), 'utf8')).dailyScheduleId, null)
})

test('an existing migrated daily rule survives restart without duplicate creation or rearming', async t => {
  const saved = { id: 'migrated-daily', kind: 'daily', title: '英语教练 · 每日一课', prompt: 'saved live context',
    daily: { time: '08:00:00', time_zone: 'Asia/Shanghai' }, target: { kind: 'session', sessionId: 'isolated-session' },
    status: 'active', scheduledAt: '2026-10-31T00:00:00.000Z' }
  const h = await host(t, { savedTasks: [saved], prepare: async root => {
    await execute(root, 'settings.save', { automation: { enabled: true, time: '08:00', timeZone: 'Asia/Shanghai' } })
    await fs.writeFile(join(root, 'jobs.json'), JSON.stringify({ dailySessionId: 'isolated-session', dailyScheduleId: saved.id,
      dailyScheduleKey: 'live-lesson-context-v1|08:00|Asia/Shanghai', jobs: {} }))
  } })
  assert.equal(h.records.length, 0)
  assert.equal(h.edits.length, 0)
  assert.deepEqual(h.tasks.get(saved.id), saved, 'The Host owns migration and the committed occurrence')
  await h.dispose()
  const reboot = await host(t, { directory: h.root, savedTasks: [saved] })
  assert.equal(reboot.records.length, 0)
  assert.equal(reboot.edits.length, 0)
  assert.deepEqual(reboot.tasks.get(saved.id), saved)
  assert.equal((await reboot.request('settings.save', { automation: { enabled: false } })).warnings.length, 0)
  assert.equal(reboot.tasks.size, 0)
})

test('daily edit failures keep the binding visible and allow retry without a duplicate rule', async t => {
  const h = await host(t)
  await h.request('settings.save', { automation: { enabled: true, time: '08:00', timeZone: 'Asia/Shanghai' } })
  const id = h.records.at(-1).id
  h.failEdits('schedule_conflict')
  const changed = await h.request('settings.save', { automation: { enabled: true, time: '09:00' } })
  assert.equal(changed.ok, true)
  assert.ok(changed.warnings.some(message => /schedule_conflict/.test(message)))
  assert.equal(h.records.length, 1)
  assert.equal(JSON.parse(await fs.readFile(join(h.root, 'jobs.json'), 'utf8')).dailyScheduleId, id)
  h.failEdits('throw')
  const disabled = await h.request('settings.save', { automation: { enabled: false } })
  assert.ok(disabled.warnings.some(message => /isolated schedule edit unavailable/.test(message)))
  assert.equal(h.tasks.size, 1)
  h.failEdits(null)
  assert.equal((await h.request('settings.save', { automation: { enabled: false } })).warnings.length, 0)
  assert.equal(h.tasks.size, 0)
})

test('an already removed daily rule can be disabled idempotently without an active Session', async t => {
  const h = await host(t, { prepare: root => fs.writeFile(join(root, 'jobs.json'), JSON.stringify({
    dailyScheduleId: 'removed-rule', dailyScheduleKey: 'old-key', jobs: {}
  })) })
  const result = await h.request('settings.save', { automation: { enabled: false } })
  assert.equal(result.warnings.length, 0)
  assert.equal(JSON.parse(await fs.readFile(join(h.root, 'jobs.json'), 'utf8')).dailyScheduleId, null)
})

test('a missing daily rule is recreated on an explicit settings change, not mistaken for a valid binding', async t => {
  const h = await host(t)
  await h.request('settings.save', { automation: { enabled: true, time: '08:00', timeZone: 'Asia/Shanghai' } })
  h.tasks.clear()
  const result = await h.request('settings.save', { automation: { enabled: true, time: '09:00' } })
  assert.equal(result.warnings.length, 0)
  assert.equal(h.records.length, 2)
  assert.equal(h.tasks.size, 1)
})

test('job completion follows its delivery message instead of a different task ending in the shared Session', async t => {
  const h = await host(t)
  const assessment = await h.request('generate.assessment')
  const vocabulary = await h.tool({ action: 'supplement' })
  h.endSession({ kind: 'completed' }, assessment.data.id)
  assert.equal((await h.request('job.status', { kind: 'assessment' })).data.status, 'done')
  assert.equal((await h.request('job.status', { kind: 'vocab' })).data.status, 'pending')
  h.endSession({ kind: 'aborted' }, vocabulary.data.id)
  const failed = await h.request('job.status', { kind: 'vocab' })
  assert.equal(failed.data.status, 'failed')
  assert.match(failed.data.failure, /中断/)
})

test('passive event history pages keep a fixed cut and find the matching delivery across page boundaries', async t => {
  const h = await host(t, { history: request => request.beforeSeq === undefined
    ? { cursor: 9, records: [{ type: 'event', event: { seq: 9, type: 'turn/end', time: 1, data: { turn: 4, reason: { kind: 'completed' } } } }], hasMore: true }
    : { cursor: 9, records: [
      { type: 'event', event: { seq: 7, type: 'turn/start', time: 1, data: { turn: 4 } } },
      { type: 'event', event: { seq: 8, type: 'user/message', time: 1, data: { id: 'page-delivery', source: { kind: 'schedule' } } } }
    ], hasMore: true } })
  const generated = await h.request('generate.assessment')
  h.tasks.get(generated.data.id).lastDelivery = { messageId: 'page-delivery', targetSessionId: 'isolated-session' }
  assert.equal((await h.request('job.status', { kind: 'assessment' })).data.status, 'done', 'Clock rollback does not hide the matched turn')
  assert.equal(h.historyReads.length, 2)
  assert.equal(h.historyReads[1].throughSeq, 9)
  assert.equal(h.historyReads[1].beforeSeq, 9)
})

test('a delivered but unfinished turn remains pending without inferring completion from idle state', async t => {
  const h = await host(t)
  const generated = await h.request('generate.assessment')
  h.tasks.get(generated.data.id).lastDelivery = { messageId: 'unfinished', targetSessionId: 'isolated-session' }
  h.setSessionEvents([
    { seq: 0, type: 'turn/start', time: Date.now(), data: { turn: 1 } },
    { seq: 1, type: 'user/message', time: Date.now(), data: { id: 'unfinished', source: { kind: 'schedule' } } }
  ])
  assert.equal((await h.request('job.status', { kind: 'assessment' })).data.status, 'pending')
  assert.equal(h.historyReads.length, 1)
})

test('legacy pending jobs without a saved receipt use exact Host framing after restart', async t => {
  const h = await host(t)
  const generated = await h.request('generate.assessment')
  h.endSession()
  const task = h.tasks.get(generated.data.id)
  delete task.lastDelivery
  assert.equal((await h.request('job.status', { kind: 'assessment' })).data.status, 'done')
})

test('history read failures keep a pending job retryable and a matching error turn is never success', async t => {
  let readable = false
  const h = await host(t, { history: () => {
    if (!readable) throw new Error('isolated history unavailable')
    return { cursor: 2, records: [
      { type: 'event', event: { seq: 0, type: 'turn/start', data: { turn: 1 } } },
      { type: 'event', event: { seq: 1, type: 'user/message', data: { id: 'failed-delivery', source: { kind: 'schedule' } } } },
      { type: 'event', event: { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'isolated model failure' } } } } }
    ], hasMore: false }
  } })
  const generated = await h.request('generate.assessment')
  h.tasks.get(generated.data.id).lastDelivery = { messageId: 'failed-delivery', targetSessionId: 'isolated-session' }
  assert.equal((await h.request('job.status', { kind: 'assessment' })).data.status, 'pending')
  readable = true
  const failed = await h.request('job.status', { kind: 'assessment' })
  assert.equal(failed.data.status, 'failed')
  assert.equal(failed.data.failure, 'isolated model failure')
})

test('malformed or non-progressing Host history cannot settle a generation or loop indefinitely', async t => {
  const h = await host(t, { history: () => ({ cursor: 9, records: [
    { type: 'event', event: { seq: 9, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } } }
  ], hasMore: true }) })
  await h.request('generate.assessment')
  assert.equal((await h.request('job.status', { kind: 'assessment' })).data.status, 'pending')
  assert.equal(h.historyReads.length, 2, 'A repeated page must not be followed again')
})

test('editing the time of a Host-paused daily task preserves its paused state', async t => {
  const h = await host(t)
  await h.request('settings.save', { automation: { enabled: true, time: '08:00', timeZone: 'Asia/Shanghai' } })
  const id = h.records.at(-1).id
  h.tasks.get(id).status = 'paused'
  const result = await h.request('settings.save', { automation: { enabled: true, time: '09:00' } })
  assert.equal(result.warnings.length, 0)
  assert.equal(h.records.length, 1)
  assert.equal(h.tasks.get(id).status, 'paused')
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

// Seed at-time facts in a new attempt, then publish only through the approved
// finish seam. This supplies narrow coverage without a second test scorer.
async function finishFixedAssessment(h, difficulties, outcomes) {
  assert.equal((await h.request('assessment.saveBank', assessmentBank('starting-point'))).ok, true)
  const started = await h.request('assessment.start', { kind: 'short' })
  assert.equal(started.ok, true, JSON.stringify(started))
  const path = join(h.root, 'assessments', `${started.data.attemptId}.json`)
  const attempt = JSON.parse(await fs.readFile(path, 'utf8'))
  attempt.anchors = []; attempt.anchorIds = []
  attempt.answers = difficulties.map((difficulty, index) => ({
    itemId: `starting-${index}`, responseId: JSON.stringify([attempt.id, `starting-${index}`]),
    responseType: 'choice', choice: outcomes[index] ? 1 : 0, correct: outcomes[index],
    difficulty, skill: index % 2 ? 'grammar' : 'vocab', anchor: false,
    at: new Date().toISOString()
  }))
  attempt.pool = attempt.answers.map(answer => ({ id: answer.itemId, difficulty: answer.difficulty, skill: answer.skill, answerIndex: 1 }))
  attempt.order = attempt.answers.map(answer => answer.itemId)
  attempt.current = null
  await fs.writeFile(path, JSON.stringify(attempt))
  const finished = await h.request('assessment.finish', { attemptId: attempt.id })
  assert.equal(finished.ok, true, JSON.stringify(finished))
  return finished.data.result
}

test('an unassessed learner can request an introductory lesson without acquiring a level point', async t => {
  const h = await host(t)
  await h.request('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '精通' })
  const before = (await h.request('state.get')).data.level
  assert.equal(before.latest, null)
  const result = await h.request('generate')
  assert.equal(result.ok, true, JSON.stringify(result))
  const prompt = h.records.at(-1).prompt
  assert.match(prompt, /材料难度：入门（档位 1\/6）/)
  assert.match(prompt, /当前测评状态：未测评/)
  assert.match(prompt, /不要求先完成测评/)
  assert.deepEqual((await h.request('state.get')).data.level, before)
  const context = await h.tool({ action: 'lesson_context' })
  assert.equal(context.ok, true)
  assert.match(context.data.prompt, /材料难度：入门（档位 1\/6）/)
})

test('explicit profile supplementation starts at introductory material while remaining unassessed', async t => {
  const h = await host(t)
  await h.request('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '精通' })
  await h.tool({ action: 'select', id: 'cet6' })
  const before = (await h.request('state.get')).data.level
  const preference = (await h.request('study.preference')).data
  assert.equal(h.records.length, 0, 'reading state and choosing a static list cannot request generated words')
  const result = await h.tool({ action: 'supplement', profile: true })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.data.mode, 'generated')
  const prompt = h.records.at(-1).prompt
  assert.match(prompt, /材料难度：入门（档位 1\/6）/)
  assert.match(prompt, /当前测评状态：未测评/)
  assert.doesNotMatch(prompt, /略高于|不高于目标档位/)
  assert.deepEqual((await h.request('state.get')).data.level, before)
  assert.deepEqual((await h.request('study.preference')).data, preference)
  assert.equal((await h.request('review.list')).data.total, 0)
})

test('both generated paths use the current capped band despite aspirational target and conflicting route', async t => {
  const h = await host(t)
  await h.request('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '精通' })
  const result = await finishFixedAssessment(h, [1, 1, 1, 1, 1, 1, 1, 1, 1, 6], Array(10).fill(true))
  assert.equal(result.band, '入门')
  assert.equal(result.finalBandIndex, 1)
  await h.request('syllabus.save', { phases: [{ id: 'old', name: '高级法律路线', goal: '精通长篇法律评论', targetBand: '精通', focus: ['合同法'] }] })
  assert.equal((await h.request('state.get')).data.syllabus.currentPhase.targetBand, '精通')
  assert.equal((await h.request('generate')).ok, true)
  assert.equal((await h.tool({ action: 'supplement', profile: true })).ok, true)
  assert.equal(h.records.length, 2)
  for (const prompt of h.records.map(record => record.prompt)) {
    assert.match(prompt, /当前有效测评档位：入门/)
    assert.match(prompt, /材料难度：入门（档位 1\/6）/)
    assert.match(prompt, /目标档位只表示未来方向，不抬高或压低材料难度/)
    assert.match(prompt, /大纲.*只.*主题.*不能覆盖.*档位/)
    assert.doesNotMatch(prompt, /略高于|不高于目标档位|rawEstimate|estimate/)
  }
})

test('unavailable current state stops generated requests rather than reusing a known band', async t => {
  const h = await host(t)
  await h.request('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '入门' })
  await finishFixedAssessment(h, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, true, true, true, true, false])
  const known = await h.tool({ action: 'lesson_context' })
  assert.equal(known.ok, true)
  assert.match(known.data.prompt, /材料难度：高级（档位 5\/6）/)
  const profilePath = join(h.root, 'profile.json')
  const saved = await fs.readFile(profilePath, 'utf8')
  await fs.writeFile(profilePath, '{damaged')
  for (const invoke of [
    () => h.tool({ action: 'lesson_context' }),
    () => h.request('generate'),
    () => h.tool({ action: 'supplement', profile: true })
  ]) {
    const result = await invoke()
    assert.equal(result.ok, false, 'damaged state cannot authorize a stale or default difficulty')
    assert.match(result.message, /学习状态.*重试/)
    assert.doesNotMatch(result.message, /必须.*测评|先完成测评/)
  }
  assert.equal(h.records.length, 0)
  assert.equal(h.createdSessions.length, 0)
  await fs.writeFile(profilePath, saved)
  assert.match((await h.tool({ action: 'lesson_context' })).data.prompt, /材料难度：高级（档位 5\/6）/)
  assert.equal((await h.request('generate')).ok, true)
})

test('a non-authoritative attendance warning does not become a new prerequisite for learning', async t => {
  const h = await host(t)
  await fs.writeFile(join(h.root, 'progress.json'), '{damaged attendance')
  const state = await h.request('state.get')
  assert.equal(state.ok, true)
  assert.ok(state.warnings.some(warning => warning.startsWith('progress.json')))
  const context = await h.tool({ action: 'lesson_context' })
  assert.equal(context.ok, true, JSON.stringify(context))
  assert.match(context.data.prompt, /材料难度：入门（档位 1\/6）/)
  assert.equal((await h.request('generate')).ok, true)
  assert.equal((await h.tool({ action: 'supplement', profile: true })).ok, true)
  assert.equal(h.records.length, 2)
})

test('a delayed vocabulary request requires the latest public starting point instead of its request snapshot', async t => {
  const h = await host(t)
  await h.request('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '精通' })
  assert.equal((await h.tool({ action: 'supplement', profile: true })).ok, true)
  const prompt = h.records.at(-1).prompt
  assert.match(prompt, /请求时.*参考快照/)
  assert.match(prompt, /english_state.*失败.*停止/)
  assert.match(prompt, /最新.*level\.latest.*finalBandIndex.*band.*为准/)
  assert.match(prompt, /latest.*null.*未测评.*入门/)
  await finishFixedAssessment(h, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, false, false, false, false, false])
  const live = await h.tools.get('english_state').execute({})
  assert.equal(live.ok, true)
  assert.equal(live.data.level.latest.band, '中级')
  assert.equal(live.data.level.latest.finalBandIndex, 3)
  assert.doesNotMatch(prompt, /略高于|不高于目标档位/)
})

test('a lower target and easier old route cannot cap the current band in either generated path', async t => {
  const h = await host(t)
  await h.request('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '入门' })
  const result = await finishFixedAssessment(h, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, true, true, true, true, false])
  assert.equal(result.band, '高级')
  assert.equal(result.finalBandIndex, 5, 'worked example is capped below the raw sixth band')
  await h.request('syllabus.save', { phases: [{ id: 'old-easy', name: '日常问候', goal: '只用基础短句', targetBand: '入门', focus: ['问候'] }] })
  assert.equal((await h.request('generate')).ok, true)
  assert.equal((await h.tool({ action: 'supplement', profile: true })).ok, true)
  for (const prompt of h.records.map(record => record.prompt)) {
    assert.match(prompt, /材料难度：高级（档位 5\/6）/)
    assert.match(prompt, /目标档位只表示未来方向，不抬高或压低材料难度/)
    assert.match(prompt, /大纲.*只.*主题.*不能覆盖.*档位/)
    assert.doesNotMatch(prompt, /略高于|不高于目标档位|rawEstimate|5\.5/)
  }
})

test('daily and queued lesson delivery refresh the final band through the public context tool', async t => {
  const h = await host(t)
  await h.request('settings.save', { automation: { enabled: true, time: '08:00', timeZone: 'Asia/Shanghai' } })
  assert.equal((await h.request('generate')).ok, true)
  const manual = h.records.find(record => record.kind === 'after')
  const daily = h.records.find(record => record.daily)
  assert.match(manual.prompt, /材料难度：入门（档位 1\/6）/)
  for (const prompt of [manual.prompt, daily.prompt]) {
    assert.match(prompt, /english_vocabulary.*lesson_context/)
    assert.match(prompt, /失败.*停止/)
  }
  await finishFixedAssessment(h, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, false, false, false, false, false])
  const context = await h.tool({ action: 'lesson_context' })
  assert.equal(context.ok, true)
  assert.match(context.data.prompt, /材料难度：中级（档位 3\/6）/)
  assert.equal(h.records.length, 2, 'band changes cannot schedule replacement material')
})

test('failed state I/O stops public contexts and actual lesson and profile schedules without losing a known band', async t => {
  const h = await host(t)
  await finishFixedAssessment(h, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, false, false, false, false, false])
  const before = (await h.request('state.get')).data.level
  const lessons = join(h.root, 'lessons')
  // This synthetic external-I/O fault makes state.get return ok:false, unlike a
  // tolerated warning. No private execute or prompt implementation is replaced.
  await fs.writeFile(lessons, 'not a directory')
  assert.equal((await h.request('state.get')).ok, false)
  const results = [await h.tool({ action: 'lesson_context' }), await h.request('generate'), await h.tool({ action: 'supplement', profile: true })]
  for (const result of results) {
    assert.equal(result.ok, false, JSON.stringify(result))
    assert.match(result.message, /学习状态.*重试/)
    assert.doesNotMatch(result.message, /必须.*测评|先完成测评/)
  }
  assert.equal(h.records.length, 0)
  assert.equal(h.createdSessions.length, 0)
  assert.equal(lessons, join(h.root, 'lessons'))
  assert.equal((await fs.lstat(lessons)).isFile(), true)
  await fs.unlink(lessons)
  assert.deepEqual((await h.request('state.get')).data.level, before)
  assert.equal((await h.request('generate')).ok, true)
  assert.match(h.records.at(-1).prompt, /材料难度：中级（档位 3\/6）/)
})

test('new learning requests preserve draft, active and done lessons plus vocabulary schedules and static source order', async t => {
  for (const status of ['draft', 'active', 'done']) {
    const h = await host(t)
    await h.request('profile.save', { goal: 'work', minutesPerDay: 20, interests: [], targetBand: '精通' })
    const today = (await h.request('state.get')).data.today
    const payload = lesson(today)
    assert.equal((await h.tools.get('english_save_lesson').execute(payload)).ok, true)
    if (status !== 'draft') assert.equal((await h.request('lesson.start', { date: today })).ok, true)
    if (status === 'done') for (const item of payload.items) {
      assert.equal((await h.request('lesson.completeItem', { date: today, itemId: item.id })).ok, true)
    }
    assert.equal((await h.tools.get('english_add_words').execute({ items: [{ term: 'protected term', meaning: '原有释义', choices: ['原有释义', '其他', '不同', '未知'], answerIndex: 0 }] })).ok, true)
    const item = (await h.request('review.list')).data.items[0]
    assert.equal((await h.request('record.batch', { reviewAnswers: [{ itemId: item.id, correct: true, attemptId: `preserve-${status}` }] })).ok, true)
    await h.tool({ action: 'select', id: 'cet6' })
    const course = (await h.request('lesson.get', { date: today })).data
    assert.equal(course.lesson.status, status)
    const words = (await h.request('review.list')).data
    const preference = (await h.request('study.preference')).data
    await finishFixedAssessment(h, [1, 1, 1, 1, 1, 1, 1, 1, 1, 6], Array(10).fill(true))
    const context = await h.tool({ action: 'lesson_context' })
    assert.equal(context.ok, true)
    assert.match(context.data.prompt, /今天已有草稿、进行中或已完成课程就保留/)
    assert.equal((await h.request('generate')).ok, true)
    assert.equal((await h.tool({ action: 'supplement', profile: true })).ok, true)
    assert.deepEqual((await h.request('lesson.get', { date: today })).data, course)
    assert.deepEqual((await h.request('review.list')).data, words)
    assert.deepEqual((await h.request('study.preference')).data, preference)
    assert.equal((await h.request('wordlists.list')).data.activeWordListId, 'cet6')
  }
})

test('a malformed current band is not silently treated as an introductory or target estimate', async t => {
  const h = await host(t)
  await finishFixedAssessment(h, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, false, false, false, false, false])
  const path = join(h.root, 'level.json')
  const level = JSON.parse(await fs.readFile(path, 'utf8'))
  delete level.points.at(-1).finalBandIndex
  await fs.writeFile(path, JSON.stringify(level))
  const result = await h.tool({ action: 'lesson_context' })
  assert.equal(result.ok, false)
  assert.match(result.message, /当前档位.*重试/)
  assert.equal(h.records.length, 0)
})
