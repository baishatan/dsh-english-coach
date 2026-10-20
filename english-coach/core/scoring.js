import { BANDS, BAND_REFERENCES, clamp } from './constants.js'

/** Map a continuous internal estimate onto one of the six display bands. */
export function bandOf(estimate) {
  const index = clamp(Math.round(Number(estimate) || 1), 1, BANDS.length)
  return BANDS[index - 1]
}

export function referenceOf(band) {
  return BAND_REFERENCES[band] ?? ''
}

/**
 * The level estimate is the difficulty-weighted mean of the items answered
 * correctly, not the share answered correctly. Getting one harder item right
 * says more than getting three easy ones right; accuracy is kept separately as
 * a diagnostic.
 *
 * A weighted mean with the item difficulty as the weight reduces to
 * `sum(d^2) / sum(d)` over correct answers.
 */
export function estimateOf(items, answers) {
  let weighted = 0
  let weight = 0
  for (const answer of answers) {
    if (!answer.correct) continue
    const item = items.find((candidate) => candidate.id === answer.itemId)
    if (!item) continue
    const difficulty = clamp(Number(item.difficulty) || 1, 1, BANDS.length)
    weighted += difficulty * difficulty
    weight += difficulty
  }
  if (!weight) return 1
  return Number((weighted / weight).toFixed(3))
}

export function accuracyOf(answers) {
  if (!answers.length) return 0
  const correct = answers.filter((answer) => answer.correct).length
  return Number((correct / answers.length).toFixed(3))
}

/** The three skills most often missed in this attempt, most-missed first. */
export function weaknessesOf(items, answers, limit = 3) {
  const counts = new Map()
  for (const answer of answers) {
    if (answer.correct) continue
    const item = items.find((candidate) => candidate.id === answer.itemId)
    const skill = item && item.skill ? String(item.skill) : 'general'
    counts.set(skill, (counts.get(skill) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([skill, count]) => ({ skill, missed: count }))
}

export function scoreAssessment(items, answers) {
  const estimate = estimateOf(items, answers)
  const band = bandOf(estimate)
  return {
    estimate,
    band,
    accuracy: accuracyOf(answers),
    weaknesses: weaknessesOf(items, answers),
    reference: referenceOf(band)
  }
}

/**
 * Coarse drift watch. The first assessment's anchor accuracy is the baseline;
 * a run whose anchor accuracy moves by a third or more counts as one observed
 * deviation, and three in a row raises a note. The estimate itself is never
 * corrected automatically: with twelve anchors and one learner, a correction
 * would chase noise.
 */
export function nextDrift(previous, anchorAccuracy) {
  const drift = previous && typeof previous === 'object'
    ? { baseline: previous.baseline ?? null, streak: previous.streak ?? 0, note: previous.note ?? null }
    : { baseline: null, streak: 0, note: null }

  if (drift.baseline === null) {
    return { baseline: Number(anchorAccuracy), streak: 0, note: null }
  }
  const deviated = Math.abs(Number(anchorAccuracy) - drift.baseline) >= 1 / 3 - 1e-9
  const streak = deviated ? drift.streak + 1 : 0
  const note = streak >= 3 ? '近期测评的锚题表现持续偏离基线，难度可能有漂移；分数未作改动。' : null
  return { baseline: drift.baseline, streak, note }
}
