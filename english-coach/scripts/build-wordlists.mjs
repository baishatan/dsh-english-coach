#!/usr/bin/env node
// Offline, deterministic build. The complete pinned CSV is an explicit input;
// neither this script nor the runtime catalogue downloads or generates content.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMMIT = 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b'
const SOURCE_BYTES = 65933428
const SOURCE_BLOB = 'c4ade63ea08cf39d9c3475e96929036d64d94c94'
const VERSION = 'ecdict-bc015ed2-conservative-v1'
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex')
const keyOf = value => value.trim().replace(/\s+/gu, ' ').toLowerCase()

const args = process.argv.slice(2)
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
if (!option('--source') || !option('--license')) {
  console.error('Usage: node scripts/build-wordlists.mjs --source /path/ecdict.csv --license /path/LICENSE [--out /path/data] [--report /path/report.json]')
  process.exit(1)
}
if (!/^24\.(?:2[1-9]|[3-9]\d|\d{3,})\./u.test(process.versions.node)) throw new Error('Build requires Node >=24.21.0 <25.')
const output = resolve(option('--out') || resolve(ROOT, 'data'))
const bytes = await readFile(resolve(option('--source')))
const blob = hash(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]), 'sha1')
if (bytes.length !== SOURCE_BYTES || blob !== SOURCE_BLOB) throw new Error(`Pinned source mismatch: bytes=${bytes.length}, gitBlob=${blob}`)
const license = await readFile(resolve(option('--license')), 'utf8')
if (hash(license) !== 'f8552dd246f61a4e064569eae6194a01c6b3d63b03bf27c6ca863593c549ed0f') throw new Error('Expected exact pinned ECDICT MIT license with Linwei attribution.')

// RFC 4180 quoted commas/newlines/doubled quotes; fail closed on malformed rows.
function* csvRows(text) {
  let fields = [], field = '', quoted = false, closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') { quoted = false; closed = true }
      else field += c
    } else if (c === ',' || c === '\n' || c === '\r') {
      fields.push(field); field = ''; closed = false
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++
        if (fields.length > 1 || fields[0]) yield fields
        fields = []
      }
    } else if (c === '"' && !field && !closed) quoted = true
    else {
      if (closed || c === '"') throw new Error(`Malformed CSV at character ${i}`)
      field += c
    }
  }
  if (quoted) throw new Error('Unterminated CSV quote.')
  if (field || fields.length || closed) { fields.push(field); yield fields }
}

const rows = csvRows(bytes.toString('utf8'))
const header = rows.next().value
const expected = 'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio'
if (header.join(',') !== expected) throw new Error('Unexpected ECDICT columns.')
const entriesByKey = new Map()
const rawTagCounts = { cet4: 0, cet6: 0, ielts: 0 }
let rowCount = 0, selectedRows = 0, duplicateRows = 0
for (const row of rows) {
  rowCount++
  if (row.length !== header.length) throw new Error(`Unexpected column count at record ${rowCount + 1}`)
  const tags = [...new Set(row[7].trim().split(/\s+/u).filter(Boolean))].sort(compare)
  if (!['cet4', 'cet6', 'ielts'].some(tag => tags.includes(tag))) continue
  selectedRows++
  for (const tag of Object.keys(rawTagCounts)) if (tags.includes(tag)) rawTagCounts[tag]++
  const term = row[0].trim().replace(/\s+/gu, ' ')
  const key = keyOf(term)
  if (!key) throw new Error(`Empty selected word at record ${rowCount + 1}`)
  const translation = row[3].replace(/\\n/gu, '\n').replace(/\r\n?/gu, '\n').trim()
  const existing = entriesByKey.get(key)
  if (existing) {
    duplicateRows++
    existing.sourceTags = [...new Set([...existing.sourceTags, ...tags])].sort(compare)
    existing.sourceRows.push(rowCount + 1)
    if (!existing.sourceTranslations.includes(translation)) existing.sourceTranslations.push(translation)
  } else entriesByKey.set(key, {
    id: `ecdict:${key}`, key, term, kind: /\s/u.test(term) ? 'expression' : 'word',
    sourceTags: tags, sourceRows: [rowCount + 1], sourceTranslations: [translation]
  })
}

// These intentionally distant, concrete concepts are basic recognition distractors,
// not a claim to test fine-grained synonym discrimination. Synonyms and common
// variants are screened against the entire source translation, not only meaning.
const distractors = [
  { meaning: '苹果', aliases: ['苹果', 'apple'] },
  { meaning: '火车', aliases: ['火车', '列车', '铁路', '铁道', 'train', 'rail'] },
  { meaning: '医院', aliases: ['医院', '诊所', '医务', 'hospital', 'clinic'] },
  { meaning: '星期三', aliases: ['星期', '周三', '礼拜', 'wednesday'] },
  { meaning: '雨伞', aliases: ['雨伞', '阳伞', '伞', 'umbrella', 'parasol'] },
  { meaning: '沙漠', aliases: ['沙漠', '荒漠', '戈壁', 'desert'] },
  { meaning: '钢琴', aliases: ['钢琴', '键盘', 'piano', 'keyboard'] },
  { meaning: '牙齿', aliases: ['牙齿', '牙', '齿', 'tooth', 'teeth', 'dental'] },
  { meaning: '蝴蝶', aliases: ['蝴蝶', '蝶', 'butterfly'] },
  { meaning: '护照', aliases: ['护照', '通行证', 'passport'] },
  { meaning: '厨房', aliases: ['厨房', '灶', '厨', 'kitchen'] },
  { meaning: '大象', aliases: ['大象', '象', 'elephant'] },
  { meaning: '邮票', aliases: ['邮票', '印花', '邮资', 'stamp', 'postage'] },
  { meaning: '瀑布', aliases: ['瀑布', '瀑', 'waterfall', 'cataract', 'cascade'] },
  { meaning: '枕头', aliases: ['枕头', '枕', 'pillow', 'bolster'] },
  { meaning: '蜡烛', aliases: ['蜡烛', '烛', 'candle', 'taper'] },
  { meaning: '手套', aliases: ['手套', 'glove', 'mitten'] },
  { meaning: '葡萄', aliases: ['葡萄', 'grape', 'vine'] },
  { meaning: '机场', aliases: ['机场', '航空港', '飞行场', 'airfield', 'airport', 'aerodrome'] },
  { meaning: '镜子', aliases: ['镜子', '镜', 'mirror', 'looking-glass'] },
  { meaning: '盐', aliases: ['盐', '氯化钠', 'salt', 'sodium'] },
  { meaning: '火山', aliases: ['火山', 'volcano', 'volcanic'] },
  { meaning: '毛巾', aliases: ['毛巾', '手巾', '面巾', 'towel'] },
  { meaning: '蜜蜂', aliases: ['蜜蜂', '蜂', 'bee'] }
]
// Source glosses observed during the non-professional review that are too
// marginal, broad, or context-dependent for a decontextualized basic question.
// Do not replace them with invented translations; retain them for browsing.
const knownRisks = new Map([
  ['approaches', '源释义“处理”未限定词性及语境，基础题暂缓。'],
  ['causes', '源释义未区分复数名词与动词变形，基础题暂缓。'],
  ['institutions', '源释义“体系”过于宽泛，需结合语境核对。'],
  ['mall', '源释义仅列较少见的“林荫路”，缺少常用购物场所义，暂缓备题。'],
  ['pictures', '源释义仅列“电影院”，缺少常见图片义，需上下文核对。'],
  ['weeds', '源释义仅列少见的“丧服”，缺少常见杂草义，暂缓备题。'],
  ['flourishment', '词形较少见，尚需核对拼写及适合的学习语境。'],
  ['southwards', '源释义“在南方”未清楚表达方向，需核对。'],
  ['thanksgiving', '源释义未区分普通名词与节日名称，需语境。'],
  ['paraphernalia', '源释义“随身用具”过于宽泛，可能包含干扰项所指物品。']
])
const reasons = {
  source_conflict: '同词面存在不同源释义，尚需核对后备题。',
  missing_meaning: '源数据缺少明确中文释义，暂不可练。',
  term_format: '词形含缩写、大写或特殊格式，尚需人工核对。',
  formatting: '源释义含领域标记、括注或混合排版，尚需清理核对。',
  multiple_senses: '源释义含多个义项或词性，尚未确定无歧义的基础题。',
  grammar_or_usage: '该释义涉及语法、变形或用法说明，尚需上下文备题。',
  meaning_length: '释义过短或过长，尚需核对后备题。',
  distractor_overlap: '未找到三个通过语义重叠风险筛查的干扰项。'
}
const entries = [...entriesByKey.values()].sort((a, b) => compare(a.key, b.key))
for (const entry of entries) {
  entry.listIds = ['cet4', 'cet6', 'ielts'].filter(id => id === 'cet6'
    ? entry.sourceTags.some(tag => tag === 'cet4' || tag === 'cet6') : entry.sourceTags.includes(id))
  // Keep the complete supplied translation for browsing, including quarantined
  // records. Only remove known POS prefixes for the meaning shown in practice.
  entry.translation = entry.sourceTranslations.join('\n---\n')
  const normalized = entry.translation.replace(/^(?:(?:n|v|vt|vi|a|adj|adv|ad|prep|pron|conj|interj|num|art)\.\s*)/u, '').trim()
  entry.meaning = normalized
  let code
  if (entry.sourceTranslations.length > 1) code = 'source_conflict'
  else if (!/[\u3400-\u9fff]/u.test(normalized)) code = 'missing_meaning'
  else if (!/^[a-z]+(?:[-'][a-z]+)*$/u.test(entry.term)) code = 'term_format'
  else if (/[\n,，;；、]/u.test(normalized)) code = 'multiple_senses'
  else if (/[\[\]【】()（）<>{}\\=\dA-Za-z]/u.test(normalized)) code = 'formatting'
  else if (/(?:的复数|的过去|的现在|过去分词|现在分词|第三人称|缩写|略语|音译|人名|地名|用于|表示|某人|某事|一种|一类|等$)/u.test(normalized)) code = 'grammar_or_usage'
  else if (!/^[\u3400-\u9fff]{2,12}$/u.test(normalized)) code = 'meaning_length'
  const ranked = distractors.filter(d => {
    if (d.aliases.some(alias => entry.translation.toLowerCase().includes(alias) || entry.key.includes(alias))) return false
    // Any shared Han character is a conservative overlap flag, not a synonym test.
    return ![...d.meaning].some(char => normalized.includes(char))
  }).map(d => ({ ...d, rank: hash(`${VERSION}\0${entry.key}\0${d.meaning}`) }))
    .sort((a, b) => compare(a.rank, b.rank))
  if (!code && ranked.length < 3) code = 'distractor_overlap'
  if (knownRisks.has(entry.key)) entry.practice = { status: 'unavailable', reasonCode: 'known_semantic_risk', reason: knownRisks.get(entry.key) }
  else if (code) entry.practice = { status: 'unavailable', reasonCode: code, reason: reasons[code] }
  else {
    const choices = [entry.meaning, ...ranked.slice(0, 3).map(d => d.meaning)]
      .map(meaning => ({ meaning, rank: hash(`${VERSION}\0option\0${entry.key}\0${meaning}`) }))
      .sort((a, b) => compare(a.rank, b.rank)).map(x => x.meaning)
    entry.practice = {
      status: 'ready', reason: '已备基础词义识别题；通过自动风险筛查，非逐词专业审校。',
      choices, answerIndex: choices.indexOf(entry.meaning),
      explanation: '基础词义识别；释义取自固定版本 ECDICT。此题不覆盖该词的全部义项与用法。'
    }
  }
  delete entry.sourceTranslations
}
const listTitles = { cet4: '四级学习参考词库', cet6: '六级学习参考词库（含四级基础）', ielts: '雅思学习参考词库' }
const lists = Object.keys(listTitles).map(id => {
  const members = entries.filter(entry => entry.listIds.includes(id))
  const entryIds = members.map(entry => entry.id)
  const studyOrder = members.map(entry => ({ id: entry.id, rank: hash(`${VERSION}\0study\0${id}\0${entry.key}`) }))
    .sort((a, b) => compare(a.rank, b.rank) || compare(a.id, b.id)).map(entry => entry.id)
  const playableCount = members.filter(entry => entry.practice.status === 'ready').length
  return { id, title: listTitles[id], description: '开源整理的学习参考，非官方指定全集，不承诺考试分数。', total: members.length, playableCount, unavailableCount: members.length - playableCount, entryIds, studyOrder }
})
const source = {
  name: 'ECDICT', author: 'Linwei (skywind3000)', copyright: 'Copyright (c) 2025 Linwei', license: 'MIT', commit: COMMIT,
  url: `https://github.com/skywind3000/ECDICT/tree/${COMMIT}`,
  csvUrl: `https://raw.githubusercontent.com/skywind3000/ECDICT/${COMMIT}/ecdict.csv`,
  licenseUrl: `https://raw.githubusercontent.com/skywind3000/ECDICT/${COMMIT}/LICENSE`,
  bytes: bytes.length, sha256: hash(bytes), gitBlobSha1: blob, licenseSha256: hash(license),
  rowCount, selectedRows, duplicateRows, rawTagCounts
}
const data = { schemaVersion: 1, version: VERSION, source, lists, entries }
const serialized = `${JSON.stringify(data)}\n`
const reasonCounts = {}
for (const entry of entries) if (entry.practice.status !== 'ready') reasonCounts[entry.practice.reasonCode] = (reasonCounts[entry.practice.reasonCode] || 0) + 1
const report = {
  version: VERSION, source, uniqueEntries: entries.length,
  playableEntries: entries.filter(entry => entry.practice.status === 'ready').length,
  unavailableEntries: entries.filter(entry => entry.practice.status !== 'ready').length,
  reasonCounts,
  lists: lists.map(({ entryIds, studyOrder, ...list }) => list),
  overlaps: { cet4AndCet6Tag: entries.filter(e => e.sourceTags.includes('cet4') && e.sourceTags.includes('cet6')).length,
    cet4AndIelts: entries.filter(e => e.listIds.includes('cet4') && e.listIds.includes('ielts')).length,
    cet6AndIelts: entries.filter(e => e.listIds.includes('cet6') && e.listIds.includes('ielts')).length },
  artifact: { file: 'wordlists.json', bytes: Buffer.byteLength(serialized), sha256: hash(serialized) },
  quality: { policy: 'Conservative single-clean-gloss gate; source ambiguity is quarantined, not silently discarded.',
    distractors: '24 concrete concepts; full source translation and English alias exclusion, no shared Han characters, deterministic ranking.',
    limits: 'Automated risk screening and stratified sample review are not professional review of every entry. Source dictionary errors and unlisted synonyms can remain.' }
}
await mkdir(output, { recursive: true })
await writeFile(resolve(output, 'wordlists.json'), serialized)
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(report, null, 2)}\n`)
await writeFile(resolve(output, 'ECDICT-LICENSE.txt'), license.endsWith('\n') ? license : `${license}\n`)
if (option('--report')) {
  const reportPath = resolve(option('--report'))
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
}
console.log(JSON.stringify(report, null, 2))
