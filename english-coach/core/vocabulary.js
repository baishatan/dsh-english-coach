import { fail } from './errors.js'
import { newReviewItem } from './review.js'

export function termKey(term) {
  return String(term ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function validatePractice(raw, field) {
  const term = String(raw?.term ?? '').trim().replace(/\s+/g, ' ')
  if (!term) fail('invalid_field', `${field}.term 不能为空`, `${field}.term`)
  const meaning = String(raw?.meaning ?? '').trim()
  if (!/[\u3400-\u9fff]/u.test(meaning)) fail('invalid_field', `${field}.meaning 必须包含中文释义`, `${field}.meaning`)
  const choices = (Array.isArray(raw?.choices) ? raw.choices : []).map(value => String(value).trim())
  if (choices.length !== 4 || new Set(choices).size !== 4 || choices.some(value => !/[\u3400-\u9fff]/u.test(value))) {
    fail('invalid_field', `${field}.choices 必须是 4 个不同的中文选项`, `${field}.choices`)
  }
  const answerIndex = Number(raw?.answerIndex)
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex > 3) {
    fail('invalid_field', `${field}.answerIndex 必须是 0 到 3 的整数`, `${field}.answerIndex`)
  }
  if (choices[answerIndex] !== meaning) fail('invalid_field', `${field}.choices[answerIndex] 必须与 meaning 完全相同`, `${field}.choices`)
  return { ...raw, term, meaning, choices, answerIndex }
}

/** One enrolment rule for courses, derived expressions and supplements. */
export function enrol(review, incoming, now, source, field = 'items') {
  const items = review.items ?? (review.items = [])
  const byTerm = new Map()
  for (const item of items) if (!byTerm.has(termKey(item.term))) byTerm.set(termKey(item.term), item)
  const ids = new Set(items.map(item => item.id))
  const added = [], skipped = [], linked = []
  for (const [index, raw] of incoming.entries()) {
    const key = termKey(raw?.term)
    if (!key) fail('invalid_field', `${field}[${index}].term 不能为空`, `${field}[${index}].term`)
    const existing = byTerm.get(key)
    if (existing) {
      const sources = existing.sources ?? (existing.sourceLesson ? [{ kind: 'lesson', id: existing.sourceLesson }] : [])
      if (!sources.some(entry => entry.kind === source.kind && entry.id === source.id)) {
        existing.sources = [...sources, source]
        linked.push(existing.id)
      }
      skipped.push({ term: raw.term, id: existing.id, reason: 'duplicate' })
      continue
    }
    const valid = validatePractice(raw, `${field}[${index}]`)
    const slug = key.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'word'
    const requested = raw.id ? String(raw.id) : `rv-${slug}`
    let id = requested, suffix = 2
    while (ids.has(id)) id = `${requested}-${suffix++}`
    const item = newReviewItem({ ...valid, id, kind: raw.kind === 'word' || !key.includes(' ') ? 'word' : 'expression' }, now, source.kind === 'lesson' ? source.id : null, { freshNow: true })
    item.sources = [source]
    items.push(item)
    byTerm.set(key, item)
    ids.add(id)
    added.push(item)
  }
  return { added, skipped, linked, addedCount: added.length, linkedCount: linked.length }
}
