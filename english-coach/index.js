import { promises as nodeFs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { execute } from './core/index.js'
import { dateOf } from './core/constants.js'
import { readJson, writeJson } from './core/store.js'

/**
 * Host half of 英语教练.
 *
 * Owns the data root, the four agent tools, the JSON-RPC surface the panel and
 * the pill talk to, and the scheduled job that asks an agent to prepare a
 * lesson. Every data mutation goes through `core/execute`, so the four tools,
 * the panel and the scheduler can never disagree about what a write means.
 */

export const name = 'english-coach'
export const inject = ['tools', 'timer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const POINTER_FILE = join(DSH_HOME, 'english-coach', 'root.json')
const API_PREFIX = '/english-coach/api'
const WATCH_INTERVAL_MS = 5_000
const JOB_TIMEOUT_MS = 15 * 60_000

function resolveDefaultRoot() {
  return join(homedir(), 'DeepSeek-English')
}

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export function apply(ctx, config) {
  let root = resolveDefaultRoot()
  const jobsFile = () => join(root, 'jobs.json')
  const state = { promptLine: '' }
  let automationSynced = false

  /**
   * Run `fn` with the named services as soon as all of them exist. A cold boot
   * can activate this plugin before the web server exists, and looking the
   * service up once at apply time would then silently skip the registration —
   * the panel would open onto a 404 until someone reloaded the plugin.
   * `inject` covers tools and timer; everything else is waited for here.
   */
  function whenReady(names, fn) {
    let stopped = false
    let tries = 0
    const stop = ctx.timer.interval(() => {
      if (stopped) return
      const services = names.map((name) => ctx.get(name))
      if (services.every(Boolean)) {
        stopped = true
        stop()
        try {
          fn(...services)
        } catch {
          /* the service went away between the check and the call */
        }
        return
      }
      tries += 1
      if (tries > 120) {
        stopped = true
        stop()
      }
    }, 500)
    ctx.effect(() => () => {
      stopped = true
      stop()
    })
  }

  // ------------------------------------------------------------ data root

  async function resolveRoot() {
    if (config && typeof config.dataRoot === 'string' && config.dataRoot.trim()) {
      root = config.dataRoot.trim()
      return root
    }
    const pointer = await readJson(POINTER_FILE, null)
    root = pointer?.value?.dataRoot || resolveDefaultRoot()
    return root
  }

  async function rememberRoot(next) {
    await writeJson(POINTER_FILE, { dataRoot: next, updatedAt: new Date().toISOString() })
    root = next
  }

  // ----------------------------------------------------------------- jobs

  async function readJobs() {
    const { value } = await readJson(jobsFile(), {
      version: 1,
      dailySessionId: null,
      dailyScheduleId: null,
      jobs: {}
    })
    return value ?? {}
  }

  async function writeJobs(jobs) {
    await writeJson(jobsFile(), { version: 1, ...jobs })
  }

  // -------------------------------------------------------------- dispatch

  /**
   * A cold boot can reach the startup sync before the session or schedule
   * service exists. Reconcile once more the first time the UI asks for
   * anything, so an enabled daily job comes back without a settings round-trip.
   */
  async function ensureAutomation() {
    if (automationSynced) return
    if (!ctx.get('sessionController') || !ctx.get('schedule')) return
    automationSynced = true
    await syncAutomation().catch(() => {})
  }

  async function dispatch(command, payload) {
    void ensureAutomation()
    if (command === 'generate') return await startJob('lesson')
    if (command === 'generate.assessment') return await startJob('assessment')
    if (command === 'generate.vocab') return await startJob('vocab')
    if (command === 'job.status') {
      const kind =
        payload?.kind === 'assessment' ? 'assessment' : payload?.kind === 'vocab' ? 'vocab' : 'lesson'
      return await jobStatus(kind)
    }
    if (command === 'profile.infer') return await inferProfile()
    if (command === 'settings.migrateRoot') {
      const result = await execute(root, command, payload)
      if (result.ok) await rememberRoot(result.data.dataRoot)
      return result
    }
    const result = await execute(root, command, payload)
    if (result.ok && command === 'settings.save') {
      const extra = await syncAutomation().catch((error) => [
        `同步每日任务失败：${error?.message ?? error}`
      ])
      if (extra.length) result.warnings = [...(result.warnings ?? []), ...extra]
    }
    return result
  }

  /**
   * A first guess at what the learner works on, taken from the directory this
   * Harness project points at: the package description if there is one, the
   * folder name otherwise. It is a draft for the onboarding form, never saved
   * behind the user's back — saving the form is the confirmation.
   */
  async function inferProfile() {
    const workingDirectory = ctx.get('workingDirectory')
    let workspace = workingDirectory?.defaultDirectory ?? process.cwd()
    // "The current workspace" is where the learner has been working, not the
    // Harness profile directory: prefer the most recent Session's own cwd.
    try {
      const sessionController = ctx.get('sessionController')
      if (sessionController) {
        const listing = await sessionController.list({}, undefined)
        const cwd = (listing.items ?? [])
          .map((item) => item.cwd)
          .find((candidate) => typeof candidate === 'string' && candidate && candidate !== root)
        if (cwd) workspace = cwd
      }
    } catch {
      /* listing sessions is best effort; the default directory is enough */
    }
    let hint = ''
    try {
      const pkg = JSON.parse(await nodeFs.readFile(join(workspace, 'package.json'), 'utf8'))
      hint = [pkg.name, pkg.description].filter(Boolean).join('：')
    } catch {
      /* no package manifest; the folder name is still a hint */
    }
    if (!hint) hint = basename(workspace)
    return { ok: true, data: { workContext: hint, workspace, draft: true }, warnings: [] }
  }

  // ------------------------------------------------------- the daily agent

  async function lessonPrompt() {
    const snapshot = await execute(root, 'state.get').catch(() => null)
    const count = snapshot?.ok ? snapshot.data.settings?.study?.wordsPerDay ?? 10 : 10
    return [
      '你是「英语教练」的素材采购员。按下面的步骤工作，不要输出与任务无关的内容。',
      '',
      '1. 先调用 english_state，读出 today、画像、当前阶段与阶段目标、最近水平估计、到期复习数量、近 7 天用过的素材链接。',
      '   不要用任何工具在本机写文件；所有内容只能通过 english_save_lesson 提交。',
      '2. 按画像和近期工作方向搜索 1 篇阅读素材与 1 段听力素材。验收标准：',
      '   - 有公开可访问的原始页面（http/https）；',
      '   - 最近 30 天内发布；',
      '   - 不在 recentSources 里；',
      '   - 阅读 200–350 词；听力有可读的文稿，约 3–5 分钟朗读时长。',
      '3. 抓取正文核对长度。抓不到就换一个来源，并在课程的 note 里写明换了什么、为什么。任何情况下都不要编造原文。',
      `4. 从素材里挑 ${count} 个左右值得记的词或整块表达，整块表达优先于孤立单词。每个都放进 reviewItems，并给一道四选一（4 个不同的中文选项，answerIndex 指向与 meaning 完全相同的那一项）。`,
      '5. 再出 1 到 2 道理解题，和 1 道选词排序题（给完整正确句子，插件会自己打散）。',
      '6. 调用 english_save_lesson 提交，date 用 english_state 返回的 today，四类学习项（reading / listening / expressions / quiz）一个都不能少。',
      '7. 如果工具返回 ok:false，按返回的 code 与 field 修正后重试，最多重试 2 次。',
      '8. 最后用一句中文说明今天这一课讲了什么。'
    ].join('\n')
  }

  function assessmentPrompt() {
    return [
      '你是「英语教练」的出题人。请只做一件事：调用 english_save_assessment 提交一套英语测评题库。',
      '',
      '要求：',
      '- 24 道四选一，难度 1 到 6 各 4 道；1 大致是最简单，6 大致是最难。',
      '- 覆盖语法、词汇、阅读理解、推断四类，skill 字段里标明。',
      '- 每题 4 个选项、只有一个正确答案，answerIndex 是从 0 开始的选项下标。',
      '- 每题给一句中文讲解，说明为什么正确答案对、其他选项错在哪。',
      '- 不要使用任何考试机构的真题或改编题，自己写。',
      '- 不要在对话里贴出题目正文，直接调用工具提交。'
    ].join('\n')
  }

  /**
   * The learner asked for more words than today's lesson offered. This job only
   * writes vocabulary; it never touches the lesson or the syllabus.
   */
  async function vocabPrompt() {
    const snapshot = await execute(root, 'state.get').catch(() => null)
    const data = snapshot?.ok ? snapshot.data : null
    const count = data?.settings?.study?.wordsPerDay ?? 10
    const band = data?.level?.latest?.band ?? '未测评'
    return [
      '你是「英语教练」的补充词汇编辑。只做一件事：调用 english_add_words 提交一批新词。',
      '',
      '1. 先调用 english_state，读出画像、当前档位、目标档位和 review.terms（已经有的词）。',
      `2. 出 ${count} 个新词或整块表达，要求：`,
      '   - 不与 review.terms 里的任何一个重复（大小写、单复数都算重复）；',
      '   - 贴近画像里的工作方向和兴趣，整块表达优先于孤立单词；',
      `   - 难度略高于「${band}」、但不高于目标档位；`,
      '   - 每个词给中文释义、4 个不同的中文选项，以及一句中文讲解（常见搭配、和近义词的区别）；',
      '   - answerIndex 指向与 meaning 完全相同的那一项。',
      '3. 不要在对话里贴出词表，直接调用 english_add_words。',
      '4. 提交后用一句中文说明这次补的是哪一类词。'
    ].join('\n')
  }

  const JOB_SPECS = {
    lesson: { title: '英语教练 · 生成今天', prompt: lessonPrompt },
    assessment: { title: '英语教练 · 生成测评题库', prompt: assessmentPrompt },
    vocab: { title: '英语教练 · 补充词汇', prompt: vocabPrompt }
  }

  async function startJob(kind) {
    const spec = JOB_SPECS[kind] ?? JOB_SPECS.lesson
    const sessionController = ctx.get('sessionController')
    const schedule = ctx.get('schedule')
    if (!sessionController || !schedule) {
      return {
        ok: false,
        code: 'service_unavailable',
        message: '当前环境没有会话或调度服务，无法创建生成任务'
      }
    }
    const jobs = await readJobs()
    const today = dateOf(new Date())
    const previous = jobs.jobs?.[kind]
    if (previous && previous.date === today && previous.status === 'pending') {
      return { ok: true, data: { ...previous, reused: true }, warnings: [] }
    }

    try {
      let sessionId = jobs.dailySessionId
      if (!sessionId) {
        const created = await sessionController.create({ cwd: root })
        sessionId = created.sessionId
      }
      const record = await schedule.create(sessionId, {
        title: spec.title,
        prompt: await spec.prompt(),
        after_seconds: 2
      })
      const job = {
        id: String(record.id),
        kind,
        date: today,
        sessionId,
        createdAt: Date.now(),
        status: 'pending'
      }
      await writeJobs({
        ...jobs,
        dailySessionId: sessionId,
        jobs: { ...(jobs.jobs ?? {}), [kind]: job }
      })
      return { ok: true, data: job, warnings: [] }
    } catch (error) {
      return {
        ok: false,
        code: 'generate_failed',
        message: `创建生成任务失败：${error && error.message ? error.message : String(error)}`
      }
    }
  }

  async function jobStatus(kind) {
    const jobs = await readJobs()
    const job = jobs.jobs?.[kind] ?? null
    if (!job) return { ok: true, data: null, warnings: [] }
    if (job.status !== 'pending') return { ok: true, data: job, warnings: [] }

    const persist = (next) =>
      writeJobs({ ...jobs, jobs: { ...(jobs.jobs ?? {}), [kind]: next } })

    const sessionController = ctx.get('sessionController')
    if (!sessionController) return { ok: true, data: job, warnings: [] }
    try {
      const inspection = await sessionController.inspect(job.sessionId)
      const ended = inspection.events.filter(
        (event) => event.type === 'turn/end' && Number(event.time) >= job.createdAt
      )
      if (ended.length) {
        const reason = ended[ended.length - 1].data?.reason ?? { kind: 'completed' }
        const failed = reason.kind === 'error' || reason.kind === 'aborted'
        const next = {
          ...job,
          status: failed ? 'failed' : 'done',
          endedAt: Date.now(),
          failure:
            reason.kind === 'error'
              ? String(reason.error?.message ?? '模型调用失败')
              : reason.kind === 'aborted'
                ? '这一轮被中断了'
                : null
        }
        await persist(next)
        return { ok: true, data: next, warnings: [] }
      }
    } catch {
      /* a session that cannot be inspected yet stays pending */
    }
    if (Date.now() - job.createdAt > JOB_TIMEOUT_MS) {
      const next = {
        ...job,
        status: 'failed',
        endedAt: Date.now(),
        failure: '超过 15 分钟仍未完成，可能卡在搜索或抓取上'
      }
      await persist(next)
      return { ok: true, data: next, warnings: [] }
    }
    return { ok: true, data: job, warnings: [] }
  }

  // ------------------------------------------------------------ automation

  /** The schedule service wants HH:mm:ss; the settings page collects HH:mm. */
  function clockTime(value) {
    const text = String(value ?? '08:00').trim()
    return /^\d{2}:\d{2}$/.test(text) ? `${text}:00` : text
  }

  async function syncAutomation() {
    const warnings = []
    const settingsResult = await execute(root, 'settings.get')
    if (!settingsResult.ok) return warnings
    const automation = settingsResult.data.automation ?? { enabled: false }
    const sessionController = ctx.get('sessionController')
    const schedule = ctx.get('schedule')
    const jobs = await readJobs()

    if (!automation.enabled) {
      if (jobs.dailyScheduleId && schedule && jobs.dailySessionId) {
        try {
          await schedule.delete({ sessionId: jobs.dailySessionId, id: jobs.dailyScheduleId })
          await writeJobs({ ...jobs, dailyScheduleId: null, dailyScheduleKey: null })
        } catch (error) {
          warnings.push(`关闭每日任务失败：${error?.message ?? error}`)
        }
      }
      return warnings
    }
    if (!sessionController || !schedule) {
      warnings.push('当前环境没有会话或调度服务，每日自动生成无法启用')
      return warnings
    }

    const key = `${automation.time}|${automation.timeZone}`
    if (jobs.dailyScheduleId && jobs.dailyScheduleKey === key) return warnings
    // A changed time means the stored rule is stale: drop it and make a new one
    // rather than leaving the learner with yesterday's schedule.
    if (jobs.dailyScheduleId && jobs.dailySessionId) {
      try {
        await schedule.delete({ sessionId: jobs.dailySessionId, id: jobs.dailyScheduleId })
      } catch (error) {
        warnings.push(`删除旧每日任务失败：${error?.message ?? error}`)
      }
    }

    try {
      let sessionId = jobs.dailySessionId
      if (!sessionId) {
        const created = await sessionController.create({ cwd: root })
        sessionId = created.sessionId
      }
      const record = await schedule.create(sessionId, {
        title: '英语教练 · 每日一课',
        prompt: lessonPrompt(),
        daily: { time: clockTime(automation.time), time_zone: automation.timeZone }
      })
      await writeJobs({
        ...jobs,
        dailySessionId: sessionId,
        dailyScheduleId: String(record.id),
        dailyScheduleKey: key
      })
    } catch (error) {
      warnings.push(`创建每日任务失败：${error?.message ?? error}`)
    }
    return warnings
  }

  // ------------------------------------------------------------------ tools

  const renderText = (value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  const output = { schema: { type: 'object' }, render: (_args, value) => renderText(value) }

  const tools = [
    {
      name: 'english_state',
      description:
        '读取学习者的全部状态：画像、大纲与本阶段目标、最近水平估计、到期复习数、近 7 天用过的素材、今天是否已有课程。只读，不改变任何数据。准备每日课程前先调用它。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output,
      execute: async () => await dispatch('state.get', {})
    },
    {
      name: 'english_save_lesson',
      description:
        '提交一堂课。以 date 为幂等键：同一天重复提交会覆盖上一版，不会追加。必须带素材来源（含原始链接、抓取时间、许可说明），且必须包含 reading / listening / expressions / quiz 四类学习项，否则会被拒绝并返回出错的字段名。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD，通常用 english_state 返回的 today' },
          title: { type: 'string', description: '课程标题，中文' },
          summary: { type: 'string', description: '一两句话说明今天学什么' },
          note: { type: 'string', description: '换源原因、取舍说明等' },
          sources: {
            type: 'array',
            description: '每份被采纳的阅读或听力素材',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                kind: { type: 'string', enum: ['reading', 'listening'] },
                url: { type: 'string', description: '可访问的原始链接，http/https' },
                title: { type: 'string' },
                publisher: { type: 'string' },
                fetchedAt: { type: 'string', description: 'ISO 时间，抓取时刻' },
                license: { type: 'string', description: '许可说明，例如"公开网页，仅作学习引用"' },
                note: { type: 'string' }
              },
              required: ['url', 'fetchedAt', 'license']
            }
          },
          items: {
            type: 'array',
            description: '学习项，四类必填',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['reading', 'listening', 'expressions', 'quiz', 'ordering']
                },
                title: { type: 'string' },
                minutes: { type: 'number' },
                sourceId: { type: 'string', description: 'reading / listening 必填，指向 sources 里的 id' },
                body: { type: 'string', description: 'reading 的英文正文' },
                transcript: { type: 'string', description: 'listening 的英文文稿' },
                expressions: {
                  type: 'array',
                  description: 'expressions 项的内容',
                  items: {
                    type: 'object',
                    properties: {
                      term: { type: 'string' },
                      meaning: { type: 'string' },
                      example: { type: 'string' },
                      note: { type: 'string' }
                    },
                    required: ['term', 'meaning']
                  }
                },
                questions: {
                  type: 'array',
                  description: 'quiz 项的内容，四选一',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      prompt: { type: 'string' },
                      choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
                      answerIndex: { type: 'integer', minimum: 0, maximum: 3 },
                      explanation: { type: 'string' }
                    },
                    required: ['prompt', 'choices', 'answerIndex']
                  }
                },
                answer: { type: 'string', description: 'ordering 的完整正确句子，插件会自己打散词序' },
                prompt: { type: 'string', description: 'ordering 的提示语' },
                hint: { type: 'string' },
                explanation: { type: 'string' }
              },
              required: ['type']
            }
          },
          reviewItems: {
            type: 'array',
            description: '值得进复习队列的单词或整块表达，四选一判分',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                term: { type: 'string' },
                kind: { type: 'string', enum: ['word', 'expression'] },
                meaning: { type: 'string' },
                choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
                answerIndex: { type: 'integer', minimum: 0, maximum: 3 },
                explanation: { type: 'string' }
              },
              required: ['term', 'meaning', 'choices', 'answerIndex']
            }
          },
          cards: {
            type: 'array',
            description: '碎片卡，悬浮层里一次显示一张，只放短内容',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                kind: { type: 'string', enum: ['review', 'quiz'] },
                front: { type: 'string' },
                back: { type: 'string' },
                explanation: { type: 'string' },
                choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
                answerIndex: { type: 'integer', minimum: 0, maximum: 3 }
              },
              required: ['front', 'back']
            }
          }
        },
        required: ['date', 'title', 'sources', 'items']
      },
      output,
      execute: async (args) => await dispatch('lesson.save', args)
    },
    {
      name: 'english_save_assessment',
      description:
        '提交一套测评题库。至少 20 道四选一，难度用 1 到 6 标注，覆盖多个难度；插件会按作答自适应抽题，并混入自己的锚题。以 version 为幂等键。',
      parameters: {
        type: 'object',
        properties: {
          version: { type: 'string', description: '这一套题目的版本标识' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                difficulty: { type: 'integer', minimum: 1, maximum: 6 },
                skill: {
                  type: 'string',
                  description: 'grammar / vocab / reading / listening / inference'
                },
                prompt: { type: 'string' },
                passage: { type: 'string', description: '如有阅读材料，放这里' },
                choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
                answerIndex: { type: 'integer', minimum: 0, maximum: 3 },
                explanation: { type: 'string', description: '中文讲解' }
              },
              required: ['id', 'difficulty', 'prompt', 'choices', 'answerIndex']
            }
          }
        },
        required: ['items']
      },
      output,
      execute: async (args) => await dispatch('assessment.saveBank', args)
    },
    {
      name: 'english_add_words',
      description:
        '把新词加入复习队列，加进来立刻就能学。term 与已有词重复（不分大小写）的会被跳过；choices 必须是 4 个不同的中文选项，answerIndex 指向与 meaning 完全相同的那一项。只在学习者要求补充词汇时调用。',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                term: { type: 'string', description: '英文单词或整块表达' },
                kind: { type: 'string', enum: ['word', 'expression'] },
                meaning: { type: 'string', description: '中文释义' },
                choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
                answerIndex: { type: 'integer', minimum: 0, maximum: 3 },
                explanation: { type: 'string', description: '中文讲解：常见搭配、和近义词的区别' }
              },
              required: ['term', 'meaning', 'choices', 'answerIndex']
            }
          }
        },
        required: ['items']
      },
      output,
      execute: async (args) => await dispatch('review.add', args)
    },
    {
      name: 'english_record',
      description:
        '批量记录作答与完成状态。按项去重：同一项同一时间重复提交只算一次。用于补记课程完成情况；复习题的推进由面板直接完成，一般不需要调用。',
      parameters: {
        type: 'object',
        properties: {
          reviewAnswers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                itemId: { type: 'string' },
                correct: { type: 'boolean' },
                at: { type: 'string', description: 'ISO 时间，可选' }
              },
              required: ['itemId', 'correct']
            }
          },
          lessonCompletions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                date: { type: 'string' },
                itemId: { type: 'string' }
              },
              required: ['itemId']
            }
          }
        }
      },
      output,
      execute: async (args) => await dispatch('record.batch', args)
    }
  ]

  for (const definition of tools) {
    ctx.effect(() => ctx.tools.register(definition))
  }

  // ------------------------------------------------------- prompt context

  whenReady(['systemPrompt'], (systemPrompt) => {
    ctx.effect(() =>
      systemPrompt.context({
        name: 'english-coach/learner',
        order: 500,
        text: () => state.promptLine ?? ''
      })
    )
  })

  async function refreshPromptLine() {
    try {
      const result = await execute(root, 'state.get')
      if (!result.ok) return
      const data = result.data
      if (!data.profile) {
        state.promptLine = '英语教练已安装，学习者还没填写画像。'
        return
      }
      const band = data.level.latest?.band ?? '未测评'
      const lesson = data.todayLesson
      const lessonText = lesson
        ? `今天的课程状态是「${lesson.status}」`
        : '今天还没有生成课程'
      state.promptLine = `英语教练：档位「${band}」，待复习 ${data.review.dueCount} 项，${lessonText}。需要细节时调用 english_state。`
    } catch {
      /* prompt context is decorative; never break a turn over it */
    }
  }

  // ------------------------------------------------------------- http api

  whenReady(['webServer'], (webServer) => {
    ctx.effect(() =>
      webServer.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: async (req, res) => {
          const url = new URL(req.url ?? '/', 'http://localhost')
          const command = url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '')
          if (req.method === 'GET' && command === 'ping') {
            return sendJson(res, 200, { ok: true, data: { root }, warnings: [] })
          }
          if (req.method !== 'POST') {
            return sendJson(res, 405, {
              ok: false,
              code: 'method_not_allowed',
              message: '只接受 POST'
            })
          }
          let body = ''
          try {
            for await (const chunk of req) {
              body += chunk
              if (body.length > 4_000_000) throw new Error('too large')
            }
          } catch {
            return sendJson(res, 413, { ok: false, code: 'body_too_large', message: '请求体过大' })
          }
          let payload = {}
          if (body.trim()) {
            try {
              payload = JSON.parse(body)
            } catch {
              return sendJson(res, 400, {
                ok: false,
                code: 'bad_json',
                message: '请求体不是合法 JSON'
              })
            }
          }
          try {
            const result = await dispatch(command, payload)
            await refreshPromptLine()
            return sendJson(res, 200, result)
          } catch (error) {
            return sendJson(res, 500, {
              ok: false,
              code: 'host_error',
              message: `插件内部错误：${error && error.message ? error.message : String(error)}`
            })
          }
        }
      })
    )
  })

  // --------------------------------------------------------------- startup

  void (async () => {
    await resolveRoot()
    await ensureAutomation()
    await refreshPromptLine()
  })()

  // Only tick while a job is actually running: settling a finished turn is a
  // cheap read, but a timer that re-reads the whole data folder every few
  // seconds forever is not.
  ctx.effect(() =>
    ctx.timer.interval(() => {
      void (async () => {
        const jobs = await readJobs()
        let settled = false
        for (const kind of ['lesson', 'assessment']) {
          const job = jobs.jobs?.[kind]
          if (!job || job.status !== 'pending') continue
          const result = await jobStatus(kind)
          if (result.ok && result.data && result.data.status !== 'pending') settled = true
        }
        if (settled) await refreshPromptLine()
      })().catch(() => {})
    }, WATCH_INTERVAL_MS)
  )

  ctx.on('dispose', () => {
    state.promptLine = ''
  })
}
