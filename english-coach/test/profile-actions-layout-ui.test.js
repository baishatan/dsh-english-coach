import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient } from './client-harness.js'

function fixture({ latest = { band: '中级' } } = {}) {
  const state = {
    onboarded: true,
    profile: { updatedAt: '2026-10-21T00:00:00Z', goal: 'work', minutesPerDay: 30, targetBand: '高级', goalNote: '听懂技术评审', interests: ['能源'] },
    now: '2026-10-22T00:00:00Z',
    settings: { study: { wordsPerDay: 10 } },
    review: { dueCount: 4 },
    streak: { current: 3 },
    level: { latest }
  }
  return {
    state,
    request: async (command) => {
      if (command === 'state.get') return { ok: true, data: structuredClone(state) }
      if (command === 'review.list' || command === 'study.batch') return { ok: true, data: { items: [], dueCount: 0 } }
      if (command === 'progress.get') return { ok: true, data: { completions: [], streak: { current: 3, best: 3 }, mastered: 0, learning: 0, curve: [] } }
      if (command === 'profile.save') return { ok: true, data: { profile: state.profile } }
      if (command === 'profile.infer') return { ok: true, data: {} }
      if (command === 'assessment.status') return { ok: true, data: {} }
      throw new Error(`Unexpected host request ${command}`)
    }
  }
}

async function mount(t, options) {
  const api = fixture(options)
  const ui = await mountClient({ request: (command, payload) => api.request(command, payload) })
  t.after(() => ui.close())
  return { ui, api }
}

const headerButton = (ui, label) => [...ui.container.querySelector('.ec-top').querySelectorAll('button')]
  .find(node => node.textContent.trim() === label)

test('个人页把「编辑个人目标」和「重新测评」放在右上角，摘要卡内不再重复', async (t) => {
  const { ui } = await mount(t)
  await ui.click('个人')
  assert.ok(headerButton(ui, '编辑个人目标'), '编辑个人目标 lives in the page header')
  assert.ok(headerButton(ui, '重新测评'), '重新测评 lives in the page header')
  assert.equal(ui.buttons('编辑个人目标').length, 1)
  assert.equal(ui.buttons('重新测评').length, 1)
  const card = ui.container.querySelector('.ec-profile-goal')
  assert.ok(card, 'goal summary card still renders')
  assert.equal([...card.querySelectorAll('button')].filter(node => node.textContent.trim() === '编辑个人目标').length, 0)
  assert.equal([...card.querySelectorAll('button')].filter(node => node.textContent.trim() === '重新测评').length, 0)
  assert.equal([...ui.container.querySelector('.ec-top').querySelectorAll('button')].filter(node => node.textContent.trim() === '测评').length, 0, '测评 link is replaced by 重新测评 on this page')
})

test('没有测评记录时右上角显示开始测评', async (t) => {
  const { ui } = await mount(t, { latest: null })
  await ui.click('个人')
  assert.ok(headerButton(ui, '开始测评'))
  assert.equal(headerButton(ui, '重新测评'), undefined)
})

test('右上角编辑入口打开表单，取消后焦点回到该按钮', async (t) => {
  const { ui } = await mount(t)
  await ui.click('个人')
  await ui.click('编辑个人目标')
  assert.equal(ui.field('为什么学英语').value, '听懂技术评审')
  await ui.click('取消')
  assert.equal(ui.buttons('编辑个人目标').length, 1)
  assert.equal(ui.window.document.activeElement, headerButton(ui, '编辑个人目标'))
})

test('个人页不再显示「用于安排学习目标和选择课程素材」提示', async (t) => {
  const { ui } = await mount(t)
  await ui.click('个人')
  assert.doesNotMatch(ui.text(), /用于安排学习目标和选择课程素材/)
  assert.doesNotMatch(ui.text(), /随时可以改/)
})

test('朗读设置不再显示主机处理与语速档位说明', async (t) => {
  const { ui } = await mount(t)
  await ui.text()
  assert.doesNotMatch(ui.text(), /远程页面会把文本交给该主机/)
  assert.doesNotMatch(ui.text(), /语速为相对档位/)
})
