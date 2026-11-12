import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import test from 'node:test'

import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { tempFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00.000Z')
const difficulties = [1, 1, 2, 2, 3, 3, 4, 4, 5, 6]
async function fixture(t, directory) {
  const root = directory ?? await tempFixture(t, 'coach-assessment-history-')
  const run = (command, payload = {}, at = now) => execute(root, command, payload, { now: at })
  const read = async path => JSON.parse(await fs.readFile(join(root, path), 'utf8'))
  const put = async (path, value) => {
    await fs.mkdir(join(root, path, '..'), { recursive: true })
    await fs.writeFile(join(root, path), JSON.stringify(value, null, 2) + '\n')
  }
  return { root, run, read, put }
}
function legacy(index = 1, correct = 5, kind = 'short') {
  const at = `2026-11-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`
  const id = `2026-11-01-${kind}-old-${index}`
  const total = kind === 'short' ? 10 : 20
  const result = { id: `old-level-${index}`, at, kind, band: '精通', estimate: 6, accuracy: 1, weaknesses: [] }
  return {
    id, kind, status: 'done', length: total, items: total, createdAt: '2026-11-01T09:00:00.000Z',
    order: Array.from({ length: total }, (_, i) => `original-${index}-${i}`), anchorIds: [], sourceVersion: 'no-longer-installed',
    answers: Array.from({ length: total }, (_, i) => ({
      itemId: `original-${index}-${i}`, difficulty: difficulties[i % 10], correct: i < correct,
      choice: i < correct ? 1 : 0, at, skill: i % 2 ? 'grammar' : 'vocab', anchor: false
    })), result
  }
}
async function seed(setup, attempts, points = attempts.map(attempt => attempt.result)) {
  for (const attempt of attempts) await setup.put(`assessments/${attempt.id}.json`, attempt)
  await setup.put('level.json', { version: 1, points, drift: { baseline: 0.5, streak: 2, note: null } })
  await setup.put('syllabus.json', { version: 1, phases: [{ id: 'old-phase', name: '旧路线', goal: '旧目标', focus: ['旧勾选'], targetBand: '精通' }], currentPhaseId: 'old-phase', weekly: { weekStart: '2026-11-09', goals: [{ id: 'goal-1', text: '旧勾选', done: true }] } })
}

test('usable original history is recomputed in place with the single rule without a current bank or invented attempts', async t => {
  const setup = await fixture(t)
  const original = legacy()
  await seed(setup, [original])
  const response = await setup.run('state.get')
  assert.equal(response.ok, true, JSON.stringify(response))
  assert.equal(response.data.level.latest.band, '中级', 'five easier successes and five failures have the independently checked new band')
  assert.equal(response.data.level.latest.finalBandIndex, 3)
  assert.equal(response.data.level.latest.id, original.result.id)
  assert.equal(response.data.level.latest.at, original.result.at)
  assert.equal(response.data.level.points.length, 1)
  assert.equal(response.data.needsAssessment, false)
  assert.equal(response.data.syllabus.currentPhase.targetBand, '中级')
  assert.equal(response.data.syllabus.weekly.completedGoals, 0)
  const saved = await setup.read(`assessments/${original.id}.json`)
  assert.deepEqual(saved.answers, original.answers)
  assert.equal(saved.createdAt, original.createdAt)
  assert.equal(saved.result.scoringRule, 'six-band-grid-v1')
  assert.deepEqual(saved.result.scoring, { rawEstimate: 2.62, rawBandIndex: 3, coverageCap: 5, evidenceCount: 10 })
  assert.deepEqual(saved.result.counts, { correct: 5, incorrect: 5, unable: 0 })
  assert.deepEqual((await setup.run('progress.get')).data.curve, response.data.level.points)
  assert.equal((await fs.readdir(join(setup.root, 'assessments'))).filter(name => /^\d{4}-.*\.json$/.test(name)).length, 1)
})

test('the latest invalid completed record leaves current unassessed while earlier recomputable history remains visible', async t => {
  const setup = await fixture(t)
  const good = legacy(1)
  const bad = legacy(2)
  delete bad.answers[0].difficulty
  await seed(setup, [good, bad])
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest, null, 'an earlier good point is not the latest completed evidence')
  assert.equal(state.data.needsAssessment, true)
  assert.deepEqual(state.data.level.points.map(point => point.id), [good.result.id])
  assert.equal(state.data.syllabus.currentPhase.targetBand, '入门')
  assert.equal((await setup.run('progress.get')).data.curve.length, 1)
  assert.equal((await setup.read(`assessments/${bad.id}.json`)).result, undefined)
})

test('an earlier unusable completion with an explicitly linked level time cannot invalidate a newer usable current', async t => {
  const setup = await fixture(t)
  const earlier = legacy(1)
  const earlierPoint = { ...earlier.result, attemptId: earlier.id }
  delete earlier.result
  const newer = legacy(2)
  await seed(setup, [earlier, newer], [earlierPoint, { ...newer.result, attemptId: newer.id }])
  const path = `assessments/${earlier.id}.json`
  const bytes = await fs.readFile(join(setup.root, path), 'utf8')
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest?.attemptId, newer.id)
  assert.equal(state.data.level.latest?.band, '中级')
  assert.equal(state.data.needsAssessment, false)
  assert.equal(state.data.syllabus.currentPhase.targetBand, '中级')
  assert.deepEqual(state.data.level.points.map(point => point.id), [newer.result.id])
  const journal = await setup.read('assessment-history.json')
  assert.equal(journal.originals.find(record => record.path === path).text, bytes)
  assert.deepEqual((await setup.read(path)).answers, earlier.answers)
  assert.equal((await setup.read(path)).result, undefined, 'a confirmed completion time does not restore missing scoring evidence')
})

test('a latest unusable completion or an unconfirmed completion time remains unassessed without guessing an older current', async t => {
  for (const state of ['latest-linked', 'unknown', 'ambiguous-link', 'wrong-kind']) {
    await t.test(state, async t => {
      const setup = await fixture(t)
      const unusable = legacy(state === 'latest-linked' ? 2 : 1)
      const good = legacy(state === 'latest-linked' ? 1 : 2)
      const linked = { ...unusable.result, attemptId: unusable.id }
      delete unusable.result
      const points = [good.result]
      if (state !== 'unknown') points.push(linked)
      if (state === 'ambiguous-link') points.push({ ...linked, id: 'other-unconfirmed-time', at: '2026-11-10T09:00:00.000Z' })
      if (state === 'wrong-kind') linked.kind = 'full'
      await seed(setup, [unusable, good], points)
      const result = await setup.run('state.get')
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(result.data.level.latest, null)
      assert.equal(result.data.needsAssessment, true)
      assert.equal(result.data.syllabus.currentPhase.targetBand, '入门')
      assert.deepEqual(result.data.level.points.map(point => point.id), [good.result.id])
      assert.deepEqual((await setup.read(`assessments/${unusable.id}.json`)).answers, unusable.answers)
    })
  }
})

test('a missing latest original is still a completed-history authority and cannot silently restore an earlier result', async t => {
  const setup = await fixture(t)
  const good = legacy(1)
  const missing = legacy(2)
  await seed(setup, [good], [good.result, missing.result])
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest, null)
  assert.equal(state.data.needsAssessment, true)
  assert.deepEqual(state.data.level.points.map(point => point.id), [good.result.id])
})

test('damaged legacy originals are preserved but do not permanently block learning or restore an older backup score', async t => {
  const setup = await fixture(t)
  const good = legacy(1)
  const damaged = legacy(2)
  await seed(setup, [good, damaged])
  const target = join(setup.root, 'assessments', `${damaged.id}.json`)
  const bytes = '{damaged-original-with-original-bytes'
  await fs.writeFile(`${target}.bak`, JSON.stringify(damaged))
  await fs.writeFile(target, bytes)
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest, null)
  assert.equal(state.data.level.points.length, 1)
  assert.equal((await setup.run('assessment.resume')).data, null)
  assert.equal((await setup.run('progress.get')).ok, true)
  const recovery = await setup.read('assessment-history.json')
  assert.equal(recovery.originals.find(record => record.path === `assessments/${damaged.id}.json`).text, bytes)
  assert.equal(recovery.originals.find(record => record.path === `assessments/${damaged.id}.json.bak`).text, JSON.stringify(damaged))
  const active = await setup.read(`assessments/${damaged.id}.json`)
  assert.equal(active.status, 'invalidated')
  assert.equal(active.result, undefined)
})

test('old in-progress records are terminated even when full, keep answered anchor facts, and do not auto-start or complete', async t => {
  for (const count of [0, 4, 10]) {
    const setup = await fixture(t)
    const attempt = legacy(1)
    attempt.status = 'in_progress'
    attempt.answers = attempt.answers.slice(0, count)
    attempt.order = attempt.order.slice(0, Math.min(10, count + 1))
    if (count) { attempt.answers[0].anchor = true; attempt.answers[0].contaminated = false; attempt.answers[0].itemId = 'anchor-01'; attempt.order[0] = 'anchor-01' }
    delete attempt.result
    await seed(setup, [], [])
    await setup.put(`assessments/${attempt.id}.json`, attempt)
    const state = await setup.run('state.get')
    assert.equal(state.ok, true, JSON.stringify(state))
    assert.equal(state.data.level.latest, null)
    assert.deepEqual(state.data.level.points, [])
    const saved = await setup.read(`assessments/${attempt.id}.json`)
    assert.equal(saved.status, 'terminated')
    assert.deepEqual(saved.answers, attempt.answers)
    assert.equal(saved.result, undefined)
    const resume = await setup.run('assessment.resume')
    assert.equal(resume.ok, true, JSON.stringify(resume))
    assert.equal(resume.data.restartRequired, true)
    assert.match(resume.data.message, /开始新.*测评/)
    assert.equal(resume.data.question, undefined)
    assert.equal((await setup.run('assessment.finish', { attemptId: attempt.id })).ok, false)
    assert.equal((await setup.read('level.json')).points.length, 0)
  }
})

test('the first valid new completion replaces explicit unassessed current after conversion and rebuilds its route once', async t => {
  const setup = await fixture(t)
  const old = legacy()
  delete old.answers[0].difficulty
  await seed(setup, [old])
  const before = await setup.run('state.get')
  assert.equal(before.data.level.latest, null)
  const goal = before.data.syllabus.weekly.goals[0].id
  await setup.run('syllabus.toggleGoal', { goalId: goal, done: true })
  await setup.run('assessment.saveBank', assessmentBank('history-new'))
  let attempt = await setup.run('assessment.start', { kind: 'short' })
  for (let i = 0; i < 10; i++) attempt = await setup.run('assessment.answer', { attemptId: attempt.data.attemptId, itemId: attempt.data.question.id, responseType: 'unable' })
  assert.equal(attempt.ok, true, JSON.stringify(attempt))
  const state = await setup.run('state.get')
  assert.equal(state.data.level.latest?.attemptId, attempt.data.attemptId)
  assert.equal(state.data.level.latest?.band, '入门')
  assert.equal(state.data.needsAssessment, false)
  assert.notEqual(state.data.syllabus.weekly.goals[0].id, goal)
  assert.equal(state.data.syllabus.weekly.completedGoals, 0)
  const next = state.data.syllabus.weekly.goals[0].id
  await setup.run('syllabus.toggleGoal', { goalId: next, done: true })
  await setup.run('assessment.finish', { attemptId: attempt.data.attemptId })
  assert.equal((await setup.run('state.get')).data.syllabus.weekly.completedGoals, 1)
})

test('lifecycle version one does not preserve an old scoring result or auto-complete an old full-response round', async t => {
  const setup = await fixture(t)
  const done = legacy(1)
  done.lifecycleVersion = 1
  const pending = legacy(2)
  pending.lifecycleVersion = 1
  pending.status = 'in_progress'
  delete pending.result
  await seed(setup, [done], [done.result])
  await setup.put(`assessments/${pending.id}.json`, pending)
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest?.band, '中级')
  assert.equal(state.data.level.points.length, 1)
  assert.equal((await setup.read(`assessments/${pending.id}.json`)).status, 'terminated')
  assert.deepEqual((await setup.read(`assessments/${pending.id}.json`)).answers, pending.answers)
})

test('mixed new-rule and old history preserves the newer true result, its raw responses and its curve point', async t => {
  const source = await fixture(t)
  await source.run('assessment.saveBank', assessmentBank('mixed'))
  let result = await source.run('assessment.start', { kind: 'short' })
  for (let i = 0; i < 10; i++) result = await source.run('assessment.answer', { attemptId: result.data.attemptId, itemId: result.data.question.id, responseType: 'unable' })
  const raw = await source.read(`assessments/${result.data.attemptId}.json`)
  const point = (await source.read('level.json')).points[0]
  const setup = await fixture(t)
  const old = legacy()
  await seed(setup, [old], [old.result, point])
  await setup.put(`assessments/${raw.id}.json`, raw)
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest?.attemptId, raw.id)
  assert.deepEqual(state.data.level.points.map(entry => entry.id), [old.result.id, point.id])
  assert.deepEqual(await setup.read(`assessments/${raw.id}.json`), raw)
  assert.equal(state.data.syllabus.currentPhase.targetBand, '入门')
})

test('directory-shaped or backup-only latest originals cannot be omitted from conversion or expose a former good current', async t => {
  for (const kind of ['directory', 'backup-only']) {
    const setup = await fixture(t)
    const good = legacy(1)
    const bad = legacy(2)
    await seed(setup, [good], [good.result, bad.result])
    const target = join(setup.root, 'assessments', `${bad.id}.json`)
    if (kind === 'directory') await fs.mkdir(target)
    else await fs.writeFile(`${target}.bak`, JSON.stringify(bad))
    const state = await setup.run('state.get')
    assert.equal(state.ok, true, JSON.stringify(state))
    assert.equal(state.data.level.latest, null)
    assert.equal(state.data.level.points.length, 1)
    assert.equal((await setup.run('assessment.resume')).ok, true)
    const journal = await setup.read('assessment-history.json')
    assert.ok(journal.originals.some(record => record.path === `assessments/${bad.id}.json`), 'inventory includes non-file and absent primary identities')
  }
})

test('a missing or malformed cutover journal is not a fresh root or a successful conversion', async t => {
  for (const state of ['missing-primary', 'invalid-status', 'missing-snapshot']) {
    const setup = await fixture(t)
    const attempt = legacy()
    await seed(setup, [attempt])
    if (state === 'missing-primary') await setup.put('assessment-history.json.bak', { version: 1, scoringRule: 'six-band-grid-v1', status: 'pending' })
    else await setup.put('assessment-history.json', { version: 1, scoringRule: 'six-band-grid-v1', status: state === 'invalid-status' ? 'other' : 'pending' })
    const before = await fs.readFile(join(setup.root, 'level.json'), 'utf8')
    const result = await setup.run('state.get')
    assert.equal(result.ok, false, state)
    assert.equal(result.code, 'assessment_recovery_failed')
    assert.equal(await fs.readFile(join(setup.root, 'level.json'), 'utf8'), before)
  }
})

test('pending history recovery rejects an escaped attempt output before changing any saved facts', async t => {
  const parent = await tempFixture(t, 'coach-assessment-history-')
  const setup = await fixture(t, join(parent, 'learner'))
  const attempts = [legacy(1), legacy(2)]
  await seed(setup, attempts)
  const rename = fs.rename
  const interruption = t.mock.method(fs, 'rename', async (from, target) => {
    if (target === join(setup.root, `assessments/${attempts[0].id}.json`)) {
      throw Object.assign(new Error('synthetic pending history publication'), { code: 'EIO' })
    }
    return rename.call(fs, from, target)
  })
  assert.equal((await setup.run('state.get')).ok, false)
  interruption.mock.restore()
  const journal = await setup.read('assessment-history.json')
  assert.equal(journal.status, 'pending')
  journal.attempts[1].path = '../synthetic-keep.json'
  await setup.put('assessment-history.json', journal)
  const keep = join(parent, 'synthetic-keep.json')
  await fs.writeFile(keep, '{"synthetic":"keep these original bytes"}\n')
  const paths = [keep, ...['assessment-history.json', 'level.json', 'syllabus.json', ...attempts.map(attempt => `assessments/${attempt.id}.json`)].map(path => join(setup.root, path))]
  const before = await Promise.all(paths.map(path => fs.readFile(path, 'utf8')))
  const result = await setup.run('profile.get')
  assert.deepEqual(await Promise.all(paths.map(path => fs.readFile(path, 'utf8'))), before, 'reject every output before writing the valid first attempt, sibling, current, route or journal')
  assert.equal(result.ok, false, JSON.stringify(result))
  assert.equal(result.code, 'assessment_recovery_failed')
})

test('pending history recovery validates every canonical attempt path and rejects duplicates before publication', async t => {
  const source = await fixture(t)
  const attempts = [legacy(1), legacy(2)]
  await seed(source, attempts)
  assert.equal((await source.run('state.get')).ok, true)
  const snapshot = await source.read('assessment-history.json')
  const invalidPaths = [
    ['duplicate', snapshot.attempts[0].path],
    ['absolute', join(source.root, snapshot.attempts[1].path)],
    ['nested', 'assessments/nested/2026-11-01-short-old-2.json'],
    ['normalized traversal', 'assessments/../assessments/2026-11-01-short-old-2.json'],
    ['backslash', 'assessments/2026-11-01-short\\nested.json'],
    ['foreign file', 'level.json'],
    ['backup', 'assessments/2026-11-01-short-old-2.json.bak'],
    ['control character', 'assessments/2026-11-01-short-\u0000.json'],
    ['number', 1], ['null', null], ['object', {}], ['empty', '']
  ]
  for (const [name, path] of invalidPaths) {
    await t.test(name, async t => {
      const setup = await fixture(t)
      await seed(setup, attempts)
      const journal = structuredClone(snapshot)
      journal.status = 'pending'
      journal.attempts[1].path = path
      await setup.put('assessment-history.json', journal)
      const paths = ['assessment-history.json', 'level.json', 'syllabus.json', ...attempts.map(attempt => `assessments/${attempt.id}.json`)]
      const before = await Promise.all(paths.map(path => fs.readFile(join(setup.root, path), 'utf8')))
      const result = await setup.run('profile.get')
      assert.equal(result.ok, false, JSON.stringify(result))
      assert.equal(result.code, 'assessment_recovery_failed')
      assert.deepEqual(await Promise.all(paths.map(path => fs.readFile(join(setup.root, path), 'utf8'))), before)
      assert.deepEqual((await fs.readdir(join(setup.root, 'assessments'))).sort(), attempts.map(attempt => `${attempt.id}.json`).sort())
    })
  }
})

test('bad old route and level files are preserved for recovery and replaced once rather than locking learning forever', async t => {
  for (const damaged of ['syllabus.json', 'level.json']) {
    const setup = await fixture(t)
    const attempt = legacy()
    await seed(setup, [attempt])
    await fs.writeFile(join(setup.root, damaged), '{original-damaged')
    await fs.writeFile(join(setup.root, `${damaged}.bak`), '{older-damaged')
    const state = await setup.run('state.get')
    assert.equal(state.ok, true, JSON.stringify(state))
    assert.equal(state.data.level.latest?.band, damaged === 'level.json' ? undefined : '中级')
    assert.equal(state.data.level.points.length, 1, 'valid original history remains even if current identity is unconfirmable')
    assert.equal(state.data.syllabus.weekly.completedGoals, 0)
    const journal = await setup.read('assessment-history.json')
    assert.equal(journal.originals.find(record => record.path === damaged).text, '{original-damaged')
    assert.equal(journal.originals.find(record => record.path === `${damaged}.bak`).text, '{older-damaged')
    const goal = state.data.syllabus.weekly.goals[0].id
    await setup.run('syllabus.toggleGoal', { goalId: goal, done: true })
    assert.equal((await setup.run('state.get')).data.syllabus.weekly.completedGoals, 1)
  }
})

test('confirmed old history with an object-shaped level points container becomes unassessed without losing usable raw history', async t => {
  const setup = await fixture(t)
  const attempt = legacy()
  await seed(setup, [attempt])
  const value = { version: 1, points: {}, drift: { baseline: 0.5, streak: 2, note: null } }
  await setup.put('level.json', value)
  const bytes = await fs.readFile(join(setup.root, 'level.json'), 'utf8')
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest, null, 'unreadable completion identities must not become a best-raw current fallback')
  assert.equal(state.data.needsAssessment, true)
  assert.deepEqual(state.data.level.points.map(point => point.id), [attempt.result.id])
  assert.equal(state.data.syllabus.currentPhase.targetBand, '入门')
  assert.equal((await setup.run('progress.get')).data.curve.length, 1)
  const journal = await setup.read('assessment-history.json')
  assert.equal(journal.originals.find(record => record.path === 'level.json').text, bytes)
  assert.deepEqual((await setup.read(`assessments/${attempt.id}.json`)).answers, attempt.answers)
})

test('confirmed old history with a null level point becomes unassessed while preserving the raw curve and original bytes', async t => {
  const setup = await fixture(t)
  const attempt = legacy()
  await seed(setup, [attempt], [null])
  await fs.writeFile(join(setup.root, 'assessments', '2026-11-03-short-damaged.json'), '{torn-original')
  const bytes = await fs.readFile(join(setup.root, 'level.json'), 'utf8')
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest, null)
  assert.equal(state.data.needsAssessment, true)
  assert.deepEqual(state.data.level.points.map(point => point.id), [attempt.result.id])
  assert.equal((await setup.run('assessment.resume')).ok, true)
  const journal = await setup.read('assessment-history.json')
  assert.equal(journal.originals.find(record => record.path === 'level.json').text, bytes)
  assert.deepEqual(journal.originals.find(record => record.path === 'level.json').value.points, [null])
})

test('a malformed modern level point container is not consumed as convertible old history', async t => {
  for (const points of [{}, [null]]) {
    const setup = await fixture(t)
    await seed(setup, [legacy()])
    await setup.put('level.json', { version: 1, scoringRule: 'six-band-grid-v1', current: null, points })
    const bytes = await fs.readFile(join(setup.root, 'level.json'), 'utf8')
    const result = await setup.run('state.get')
    assert.equal(result.ok, false)
    assert.equal(result.code, 'assessment_recovery_failed')
    assert.equal(await fs.readFile(join(setup.root, 'level.json'), 'utf8'), bytes)
    await assert.rejects(fs.access(join(setup.root, 'assessment-history.json')), { code: 'ENOENT' })
  }
})

test('mixed confirmed modern raw and legacy evidence cannot turn an unmarked damaged level container into a legacy replacement', async t => {
  const source = await fixture(t)
  await source.run('assessment.saveBank', assessmentBank('modern-level-proof'))
  let response = await source.run('assessment.start', { kind: 'short' })
  while (!response.data.done) response = await source.run('assessment.answer', { attemptId: response.data.attemptId, itemId: response.data.question.id, responseType: 'unable' })
  const modern = await source.read(`assessments/${response.data.attemptId}.json`)
  const setup = await fixture(t)
  await seed(setup, [legacy()])
  await setup.put(`assessments/${modern.id}.json`, modern)
  await setup.put('level.json', { version: 1, points: {} })
  const bytes = await fs.readFile(join(setup.root, 'level.json'), 'utf8')
  const result = await setup.run('state.get')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'assessment_recovery_failed')
  assert.equal(await fs.readFile(join(setup.root, 'level.json'), 'utf8'), bytes)
  await assert.rejects(fs.access(join(setup.root, 'assessment-history.json')), { code: 'ENOENT' })
})

test('an unreadable legacy directory or original fails closed before any conversion marker or derived publication', async t => {
  for (const boundary of ['directory', 'raw', 'level', 'route', 'backup']) {
    await t.test(boundary, async t => {
      const setup = await fixture(t)
      const attempt = legacy()
      await seed(setup, [attempt])
      const target = boundary === 'directory' ? join(setup.root, 'assessments')
        : join(setup.root, boundary === 'raw' ? `assessments/${attempt.id}.json` : boundary === 'route' ? 'syllabus.json' : boundary === 'backup' ? 'level.json.bak' : 'level.json')
      const method = boundary === 'directory' ? 'readdir' : 'readFile'
      const real = fs[method]
      let blocked = true
      t.mock.method(fs, method, async (path, ...args) => {
        if (blocked && path === target) throw Object.assign(new Error('synthetic unavailable original'), { code: 'EIO' })
        return real.call(fs, path, ...args)
      })
      const before = await fs.readFile(join(setup.root, `assessments/${attempt.id}.json`), 'utf8').catch(() => null)
      for (const command of ['state.get', 'progress.get', 'assessment.resume']) assert.equal((await setup.run(command)).ok, false, command)
      await assert.rejects(fs.access(join(setup.root, 'assessment-history.json')), { code: 'ENOENT' })
      blocked = false
      if (before !== null) assert.equal(await fs.readFile(join(setup.root, `assessments/${attempt.id}.json`), 'utf8'), before)
      assert.equal((await setup.run('state.get')).data.level.latest.band, '中级')
    })
  }
})

test('after successful cutover a damaged new level authority still fails closed instead of reviving its backup', async t => {
  const setup = await fixture(t)
  const attempt = legacy()
  await seed(setup, [attempt])
  assert.equal((await setup.run('state.get')).ok, true)
  const level = join(setup.root, 'level.json')
  await fs.writeFile(level, '{damaged-after-success')
  for (const command of ['state.get', 'progress.get']) {
    const result = await setup.run(command)
    assert.equal(result.ok, false, command)
    assert.equal(result.code, 'assessment_recovery_failed')
    assert.equal(await fs.readFile(level, 'utf8'), '{damaged-after-success')
  }
})

test('every conversion publication interruption recovers in a new process from one frozen snapshot without resetting later checks', async t => {
  for (const boundary of ['intent', 'attempt', 'level', 'route', 'mark', 'mark-ack']) {
    await t.test(boundary, async t => {
      const setup = await fixture(t)
      const attempt = legacy()
      await seed(setup, [attempt])
      const rename = fs.rename
      let blocked = true
      t.mock.method(fs, 'rename', async (from, target) => {
        let match = boundary === 'attempt' && target === join(setup.root, `assessments/${attempt.id}.json`)
          || boundary === 'level' && target === join(setup.root, 'level.json')
          || boundary === 'route' && target === join(setup.root, 'syllabus.json')
        if (target === join(setup.root, 'assessment-history.json')) {
          const incoming = JSON.parse(await fs.readFile(from, 'utf8'))
          match = boundary === 'intent' && incoming.status === 'pending'
            || ['mark', 'mark-ack'].includes(boundary) && incoming.status === 'complete'
        }
        if (blocked && match) {
          if (boundary === 'mark-ack') await rename.call(fs, from, target)
          throw Object.assign(new Error(`synthetic ${boundary} interruption`), { code: 'EIO' })
        }
        return rename.call(fs, from, target)
      })
      assert.equal((await setup.run('state.get')).ok, false, boundary)
      if (boundary !== 'mark-ack') {
        const reads = await Promise.all(['state.get', 'progress.get', 'assessment.resume'].map(command => setup.run(command)))
        assert.equal(reads.every(result => result.ok === false), true, 'no public reader can expose a mixed result')
      }
      let snapshot
      if (boundary !== 'intent') {
        snapshot = await setup.read('assessment-history.json')
        assert.deepEqual(snapshot.originals.find(record => record.path === `assessments/${attempt.id}.json`).value.answers, attempt.answers)
      }
      if (['mark', 'mark-ack'].includes(boundary)) {
        const route = await setup.read('syllabus.json')
        route.weekly.goals[0].done = true
        await setup.put('syllabus.json', route)
      }
      blocked = false
      const script = `import { execute } from ${JSON.stringify(new URL('../core/index.js', import.meta.url).href)}; console.log(JSON.stringify(await execute(process.argv[1], 'state.get', {}, { now: '2026-11-11T12:00:00Z' })))`
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, setup.root])
      const recovered = JSON.parse(stdout)
      assert.equal(recovered.ok, true, JSON.stringify(recovered))
      assert.equal(recovered.data.level.latest.at, attempt.result.at)
      assert.equal(recovered.data.level.points.length, 1)
      const journal = await setup.read('assessment-history.json')
      assert.equal(journal.status, 'complete')
      if (snapshot) assert.deepEqual(journal.syllabus, snapshot.syllabus)
      assert.equal(recovered.data.syllabus.weekly.goals[0].done, ['mark', 'mark-ack'].includes(boundary))
      const goal = recovered.data.syllabus.weekly.goals[0].id
      await setup.run('syllabus.toggleGoal', { goalId: goal, done: true })
      const before = await setup.read('level.json')
      await Promise.all(['state.get', 'progress.get', 'assessment.resume'].map(command => setup.run(command)))
      assert.deepEqual(await setup.read('level.json'), before)
      assert.equal((await setup.run('state.get')).data.syllabus.weekly.goals[0].done, true)
      assert.deepEqual((await setup.read(`assessments/${attempt.id}.json`)).answers, attempt.answers)
    })
  }
})

test('conflicting or duplicate original-result associations cannot erase a later bad completion from the current decision', async t => {
  for (const conflict of ['later-point', 'duplicate-point', 'shared-result', 'kind', 'attemptId']) {
    const setup = await fixture(t)
    const good = legacy(1)
    const bad = legacy(2)
    const point = structuredClone(bad.result)
    const attempts = [good, bad]
    const points = [good.result, point]
    if (conflict === 'later-point') point.at = '2026-11-10T09:00:00Z'
    if (conflict === 'duplicate-point') points.push(structuredClone(point))
    if (conflict === 'shared-result') { const shared = legacy(3); shared.result.id = bad.result.id; attempts.push(shared) }
    if (conflict === 'kind') point.kind = 'full'
    if (conflict === 'attemptId') point.attemptId = good.id
    await seed(setup, attempts, points)
    const state = await setup.run('state.get')
    assert.equal(state.ok, true, JSON.stringify(state))
    assert.equal(state.data.level.latest, null, conflict)
    assert.equal(state.data.level.points.some(entry => entry.id === bad.result.id), false)
  }
})

test('a malformed new response authority before the first cutover command is refused rather than classified as old damage', async t => {
  const setup = await fixture(t)
  const id = '2026-11-11-short-mwbw1pc0-12345678-1234-4123-8123-123456789012'
  const path = join(setup.root, 'assessments', `${id}.json`)
  await fs.mkdir(join(setup.root, 'assessments'), { recursive: true })
  await fs.writeFile(path, '{new-authority-damaged')
  const result = await setup.run('state.get')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'assessment_recovery_failed')
  assert.equal(await fs.readFile(path, 'utf8'), '{new-authority-damaged')
  await assert.rejects(fs.access(join(setup.root, 'assessment-history.json')), { code: 'ENOENT' })
})

test('newer usable original history is not blocked by an earlier bad record or by old reading and inference tasks', async t => {
  const setup = await fixture(t)
  const bad = legacy(1)
  bad.answers[0].difficulty = null
  const good = legacy(2, 20, 'full')
  for (const answer of good.answers) answer.skill = answer.itemId.endsWith('0') ? 'reading' : 'inference'
  good.passage = 'An old long passage is evidence of the old task, not new-bank admission.'
  await seed(setup, [bad, good])
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest?.attemptId, good.id)
  assert.equal(state.data.level.latest?.band, '精通')
  assert.deepEqual(state.data.level.latest?.weaknesses, [])
  assert.deepEqual(state.data.level.points.map(point => point.id), [good.result.id])
  assert.deepEqual((await setup.read(`assessments/${good.id}.json`)).answers, good.answers)
})

test('old anchor contamination remains frozen scoring evidence without required derived flags', async t => {
  const setup = await fixture(t)
  const attempt = legacy(1, 1)
  attempt.answers[0].anchor = true
  attempt.answers[0].contaminated = true
  attempt.answers[0].difficulty = 6
  await seed(setup, [attempt])
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest.band, '入门')
  assert.deepEqual(state.data.level.latest.counts, { correct: 1, incorrect: 9, unable: 0 })
  assert.equal((await setup.read(`assessments/${attempt.id}.json`)).result.scoring.evidenceCount, 9)
  assert.deepEqual((await setup.read(`assessments/${attempt.id}.json`)).answers, attempt.answers)
})

test('conversion preserves all lesson statuses, vocabulary answers and schedules, static order, actual dates and studied-day facts', async t => {
  const source = await fixture(t)
  const lesson = date => ({ date, title: 'Synthetic history preservation', sources: [{ id: 's', url: `https://example.com/history/${date}`, fetchedAt: now.toISOString(), license: 'Synthetic fixture' }], items: [
    { id: 'r', type: 'reading', sourceId: 's', body: 'A synthetic passage.', translations: ['合成段落。'] },
    { id: 'l', type: 'listening', sourceId: 's', transcript: 'A synthetic transcript.', translations: ['合成文稿。'] },
    { id: 'e', type: 'expressions', expressions: [{ term: 'synthetic history', meaning: '合成历史' }] },
    { id: 'q', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['a', 'b', 'c', 'd'], answerIndex: 0 }] }
  ] })
  await source.run('lesson.save', lesson('2026-11-08'))
  await source.run('state.get')
  await source.run('lesson.save', lesson('2026-11-09'))
  for (const itemId of ['r', 'l', 'e', 'q']) await source.run('lesson.completeItem', { date: '2026-11-09', itemId }, new Date('2026-11-09T09:00:00Z'))
  await source.run('lesson.save', lesson('2026-11-10'))
  await source.run('lesson.start', { date: '2026-11-10' }, new Date('2026-11-10T09:00:00Z'))
  await source.run('lesson.completeItem', { date: '2026-11-10', itemId: 'r' }, new Date('2026-11-10T09:00:00Z'))
  await source.run('lesson.save', lesson('2026-11-11'))
  const added = await source.run('review.add', { items: ['mastered', 'learning'].map(term => ({ term: `history ${term}`, meaning: `合成${term}`, choices: [`合成${term}`, '甲', '乙', '丙'], answerIndex: 0 })) }, new Date('2026-10-01T09:00:00Z'))
  assert.equal(added.ok, true, JSON.stringify(added))
  for (const [i, day] of ['2026-10-01', '2026-10-02', '2026-10-09', '2026-11-08'].entries()) await source.run('review.answer', { itemId: added.data.added[0].id, choice: 0, attemptId: `history-mastered-${i}` }, new Date(`${day}T09:00:00Z`))
  await source.run('review.answer', { itemId: added.data.added[1].id, choice: 1, attemptId: 'history-learning' })
  await source.run('wordlists.select', { id: 'ielts' })
  const before = { state: (await source.run('state.get')).data, progress: (await source.run('progress.get')).data, review: await source.run('review.list'), words: await source.run('wordlists.query', { id: 'ielts', pageSize: 20 }) }
  const paths = ['progress.json', 'review/items.json', 'review/log.jsonl', 'settings.json', 'sources/provenance.jsonl', ...['08', '09', '10', '11'].map(day => `lessons/2026-11-${day}.json`)]
  const bytes = await Promise.all(paths.map(path => fs.readFile(join(source.root, path), 'utf8')))
  const setup = await fixture(t)
  for (const [i, path] of paths.entries()) { await fs.mkdir(join(setup.root, path, '..'), { recursive: true }); await fs.writeFile(join(setup.root, path), bytes[i]) }
  await seed(setup, [legacy()])
  const after = { state: (await setup.run('state.get')).data, progress: (await setup.run('progress.get')).data, review: await setup.run('review.list'), words: await setup.run('wordlists.query', { id: 'ielts', pageSize: 20 }) }
  assert.deepEqual(after.state.streak, before.state.streak)
  assert.deepEqual(after.state.review, before.state.review)
  assert.equal(after.progress.weekly.completedGoals, 0)
  assert.equal(after.progress.weekly.completedDays, 1)
  assert.deepEqual(after.progress.completions, ['2026-11-09'])
  assert.equal(after.progress.mastered, 1)
  assert.deepEqual(after.review, before.review)
  assert.deepEqual(after.words, before.words)
  assert.deepEqual((await Promise.all(['08', '09', '10', '11'].map(day => setup.run('lesson.get', { date: `2026-11-${day}` })))).map(result => result.data.lesson.status), ['expired', 'done', 'active', 'draft'])
  assert.deepEqual(await Promise.all(paths.map(path => fs.readFile(join(setup.root, path), 'utf8'))), bytes)
})

test('modern UUID raw object cannot be silently classified as empty old data during cutover', async t => {
  const setup = await fixture(t)
  await seed(setup, [legacy()])
  const path = 'assessments/2026-11-11-short-mwbw1pc0-12345678-1234-4123-8123-123456789012.json'
  await setup.put(path, { status: 'abandoned' })
  const bytes = await fs.readFile(join(setup.root, path), 'utf8')
  const result = await setup.run('state.get')
  assert.equal(result.ok, false)
  assert.equal(result.code, 'assessment_recovery_failed')
  assert.equal(await fs.readFile(join(setup.root, path), 'utf8'), bytes)
  await assert.rejects(fs.access(join(setup.root, 'assessment-history.json')), { code: 'ENOENT' })
})

test('primitive and array old originals are preserved as invalidated evidence rather than crashing or restoring an earlier current', async t => {
  for (const value of [true, 'broken', [], {}, false, 0]) {
    await t.test(JSON.stringify(value), async t => {
      const setup = await fixture(t)
      const good = legacy()
      await seed(setup, [good])
      const path = 'assessments/2026-11-03-short-unknown.json'
      await setup.put(path, value)
      const bytes = await fs.readFile(join(setup.root, path), 'utf8')
      const result = await setup.run('state.get')
      assert.equal(result.ok, true, JSON.stringify(result))
      assert.equal(result.data.level.latest, null)
      assert.deepEqual(result.data.level.points.map(point => point.id), [good.result.id])
      assert.equal((await setup.read(path)).status, 'invalidated')
      const journal = await setup.read('assessment-history.json')
      assert.equal(journal.originals.find(record => record.path === path).text, bytes)
      assert.equal((await setup.run('assessment.resume')).ok, true)
    })
  }
})

test('an abandoned old round with a damaged answer container stays preserved without permanently locking new assessment starts', async t => {
  const setup = await fixture(t)
  const old = legacy()
  old.status = 'abandoned'
  old.answers = {}
  delete old.result
  await seed(setup, [], [])
  await setup.put(`assessments/${old.id}.json`, old)
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest, null)
  await setup.run('assessment.saveBank', assessmentBank('abandoned-old'))
  const started = await setup.run('assessment.start', { kind: 'short' })
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.deepEqual((await setup.read(`assessments/${old.id}.json`)).answers, {})
  assert.equal((await setup.read(`assessments/${old.id}.json`)).status, 'abandoned')
})

test('structurally damaged old responses remain recoverable without poisoning new anchor selection or ordinary learning', async t => {
  for (const answers of [null, {}, [null], ['invalid']]) {
    const setup = await fixture(t)
    const attempt = legacy()
    attempt.answers = answers
    await seed(setup, [attempt])
    assert.equal((await setup.run('state.get')).ok, true)
    const bank = await setup.run('assessment.saveBank', assessmentBank('damaged-answers'))
    assert.equal(bank.ok, true, JSON.stringify(bank))
    const started = await setup.run('assessment.start', { kind: 'short' })
    assert.equal(started.ok, true, JSON.stringify(started))
    const journal = await setup.read('assessment-history.json')
    assert.deepEqual(journal.originals.find(record => record.path === `assessments/${attempt.id}.json`).value.answers, answers)
  }
})

test('a later unmatched level completion time still overrides a newer usable raw record when its linked raw time conflicts', async t => {
  const setup = await fixture(t)
  const conflict = legacy(1)
  const good = legacy(2)
  const laterPoint = { ...conflict.result, at: '2026-11-10T09:00:00Z' }
  await seed(setup, [conflict, good], [laterPoint, good.result])
  const state = await setup.run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.latest, null)
  assert.deepEqual(state.data.level.points.map(point => point.id), [good.result.id])
})

test('cutover and a same-band modern finalization keep one consistent assessed current curve and route', async t => {
  const source = await fixture(t)
  const complete = async (at = now) => {
    await source.run('assessment.saveBank', assessmentBank('pending-history'))
    let response = await source.run('assessment.start', { kind: 'short' }, at)
    while (!response.data.done) {
      const raw = await source.read(`assessments/${response.data.attemptId}.json`)
      const item = [...raw.pool, ...raw.anchors].find(item => item.id === response.data.question.id)
      response = await source.run('assessment.answer', { attemptId: raw.id, itemId: item.id, choice: item.answerIndex }, at)
      if (!response.ok) return response
    }
    return response
  }
  const first = await complete()
  assert.equal(first.ok, true, JSON.stringify(first))
  const firstRaw = await source.read(`assessments/${first.data.attemptId}.json`)
  const priorRoute = await source.read('syllabus.json')
  assert.notEqual(priorRoute.generatedFrom.finalBandIndex, 1)
  const rename = fs.rename
  let blocked = true
  t.mock.method(fs, 'rename', async (from, target) => {
    if (blocked && target.startsWith(join(source.root, 'assessments'))) {
      const incoming = JSON.parse(await fs.readFile(from, 'utf8'))
      if (incoming.status === 'done' && incoming.id !== firstRaw.id) throw Object.assign(new Error('synthetic pending modern done'), { code: 'EIO' })
    }
    return rename.call(fs, from, target)
  })
  const second = await complete(new Date(now.getTime() + 1000))
  assert.equal(second.ok, false)
  blocked = false
  const level = await source.read('level.json')
  const pendingPoint = level.points.at(-1)
  const pending = await source.read(`assessments/${pendingPoint.attemptId}.json`)
  assert.equal(pending.status, 'finalizing')
  assert.equal(pending.finalization.syllabus, null, 'a same-band completion reuses the route rather than rebuilding it')
  for (const intentRoute of [null, firstRaw.finalization.syllabus]) {
    const setup = await fixture(t)
    const old = legacy()
    const pendingInput = { ...pending, finalization: { ...pending.finalization, syllabus: intentRoute } }
    await seed(setup, [old], [old.result, ...level.points])
    await setup.put(`assessments/${firstRaw.id}.json`, firstRaw)
    await setup.put(`assessments/${pending.id}.json`, pendingInput)
    await setup.put('syllabus.json', priorRoute)
    const state = await setup.run('state.get')
    assert.equal(state.ok, true, JSON.stringify(state))
    assert.equal(state.data.level.latest?.attemptId, pending.id)
    assert.equal(state.data.level.latest.at, pending.finalization.point.at)
    assert.equal(state.data.syllabus.currentPhase.targetBand, state.data.level.latest.band)
    assert.deepEqual(state.data.level.points.map(point => point.id), [old.result.id, ...level.points.map(point => point.id)])
    assert.equal((await setup.read(`assessments/${pending.id}.json`)).status, 'done')
    const journal = await setup.read('assessment-history.json')
    assert.equal((await setup.read('syllabus.json')).generationId, journal.syllabus.generationId, 'neither a null nor an older saved intent route may overwrite the cutover generation')
    assert.deepEqual(journal.originals.find(record => record.path === `assessments/${pending.id}.json`).value.finalization, pendingInput.finalization)
  }
})

test('legacy done is not proof of a complete valid response set and invalid fields are never guessed or coerced', async t => {
  const corruptions = [
    attempt => { attempt.answers = [] }, attempt => { attempt.answers.pop() },
    attempt => { attempt.answers[1].itemId = attempt.answers[0].itemId },
    attempt => { attempt.kind = 'other' }, attempt => { attempt.items = 20 },
    attempt => { attempt.length = '10' }, attempt => { attempt.order.reverse() },
    attempt => { attempt.id = 'different-identity' }, attempt => { attempt.result.id = '' },
    attempt => { attempt.result.at = 'invalid' }, attempt => { attempt.createdAt = null },
    attempt => { attempt.answers[0].at = null }, attempt => { attempt.answers[0].at = '2030-01-01T00:00:00Z' },
    attempt => { attempt.answers[0].choice = null }, attempt => { attempt.answers[0].choice = '1' },
    attempt => { attempt.answers[0].correct = 'true' }, attempt => { attempt.answers[0].difficulty = '3' },
    attempt => { attempt.answers[0].anchor = 'false' }, attempt => { attempt.answers[0].anchor = true },
    attempt => { attempt.answers[0].skill = '' },
    attempt => { for (const answer of attempt.answers) { answer.anchor = true; answer.contaminated = true } }
  ]
  for (const [index, corrupt] of corruptions.entries()) {
    await t.test(`invalid original ${index}`, async t => {
      const setup = await fixture(t)
      const attempt = legacy()
      const path = `assessments/${attempt.id}.json`
      corrupt(attempt)
      await setup.put(path, attempt)
      await setup.put('level.json', { version: 1, points: [attempt.result] })
      const state = await setup.run('state.get')
      assert.equal(state.ok, true, JSON.stringify(state))
      assert.equal(state.data.level.latest, null, 'invalid original evidence is not an assessed introductory result')
      assert.equal(state.data.needsAssessment, true)
      assert.deepEqual(state.data.level.points, [])
      assert.deepEqual((await setup.read(path)).answers, attempt.answers)
    })
  }
})
