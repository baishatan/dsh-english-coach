import { BANDS, BAND_REFERENCES, clamp } from './constants.js'
import { fail } from './errors.js'

export const SCORING_RULE = 'six-band-grid-v1'

/** Map a continuous internal estimate onto one of the six display bands. */
export function bandOf(estimate) {
  const index = clamp(Math.floor(Number(estimate) + 0.5), 1, BANDS.length)
  return BANDS[index - 1]
}

export function referenceOf(band) {
  return BAND_REFERENCES[band] ?? ''
}

/** Fixed-grid heuristic, not a calibrated ability scale or confidence estimate. */
export function estimateOf(answers) {
  const objectives = []
  for (let index = 0; index <= 250; index++) {
    const theta = (50 + index) / 50
    let objective = -0.25 * (theta - 1)
    for (const answer of answers) {
      const probability = 0.25 + 0.70 / (1 + Math.exp(-1.2 * (theta - answer.difficulty)))
      objective += answer.correct ? Math.log(probability) : Math.log1p(-probability)
    }
    objectives.push(objective)
  }
  // Compare every point with the true grid maximum, not with a chained
  // epsilon comparison that can drift across several near-equal objectives.
  const maximum = Math.max(...objectives)
  return (50 + objectives.findIndex(objective => maximum - objective <= 1e-12)) / 50
}

export function accuracyOf(answers) {
  if (!answers.length) return 0
  const correct = answers.filter((answer) => answer.correct).length
  return Number((correct / answers.length).toFixed(3))
}

/** Missed vocabulary/grammar directions, not independent skill ability scores. */
export function weaknessesOf(answers, limit = 2) {
  const counts = new Map()
  for (const answer of answers) {
    if (answer.correct || !['grammar', 'vocab'].includes(answer.skill)) continue
    const skill = answer.skill
    counts.set(skill, (counts.get(skill) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([skill, count]) => ({ skill, missed: count }))
}

export function scoreAssessment(answers) {
  if (!Array.isArray(answers) || !answers.length || answers.some(answer =>
    !answer || typeof answer.itemId !== 'string' || !answer.itemId.trim() ||
    !Number.isInteger(answer.difficulty) || answer.difficulty < 1 || answer.difficulty > 6 ||
    typeof answer.correct !== 'boolean' || typeof answer.anchor !== 'boolean' ||
    (answer.anchor && typeof answer.contaminated !== 'boolean') ||
    (answer.responseType !== undefined && !['choice', 'unable'].includes(answer.responseType)) ||
    (answer.responseType === 'unable' && answer.correct)
  )) fail('invalid_assessment_evidence', '测评作答证据不完整或损坏，不能据此定档', 'answers')
  const evidence = answers.filter(answer => !(answer.anchor && answer.contaminated))
  if (!evidence.length) fail('invalid_assessment_evidence', '测评没有可用于定档的作答证据，不能结算', 'answers')
  const estimate = estimateOf(evidence)
  const coverageCap = evidence.map(answer => answer.difficulty).sort((a, b) => b - a)[1] ?? 1
  const finalBandIndex = Math.min(Math.floor(estimate + 0.5), coverageCap)
  const band = BANDS[finalBandIndex - 1]
  return {
    estimate,
    scoringRule: SCORING_RULE,
    scoring: { rawEstimate: estimate, rawBandIndex: Math.floor(estimate + 0.5), coverageCap, evidenceCount: evidence.length },
    finalBandIndex,
    band,
    coverageNote: finalBandIndex < Math.floor(estimate + 0.5) ? '本轮题目难度覆盖较窄，已按覆盖范围安排学习档位。' : null,
    accuracy: accuracyOf(answers),
    counts: {
      correct: answers.filter(answer => answer.correct).length,
      incorrect: answers.filter(answer => !answer.correct && answer.responseType !== 'unable').length,
      unable: answers.filter(answer => answer.responseType === 'unable').length
    },
    weaknesses: weaknessesOf(evidence),
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
