import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient, deferred } from './client-harness.js'

const savedProfile = { updatedAt: '2026-10-21T00:00:00Z', goal: 'work', minutesPerDay: 30, targetBand: '高级', goalNote: '听懂技术评审', interests: ['能源', '产品设计'] }
function fixture() {
  const profile = structuredClone(savedProfile)
  const state = { onboarded: true, profile, now: '2026-10-22T00:00:00Z', settings: { study: { wordsPerDay: 10 } }, review: { dueCount: 0 }, streak: { current: 3 }, level: { latest: { band: '中级' } } }
  const saves = []
  const api = {
    state, saves,
    save: async (payload) => { state.profile = { ...payload, updatedAt: '2026-10-22T00:00:00Z' }; return { ok: true, data: { profile: state.profile } } },
    request: async (command, payload) => {
      if (command === 'state.get') return { ok: true, data: structuredClone(state) }
      if (command === 'review.list' || command === 'study.batch') return { ok: true, data: { items: [], dueCount: 0 } }
      if (command === 'progress.get') return { ok: true, data: { completions: ['2026-10-20'], streak: { current: 3, best: 3 }, mastered: 7, learning: 9, curve: [] } }
      if (command === 'profile.save') { saves.push(payload); return api.save(payload) }
      if (command === 'profile.infer') return { ok: true, data: {} }
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

test('已保存个人目标默认是紧凑摘要，无输入或保存操作', async (t) => {
  const { ui } = await openProfile(t)
  const section = ui.button('编辑个人目标').closest('section')
  assert.match(section.textContent, /工作里用/)
  assert.match(section.textContent, /每天 30 分钟/)
  assert.match(section.textContent, /高级/)
  assert.match(section.textContent, /听懂技术评审/)
  assert.match(section.textContent, /能源.*产品设计/)
  assert.equal(section.querySelectorAll('input,select,textarea').length, 0)
  assert.equal(ui.buttons('保存').length, 0)
  assert.match(ui.text(), /完成天数/)
})

test('长具体目标和兴趣摘要保持简短，完整文本可查看且编辑保留原值', async (t) => {
  const api = fixture()
  api.state.profile.goalNote = '在复杂跨国技术评审会上理解并表达设计取舍。'.repeat(20)
  api.state.profile.interests = Array.from({ length: 12 }, (_, index) => `跨学科研究主题${index}`)
  const { ui } = await openProfile(t, api)
  const section = ui.button('编辑个人目标').closest('section')
  assert.ok(section.textContent.length < 300, 'summary should stay compact for long saved goals')
  await ui.click('查看完整目标')
  assert.ok(section.textContent.includes(api.state.profile.goalNote))
  assert.ok(section.textContent.includes('跨学科研究主题11'))
  await ui.click('收起完整目标')
  await ui.click('编辑个人目标')
  assert.equal(ui.field('为什么学英语').value, api.state.profile.goalNote)
})

test('离开提示将键盘焦点移到继续编辑，继续后回到编辑表单', async (t) => {
  const { ui } = await openProfile(t)
  await ui.click('编辑个人目标')
  await ui.input('为什么学英语', '还在写')
  await ui.click('今日')
  assert.ok(ui.window.document.activeElement === ui.button('继续编辑'), 'leave notice should focus the continue-editing action')
  await ui.click('继续编辑')
  assert.equal(ui.window.document.activeElement, ui.field('想用英语做什么'))
})

test('编辑从已保存值开始，取消不写入并恢复编辑入口焦点', async (t) => {
  const { ui, api } = await openProfile(t)
  await ui.click('编辑个人目标')
  assert.equal(ui.window.document.activeElement, ui.field('想用英语做什么'))
  assert.equal(ui.field('为什么学英语').value, '听懂技术评审')
  await ui.input('为什么学英语', '这次不保存')
  await ui.input('感兴趣的主题', '未加入的兴趣')
  await ui.click('取消')
  assert.equal(api.saves.length, 0)
  assert.match(ui.text(), /听懂技术评审/)
  assert.doesNotMatch(ui.text(), /这次不保存|未加入的兴趣/)
  assert.equal(ui.window.document.activeElement, ui.button('编辑个人目标'))
  await ui.click('编辑个人目标')
  assert.equal(ui.field('为什么学英语').value, '听懂技术评审')
  assert.equal(ui.field('感兴趣的主题').value, '')
})

test('保存结果立即更新并收起，迟到的旧轮询不能闪回摘要或下一次草稿', async (t) => {
  const { ui, api } = await openProfile(t)
  const stale = structuredClone(api.state)
  await ui.click('编辑个人目标')
  await ui.input('为什么学英语', '看懂研究文献')
  await ui.input('感兴趣的主题', '天文学')
  await ui.click('保存')
  assert.equal(api.saves.length, 1)
  assert.equal(api.saves[0].goalNote, '看懂研究文献')
  assert.deepEqual(api.saves[0].interests, ['能源', '产品设计', '天文学'])
  assert.match(ui.text(), /看懂研究文献/)
  assert.equal(ui.buttons('保存').length, 0)
  assert.equal(ui.window.document.activeElement, ui.button('编辑个人目标'))
  // Simulate a previously captured response being returned by the polling boundary.
  api.state.profile = stale.profile
  await ui.poll()
  assert.match(ui.text(), /看懂研究文献/)
  await ui.click('编辑个人目标')
  assert.equal(ui.field('为什么学英语').value, '看懂研究文献')
})

test('保存延迟和失败保留所有草稿及未添加兴趣，轮询不覆盖，允许重试', async (t) => {
  const { ui, api } = await openProfile(t)
  const pending = deferred()
  const successfulSave = api.save
  api.save = () => pending.promise
  await ui.click('编辑个人目标')
  await ui.input('每天能挤出多久', '45')
  await ui.input('为什么学英语', '草稿目标')
  await ui.input('感兴趣的主题', '未添加兴趣')
  await ui.poll()
  assert.equal(ui.field('感兴趣的主题').value, '未添加兴趣')
  const save = ui.button('保存')
  await ui.flush(async () => { save.click(); save.click() })
  assert.equal(api.saves.length, 1)
  await ui.poll()
  assert.equal(ui.field('为什么学英语').value, '草稿目标')
  await ui.flush(async () => pending.resolve({ ok: false, message: '保存失败，请重试' }))
  assert.match(ui.text(), /保存失败，请重试/)
  assert.equal(ui.field('每天能挤出多久').value, '45')
  assert.equal(ui.field('感兴趣的主题').value, '未添加兴趣')
  api.save = successfulSave
  await ui.click('保存')
  assert.equal(api.saves.length, 2)
  assert.match(ui.text(), /草稿目标/)
  assert.equal(ui.buttons('取消').length, 0)
})

test('仅未添加兴趣也是脏编辑，切页和测评须确认放弃或继续编辑', async (t) => {
  const { ui, api } = await openProfile(t)
  await ui.click('编辑个人目标')
  await ui.input('感兴趣的主题', '别吞掉我')
  await ui.click('计划')
  assert.match(ui.text(), /未保存/)
  await ui.click('继续编辑')
  assert.equal(ui.field('感兴趣的主题').value, '别吞掉我')
  await ui.click('测评')
  assert.match(ui.text(), /未保存/)
  await ui.click('继续编辑')
  await ui.click('今日')
  await ui.click('放弃修改并离开')
  assert.equal(ui.buttons('编辑个人目标').length, 0)
  await ui.click('个人')
  await ui.click('编辑个人目标')
  assert.equal(ui.field('感兴趣的主题').value, '')
  assert.equal(api.saves.length, 0)
})

test('保存中不能离开；校验拒绝保持表单和全部未提交兴趣文本', async (t) => {
  const { ui, api } = await openProfile(t)
  await ui.click('编辑个人目标')
  const tooMany = Array.from({ length: 13 }, (_, index) => `兴趣${index}`).join(',')
  await ui.input('感兴趣的主题', tooMany)
  await ui.click('保存')
  assert.match(ui.text(), /最多填写 12 个/)
  assert.equal(ui.field('感兴趣的主题').value, tooMany)
  assert.equal(api.saves.length, 0)
  await ui.input('感兴趣的主题', '天文学')
  const pending = deferred()
  api.save = () => pending.promise
  await ui.click('保存')
  await ui.click('今日')
  assert.match(ui.text(), /正在保存，请等待/)
  assert.equal(ui.field('感兴趣的主题').value, '天文学')
  await ui.flush(async () => pending.resolve({ ok: false, message: '时长必须在 5 到 180 分钟之间' }))
  assert.match(ui.text(), /时长必须/)
  assert.equal(ui.field('感兴趣的主题').value, '天文学')
})

test('首次引导仍直接显示填写表单，不要求先点编辑', async (t) => {
  const api = fixture()
  api.state.onboarded = false
  api.state.profile = null
  const ui = await mountClient({ request: api.request })
  t.after(() => ui.close())
  assert.match(ui.text(), /先说三件事/)
  assert.ok(ui.container.querySelector('input'))
  assert.equal(ui.buttons('编辑个人目标').length, 0)
  assert.equal(ui.buttons('保存').length, 1)
})

test('编辑兴趣支持回车添加和移除，保存只修改画像不重置进度展示', async (t) => {
  const { ui } = await openProfile(t)
  const progressBefore = ui.container.querySelector('[aria-label="学习概况"]').textContent
  await ui.click('编辑个人目标')
  await ui.input('感兴趣的主题', '天文学')
  await ui.key(ui.field('感兴趣的主题'), 'Enter')
  assert.equal(ui.field('感兴趣的主题').value, '')
  const remove = ui.container.querySelector('button[aria-label="移除 能源"]')
  assert.ok(remove)
  await ui.click(remove)
  await ui.click('保存')
  assert.match(ui.text(), /兴趣：产品设计、天文学/)
  assert.equal(ui.container.querySelector('[aria-label="学习概况"]').textContent, progressBefore)
})

test('离开提示出现后保存成功才进入原目标视图', async (t) => {
  const { ui, api } = await openProfile(t)
  await ui.click('编辑个人目标')
  await ui.input('为什么学英语', '保存后离开')
  await ui.click('计划')
  await ui.click('保存')
  assert.equal(api.saves.length, 1)
  assert.equal(ui.buttons('继续编辑').length, 0)
  assert.equal(ui.buttons('编辑个人目标').length, 0)
  assert.match(ui.text(), /重新生成大纲/)
})

test('状态轮询通信失败不卸载脏编辑；浏览器卸载注册提示并在取消后移除', async (t) => {
  const { ui, api } = await openProfile(t)
  await ui.click('编辑个人目标')
  await ui.input('感兴趣的主题', '轮询失败也保留')
  const before = new ui.window.Event('beforeunload', { cancelable: true })
  ui.window.dispatchEvent(before)
  assert.equal(before.defaultPrevented, true)
  const original = api.request
  api.request = (command, payload) => command === 'state.get' ? { ok: false, message: '暂时离线' } : original(command, payload)
  await ui.poll()
  assert.equal(ui.field('感兴趣的主题').value, '轮询失败也保留')
  await ui.click('取消')
  const after = new ui.window.Event('beforeunload', { cancelable: true })
  ui.window.dispatchEvent(after)
  assert.equal(after.defaultPrevented, false)
})
