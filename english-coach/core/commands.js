import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'

import {
  ANCHORS_PER_ASSESSMENT,
  ASSESSMENT_LENGTH,
  ASSESSMENT_SCOPE,
  BANDS,
  KOKORO_VOICES,
  READING_RATES,
  SHORT_ASSESSMENT_LENGTH,
  addDays,
  clamp,
  dateOf,
  daysBetween,
  isIsoTimestamp
} from './constants.js'
import { ANCHOR_POOL, anchorStore, hashAnchors } from './anchors.js'
import { fail } from './errors.js'
import {
  isComplete,
  remainingMinutes,
  renderLessonMarkdown,
  seededShuffle,
  validateLesson
} from './lesson.js'
import { advance, countMastered, dueItems, hasAnswered, isDue } from './review.js'
import { enrol, termKey } from './vocabulary.js'
import { getWordCatalog } from './catalog.js'
import { scoreAssessment, nextDrift, SCORING_RULE } from './scoring.js'
import { buildSyllabus, readSyllabus, publishSyllabus } from './syllabus.js'
import { recoverAssessmentHistory } from './assessment-history.js'
import {
  appendJsonl,
  listDir,
  pathExists,
  readJson,
  readJsonl,
  writeJson,
  writeJsonl,
  writeText
} from './store.js'

export const DEFAULTS = {
  profile: { version: 1, profile: null },
  settings: {
    version: 1,
    dataRoot: null,
    automation: { enabled: false, time: '08:00', timeZone: 'Asia/Shanghai' },
    audio: { provider: 'kokoro', kokoroVoice: KOKORO_VOICES[0], voiceURI: null, rate: 1 },
    study: { wordsPerDay: 10, activeWordListId: null },
    display: { locale: 'system' }
  },
  level: { version: 1, points: [], drift: { baseline: null, streak: 0, note: null } },
  syllabus: { version: 1, phases: [], currentPhaseId: null, weekly: { weekStart: null, goals: [] } },
  progress: { version: 1, completions: [], expiredDrafts: 0 },
  review: { version: 1, items: [] },
  bookmarks: { version: 1, items: [] }
}

const FILES = {
  profile: 'profile.json',
  settings: 'settings.json',
  level: 'level.json',
  syllabus: 'syllabus.json',
  progress: 'progress.json',
  review: 'review/items.json',
  bookmarks: 'audio/bookmarks.json',
  reviewLog: 'review/log.jsonl',
  anchors: 'anchors/items.json',
  anchorLog: 'anchors/responses.jsonl',
  sources: 'sources/provenance.jsonl',
  assessments: 'assessments',
  lessons: 'lessons'
}

function file(ctx, key) {
  return join(ctx.root, FILES[key])
}

function lessonFile(ctx, date) {
  return join(ctx.root, FILES.lessons, `${date}.json`)
}

function assessmentFile(ctx, id) {
  if (typeof id !== 'string' || !/^\d{4}-[^/\\\u0000-\u001f]+$/.test(id)) {
    fail('invalid_field', 'attemptId 必须是有效的测评标识，不能包含路径', 'attemptId')
  }
  return join(ctx.root, FILES.assessments, `${id}.json`)
}

async function load(ctx, key, fallback = DEFAULTS[key]) {
  if (key === 'syllabus') return readSyllabus(file(ctx, key), fallback)
  if (key === 'level') return loadCompletionProjection(ctx, key)
  const { value, warning } = await readJson(file(ctx, key), fallback)
  if (warning) ctx.warn(warning)
  return value
}

/** Every review writer must preserve an authority newer than its backup. */
async function loadReviewForWrite(ctx) {
  const { value, warning } = await readJson(file(ctx, 'review'), DEFAULTS.review)
  // A backup may predate the latest answer. Do not let a fallback create a new
  // round or award that answer again; retain the damaged file for recovery.
  if (warning) fail('round_recovery_failed', `恢复学习批次失败：${warning}。请检查存储后重试，当前进度未改动`)
  return value
}

async function loadReviewForStudy(ctx) {
  const review = await loadReviewForWrite(ctx)
  await projectReviewAnswers(ctx, review)
  return review
}

// Only committed receipt events are projected. JSON is the authority, and the
// event key makes an append/acknowledgement failure safe to retry on study reads.
async function projectReviewAnswers(ctx, review) {
  const pending = Object.values(review.answerReceipts ?? {}).filter(receipt => receipt.event && !receipt.projected)
  if (!pending.length) return
  try {
    const keys = new Set((await readJsonl(file(ctx, 'reviewLog'))).map(event => event.key))
    for (const receipt of pending) {
      if (!keys.has(receipt.event.key)) {
        const saved = await appendJsonl(file(ctx, 'reviewLog'), receipt.event)
        if (saved.key !== receipt.event.key) throw new Error('复习日志追加后无法读回有效作答key')
        keys.add(saved.key)
      }
      receipt.projected = true
    }
    await save(ctx, 'review', review)
  } catch (error) {
    for (const receipt of pending) receipt.projected = false
    ctx.warn(`答案已保存，但复习日志写入失败；无需再次作答：${error?.message ?? error}`)
  }
}

/** Settings gained keys over time; a file written earlier must still load today. */
async function loadSettings(ctx) {
  const stored = await load(ctx, 'settings')
  const words = stored.study?.wordsPerDay
  const active = stored.study?.activeWordListId
  return {
    ...DEFAULTS.settings,
    ...stored,
    automation: { ...DEFAULTS.settings.automation, ...(stored.automation ?? {}) },
    audio: { ...DEFAULTS.settings.audio, ...(stored.audio ?? {}),
      // A legacy system selection without an explicit provider is still a
      // system preference. Availability belongs to the current browser.
      provider: stored.audio?.provider ?? (stored.audio?.voiceURI ? 'web-speech' : 'kokoro') },
    study: { ...DEFAULTS.settings.study, ...(stored.study ?? {}),
      wordsPerDay: Number.isInteger(words) && words >= 3 && words <= 30 ? words : 10,
      activeWordListId: ['cet4', 'cet6', 'ielts'].includes(active) ? active : null },
    display: { ...DEFAULTS.settings.display, ...(stored.display ?? {}) }
  }
}

async function save(ctx, key, value) {
  await writeJson(file(ctx, key), value)
  return value
}

async function loadAnchors(ctx) {
  const target = file(ctx, 'anchors')
  const seeded = anchorStore()
  const stored = await readJson(target, seeded)
  if (stored.warning) ctx.warn(stored.warning)
  const value = stored.value
  if (!Array.isArray(value.items) || !value.items.length) {
    await save(ctx, 'anchors', seeded)
    return seeded
  }
  // First contact seeds the frozen pool on disk, hash included, so an edited
  // pool is detectable later and a retire has a file to edit.
  if (!(await pathExists(target))) await save(ctx, 'anchors', value)
  if (value.hash && value.hash !== hashAnchors(value.items)) {
    ctx.warn('锚题池与记录的哈希不一致，可能被手工修改过')
  }
  return value
}

function today(ctx) {
  return dateOf(ctx.now)
}

function requireProfileShape(profile) {
  const goals = ['work', 'study', 'travel', 'media', 'exam', 'other']
  if (!goals.includes(String(profile.goal))) {
    fail('invalid_field', `goal 必须是 ${goals.join(' / ')} 之一`, 'goal')
  }
  const minutes = Number(profile.minutesPerDay)
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 180) {
    fail('invalid_field', 'minutesPerDay 必须在 5 到 180 之间', 'minutesPerDay')
  }
  if (profile.targetBand && !BANDS.includes(profile.targetBand)) {
    fail('invalid_field', `targetBand 必须是 ${BANDS.join(' / ')} 之一`, 'targetBand')
  }
  return {
    goal: String(profile.goal),
    goalNote: profile.goalNote ? String(profile.goalNote) : '',
    minutesPerDay: Math.round(minutes),
    targetBand: profile.targetBand || null,
    interests: Array.isArray(profile.interests) ? profile.interests.map(String).slice(0, 12) : [],
    workContext: profile.workContext ? String(profile.workContext) : '',
    draft: Boolean(profile.draft)
  }
}

/** Every lesson file on disk, oldest first. */
async function allLessons(ctx) {
  const entries = await listDir(join(ctx.root, FILES.lessons))
  const dates = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .map((entry) => entry.name.slice(0, 10))
    .sort()
  const out = []
  for (const date of dates) {
    const { value, warning } = await readJson(lessonFile(ctx, date), null)
    if (warning) ctx.warn(warning)
    if (value) out.push(value)
  }
  return out
}

async function loadLesson(ctx, date) {
  const { value, warning } = await readJson(lessonFile(ctx, date), null)
  if (warning) ctx.warn(warning)
  return value
}

/**
 * Fold a finished lesson into the progress record. Only a lesson whose items
 * are all done counts, and only once: the completion date is a set, so a
 * re-submitted or re-opened day cannot inflate the numbers.
 */
async function recordCompletion(ctx, lesson) {
  if (!isComplete(lesson) || lesson.status === 'done') return false
  lesson.status = 'done'
  lesson.finishedAt = lesson.updatedAt ?? ctx.now.toISOString()
  const progress = await load(ctx, 'progress')
  const completions = new Set(progress.completions ?? [])
  completions.add(lesson.date)
  progress.completions = [...completions].sort()
  await save(ctx, 'progress', progress)
  return true
}

async function assertNotExpired(ctx, lesson) {
  const expiredMessage = `${lesson.date} 这一课没开始就过期了，不会再计入进度`
  if (lesson.status === 'expired') fail('lesson_expired', expiredMessage, 'date')
  if (lesson.status !== 'draft') return
  if (lesson.date >= today(ctx)) return
  lesson.status = 'expired'
  lesson.updatedAt = ctx.now.toISOString()
  await saveLesson(ctx, lesson)
  fail('lesson_expired', expiredMessage, 'date')
}

/**
 * Every expression worth remembering should reach the review queue even when
 * the agent forgot to submit it separately. The plugin can build the four
 * choices itself: the right meaning plus three sibling meanings from the same
 * lesson. Below four expressions there are not enough distractors, so it does
 * nothing rather than ship a two-choice card.
 */
function deriveReviewItems(lesson) {
  const expressions = (lesson.items ?? [])
    .filter((item) => item.type === 'expressions')
    .flatMap((item) => item.expressions ?? [])
  const meanings = [...new Set(expressions.map((entry) => entry.meaning.trim()).filter(Boolean))]
  if (expressions.length < 4 || meanings.length < 4) return []

  const known = new Set((lesson.reviewItems ?? []).map((entry) => termKey(entry.term)))
  const derived = []
  for (const expression of expressions) {
    const term = expression.term.trim()
    const key = termKey(term)
    if (!term || known.has(key)) continue
    const answer = expression.meaning.trim()
    const distractors = meanings.filter((meaning) => meaning !== answer).slice(0, 3)
    if (distractors.length < 3) continue
    const choices = seededShuffle([answer, ...distractors], `${lesson.date}:${key}`)
    known.add(key)
    derived.push({
      id: `auto-${lesson.date}-${key.replace(/[^a-z0-9]+/g, '-')}`,
      term,
      kind: expression.term.trim().split(/\s+/).length > 1 ? 'expression' : 'word',
      meaning: answer,
      choices,
      answerIndex: choices.indexOf(answer),
      explanation: expression.note || expression.example || ''
    })
  }
  return derived
}

async function saveLesson(ctx, lesson) {
  await writeJson(lessonFile(ctx, lesson.date), lesson)
  await writeText(
    lessonFile(ctx, lesson.date).replace(/\.json$/, '.md'),
    renderLessonMarkdown(lesson)
  )
  return lesson
}

/** Turn yesterday's untouched drafts into `expired`. Progress counts `done` only. */
export async function expireStaleDrafts(ctx) {
  const todayText = today(ctx)
  const entries = await listDir(join(ctx.root, FILES.lessons))
  let expired = 0
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) continue
    const date = entry.name.slice(0, 10)
    if (date >= todayText) continue
    const lesson = await loadLesson(ctx, date)
    if (lesson && lesson.status === 'draft') {
      lesson.status = 'expired'
      lesson.updatedAt = ctx.now.toISOString()
      await saveLesson(ctx, lesson)
      expired += 1
    }
  }
  if (expired) {
    const progress = await load(ctx, 'progress')
    progress.expiredDrafts = (progress.expiredDrafts ?? 0) + expired
    await save(ctx, 'progress', progress)
  }
  return expired
}

function recentSourceUrls(lessons, todayText, days) {
  const urls = new Map()
  for (const lesson of lessons) {
    const age = daysBetween(lesson.date, todayText)
    if (age < 0 || age >= days) continue
    for (const source of lesson.sources ?? []) {
      urls.set(source.url, { url: source.url, title: source.title, usedAt: lesson.date })
    }
  }
  return urls
}

function computeStreak(dates, todayText) {
  const unique = [...new Set(dates)].sort()
  if (!unique.length) return { current: 0, best: 0, lastDate: null }
  let best = 1
  let run = 1
  for (let index = 1; index < unique.length; index += 1) {
    if (daysBetween(unique[index - 1], unique[index]) <= 2) run += 1
    else run = 1
    best = Math.max(best, run)
  }
  let current = 1
  for (let index = unique.length - 1; index > 0; index -= 1) {
    if (daysBetween(unique[index - 1], unique[index]) <= 2) current += 1
    else break
  }
  if (daysBetween(unique[unique.length - 1], todayText) > 2) current = 0
  return { current, best, lastDate: unique[unique.length - 1] }
}

/**
 * Find the review item a flash card is about. The agent writes the card front
 * as the whole phrase from the article ("predictions didn't pan out") while the
 * review item is the expression itself ("pan out"), so exact equality is too
 * strict: fall back to whole-phrase containment in either direction.
 */
function findReviewTwin(card, reviewItems) {
  const normalize = (text) =>
    String(text ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9']+/g, ' ')
      .trim()
  const front = normalize(card.front)
  if (!front) return null
  const termOf = (candidate) => normalize(candidate.term)
  const contains = (haystack, needle) =>
    needle.length > 2 && ` ${haystack} `.includes(` ${needle} `)

  return (
    reviewItems.find((candidate) => termOf(candidate) === front) ??
    reviewItems.find((candidate) => contains(front, termOf(candidate))) ??
    reviewItems.find((candidate) => contains(termOf(candidate), front)) ??
    null
  )
}

function publicReviewItem(item) {
  return {
    id: item.id,
    term: item.term,
    kind: item.kind,
    meaning: item.meaning,
    choices: item.choices,
    answerIndex: item.answerIndex,
    explanation: item.explanation,
    box: hasAnswered(item) ? item.box : 0,
    status: item.status,
    dueAt: item.dueAt,
    fresh: !hasAnswered(item),
    sourceLesson: item.sourceLesson ?? null,
    createdAt: item.createdAt ?? null,
    lastAt: item.lastAt ?? null,
    masteredAt: item.masteredAt ?? null,
    checkups: item.checkups ?? 0,
    lapses: item.lapses ?? 0,
    streak: item.streak ?? 0,
    answerCount: (item.answers ?? []).length
  }
}

function latestPoint(level) {
  if (Object.hasOwn(level, 'current')) return level.current
  if (!level.points || !level.points.length) return null
  return level.points[level.points.length - 1]
}

/** Keep observations internal; expose only a scope-safe current caution. */
function currentDrift(drift, point) {
  return { note: Number.isFinite(point?.anchorAccuracy) && drift?.note
    ? '近期短题表现波动较大，结果仍仅供安排学习。' : null }
}

/** All assessment read paths share this allow-list, never an internal spread. */
function publicLevelPoint(point) {
  if (!point) return null
  return {
    id: point.id,
    attemptId: point.attemptId,
    at: point.at,
    kind: point.kind,
    band: point.band,
    finalBandIndex: point.finalBandIndex,
    accuracy: point.accuracy,
    counts: point.counts,
    weaknesses: (point.weaknesses ?? []).filter(item => ['grammar', 'vocab'].includes(item.skill)),
    reference: point.reference,
    scope: ASSESSMENT_SCOPE,
    coverageNote: point.coverageNote ?? null
  }
}

function weeklyView(syllabus, progress, todayText) {
  const weekStart = addDays(todayText, -((new Date(`${todayText}T00:00:00`).getDay() + 6) % 7))
  const weekly = syllabus.weekly ?? { weekStart: null, goals: [] }
  const goals = weekly.weekStart === weekStart ? weekly.goals ?? [] : []
  const completions = (progress.completions ?? []).filter(
    (date) => date >= weekStart && date <= todayText
  )
  return {
    weekStart,
    goals,
    completedGoals: goals.filter((goal) => goal.done).length,
    totalGoals: goals.length,
    completedDays: completions.length,
    ratio: goals.length ? Number((goals.filter((goal) => goal.done).length / goals.length).toFixed(2)) : 0
  }
}

function phaseOf(syllabus) {
  return (syllabus.phases ?? []).find((phase) => phase.id === syllabus.currentPhaseId) ?? null
}

function weekStartOf(todayText) {
  return addDays(todayText, -((new Date(`${todayText}T00:00:00`).getDay() + 6) % 7))
}

async function regenerateSyllabus(ctx) {
  await load(ctx, 'syllabus')
  const level = await loadCompletionProjection(ctx, 'level')
  const profileStore = await load(ctx, 'profile')
  const latest = latestPoint(level)
  const store = buildSyllabus({
    finalBandIndex: latest?.finalBandIndex ?? 1,
    targetBand: profileStore.profile?.targetBand ?? null,
    todayText: today(ctx),
    generationId: randomUUID(),
    at: ctx.now.toISOString()
  })
  await save(ctx, 'syllabus', store)
  return store
}

function listCandidates(items, settings) {
  const catalog = getWordCatalog()
  const list = catalog.lists.find(list => list.id === settings.study.activeWordListId) ?? null
  if (!list) return { list: null, candidates: [], exhaustion: null, remainingPlayable: 0 }
  const byTerm = new Map(items.map(item => [termKey(item.term), item]))
  const byId = new Map(catalog.entries.map(entry => [entry.id, entry]))
  const members = list.entryIds.map(id => byId.get(id))
  const unjoined = members.filter(entry => !byTerm.has(entry.key))
  const candidates = list.studyOrder.map(id => byId.get(id)).filter(entry => !byTerm.has(entry.key) && entry.practice.status === 'ready')
  const allMastered = members.every(entry => byTerm.get(entry.key)?.status === 'mastered')
  return { list, candidates, remainingPlayable: candidates.length,
    exhaustion: candidates.length ? null : allMastered ? 'all_mastered' : unjoined.length ? 'unavailable' : 'all_joined' }
}

function studyBatch(items, settings, now) {
  const activeWordListId = settings.study.activeWordListId
  const members = activeWordListId ? new Set(getWordCatalog().entries.filter(entry => entry.listIds.includes(activeWordListId)).map(entry => entry.key)) : new Set()
  const due = dueItems(items, now)
  const old = due.filter(hasAnswered)
  const fresh = due.filter(item => !hasAnswered(item)).map(item => ({ ...item, fresh: true }))
    .sort((a, b) => Number(members.has(termKey(b.term))) - Number(members.has(termKey(a.term))))
  return { items: [...old, ...fresh].slice(0, settings.study.wordsPerDay).map(item => ({ ...publicReviewItem(item), due: true })), dueCount: due.length, batchSize: settings.study.wordsPerDay, activeWordListId }
}

function matchesRound(round, payload) {
  return Boolean(round && payload?.roundId === round.id && payload?.revision === round.revision && (payload?.presentationId ?? null) === (round.current?.id ?? null))
}

function newStudyRound(batch, now, revision = 1) {
  const id = randomUUID()
  const order = batch.items.map(item => item.id)
  return {
    id, revision, status: order.length ? 'active' : 'empty',
    startedAt: now.toISOString(), batchSize: batch.batchSize, activeWordListId: batch.activeWordListId,
    order, at: 0, facts: Object.fromEntries(order.map(itemId => [itemId, { answers: [], completedAt: null }])),
    current: order.length ? { id: `${id}:1`, itemId: order[0], choiceOrder: [0, 1, 2, 3], picked: null, feedback: null } : null
  }
}

function publicStudyBatch(review, now) {
  const round = review.round
  const items = round.order.map(id => review.items.find(item => item.id === id)).map(item => {
    const projected = { ...publicReviewItem(item), due: isDue(item, now) }
    if (round.current?.itemId !== item.id) return projected
    const choiceOrder = round.current.choiceOrder
    return { ...projected, choices: choiceOrder.map(index => item.choices[index]), answerIndex: choiceOrder.indexOf(item.answerIndex), choiceOrder }
  })
  const facts = Object.values(round.facts)
  const summary = {
    total: facts.length,
    completed: facts.filter(fact => fact.completedAt).length,
    firstTryCorrect: facts.filter(fact => fact.answers[0]?.correct).length,
    retryCount: facts.reduce((sum, fact) => sum + Math.max(0, fact.answers.length - 1), 0)
  }
  return { items, dueCount: dueItems(review.items, now).length, batchSize: round.batchSize, activeWordListId: round.activeWordListId,
    round: { id: round.id, revision: round.revision, status: round.status, at: round.at, current: round.current, summary } }
}

// Both public answer entrances commit the same effective fact. Receipts outlive
// the current round; timestamps are metadata, never a source of historical credit.
async function effectiveAnswer(ctx, payload, booleanAnswer = false) {
  const review = await loadReviewForStudy(ctx)
  const items = review.items ?? []
  const itemId = String(payload?.itemId ?? '')
  const hasRoundIdentity = payload?.roundId !== undefined || payload?.presentationId !== undefined || payload?.revision !== undefined
  const key = payload?.roundId && payload?.presentationId
    ? JSON.stringify([payload.roundId, payload.presentationId])
    : typeof payload?.attemptId === 'string' && payload.attemptId.trim() ? JSON.stringify(['attempt', payload.attemptId]) : null
  const receipt = key && review.answerReceipts?.[key]
  const batch = () => review.round ? { batch: publicStudyBatch(review, ctx.now) } : {}
  if (receipt) {
    if (receipt.itemId !== itemId) fail('answer_identity_conflict', '同一作答身份不能用于另一个词', 'itemId')
    return { ...receipt.result, ...batch(), key, replayed: true }
  }
  const round = review.round
  if (hasRoundIdentity) {
    if (!matchesRound(round, payload) || itemId !== round.current?.itemId || round.current.feedback) {
      fail('stale_presentation', '当前题已变化，请读取已保存批次后继续', 'presentationId')
    }
  } else if (!key || round?.status === 'active') {
    fail('answer_identity_required', '作答需要当前批次呈现身份；独立补记需要稳定 attemptId，不能凭词和时间推测新作答', 'presentationId')
  }
  const index = items.findIndex(item => item.id === itemId)
  if (index < 0) fail('item_not_found', `复习队列里没有 ${itemId}`, 'itemId')
  const item = items[index]
  if (booleanAnswer && typeof payload.correct !== 'boolean') fail('invalid_field', 'correct 必须是布尔值', 'correct')
  const choice = booleanAnswer ? payload.correct ? item.answerIndex : (item.answerIndex + 1) % 4 : Number(payload.choice)
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) fail('invalid_field', 'choice 必须是 0 到 3 的整数', 'choice')
  if (!isDue(item, ctx.now)) fail('not_due', `「${item.term}」还没到期，${item.dueAt.slice(0, 10)} 之后再答`, 'itemId')
  const correct = choice === item.answerIndex
  const updated = advance(item, correct, ctx.now)
  items[index] = updated
  if (hasRoundIdentity) {
    const fact = round.facts[itemId]
    fact.answers.push({ at: ctx.now.toISOString(), choice, correct, presentationId: round.current.id, choiceOrder: round.current.choiceOrder })
    if (correct) fact.completedAt = ctx.now.toISOString()
    round.current.picked = round.current.choiceOrder.indexOf(choice)
    round.current.feedback = { correct, explanation: item.explanation }
    round.revision++
  }
  const result = {
    correct, answerIndex: item.answerIndex, explanation: item.explanation,
    box: publicReviewItem(updated).box, fresh: publicReviewItem(updated).fresh,
    status: updated.status, dueAt: updated.dueAt,
    dueCount: dueItems(items, ctx.now).length, mastered: countMastered(items)
  }
  const event = { key, at: ctx.now.toISOString(), itemId, choice, correct, box: updated.box, status: updated.status }
  review.answerReceipts = { ...review.answerReceipts, [key]: { itemId, result, event, projected: false } }
  await save(ctx, 'review', { ...review, items })
  await projectReviewAnswers(ctx, review)
  return { ...result, ...batch(), key, replayed: false }
}

function bookmarkIdentity(payload) {
  for (const field of ['materialId', 'contentFingerprint']) {
    if (typeof payload?.[field] !== 'string' || !payload[field].trim() || payload[field].length > 500) fail('invalid_field', `${field} 必须是非空标识`, field)
  }
  return { materialId: payload.materialId, contentFingerprint: payload.contentFingerprint }
}

function queryPage(items, payload) {
  const pageSize = payload.pageSize === undefined ? 50 : Number(payload.pageSize)
  if (![20, 50].includes(pageSize)) fail('invalid_field', '每页条数必须是 20 或 50', 'pageSize')
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const requested = Number(payload.page ?? 1)
  const page = Number.isFinite(requested) ? Math.min(pages, Math.max(1, Math.floor(requested))) : 1
  return { total: items.length, pages, page, pageSize, items: items.slice((page - 1) * pageSize, page * pageSize) }
}

// Vocabulary-only reservation while Host awaits schedule.create. Process-local
// lifetime avoids a persisted orphan claim freezing recovery after Host restart.
const generationClaims = new Map()

// ---------------------------------------------------------------- handlers

const handlers = {
  async 'profile.get'(ctx) {
    const profile = await load(ctx, 'profile')
    const settings = await loadSettings(ctx)
    return { profile: profile.profile, settings, onboarded: Boolean(profile.profile?.confirmedAt) }
  },

  async 'profile.save'(ctx, payload) {
    const store = await load(ctx, 'profile')
    const shape = requireProfileShape(payload ?? {})
    const at = ctx.now.toISOString()
    store.profile = {
      ...store.profile,
      ...shape,
      createdAt: store.profile?.createdAt ?? at,
      updatedAt: at,
      confirmedAt: payload.confirmed === false ? null : at
    }
    await save(ctx, 'profile', store)
    return { profile: store.profile }
  },

  async 'settings.get'(ctx) {
    return await loadSettings(ctx)
  },

  async 'settings.save'(ctx, payload) {
    const settings = await loadSettings(ctx)
    if (payload?.automation) {
      const enabled = Boolean(payload.automation.enabled)
      const time = String(payload.automation.time ?? settings.automation.time)
      if (!/^\d{2}:\d{2}$/.test(time)) fail('invalid_field', 'time 必须是 HH:MM', 'automation.time')
      settings.automation = {
        ...settings.automation,
        enabled,
        time,
        timeZone: String(payload.automation.timeZone ?? settings.automation.timeZone)
      }
    }
    if (payload?.audio?.provider !== undefined) {
      const provider = payload.audio.provider
      if (!['kokoro', 'web-speech'].includes(provider)) {
        fail('invalid_field', 'provider 必须是 kokoro 或 web-speech', 'audio.provider')
      }
      settings.audio = { ...settings.audio, provider }
    }
    if (payload?.audio?.kokoroVoice !== undefined) {
      if (!KOKORO_VOICES.includes(payload.audio.kokoroVoice)) {
        fail('invalid_field', '请选择精选 Kokoro 英语音色', 'audio.kokoroVoice')
      }
      settings.audio.kokoroVoice = payload.audio.kokoroVoice
    }
    if (payload?.audio?.voiceURI !== undefined) {
      const voice = payload.audio.voiceURI
      if (voice !== null && (typeof voice !== 'string' || voice.length > 1000)) fail('invalid_field', '音色标识必须是字符串或空值', 'audio.voiceURI')
      settings.audio.voiceURI = voice
    }
    if (payload?.audio?.rate !== undefined) {
      const rate = Number(payload.audio.rate)
      if (!READING_RATES.includes(rate)) fail('invalid_field', '语速必须是 0.5、1、1.5 或 2', 'audio.rate')
      settings.audio.rate = rate
    }
    if (payload?.study?.wordsPerDay !== undefined) {
      const words = Number(payload.study.wordsPerDay)
      if (!Number.isInteger(words) || words < 3 || words > 30) {
        fail('invalid_field', 'wordsPerDay 必须是 3 到 30 的整数', 'study.wordsPerDay')
      }
      settings.study = { ...settings.study, wordsPerDay: words }
    }
    if (payload?.display?.locale) settings.display = { ...settings.display, locale: String(payload.display.locale) }
    await save(ctx, 'settings', settings)
    return settings
  },

  async 'audio.bookmark.get'(ctx, payload) {
    const { materialId, contentFingerprint } = bookmarkIdentity(payload)
    const store = await load(ctx, 'bookmarks')
    const bookmark = store.items.find(item => item.materialId === materialId) ?? null
    const invalidated = Boolean(bookmark && bookmark.contentFingerprint !== contentFingerprint)
    return { bookmark: invalidated ? null : bookmark, invalidated }
  },

  async 'audio.bookmark.save'(ctx, payload) {
    const identity = bookmarkIdentity(payload)
    if (!Number.isSafeInteger(payload.position) || payload.position < 0) fail('invalid_field', '书签位置必须是非负整数', 'position')
    const store = await load(ctx, 'bookmarks')
    const bookmark = { ...identity, position: payload.position }
    store.items = [...store.items.filter(item => item.materialId !== identity.materialId), bookmark]
    await save(ctx, 'bookmarks', store)
    return { bookmark }
  },

  /**
   * Copy every byte of the data root into `target`, then point the stored
   * settings at it. The caller (Host) writes the pointer the next start reads.
   */
  async 'settings.migrateRoot'(ctx, payload) {
    const target = resolve(String(payload?.target ?? '').trim())
    if (!payload?.target || !String(payload.target).trim()) {
      fail('invalid_field', 'target 不能为空', 'target')
    }
    const source = resolve(ctx.root)
    if (target === source) return { dataRoot: target, migrated: false }
    if (target.startsWith(source + sep)) {
      fail('invalid_field', '新数据目录不能放在当前数据目录里面', 'target')
    }
    await fs.mkdir(target, { recursive: true })
    await fs.cp(ctx.root, target, { recursive: true, force: true })
    const settings = await loadSettings(ctx)
    settings.dataRoot = target
    await writeJson(join(target, FILES.settings), settings)
    return { dataRoot: target, migrated: true }
  },

  async 'state.get'(ctx) {
    await expireStaleDrafts(ctx)
    const [profileStore, settings, level, syllabus, progress, review] = await Promise.all([
      load(ctx, 'profile'),
      loadSettings(ctx),
      load(ctx, 'level'),
      load(ctx, 'syllabus'),
      load(ctx, 'progress'),
      load(ctx, 'review')
    ])
    const todayText = today(ctx)
    const lessons = await allLessons(ctx)
    const lesson = lessons.find((candidate) => candidate.date === todayText) ?? null
    const due = dueItems(review.items ?? [], ctx.now)
    const recent = [...recentSourceUrls(lessons, todayText, 7).values()]

    return {
      now: ctx.now.toISOString(),
      today: todayText,
      dataRoot: ctx.root,
      profile: profileStore.profile,
      onboarded: Boolean(profileStore.profile?.confirmedAt),
      settings,
      level: {
        latest: publicLevelPoint(latestPoint(level)),
        points: (level.points ?? []).map(publicLevelPoint),
        drift: currentDrift(level.drift, latestPoint(level))
      },
      syllabus: {
        phases: syllabus.phases ?? [],
        currentPhaseId: syllabus.currentPhaseId,
        currentPhase: phaseOf(syllabus),
        weekly: weeklyView(syllabus, progress, todayText)
      },
      review: {
        dueCount: due.length,
        total: (review.items ?? []).length,
        mastered: countMastered(review.items ?? []),
        terms: (review.items ?? []).slice(0, 60).map((item) => item.term)
      },
      streak: computeStreak(progress.completions ?? [], todayText),
      todayLesson: lesson,
      recentSources: recent,
      needsAssessment: !latestPoint(level),
      automation: settings.automation
    }
  },

  async 'syllabus.save'(ctx, payload) {
    const phases = Array.isArray(payload?.phases) ? payload.phases : []
    if (!phases.length) fail('invalid_field', '大纲至少需要一个阶段', 'phases')
    const dateLike = /\b\d{4}-\d{2}-\d{2}\b|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}\s*年/
    const normalized = phases.map((phase, index) => {
      const field = `phases[${index}]`
      if (!phase || typeof phase !== 'object') fail('invalid_field', `${field} 必须是对象`, field)
      const name = String(phase.name ?? '').trim()
      const goal = String(phase.goal ?? '').trim()
      if (!name) fail('invalid_field', `${field}.name 不能为空`, `${field}.name`)
      if (!goal) fail('invalid_field', `${field}.goal 不能为空`, `${field}.goal`)
      if (dateLike.test(name) || dateLike.test(goal)) {
        fail('syllabus_has_date', '大纲只写阶段目标，不写具体日期', field)
      }
      return {
        id: phase.id ? String(phase.id) : `phase-${index + 1}`,
        name,
        goal,
        focus: Array.isArray(phase.focus) ? phase.focus.map(String).slice(0, 8) : [],
        targetBand: phase.targetBand && BANDS.includes(phase.targetBand) ? phase.targetBand : null
      }
    })
    const currentPhaseId = payload.currentPhaseId
      ? String(payload.currentPhaseId)
      : normalized[0].id
    if (!normalized.some((phase) => phase.id === currentPhaseId)) {
      fail('invalid_field', 'currentPhaseId 不在 phases 里', 'currentPhaseId')
    }
    await load(ctx, 'syllabus')
    const generationId = randomUUID()
    const phase = normalized.find((candidate) => candidate.id === currentPhaseId)
    const weekly = {
      weekStart: weekStartOf(today(ctx)),
      goals: (phase.focus.length ? phase.focus : [phase.goal]).slice(0, 3).map((text, index) => ({
        id: `${generationId}:goal-${index + 1}`,
        text,
        done: false
      }))
    }
    const store = { version: 1, generationId, phases: normalized, currentPhaseId, weekly, regeneratedAt: ctx.now.toISOString() }
    await save(ctx, 'syllabus', store)
    return store
  },

  /** Rebuild the route from the current estimate and target band. */
  async 'syllabus.generate'(ctx) {
    return await regenerateSyllabus(ctx)
  },

  /** Toggle one of this week's goals — the only manual progress input. */
  async 'syllabus.toggleGoal'(ctx, payload) {
    const store = await load(ctx, 'syllabus')
    const goalId = String(payload?.goalId ?? '')
    const weekly = store.weekly ?? { weekStart: null, goals: [] }
    const goal = (weekly.goals ?? []).find((entry) => entry.id === goalId)
    if (!goal) fail('goal_not_found', `找不到本周目标 ${goalId}`, 'goalId')
    goal.done = payload?.done === undefined ? !goal.done : Boolean(payload.done)
    await save(ctx, 'syllabus', store)
    return weekly
  },

  // ------------------------------------------------------------ assessment

  async 'assessment.saveBank'(ctx, payload) {
    const normalized = validateAssessmentBank(payload)
    const version = String(payload?.version ?? Date.now().toString(36))
    const bank = { version, createdAt: ctx.now.toISOString(), items: normalized }
    const bankName = `bank-${version}.json`
    await writeJson(join(ctx.root, FILES.assessments, bankName), bank)
    await writeJson(join(ctx.root, FILES.assessments, 'current-bank.json'), { file: bankName })
    const difficulties = [...new Set(normalized.map((item) => item.difficulty))].sort()
    return { version, count: normalized.length, difficulties }
  },

  async 'assessment.start'(ctx, payload) {
    const kind = payload?.kind === 'short' ? 'short' : 'full'
    const entries = await listDir(join(ctx.root, FILES.assessments))
    const banks = entries
      .filter((entry) => entry.isFile() && /^bank-.*\.json$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    if (!banks.length) {
      fail(
        'no_question_bank',
        '还没有题库，请重新准备：提交至少 24 道独立词汇/语法短题，难度 1–6 各至少 4 道，可点击「生成测评题库」。',
        'items'
      )
    }
    const { value: current, warning: currentWarning } = await readJson(join(ctx.root, FILES.assessments, 'current-bank.json'), null)
    if (currentWarning || (current ? !banks.includes(current.file) :
      entries.some(entry => ['current-bank.json', 'current-bank.json.bak'].includes(entry.name)))) {
      fail('no_question_bank', '当前题库读不出来，请重新准备至少 24 道独立词汇/语法短题', 'items')
    }
    const { value: bank, warning } = await readJson(
      join(ctx.root, FILES.assessments, current?.file ?? banks[banks.length - 1]),
      null
    )
    if (warning) fail('no_question_bank', '当前题库主记录读不出来，请重新准备至少 24 道独立词汇/语法短题', 'items')
    const admitted = validateAssessmentBank(bank)

    const anchors = await loadAnchors(ctx)
    const retired = new Set(anchors.retired ?? [])
    const answered = await answeredAnchorIds(ctx)
    const available = anchors.items.filter((item) => !retired.has(item.id) && !answered.has(item.id))
    const chosen = available.slice(0, ANCHORS_PER_ASSESSMENT)

    const length = kind === 'short' ? SHORT_ASSESSMENT_LENGTH : ASSESSMENT_LENGTH
    const id = `${today(ctx)}-${kind}-${ctx.now.getTime().toString(36)}-${randomUUID()}`
    const history = await attemptHistory(ctx)
    const pool = admitted.map((item) => ({ ...item, anchor: false }))
    const anchorItems = chosen.map((item) => ({ ...item, anchor: true }))

    const attempt = {
      id,
      lifecycleVersion: 1,
      scoringRule: SCORING_RULE,
      kind,
      createdAt: ctx.now.toISOString(),
      status: 'in_progress',
      length,
      items: length,
      tier: 3,
      order: [],
      answers: [],
      pool,
      anchors: anchorItems,
      anchorIds: anchorItems.map((item) => item.id),
      recentlyServed: history.served,
      rotation: history.count,
      sourceVersion: bank.version
    }
    const first = pickNext(attempt)
    attempt.current = first ? first.id : null
    if (first) attempt.order.push(first.id)
    await writeJson(assessmentFile(ctx, id), attempt)
    return { attemptId: id, total: attempt.items, question: publicQuestion(first), progress: 0 }
  },

  async 'assessment.resume'(ctx) {
    const entries = await listDir(join(ctx.root, FILES.assessments))
    const ids = entries
      .filter((entry) => entry.isFile() && /^\d{4}-/.test(entry.name) && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort()
    const attempts = []
    for (const id of ids) {
      const { value } = await readJson(join(ctx.root, FILES.assessments, id), null)
      if (value) attempts.push(value)
    }
    attempts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (b.rotation ?? 0) - (a.rotation ?? 0))
    for (const attempt of attempts) {
      if (attempt.status === 'in_progress' || (attempt.status === 'done' && attempt.completionPending)) {
        await projectAnchorResponses(ctx, attempt)
        return { ...publicAttempt(attempt), answered: attempt.answers.length }
      }
    }
    if (attempts.some(attempt => attempt.status === 'terminated' && attempt.historyConversion)) {
      return { restartRequired: true, message: '上次未完成的测评已结束，请主动开始新的测评。' }
    }
    return null
  },

  async 'assessment.answer'(ctx, payload) {
    const attemptId = payload?.attemptId
    const itemId = String(payload?.itemId ?? '')
    const responseType = payload?.responseType === undefined ? 'choice' : payload.responseType
    if (!['choice', 'unable'].includes(responseType)) fail('invalid_field', 'responseType 必须是 choice 或 unable', 'responseType')
    if (responseType === 'unable' && Object.hasOwn(payload, 'choice')) fail('invalid_field', '不会响应不能同时提供 choice', 'choice')
    const choice = responseType === 'unable' ? null : payload?.choice
    const { value: attempt } = await readJson(assessmentFile(ctx, attemptId), null)
    if (!attempt) fail('attempt_not_found', `找不到测评 ${attemptId}`, 'attemptId')
    if (responseType === 'choice' && (!Number.isInteger(choice) || choice < 0 || choice > 3)) {
      fail('invalid_field', 'choice 必须是 0 到 3 的整数', 'choice')
    }
    // Items never repeat within an attempt, so this pair is also the response
    // identity for older choice-only callers. Never infer identity from time.
    const responseId = JSON.stringify([attempt.id, itemId])
    await projectAnchorResponses(ctx, attempt)
    const receipt = attempt.answers.find(answer => answer.itemId === itemId)
    if (receipt) {
      if ((receipt.responseType ?? 'choice') !== responseType || receipt.choice !== choice) {
        fail('answer_identity_conflict', '这道题已保存了不同响应，不能改写；请恢复测评后继续', 'itemId')
      }
      return { ...publicAttempt(attempt), responseId: receipt.responseId ?? responseId, replayed: true }
    }
    if (attempt.status !== 'in_progress') {
      fail('attempt_finished', '这次测评已经结束', 'attemptId')
    }
    if (attempt.current !== itemId) {
      fail('wrong_item', `当前题目是 ${attempt.current}，不是 ${itemId}`, 'itemId')
    }
    const item = questionOf(attempt, itemId)
    if (!item) fail('item_not_found', `题目 ${itemId} 不存在`, 'itemId')
    if (responseType === 'choice' && (!Number.isInteger(choice) || choice < 0 || choice > 3)) {
      fail('invalid_field', 'choice 必须是 0 到 3 的整数', 'choice')
    }
    const correct = responseType === 'choice' && choice === item.answerIndex
    const contaminated = item.anchor ? (await answeredAnchorIds(ctx)).has(item.id) : false
    attempt.answers.push({
      itemId,
      responseId,
      responseType,
      choice,
      correct,
      at: ctx.now.toISOString(),
      difficulty: item.difficulty,
      skill: item.skill,
      anchor: Boolean(item.anchor),
      ...(item.anchor ? { contaminated } : {}),
      scoringEvidence: !contaminated,
      exclusionReason: contaminated ? 'repeated_anchor' : null
    })
    if (!contaminated) attempt.tier = clamp(correct ? attempt.tier + 1 : attempt.tier - 1, 1, 6)

    const next = pickNext(attempt)
    const expected = attempt.kind === 'short' ? SHORT_ASSESSMENT_LENGTH : ASSESSMENT_LENGTH
    if (!next && attempt.answers.length < expected) {
      fail('assessment_questions_unavailable', '测评题目不足，无法继续；请重新准备题库。当前题与进度未改动', 'items')
    }
    attempt.current = next?.id ?? null
    if (next) attempt.order.push(next.id)
    // The attempt is the response authority. No anchor exposure or completion
    // projection may get ahead of this atomic response commit.
    await writeJson(assessmentFile(ctx, attemptId), attempt)
    if (item.anchor) await recordAnchorResponse(ctx, attempt, item)
    if (!next) return { ...await finishAttempt(ctx, attempt), responseId, replayed: false }
    return { ...publicAttempt(attempt), responseId, replayed: false }
  },

  async 'assessment.finish'(ctx, payload) {
    const attemptId = payload?.attemptId
    const { value: attempt } = await readJson(assessmentFile(ctx, attemptId), null)
    if (!attempt) fail('attempt_not_found', `找不到测评 ${attemptId}`, 'attemptId')
    return await finishAttempt(ctx, attempt)
  },

  async 'assessment.acknowledge'(ctx, payload) {
    const attemptId = payload?.attemptId
    const { value: attempt } = await readJson(assessmentFile(ctx, attemptId), null)
    if (!attempt) fail('attempt_not_found', `找不到测评 ${attemptId}`, 'attemptId')
    if (attempt.status !== 'done') fail('assessment_incomplete', '测评尚未完成，请继续作答', 'attemptId')
    if (attempt.completionPending) {
      attempt.completionPending = false
      await writeJson(assessmentFile(ctx, attemptId), attempt)
    }
    return { attemptId, acknowledged: true }
  },

  async 'assessment.abandon'(ctx, payload) {
    const attemptId = payload?.attemptId
    const { value: attempt } = await readJson(assessmentFile(ctx, attemptId), null)
    if (!attempt) fail('attempt_not_found', `找不到测评 ${attemptId}`, 'attemptId')
    if (attempt.status === 'in_progress') {
      attempt.status = 'abandoned'
      attempt.updatedAt = ctx.now.toISOString()
      await writeJson(assessmentFile(ctx, attemptId), attempt)
    }
    return { attemptId, status: attempt.status }
  },

  // ---------------------------------------------------------------- lessons

  async 'lesson.get'(ctx, payload) {
    await expireStaleDrafts(ctx)
    const date = payload?.date ? String(payload.date) : today(ctx)
    const lesson = await loadLesson(ctx, date)
    return { date, lesson }
  },

  async 'lesson.save'(ctx, payload) {
    const todayText = today(ctx)
    const lesson = validateLesson(payload, { today: todayText })

    const existing = await loadLesson(ctx, lesson.date)
    const lessons = await allLessons(ctx)
    const recent = recentSourceUrls(
      lessons.filter((candidate) => candidate.date !== lesson.date),
      todayText,
      7
    )
    for (const source of lesson.sources) {
      if (recent.has(source.url)) {
        fail(
          'source_reused',
          `素材 ${source.url} 在过去 7 天已经用过（${recent.get(source.url).usedAt}），请换一个来源`,
          'sources'
        )
      }
    }

    const nowIso = ctx.now.toISOString()
    const merged = {
      ...lesson,
      status: 'draft',
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
      startedAt: existing?.startedAt ?? null,
      finishedAt: existing?.finishedAt ?? null
    }

    // Re-submitting a day that was already worked through must not throw the
    // learner's ticks away: an item that was done and comes back with the same
    // id stays done. An expired draft is re-generated as a fresh draft.
    if (existing) {
      for (const item of merged.items) {
        const before = (existing.items ?? []).find((candidate) => candidate.id === item.id)
        if (before?.done) {
          item.done = true
          item.doneAt = before.doneAt ?? nowIso
        }
      }
      const carried = existing.status === 'expired' ? 'draft' : existing.status
      merged.status = carried === 'done' && !isComplete(merged) ? 'active' : carried
      if (merged.status === 'active' && isComplete(merged)) {
        merged.status = 'done'
        merged.finishedAt = existing.finishedAt ?? nowIso
      }
    }

    // A flash card is always a four-choice card: the pill answers them and
    // shows the explanation, so a card with no options has nothing to answer.
    // When the agent wrote a card without options, borrow them from the review
    // item with the same term; drop the card only if there is no such item.
    const enrichable = []
    for (const card of merged.cards) {
      if (Array.isArray(card.choices) && card.answerIndex !== null) {
        enrichable.push(card)
        continue
      }
      const twin = findReviewTwin(card, merged.reviewItems ?? [])
      if (twin) {
        enrichable.push({
          ...card,
          choices: twin.choices,
          answerIndex: twin.answerIndex,
          explanation: card.explanation || twin.explanation
        })
      } else {
        ctx.warn(`碎片卡「${card.front}」没有选项也没有对应的复习项，已跳过`)
      }
    }
    merged.cards = enrichable
    merged.reviewItems = [...(merged.reviewItems ?? []), ...deriveReviewItems(merged)]
    const review = await loadReviewForWrite(ctx)
    // Validate all additions before any course or provenance write.
    const enrolled = enrol(review, merged.reviewItems, ctx.now, { kind: 'lesson', id: merged.date }, 'reviewItems')
    await saveLesson(ctx, merged)

    // The provenance log answers "where did this day's text come from", so a
    // re-submitted day replaces its own rows rather than stacking duplicates.
    const provenanceFile = join(ctx.root, FILES.sources)
    const others = (await readJsonl(provenanceFile)).filter((entry) => entry.date !== merged.date)
    await writeJsonl(provenanceFile, [
      ...others,
      ...merged.sources.map((source) => ({
        date: merged.date,
        url: source.url,
        title: source.title,
        fetchedAt: source.fetchedAt,
        license: source.license
      }))
    ])

    if (enrolled.addedCount || enrolled.linkedCount) await save(ctx, 'review', review)

    return {
      date: merged.date,
      status: merged.status,
      itemCount: merged.items.length,
      cardCount: merged.cards.length,
      reviewAdded: enrolled.addedCount,
      reviewLinked: enrolled.linkedCount,
      reviewSkipped: enrolled.skipped,
      dueCount: dueItems(review.items, ctx.now).length
    }
  },

  async 'lesson.start'(ctx, payload) {
    const date = payload?.date ? String(payload.date) : today(ctx)
    const lesson = await loadLesson(ctx, date)
    if (!lesson) fail('lesson_not_found', `${date} 还没有课程`, 'date')
    await assertNotExpired(ctx, lesson)
    if (lesson.status === 'draft') {
      lesson.status = 'active'
      lesson.startedAt = ctx.now.toISOString()
      lesson.updatedAt = lesson.startedAt
      await saveLesson(ctx, lesson)
    }
    return lesson
  },

  async 'lesson.completeItem'(ctx, payload) {
    const date = String(payload?.date ?? today(ctx))
    const itemId = String(payload?.itemId ?? '')
    const lesson = await loadLesson(ctx, date)
    if (!lesson) fail('lesson_not_found', `${date} 还没有课程`, 'date')
    await assertNotExpired(ctx, lesson)
    const item = lesson.items.find((candidate) => candidate.id === itemId)
    if (!item) fail('item_not_found', `课程里没有 ${itemId}`, 'itemId')
    if (lesson.status === 'draft') {
      lesson.status = 'active'
      lesson.startedAt = ctx.now.toISOString()
    }
    if (!item.done) {
      item.done = true
      item.doneAt = ctx.now.toISOString()
    }
    lesson.updatedAt = ctx.now.toISOString()
    await recordCompletion(ctx, lesson)
    await saveLesson(ctx, lesson)
    return {
      lesson,
      remainingMinutes: remainingMinutes(lesson),
      done: lesson.status === 'done'
    }
  },

  // ----------------------------------------------------------------- review

  /**
   * Introduce words the learner asked for beyond today's lesson. They are due
   * immediately and carry `fresh`: the first card is the first exposure, and
   * answering it books the 1-day review instead of advancing a box that was
   * never actually reviewed.
   */
  async 'review.add'(ctx, payload) {
    const incoming = Array.isArray(payload?.items) ? payload.items : []
    if (!incoming.length) fail('invalid_field', '至少要有一个词', 'items')
    const review = await loadReviewForWrite(ctx)
    const result = enrol(review, incoming, ctx.now, { kind: 'supplement' })
    if (result.addedCount || result.linkedCount) await save(ctx, 'review', review)
    return { ...result, added: result.added.map(publicReviewItem) }
  },

  async 'review.queue'(ctx) {
    const review = await load(ctx, 'review')
    const items = review.items ?? []
    const due = dueItems(items, ctx.now)
    return {
      dueCount: due.length,
      items: due.slice(0, 30).map(publicReviewItem),
      total: items.length,
      mastered: countMastered(items)
    }
  },

  /**
   * The vocabulary itself, not just what is due: the panel lists every word with
   * its box and next date, so a day with nothing due still shows the words the
   * learner owns. `due` is decided here because the server owns the clock.
   */
  async 'review.list'(ctx) {
    const review = await load(ctx, 'review')
    const items = review.items ?? []
    const entries = items.map((item) => ({
      item,
      due: isDue(item, ctx.now),
      at: Date.parse(item.dueAt)
    }))
    const due = entries.filter((entry) => entry.due)
    const upcoming = entries
      .filter((entry) => !entry.due && entry.item.status !== 'retired')
      .sort((a, b) => a.at - b.at)
    const nextDueAt = upcoming[0]?.item.dueAt ?? null
    const nextDay = nextDueAt ? nextDueAt.slice(0, 10) : null
    return {
      dueCount: due.length,
      total: items.length,
      mastered: countMastered(items),
      nextDueAt,
      nextDueCount: nextDay
        ? upcoming.filter((entry) => entry.item.dueAt.slice(0, 10) === nextDay).length
        : 0,
      items: entries
        .slice()
        .sort((a, b) => {
          if (a.due !== b.due) return a.due ? -1 : 1
          return a.at - b.at
        })
        .map(({ item, due: isItemDue }) => ({
          ...publicReviewItem(item),
          due: isItemDue
        }))
    }
  },

  async 'study.preference'(ctx) {
    const settings = await loadSettings(ctx)
    const review = await load(ctx, 'review')
    const { list, candidates } = listCandidates(review.items ?? [], settings)
    return { activeWordList: list ? { id: list.id, title: list.title, total: list.total, playableCount: list.playableCount } : null,
      candidates: candidates.slice(0, 60).map(entry => ({ term: entry.term, meaning: entry.meaning })), candidateCount: candidates.length, batchSize: settings.study.wordsPerDay }
  },

  async 'study.supplement'(ctx, payload) {
    const settings = await loadSettings(ctx)
    const review = await loadReviewForStudy(ctx)
    if (review.round && (generationClaims.has(resolve(ctx.root)) || review.round.status === 'active' || payload?.continue !== true || !matchesRound(review.round, payload))) {
      return { ...publicStudyBatch(review, ctx.now), addedCount: 0 }
    }
    const before = studyBatch(review.items ?? [], settings, ctx.now)
    const available = listCandidates(review.items ?? [], settings)
    const needed = Math.max(0, before.batchSize - before.items.length)
    const incoming = (payload?.profile === true ? [] : available.candidates.slice(0, needed)).map(entry => ({ id: entry.id, term: entry.term, kind: entry.kind, meaning: entry.meaning, ...entry.practice }))
    const enrolled = enrol(review, incoming, ctx.now, { kind: 'wordlist', id: available.list?.id })
    const after = studyBatch(review.items ?? [], settings, ctx.now)
    review.round = newStudyRound(after, ctx.now, (review.round?.revision ?? 0) + 1)
    if (!after.items.length && (!available.list || payload?.profile === true)) review.round.awaitingGeneration = true
    await save(ctx, 'review', review)
    const remaining = listCandidates(review.items ?? [], settings)
    return { ...publicStudyBatch(review, ctx.now), addedCount: enrolled.addedCount, remainingPlayable: remaining.remainingPlayable, exhaustion: remaining.exhaustion,
      shortfall: after.batchSize - after.items.length, ...(!available.list || payload?.profile === true ? { mode: 'profile_required' } : {}) }
  },

  async 'study.batch'(ctx) {
    const review = await loadReviewForStudy(ctx)
    if (!review.round || review.round.status === 'empty' && review.round.awaitingGeneration && !generationClaims.has(resolve(ctx.root))) {
      const settings = await loadSettings(ctx)
      const batch = studyBatch(review.items ?? [], settings, ctx.now)
      if (!review.round || batch.items.length) {
        review.round = newStudyRound(batch, ctx.now, (review.round?.revision ?? 0) + 1)
        await save(ctx, 'review', review)
      }
    }
    return publicStudyBatch(review, ctx.now)
  },

  // A vocabulary-only reservation spans the asynchronous Host schedule call.
  // It freezes only this empty round, not unrelated jobs or learning commands.
  async 'study.generation.claim'(ctx, payload) {
    const review = await loadReviewForStudy(ctx)
    const round = review.round
    if (!matchesRound(round, payload) || round.status !== 'empty' || !round.awaitingGeneration) return { ...publicStudyBatch(review, ctx.now), claimed: false }
    if (generationClaims.has(resolve(ctx.root))) return { ...publicStudyBatch(review, ctx.now), claimed: false }
    const batch = studyBatch(review.items ?? [], await loadSettings(ctx), ctx.now)
    if (batch.items.length) {
      review.round = newStudyRound(batch, ctx.now, round.revision + 1)
      await save(ctx, 'review', review)
      return { ...publicStudyBatch(review, ctx.now), claimed: false }
    }
    const claimId = randomUUID()
    generationClaims.set(resolve(ctx.root), { roundId: round.id, claimId })
    return { ...publicStudyBatch(review, ctx.now), claimed: true, claimId }
  },

  async 'study.generation.release'(ctx, payload) {
    const review = await loadReviewForStudy(ctx)
    const claim = generationClaims.get(resolve(ctx.root))
    if (claim?.roundId === payload?.roundId && claim?.claimId === payload?.claimId) generationClaims.delete(resolve(ctx.root))
    return publicStudyBatch(review, ctx.now)
  },

  async 'study.next'(ctx, payload) {
    const review = await loadReviewForStudy(ctx)
    const round = review.round
    if (round && !matchesRound(round, payload)) return publicStudyBatch(review, ctx.now)
    if (!round?.current?.feedback) fail('answer_required', '请先保存当前题的答案，再继续')
    const { current } = round
    if (current.feedback.correct) round.at++
    else {
      round.order.splice(round.at, 1)
      round.order.push(current.itemId)
    }
    round.revision++
    const itemId = round.order[round.at]
    if (!itemId) { round.current = null; round.status = 'completed' }
    else {
      const choiceOrder = [0, 1, 2, 3]
      if (round.facts[itemId].answers.length) {
        for (let index = 3; index > 0; index--) {
          const other = Math.floor(Math.random() * (index + 1))
          ;[choiceOrder[index], choiceOrder[other]] = [choiceOrder[other], choiceOrder[index]]
        }
        const previousOrder = round.facts[itemId].answers.at(-1)?.choiceOrder ?? [0, 1, 2, 3]
        if (choiceOrder.every((value, index) => value === previousOrder[index])) choiceOrder.push(choiceOrder.shift())
      }
      round.current = { id: `${round.id}:${round.revision}`, itemId, choiceOrder, picked: null, feedback: null }
    }
    await save(ctx, 'review', review)
    return publicStudyBatch(review, ctx.now)
  },

  async 'wordlists.list'(ctx) {
    const catalog = getWordCatalog()
    const settings = await loadSettings(ctx)
    return { lists: catalog.lists.map(({ entryIds, studyOrder, ...summary }) => summary), version: catalog.version, activeWordListId: settings.study.activeWordListId }
  },

  async 'wordlists.select'(ctx, payload) {
    const id = payload?.id
    if (id !== null && !getWordCatalog().lists.some(list => list.id === id)) fail('invalid_field', '请选择有效词库或不指定', 'id')
    const settings = await loadSettings(ctx)
    settings.study.activeWordListId = id
    await save(ctx, 'settings', settings)
    return { activeWordListId: id }
  },

  async 'wordlists.query'(ctx, payload = {}) {
    const catalog = getWordCatalog()
    const list = catalog.lists.find(list => list.id === payload.id)
    if (!list) fail('invalid_field', '未知主题词库', 'id')
    const review = await load(ctx, 'review')
    const byTerm = new Map((review.items ?? []).map(item => [termKey(item.term), item]))
    const search = termKey(payload.search)
    const filter = payload.filter ?? 'all'
    if (!['all', 'joined', 'unjoined'].includes(filter)) fail('invalid_field', '未知加入状态筛选', 'filter')
    const entries = catalog.entries.filter(entry => entry.listIds.includes(list.id)).map(entry => {
      const personal = byTerm.get(entry.key)
      return { ...entry, joined: Boolean(personal), personal: personal ? publicReviewItem(personal) : null }
    }).filter(entry =>
      (filter === 'all' || (filter === 'joined' ? entry.joined : !entry.joined)) &&
      (!search || entry.key.includes(search) || entry.translation.toLowerCase().includes(search) || entry.meaning.toLowerCase().includes(search))
    )
    const { entryIds, studyOrder, ...summary } = list
    return { ...queryPage(entries, payload), list: summary }
  },

  async 'vocabulary.query'(ctx, payload = {}) {
    const review = await load(ctx, 'review')
    const all = review.items ?? []
    const search = termKey(payload.search)
    const filter = payload.filter ?? 'all'
    if (!['all', 'learning', 'mastered'].includes(filter)) fail('invalid_field', '未知学习状态筛选', 'filter')
    const matched = all.filter(item =>
      (filter === 'all' || (filter === 'mastered' ? item.status === 'mastered' : item.status !== 'mastered')) &&
      (!search || termKey(item.term).includes(search) || String(item.meaning).toLowerCase().includes(search))
    ).sort((a, b) => termKey(a.term).localeCompare(termKey(b.term), 'en') || a.id.localeCompare(b.id))
    return {
      ...queryPage(matched.map(item => ({ ...publicReviewItem(item), due: isDue(item, ctx.now) })), payload),
      counts: { all: all.length, learning: all.filter(item => item.status !== 'mastered').length, mastered: countMastered(all) }
    }
  },

  async 'review.answer'(ctx, payload) {
    return effectiveAnswer(ctx, payload)
  },

  // --------------------------------------------------------------- progress

  async 'progress.get'(ctx) {
    const [review, level, progress, syllabus] = await Promise.all([
      load(ctx, 'review'),
      load(ctx, 'level'),
      load(ctx, 'progress'),
      load(ctx, 'syllabus')
    ])
    const items = review.items ?? []
    const todayText = today(ctx)
    return {
      mastered: countMastered(items),
      learning: items.filter((item) => item.status !== 'mastered').length,
      total: items.length,
      streak: computeStreak(progress.completions ?? [], todayText),
      completions: progress.completions ?? [],
      expiredDrafts: progress.expiredDrafts ?? 0,
      curve: (level.points ?? []).map(publicLevelPoint),
      drift: currentDrift(level.drift, latestPoint(level)),
      weekly: weeklyView(syllabus, progress, todayText)
    }
  },

  // ----------------------------------------------------------------- record

  async 'record.batch'(ctx, payload) {
    const applied = []
    const skipped = []
    let latestBatch
    for (const answer of Array.isArray(payload?.reviewAnswers) ? payload.reviewAnswers : []) {
      const itemId = String(answer?.itemId ?? '')
      try {
        const result = await effectiveAnswer(ctx, answer, true)
        if (result.batch) latestBatch = result.batch
        if (result.replayed) skipped.push({ itemId, reason: 'duplicate', result })
        else applied.push({ key: result.key, itemId, kind: 'review', correct: result.correct })
      } catch (error) {
        if (!error?.isCommandError) throw error
        skipped.push({ itemId, reason: error.code })
      }
    }

    for (const entry of Array.isArray(payload?.lessonCompletions) ? payload.lessonCompletions : []) {
      const date = String(entry?.date ?? today(ctx))
      const itemId = String(entry?.itemId ?? '')
      const key = `${date}|${itemId}`
      if (applied.some((candidate) => candidate.key === key)) {
        skipped.push({ itemId, reason: 'duplicate' })
        continue
      }
      const lesson = await loadLesson(ctx, date)
      if (!lesson) {
        skipped.push({ itemId, reason: 'lesson_not_found' })
        continue
      }
      const item = lesson.items.find((candidate) => candidate.id === itemId)
      if (!item) {
        skipped.push({ itemId, reason: 'item_not_found' })
        continue
      }
      if (!item.done) {
        item.done = true
        item.doneAt = ctx.now.toISOString()
        lesson.updatedAt = item.doneAt
        await recordCompletion(ctx, lesson)
        await saveLesson(ctx, lesson)
      }
      applied.push({ key, itemId, kind: 'lesson', date })
    }
    return { applied, skipped, ...(latestBatch ? { batch: latestBatch } : {}) }
  }
}

// -------------------------------------------------------------- assessment helpers

function validateAssessmentBank(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  if (items.length < 24) {
    fail('bank_too_small', `请重新准备题库：至少 24 道普通题，收到 ${items.length} 道`, 'items')
  }
  const normalized = Array.from(items, (item, index) => {
    const field = `items[${index}]`
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('invalid_field', `请重新准备题库：${field} 必须是对象`, field)
    if (typeof item.id !== 'string' || !item.id.trim() || ANCHOR_POOL.some((anchor) => anchor.id === item.id.trim())) {
      fail('invalid_field', `请重新准备题库：${field}.id 必须非空且不能与冻结锚题相同`, `${field}.id`)
    }
    const difficulty = item.difficulty
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 6) {
      fail('invalid_field', `请重新准备题库：${field}.difficulty 必须是 1 到 6 的整数`, `${field}.difficulty`)
    }
    if (!['grammar', 'vocab'].includes(item.skill)) {
      fail('invalid_field', `请重新准备题库：${field}.skill 只能是 grammar 或 vocab`, `${field}.skill`)
    }
    if (typeof item.prompt !== 'string' || !item.prompt.trim()) {
      fail('invalid_field', `请重新准备题库：${field}.prompt 必须是非空字符串`, `${field}.prompt`)
    }
    if (item.passage != null && (typeof item.passage !== 'string' || item.passage.trim())) {
      fail('invalid_field', `请重新准备题库：${field}.passage 必须为空，不使用文章或额外材料`, `${field}.passage`)
    }
    if (!isStandaloneAssessmentText(item.prompt)) {
      fail('invalid_field', `请重新准备题库：${field}.prompt 必须是独立单句，不能含文章、对话或依赖音频及外部材料`, `${field}.prompt`)
    }
    if (englishWordCount(item.prompt) > 30) {
      fail('invalid_field', `请重新准备题库：${field}.prompt 最多 30 个英文词`, `${field}.prompt`)
    }
    if (!Array.isArray(item.choices) || item.choices.length !== 4) {
      fail('invalid_field', `请重新准备题库：${field}.choices 必须是 4 个选项`, `${field}.choices`)
    }
    for (let choiceIndex = 0; choiceIndex < 4; choiceIndex += 1) {
      if (typeof item.choices[choiceIndex] !== 'string' || !item.choices[choiceIndex].trim()) {
        fail('invalid_field', `请重新准备题库：${field}.choices[${choiceIndex}] 必须是非空字符串`, `${field}.choices[${choiceIndex}]`)
      }
      if (!isStandaloneAssessmentText(item.choices[choiceIndex])) {
        fail('invalid_field', `请重新准备题库：${field}.choices[${choiceIndex}] 只能是单句或短语，不能依赖额外材料`, `${field}.choices[${choiceIndex}]`)
      }
      if (englishWordCount(item.choices[choiceIndex]) > 12) {
        fail('invalid_field', `请重新准备题库：${field}.choices[${choiceIndex}] 最多 12 个英文词`, `${field}.choices[${choiceIndex}]`)
      }
    }
    if (new Set(item.choices.map((choice) => choice.trim().replace(/\s+/g, ' ').toLowerCase())).size !== 4) {
      fail('invalid_field', `请重新准备题库：${field}.choices 必须是 4 个不同的选项`, `${field}.choices`)
    }
    const answerIndex = item.answerIndex
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
      fail('invalid_field', `请重新准备题库：${field}.answerIndex 必须是 0 到 3 的整数`, `${field}.answerIndex`)
    }
    return {
      id: item.id.trim(),
      difficulty,
      skill: item.skill ? String(item.skill) : 'general',
      prompt: String(item.prompt ?? ''),
      passage: '',
      choices: item.choices.map(String),
      answerIndex,
      explanation: item.explanation ? String(item.explanation) : ''
    }
  })
  for (let difficulty = 1; difficulty <= 6; difficulty += 1) {
    if (normalized.filter((item) => item.difficulty === difficulty).length < 4) {
      fail('bank_difficulty_coverage', `请重新准备题库：难度 ${difficulty} 至少需要 4 道普通题`, 'items')
    }
  }
  if (!['grammar', 'vocab'].every((skill) => normalized.some((item) => item.skill === skill))) {
    fail('bank_skill_coverage', '请重新准备题库：整库必须同时包含 grammar 和 vocab 题', 'items')
  }
  if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
    fail('duplicate_item', '请重新准备题库：普通题 id 不能重复', 'items')
  }
  return normalized
}

// Latin-letter runs are words; internal apostrophes, hyphens and dotted
// abbreviations stay in the same word. Symbols/numbers and ___ blanks do not count.
function englishWordCount(text) {
  return (text.match(/[A-Za-z]+(?:['’.-][A-Za-z]+)*\.?/g) ?? []).length
}

function isStandaloneAssessmentText(text) {
  if (/[\r\n]|https?:\/\/|www\./i.test(text)) return false
  // Reject explicit extra-material instructions and multi-speaker formatting;
  // semantic independence and pedagogical quality still require content review.
  if (/\b(?:listen\s+to|read|refer\s+to|according\s+to|look\s+at|watch)\s+(?:(?:the|this|following|above|below|an?)\s+)*(?:passage|article|paragraph|text|audio|recording|dialogue|conversation|image|picture|video)\b/i.test(text)) return false
  if ((text.match(/\b[A-Za-z][A-Za-z ]{0,20}:/g) ?? []).length > 1) return false
  // Do not mistake Dr., e.g., U.S. or decimal points for sentence boundaries.
  const withoutAbbreviations = text
    .replace(/\b(?:[A-Za-z]\.){2,}/g, '')
    .replace(/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\./gi, '')
    .replace(/\b[A-Z]\.(?=\s+[A-Z][a-z])/g, '')
    .replace(/\d\.\d/g, '')
  // A quoted word or one quoted sentence can belong to a single task; a
  // multi-sentence quoted passage must not become a loophole.
  const withoutQuotedEndings = withoutAbbreviations.replace(/"([^"]*)"|“([^”]*)”|‘([^’]*)’|(?<![A-Za-z])'([^']*)'(?![A-Za-z])/g, (match, ...parts) => {
    const quoted = parts.slice(0, 4).find((part) => part !== undefined)
    return hasAssessmentSentenceBoundary(quoted) ? match : match.replace(/[.!?。！？]/g, '')
  })
  return !hasAssessmentSentenceBoundary(withoutQuotedEndings)
}

function hasAssessmentSentenceBoundary(text) {
  for (const ending of text.matchAll(/[.!?。！？]/g)) {
    if (text.slice(ending.index + 1).replace(/^[\s"'”’)]*/, '')) return true
  }
  return false
}

function questionOf(attempt, itemId) {
  if (!itemId) return null
  return (
    attempt.pool.find((item) => item.id === itemId) ??
    attempt.anchors.find((item) => item.id === itemId) ??
    null
  )
}

function publicAttempt(attempt) {
  const view = { attemptId: attempt.id, total: attempt.items, progress: attempt.answers.length }
  if (attempt.status === 'done') return { ...view, done: true, result: publicLevelPoint(attempt.result) }
  return { ...view, question: publicQuestion(questionOf(attempt, attempt.current)) }
}

function publicQuestion(item) {
  if (!item) return null
  return {
    id: item.id,
    difficulty: item.difficulty,
    skill: item.skill,
    prompt: item.prompt,
    passage: item.passage ?? '',
    choices: item.choices
  }
}

/** Pick the next unseen item: anchors land at fixed positions, unmarked. */
function pickNext(attempt) {
  const served = new Set(attempt.order)
  const position = attempt.order.length
  const answeredAnchors = attempt.answers.filter((answer) => answer.anchor).length

  if (answeredAnchors < attempt.anchors.length) {
    const spacing = Math.max(2, Math.floor(attempt.length / (attempt.anchors.length + 1)))
    const due = position >= spacing * (answeredAnchors + 1) - 1 || position >= attempt.length - 1
    if (due) {
      const next = attempt.anchors.find((item) => !served.has(item.id))
      if (next) return next
    }
  }

  const candidates = attempt.pool.filter((item) => !served.has(item.id))
  if (!candidates.length) {
    if (attempt.answers.length >= attempt.length) return null
    return attempt.anchors.find((item) => !served.has(item.id)) ?? null
  }
  if (attempt.answers.length >= attempt.length) return null
  const recent = new Set(attempt.recentlyServed ?? [])
  const ranked = candidates
    .map((item) => ({
      item,
      distance: Math.abs(item.difficulty - attempt.tier),
      stale: recent.has(item.id) ? 1 : 0
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.stale - b.stale ||
        a.item.difficulty - b.item.difficulty ||
        a.item.id.localeCompare(b.item.id)
    )
  // Among equally good items, prefer one the last attempt did not use, then
  // rotate the starting point. Without this every attempt from the same bank
  // would be the same twenty questions in the same order, and the learner
  // could learn the test instead of the language.
  const head = ranked[0]
  const tied = ranked.filter((entry) => entry.distance === head.distance && entry.stale === head.stale)
  const rotation = Number(attempt.rotation) || 0
  return tied[rotation % tied.length].item
}

/**
 * What the last attempt already showed, and how many attempts came before.
 * Used to rotate the questions rather than replay the same twenty.
 */
async function attemptHistory(ctx) {
  const entries = await listDir(join(ctx.root, FILES.assessments))
  const files = entries
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}-.*\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
  if (!files.length) return { served: [], count: 0 }
  const { value } = await readJson(join(ctx.root, FILES.assessments, files[files.length - 1]), null)
  return {
    served: Array.isArray(value?.order) ? value.order : [],
    count: files.length
  }
}

/** Submitted responses consume first-response status; an unanswered snapshot does not. */
async function answeredAnchorIds(ctx) {
  const answered = new Set((await readJsonl(file(ctx, 'anchorLog'))).map(entry => entry.anchorId))
  const entries = await listDir(file(ctx, 'assessments'))
  for (const entry of entries) {
    if (!entry.isFile() || !/^\d{4}-.*\.json$/.test(entry.name)) continue
    const { value, warning } = await readJson(join(file(ctx, 'assessments'), entry.name), null)
    if (warning) fail('assessment_recovery_failed', `恢复测评失败：${warning}；不能确认锚题作答记录，请检查存储后重试`, 'attemptId')
    if (value?.historyConversion === SCORING_RULE) {
      for (const id of value.confirmedAnchorIds ?? []) answered.add(id)
    } else for (const answer of value?.answers ?? []) {
      if (answer.anchor) answered.add(answer.itemId)
    }
  }
  return answered
}

async function recordAnchorResponse(ctx, attempt, item) {
  const id = item.id
  const log = await readJsonl(join(ctx.root, FILES.anchorLog))
  if (log.some((entry) => entry.attemptId === attempt.id && entry.anchorId === id)) return
  const answer = attempt.answers.find((candidate) => candidate.itemId === id)
  if (!answer) return
  const contaminated = answer.contaminated ?? log.some((entry) => entry.anchorId === id)
  answer.contaminated = contaminated
  await appendJsonl(join(ctx.root, FILES.anchorLog), {
    anchorId: id,
    attemptId: attempt.id,
    at: answer.at,
    correct: answer.correct,
    contaminated
  })
}

async function projectAnchorResponses(ctx, attempt) {
  for (const answer of attempt.answers.filter(answer => answer.anchor)) {
    await recordAnchorResponse(ctx, attempt, { id: answer.itemId })
  }
}

async function loadCompletionProjection(ctx, key) {
  if (key === 'syllabus') return readSyllabus(file(ctx, key), DEFAULTS[key])
  // readJson's empty fallback cannot distinguish a fresh root from a lost
  // primary with an unusable backup. Never drop older points in that case.
  try {
    await fs.lstat(file(ctx, key))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    try {
      await fs.lstat(`${file(ctx, key)}.bak`)
    } catch (backupError) {
      if (backupError?.code === 'ENOENT') return structuredClone(DEFAULTS[key])
    }
    fail('assessment_recovery_failed', '测评结果主记录缺失，请检查存储后重试；不能用空历史覆盖已有结果', 'attemptId')
  }
  const { value, warning } = await readJson(file(ctx, key), DEFAULTS[key])
  if (warning || !Array.isArray(value?.points)) fail('assessment_recovery_failed', `恢复测评失败：${warning ?? '结果记录无效'}；请检查存储后重试，不能回退较旧结果`, 'attemptId')
  return value
}

async function finishAttempt(ctx, attempt) {
  const expected = attempt.kind === 'short' ? SHORT_ASSESSMENT_LENGTH : ASSESSMENT_LENGTH
  if (attempt.answers.length !== expected || new Set(attempt.answers.map(answer => answer.itemId)).size !== expected) {
    fail('assessment_incomplete', `本次测评需要 ${expected} 条响应，目前只有 ${attempt.answers.length} 条；请继续作答`, 'attemptId')
  }
  if (attempt.status === 'done') return publicAttempt(attempt)
  if (!['in_progress', 'finalizing'].includes(attempt.status)) fail('attempt_finished', '这次测评已终止，不能结算', 'attemptId')
  if (!attempt.finalization) {
    // New response metadata is part of formal completion, not an inference
    // default. Historical conversion validates the original response schema.
    if (attempt.answers.some(answer =>
      !isIsoTimestamp(answer.at) || !['grammar', 'vocab'].includes(answer.skill) ||
      answer.responseId !== JSON.stringify([attempt.id, answer.itemId]) ||
      !['choice', 'unable'].includes(answer.responseType) ||
      (answer.responseType === 'unable' ? answer.choice !== null : !Number.isInteger(answer.choice) || answer.choice < 0 || answer.choice > 3)
    )) fail('invalid_assessment_evidence', '测评响应记录不完整或损坏，不能正式结算', 'answers')
    // Score only saved at-time facts; neither an overwritten bank nor a later
    // projection can supply or rejudge a missing response. Validate before I/O.
    const scored = scoreAssessment(attempt.answers)
    await projectAnchorResponses(ctx, attempt)
    // Journal the one rule's exact result so recovery never recalculates it.
    const cleanAnchors = attempt.answers.filter((answer) => answer.anchor && !answer.contaminated)
    const anchorAccuracy = cleanAnchors.length
      ? cleanAnchors.filter((answer) => answer.correct).length / cleanAnchors.length
      : null
    const level = await loadCompletionProjection(ctx, 'level')
    const drift = anchorAccuracy === null ? level.drift : nextDrift(level.drift, anchorAccuracy)
    const at = attempt.answers.at(-1).at
    const point = {
      id: `level-${attempt.id}`,
      attemptId: attempt.id,
      at,
      kind: attempt.kind,
      band: scored.band,
      finalBandIndex: scored.finalBandIndex,
      coverageNote: scored.coverageNote,
      scoringRule: scored.scoringRule,
      scoring: scored.scoring,
      accuracy: scored.accuracy,
      counts: scored.counts,
      weaknesses: scored.weaknesses,
      reference: scored.reference,
      anchorAccuracy: anchorAccuracy === null ? null : Number(anchorAccuracy.toFixed(2)),
      driftStreak: drift.streak
    }
    const previous = await loadCompletionProjection(ctx, 'syllabus')
    const profile = await load(ctx, 'profile')
    const current = latestPoint(level)
    const syllabus = !current || current.finalBandIndex !== point.finalBandIndex || !(previous.phases ?? []).length
      ? buildSyllabus({ finalBandIndex: point.finalBandIndex, targetBand: profile.profile?.targetBand, todayText: dateOf(new Date(at)), generationId: `assessment-${attempt.id}`, at })
      : null
    // Durable intent precedes every derived write. The response and this exact
    // point/syllabus can be replayed after any later file replacement fails.
    attempt.status = 'finalizing'
    attempt.finalization = { version: 1, point, drift, syllabus }
    await writeJson(assessmentFile(ctx, attempt.id), attempt)
  }
  const { point, drift, syllabus } = attempt.finalization
  const level = await loadCompletionProjection(ctx, 'level')
  if (!(level.points ?? []).some(entry => entry.id === point.id || entry.attemptId === attempt.id)) {
    level.points = [...(level.points ?? []), point].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    level.current = point
    level.scoringRule = SCORING_RULE
    level.drift = drift
    await save(ctx, 'level', level)
  }
  if (syllabus) await publishSyllabus(file(ctx, 'syllabus'), syllabus, DEFAULTS.syllabus)
  attempt.status = 'done'
  attempt.completionPending = true
  attempt.updatedAt = point.at
  attempt.result = { ...point, drift }
  delete attempt.pool
  delete attempt.anchors
  await writeJson(assessmentFile(ctx, attempt.id), attempt)
  return publicAttempt(attempt)
}

async function recoverAssessmentFinalizations(ctx) {
  const entries = await listDir(file(ctx, 'assessments'))
  const names = [...new Set(entries.filter(entry => entry.isFile() && /^\d{4}-.*\.json(?:\.bak)?$/.test(entry.name)).map(entry => entry.name.replace(/\.bak$/, '')))].sort()
  for (const name of names) {
    // A missing authority with a leftover backup is not a fresh attempt. The
    // backup may predate its last accepted response or its completion intent.
    const { value, warning } = await readJson(join(file(ctx, 'assessments'), name), null)
    if (warning) fail('assessment_recovery_failed', `恢复测评失败：${warning}；请检查存储后重试`, 'attemptId')
    if (value?.lifecycleVersion === 1 && (value.status === 'finalizing' || (value.status === 'in_progress' && value.answers.length === (value.kind === 'short' ? SHORT_ASSESSMENT_LENGTH : ASSESSMENT_LENGTH)))) {
      await finishAttempt(ctx, value)
    }
  }
}

// ------------------------------------------------------------------ dispatch

/** Every command name the seam accepts, derived from the handlers. */
export const COMMANDS = Object.freeze(Object.keys(handlers))

/**
 * The one seam: every tool call, every panel read/write and every scheduled
 * write goes through here. Given a data root, a command name and a payload,
 * it either resolves `{ ok: true, data, warnings }` or describes the refusal
 * as `{ ok: false, code, message, field? }`. It never throws across the seam.
 */
const commandTails = new Map()

export async function execute(root, command, payload = {}, options = {}) {
  // All callers share one per-root transaction lane, including reads that can
  // expire drafts. Atomic file replacement alone cannot prevent lost updates.
  const key = resolve(root)
  const previous = commandTails.get(key) ?? Promise.resolve()
  const task = previous.then(() => executeCommand(root, command, payload, options))
  const tail = task.catch(() => {})
  commandTails.set(key, tail)
  try { return await task } finally { if (commandTails.get(key) === tail) commandTails.delete(key) }
}

async function executeCommand(root, command, payload = {}, options = {}) {
  const warnings = []
  const ctx = {
    root,
    now: options.now instanceof Date ? options.now : options.now ? new Date(options.now) : new Date(),
    warn(message) {
      warnings.push(String(message))
    }
  }
  const handler = handlers[command]
  if (!handler) {
    return { ok: false, code: 'unknown_command', message: `不认识的命令 ${command}` }
  }
  try {
    // No command may observe or change one projection of an unfinished result.
    // Recovery runs in the same root lane as all reads and writers; failed I/O
    // leaves the durable intent intact and the public command fails closed.
    await recoverAssessmentHistory(ctx, DEFAULTS)
    await recoverAssessmentFinalizations(ctx)
    const data = await handler(ctx, payload ?? {})
    return { ok: true, data, warnings }
  } catch (error) {
    if (error && error.isCommandError) {
      const out = { ok: false, code: error.code, message: error.message, warnings }
      if (error.field) out.field = error.field
      return out
    }
    return {
      ok: false,
      code: 'internal_error',
      message: `插件内部错误：${error && error.message ? error.message : String(error)}`,
      warnings
    }
  }
}
