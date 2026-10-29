import { BOX_DAYS, CHECKUP_DAYS, clamp } from './constants.js'

function plusDays(date, days) {
  const next = new Date(date.getTime())
  next.setDate(next.getDate() + days)
  return next.toISOString()
}

/**
 * `freshNow` marks a word introduced by the learner from the deck rather than
 * pulled out of a lesson. It is due immediately so the first card is the first
 * exposure; answering it books the 1-day review instead of advancing the box.
 */
export function newReviewItem(input, now, sourceLesson, options = {}) {
  const fresh = Boolean(options.freshNow)
  return {
    id: String(input.id),
    term: String(input.term),
    kind: input.kind === 'word' ? 'word' : 'expression',
    meaning: String(input.meaning ?? ''),
    choices: Array.isArray(input.choices) ? input.choices.map(String) : [],
    answerIndex: clamp(Number(input.answerIndex) || 0, 0, 3),
    explanation: String(input.explanation ?? ''),
    box: 1,
    status: 'learning',
    dueAt: fresh ? now.toISOString() : plusDays(now, BOX_DAYS[1]),
    ...(fresh ? { fresh: true } : {}),
    createdAt: now.toISOString(),
    lastAt: null,
    masteredAt: null,
    checkups: 0,
    lapses: 0,
    streak: 0,
    sourceLesson: sourceLesson ?? null,
    answers: []
  }
}

/** Local calendar date of an instant, e.g. "2026-10-21". */
function dayKey(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function isDue(item, now) {
  if (!item || item.status === 'retired') return false
  // Intervals are counted in whole days, not in hours. A word booked for
  // "tomorrow 11:46" is due tomorrow morning, not at 11:46: comparing raw
  // timestamps keeps it hidden until the exact hour it was last answered,
  // which from the learner's side reads as "the new day never arrived".
  const dueDay = dayKey(item.dueAt)
  if (!dueDay) return false
  return dueDay <= dayKey(now)
}

export function dueItems(items, now) {
  return items
    .filter((item) => isDue(item, now))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.id.localeCompare(b.id))
}

/** Whether initial learning is complete, including historical answer evidence. */
export function hasAnswered(item) {
  // Only new initial-learning answers carry this marker. A historical `fresh`
  // flag cannot override evidence that the learner already started the word.
  if (item.initialLearningPending === true && item.box <= 1 && item.status !== 'mastered' && !item.masteredAt) return false
  return (item.answers ?? []).length > 0 || Boolean(item.lastAt || item.masteredAt) || item.status === 'mastered' || item.box > 1
}

export function advance(item, correct, now) {
  const at = now.toISOString()
  const next = {
    ...item,
    lastAt: at,
    answers: [...(item.answers ?? []), { at, correct: Boolean(correct) }].slice(-20)
  }

  // Initial learning ends only with a correct answer. Keep errors due and
  // fresh so the same word can be corrected without advancing twice.
  if (!hasAnswered(item)) {
    return {
      ...next,
      fresh: !correct,
      initialLearningPending: !correct,
      box: 1,
      status: 'learning',
      streak: 0,
      lapses: correct ? (item.lapses ?? 0) : (item.lapses ?? 0) + 1,
      dueAt: correct ? plusDays(now, BOX_DAYS[1]) : item.dueAt
    }
  }

  // Errors are saved, but leave the current stage and due date intact so the
  // learner can correct this same item before completing its interval.
  if (!correct) {
    return {
      ...next,
      streak: 0,
      lapses: (item.lapses ?? 0) + 1
    }
  }

  if (item.status === 'mastered') {
    return {
      ...next,
      box: 4,
      checkups: (item.checkups ?? 0) + 1,
      dueAt: plusDays(now, CHECKUP_DAYS)
    }
  }

  const box = Math.min(4, (item.box ?? 0) + 1)
  if (box >= 4) {
    return {
      ...next,
      box: 4,
      status: 'mastered',
      streak: (item.streak ?? 0) + 1,
      masteredAt: at,
      dueAt: plusDays(now, CHECKUP_DAYS)
    }
  }
  return {
    ...next,
    box,
    status: 'learning',
    streak: (item.streak ?? 0) + 1,
    dueAt: plusDays(now, BOX_DAYS[box])
  }
}

export function countMastered(items) {
  return items.filter((item) => item.status === 'mastered').length
}
