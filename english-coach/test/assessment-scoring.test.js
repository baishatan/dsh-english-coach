import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import { ANCHOR_POOL } from '../core/anchors.js'
import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { tempFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00.000Z')
const bands = ['入门', '初级', '中级', '中高级', '高级', '精通']
async function fixture(t) {
  const root = await tempFixture(t, 'coach-assessment-scoring-')
  const run = (command, payload = {}, at = now) => execute(root, command, payload, { now: at })
  const bank = assessmentBank('scoring')
  assert.equal((await run('assessment.saveBank', bank)).ok, true)
  return { root, run, bank }
}
async function complete(run, bank, respond, kind = 'full') {
  const keys = new Map([...bank.items, ...ANCHOR_POOL].map(item => [item.id, item.answerIndex]))
  let response = await run('assessment.start', { kind })
  assert.equal(response.ok, true, JSON.stringify(response))
  const questions = []
  while (!response.data.done) {
    const question = response.data.question
    questions.push(question)
    response = await run('assessment.answer', {
      attemptId: response.data.attemptId, itemId: question.id,
      ...respond(question, questions.length - 1, keys.get(question.id))
    })
    assert.equal(response.ok, true, JSON.stringify(response))
  }
  return { ...response.data, questions }
}

// Highest approved fixture seam for a fixed question set: seed a NEW attempt's
// at-time response facts, then finish through execute. No test scorer is used.
async function fixedAttempt(t, difficulties, outcomes, customize = () => {}) {
  const setup = await fixture(t)
  const started = await setup.run('assessment.start', { kind: difficulties.length === 10 ? 'short' : 'full' })
  assert.equal(started.ok, true)
  const target = join(setup.root, 'assessments', `${started.data.attemptId}.json`)
  const attempt = JSON.parse(await fs.readFile(target, 'utf8'))
  attempt.anchors = []
  attempt.anchorIds = []
  attempt.answers = difficulties.map((difficulty, index) => ({
    itemId: `fixed-${index}`, responseId: JSON.stringify([attempt.id, `fixed-${index}`]),
    responseType: outcomes[index] === 'unable' ? 'unable' : 'choice',
    choice: outcomes[index] === 'unable' ? null : outcomes[index] ? 1 : 0,
    correct: outcomes[index] === true, difficulty, skill: index % 2 ? 'grammar' : 'vocab',
    anchor: false, scoringEvidence: true, exclusionReason: null, at: now.toISOString()
  }))
  attempt.pool = attempt.answers.map(answer => ({ id: answer.itemId, difficulty: answer.difficulty, skill: answer.skill, answerIndex: 1 }))
  attempt.order = attempt.answers.map(answer => answer.itemId)
  attempt.current = null
  customize(attempt)
  await fs.writeFile(target, JSON.stringify(attempt))
  const finished = await setup.run('assessment.finish', { attemptId: attempt.id })
  return { ...setup, finished, target, attempt }
}

test('one correct middle-difficulty answer cannot erase nineteen incorrect responses', async t => {
  const { run, bank } = await fixture(t)
  const finished = await complete(run, bank, (_question, index, key) => ({ responseType: 'choice', choice: index === 0 ? key : (key + 1) % 4 }))
  assert.equal(finished.questions[0].difficulty, 3)
  assert.equal(finished.result.band, '入门')
  assert.deepEqual(finished.result.counts, { correct: 1, incorrect: 19, unable: 0 })
  assert.equal(finished.result.accuracy, 0.05)
})

test('an all-correct easy question set receives a usable coverage-capped band', async t => {
  const { finished } = await fixedAttempt(t, [1, 1, 1, 1, 1, 1, 1, 1, 1, 6], Array(10).fill(true))
  assert.equal(finished.ok, true, JSON.stringify(finished))
  assert.equal(finished.data.result.band, '入门', 'one difficult item does not establish high-difficulty coverage')
  assert.equal(finished.data.result.finalBandIndex, 1)
  assert.match(finished.data.result.coverageNote, /覆盖/)
})

test('completion retains a reproducible rule identity and independently checked grid optimum without the old formula', async t => {
  // Independent worked example from the approved-rule research: five easier
  // successes followed by five failures on this fixed set yield theta 2.62.
  const { finished, target } = await fixedAttempt(t, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, false, false, false, false, false])
  assert.equal(finished.ok, true, JSON.stringify(finished))
  assert.equal(finished.data.result.band, '中级')
  const saved = JSON.parse(await fs.readFile(target, 'utf8'))
  assert.equal(saved.result.scoringRule, 'six-band-grid-v1')
  assert.deepEqual(saved.result.scoring, { rawEstimate: 2.62, rawBandIndex: 3, coverageCap: 5, evidenceCount: 10 })
  assert.equal(saved.finalization.point.scoringRule, saved.result.scoringRule)
  assert.deepEqual(saved.finalization.point.scoring, saved.result.scoring)
})

test('saved response difficulty and skill survive a later overwritten question snapshot', async t => {
  const { finished } = await fixedAttempt(t, [1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [true, true, true, true, true, false, false, false, false, false], attempt => {
    for (const item of attempt.pool) { item.difficulty = 6; item.skill = 'listening'; item.answerIndex = 0 }
  })
  assert.equal(finished.ok, true, JSON.stringify(finished))
  assert.equal(finished.data.result.band, '中级')
  assert.deepEqual(finished.data.result.weaknesses, [{ skill: 'grammar', missed: 3 }, { skill: 'vocab', missed: 2 }])
})

test('complete response counts cannot award a band from malformed or empty scoring evidence', async t => {
  for (const corrupt of [
    answer => { delete answer.difficulty }, answer => { answer.difficulty = '3' },
    answer => { answer.difficulty = 0 }, answer => { answer.difficulty = 6.1 },
    answer => { answer.correct = 'false' }, answer => { delete answer.correct },
    answer => { answer.anchor = 'false' }, answer => { answer.anchor = true; delete answer.contaminated },
    answer => { answer.responseType = 'unable'; answer.correct = true }
  ]) {
    const { finished, target } = await fixedAttempt(t, Array(10).fill(3), Array(10).fill(false), attempt => corrupt(attempt.answers[0]))
    assert.equal(finished.ok, false, 'bad saved evidence is not difficulty one or an inferred error')
    assert.equal(finished.code, 'invalid_assessment_evidence')
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).status, 'in_progress')
  }
  const { finished } = await fixedAttempt(t, Array(10).fill(6), Array(10).fill(true), attempt => {
    for (const answer of attempt.answers) { answer.anchor = true; answer.contaminated = true }
  })
  assert.equal(finished.ok, false, 'an empty evidence objective does not authorize formal completion')
  assert.equal(finished.code, 'invalid_assessment_evidence')
})

test('formal new-attempt completion rejects damaged response time, identity, type, skill or choice without rejudging answers', async t => {
  for (const corrupt of [
    answer => { answer.at = 'not-a-date' }, answer => { delete answer.at },
    answer => { delete answer.responseId }, answer => { answer.responseId = 'different-response' },
    answer => { delete answer.skill }, answer => { answer.skill = 'listening' },
    answer => { answer.choice = null }, answer => { answer.choice = '0' },
    answer => { answer.choice = 4 }, answer => { delete answer.responseType },
    answer => { answer.responseType = 'unable'; answer.choice = 0 }
  ]) {
    const { finished, target } = await fixedAttempt(t, Array(10).fill(3), Array(10).fill(false), attempt => corrupt(attempt.answers[0]))
    assert.equal(finished.ok, false, 'complete counts cannot publish damaged response metadata')
    assert.equal(finished.code, 'invalid_assessment_evidence')
    assert.equal(JSON.parse(await fs.readFile(target, 'utf8')).status, 'in_progress')
  }
})

test('completed, resumed, current and progress results expose the final band but no internal scoring or anchor diagnostics', async t => {
  const { finished, run } = await fixedAttempt(t, [1, 1, 1, 1, 1, 1, 1, 1, 1, 6], Array(10).fill(true))
  assert.equal(finished.ok, true)
  const state = await run('state.get')
  const progress = await run('progress.get')
  const resumed = await run('assessment.resume')
  const replayed = await run('assessment.finish', { attemptId: finished.data.attemptId })
  const safe = value => {
    if (!value || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      assert.equal(['estimate', 'rawEstimate', 'rawBandIndex', 'coverageCap', 'scoringRule', 'scoring', 'evidenceCount', 'anchorAccuracy', 'anchorIds', 'anchors', 'driftStreak', 'baseline', 'streak', 'contaminated', 'scoringEvidence', 'exclusionReason'].includes(key), false, key)
      safe(entry)
    }
  }
  for (const result of [finished.data.result, state.data.level, progress.data.curve, progress.data.drift, resumed.data.result, replayed.data.result]) safe(result)
  for (const result of [finished.data.result, state.data.level.latest, state.data.level.points[0], progress.data.curve[0]]) {
    assert.equal(result.band, '入门')
    assert.equal(result.finalBandIndex, 1)
    assert.equal(result.attemptId, finished.data.attemptId)
  }
  assert.deepEqual(resumed.data.result, finished.data.result)
  assert.deepEqual(replayed.data.result, finished.data.result)
  assert.equal(state.data.syllabus.phases[0].targetBand, '入门', 'the available downstream current must be capped, not raw theta six')
})

test('valid full and short trajectories give introductory for all wrong or unable and proficient for all correct', async t => {
  for (const kind of ['full', 'short']) {
    for (const outcome of ['wrong', 'unable', 'correct']) {
      const { run, bank } = await fixture(t)
      const finished = await complete(run, bank, (_question, _index, key) => outcome === 'unable'
        ? { responseType: 'unable' } : { responseType: 'choice', choice: outcome === 'correct' ? key : (key + 1) % 4 }, kind)
      assert.equal(finished.result.band, outcome === 'correct' ? '精通' : '入门')
      assert.equal(finished.progress, kind === 'short' ? 10 : 20)
      assert.equal(finished.result.counts[outcome === 'correct' ? 'correct' : outcome === 'wrong' ? 'incorrect' : 'unable'], finished.progress)
    }
  }
})

test('one high-difficulty success among nineteen failures remains introductory', async t => {
  const { run, bank } = await fixture(t)
  let highSuccess = false
  const finished = await complete(run, bank, (question, _index, key) => {
    const correct = !highSuccess && question.difficulty >= 5
    if (correct) highSuccess = true
    return { responseType: 'choice', choice: correct ? key : (key + 1) % 4 }
  })
  assert.equal(highSuccess, true, 'the trajectory really contains a difficult success')
  assert.equal(finished.result.band, '入门')
  assert.deepEqual(finished.result.counts, { correct: 1, incorrect: 19, unable: 0 })
})

test('repeated anchors are excluded without derived flags while whole-attempt counts and accuracy remain intact', async t => {
  const { finished, target } = await fixedAttempt(t, [1, 1, 1, 1, 1, 1, 1, 1, 6, 6], Array(10).fill(true), attempt => {
    for (const answer of attempt.answers.slice(-2)) {
      answer.anchor = true; answer.contaminated = true
      delete answer.scoringEvidence; delete answer.exclusionReason
    }
  })
  assert.equal(finished.ok, true)
  assert.equal(finished.data.result.finalBandIndex, 1, 'remembered anchors cannot increase difficulty coverage')
  assert.deepEqual(finished.data.result.counts, { correct: 10, incorrect: 0, unable: 0 })
  assert.equal(finished.data.result.accuracy, 1)
  const saved = JSON.parse(await fs.readFile(target, 'utf8'))
  assert.equal(saved.result.scoring.evidenceCount, 8)
  assert.equal(saved.result.scoring.coverageCap, 1)
})

test('ordinary items reused across attempts still supply full scoring evidence without old scores or goals boosting it', async t => {
  const { run, bank, root } = await fixture(t)
  await run('profile.save', { goal: 'work', targetBand: '精通', minutesPerDay: 30, interests: [] })
  for (let round = 0; round < 5; round++) {
    const finished = await complete(run, bank, (_question, _index, key) => ({ responseType: 'choice', choice: key }))
    const saved = JSON.parse(await fs.readFile(join(root, 'assessments', `${finished.attemptId}.json`), 'utf8'))
    assert.equal(saved.result.scoring.evidenceCount, 20)
    assert.equal(finished.result.band, '精通')
  }
  const low = await complete(run, bank, () => ({ responseType: 'unable' }))
  assert.equal(low.result.band, '入门', 'past proficient scores and an aspirational target do not raise this result')
})

test('fixed-item correct-to-wrong or unable changes never raise the final band or internal grid estimate', async t => {
  const sets = [[1, 1, 2, 2, 3, 3, 4, 4, 5, 6], [1, 1, 1, 1, 1, 1, 1, 1, 6, 6]]
  let seed = 0x4a11cafe
  for (const difficulties of sets) {
    for (let sample = 0; sample < 4; sample++) {
      const outcomes = difficulties.map(() => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 < 0.75 })
      const baseline = await fixedAttempt(t, difficulties, outcomes)
      const raw = JSON.parse(await fs.readFile(baseline.target, 'utf8')).result.scoring.rawEstimate
      for (let index = 0; index < outcomes.length; index++) {
        if (!outcomes[index]) continue
        const degraded = [...outcomes]; degraded[index] = false
        const wrong = await fixedAttempt(t, difficulties, degraded)
        degraded[index] = 'unable'
        const unable = await fixedAttempt(t, difficulties, degraded)
        const wrongRaw = JSON.parse(await fs.readFile(wrong.target, 'utf8')).result.scoring.rawEstimate
        const unableRaw = JSON.parse(await fs.readFile(unable.target, 'utf8')).result.scoring.rawEstimate
        assert.ok(wrongRaw <= raw, `same-set downgrade must not raise ${raw} to ${wrongRaw}`)
        assert.ok(wrong.finished.data.result.finalBandIndex <= baseline.finished.data.result.finalBandIndex)
        assert.equal(unableRaw, wrongRaw)
        assert.equal(unable.finished.data.result.finalBandIndex, wrong.finished.data.result.finalBandIndex)
      }
    }
  }
})

test('fixed-seed guessing and mislabeled-difficulty pressure samples stay reproducible through public trajectories', async t => {
  const histograms = {}
  for (const kind of ['short', 'full']) {
    const histogram = [0, 0, 0, 0, 0, 0]
    for (let sample = 0; sample < 24; sample++) {
      const { run, bank } = await fixture(t)
      let seed = (0x4a11cafe + sample * 7919) >>> 0
      const finished = await complete(run, bank, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return { responseType: 'choice', choice: Math.floor(seed / 2 ** 32 * 4) }
      }, kind)
      assert.ok(bands.includes(finished.result.band))
      assert.equal(finished.result.finalBandIndex, bands.indexOf(finished.result.band) + 1)
      assert.equal(Object.values(finished.result.counts).reduce((sum, n) => sum + n, 0), kind === 'short' ? 10 : 20)
      histogram[finished.result.finalBandIndex - 1]++
    }
    histograms[kind] = histogram
  }
  t.diagnostic(`seed 0x4a11cafe; uniform option choices; 24 per kind; bands introductory..proficient ${JSON.stringify(histograms)}`)
  // Same recorded success pattern with inflated labels is intentionally not
  // corrected by the heuristic: metadata quality still matters.
  const baseline = await fixedAttempt(t, [1, 1, 1, 2, 2, 3, 3, 4, 4, 5], [true, true, true, true, true, true, false, false, false, false])
  const inflated = await fixedAttempt(t, [2, 2, 2, 3, 3, 4, 4, 5, 5, 6], [true, true, true, true, true, true, false, false, false, false])
  assert.ok(inflated.finished.data.result.finalBandIndex > baseline.finished.data.result.finalBandIndex, 'the model cannot discover inflated difficulty labels')
})

test('literal grid optima retain exact rounding and a second-highest effective difficulty cap', async t => {
  const difficulties = [1, 1, 2, 2, 3, 3, 4, 4, 5, 6]
  for (const [correct, raw, rawBand, finalBand] of [[0, 1, 1, 1], [4, 2.08, 2, 2], [7, 3.84, 4, 4], [8, 4.6, 5, 5], [9, 5.5, 6, 5], [10, 6, 6, 5]]) {
    const { finished, target } = await fixedAttempt(t, difficulties, difficulties.map((_, i) => i < correct))
    assert.equal(finished.ok, true)
    const saved = JSON.parse(await fs.readFile(target, 'utf8'))
    assert.equal(saved.result.scoring.rawEstimate, raw)
    assert.equal(saved.result.scoring.rawBandIndex, rawBand)
    assert.equal(finished.data.result.finalBandIndex, finalBand)
    assert.equal(finished.data.result.band, bands[finalBand - 1])
  }
})

test('all six bands have short-question vocabulary and grammar references with the fixed scope statement', async t => {
  const difficulties = [1, 1, 2, 2, 3, 3, 4, 4, 6, 6]
  // Independently checked examples, not an accuracy-to-band table.
  const examples = [[0, 1], [4, 2], [5, 3], [7, 4], [8, 5], [10, 6]]
  for (const [correct, index] of examples) {
    const { finished } = await fixedAttempt(t, difficulties, difficulties.map((_, i) => i < correct))
    assert.equal(finished.ok, true, JSON.stringify(finished))
    const result = finished.data.result
    assert.equal(result.band, bands[index - 1])
    assert.equal(result.finalBandIndex, index)
    assert.match(result.reference, /词汇|语法|句式|搭配/)
    assert.doesNotMatch(result.reference, /四级|六级|考试|长文|听力|口语|中文一样/)
    assert.equal(result.scope, '根据词汇与语法短题估计，仅供安排学习')
  }
})
