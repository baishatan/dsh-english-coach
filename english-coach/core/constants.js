/**
 * Six display bands. The internal scale behind them is a continuous 1..6
 * estimate; the band is what the learner sees. No name of any international
 * grading framework appears here, in the UI, in prompts, or in errors.
 */
export const BANDS = ['入门', '初级', '中级', '中高级', '高级', '精通']

/**
 * One descriptive sentence per band. It helps the learner judge whether the
 * result looks like them. It is deliberately not an equivalence claim.
 */
export const BAND_REFERENCES = {
  入门: '大致能认出常见词、读懂很短的句子。',
  初级: '大致能读懂简单短文，长句子常常要回读一遍。',
  中级: '大致相当于大学四级水平，能读新闻标题和短讯。',
  中高级: '大致相当于大学六级水平，能读一般性的英文长文。',
  高级: '大致能读专业领域的英文长文与评论。',
  精通: '大致能像读中文一样读英文长文，几乎不需要停。'
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
