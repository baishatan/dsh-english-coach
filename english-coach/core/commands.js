import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'

import {
  ANCHORS_PER_ASSESSMENT,
  ASSESSMENT_LENGTH,
  BANDS,
  SHORT_ASSESSMENT_LENGTH,
  addDays,
  clamp,
  dateOf,
  daysBetween,
  isIsoTimestamp
} from './constants.js'
import { anchorStore, hashAnchors } from './anchors.js'
import { fail } from './errors.js'
import {
  isComplete,
  remainingMinutes,
  renderLessonMarkdown,
  seededShuffle,
  validateLesson
} from './lesson.js'
import { advance, countMastered, dueItems, isDue, newReviewItem } from './review.js'
import { scoreAssessment, nextDrift } from './scoring.js'
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
    audio: { provider: 'web-speech' },
    study: { wordsPerDay: 10 },
    display: { locale: 'system' }
  },
  level: { version: 1, points: [], drift: { baseline: null, streak: 0, note: null } },
  syllabus: { version: 1, phases: [], currentPhaseId: null, weekly: { weekStart: null, goals: [] } },
  progress: { version: 1, completions: [], expiredDrafts: 0 },
  review: { version: 1, items: [] }
}

const FILES = {
  profile: 'profile.json',
  settings: 'settings.json',
  level: 'level.json',
  syllabus: 'syllabus.json',
  progress: 'progress.json',
  review: 'review/items.json',
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
  return join(ctx.root, FILES.assessments, `${id}.json`)
}

async function load(ctx, key, fallback = DEFAULTS[key]) {
  const { value, warning } = await readJson(file(ctx, key), fallback)
  if (warning) ctx.warn(warning)
  return value
}

/** Settings gained keys over time; a file written earlier must still load today. */
async function loadSettings(ctx) {
  const stored = await load(ctx, 'settings')
  return {
    ...DEFAULTS.settings,
    ...stored,
    automation: { ...DEFAULTS.settings.automation, ...(stored.automation ?? {}) },
    audio: { ...DEFAULTS.settings.audio, ...(stored.audio ?? {}) },
    study: { ...DEFAULTS.settings.study, ...(stored.study ?? {}) },
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

  const known = new Set((lesson.reviewItems ?? []).map((entry) => entry.term.trim().toLowerCase()))
  const derived = []
  for (const expression of expressions) {
    const term = expression.term.trim()
    const key = term.toLowerCase()
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
    box: item.box,
    status: item.status,
    dueAt: item.dueAt,
    fresh: Boolean(item.fresh),
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
  if (!level.points || !level.points.length) return null
  return level.points[level.points.length - 1]
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

/**
 * A route with no dates in it. Three stages: hold the band you are in, reach
 * for the next one, then settle there. The goals are written as things to do,
 * not as days to hit, so falling behind never invalidates the plan.
 */
function buildSyllabus({ estimate, targetBand, todayText, previous }) {
  const startIndex = clamp(Math.round(Number(estimate) || 1), 1, BANDS.length)
  const targetIndex = clamp(
    targetBand && BANDS.includes(targetBand)
      ? Math.max(startIndex, BANDS.indexOf(targetBand) + 1)
      : Math.min(BANDS.length, startIndex + 1),
    1,
    BANDS.length
  )
  const middle = Math.min(BANDS.length, Math.round((startIndex + targetIndex) / 2))

  const phases = [
    {
      id: 'phase-1',
      name: `巩固「${BANDS[startIndex - 1]}」`,
      goal: '把当前档位的常见句式和表达用熟，读短文章不再来回回读。',
      focus: ['把当天的表达用进自己的句子里', '跟读听力文稿，注意连读', '读完一段先自己总结，再看中文'],
      targetBand: BANDS[startIndex - 1]
    },
    {
      id: 'phase-2',
      name: `往「${BANDS[middle - 1]}」推`,
      goal: '读得比现在长一点、快一点，能抓住长句的主干。',
      focus: ['读比现在长一点的段落', '听真实语速的材料', '整理一周的表达清单'],
      targetBand: BANDS[middle - 1]
    },
    {
      id: 'phase-3',
      name: `稳住「${BANDS[targetIndex - 1]}」`,
      goal: `在「${BANDS[targetIndex - 1]}」这一档站住：长文不断线，表达能用出来。`,
      focus: ['读长篇评论与专栏', '听播客并复述要点', '在真实场景里主动用出来'],
      targetBand: BANDS[targetIndex - 1]
    }
  ]

  const weekStart = weekStartOf(todayText)
  const kept = previous?.weekly?.weekStart === weekStart ? previous.weekly : null
  const current = phases[0]
  return {
    version: 1,
    phases,
    currentPhaseId: current.id,
    weekly: kept ?? {
      weekStart,
      goals: current.focus.slice(0, 3).map((text, index) => ({ id: `goal-${index + 1}`, text, done: false }))
    },
    generatedFrom: { estimate, targetBand: targetBand ?? null },
    regeneratedAt: null
  }
}

async function regenerateSyllabus(ctx) {
  const level = await load(ctx, 'level')
  const profileStore = await load(ctx, 'profile')
  const previous = await load(ctx, 'syllabus')
  const latest = (level.points ?? [])[level.points.length - 1]
  const store = buildSyllabus({
    estimate: latest?.estimate ?? 1,
    targetBand: profileStore.profile?.targetBand ?? null,
    todayText: today(ctx),
    previous
  })
  store.regeneratedAt = ctx.now.toISOString()
  await save(ctx, 'syllabus', store)
  return store
}

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
        enabled,
        time,
        timeZone: String(payload.automation.timeZone ?? settings.automation.timeZone)
      }
    }
    if (payload?.audio?.provider) {
      const provider = String(payload.audio.provider)
      if (!['web-speech', 'source-audio'].includes(provider)) {
        fail('invalid_field', 'provider 必须是 web-speech 或 source-audio', 'audio.provider')
      }
      settings.audio = { provider }
    }
    if (payload?.study?.wordsPerDay !== undefined) {
      const words = Number(payload.study.wordsPerDay)
      if (!Number.isInteger(words) || words < 3 || words > 30) {
        fail('invalid_field', 'wordsPerDay 必须是 3 到 30 的整数', 'study.wordsPerDay')
      }
      settings.study = { wordsPerDay: words }
    }
    if (payload?.display?.locale) settings.display = { locale: String(payload.display.locale) }
    await save(ctx, 'settings', settings)
    return settings
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
        latest: latestPoint(level),
        points: level.points ?? [],
        drift: level.drift ?? { baseline: null, streak: 0, note: null }
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
      needsAssessment: !(level.points ?? []).length,
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
    const before = await load(ctx, 'syllabus')
    const todayText = today(ctx)
    const weekStart = addDays(todayText, -((new Date(`${todayText}T00:00:00`).getDay() + 6) % 7))
    const keepWeekly = before.weekly?.weekStart === weekStart ? before.weekly : null
    const phase = normalized.find((candidate) => candidate.id === currentPhaseId)
    const weekly = keepWeekly ?? {
      weekStart,
      goals: (phase.focus.length ? phase.focus : [phase.goal]).slice(0, 3).map((text, index) => ({
        id: `goal-${index + 1}`,
        text,
        done: false
      }))
    }
    const store = { version: 1, phases: normalized, currentPhaseId, weekly, regeneratedAt: ctx.now.toISOString() }
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
    const items = Array.isArray(payload?.items) ? payload.items : []
    if (items.length < 20) {
      fail('bank_too_small', `题库至少 20 道题，收到 ${items.length} 道`, 'items')
    }
    const normalized = items.map((item, index) => {
      const field = `items[${index}]`
      if (!item || typeof item !== 'object') fail('invalid_field', `${field} 必须是对象`, field)
      const difficulty = Number(item.difficulty)
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 6) {
        fail('invalid_field', `${field}.difficulty 必须是 1 到 6 的整数`, `${field}.difficulty`)
      }
      if (!Array.isArray(item.choices) || item.choices.length !== 4) {
        fail('invalid_field', `${field}.choices 必须是 4 个选项`, `${field}.choices`)
      }
      const answerIndex = Number(item.answerIndex)
      if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
        fail('invalid_field', `${field}.answerIndex 必须是 0 到 3`, `${field}.answerIndex`)
      }
      return {
        id: item.id ? String(item.id) : `bank-${index + 1}`,
        difficulty,
        skill: item.skill ? String(item.skill) : 'general',
        prompt: String(item.prompt ?? ''),
        passage: item.passage ? String(item.passage) : '',
        choices: item.choices.map(String),
        answerIndex,
        explanation: item.explanation ? String(item.explanation) : ''
      }
    })
    if (new Set(normalized.map((item) => item.id)).size !== normalized.length) {
      fail('duplicate_item', '题目 id 不能重复', 'items')
    }
    const version = String(payload?.version ?? Date.now().toString(36))
    const bank = { version, createdAt: ctx.now.toISOString(), items: normalized }
    await writeJson(join(ctx.root, FILES.assessments, `bank-${version}.json`), bank)
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
        '还没有题库。先调用 english_save_assessment 提交一套至少 20 道、覆盖多个难度的题目。',
        'items'
      )
    }
    const { value: bank, warning } = await readJson(
      join(ctx.root, FILES.assessments, banks[banks.length - 1]),
      null
    )
    if (warning) ctx.warn(warning)
    if (!bank?.items?.length) fail('no_question_bank', '题库读不出来，请重新提交')

    const anchors = await loadAnchors(ctx)
    const retired = new Set(anchors.retired ?? [])
    const available = anchors.items.filter((item) => !retired.has(item.id))
    const level = await load(ctx, 'level')
    const offset = (level.points?.length ?? 0) * ANCHORS_PER_ASSESSMENT
    const chosen = []
    for (let index = 0; index < ANCHORS_PER_ASSESSMENT && available.length; index += 1) {
      chosen.push(available[(offset + index) % available.length])
    }

    const length = kind === 'short' ? SHORT_ASSESSMENT_LENGTH : ASSESSMENT_LENGTH
    const id = `${today(ctx)}-${kind}-${ctx.now.getTime().toString(36)}`
    const history = await attemptHistory(ctx)
    const pool = bank.items.map((item) => ({ ...item, anchor: false }))
    const anchorItems = chosen.map((item) => ({ ...item, anchor: true }))

    const attempt = {
      id,
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
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      const { value } = await readJson(join(ctx.root, FILES.assessments, ids[index]), null)
      if (value?.status === 'in_progress') {
        return {
          attemptId: value.id,
          total: value.items,
          answered: value.answers.length,
          question: publicQuestion(questionOf(value, value.current)),
          progress: value.answers.length
        }
      }
    }
    return null
  },

  async 'assessment.answer'(ctx, payload) {
    const attemptId = String(payload?.attemptId ?? '')
    const itemId = String(payload?.itemId ?? '')
    const choice = Number(payload?.choice)
    const { value: attempt } = await readJson(assessmentFile(ctx, attemptId), null)
    if (!attempt) fail('attempt_not_found', `找不到测评 ${attemptId}`, 'attemptId')
    if (attempt.status !== 'in_progress') {
      fail('attempt_finished', '这次测评已经结束', 'attemptId')
    }
    if (attempt.current !== itemId) {
      fail('wrong_item', `当前题目是 ${attempt.current}，不是 ${itemId}`, 'itemId')
    }
    const item = questionOf(attempt, itemId)
    if (!item) fail('item_not_found', `题目 ${itemId} 不存在`, 'itemId')
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
      fail('invalid_field', 'choice 必须是 0 到 3 的整数', 'choice')
    }
    const correct = choice === item.answerIndex
    attempt.answers.push({
      itemId,
      choice,
      correct,
      at: ctx.now.toISOString(),
      difficulty: item.difficulty,
      skill: item.skill,
      anchor: Boolean(item.anchor)
    })
    attempt.tier = clamp(correct ? attempt.tier + 1 : attempt.tier - 1, 1, 6)

    if (item.anchor) await recordAnchorResponse(ctx, attempt, item)

    const next = pickNext(attempt)
    if (!next) return await finishAttempt(ctx, attempt)
    attempt.current = next.id
    attempt.order.push(next.id)
    await writeJson(assessmentFile(ctx, attemptId), attempt)
    return {
      attemptId: attempt.id,
      correct,
      answerIndex: item.answerIndex,
      explanation: item.explanation,
      progress: attempt.answers.length,
      total: attempt.items,
      question: publicQuestion(next)
    }
  },

  async 'assessment.finish'(ctx, payload) {
    const attemptId = String(payload?.attemptId ?? '')
    const { value: attempt } = await readJson(assessmentFile(ctx, attemptId), null)
    if (!attempt) fail('attempt_not_found', `找不到测评 ${attemptId}`, 'attemptId')
    if (attempt.status === 'done') return attempt.result
    return await finishAttempt(ctx, attempt)
  },

  async 'assessment.abandon'(ctx, payload) {
    const attemptId = String(payload?.attemptId ?? '')
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

    merged.reviewItems = [
      ...(merged.reviewItems ?? []),
      ...deriveReviewItems(merged)
    ]

    const review = await load(ctx, 'review')
    const reviewStore = { version: 1, items: review.items ?? [] }
    let added = 0
    for (const candidate of merged.reviewItems ?? []) {
      if (reviewStore.items.some((item) => item.id === candidate.id)) continue
      // 课上的词就是当天的第一批新词，所以当天就到期：面板和悬浮层抓到的是
      // 这一课要学的词，而不是另外生成的一批。第一次作答按「认识一下」处理
      // （只排 1 天后的复习，不推盒子），所以当天学完不会把间隔提前。
      reviewStore.items.push(newReviewItem(candidate, ctx.now, merged.date, { freshNow: true }))
      added += 1
    }
    if (added) await save(ctx, 'review', reviewStore)

    return {
      date: merged.date,
      status: merged.status,
      itemCount: merged.items.length,
      cardCount: merged.cards.length,
      reviewAdded: added,
      dueCount: dueItems(reviewStore.items, ctx.now).length
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
    const review = await load(ctx, 'review')
    const items = review.items ?? []
    const known = new Set(items.map((item) => String(item.term).trim().toLowerCase()))
    const ids = new Set(items.map((item) => item.id))
    const added = []
    const skipped = []

    for (const [index, raw] of incoming.entries()) {
      const field = `items[${index}]`
      const term = String(raw?.term ?? '').trim()
      if (!term) fail('invalid_field', `${field}.term 不能为空`, `${field}.term`)
      const key = term.toLowerCase()
      if (known.has(key)) {
        skipped.push({ term, reason: 'duplicate' })
        continue
      }
      const meaning = String(raw?.meaning ?? '').trim()
      if (!meaning) fail('invalid_field', `${field}.meaning 不能为空`, `${field}.meaning`)
      const choices = (Array.isArray(raw?.choices) ? raw.choices : []).map((choice) => String(choice).trim())
      if (choices.length !== 4 || new Set(choices).size !== 4) {
        fail('invalid_field', `${field}.choices 必须是 4 个不同的中文选项`, `${field}.choices`)
      }
      const answerIndex = Number(raw?.answerIndex)
      if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
        fail('invalid_field', `${field}.answerIndex 必须是 0 到 3 的整数`, `${field}.answerIndex`)
      }
      if (choices[answerIndex] !== meaning) {
        fail('invalid_field', `${field}.choices[answerIndex] 必须与 meaning 完全相同`, `${field}.choices`)
      }

      const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'word'
      let id = `rv-${slug}`
      let suffix = 2
      while (ids.has(id)) id = `rv-${slug}-${suffix++}`
      ids.add(id)
      known.add(key)

      const item = newReviewItem(
        {
          id,
          term,
          kind: raw?.kind === 'word' || term.split(/\s+/).length === 1 ? 'word' : 'expression',
          meaning,
          choices,
          answerIndex,
          explanation: raw?.explanation
        },
        ctx.now,
        null,
        { freshNow: true }
      )
      items.push(item)
      added.push(publicReviewItem(item))
    }

    if (added.length) await save(ctx, 'review', { version: 1, items })
    return { added, skipped, addedCount: added.length }
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

  async 'review.answer'(ctx, payload) {
    const itemId = String(payload?.itemId ?? '')
    const choice = Number(payload?.choice)
    const review = await load(ctx, 'review')
    const items = review.items ?? []
    const index = items.findIndex((item) => item.id === itemId)
    if (index < 0) fail('item_not_found', `复习队列里没有 ${itemId}`, 'itemId')
    if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
      fail('invalid_field', 'choice 必须是 0 到 3 的整数', 'choice')
    }
    const item = items[index]
    // Mastery means "correct at the 1, 7 and 30 day interval", so an item that
    // is not yet due cannot advance a box. Answering early is practice, and
    // practice that moved the box would make the intervals meaningless.
    // Due is decided in whole days, same as `review.list`, or the deck could
    // show a word that this guard then refuses.
    if (!isDue(item, ctx.now)) {
      fail('not_due', `「${item.term}」还没到期，${item.dueAt.slice(0, 10)} 之后再答`, 'itemId')
    }
    const correct = choice === item.answerIndex
    const updated = advance(item, correct, ctx.now)
    items[index] = updated
    await save(ctx, 'review', { version: 1, items })
    await appendJsonl(join(ctx.root, FILES.reviewLog), {
      at: ctx.now.toISOString(),
      itemId,
      choice,
      correct,
      box: updated.box,
      status: updated.status
    })
    return {
      correct,
      answerIndex: item.answerIndex,
      explanation: item.explanation,
      box: updated.box,
      status: updated.status,
      dueAt: updated.dueAt,
      dueCount: dueItems(items, ctx.now).length,
      mastered: countMastered(items)
    }
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
      curve: (level.points ?? []).map((point) => ({
        at: point.at,
        band: point.band,
        estimate: point.estimate,
        accuracy: point.accuracy,
        kind: point.kind
      })),
      drift: level.drift ?? { baseline: null, streak: 0, note: null },
      weekly: weeklyView(syllabus, progress, todayText)
    }
  },

  // ----------------------------------------------------------------- record

  async 'record.batch'(ctx, payload) {
    const applied = []
    const skipped = []
    const review = await load(ctx, 'review')
    const items = review.items ?? []

    for (const answer of Array.isArray(payload?.reviewAnswers) ? payload.reviewAnswers : []) {
      const itemId = String(answer?.itemId ?? '')
      const index = items.findIndex((item) => item.id === itemId)
      if (index < 0) {
        skipped.push({ itemId, reason: 'item_not_found' })
        continue
      }
      const stamp = isIsoTimestamp(answer?.at) ? answer.at : ctx.now.toISOString()
      const key = `${itemId}|${stamp}`
      if (applied.some((entry) => entry.key === key)) {
        skipped.push({ itemId, reason: 'duplicate' })
        continue
      }
      const correct = Boolean(answer?.correct)
      items[index] = advance(items[index], correct, ctx.now)
      applied.push({ key, itemId, kind: 'review', correct })
    }
    if (applied.some((entry) => entry.kind === 'review')) {
      await save(ctx, 'review', { version: 1, items })
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
    return { applied, skipped }
  }
}

// -------------------------------------------------------------- assessment helpers

function questionOf(attempt, itemId) {
  if (!itemId) return null
  return (
    attempt.pool.find((item) => item.id === itemId) ??
    attempt.anchors.find((item) => item.id === itemId) ??
    null
  )
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

async function recordAnchorResponse(ctx, attempt, item) {
  const id = item.id
  const log = await readJsonl(join(ctx.root, FILES.anchorLog))
  if (log.some((entry) => entry.attemptId === attempt.id && entry.anchorId === id)) return
  const answer = attempt.answers.find((candidate) => candidate.itemId === id)
  if (!answer) return
  const contaminated = log.some((entry) => entry.anchorId === id)
  answer.contaminated = contaminated
  await appendJsonl(join(ctx.root, FILES.anchorLog), {
    anchorId: id,
    attemptId: attempt.id,
    at: ctx.now.toISOString(),
    correct: answer.correct,
    contaminated
  })
}

async function finishAttempt(ctx, attempt) {
  const scored = scoreAssessment(
    [...attempt.pool, ...attempt.anchors],
    attempt.answers
  )
  // Only a first exposure is an honest reading of the item's difficulty: once
  // the learner has seen an anchor, answering it again measures memory.
  const cleanAnchors = attempt.answers.filter((answer) => answer.anchor && !answer.contaminated)
  const anchorAccuracy = cleanAnchors.length
    ? cleanAnchors.filter((answer) => answer.correct).length / cleanAnchors.length
    : null

  const level = await load(ctx, 'level')
  const drift = anchorAccuracy === null ? level.drift : nextDrift(level.drift, anchorAccuracy)
  const point = {
    id: `level-${ctx.now.getTime().toString(36)}`,
    at: ctx.now.toISOString(),
    kind: attempt.kind,
    band: scored.band,
    estimate: scored.estimate,
    accuracy: scored.accuracy,
    weaknesses: scored.weaknesses,
    reference: scored.reference,
    anchorAccuracy: anchorAccuracy === null ? null : Number(anchorAccuracy.toFixed(2)),
    driftStreak: drift.streak
  }
  level.points = [...(level.points ?? []), point].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  level.drift = drift
  await save(ctx, 'level', level)

  // The first result writes the route. Later results leave it alone: a route
  // that rewrites itself after every test is not a route.
  const syllabus = await load(ctx, 'syllabus')
  if (!(syllabus.phases ?? []).length) await regenerateSyllabus(ctx)

  attempt.status = 'done'
  attempt.updatedAt = ctx.now.toISOString()
  attempt.result = { ...point, drift }
  delete attempt.pool
  delete attempt.anchors
  await writeJson(assessmentFile(ctx, attempt.id), attempt)
  return { attemptId: attempt.id, done: true, result: attempt.result, progress: attempt.answers.length }
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
export async function execute(root, command, payload = {}, options = {}) {
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
