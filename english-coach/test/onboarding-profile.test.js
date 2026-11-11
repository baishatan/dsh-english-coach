import assert from 'node:assert/strict'
import test from 'node:test'
import { execute } from '../core/index.js'
import { tempFixture } from './temp-fixture.js'

const now = new Date('2026-11-09T09:00:00+08:00')
async function fixture(t) {
  const root = await tempFixture(t, 'coach-onboarding-profile-')
  return async (command, payload = {}, at = now) => {
    const result = await execute(root, command, payload, { now: at })
    assert.equal(result.ok, true, JSON.stringify(result))
    return result.data
  }
}

const profile = {
  goal: 'work', minutesPerDay: 30, targetBand: '高级',
  interests: ['合成研究主题'], workContext: '旧工作上下文：需要阅读技术文档'
}

// This is the existing public save contract, not a new model or validation rule.
test('公开画像保存允许空具体目标并完整读回多行长文本，不搬移旧工作上下文', async t => {
  const run = await fixture(t)
  const original = (await run('profile.save', profile)).profile
  assert.equal(original.goalNote, '')
  assert.equal(original.workContext, profile.workContext)
  const longGoal = `第一行：${'在跨国技术讨论中解释设计取舍。'.repeat(300)}\n第二行：保留前后空白。  `
  const saved = (await run('profile.save', { ...original, goalNote: longGoal })).profile
  const read = await run('profile.get')
  assert.equal(read.onboarded, true)
  assert.equal(read.profile.goalNote, longGoal)
  assert.equal(read.profile.workContext, profile.workContext)
  assert.equal(read.profile.createdAt, original.createdAt)
  assert.deepEqual(read.profile.interests, profile.interests)
  const cleared = (await run('profile.save', { ...saved, goalNote: '' })).profile
  assert.equal(cleared.goalNote, '')
  assert.equal((await run('state.get')).profile.goalNote, '')
  assert.equal(cleared.workContext, profile.workContext)
})

function lesson(date) {
  return {
    date, title: `合成隔离课程 ${date}`,
    sources: [{ id: 's', url: `https://example.com/synthetic/onboarding/${date}`, fetchedAt: now.toISOString(), license: '合成隔离测试材料' }],
    items: [
      { id: 'r', type: 'reading', sourceId: 's', body: 'This is synthetic reading material.', translations: ['这是合成阅读材料。'] },
      { id: 'l', type: 'listening', sourceId: 's', transcript: 'This is a synthetic transcript.', translations: ['这是合成听力文稿。'] },
      { id: 'e', type: 'expressions', expressions: [{ term: 'synthetic example', meaning: '合成示例' }] },
      { id: 'q', type: 'quiz', questions: [{ prompt: 'Choose the example.', choices: ['example', 'other', 'next', 'last'], answerIndex: 0 }] }
    ]
  }
}

// All learning facts are created and observed through execute in a temporary root.
test('具体目标保存不重建大纲，不改变成绩、各状态课程、词汇排期、真实天数或静态偏好', async t => {
  const run = await fixture(t)
  await run('profile.save', profile)
  await run('assessment.saveBank', { version: 'onboarding-preservation', items: Array.from({ length: 24 }, (_, index) => ({
    id: `onboarding-question-${index}`, difficulty: index % 6 + 1, skill: index % 2 ? 'grammar' : 'vocab',
    prompt: 'Choose the correct word.', choices: ['sample', 'other', 'next', 'last'], answerIndex: 0
  })) })
  let attempt = await run('assessment.start', { kind: 'short' })
  while (!attempt.done) attempt = await run('assessment.answer', { attemptId: attempt.attemptId, itemId: attempt.question.id, choice: 0 })
  const beforePlan = await run('state.get')
  await run('syllabus.toggleGoal', { goalId: beforePlan.syllabus.weekly.goals[0].id, done: true })

  await run('lesson.save', lesson('2026-11-07'))
  for (const itemId of ['r', 'l', 'e', 'q']) await run('lesson.completeItem', { date: '2026-11-07', itemId }, new Date('2026-11-07T09:00:00+08:00'))
  await run('lesson.save', lesson('2026-11-08'))
  await run('lesson.start', { date: '2026-11-08' }, new Date('2026-11-08T09:00:00+08:00'))
  await run('lesson.completeItem', { date: '2026-11-08', itemId: 'r' }, new Date('2026-11-08T09:00:00+08:00'))
  await run('lesson.save', lesson('2026-11-09'))

  const added = await run('review.add', { items: [
    { term: 'synthetic mastered word', meaning: '合成已掌握词', choices: ['合成已掌握词', '甲', '乙', '丙'], answerIndex: 0 },
    { term: 'synthetic learning word', meaning: '合成在学词', choices: ['合成在学词', '甲', '乙', '丙'], answerIndex: 0 }
  ] }, new Date('2026-10-01T09:00:00+08:00'))
  for (const [index, day] of ['2026-10-01', '2026-10-02', '2026-10-09', '2026-11-08'].entries()) {
    await run('review.answer', { itemId: added.added[0].id, choice: 0, attemptId: `onboarding-mastery-${index}` }, new Date(`${day}T09:00:00+08:00`))
  }
  await run('review.answer', { itemId: added.added[1].id, choice: 1, attemptId: 'onboarding-learning' })
  await run('wordlists.select', { id: 'ielts' })

  const before = {
    state: await run('state.get'), progress: await run('progress.get'), review: await run('review.list'),
    lessons: await Promise.all(['2026-11-07', '2026-11-08', '2026-11-09'].map(date => run('lesson.get', { date }))),
    words: await run('wordlists.query', { id: 'ielts', pageSize: 20 }), settings: await run('settings.get')
  }
  assert.equal(before.state.level.points.length, 1)
  assert.equal(before.state.syllabus.weekly.goals[0].done, true)
  assert.deepEqual(before.lessons.map(result => result.lesson.status), ['done', 'active', 'draft'])
  assert.equal(before.progress.completions.length, 1)
  assert.equal(before.progress.mastered, 1)
  assert.equal(before.progress.learning, 1)
  assert.equal(before.settings.study.activeWordListId, 'ielts')

  const saved = await run('profile.save', { ...before.state.profile, goalNote: '新的具体目标\n只改变画像，不重建路线。' })
  const after = await run('state.get')
  assert.equal(after.profile.goalNote, saved.profile.goalNote)
  assert.equal(after.profile.workContext, profile.workContext)
  assert.deepEqual(after.syllabus, before.state.syllabus)
  assert.deepEqual(after.level, before.state.level)
  assert.deepEqual(after.streak, before.state.streak)
  assert.deepEqual(after.review, before.state.review)
  assert.deepEqual(await run('progress.get'), before.progress)
  assert.deepEqual(await run('review.list'), before.review)
  assert.deepEqual(await run('settings.get'), before.settings)
  assert.deepEqual(await run('wordlists.query', { id: 'ielts', pageSize: 20 }), before.words)
  assert.deepEqual(await Promise.all(['2026-11-07', '2026-11-08', '2026-11-09'].map(date => run('lesson.get', { date }))), before.lessons)
})
