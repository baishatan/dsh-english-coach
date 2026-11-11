import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { ANCHOR_POOL, ANCHOR_HASH, anchorStore } from '../core/anchors.js'
import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { tempFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00.000Z')
const anchorIds = new Set(ANCHOR_POOL.map(item => item.id))

async function fixture(t, remaining = 0) {
  const root = await tempFixture(t, 'coach-assessment-anchors-')
  const run = (command, payload = {}, at = now) => execute(root, command, payload, { now: at })
  const bank = assessmentBank('anchor-fallback')
  assert.equal((await run('assessment.saveBank', bank)).ok, true)
  await fs.mkdir(join(root, 'anchors'), { recursive: true })
  await fs.writeFile(join(root, 'anchors', 'items.json'), JSON.stringify(anchorStore()))
  const prior = ANCHOR_POOL.slice(0, ANCHOR_POOL.length - remaining).map(item => ({
    anchorId: item.id, attemptId: `synthetic-prior-${item.id}`, at: '2026-11-10T09:00:00.000Z',
    correct: true, contaminated: false
  }))
  await fs.writeFile(join(root, 'anchors', 'responses.jsonl'), prior.map(entry => JSON.stringify(entry)).join('\n') + (prior.length ? '\n' : ''))
  return { root, run, bank, prior }
}

async function complete(run, kind, respond = () => ({ responseType: 'unable' })) {
  const started = await run('assessment.start', { kind })
  assert.equal(started.ok, true, JSON.stringify(started))
  const questions = []
  let current = started.data
  const total = kind === 'short' ? 10 : 20
  assert.equal(current.total, total)
  while (!current.done) {
    assert.ok(current.question, 'an incomplete assessment must have an unanswered question')
    assert.equal(current.progress, questions.length)
    assert.equal(questions.some(item => item.id === current.question.id), false, 'an item cannot repeat within an attempt')
    questions.push(current.question)
    const answered = await run('assessment.answer', { attemptId: current.attemptId, itemId: current.question.id, ...respond(current.question) })
    assert.equal(answered.ok, true, JSON.stringify(answered))
    current = answered.data
    assert.ok(questions.length <= total, 'the agreed length must not increase')
  }
  assert.equal(current.progress, total)
  assert.equal(questions.length, total)
  return { ...current, questions }
}

async function storedAttempt(root, id) {
  return JSON.parse(await fs.readFile(join(root, 'assessments', `${id}.json`), 'utf8'))
}

async function anchorLog(root) {
  return (await fs.readFile(join(root, 'anchors', 'responses.jsonl'), 'utf8')).split('\n').filter(Boolean).map(JSON.parse)
}

async function untilAnchor(run, current, respond = () => ({ responseType: 'unable' })) {
  while (!anchorIds.has(current.question.id)) {
    const answered = await run('assessment.answer', { attemptId: current.attemptId, itemId: current.question.id, ...respond(current.question) })
    assert.equal(answered.ok, true, JSON.stringify(answered))
    current = answered.data
  }
  return current
}

test('zero unanswered anchors leave both full and short assessments complete with distinct ordinary items', async t => {
  for (const kind of ['full', 'short']) {
    const { root, run, prior } = await fixture(t)
    const finished = await complete(run, kind)
    assert.equal(finished.questions.filter(item => anchorIds.has(item.id)).length, 0, `${kind} must not reuse answered anchors`)
    assert.deepEqual(await anchorLog(root), prior, 'exhaustion must not add exposure or repeat-response records')
    assert.equal((await storedAttempt(root, finished.attemptId)).answers.length, kind === 'full' ? 20 : 10)
  }
})

test('one, two, or three unanswered anchors are used once and ordinary questions fill the full or short length', async t => {
  for (const remaining of [1, 2, 3]) {
    for (const kind of ['full', 'short']) {
      const { root, run, prior } = await fixture(t, remaining)
      const finished = await complete(run, kind)
      const used = finished.questions.filter(item => anchorIds.has(item.id)).map(item => item.id)
      assert.deepEqual(used.sort(), ANCHOR_POOL.slice(-remaining).map(item => item.id), `${kind}, ${remaining} remaining`)
      assert.deepEqual((await storedAttempt(root, finished.attemptId)).anchorIds, used, 'the saved attempt must not reserve duplicate anchor identities to fill a quota')
      const log = await anchorLog(root)
      assert.equal(log.length, prior.length + remaining)
      assert.equal(log.filter(entry => entry.attemptId === finished.attemptId).every(entry => entry.contaminated === false), true)
      const frozen = JSON.parse(await fs.readFile(join(root, 'anchors', 'items.json'), 'utf8'))
      assert.equal(frozen.hash, ANCHOR_HASH)
      assert.deepEqual(frozen.items, ANCHOR_POOL)
    }
  }
})

test('a committed anchor answer prevents fresh reuse even when its response-log projection failed', async t => {
  const { root, run } = await fixture(t, 1)
  const started = await run('assessment.start', { kind: 'short' })
  const current = await untilAnchor(run, started.data)
  const open = fs.open
  let blocked = true
  t.mock.method(fs, 'open', async (path, ...args) => {
    if (blocked && path === join(root, 'anchors', 'responses.jsonl')) throw Object.assign(new Error('synthetic anchor log failure'), { code: 'EIO' })
    return open.call(fs, path, ...args)
  })
  const payload = { attemptId: current.attemptId, itemId: current.question.id, responseType: 'unable' }
  assert.equal((await run('assessment.answer', payload)).ok, false)
  const committed = (await storedAttempt(root, current.attemptId)).answers.at(-1)
  assert.equal(committed.itemId, current.question.id)
  assert.equal(committed.contaminated, false)
  assert.equal((await anchorLog(root)).some(entry => entry.anchorId === current.question.id), false)
  blocked = false
  const next = await complete(run, 'full')
  assert.equal(next.questions.some(item => anchorIds.has(item.id)), false, 'start must use saved responses, not only an incomplete log projection')
  const replay = await run('assessment.answer', payload, new Date('2026-11-12T09:00:00.000Z'))
  assert.equal(replay.ok, true, JSON.stringify(replay))
  assert.equal(replay.data.replayed, true)
  const projected = (await anchorLog(root)).filter(entry => entry.anchorId === current.question.id)
  assert.equal(projected.length, 1)
  assert.equal(projected[0].contaminated, false)
  assert.equal(projected[0].at, now.toISOString())
})

test('concurrent stale attempts keep one first-anchor identity when its log fails and both responses replay', async t => {
  const { root, run } = await fixture(t, 1)
  const first = await untilAnchor(run, (await run('assessment.start', { kind: 'short' })).data)
  const second = await untilAnchor(run, (await run('assessment.start', { kind: 'short' })).data)
  assert.notEqual(first.attemptId, second.attemptId)
  assert.equal(first.question.id, second.question.id, 'unanswered snapshots do not reserve first-response status')
  const open = fs.open
  let failures = 1
  t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === join(root, 'anchors', 'responses.jsonl') && failures-- > 0) throw Object.assign(new Error('first anchor projection interrupted'), { code: 'EIO' })
    return open.call(fs, path, ...args)
  })
  const payloads = [first, second].map(current => ({ attemptId: current.attemptId, itemId: current.question.id, responseType: 'unable' }))
  const [interrupted, accepted] = await Promise.all(payloads.map(payload => run('assessment.answer', payload)))
  assert.equal(interrupted.ok, false)
  assert.equal(accepted.ok, true, JSON.stringify(accepted))
  const response = async current => (await storedAttempt(root, current.attemptId)).answers.find(answer => answer.itemId === first.question.id)
  assert.equal((await response(first)).contaminated, false)
  assert.equal((await response(second)).contaminated, true, 'a committed response remains first even before its log can be projected')
  for (const [index, current] of [first, second].entries()) {
    const saved = await response(current)
    assert.equal(saved.scoringEvidence, index === 0)
    assert.equal(saved.exclusionReason, index === 0 ? null : 'repeated_anchor')
    const replay = await run('assessment.answer', payloads[index], new Date('2026-11-12T09:00:00.000Z'))
    assert.equal(replay.ok, true, JSON.stringify(replay))
    assert.equal(replay.data.replayed, true)
    assert.equal(replay.data.responseId, saved.responseId)
    assert.deepEqual(await response(current), saved, 'reprojection must not reclassify first or repeated responses')
  }
  const records = (await anchorLog(root)).filter(entry => entry.anchorId === first.question.id)
  assert.equal(records.length, 2)
  assert.equal(records.find(entry => entry.attemptId === first.attemptId).contaminated, false)
  assert.equal(records.find(entry => entry.attemptId === second.attemptId).contaminated, true)
  assert.equal(records.every(entry => entry.at === now.toISOString()), true)
})

test('first anchors steer difficulty while repeated correct, wrong, and unable anchor responses do not', async t => {
  for (const responseType of ['correct', 'wrong', 'unable']) {
    const { root, run, bank } = await fixture(t, 1)
    const choices = new Map(bank.items.map(item => [item.id, item.answerIndex]))
    const balanced = () => {
      let index = 0
      return item => ({ responseType: 'choice', choice: (choices.get(item.id) + (index++ % 2)) % 4 })
    }
    const first = await untilAnchor(run, (await run('assessment.start', { kind: 'short' })).data, balanced())
    const second = await untilAnchor(run, (await run('assessment.start', { kind: 'short' })).data, balanced())
    const item = ANCHOR_POOL.find(item => item.id === first.question.id)
    const payload = responseType === 'unable' ? { responseType: 'unable' }
      : { responseType: 'choice', choice: responseType === 'correct' ? item.answerIndex : (item.answerIndex + 1) % 4 }
    const savedFirst = await run('assessment.answer', { attemptId: first.attemptId, itemId: item.id, ...payload })
    assert.equal(savedFirst.ok, true)
    assert.equal(savedFirst.data.question.difficulty, responseType === 'correct' ? 4 : 2, `a first ${responseType} anchor steers from tier three`)
    const repeated = await run('assessment.answer', { attemptId: second.attemptId, itemId: item.id, ...payload })
    assert.equal(repeated.ok, true, JSON.stringify(repeated))
    assert.equal(repeated.data.question.difficulty, 3, `repeated ${responseType} must leave the tier at three`)
    assert.equal((await storedAttempt(root, second.attemptId)).tier, 3)
    assert.equal((await storedAttempt(root, second.attemptId)).answers.at(-1).scoringEvidence, false)
  }
})

test('a repeated high-anchor correct response is excluded from estimation but kept in whole-attempt response statistics', async t => {
  const { root, run } = await fixture(t, 1)
  const first = await untilAnchor(run, (await run('assessment.start', { kind: 'short' })).data)
  const second = await untilAnchor(run, (await run('assessment.start', { kind: 'short' })).data)
  const item = ANCHOR_POOL.find(item => item.id === first.question.id)
  assert.equal(item.difficulty, 6)
  assert.equal((await run('assessment.answer', { attemptId: first.attemptId, itemId: item.id, responseType: 'unable' })).ok, true)
  let response = await run('assessment.answer', { attemptId: second.attemptId, itemId: item.id, responseType: 'choice', choice: item.answerIndex })
  while (!response.data.done) {
    response = await run('assessment.answer', { attemptId: second.attemptId, itemId: response.data.question.id, responseType: 'unable' })
    assert.equal(response.ok, true, JSON.stringify(response))
  }
  const control = await complete(run, 'short')
  assert.equal(response.data.result.band, control.result.band, 'one remembered anchor cannot change an otherwise all-unable estimate')
  assert.deepEqual(response.data.result.counts, { correct: 1, incorrect: 0, unable: 9 })
  assert.equal(response.data.result.accuracy, 0.1, 'the summary counts every submitted response, not only scoring evidence')
  const stored = await storedAttempt(root, second.attemptId)
  assert.equal(stored.answers.filter(answer => answer.scoringEvidence).length, 9)
  assert.equal(stored.answers.filter(answer => answer.exclusionReason === 'repeated_anchor').length, 1)
  assert.equal(stored.result.anchorAccuracy, null)
})

test('anchor exhaustion keeps saved drift facts unchanged without presenting an old observation as current', async t => {
  for (const kind of ['full', 'short']) {
    const { root, run } = await fixture(t)
    const drift = { baseline: 1, streak: 3, note: 'Synthetic previous drift observation; not current.' }
    await fs.writeFile(join(root, 'level.json'), JSON.stringify({ version: 1, points: [{
      id: 'synthetic-prior-level', at: '2026-11-10T09:00:00.000Z', band: '中级', estimate: 3, anchorAccuracy: 0
    }], drift }))
    const before = await run('progress.get')
    assert.match(before.data.drift.note, /仅供安排学习/, 'a fresh observation may give only a scope-safe caution')
    const finished = await complete(run, kind)
    assert.equal(Object.hasOwn(finished.result, 'drift'), false, 'result summaries do not expose internal drift facts')
    const state = await run('state.get')
    const progress = await run('progress.get')
    assert.deepEqual(state.data.level.drift, { note: null })
    assert.deepEqual(progress.data.drift, { note: null })
    const level = JSON.parse(await fs.readFile(join(root, 'level.json'), 'utf8'))
    assert.deepEqual(level.drift, drift, 'no anchor must neither reset nor advance baseline, deviation streak, or historical note')
    assert.equal(level.points.at(-1).anchorAccuracy, null)
    const saved = await storedAttempt(root, finished.attemptId)
    assert.deepEqual(saved.finalization.drift, drift)
    assert.deepEqual(saved.result.drift, drift, 'the internal completion retains historical drift facts')
    assert.deepEqual((await run('assessment.resume')).data.result, finished.result)
    assert.deepEqual((await run('assessment.finish', { attemptId: finished.attemptId })).data.result, finished.result)
    assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'level.json'), 'utf8')).drift, drift)
  }
})

test('retired anchors are excluded without changing frozen content or creating a replacement pool', async t => {
  const { root, run } = await fixture(t, ANCHOR_POOL.length)
  const target = join(root, 'anchors', 'items.json')
  const frozen = JSON.parse(await fs.readFile(target, 'utf8'))
  frozen.retired = ['anchor-01', 'anchor-03', 'anchor-12']
  await fs.writeFile(target, JSON.stringify(frozen))
  const finished = await complete(run, 'full')
  assert.deepEqual(finished.questions.filter(item => anchorIds.has(item.id)).map(item => item.id), ['anchor-02', 'anchor-04', 'anchor-05'])
  assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), frozen)
  assert.equal((await anchorLog(root)).length, 3)
})

test('viewing, pausing, resuming, and abandoning an unanswered anchor never consumes its first-response status', async t => {
  const { root, run, prior } = await fixture(t, 1)
  const first = await untilAnchor(run, (await run('assessment.start', { kind: 'short' })).data)
  const resumed = await run('assessment.resume')
  assert.deepEqual(resumed.data.question, first.question)
  assert.equal(resumed.data.progress, first.progress)
  assert.deepEqual(await anchorLog(root), prior, 'merely serving an anchor does not write an exposure')
  assert.equal((await run('assessment.abandon', { attemptId: first.attemptId })).ok, true)
  const next = await complete(run, 'short')
  assert.deepEqual(next.questions.filter(item => anchorIds.has(item.id)).map(item => item.id), [first.question.id])
  const record = (await storedAttempt(root, next.attemptId)).answers.find(answer => answer.anchor)
  assert.equal(record.contaminated, false)
  assert.equal(record.scoringEvidence, true)
  assert.equal(record.exclusionReason, null)
})

test('ordinary questions remain reusable across attempts instead of becoming permanently exhausted', async t => {
  const { root, run } = await fixture(t)
  const first = await complete(run, 'full')
  const second = await complete(run, 'full')
  const firstIds = new Set(first.questions.map(item => item.id))
  const reused = second.questions.filter(item => firstIds.has(item.id))
  assert.ok(reused.length >= 16, 'two sets of twenty from a bank of twenty-four must reuse ordinary items')
  assert.equal(second.questions.some(item => anchorIds.has(item.id)), false)
  const saved = await storedAttempt(root, second.attemptId)
  assert.equal(saved.answers.every(answer => answer.scoringEvidence && answer.exclusionReason === null), true)
  assert.equal(first.questions[0].difficulty, 3)
  assert.equal(second.questions[0].difficulty, 3)
  assert.deepEqual(JSON.parse(await fs.readFile(join(root, 'level.json'), 'utf8')).drift, { baseline: null, streak: 0, note: null }, 'no-anchor runs do not invent even an initial drift baseline')
})
