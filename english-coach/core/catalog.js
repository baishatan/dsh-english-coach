import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

let cached
const normalize = value => value.trim().replace(/\s+/gu, ' ').toLowerCase()
const sameMembers = (left, right) => {
  const expected = new Set(right)
  return left.length === right.length && new Set(left).size === left.length && left.every(id => expected.has(id))
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

function validate(data, manifest) {
  if (data.schemaVersion !== 1 || data.version !== manifest.version ||
      data.source?.commit !== 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b' ||
      !Array.isArray(data.entries) || !Array.isArray(data.lists)) throw new Error('词库格式或版本不匹配。')
  const byId = new Map()
  let previous = ''
  for (const entry of data.entries) {
    if (typeof entry.term !== 'string' || !entry.term.trim() || entry.key !== normalize(entry.term) ||
        entry.id !== `ecdict:${entry.key}` || byId.has(entry.id) || entry.key < previous ||
        typeof entry.meaning !== 'string' || typeof entry.translation !== 'string' ||
        !Array.isArray(entry.sourceTags) || !Array.isArray(entry.listIds) ||
        !Array.isArray(entry.sourceRows) || !entry.sourceRows.length) throw new Error('词库词条不完整或顺序不正确。')
    previous = entry.key
    byId.set(entry.id, entry)
    const expectedLists = ['cet4', 'cet6', 'ielts'].filter(id => id === 'cet6'
      ? entry.sourceTags.some(tag => tag === 'cet4' || tag === 'cet6') : entry.sourceTags.includes(id))
    if (!expectedLists.length || !sameMembers(entry.listIds, expectedLists)) throw new Error('词库成员关系不匹配。')
    const practice = entry.practice
    if (practice?.status === 'ready') {
      if (!/[\u3400-\u9fff]/u.test(entry.meaning) || !Array.isArray(practice.choices) ||
          practice.choices.length !== 4 || new Set(practice.choices).size !== 4 ||
          practice.choices.some(choice => typeof choice !== 'string' || !/[\u3400-\u9fff]/u.test(choice)) ||
          !Number.isInteger(practice.answerIndex) || practice.answerIndex < 0 || practice.answerIndex > 3 ||
          practice.choices[practice.answerIndex] !== entry.meaning) throw new Error('词库练习不符合四选契约。')
    } else if (practice?.status !== 'unavailable' || !practice.reasonCode || !practice.reason || practice.choices) {
      throw new Error('词库缺少明确的练习就绪结论。')
    }
  }
  if (!sameMembers(data.lists.map(list => list.id), ['cet4', 'cet6', 'ielts'])) throw new Error('词库目录不完整。')
  for (const list of data.lists) {
    const members = data.entries.filter(entry => entry.listIds.includes(list.id))
    const ids = members.map(entry => entry.id)
    const ready = members.filter(entry => entry.practice.status === 'ready').length
    if (!Array.isArray(list.entryIds) || !Array.isArray(list.studyOrder) ||
        !sameMembers(list.entryIds, ids) || !sameMembers(list.studyOrder, ids) ||
        list.entryIds.some((id, i) => id !== ids[i]) ||
        list.total !== members.length || list.playableCount !== ready || list.unavailableCount !== members.length - ready) {
      throw new Error('词库计数、成员或学习顺序不匹配。')
    }
  }
  if (data.entries.length !== manifest.uniqueEntries ||
      data.entries.filter(entry => entry.practice.status === 'ready').length !== manifest.playableEntries) {
    throw new Error('词库清单计数不匹配。')
  }
}

/**
 * Read the immutable, packaged catalogue. No network, model calls or learner IO.
 * Synchronous lazy read: the first successful call checks SHA-256 and contracts;
 * later calls return the same deeply frozen object. A failed read is not cached,
 * so a retry can recover after a missing/damaged package is repaired.
 *
 * Returns { schemaVersion, version, source, lists, entries }. entryIds are the
 * full alphabetical membership; studyOrder is the full fixed shuffled order.
 * Neither is a page or a learner queue. Callers own selection, pagination and
 * personal state. practice.status === 'ready' is the only enrolment eligibility.
 * Throws code WORD_CATALOG_UNAVAILABLE; never returns a fabricated empty list.
 */
export function getWordCatalog() {
  if (cached) return cached
  try {
    const bytes = readFileSync(new URL('../data/wordlists.json', import.meta.url))
    const manifest = JSON.parse(readFileSync(new URL('../data/manifest.json', import.meta.url), 'utf8'))
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== manifest.artifact?.sha256 || bytes.length !== manifest.artifact?.bytes) throw new Error('词库文件校验和不匹配。')
    const data = JSON.parse(bytes.toString('utf8'))
    validate(data, manifest)
    cached = freeze(data)
    return cached
  } catch (cause) {
    const error = new Error('主题词库数据无法读取或已损坏，请检查插件数据文件后重试。', { cause })
    error.code = 'WORD_CATALOG_UNAVAILABLE'
    throw error
  }
}
