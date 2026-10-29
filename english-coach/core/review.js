import { BOX_DAYS, CHECKUP_DAYS, clamp } from './constants.js'

const DAY_MS = 86_400_000

function plusDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS).toISOString()
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

/**
 * Move one item through its boxes.
 *
 * A correct answer advances one box: 1 day, 7 days, 30 days, then mastered.
 * Mastery is exactly "answered correctly at the 1, 7 and 30 day intervals",
 * which is what three consecutive correct answers at those boxes means.
 *
 * A wrong answer drops back to the first box and clears the interval streak, so
 * mastery can never be reached while carrying a miss. The one exception is the
 * 90-day check-up on an already-mastered item: missing that returns it to the
 * 30-day box, because the item was demonstrably learned once.
 */
export function hasAnswered(item) {
  // Errors during initial learning are real answers, but do not finish it.
  // Historical items without `fresh` keep their existing learned state.
  if (item.fresh === true && item.box <= 1 && item.status !== 'mastered' && !item.masteredAt) return false
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
      box: 1,
      status: 'learning',
      streak: 0,
      lapses: correct ? (item.lapses ?? 0) : (item.lapses ?? 0) + 1,
      dueAt: correct ? plusDays(now, BOX_DAYS[1]) : item.dueAt
    }
  }

  if (!correct) {
    const mastered = item.status === 'mastered'
    return {
      ...next,
      box: mastered ? 3 : 1,
      status: 'learning',
      streak: 0,
      lapses: (item.lapses ?? 0) + 1,
      masteredAt: mastered ? null : item.masteredAt ?? null,
      dueAt: plusDays(now, mastered ? BOX_DAYS[3] : BOX_DAYS[1])
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
