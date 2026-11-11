import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { tempFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00.000Z')
function bank() {
  return { version: 'responses', items: Array.from({ length: 24 }, (_, index) => ({
    id: `response-q-${index + 1}`, difficulty: index % 6 + 1,
    skill: index % 2 ? 'grammar' : 'vocab', prompt: 'Choose the suitable word.',
    choices: ['alpha', 'beta', 'gamma', 'delta'], answerIndex: 1,
    explanation: 'This explanation must stay on the Host.'
  })) }
}
async function fixture(t, kind = 'short') {
  const root = await tempFixture(t, 'coach-assessment-response-')
  const run = (command, payload = {}, date = now) => execute(root, command, payload, { now: date })
  assert.equal((await run('assessment.saveBank', bank())).ok, true)
  const started = await run('assessment.start', { kind })
  assert.equal(started.ok, true, JSON.stringify(started))
  const identity = { attemptId: started.data.attemptId, itemId: started.data.question.id }
  return { root, run, started: started.data, identity }
}

test('assessment choices accept integers only and invalid inputs leave the current question unanswered', async t => {
  const { run, identity, started } = await fixture(t)
  for (const choice of [null, '', ' ', true, false, '0', 0.5, -1, 4, {}, []]) {
    const rejected = await run('assessment.answer', { ...identity, choice })
    assert.equal(rejected.ok, false, `must reject ${JSON.stringify(choice)}`)
    assert.equal(rejected.code, 'invalid_field')
    assert.equal(rejected.field, 'choice')
    const resumed = await run('assessment.resume')
    assert.equal(resumed.data.progress, 0)
    assert.deepEqual(resumed.data.question, started.question)
  }
  const accepted = await run('assessment.answer', { ...identity, choice: 0 })
  assert.equal(accepted.ok, true, JSON.stringify(accepted))
  assert.equal(accepted.data.progress, 1)
})

test('explicit unable responses preserve their own fact and steer like an incorrect choice', async t => {
  const unable = await fixture(t)
  const wrong = await fixture(t)
  for (const payload of [{ responseType: 'unknown', choice: 0 }, { responseType: 'unable', choice: null }]) {
    assert.equal((await unable.run('assessment.answer', { ...unable.identity, ...payload })).ok, false)
  }
  const skipped = await unable.run('assessment.answer', { ...unable.identity, responseType: 'unable' })
  assert.equal(skipped.ok, true, JSON.stringify(skipped))
  assert.equal(skipped.data.progress, 1)
  const incorrect = await wrong.run('assessment.answer', { ...wrong.identity, responseType: 'choice', choice: 0 })
  assert.equal(incorrect.ok, true)
  assert.deepEqual(skipped.data.question, incorrect.data.question)
  const stored = JSON.parse(await fs.readFile(join(unable.root, 'assessments', `${unable.identity.attemptId}.json`), 'utf8'))
  assert.equal(stored.answers.length, 1)
  assert.equal(stored.answers[0].responseType, 'unable')
  assert.equal(stored.answers[0].choice, null)
  assert.equal(stored.answers[0].correct, false)
  assert.equal(stored.answers[0].at, now.toISOString())
  assert.equal(stored.answers[0].difficulty, unable.started.question.difficulty)
  assert.equal(stored.answers[0].skill, unable.started.question.skill)
  assert.equal(stored.answers[0].anchor, false)
})

test('stable item identity makes retry and concurrent replay safe while conflicting or stale responses cannot answer the next item', async t => {
  const { root, run, identity } = await fixture(t)
  const payload = { ...identity, responseType: 'choice', choice: 0 }
  const [first, duplicate] = await Promise.all([run('assessment.answer', payload), run('assessment.answer', payload)])
  assert.equal(first.ok, true)
  assert.equal(duplicate.ok, true, JSON.stringify(duplicate))
  assert.equal(duplicate.data.replayed, true)
  assert.equal(first.data.replayed, false)
  assert.equal(typeof first.data.responseId, 'string')
  assert.equal(duplicate.data.responseId, first.data.responseId)
  assert.equal(duplicate.data.progress, 1)
  assert.deepEqual(duplicate.data.question, first.data.question)
  for (const response of [{ responseType: 'choice', choice: 1 }, { responseType: 'unable' }]) {
    const conflict = await run('assessment.answer', { ...identity, ...response })
    assert.equal(conflict.ok, false)
    assert.equal(conflict.code, 'answer_identity_conflict')
  }
  const stale = await run('assessment.answer', { attemptId: identity.attemptId, itemId: 'not-current', choice: 0 })
  assert.equal(stale.ok, false)
  assert.equal(stale.code, 'wrong_item')
  const second = await run('assessment.answer', { attemptId: identity.attemptId, itemId: first.data.question.id, responseType: 'unable' })
  assert.equal(second.ok, true)
  const lateReplay = await run('assessment.answer', payload)
  assert.equal(lateReplay.ok, true)
  assert.equal(lateReplay.data.progress, 2)
  assert.deepEqual(lateReplay.data.question, second.data.question)
  const stored = JSON.parse(await fs.readFile(join(root, 'assessments', `${identity.attemptId}.json`), 'utf8'))
  assert.equal(stored.answers.length, 2)
  assert.equal(stored.answers[0].responseId, first.data.responseId)
})

test('assessment public acknowledgements and resumed questions never teach correctness, answers, or explanations', async t => {
  const { run, identity, started } = await fixture(t)
  const safe = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(['correct', 'answerIndex', 'explanation', 'answers', 'pool', 'anchors'].includes(key), false, key)
      safe(entry)
    }
  }
  safe(started)
  const answered = await run('assessment.answer', { ...identity, choice: 1 })
  assert.equal(answered.ok, true)
  safe(answered.data)
  safe((await run('assessment.resume')).data)
  safe((await run('assessment.answer', { ...identity, choice: 1 })).data)
})

test('only all 10 short or 20 full responses may finish; unable counts without filling unanswered items', async t => {
  for (const [kind, total] of [['short', 10], ['full', 20]]) {
    const { run, identity, started } = await fixture(t, kind)
    assert.equal(started.total, total)
    let current = started
    for (let index = 0; index < total; index++) {
      if ([0, total / 2].includes(index)) {
        const premature = await run('assessment.finish', { attemptId: identity.attemptId })
        assert.equal(premature.ok, false, `${kind}: ${index} responses must not finish`)
        assert.equal(premature.code, 'assessment_incomplete')
        assert.match(premature.message, new RegExp(`${total}`))
        assert.equal((await run('state.get')).data.level.points.length, 0)
        const resumed = await run('assessment.resume')
        assert.equal(resumed.data.progress, index)
        assert.deepEqual(resumed.data.question, current.question)
      }
      const answered = await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' })
      assert.equal(answered.ok, true, JSON.stringify(answered))
      assert.equal(answered.data.progress, index + 1)
      assert.equal(Boolean(answered.data.done), index === total - 1)
      current = answered.data
    }
    assert.equal(current.result.accuracy, 0)
    assert.equal((await run('state.get')).data.level.points.length, 1)
  }
})

test('completion separates correct, incorrect, and unable counts while all responses remain in accuracy', async t => {
  const { root, run, identity, started } = await fixture(t)
  let current = started
  for (let index = 0; index < 10; index++) {
    const stored = JSON.parse(await fs.readFile(join(root, 'assessments', `${identity.attemptId}.json`), 'utf8'))
    const item = [...stored.pool, ...stored.anchors].find(item => item.id === current.question.id)
    const response = index < 2 ? { responseType: 'choice', choice: item.answerIndex }
      : index < 5 ? { responseType: 'choice', choice: (item.answerIndex + 1) % 4 } : { responseType: 'unable' }
    const answered = await run('assessment.answer', { attemptId: identity.attemptId, itemId: item.id, ...response })
    assert.equal(answered.ok, true, JSON.stringify(answered))
    current = answered.data
  }
  assert.deepEqual(current.result.counts, { correct: 2, incorrect: 3, unable: 5 })
  assert.equal(current.result.accuracy, 0.2)
  assert.equal(Object.hasOwn(current.result, 'answers'), false)
})

test('a rejected anchor response write cannot consume first-response status or advance the saved question', async t => {
  const { root, run, identity, started } = await fixture(t)
  let current = started
  while (!current.question.id.startsWith('anchor-')) {
    const next = await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, choice: 0 })
    assert.equal(next.ok, true)
    current = next.data
  }
  const target = join(root, 'assessments', `${identity.attemptId}.json`)
  const backup = `${target}.bak`
  assert.equal(backup, join(root, 'assessments', `${identity.attemptId}.json.bak`))
  await fs.rm(backup, { force: true })
  await fs.mkdir(backup)
  const payload = { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' }
  const failed = await run('assessment.answer', payload)
  assert.equal(failed.ok, false)
  const resumed = await run('assessment.resume')
  assert.equal(resumed.data.progress, current.progress)
  assert.deepEqual(resumed.data.question, current.question)
  const log = join(root, 'anchors', 'responses.jsonl')
  let entries = []
  try { entries = (await fs.readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) } catch (error) { if (error.code !== 'ENOENT') throw error }
  assert.equal(entries.some(entry => entry.attemptId === identity.attemptId && entry.anchorId === current.question.id), false)
  assert.equal(backup, join(root, 'assessments', `${identity.attemptId}.json.bak`))
  await fs.rmdir(backup)
  assert.equal((await run('assessment.answer', payload)).ok, true)
})

test('an interrupted anchor-log projection recovers from the saved response without new first-response or duplicate facts', async t => {
  const { root, run, identity, started } = await fixture(t)
  let current = started
  while (!current.question.id.startsWith('anchor-')) current = (await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, choice: 0 })).data
  const append = fs.open
  let blocked = true
  t.mock.method(fs, 'open', async (path, ...args) => {
    if (path === join(root, 'anchors', 'responses.jsonl') && blocked) throw Object.assign(new Error('synthetic log interruption'), { code: 'EIO' })
    return append.call(fs, path, ...args)
  })
  const payload = { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' }
  assert.equal((await run('assessment.answer', payload)).ok, false)
  blocked = false
  const replay = await execute(root, 'assessment.answer', payload, { now: new Date('2026-11-12T09:00:00Z') })
  assert.equal(replay.ok, true, JSON.stringify(replay))
  assert.equal(replay.data.replayed, true)
  assert.equal(replay.data.progress, current.progress + 1)
  const entries = (await fs.readFile(join(root, 'anchors', 'responses.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].contaminated, false)
  assert.equal(entries[0].at, now.toISOString())
  assert.equal((await run('assessment.answer', payload)).ok, true)
  assert.equal((await fs.readFile(join(root, 'anchors', 'responses.jsonl'), 'utf8')).trim().split('\n').length, 1)
})

test('last-answer multi-file finalization fails closed and recovers exactly once after a lost acknowledgement', async t => {
  const { root, run, identity, started } = await fixture(t)
  let current = started
  for (let index = 0; index < 9; index++) {
    const next = await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' })
    assert.equal(next.ok, true)
    current = next.data
  }
  const rename = fs.rename
  let blocked = true
  t.mock.method(fs, 'rename', async (from, target) => {
    if (target === join(root, 'syllabus.json') && blocked) throw Object.assign(new Error('synthetic syllabus interruption'), { code: 'EIO' })
    return rename.call(fs, from, target)
  })
  const payload = { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' }
  const failed = await run('assessment.answer', payload)
  assert.equal(failed.ok, false)
  const stored = JSON.parse(await fs.readFile(join(root, 'assessments', `${identity.attemptId}.json`), 'utf8'))
  assert.equal(stored.answers.length, 10, 'last response must survive projection failure')
  assert.equal((await run('state.get')).ok, false, 'do not expose level with missing syllabus')
  assert.equal((await run('progress.get')).ok, false, 'do not expose a partially completed curve')
  blocked = false
  const later = new Date('2026-11-12T09:00:00Z')
  const recovered = await execute(root, 'assessment.answer', payload, { now: later })
  assert.equal(recovered.ok, true, JSON.stringify(recovered))
  assert.equal(recovered.data.done, true)
  assert.equal(recovered.data.replayed, true)
  assert.equal(recovered.data.progress, 10)
  const finished = await execute(root, 'assessment.finish', { attemptId: identity.attemptId }, { now: later })
  assert.equal(finished.ok, true)
  assert.equal(finished.data.done, true)
  assert.deepEqual(finished.data.result, recovered.data.result)
  const state = (await run('state.get')).data
  assert.equal(state.level.points.length, 1)
  assert.equal(state.level.latest.attemptId, identity.attemptId)
  assert.equal(state.level.latest.at, now.toISOString())
  assert.equal(state.syllabus.phases.length, 3)
  const goalId = state.syllabus.weekly.goals[0].id
  await run('syllabus.toggleGoal', { goalId, done: true })
  assert.equal((await run('assessment.answer', payload)).data.done, true)
  await run('assessment.finish', { attemptId: identity.attemptId })
  assert.equal((await run('state.get')).data.level.points.length, 1)
  assert.equal((await run('state.get')).data.syllabus.weekly.goals[0].done, true)
})

test('resume recovers an undismissed completed result until its own explicit acknowledgement succeeds', async t => {
  const { run, identity, started } = await fixture(t)
  let current = started
  for (let index = 0; index < 10; index++) current = (await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' })).data
  const resumed = await run('assessment.resume')
  assert.equal(resumed.ok, true)
  assert.equal(resumed.data?.done, true, 'a restart after losing the last acknowledgement must restore the summary')
  assert.deepEqual(resumed.data.result, current.result)
  const acknowledged = await run('assessment.acknowledge', { attemptId: identity.attemptId })
  assert.equal(acknowledged.ok, true, JSON.stringify(acknowledged))
  assert.equal((await run('assessment.resume')).data, null)
  const next = await run('assessment.start', { kind: 'short' }, new Date(now.getTime() + 1000))
  assert.equal(next.ok, true)
  assert.equal((await run('assessment.acknowledge', { attemptId: next.data.attemptId })).ok, false, 'unanswered attempts cannot be dismissed as completed')
  assert.equal((await run('assessment.acknowledge', { attemptId: identity.attemptId })).ok, true)
  assert.equal((await run('assessment.resume')).data.attemptId, next.data.attemptId, 'late acknowledgement cannot clear another attempt')
})

test('new attempts have independent identities even with a frozen clock and resume the latest lifecycle across kinds', async t => {
  const { run, identity, started } = await fixture(t)
  const answered = await run('assessment.answer', { ...identity, responseType: 'unable' })
  const second = await run('assessment.start', { kind: 'short' })
  assert.equal(second.ok, true)
  assert.notEqual(second.data.attemptId, identity.attemptId, 'same-millisecond starts must not overwrite saved responses')
  const replay = await run('assessment.answer', { ...identity, responseType: 'unable' })
  assert.equal(replay.ok, true)
  assert.equal(replay.data.progress, 1)
  assert.deepEqual(replay.data.question, answered.data.question)
  const latest = await run('assessment.start', { kind: 'full' }, new Date(now.getTime() + 1000))
  assert.equal(latest.ok, true)
  assert.equal((await run('assessment.resume')).data.attemptId, latest.data.attemptId)
  assert.equal((await run('assessment.resume')).data.total, 20)
  assert.equal(started.total, 10)
})

test('recovery does not turn a complete legacy in-progress record into a new result', async t => {
  const { root, run, identity } = await fixture(t)
  const target = join(root, 'assessments', `${identity.attemptId}.json`)
  const legacy = JSON.parse(await fs.readFile(target, 'utf8'))
  delete legacy.lifecycleVersion
  legacy.answers = legacy.pool.slice(0, 10).map(item => ({ itemId: item.id, choice: 0, correct: false, difficulty: item.difficulty, skill: item.skill, anchor: false, at: now.toISOString() }))
  await fs.writeFile(target, JSON.stringify(legacy))
  const state = await run('state.get')
  assert.equal(state.ok, true, JSON.stringify(state))
  assert.equal(state.data.level.points.length, 0, 'legacy closure belongs to the one-time conversion, not completion recovery')
  assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).status, 'in_progress')
})

test('missing remaining items rejects the response without silently finishing or losing the current question', async t => {
  const { root, run, identity, started } = await fixture(t)
  const target = join(root, 'assessments', `${identity.attemptId}.json`)
  const attempt = JSON.parse(await fs.readFile(target, 'utf8'))
  attempt.pool = attempt.pool.filter(item => item.id === started.question.id)
  attempt.anchors = []
  await fs.writeFile(target, JSON.stringify(attempt))
  const answered = await run('assessment.answer', { ...identity, responseType: 'unable' })
  assert.equal(answered.ok, false)
  assert.equal(answered.code, 'assessment_questions_unavailable')
  assert.match(answered.message, /题目不足.*重新准备/)
  const resumed = await run('assessment.resume')
  assert.equal(resumed.data.progress, 0)
  assert.deepEqual(resumed.data.question, started.question)
  assert.equal((await run('state.get')).data.level.points.length, 0)
})

test('the final accepted response has the same stable receipt on concurrent answer and finish replays', async t => {
  const { run, identity, started } = await fixture(t)
  let current = started
  for (let index = 0; index < 9; index++) current = (await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' })).data
  const payload = { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' }
  const [first, replay, finished] = await Promise.all([
    run('assessment.answer', payload), run('assessment.answer', payload), run('assessment.finish', { attemptId: identity.attemptId })
  ])
  assert.equal(first.ok, true)
  assert.equal(typeof first.data.responseId, 'string')
  assert.equal(first.data.replayed, false)
  assert.equal(replay.ok, true)
  assert.equal(replay.data.replayed, true)
  assert.equal(replay.data.responseId, first.data.responseId)
  assert.equal(finished.ok, true)
  assert.deepEqual(finished.data.result, first.data.result)
  assert.equal((await run('state.get')).data.level.points.length, 1)
})

test('a damaged level authority blocks finalization rather than re-awarding from an older backup', async t => {
  const { root, run, identity, started } = await fixture(t)
  const level = join(root, 'level.json')
  await fs.writeFile(`${level}.bak`, JSON.stringify({ version: 1, points: [], drift: { baseline: null, streak: 0, note: null } }))
  await fs.writeFile(level, '{damaged')
  let current = started
  for (let index = 0; index < 9; index++) current = (await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' })).data
  const failed = await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' })
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'assessment_recovery_failed')
  assert.equal(await fs.readFile(level, 'utf8'), '{damaged')
  assert.equal((await run('state.get')).ok, false)
})

test('a corrupt response authority never falls back to an older backup to answer or award progress again', async t => {
  const { root, run, identity } = await fixture(t)
  const payload = { ...identity, responseType: 'unable' }
  assert.equal((await run('assessment.answer', payload)).ok, true)
  const target = join(root, 'assessments', `${identity.attemptId}.json`)
  const saved = await fs.readFile(target, 'utf8')
  await fs.writeFile(target, '{damaged')
  for (const command of ['assessment.answer', 'assessment.finish', 'assessment.resume', 'state.get', 'progress.get']) {
    const failed = await run(command, payload)
    assert.equal(failed.ok, false, command)
    assert.equal(failed.code, 'assessment_recovery_failed')
    assert.equal(await fs.readFile(target, 'utf8'), '{damaged')
  }
  await fs.writeFile(target, saved)
  const replay = await run('assessment.answer', payload)
  assert.equal(replay.ok, true)
  assert.equal(replay.data.progress, 1)
  assert.equal(replay.data.replayed, true)
})

test('a missing response authority cannot resurrect an older backup as an unanswered item', async t => {
  const { root, run, identity } = await fixture(t)
  const payload = { ...identity, responseType: 'unable' }
  assert.equal((await run('assessment.answer', payload)).ok, true)
  const target = join(root, 'assessments', `${identity.attemptId}.json`)
  assert.equal(target, join(root, 'assessments', `${identity.attemptId}.json`))
  await fs.unlink(target)
  for (const command of ['assessment.answer', 'assessment.finish', 'assessment.resume', 'state.get', 'progress.get']) {
    const failed = await run(command, payload)
    assert.equal(failed.ok, false, command)
    assert.equal(failed.code, 'assessment_recovery_failed')
  }
  await assert.rejects(fs.access(target), { code: 'ENOENT' })
})

test('every last-answer publication boundary recovers in a fresh process with one result and the original completion time', async t => {
  for (const boundary of ['response', 'intent', 'level', 'done']) {
    await t.test(boundary, async t => {
      const { root, run, identity, started } = await fixture(t)
      let current = started
      for (let index = 0; index < 9; index++) current = (await run('assessment.answer', { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' })).data
      const rename = fs.rename
      let blocked = true
      t.mock.method(fs, 'rename', async (from, target) => {
        let interrupt = boundary === 'level' && target === join(root, 'level.json')
        if (target === join(root, 'assessments', `${identity.attemptId}.json`)) {
          const incoming = JSON.parse(await fs.readFile(from, 'utf8'))
          interrupt = boundary === 'response' && incoming.status === 'in_progress'
            || boundary === 'intent' && incoming.status === 'finalizing'
            || boundary === 'done' && incoming.status === 'done'
        }
        if (blocked && interrupt) { blocked = false; throw Object.assign(new Error(`synthetic ${boundary} interruption`), { code: 'EIO' }) }
        return rename.call(fs, from, target)
      })
      const payload = { attemptId: identity.attemptId, itemId: current.question.id, responseType: 'unable' }
      assert.equal((await run('assessment.answer', payload)).ok, false, boundary)
      const target = join(root, 'assessments', `${identity.attemptId}.json`)
      const saved = JSON.parse(await fs.readFile(target, 'utf8'))
      assert.equal(saved.answers.length, boundary === 'response' ? 9 : 10)
      const completeAt = boundary === 'response' ? '2026-11-12T09:00:00.000Z' : now.toISOString()
      const script = `import { execute } from ${JSON.stringify(new URL('../core/index.js', import.meta.url).href)}; const result = await execute(process.argv[1], 'assessment.answer', JSON.parse(process.argv[2]), { now: '2026-11-12T09:00:00Z' }); console.log(JSON.stringify(result))`
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root, JSON.stringify(payload)])
      const recovered = JSON.parse(stdout)
      assert.equal(recovered.ok, true, JSON.stringify(recovered))
      assert.equal(recovered.data.done, true)
      assert.equal(recovered.data.result.at, completeAt)
      const state = (await run('state.get')).data
      assert.equal(state.level.points.length, 1)
      const { drift, ...point } = recovered.data.result
      assert.deepEqual(state.level.latest, point)
      assert.deepEqual(state.level.drift, drift)
      assert.equal(state.syllabus.phases.length, 3)
      assert.deepEqual((await run('assessment.finish', { attemptId: identity.attemptId })).data.result, recovered.data.result)
    })
  }
})
