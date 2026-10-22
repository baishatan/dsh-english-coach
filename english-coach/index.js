import { promises as nodeFs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

import { execute } from './core/index.js'
import { dateOf } from './core/constants.js'
import { readJson, writeJson } from './core/store.js'

/**
 * Host half of 英语教练.
 *
 * Owns the data root, the agent tools, the JSON-RPC surface the panel and
 * the pill talk to, and the scheduled job that asks an agent to prepare a
 * lesson. Every data mutation goes through `core/execute`, so the tools,
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
    if (command === 'generate.vocab') {
      if (payload?.profile !== true) {
        const result = await execute(root, 'study.supplement', {})
        if (!result.ok) return result
        if (result.data.activeWordListId || result.data.items.length) {
          return { ...result, data: { ...result.data, mode: 'static' } }
        }
      }
      const result = await startJob('vocab')
      return result.ok ? { ...result, data: { ...result.data, mode: 'generated' } } : result
    }
    if (command === 'lesson.context') {
      try {
        return { ok: true, data: { prompt: await lessonPrompt() }, warnings: [] }
      } catch (error) {
        return { ok: false, code: 'lesson_context_failed', message: `读取新课程偏好失败：${error?.message ?? error}` }
      }
    }
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
    const preference = await execute(root, 'study.preference', {})
    if (!preference.ok) throw new Error(preference.message || '无法读取当前词库偏好')
    const { activeWordList, candidates, candidateCount, batchSize } = preference.data
    const count = batchSize ?? 10
    const preferenceLines = activeWordList ? [
      `当前词库：${activeWordList.title}（id=${activeWordList.id}；目录 ${activeWordList.total}，可练 ${activeWordList.playableCount}）。`,
      `实际候选 ${candidates.length} 个（可用候选总数 ${candidateCount}；最多展示 60 个，不受浏览分页影响）：${JSON.stringify(candidates)}`,
      '尽量从真实阅读/听力材料中选取这些词或当前库相关表达；没有合适命中也可以完成课程，不设命中配额。',
      '候选不足时如实说明；不能伪造词语出处、改写来源原文或硬塞无关词来提高命中率。'
    ] : ['当前词库：不指定。沿用画像、兴趣和真实材料选择重点词。']
    return [
      '你是「英语教练」的素材采购员。按下面的步骤工作，不要输出与任务无关的内容。',
      '',
      '1. 先调用 english_state，读出 today、画像、当前阶段与阶段目标、最近水平估计、到期复习数量、近 7 天用过的素材链接。',
      '   今天已有草稿、进行中或已完成课程就保留，不重复生成或覆盖；说明已有课程即可。',
      '   不要用任何工具在本机写文件；所有内容只能通过 english_save_lesson 提交。',
      ...preferenceLines,
      'review.terms 的前 60 个已有词只是提示摘要，不是完整去重依据；课程 reviewItems 与表达派生仍由插件统一领域写入执行全量同词保护。',
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
      '   - 避免重复已有词；忽略大小写及多余空白，同词最终由插件全量去重，review.terms 只是有限摘要，不自动合并不同词形或英美拼写；',
      '   - 贴近画像里的工作方向和兴趣，整块表达优先于孤立单词；',
      `   - 难度略高于「${band}」、但不高于目标档位；`,
      '   - 每个词给中文释义、4 个不同的中文选项，以及一句中文讲解（常见搭配、和近义词的区别）；',
      '   - answerIndex 指向与 meaning 完全相同的那一项。',
      '3. 不要在对话里贴出词表，直接调用 english_add_words。',
      '4. 提交后用一句中文说明这次补的是哪一类词。'
    ].join('\n')
  }

  // Schedules store literal text, not a callback. Resolve the live preference
  // through the public tool when a delivery starts, never at rule creation.
  const LESSON_REFRESH_PROMPT = '开始准备新课前，先调用 english_vocabulary，action="lesson_context"，取得本次生成时最新课程要求。成功后按返回的 data.prompt 工作；失败则报告原因并停止，不使用旧偏好或旧候选。今天已有课程时保留，不覆盖。'

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
      const preparedPrompt = await spec.prompt()
      const prompt = kind === 'lesson'
        ? `${LESSON_REFRESH_PROMPT}\n\n以下是请求时的参考快照；以 lesson_context 返回的最新文本为准：\n${preparedPrompt}`
        : preparedPrompt
      let sessionId = jobs.dailySessionId
      if (!sessionId) {
        const created = await sessionController.create({ cwd: root })
        sessionId = created.sessionId
      }
      const record = await schedule.create(sessionId, {
        title: spec.title,
        prompt,
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
        let failed = reason.kind !== 'completed'
        let missingLesson = false
        if (!failed && kind === 'lesson') {
          const saved = await execute(root, 'lesson.get', { date: job.date })
          missingLesson = !saved.ok || !saved.data.lesson
          failed = missingLesson
        }
        const next = {
          ...job,
          status: failed ? 'failed' : 'done',
          endedAt: Date.now(),
          failure:
            missingLesson
              ? '生成会话已结束，但未保存今天的课程，请检查会话说明后重试。'
              : reason.kind === 'error'
                ? String(reason.error?.message ?? '模型调用失败')
                : reason.kind === 'aborted'
                  ? '这一轮被中断了'
                  : failed ? `生成会话未完成（${reason.kind}），请检查会话后重试。` : null
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

    const key = `live-lesson-context-v1|${automation.time}|${automation.timeZone}`
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
        prompt: LESSON_REFRESH_PROMPT,
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
        '读取画像、大纲、水平估计、到期复习数、近 7 天素材和今日课程。准备每日课程前调用；读取时可能更新过期草稿状态。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output,
      execute: async () => await dispatch('state.get', {})
    },
    {
      name: 'english_vocabulary',
      description: '浏览学习参考词库、读取新课要求、选择当前库或补充学习。select 改变后续新词偏好，supplement 把一批词加入个人学习；这两项仅在学习者提出对应要求时调用。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'query', 'select', 'supplement', 'lesson_context'], description: 'list 列出词库；query 分页查询；select 保存偏好；supplement 补词；lesson_context 读取生成时最新课程要求。' },
          id: { oneOf: [{ type: 'string', enum: ['cet4', 'cet6', 'ielts'] }, { type: 'null' }], description: 'query/select 必填；select 用 null 清除偏好。' },
          search: { type: 'string', description: 'query 的英文或中文包含搜索。' },
          filter: { type: 'string', enum: ['all', 'joined', 'unjoined'], description: 'query 的加入状态筛选，默认 all。' },
          page: { type: 'integer', minimum: 1, description: 'query 页码，默认 1。' },
          pageSize: { type: 'integer', enum: [20, 50], description: 'query 每页条数，默认 50。' },
          profile: { type: 'boolean', description: '仅 supplement 使用。学习者明确选择按画像生成时设 true；否则所选库直接使用预备题，不创建模型任务。' }
        },
        required: ['action'],
        additionalProperties: false
      },
      output,
      execute: async (args) => {
        const commands = { list: 'wordlists.list', query: 'wordlists.query', select: 'wordlists.select', supplement: 'generate.vocab', lesson_context: 'lesson.context' }
        const allowed = { list: [], query: ['id', 'search', 'filter', 'page', 'pageSize'], select: ['id'], supplement: ['profile'], lesson_context: [] }
        if (!args || !Object.hasOwn(commands, args.action) || Object.keys(args).some(key => key !== 'action' && !allowed[args.action].includes(key))) {
          return { ok: false, code: 'invalid_vocabulary_action', message: '请选择支持的词库操作及其对应参数。' }
        }
        if ((args.action === 'query' || args.action === 'select') && !Object.hasOwn(args, 'id')) {
          return { ok: false, code: 'invalid_vocabulary_action', field: 'id', message: '该操作需要明确指定词库；清除偏好请传 null。' }
        }
        const { action, ...payload } = args
        return await dispatch(commands[action], payload)
      }
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
        '提交已准备的词汇练习，立即可学；同词忽略大小写和多余空白，保留原释义与进度，只补来源。仅在学习者要求补词时调用；所选词库的常规补词用 english_vocabulary 的 supplement。',
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
