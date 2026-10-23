import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient, deferred } from './client-harness.js'
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execute } from '../core/index.js'

function fixture() {
  const state = {
    onboarded: true,
    profile: { updatedAt: '2026-10-22T00:00:00Z', goal: 'work', minutesPerDay: 20, targetBand: '中高级', goalNote: '在工作讨论中清楚地表达想法', interests: ['科技', '产品设计', '日常交流'] },
    now: '2026-10-23T00:00:00Z', settings: { study: { wordsPerDay: 10 } }, review: { dueCount: 0 }, streak: { current: 4 },
    level: { latest: { at: '2026-10-22T08:00:00Z', band: '中级', reference: '能处理熟悉的话题', weaknesses: [{ skill: 'listening', missed: 3 }, { skill: 'reading', missed: 1 }] } }
  }
  const progress = { completions: ['2026-10-20', '2026-10-21'], streak: { current: 4, best: 6 }, mastered: 14, learning: 38, curve: [], drift: null, expiredDrafts: 0 }
  const api = {
    state, progress, saves: [],
    readProgress: async () => ({ ok: true, data: structuredClone(progress) }),
    request: async (command, payload) => {
      if (command === 'state.get') return { ok: true, data: structuredClone(state) }
      if (command === 'review.list' || command === 'study.batch') return { ok: true, data: { items: [], dueCount: 0 } }
      if (command === 'progress.get') return api.readProgress()
      if (command === 'profile.save') { api.saves.push(payload); state.profile = { ...payload, updatedAt: '2026-10-23T00:00:00Z' }; return { ok: true, data: { profile: structuredClone(state.profile) } } }
      if (command === 'assessment.status') return { ok: true, data: {} }
      throw new Error(`Unexpected host request ${command}`)
    }
  }
  return api
}
async function openProfile(t, api = fixture()) {
  const ui = await mountClient({ request: (command, payload) => api.request(command, payload) })
  t.after(() => ui.close())
  await ui.click('个人')
  return { ui, api }
}

test('目标优先摘要就近对照当前水平估计和目标档位，不用百分比混淆两者', async (t) => {
  const { ui } = await openProfile(t)
  const comparison = ui.container.querySelector('[aria-label="当前与目标"]')
  assert.ok(comparison, '个人页应有清楚的当前与目标对照')
  assert.match(comparison.textContent, /当前水平估计.*中级/)
  assert.match(comparison.textContent, /目标档位.*中高级/)
  assert.doesNotMatch(comparison.textContent, /%/)
  assert.ok(comparison.closest('section').textContent.includes('在工作讨论中清楚地表达想法'))
})

test('长目标和全部兴趣可以只读展开与收起，不必进入编辑', async (t) => {
  const api = fixture()
  api.state.profile.goalNote = '在跨国设计评审中清楚讨论产品设计取舍。'.repeat(12)
  api.state.profile.interests = ['科技', '产品设计', '日常交流', '非常长的第四个研究兴趣主题']
  const { ui } = await openProfile(t, api)
  const summary = ui.button('编辑个人目标').closest('section')
  assert.ok(!summary.textContent.includes(api.state.profile.goalNote))
  await ui.click('查看完整目标')
  assert.ok(summary.textContent.includes(api.state.profile.goalNote))
  assert.ok(summary.textContent.includes('非常长的第四个研究兴趣主题'))
  assert.equal(summary.querySelectorAll('input,select,textarea').length, 0)
  assert.equal(ui.button('收起完整目标').getAttribute('aria-expanded'), 'true')
  await ui.click('收起完整目标')
  assert.ok(!summary.textContent.includes(api.state.profile.goalNote))
  assert.equal(api.saves.length, 0)
})

test('编辑目标聚焦表单并隐藏学习概况，退出后保留原组件与展示状态', async (t) => {
  const { ui } = await openProfile(t)
  const progressHeading = [...ui.container.querySelectorAll('h2')].find(node => node.textContent === '进度')
  assert.ok(progressHeading)
  const progressRoot = progressHeading.closest('[data-profile-progress]')
  assert.ok(progressRoot, '学习概况需要独立可隐藏而不卸载的区域')
  await ui.click('编辑个人目标')
  assert.equal(progressRoot.hidden, true)
  assert.equal(progressHeading.isConnected, true)
  assert.equal(ui.window.document.activeElement, ui.field('想用英语做什么'))
  await ui.click('取消')
  assert.equal(progressRoot.hidden, false)
  assert.equal(progressHeading.isConnected, true)
})

test('学习概况只保留三项关键积累，完整记录按需展开且编辑后保留展开状态', async (t) => {
  const { ui } = await openProfile(t)
  const progress = ui.container.querySelector('[data-profile-progress]')
  const summary = progress.querySelector('[aria-label="学习概况"]')
  assert.ok(summary, '概况应有独立而简洁的语义分组')
  assert.match(summary.textContent, /2.*完成天数.*4.*连续天数.*14.*已掌握/)
  assert.doesNotMatch(summary.textContent, /38|在学/)
  assert.equal(progress.querySelector('svg'), null)
  await ui.click('查看记录')
  assert.match(progress.textContent, /在学.*38|38.*在学/)
  assert.match(progress.textContent, /最长连续.*6|6.*最长连续/)
  const records = progress.querySelector('[aria-label="学习记录详情"]')
  assert.ok(records)
  await ui.click('编辑个人目标')
  assert.equal(progress.hidden, true)
  await ui.click('取消')
  assert.ok(records.isConnected)
  assert.equal(ui.button('收起记录').getAttribute('aria-expanded'), 'true')
  await ui.click('收起记录')
  assert.equal(ui.button('查看记录').getAttribute('aria-expanded'), 'false')
})

test('水平曲线有日期档位及文字等价记录，下降与同日测评不会丢失', async (t) => {
  const api = fixture()
  api.progress.curve = [
    { at: '2026-10-02T08:00:00Z', band: '初级', estimate: 2, accuracy: 0.6 },
    { at: '2026-10-12T08:00:00Z', band: '高级', estimate: 5, accuracy: 0.85 },
    { at: '2026-10-12T09:00:00Z', band: '中级', estimate: 3, accuracy: 0.65 }
  ]
  const { ui } = await openProfile(t, api)
  await ui.click('查看记录')
  const chart = ui.container.querySelector('svg[role="img"]')
  assert.ok(chart, '曲线需要有可访问名称和文字等价信息')
  assert.match(chart.getAttribute('aria-label'), /水平变化/)
  assert.match(chart.textContent, /初级.*中级.*高级|高级.*中级.*初级/)
  assert.match(chart.textContent, /10月2日/)
  assert.match(chart.textContent, /10月12日/)
  const records = ui.container.querySelector('[aria-label="测评记录"]')
  assert.ok(records)
  assert.equal(records.querySelectorAll('li').length, 3)
  assert.match(records.textContent, /2026-10-12.*09:00.*中级/)
  assert.match(records.textContent, /较上次下降/)
  assert.match(records.textContent, /较上次上升/)
  assert.doesNotMatch(chart.outerHTML, /NaN|Infinity/)
})

test('进度首次读取失败可重试，轮询失败保留旧概况、记录和目标草稿', async (t) => {
  const api = fixture()
  const ready = api.readProgress
  api.readProgress = async () => ({ ok: false, message: '进度暂时离线' })
  const { ui } = await openProfile(t, api)
  assert.match(ui.text(), /进度暂时离线/)
  assert.equal(ui.container.querySelector('[aria-label="学习概况"]'), null)
  api.readProgress = ready
  await ui.click('重试读取进度')
  const summary = ui.container.querySelector('[aria-label="学习概况"]')
  assert.match(summary.textContent, /14.*已掌握/)
  await ui.click('查看记录')
  await ui.click('编辑个人目标')
  await ui.input('感兴趣的主题', '保留未提交兴趣')
  api.readProgress = async () => ({ ok: false, message: '刷新进度失败' })
  await ui.poll()
  assert.equal(summary.isConnected, true)
  assert.equal(ui.field('感兴趣的主题').value, '保留未提交兴趣')
  await ui.click('取消')
  assert.match(ui.text(), /刷新进度失败/)
  assert.match(summary.textContent, /14.*已掌握/)
  assert.equal(ui.button('收起记录').getAttribute('aria-expanded'), 'true')
  api.progress.mastered = 15
  api.readProgress = ready
  await ui.click('重试读取进度')
  assert.match(ui.container.querySelector('[aria-label="学习概况"]').textContent, /15.*已掌握/)
  assert.equal(ui.button('收起记录').getAttribute('aria-expanded'), 'true')
})

test('下一步提示来自最近测评的真实薄弱项，不固定复制原型听力建议', async (t) => {
  const api = fixture()
  api.state.level.latest.weaknesses = [{ skill: 'reading', missed: 5 }, { skill: 'listening', missed: 2 }]
  const { ui } = await openProfile(t, api)
  const suggestion = ui.container.querySelector('[aria-label="下一步建议"]')
  assert.ok(suggestion)
  assert.match(suggestion.textContent, /最近测评.*阅读/)
  assert.doesNotMatch(suggestion.textContent, /多练听力/)
  await ui.click('查看记录')
  const details = ui.container.querySelector('[aria-label="学习记录详情"]')
  assert.match(details.textContent, /阅读：错 5/)
  assert.match(details.textContent, /听力：错 2/)
})

test('未测评未设目标不伪造结果，个人页仍能进入测评', async (t) => {
  const api = fixture()
  api.state.level.latest = null
  api.state.profile.targetBand = ''
  const { ui } = await openProfile(t, api)
  const comparison = ui.container.querySelector('[aria-label="当前与目标"]')
  assert.match(comparison.textContent, /尚未测评.*暂未设定/)
  assert.match(ui.container.querySelector('[aria-label="下一步建议"]').textContent, /尚未测评/)
  await ui.click('开始测评')
  assert.match(ui.text(), /测评/)
})

test('测评并列薄弱项和无薄弱项提示有依据，全部详情保留可达', async (t) => {
  const api = fixture()
  api.state.level.latest.weaknesses = [{ skill: 'reading', missed: 4 }, { skill: 'listening', missed: 4 }]
  api.progress.drift = { note: '本次难度可能偏低' }
  api.progress.expiredDrafts = 2
  const { ui } = await openProfile(t, api)
  assert.match(ui.container.querySelector('[aria-label="下一步建议"]').textContent, /阅读、听力并列/)
  await ui.click('查看记录')
  assert.match(ui.container.querySelector('[aria-label="学习记录详情"]').textContent, /能处理熟悉的话题.*本次难度可能偏低/)
  await ui.click('诊断数据')
  assert.match(ui.container.querySelector('[aria-label="学习记录详情"]').textContent, /过期草稿：2/)
  api.state.level.latest.weaknesses = []
  await ui.poll()
  assert.match(ui.container.querySelector('[aria-label="下一步建议"]').textContent, /没有明确可判断的薄弱方向/)
  assert.doesNotMatch(ui.container.querySelector('[aria-label="下一步建议"]').textContent, /听力/)
})

test('编辑具体目标保留多行内容和明确编辑标题，Esc不丢弃草稿', async (t) => {
  const { ui, api } = await openProfile(t)
  await ui.click('编辑个人目标')
  assert.equal(ui.field('为什么学英语').tagName, 'TEXTAREA')
  assert.ok([...ui.container.querySelectorAll('h2')].some(node => node.textContent === '编辑个人目标'))
  await ui.input('为什么学英语', '第一行具体目标\n第二行讨论场景')
  await ui.key(ui.field('为什么学英语'), 'Escape')
  assert.equal(ui.field('为什么学英语').value, '第一行具体目标\n第二行讨论场景')
  await ui.click('保存')
  assert.equal(api.saves[0].goalNote, '第一行具体目标\n第二行讨论场景')
  assert.match(ui.button('编辑个人目标').closest('section').textContent, /第一行具体目标\n第二行讨论场景/)
})

test('进度加载不以零伪装成功，单点与大量曲线记录可完整读取', async (t) => {
  const api = fixture()
  const loading = deferred()
  api.readProgress = () => loading.promise
  const { ui } = await openProfile(t, api)
  assert.match(ui.container.querySelector('[data-profile-progress]').textContent, /正在读取学习进度/)
  assert.equal(ui.container.querySelector('[aria-label="学习概况"]'), null)
  const first = { at: '2026-10-02T08:00:00Z', band: '初级', estimate: 2, accuracy: 0.6 }
  api.progress.curve = [first]
  await ui.flush(() => loading.resolve({ ok: true, data: structuredClone(api.progress) }))
  await ui.click('查看记录')
  assert.match(ui.container.querySelector('[aria-label="学习记录详情"]').textContent, /目前有 1 次测评/)
  assert.equal(ui.container.querySelectorAll('[aria-label="测评记录"] li').length, 1)
  api.progress.curve = Array.from({ length: 45 }, (_, index) => ({ at: `2026-10-${String(1 + index % 22).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00Z`, band: index % 2 ? '中级' : '高级', estimate: index % 2 ? 3 : 5 }))
  api.readProgress = async () => ({ ok: true, data: structuredClone(api.progress) })
  await ui.poll()
  assert.equal(ui.container.querySelectorAll('[aria-label="测评记录"] li').length, 45)
  assert.doesNotMatch(ui.container.querySelector('svg[role="img"]').outerHTML, /NaN|Infinity/)
})

test('迟到的旧进度响应不覆盖更新概况，展开与当前焦点保持稳定', async (t) => {
  const { ui, api } = await openProfile(t)
  await ui.click('查看记录')
  const recordToggle = ui.button('收起记录')
  recordToggle.focus()
  const older = deferred(), newer = deferred()
  let count = 0
  api.readProgress = () => (++count === 1 ? older.promise : newer.promise)
  await ui.poll()
  await ui.poll()
  await ui.flush(() => newer.resolve({ ok: true, data: { ...api.progress, mastered: 16 } }))
  assert.match(ui.container.querySelector('[aria-label="学习概况"]').textContent, /16.*已掌握/)
  await ui.flush(() => older.resolve({ ok: true, data: { ...api.progress, mastered: 15 } }))
  assert.match(ui.container.querySelector('[aria-label="学习概况"]').textContent, /16.*已掌握/)
  assert.equal(ui.button('收起记录').getAttribute('aria-expanded'), 'true')
  assert.equal(ui.window.document.activeElement, recordToggle)
})

test('个人页真实execute隔离读写不把课程草稿计为完成，不重置词汇及测评进度', async (t) => {
  const root = await fs.mkdtemp(join(tmpdir(), 'coach-profile-focus-'))
  const safeRoot = resolve(root)
  assert.ok(safeRoot.startsWith(resolve(tmpdir()) + '/coach-profile-focus-'), 'only remove this isolated test root')
  t.after(() => fs.rm(safeRoot, { recursive: true, force: true }))
  const run = (command, payload = {}, at = '2026-10-23T09:00:00+08:00') => execute(safeRoot, command, payload, { now: new Date(at) })
  const profile = await run('profile.save', { goal: 'work', minutesPerDay: 20, targetBand: '高级', goalNote: '保留真实命令保存契约', interests: ['研究'], workContext: '合成工作场景' })
  assert.equal(profile.ok, true)
  const lesson = date => ({ date, title: '隔离合成课程', sources: [{ id: 's', url: `https://example.com/synthetic/${date}`, fetchedAt: '2026-10-23T00:00:00Z', license: '合成测试材料' }], items: [
    { id: 'r', type: 'reading', sourceId: 's', body: 'A synthetic reading.' },
    { id: 'l', type: 'listening', sourceId: 's', transcript: 'A synthetic transcript.' },
    { id: 'e', type: 'expressions', expressions: [{ term: 'sample', meaning: '示例' }] },
    { id: 'q', type: 'quiz', questions: [{ prompt: 'Choose.', choices: ['甲', '乙', '丙', '丁'], answerIndex: 0 }] }
  ] })
  assert.equal((await run('lesson.save', lesson('2026-10-22'), '2026-10-22T09:00:00+08:00')).ok, true)
  assert.equal((await run('lesson.start', { date: '2026-10-22' }, '2026-10-22T09:00:00+08:00')).ok, true)
  for (const itemId of ['r', 'l', 'e', 'q']) assert.equal((await run('lesson.completeItem', { date: '2026-10-22', itemId }, '2026-10-22T09:00:00+08:00')).ok, true)
  assert.equal((await run('lesson.save', lesson('2026-10-23'))).ok, true)
  const joined = await run('review.add', { items: [{ term: 'synthetic word', meaning: '合成词', choices: ['合成词', '甲', '乙', '丙'], answerIndex: 0 }] })
  assert.equal(joined.ok, true)
  const beforeProgress = await run('progress.get')
  const beforeReview = await run('review.list')
  const beforeState = await run('state.get')
  assert.equal(beforeProgress.data.completions.length, 1)
  assert.equal(beforeProgress.data.mastered, 0)
  assert.equal(beforeProgress.data.learning, 1)
  assert.equal(beforeState.data.todayLesson.status, 'draft')
  const commandResults = []
  const ui = await mountClient({ request: (command, payload) => {
    const promise = command === 'job.status' ? Promise.resolve({ ok: true, data: null }) : run(command, payload)
    commandResults.push(promise)
    return promise
  } })
  t.after(async () => { await settle(); await ui.close() })
  const settle = () => ui.flush(async () => { while (commandResults.length) await Promise.all(commandResults.splice(0)); await new Promise(resolve => setImmediate(resolve)) })
  await settle()
  await ui.click('个人')
  await settle()
  assert.match(ui.container.querySelector('[aria-label="学习概况"]').textContent, /1完成天数1连续天数0已掌握/)
  await ui.click('查看记录')
  assert.match(ui.container.querySelector('[aria-label="学习记录详情"]').textContent, /在学1 项/)
  await ui.click('编辑个人目标')
  await ui.input('为什么学英语', '经可见UI保存的目标')
  await ui.input('感兴趣的主题', '天文学')
  await ui.click('保存')
  await settle()
  let afterState, afterProgress, afterReview
  await ui.flush(async () => {
    afterState = await run('state.get')
    afterProgress = await run('progress.get')
    afterReview = await run('review.list')
    while (commandResults.length) await Promise.all(commandResults.splice(0))
  })
  assert.equal(afterState.data.profile.goalNote, '经可见UI保存的目标')
  assert.deepEqual(afterState.data.profile.interests, ['研究', '天文学'])
  assert.equal(afterState.data.profile.workContext, '合成工作场景')
  assert.equal(afterState.data.profile.createdAt, profile.data.profile.createdAt)
  assert.deepEqual(afterProgress.data, beforeProgress.data)
  assert.deepEqual(afterReview.data, beforeReview.data)
  assert.deepEqual(afterState.data.level, beforeState.data.level)
  assert.deepEqual(afterState.data.todayLesson, beforeState.data.todayLesson)
})
