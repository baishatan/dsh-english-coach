import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply } from '../index.js'
import { execute } from '../core/index.js'
import { getWordCatalog } from '../core/catalog.js'

// External Host adapters only. Tests call the registered HTTP handler and public
// tools; no prompt helper, private dispatch export, or learner-data injection.
async function host() {
  const root = await fs.mkdtemp(join(tmpdir(), 'english-coach-host-preference-'))
  const tools = new Map(), intervals = [], records = [], createdSessions = []
  let route, context, failSchedule = false, sessionEvents = []
  const services = {
    sessionController: {
      async create(request) { createdSessions.push(request); return { sessionId: 'isolated-session' } },
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
    webServer: { register(value) { route = value; return () => {} } },
    systemPrompt: { context(value) { context = value; return () => {} } }
  }
  apply({
    get: name => services[name],
    tools: { register(definition) { tools.set(definition.name, definition); return () => {} } },
    timer: { interval(callback, delay) { const row = { callback, delay, stopped: false }; intervals.push(row); return () => { row.stopped = true } } },
    effect: fn => fn(), on() {}
  }, { dataRoot: root })
  for (const row of intervals.filter(row => row.delay === 500)) row.callback()
  // Await the existing async startup through its visible prompt context. No real
  // scheduler, timer polling job, profile installation or service is started.
  for (let n = 0; n < 100 && !context?.text(); n++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(context?.text(), 'startup completed in isolated root')
  assert.ok(route)
  const request = async (command, payload = {}) => {
    const req = Readable.from([JSON.stringify(payload)])
    req.url = `/english-coach/api/${command}`
    req.method = 'POST'
    let result
    await route.handler(req, { setHeader() {}, end(body) { result = JSON.parse(body) } })
    return result
  }
  return {
    root, tools, records, createdSessions, request,
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

test('manual lesson request contains actual full-catalog candidates and non-fabrication rules', async () => {
  const h = await host()
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
  assert.deepEqual((await execute(h.root, 'review.list')).data, before.data)
})

test('a stored daily reminder refreshes current preference at delivery through a public tool', async () => {
  const h = await host()
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

test('active-list supplement uses the shared domain operation without a model job', async () => {
  const h = await host()
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
  assert.equal(explicit.data.mode, 'generated')
  assert.equal(h.records.length, 1)
  assert.equal((await execute(h.root, 'study.preference')).data.activeWordList.id, 'cet4')
})

test('without a list, ordinary supplementation reuses due items before requesting a model', async () => {
  const h = await host()
  await execute(h.root, 'review.add', { items: [{ term: 'existing', meaning: '已有', choices: ['已有', '将来', '过去', '现在'], answerIndex: 0 }] })
  const result = await h.tool({ action: 'supplement' })
  assert.equal(result.ok, true)
  assert.equal(result.data.items[0].term, 'existing')
  assert.equal(h.records.length, 0)
})

test('no preference keeps model supplementation; generation failures remain visible', async () => {
  const h = await host()
  const initial = await h.tool({ action: 'supplement' })
  assert.equal(initial.ok, true)
  assert.equal(initial.data.mode, 'generated')
  assert.equal(h.records.length, 1)
  h.failSchedule()
  const result = await h.request('generate')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'generate_failed')
  assert.match(result.message, /isolated schedule unavailable/)
  assert.equal((await execute(h.root, 'state.get')).data.todayLesson, null)
})

test('a completed agent turn without a saved lesson is not reported as generation success', async () => {
  const h = await host()
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

test('tool and HTTP share query/select semantics and reject arbitrary command dispatch', async () => {
  const h = await host()
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

test('course submission protects a duplicate beyond the 60-term prompt summary', async () => {
  const h = await host()
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

test('preference requests do not rewrite existing courses or require material matches', async () => {
  const h = await host()
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
