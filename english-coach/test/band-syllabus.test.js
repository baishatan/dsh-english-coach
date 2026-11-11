import assert from 'node:assert/strict'
import test from 'node:test'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'

import { execute } from '../core/index.js'
import { assessmentBank } from './assessment-bank-fixture.js'
import { ANCHOR_POOL } from '../core/anchors.js'
import { tempFixture } from './temp-fixture.js'

const now = new Date('2026-11-11T09:00:00.000Z')
async function fixture(t) {
  const root = await tempFixture(t, 'coach-band-syllabus-')
  const run = (command, payload = {}, at = now) => execute(root, command, payload, { now: at })
  const read = async () => {
    const result = await run('state.get')
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.data
  }
  return { root, run, read }
}
async function complete(run, decide = () => ({ responseType: 'unable' })) {
  const bank = assessmentBank('route')
  assert.equal((await run('assessment.saveBank', bank)).ok, true)
  const keys = new Map([...bank.items, ...ANCHOR_POOL].map(item => [item.id, item.answerIndex]))
  let response = await run('assessment.start', { kind: 'short' })
  assert.equal(response.ok, true, JSON.stringify(response))
  while (!response.data.done) {
    response = await run('assessment.answer', {
      attemptId: response.data.attemptId, itemId: response.data.question.id,
      ...decide(response.data.question, keys.get(response.data.question.id))
    })
    assert.equal(response.ok, true, JSON.stringify(response))
  }
  return response.data
}

test('explicit regeneration replaces checked weekly goals even for an unassessed introductory route', async t => {
  const { run, read } = await fixture(t)
  assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 20, targetBand: '精通' })).ok, true)
  assert.equal((await run('syllabus.generate')).ok, true)
  const before = await read()
  assert.equal(before.level.latest, null)
  assert.deepEqual(before.level.points, [])
  assert.equal(before.needsAssessment, true)
  assert.equal(before.syllabus.currentPhase.targetBand, '入门')
  assert.equal(before.syllabus.phases.at(-1).targetBand, '精通', 'aspiration directs the future, not the starting point')
  const oldGoal = before.syllabus.weekly.goals[0]
  assert.equal((await run('syllabus.toggleGoal', { goalId: oldGoal.id, done: true })).ok, true)
  assert.equal((await read()).syllabus.weekly.completedGoals, 1)

  const regenerated = await run('syllabus.generate')
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated))
  const after = await read()
  assert.equal(after.syllabus.weekly.completedGoals, 0, 'new planning goals start unchecked')
  assert.equal(after.syllabus.weekly.goals.every(goal => goal.done === false), true)
  assert.notEqual(after.syllabus.weekly.goals[0].id, oldGoal.id, 'the same visible position is a new goal identity')
  assert.equal(after.level.latest, null)
  assert.deepEqual(after.level.points, [])
})

test('first valid introductory result replaces an unassessed route, while another introductory result preserves it', async t => {
  const { run, read } = await fixture(t)
  await run('syllabus.generate')
  const initial = await read()
  await run('syllabus.toggleGoal', { goalId: initial.syllabus.weekly.goals[0].id, done: true })
  const first = await complete(run)
  assert.equal(first.result.finalBandIndex, 1)
  const assessed = await read()
  assert.equal(assessed.level.latest.id, first.result.id)
  assert.equal(assessed.needsAssessment, false)
  assert.notEqual(assessed.syllabus.weekly.goals[0].id, initial.syllabus.weekly.goals[0].id, 'unassessed and valid introductory are different starting facts')
  assert.equal(assessed.syllabus.weekly.completedGoals, 0)
  for (const done of [true, false]) assert.equal((await run('syllabus.toggleGoal', { goalId: initial.syllabus.weekly.goals[0].id, done })).ok, false)
  assert.deepEqual((await read()).syllabus, assessed.syllabus)
  await run('syllabus.toggleGoal', { goalId: assessed.syllabus.weekly.goals[0].id, done: true })
  const kept = (await read()).syllabus
  await complete(run)
  assert.deepEqual((await read()).syllabus, kept, 'same-band reassessment must retain the route, phase and checked goals')
})

test('saving a replacement route replaces the current phase and weekly content with fresh goal identities', async t => {
  const { run, read } = await fixture(t)
  await run('syllabus.generate')
  const before = await read()
  const oldGoal = before.syllabus.weekly.goals[0]
  await run('syllabus.toggleGoal', { goalId: oldGoal.id, done: true })
  const saved = await run('syllabus.save', { phases: [
    { id: 'first', name: '新阶段一', goal: '练熟词汇', focus: ['新目标一'] },
    { id: 'second', name: '新阶段二', goal: '练熟语法', focus: ['新目标二', '新目标三'] }
  ], currentPhaseId: 'second' })
  assert.equal(saved.ok, true, JSON.stringify(saved))
  const after = await read()
  assert.equal(after.syllabus.currentPhase.name, '新阶段二')
  assert.deepEqual(after.syllabus.weekly.goals.map(goal => [goal.text, goal.done]), [['新目标二', false], ['新目标三', false]])
  for (const done of [true, false]) {
    const stale = await run('syllabus.toggleGoal', { goalId: oldGoal.id, done })
    assert.equal(stale.ok, false, 'both late check and uncheck must reject the old goal')
  }
  assert.deepEqual((await read()).syllabus, after.syllabus)
})

test('an interrupted completion does not clear already-published same-generation checked goals during recovery', async t => {
  const { root, run, read } = await fixture(t)
  const rename = fs.rename
  let interrupted = false
  t.mock.method(fs, 'rename', async (from, target) => {
    if (!interrupted && target.startsWith(join(root, 'assessments')) && target.endsWith('.json')) {
      const next = JSON.parse(await fs.readFile(from, 'utf8'))
      if (next.status === 'done') {
        interrupted = true
        throw Object.assign(new Error('synthetic lost completion publication'), { code: 'EIO' })
      }
    }
    return rename.call(fs, from, target)
  })
  const bank = assessmentBank('route')
  await run('assessment.saveBank', bank)
  let response = await run('assessment.start', { kind: 'short' })
  const attemptId = response.data.attemptId
  let last
  for (let index = 0; index < 10; index++) {
    last = { attemptId, itemId: response.data.question.id, responseType: 'unable' }
    response = await run('assessment.answer', last)
  }
  assert.equal(response.ok, false)
  const syllabusFile = join(root, 'syllabus.json')
  const published = JSON.parse(await fs.readFile(syllabusFile, 'utf8'))
  // External I/O fixture: the durable route is newer than the intent snapshot's
  // unchecked projection. Recovery must not mistake that for an unpublished route.
  published.weekly.goals[0].done = true
  await fs.writeFile(syllabusFile, JSON.stringify(published))
  const recovered = await run('assessment.answer', last)
  assert.equal(recovered.ok, true, JSON.stringify(recovered))
  assert.equal(recovered.data.replayed, true)
  const after = await read()
  assert.equal(after.level.points.length, 1)
  assert.equal(after.syllabus.weekly.goals[0].id, published.weekly.goals[0].id)
  assert.equal(after.syllabus.weekly.goals[0].done, true, 'same generation is already published, even when checks differ from the intent')
})

test('a missing syllabus authority with an unusable backup fails closed instead of rebuilding over lost checks', async t => {
  const { root, run, read } = await fixture(t)
  await run('syllabus.generate')
  const before = await read()
  await run('syllabus.toggleGoal', { goalId: before.syllabus.weekly.goals[0].id, done: true })
  const target = join(root, 'syllabus.json')
  const saved = await fs.readFile(target, 'utf8')
  assert.equal(target, join(root, 'syllabus.json'))
  await fs.unlink(target)
  await fs.writeFile(`${target}.bak`, '{unusable-backup')
  const failed = await run('syllabus.generate')
  assert.equal(failed.ok, false, 'an absent authority is not a fresh route when any backup remains')
  assert.equal(failed.code, 'assessment_recovery_failed')
  await assert.rejects(fs.access(target), { code: 'ENOENT' })
  assert.equal(await fs.readFile(`${target}.bak`, 'utf8'), '{unusable-backup')
  await fs.writeFile(target, saved)
  assert.equal((await read()).syllabus.weekly.completedGoals, 1)
})

test('band increases and decreases rebuild once, while reads, profile edits and host restarts retain the new route', async t => {
  const { root, run, read } = await fixture(t)
  await complete(run)
  const first = await read()
  await run('syllabus.toggleGoal', { goalId: first.syllabus.weekly.goals[0].id, done: true })
  const higher = await complete(run, (_question, key) => ({ responseType: 'choice', choice: key }))
  assert.ok(higher.result.finalBandIndex > 1)
  const raised = await read()
  assert.equal(raised.syllabus.currentPhase.targetBand, higher.result.band)
  assert.notEqual(raised.syllabus.weekly.goals[0].id, first.syllabus.weekly.goals[0].id)
  assert.equal(raised.syllabus.weekly.completedGoals, 0)
  await run('syllabus.toggleGoal', { goalId: raised.syllabus.weekly.goals[0].id, done: true })
  const kept = (await read()).syllabus
  await run('profile.save', { goal: 'study', goalNote: '未来目标改变，不是当前能力改变', minutesPerDay: 30, targetBand: '入门' })
  await run('progress.get')
  assert.deepEqual((await read()).syllabus, kept)
  const script = `import { execute } from ${JSON.stringify(new URL('../core/index.js', import.meta.url).href)}; console.log(JSON.stringify(await execute(process.argv[1], 'state.get', {}, {now: process.argv[2]})))`
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root, now.toISOString()])
  assert.deepEqual(JSON.parse(stdout).data.syllabus, kept)
  const regenerated = await run('syllabus.generate')
  assert.equal(regenerated.ok, true)
  const lowTarget = await read()
  assert.equal(lowTarget.syllabus.currentPhase.targetBand, higher.result.band, 'a lower aspiration cannot clamp the current band')
  const lowered = await complete(run)
  assert.equal(lowered.result.finalBandIndex, 1)
  const after = await read()
  assert.equal(after.syllabus.currentPhase.targetBand, '入门')
  assert.equal(after.syllabus.weekly.completedGoals, 0)
  assert.notEqual(after.syllabus.weekly.goals[0].id, lowTarget.syllabus.weekly.goals[0].id)
  assert.equal(after.level.points.length, 3)
})

test('completion cannot replace older results when the level authority is absent and its backup is unusable', async t => {
  const { root, run } = await fixture(t)
  await complete(run)
  const levelFile = join(root, 'level.json')
  const savedLevel = await fs.readFile(levelFile, 'utf8')
  await run('assessment.saveBank', assessmentBank('route'))
  let response = await run('assessment.start', { kind: 'short' })
  const attemptId = response.data.attemptId
  for (let index = 0; index < 9; index++) response = await run('assessment.answer', { attemptId, itemId: response.data.question.id, responseType: 'unable' })
  assert.equal(levelFile, join(root, 'level.json'))
  await fs.unlink(levelFile)
  await fs.writeFile(`${levelFile}.bak`, '{unusable-backup')
  const payload = { attemptId, itemId: response.data.question.id, responseType: 'unable' }
  const failed = await run('assessment.answer', payload)
  assert.equal(failed.ok, false, 'missing level with a backup cannot be treated as no previous ability')
  assert.equal(failed.code, 'assessment_recovery_failed')
  assert.equal((await run('state.get')).ok, false, 'pending completion must not expose a partial current result')
  await assert.rejects(fs.access(levelFile), { code: 'ENOENT' })
  await fs.writeFile(levelFile, savedLevel)
  const recovered = await run('assessment.answer', payload)
  assert.equal(recovered.ok, true, JSON.stringify(recovered))
  const state = (await run('state.get')).data
  assert.equal(state.level.points.length, 2)
  assert.equal(state.level.points[0].id, JSON.parse(savedLevel).points[0].id)
})

function lesson(date) {
  return { date, title: `Synthetic route preservation ${date}`,
    sources: [{ id: 's', url: `https://example.com/synthetic/route/${date}`, fetchedAt: now.toISOString(), license: 'Synthetic isolated fixture' }],
    items: [
      { id: 'r', type: 'reading', sourceId: 's', body: 'This is a synthetic passage.', translations: ['这是合成段落。'] },
      { id: 'l', type: 'listening', sourceId: 's', transcript: 'This is a synthetic transcript.', translations: ['这是合成文稿。'] },
      { id: 'e', type: 'expressions', expressions: [{ term: 'synthetic example', meaning: '合成示例' }] },
      { id: 'q', type: 'quiz', questions: [{ prompt: 'Choose the example.', choices: ['example', 'other', 'next', 'last'], answerIndex: 0 }] }
    ] }
}
async function protectionFacts(run) {
  return {
    lessons: await Promise.all(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'].map(date => run('lesson.get', { date }))),
    review: await run('review.list'), settings: await run('settings.get'),
    words: await run('wordlists.query', { id: 'ielts', pageSize: 20 }),
    progress: (await run('progress.get')).data, state: (await run('state.get')).data
  }
}

test('weekly resets preserve all lesson states, vocabulary facts, static order and actual studied days', async t => {
  const { root, run } = await fixture(t)
  await run('lesson.save', lesson('2026-11-08'))
  await run('state.get') // Expire the untouched old draft before measuring protection.
  await run('lesson.save', lesson('2026-11-09'))
  for (const itemId of ['r', 'l', 'e', 'q']) await run('lesson.completeItem', { date: '2026-11-09', itemId }, new Date('2026-11-09T09:00:00Z'))
  await run('lesson.save', lesson('2026-11-10'))
  await run('lesson.start', { date: '2026-11-10' }, new Date('2026-11-10T09:00:00Z'))
  await run('lesson.completeItem', { date: '2026-11-10', itemId: 'r' }, new Date('2026-11-10T09:00:00Z'))
  await run('lesson.save', lesson('2026-11-11'))
  const added = await run('review.add', { items: [
    { term: 'route mastered word', meaning: '合成掌握词', choices: ['合成掌握词', '甲', '乙', '丙'], answerIndex: 0 },
    { term: 'route learning word', meaning: '合成在学词', choices: ['合成在学词', '甲', '乙', '丙'], answerIndex: 0 },
    { term: 'route fresh word', meaning: '合成新词', choices: ['合成新词', '甲', '乙', '丙'], answerIndex: 0 }
  ] }, new Date('2026-10-01T09:00:00Z'))
  assert.equal(added.ok, true)
  for (const [index, day] of ['2026-10-01', '2026-10-02', '2026-10-09', '2026-11-08'].entries()) {
    assert.equal((await run('review.answer', { itemId: added.data.added[0].id, choice: 0, attemptId: `route-mastered-${index}` }, new Date(`${day}T09:00:00Z`))).ok, true)
  }
  assert.equal((await run('review.answer', { itemId: added.data.added[1].id, choice: 1, attemptId: 'route-learning' })).ok, true)
  await run('wordlists.select', { id: 'ielts' })
  await run('syllabus.generate')
  const state = (await run('state.get')).data
  await run('syllabus.toggleGoal', { goalId: state.syllabus.weekly.goals[0].id, done: true })
  const before = await protectionFacts(run)
  assert.deepEqual(before.lessons.map(result => result.data.lesson.status), ['expired', 'done', 'active', 'draft'])
  assert.equal(before.progress.mastered, 1)
  assert.equal(before.progress.weekly.completedGoals, 1)
  assert.equal(before.progress.weekly.completedDays, 1)
  assert.deepEqual(before.progress.completions, ['2026-11-09'])
  const paths = ['progress.json', 'review/items.json', 'review/log.jsonl', 'settings.json', ...['08', '09', '10', '11'].map(day => `lessons/2026-11-${day}.json`)]
  const bytes = await Promise.all(paths.map(path => fs.readFile(join(root, path), 'utf8')))

  await complete(run)
  const after = await protectionFacts(run)
  assert.equal(after.progress.weekly.completedGoals, 0)
  assert.equal(after.progress.weekly.completedDays, 1, 'studied days do not come from goal checkboxes')
  assert.deepEqual(after.progress.completions, before.progress.completions)
  assert.deepEqual(after.state.streak, before.state.streak)
  assert.deepEqual(after.state.review, before.state.review)
  for (const key of ['lessons', 'review', 'words', 'settings']) assert.deepEqual(after[key], before[key], key)
  assert.deepEqual(await Promise.all(paths.map(path => fs.readFile(join(root, path), 'utf8'))), bytes, 'no learning fact file is rewritten')
})

test('a coverage-capped completion and explicit regeneration start at the public final band, never the raw internal estimate', async t => {
  const { root, run, read } = await fixture(t)
  await run('profile.save', { goal: 'study', minutesPerDay: 20, targetBand: '精通' })
  await run('assessment.saveBank', assessmentBank('route'))
  const started = await run('assessment.start', { kind: 'short' })
  const target = join(root, 'assessments', `${started.data.attemptId}.json`)
  const attempt = JSON.parse(await fs.readFile(target, 'utf8'))
  // Approved new-attempt evidence fixture: nine easy successes and a single
  // difficult success have a high raw estimate but coverage only establishes 1.
  attempt.anchors = []
  attempt.anchorIds = []
  attempt.answers = [1, 1, 1, 1, 1, 1, 1, 1, 1, 6].map((difficulty, index) => ({
    itemId: `route-fixed-${index}`, responseId: JSON.stringify([attempt.id, `route-fixed-${index}`]),
    responseType: 'choice', choice: 0, correct: true, difficulty,
    skill: index % 2 ? 'grammar' : 'vocab', anchor: false, at: now.toISOString()
  }))
  attempt.order = attempt.answers.map(answer => answer.itemId)
  attempt.current = null
  await fs.writeFile(target, JSON.stringify(attempt))
  const finished = await run('assessment.finish', { attemptId: attempt.id })
  assert.equal(finished.ok, true, JSON.stringify(finished))
  assert.equal(finished.data.result.finalBandIndex, 1)
  assert.equal(finished.data.result.band, '入门')
  assert.equal((await read()).syllabus.currentPhase.targetBand, '入门')
  const stored = JSON.parse(await fs.readFile(target, 'utf8'))
  assert.ok(stored.result.scoring.rawEstimate > 2)
  await run('syllabus.generate')
  const regenerated = await read()
  assert.equal(regenerated.syllabus.currentPhase.targetBand, '入门')
  assert.equal(regenerated.syllabus.phases.at(-1).targetBand, '精通')
  assert.doesNotMatch(JSON.stringify(regenerated.syllabus), /rawEstimate|scoringRule|coverageCap/)
})

test('route readers and writers preserve a corrupt authority instead of restoring older checked goals', async t => {
  const { root, run, read } = await fixture(t)
  await run('syllabus.generate')
  const before = await read()
  const payload = { goalId: before.syllabus.weekly.goals[0].id, done: true }
  await run('syllabus.toggleGoal', payload)
  const target = join(root, 'syllabus.json')
  const saved = await fs.readFile(target, 'utf8')
  await fs.writeFile(target, '{damaged-route')
  for (const command of ['state.get', 'progress.get', 'syllabus.generate', 'syllabus.toggleGoal', 'syllabus.save']) {
    const failed = await run(command, command === 'syllabus.save' ? { phases: [{ name: '新阶段', goal: '不能覆盖坏权威' }] } : payload)
    assert.equal(failed.ok, false, command)
    assert.equal(failed.code, 'assessment_recovery_failed', command)
    assert.equal(await fs.readFile(target, 'utf8'), '{damaged-route')
  }
  await fs.writeFile(target, saved)
  assert.equal((await read()).syllabus.weekly.completedGoals, 1)
})

test('band-change publication faults recover the journaled route generation once in a fresh host', async t => {
  for (const boundary of ['intent', 'level', 'syllabus', 'done']) {
    await t.test(boundary, async t => {
      const { root, run, read } = await fixture(t)
      await complete(run)
      const before = await read()
      await run('syllabus.toggleGoal', { goalId: before.syllabus.weekly.goals[0].id, done: true })
      await run('assessment.saveBank', assessmentBank('route'))
      const keys = new Map([...assessmentBank('route').items, ...ANCHOR_POOL].map(item => [item.id, item.answerIndex]))
      let response = await run('assessment.start', { kind: 'short' })
      const attemptId = response.data.attemptId
      for (let index = 0; index < 9; index++) response = await run('assessment.answer', { attemptId, itemId: response.data.question.id, choice: keys.get(response.data.question.id) })
      const target = join(root, 'assessments', `${attemptId}.json`)
      const rename = fs.rename
      let blocked = true
      t.mock.method(fs, 'rename', async (from, destination) => {
        let interrupt = boundary === 'level' && destination === join(root, 'level.json') || boundary === 'syllabus' && destination === join(root, 'syllabus.json')
        if (destination === target) {
          const next = JSON.parse(await fs.readFile(from, 'utf8'))
          interrupt = boundary === 'intent' && next.status === 'finalizing' || boundary === 'done' && next.status === 'done'
        }
        if (blocked && interrupt) throw Object.assign(new Error(`synthetic route ${boundary} fault`), { code: 'EIO' })
        return rename.call(fs, from, destination)
      })
      const last = { attemptId, itemId: response.data.question.id, choice: keys.get(response.data.question.id) }
      assert.equal((await run('assessment.answer', last)).ok, false)
      assert.equal((await run('state.get')).ok, false, 'no mixed current/route can escape a pending completion')
      assert.equal((await run('progress.get')).ok, false)
      const pending = JSON.parse(await fs.readFile(target, 'utf8'))
      assert.equal(pending.answers.length, 10)
      const generationId = pending.finalization?.syllabus.generationId ?? `assessment-${attemptId}`
      blocked = false
      const script = `import { execute } from ${JSON.stringify(new URL('../core/index.js', import.meta.url).href)}; console.log(JSON.stringify(await execute(process.argv[1], 'assessment.answer', JSON.parse(process.argv[2]), {now: process.argv[3]})))`
      const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script, root, JSON.stringify(last), '2026-11-11T10:00:00Z'])
      const recovered = JSON.parse(stdout)
      assert.equal(recovered.ok, true, JSON.stringify(recovered))
      assert.equal(recovered.data.result.at, now.toISOString())
      const after = await read()
      assert.equal(after.level.points.length, 2)
      assert.equal(after.syllabus.currentPhase.targetBand, recovered.data.result.band)
      assert.equal(after.syllabus.weekly.completedGoals, 0)
      const persisted = JSON.parse(await fs.readFile(join(root, 'syllabus.json'), 'utf8'))
      assert.equal(persisted.generationId, generationId)
      await run('syllabus.toggleGoal', { goalId: after.syllabus.weekly.goals[0].id, done: true })
      const checked = (await read()).syllabus
      await run('assessment.finish', { attemptId })
      await run('assessment.answer', last)
      assert.deepEqual((await read()).syllabus, checked, 'finish and last-answer retries cannot clear the recovered route')
      assert.equal((await read()).level.points.length, 2)
    })
  }
})
