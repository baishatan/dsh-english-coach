import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'

const now = new Date('2026-10-22T09:00:00+08:00')
const pendingRequests = new WeakMap()
async function settled(ui, excluded = []) {
  const pending = pendingRequests.get(ui)
  const remaining = () => [...pending].filter(promise => !excluded.includes(promise))
  // Draining act also runs effects that can issue another public Host request.
  do {
    await ui.flush(async () => { await Promise.all(remaining()) })
  } while (remaining().length)
}
async function open(t, count = 121) {
  const root = await fs.mkdtemp(join(tmpdir(), 'coach-ui-'))
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })
  if (count) await run('review.add', { items: Array.from({ length: count }, (_, i) => ({ term: `entry-${String(i).padStart(3, '0')}`, meaning: i === count - 1 ? '远处目标' : '合成释义', choices: [i === count - 1 ? '远处目标' : '合成释义', '因此', '然而', '尽管'], answerIndex: 0 })) })
  const state = await run('state.get')
  const words = await run('review.list')
  const requests = [], pending = new Set()
  const api = { intercept: null, request(command, payload) {
    requests.push({ command, payload })
    const response = api.intercept?.(command, payload)
      ?? (command === 'state.get' ? structuredClone(state)
        : command === 'review.list' ? structuredClone(words)
        : command === 'job.status' ? { ok: true, data: null }
        : command === 'profile.infer' ? { ok: true, data: {} }
        : run(command, payload))
    const promise = Promise.resolve(response)
    pending.add(promise)
    promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  } }
  const ui = await mountClient({ request: (c, p) => api.request(c, p) })
  pendingRequests.set(ui, pending)
  t.after(async () => { await settled(ui); await ui.close(); await fs.rm(root, { recursive: true, force: true }) })
  await settled(ui)
  await ui.click('单词')
  await settled(ui)
  return { ui, run, api, requests }
}

test('我的词汇分页完整搜索，切视图保留浏览条件且不改学习总数', async t => {
  const { ui, run } = await open(t)
  assert.equal(ui.container.querySelectorAll('.ec-lib-row').length, 50)
  assert.match(ui.text(), /共 121 条/)
  await ui.click('下一页')
  await settled(ui)
  assert.match(ui.text(), /第 2 \/ 3 页/)
  await ui.input('搜索词汇或中文释义', '远处')
  await settled(ui)
  assert.equal(ui.container.querySelectorAll('.ec-lib-row').length, 1)
  assert.match(ui.text(), /entry-120/)
  await ui.click('今日')
  await ui.click('单词')
  await settled(ui)
  assert.equal(ui.field('搜索词汇或中文释义').value, '远处')
  assert.equal((await run('review.list')).data.total, 121)
  await ui.input('搜索词汇或中文释义', '')
  await ui.input('每页条数', '20')
  await settled(ui)
  assert.equal(ui.container.querySelectorAll('.ec-lib-row').length, 20)
  assert.match(ui.text(), /第 1 \/ 7 页/)
})

test('主题目录独立分页与可练状态，选库不入队且详情返回焦点', async t => {
  const { ui, run } = await open(t, 0)
  await ui.click('主题词库'); await settled(ui)
  assert.match(ui.text(), /目录 3849 · 可练 119/)
  await ui.input('浏览词库', 'ielts'); await settled(ui)
  await ui.input('搜索词汇或中文释义', 'ZOO'); await settled(ui)
  assert.match(ui.text(), /zoo/)
  assert.match(ui.text(), /共 2 条/)
  const row = [...ui.container.querySelectorAll('.ec-lib-row')].find(node => node.textContent.startsWith('zoo'))
  await ui.click(row)
  assert.ok(ui.container.querySelector('[role=dialog]'))
  assert.match(ui.text(), /原始标签：/)
  await ui.click('关闭词汇详情')
  assert.equal(ui.window.document.activeElement === row, true)
  await ui.input('当前词库偏好', 'cet6')
  await ui.click('保存词库偏好')
  await settled(ui)
  assert.match(ui.text(), /偏好已保存，下一批生效/)
  assert.equal((await run('settings.get')).data.study.activeWordListId, 'cet6')
  assert.equal((await run('review.list')).data.total, 0)
  await ui.input('浏览词库', 'cet4'); await settled(ui)
  assert.equal(ui.field('搜索词汇或中文释义').value, '')
  await ui.input('浏览词库', 'ielts'); await settled(ui)
  assert.equal(ui.field('搜索词汇或中文释义').value, 'ZOO')
})

test('学习卡选择词库直接打开主题目录，既有个人浏览条件不丢', async t => {
  const { ui } = await open(t, 0)
  await ui.click('选择词库'); await settled(ui)
  assert.ok(ui.field('浏览词库'))
  assert.match(ui.text(), /开源学习参考/)
})

test('晚到搜索响应不能覆盖新查询；错误可重试不误报空库', async t => {
  const { ui, api } = await open(t)
  const pending = deferred()
  api.intercept = (command, payload) => command === 'vocabulary.query' && payload.search === 'slow' ? pending.promise : null
  await ui.input('搜索词汇或中文释义', 'slow')
  await ui.input('搜索词汇或中文释义', 'entry-120'); await settled(ui, [pending.promise])
  assert.match(ui.text(), /entry-120/)
  await ui.flush(async () => pending.resolve({ ok: true, data: { items: [], total: 0, page: 1, pages: 1, pageSize: 50 } }))
  assert.match(ui.text(), /entry-120/)
  api.intercept = command => command === 'vocabulary.query' ? { ok: false, message: '隔离通信失败' } : null
  await ui.input('搜索词汇或中文释义', 'failure'); await settled(ui)
  assert.match(ui.text(), /隔离通信失败/)
  assert.doesNotMatch(ui.text(), /没有匹配的词汇/)
  api.intercept = null
  await ui.click('重试'); await settled(ui)
  assert.match(ui.text(), /没有匹配的词汇/)
})
