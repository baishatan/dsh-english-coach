import { promises as fs } from 'node:fs'
import { BANDS, addDays, clamp } from './constants.js'
import { fail } from './errors.js'
import { writeJson } from './store.js'

/** Construct once before journaling. The caller owns the stable generation and
 * time; neither assessment recovery nor one-time conversion creates a new one. */
export function buildSyllabus({ finalBandIndex = 1, targetBand, todayText, generationId, at }) {
  const startIndex = finalBandIndex
  const targetIndex = clamp(
    targetBand && BANDS.includes(targetBand)
      ? Math.max(startIndex, BANDS.indexOf(targetBand) + 1)
      : Math.min(BANDS.length, startIndex + 1),
    1,
    BANDS.length
  )
  const middle = Math.min(BANDS.length, Math.round((startIndex + targetIndex) / 2))
  const phases = [
    {
      id: 'phase-1',
      name: `巩固「${BANDS[startIndex - 1]}」`,
      goal: '把当前档位的常见句式和表达用熟，读短文章不再来回回读。',
      focus: ['把当天的表达用进自己的句子里', '跟读听力文稿，注意连读', '读完一段先自己总结，再看中文'],
      targetBand: BANDS[startIndex - 1]
    },
    {
      id: 'phase-2',
      name: `往「${BANDS[middle - 1]}」推`,
      goal: '读得比现在长一点、快一点，能抓住长句的主干。',
      focus: ['读比现在长一点的段落', '听真实语速的材料', '整理一周的表达清单'],
      targetBand: BANDS[middle - 1]
    },
    {
      id: 'phase-3',
      name: `稳住「${BANDS[targetIndex - 1]}」`,
      goal: `在「${BANDS[targetIndex - 1]}」这一档站住：长文不断线，表达能用出来。`,
      focus: ['读长篇评论与专栏', '听播客并复述要点', '在真实场景里主动用出来'],
      targetBand: BANDS[targetIndex - 1]
    }
  ]
  const weekStart = addDays(todayText, -((new Date(`${todayText}T00:00:00`).getDay() + 6) % 7))
  const current = phases[0]
  return {
    version: 1,
    generationId,
    phases,
    currentPhaseId: current.id,
    weekly: {
      weekStart,
      goals: current.focus.slice(0, 3).map((text, index) => ({ id: `${generationId}:goal-${index + 1}`, text, done: false }))
    },
    generatedFrom: { finalBandIndex, targetBand: targetBand ?? null },
    regeneratedAt: at
  }
}

/** Route checks have no safe older fallback: an absent primary plus a backup
 * may have lost a newer generation or its checked goals. Preserve that evidence. */
export async function readSyllabus(path, fallback) {
  let text
  try {
    text = await fs.readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      try {
        await fs.lstat(`${path}.bak`)
      } catch (backupError) {
        if (backupError?.code === 'ENOENT') return structuredClone(fallback)
      }
    }
    fail('assessment_recovery_failed', '学习路线无法确认，请检查存储后重试；不能回退旧路线或清除目标勾选', 'syllabus')
  }
  try {
    const value = JSON.parse(text)
    if (!value || !Array.isArray(value.phases) || !value.weekly || !Array.isArray(value.weekly.goals)) throw new Error('invalid syllabus')
    return value
  } catch {
    fail('assessment_recovery_failed', '学习路线记录损坏，请检查存储后重试；原目标未改动', 'syllabus')
  }
}

/** Publish a caller-journaled snapshot once, preserving checks in the same generation. */
export async function publishSyllabus(path, snapshot, fallback) {
  const current = await readSyllabus(path, fallback)
  if (current.generationId !== snapshot.generationId) await writeJson(path, snapshot)
}
