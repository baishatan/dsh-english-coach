import { DATE_RE, ITEM_TYPES, REQUIRED_ITEM_TYPES, isIsoTimestamp } from './constants.js'
import { fail } from './errors.js'

function str(value, field, { max = 20_000, allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail('invalid_field', `${field} 必须是字符串`, field)
  const text = allowEmpty ? value : value.trim()
  if (!allowEmpty && !text) fail('invalid_field', `${field} 不能为空`, field)
  if (text.length > max) fail('invalid_field', `${field} 过长（上限 ${max} 字符）`, field)
  return text
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function assertChoiceList(choices, field) {
  if (!Array.isArray(choices) || choices.length !== 4) {
    fail('invalid_field', `${field} 必须是 4 个选项`, field)
  }
  return choices.map((choice, index) => str(choice, `${field}[${index}]`, { max: 500 }))
}

function assertAnswerIndex(value, field) {
  const index = Number(value)
  if (!Number.isInteger(index) || index < 0 || index > 3) {
    fail('invalid_field', `${field} 必须是 0 到 3 的整数`, field)
  }
  return index
}

/** A small deterministic PRNG, so the same input always shuffles the same way. */
export function seededShuffle(words, seedText, attempt = 0) {
  let state = 2166136261 >>> 0
  for (const char of `${seedText}#${attempt}`) {
    state ^= char.codePointAt(0)
    state = Math.imul(state, 16777619) >>> 0
  }
  const out = words.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    state ^= state << 13
    state >>>= 0
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    const j = state % (i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

/** Shuffle a sentence's words, guaranteeing the order is not already correct. */
export function shuffleWords(sentence, seedText) {
  const words = String(sentence).trim().split(/\s+/).filter(Boolean)
  if (words.length < 2) return words
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const shuffled = seededShuffle(words, seedText, attempt)
    if (shuffled.join(' ') !== words.join(' ')) return shuffled
  }
  return [...words.slice(1), words[0]]
}

function normalizeSource(source, index) {
  const field = `sources[${index}]`
  if (!source || typeof source !== 'object') fail('invalid_field', `${field} 必须是对象`, field)
  const url = str(source.url, `${field}.url`, { max: 2000 })
  if (!isHttpUrl(url)) {
    fail('source_url_invalid', `${field}.url 必须是可访问的 http(s) 链接`, `${field}.url`)
  }
  const fetchedAt = str(source.fetchedAt, `${field}.fetchedAt`)
  if (!isIsoTimestamp(fetchedAt)) {
    fail('source_fetched_at_invalid', `${field}.fetchedAt 必须是 ISO 时间`, `${field}.fetchedAt`)
  }
  const license = str(source.license, `${field}.license`, { max: 500 })
  return {
    id: source.id ? String(source.id) : `src-${index + 1}`,
    kind: source.kind === 'listening' ? 'listening' : 'reading',
    url,
    title: source.title ? String(source.title) : '',
    publisher: source.publisher ? String(source.publisher) : '',
    fetchedAt,
    license,
    note: source.note ? String(source.note) : ''
  }
}

function normalizeItem(item, index, sourceIds) {
  const field = `items[${index}]`
  if (!item || typeof item !== 'object') fail('invalid_field', `${field} 必须是对象`, field)
  const type = String(item.type ?? '')
  if (!ITEM_TYPES.includes(type)) {
    fail('invalid_item_type', `${field}.type 必须是 ${ITEM_TYPES.join(' / ')} 之一`, `${field}.type`)
  }
  const id = item.id ? String(item.id) : `item-${index + 1}`
  const base = {
    id,
    type,
    title: item.title ? String(item.title) : '',
    minutes: Number.isFinite(Number(item.minutes)) ? Math.max(1, Number(item.minutes)) : 5,
    done: false,
    doneAt: null
  }

  if (type === 'reading') {
    const sourceId = str(item.sourceId, `${field}.sourceId`)
    if (!sourceIds.has(sourceId)) {
      fail('item_source_missing', `${field}.sourceId 指向不存在的素材 ${sourceId}`, `${field}.sourceId`)
    }
    return { ...base, sourceId, body: str(item.body, `${field}.body`) }
  }

  if (type === 'listening') {
    const sourceId = str(item.sourceId, `${field}.sourceId`)
    if (!sourceIds.has(sourceId)) {
      fail('item_source_missing', `${field}.sourceId 指向不存在的素材 ${sourceId}`, `${field}.sourceId`)
    }
    return { ...base, sourceId, transcript: str(item.transcript, `${field}.transcript`) }
  }

  if (type === 'expressions') {
    const list = Array.isArray(item.expressions) ? item.expressions : []
    if (!list.length) fail('invalid_field', `${field}.expressions 至少一条`, `${field}.expressions`)
    return {
      ...base,
      expressions: list.map((entry, position) => {
        const at = `${field}.expressions[${position}]`
        if (!entry || typeof entry !== 'object') fail('invalid_field', `${at} 必须是对象`, at)
        return {
          term: str(entry.term, `${at}.term`, { max: 300 }),
          meaning: str(entry.meaning, `${at}.meaning`, { max: 500 }),
          example: entry.example ? String(entry.example) : '',
          note: entry.note ? String(entry.note) : ''
        }
      })
    }
  }

  if (type === 'quiz') {
    const questions = Array.isArray(item.questions) ? item.questions : []
    if (!questions.length) fail('invalid_field', `${field}.questions 至少一题`, `${field}.questions`)
    return {
      ...base,
      questions: questions.map((question, position) => {
        const at = `${field}.questions[${position}]`
        if (!question || typeof question !== 'object') fail('invalid_field', `${at} 必须是对象`, at)
        return {
          id: question.id ? String(question.id) : `${id}-q${position + 1}`,
          prompt: str(question.prompt, `${at}.prompt`, { max: 1000 }),
          choices: assertChoiceList(question.choices, `${at}.choices`),
          answerIndex: assertAnswerIndex(question.answerIndex, `${at}.answerIndex`),
          explanation: question.explanation ? String(question.explanation) : ''
        }
      })
    }
  }

  const answer = str(item.answer, `${field}.answer`, { max: 1000 })
  const words = shuffleWords(answer, `${id}`)
  return {
    ...base,
    prompt: item.prompt ? String(item.prompt) : '',
    hint: item.hint ? String(item.hint) : '',
    answer,
    words,
    explanation: item.explanation ? String(item.explanation) : ''
  }
}

function normalizeReviewItem(entry, index) {
  const field = `reviewItems[${index}]`
  if (!entry || typeof entry !== 'object') fail('invalid_field', `${field} 必须是对象`, field)
  return {
    id: entry.id ? String(entry.id) : `rv-${index + 1}`,
    term: str(entry.term, `${field}.term`, { max: 300 }),
    kind: entry.kind === 'word' ? 'word' : 'expression',
    meaning: str(entry.meaning, `${field}.meaning`, { max: 500 }),
    choices: assertChoiceList(entry.choices, `${field}.choices`),
    answerIndex: assertAnswerIndex(entry.answerIndex, `${field}.answerIndex`),
    explanation: entry.explanation ? String(entry.explanation) : ''
  }
}

/**
 * Validate and normalize one lesson submission. Everything the learner will
 * later trust is checked here: a source without a link, a fetch time or a
 * license cannot reach the disk, so a lesson can never show invented text as
 * if it were fetched.
 */
export function validateLesson(payload, { today }) {
  if (!payload || typeof payload !== 'object') fail('invalid_payload', '缺少课程内容')
  const date = str(payload.date, 'date')
  if (!DATE_RE.test(date)) fail('invalid_date', 'date 必须是 YYYY-MM-DD', 'date')
  if (date > today) fail('invalid_date', '不能提交未来日期的课程', 'date')

  const rawSources = Array.isArray(payload.sources) ? payload.sources : []
  if (!rawSources.length) fail('missing_sources', '课程必须带素材来源', 'sources')
  const sources = rawSources.map(normalizeSource)
  const sourceIds = new Set(sources.map((source) => source.id))
  if (sourceIds.size !== sources.length) fail('duplicate_source', '素材 id 不能重复', 'sources')

  const rawItems = Array.isArray(payload.items) ? payload.items : []
  if (!rawItems.length) fail('missing_items', '课程必须至少有一个学习项', 'items')
  const items = rawItems.map((item, index) => normalizeItem(item, index, sourceIds))
  const itemIds = new Set(items.map((item) => item.id))
  if (itemIds.size !== items.length) fail('duplicate_item', '学习项 id 不能重复', 'items')

  for (const required of REQUIRED_ITEM_TYPES) {
    if (!items.some((item) => item.type === required)) {
      fail('missing_item_type', `课程缺少「${required}」学习项`, 'items')
    }
  }

  const reviewItems = (Array.isArray(payload.reviewItems) ? payload.reviewItems : []).map(normalizeReviewItem)
  const cards = (Array.isArray(payload.cards) ? payload.cards : []).map((card, index) => {
    const field = `cards[${index}]`
    if (!card || typeof card !== 'object') fail('invalid_field', `${field} 必须是对象`, field)
    return {
      id: card.id ? String(card.id) : `fc-${index + 1}`,
      kind: card.kind === 'quiz' ? 'quiz' : 'review',
      front: str(card.front, `${field}.front`, { max: 500 }),
      back: str(card.back, `${field}.back`, { max: 1000 }),
      explanation: card.explanation ? String(card.explanation) : '',
      choices: Array.isArray(card.choices) ? assertChoiceList(card.choices, `${field}.choices`) : null,
      answerIndex: card.answerIndex === undefined ? null : assertAnswerIndex(card.answerIndex, `${field}.answerIndex`)
    }
  })

  return {
    date,
    title: str(payload.title, 'title', { max: 200 }),
    summary: payload.summary ? String(payload.summary) : '',
    note: payload.note ? String(payload.note) : '',
    sources,
    items,
    reviewItems,
    cards,
    status: 'draft',
    createdAt: null,
    updatedAt: null,
    startedAt: null,
    finishedAt: null
  }
}

export function isComplete(lesson) {
  return lesson.items.every((item) => item.done)
}

export function remainingMinutes(lesson) {
  return lesson.items.filter((item) => !item.done).reduce((sum, item) => sum + (item.minutes || 0), 0)
}

/**
 * Render the lesson as Markdown beside its JSON, so the data folder stays
 * readable without the plugin. Chinese explanation always follows the English
 * body, never interleaved into it.
 */
export function renderLessonMarkdown(lesson) {
  const lines = [`# ${lesson.title}`, '', `日期：${lesson.date}　状态：${lesson.status}`, '']
  if (lesson.summary) lines.push(lesson.summary, '')

  for (const item of lesson.items) {
    lines.push(`## ${item.title || item.type}（约 ${item.minutes} 分钟）`, '')
    if (item.type === 'reading' || item.type === 'listening') {
      const body = item.body ?? item.transcript ?? ''
      lines.push(body, '')
      const source = lesson.sources.find((candidate) => candidate.id === item.sourceId)
      if (source) lines.push(`原文：${source.url}（抓取于 ${source.fetchedAt}，${source.license}）`, '')
    } else if (item.type === 'expressions') {
      for (const expression of item.expressions) {
        lines.push(`- **${expression.term}** — ${expression.meaning}`)
        if (expression.example) lines.push(`  - ${expression.example}`)
      }
      lines.push('')
    } else if (item.type === 'quiz') {
      for (const question of item.questions) {
        lines.push(`1. ${question.prompt}`)
        question.choices.forEach((choice, index) => {
          const mark = index === question.answerIndex ? ' ✓' : ''
          lines.push(`   - ${choice}${mark}`)
        })
        if (question.explanation) lines.push(`   - 讲解：${question.explanation}`)
      }
      lines.push('')
    } else if (item.type === 'ordering') {
      lines.push(`把词语排成一句话：${item.words.join(' / ')}`, '')
      lines.push(`> 正确答案：${item.answer}`, '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}
