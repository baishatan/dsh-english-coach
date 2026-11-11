import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dateOf, isIsoTimestamp } from './constants.js'
import { fail } from './errors.js'
import { scoreAssessment, SCORING_RULE } from './scoring.js'
import { buildSyllabus, publishSyllabus } from './syllabus.js'
import { listDir, writeJson } from './store.js'

const journalName = 'assessment-history.json'
const attemptName = /^\d{4}-.*\.json$/

async function original(root, path) {
  try {
    const stat = await fs.lstat(join(root, path))
    if (!stat.isFile()) return { path, text: null, value: null, type: stat.isDirectory() ? 'directory' : 'other' }
  } catch (error) { if (error?.code !== 'ENOENT') throw error }
  let text
  try { text = await fs.readFile(join(root, path), 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return { path, text: null, value: null }
    throw error
  }
  let value = null
  try { value = JSON.parse(text) } catch { /* Preserve malformed originals, never use a backup as scoring evidence. */ }
  return { path, text, value }
}

function convertedPoint(attempt, path) {
  const expected = attempt.kind === 'short' ? 10 : attempt.kind === 'full' ? 20 : null
  const validText = value => typeof value === 'string' && Boolean(value.trim())
  if (!expected || path !== `assessments/${attempt.id}.json` || !validText(attempt.result?.id) ||
    !isIsoTimestamp(attempt.createdAt) || !isIsoTimestamp(attempt.result?.at) ||
    Date.parse(attempt.createdAt) > Date.parse(attempt.result.at) ||
    attempt.result.kind !== attempt.kind ||
    (attempt.result.attemptId !== undefined && attempt.result.attemptId !== attempt.id) ||
    (attempt.length !== undefined && attempt.length !== expected) || attempt.items !== expected ||
    !Array.isArray(attempt.answers) || attempt.answers.length !== expected ||
    new Set(attempt.answers.map(answer => answer?.itemId)).size !== expected ||
    !Array.isArray(attempt.order) || attempt.order.length !== expected ||
    attempt.answers.some((answer, index) => !answer || attempt.order[index] !== answer.itemId ||
      !isIsoTimestamp(answer.at) || Date.parse(answer.at) < Date.parse(attempt.createdAt) || Date.parse(answer.at) > Date.parse(attempt.result.at) ||
      (index > 0 && Date.parse(answer.at) < Date.parse(attempt.answers[index - 1].at)) ||
      !validText(answer.skill) || (answer.responseId !== undefined && answer.responseId !== JSON.stringify([attempt.id, answer.itemId])) ||
      (answer.responseType === 'unable' ? answer.choice !== null : !Number.isInteger(answer.choice) || answer.choice < 0 || answer.choice > 3)
    )) fail('invalid_assessment_evidence', '原测评完成身份、数量或作答事实不完整，不能重算', 'answers')
  const scored = scoreAssessment(attempt.answers)
  return {
    id: attempt.result.id, attemptId: attempt.id, at: attempt.result.at, kind: attempt.kind,
    band: scored.band, finalBandIndex: scored.finalBandIndex, scoringRule: scored.scoringRule,
    scoring: scored.scoring, coverageNote: scored.coverageNote, accuracy: scored.accuracy,
    counts: {
      correct: attempt.answers.filter(answer => answer.correct).length,
      incorrect: attempt.answers.filter(answer => !answer.correct && answer.responseType !== 'unable').length,
      unable: attempt.answers.filter(answer => answer.responseType === 'unable').length
    },
    weaknesses: scored.weaknesses, reference: scored.reference
  }
}

/** The one-time assessment cutover is journaled before any derived publication.
 * Originals are recovery evidence, never an alternate scoring or route runtime. */
export async function recoverAssessmentHistory(ctx, defaults) {
  const path = join(ctx.root, journalName)
  const saved = await original(ctx.root, journalName)
  let journal = saved.value
  if (saved.text === null && !saved.type) {
    const backup = await original(ctx.root, `${journalName}.bak`)
    if (backup.text !== null || backup.type) fail('assessment_recovery_failed', '测评历史切换主记录缺失，请检查存储后重试')
  }
  if (saved.type || (saved.text !== null && (!journal || journal.version !== 1 || journal.scoringRule !== SCORING_RULE ||
    !['pending', 'complete'].includes(journal.status) || (journal.status === 'pending' &&
      (!Array.isArray(journal.originals) || !Array.isArray(journal.attempts) || !Array.isArray(journal.level?.points) || !journal.syllabus?.generationId))))) {
    fail('assessment_recovery_failed', '测评历史切换记录损坏，请检查存储后重试')
  }
  if (!journal) {
    const entries = await listDir(join(ctx.root, 'assessments'))
    const names = entries.filter(entry => /^\d{4}-.*\.json(?:\.bak)?$/.test(entry.name)).map(entry => entry.name)
    const identities = [...new Set(names.map(name => name.replace(/\.bak$/, '')))]
    const originals = await Promise.all([...new Set([...names, ...identities])]
      .map(name => original(ctx.root, `assessments/${name}`)))
    const level = await original(ctx.root, 'level.json')
    const levelBackup = await original(ctx.root, 'level.json.bak')
    const route = await original(ctx.root, 'syllabus.json')
    const routeBackup = await original(ctx.root, 'syllabus.json.bak')
    const candidates = originals.filter(record => attemptName.test(record.path.slice('assessments/'.length)))
    const legacy = candidates.filter(record => !record.value ||
      ![record.value.scoringRule, record.value.result?.scoringRule, record.value.finalization?.point?.scoringRule].includes(SCORING_RULE))
    const hasLegacy = legacy.length || (level.value?.points ?? []).some(point => point.scoringRule !== SCORING_RULE)
      || (route.value?.phases?.length && !route.value.generationId)
    const levelUncertain = (level.text !== null && !Array.isArray(level.value?.points)) ||
      (level.text === null && (levelBackup.text !== null || levelBackup.type))
    const routeInvalid = (route.text !== null && (!Array.isArray(route.value?.phases) || !Array.isArray(route.value?.weekly?.goals))) ||
      (route.text === null && (routeBackup.text !== null || routeBackup.type))
    // A fresh or already-new root needs no migration write. In particular, an
    // invalid unrelated command must not create learner files as a side effect.
    if (!hasLegacy) return
    journal = { version: 1, scoringRule: SCORING_RULE, status: 'complete' }
    if (hasLegacy) {
      const points = []
      const completed = []
      const attempts = []
      const modern = candidates.filter(record => !legacy.includes(record))
      for (const record of modern) {
        const attempt = record.value
        if (attempt.status !== 'done') continue
        const point = convertedPoint(attempt, record.path)
        const linked = (level.value?.points ?? []).filter(entry => entry.id === point.id || entry.attemptId === attempt.id)
        if (linked.length > 1 || linked.some(entry => entry.id !== point.id || entry.at !== point.at)) {
          fail('assessment_recovery_failed', '新测评完成关联损坏，不能覆盖原始结果', 'attemptId')
        }
        points.push(attempt.result)
        completed.push({ at: point.at, point: attempt.result })
      }
      for (const record of legacy) {
        if (!record.value) {
          const backup = originals.find(other => other.path === `${record.path}.bak`)
          const id = record.path.slice('assessments/'.length, -5)
          if (/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
            (level.value?.points ?? []).some(point => point?.attemptId === id && point.scoringRule === SCORING_RULE) ||
            [backup?.value?.scoringRule, backup?.value?.result?.scoringRule, backup?.value?.finalization?.point?.scoringRule].includes(SCORING_RULE)) fail('assessment_recovery_failed', '新测评主记录损坏，不能从旧备份恢复作答', 'attemptId')
          if (!record.type) attempts.push({ path: record.path, value: { id, status: 'invalidated', answers: [], historyConversion: SCORING_RULE } })
          if (!(level.value?.points ?? []).some(point => point.attemptId === id || point.id === backup?.value?.result?.id)) completed.push({ at: null, point: null })
          continue
        }
        const attempt = structuredClone(record.value)
        attempt.historyConversion = SCORING_RULE
        attempt.confirmedAnchorIds = (Array.isArray(attempt.answers) ? attempt.answers : [])
          .filter(answer => answer?.anchor === true && typeof answer.itemId === 'string' && answer.itemId.trim()).map(answer => answer.itemId)
        if (attempt.status === 'done') {
          let point = null
          const linked = (level.value?.points ?? []).filter(point => point?.id === attempt.result?.id || point?.attemptId === attempt.id)
          const shared = candidates.filter(other => other.value?.status === 'done' && other.value.result?.id === attempt.result?.id)
          const associationValid = shared.length === 1 && linked.length <= 1 && linked.every(point =>
            point.id === attempt.result?.id && point.at === attempt.result?.at && point.kind === attempt.kind &&
            (point.attemptId === undefined || point.attemptId === attempt.id))
          try { if (associationValid) point = convertedPoint(attempt, record.path) } catch (error) {
            if (error?.code !== 'invalid_assessment_evidence') throw error
          }
          completed.push({ at: attempt.result?.at, point })
          if (point) points.push(point)
          if (point) attempt.result = point
          else delete attempt.result
          attempts.push({ path: record.path, value: attempt })
        } else if (attempt.status === 'in_progress' || attempt.status === 'finalizing') {
          attempt.status = 'terminated'
          attempt.historyConversion = SCORING_RULE
          delete attempt.result
          delete attempt.finalization
          attempts.push({ path: record.path, value: attempt })
        }
      }
      for (const oldPoint of level.value?.points ?? []) {
        const match = candidates.find(record => record.value?.status === 'done' && record.value.result?.id === oldPoint?.id &&
          oldPoint.at === record.value.result.at && oldPoint.kind === record.value.kind &&
          (oldPoint?.attemptId === undefined || oldPoint.attemptId === record.value.id))
        if (!match) completed.push({ at: oldPoint?.at, point: null })
      }
      points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      completed.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
      const latestTime = completed.length ? Math.max(...completed.map(entry => Date.parse(entry.at))) : NaN
      const latest = completed.filter(entry => Date.parse(entry.at) === latestTime)
      const current = !levelUncertain && latest.length === 1 ? latest[0].point : null
      const profile = await original(ctx.root, 'profile.json')
      const generationId = `history-${randomUUID()}`
      journal = {
        ...journal, status: 'pending', originals: [...originals, level, levelBackup, route, routeBackup], attempts, routeInvalid: Boolean(routeInvalid),
        level: { ...(level.value ?? defaults.level), points, current, scoringRule: SCORING_RULE },
        syllabus: buildSyllabus({ finalBandIndex: current?.finalBandIndex ?? 1, targetBand: profile.value?.profile?.targetBand,
          todayText: dateOf(ctx.now), generationId, at: ctx.now.toISOString() })
      }
    }
    await writeJson(path, journal)
  }
  if (journal.status === 'pending') {
    for (const attempt of journal.attempts) await writeJson(join(ctx.root, attempt.path), attempt.value)
    await writeJson(join(ctx.root, 'level.json'), journal.level)
    if (journal.routeInvalid) {
      const current = await original(ctx.root, 'syllabus.json')
      if (current.value?.generationId !== journal.syllabus.generationId) await writeJson(join(ctx.root, 'syllabus.json'), journal.syllabus)
    } else await publishSyllabus(join(ctx.root, 'syllabus.json'), journal.syllabus, defaults.syllabus)
    journal.status = 'complete'
    await writeJson(path, journal)
  }
}
