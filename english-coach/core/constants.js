/**
 * Six display bands. The internal scale behind them is a continuous 1..6
 * estimate; the band is what the learner sees. No name of any international
 * grading framework appears here, in the UI, in prompts, or in errors.
 */
export const BANDS = ['入门', '初级', '中级', '中高级', '高级', '精通']
export const ASSESSMENT_SCOPE = '根据词汇与语法短题估计，仅供安排学习'

/**
 * One descriptive sentence per band. It helps the learner judge whether the
 * result looks like them. It is deliberately not an equivalence claim.
 */
export const BAND_REFERENCES = {
  入门: '可从常见基础词汇和简单句式开始练习。',
  初级: '对常用词汇和基础语法已有一些掌握，可继续练习日常搭配。',
  中级: '能处理常见词汇搭配和语法选择，可巩固易混表达与句式。',
  中高级: '对较丰富的词汇搭配和较复杂句式有一定掌握，可练习细微区别。',
  高级: '能较好处理较难词汇与复杂语法短题，可继续辨析语境和搭配。',
  精通: '在本轮较高难度词汇与语法短题中表现熟练，可继续拓展精细用法。'
}

/** Box index → days until the item is due again. Box 4 is `mastered`. */
export const BOX_DAYS = [0, 1, 7, 30, 90]

/** A mastered item is re-checked after this many days. */
export const CHECKUP_DAYS = 90

/** A full assessment shows about this many items. */
export const ASSESSMENT_LENGTH = 20
/** A short check-up assessment shows about this many items. */
export const SHORT_ASSESSMENT_LENGTH = 10
/** Anchors mixed into every assessment, unmarked. */
export const ANCHORS_PER_ASSESSMENT = 3

/** Curated native Kokoro voices, in the learner-approved default order. */
export const KOKORO_VOICES = ['af_heart', 'am_michael', 'bf_emma', 'bm_george']
export const READING_RATES = [0.5, 1, 1.5, 2]

export const ITEM_TYPES = ['reading', 'listening', 'expressions', 'quiz', 'ordering']
export const REQUIRED_ITEM_TYPES = ['reading', 'listening', 'expressions', 'quiz']

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Local calendar date of `date` as YYYY-MM-DD. */
export function dateOf(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** Parse YYYY-MM-DD into a local Date at midnight. */
export function parseDate(text) {
  const [y, m, d] = String(text).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(dateText, days) {
  const date = parseDate(dateText)
  date.setDate(date.getDate() + days)
  return dateOf(date)
}

/** Whole days from `from` to `to` (both YYYY-MM-DD, local). */
export function daysBetween(from, to) {
  const a = parseDate(from)
  const b = parseDate(to)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

export function isIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  const time = Date.parse(value)
  return Number.isFinite(time)
}

export function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value))
}
