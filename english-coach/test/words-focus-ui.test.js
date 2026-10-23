import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execute } from '../core/index.js'
import { mountClient, deferred } from './client-harness.js'

const now = new Date('2026-10-23T09:00:00+08:00')
async function open(t, count = 121, slot = 'main') {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-focus-ui-'))
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })
  await run('settings.save', { study: { wordsPerDay: 3 } })
  if (count) await run('review.add', { items: Array.from({ length: count }, (_, index) => ({ term: `entry-${String(index).padStart(3, '0')}`, meaning: index === count - 1 ? '远处目标' : '合成释义', choices: [index === count - 1 ? '远处目标' : '合成释义', '因此', '然而', '尽管'], answerIndex: 0 })) })
  const requests = [], pending = new Set()
  const api = { intercept: null }
  const request = (command, payload) => {
    requests.push({ command, payload })
    const promise = Promise.resolve(api.intercept?.(command, payload) ?? run(command, payload))
    pending.add(promise)
    promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  const ui = await mountClient({ request, slot })
  const settle = async (exclude = []) => {
    const remaining = () => [...pending].filter(promise => !exclude.includes(promise))
    do { await ui.flush(async () => { await Promise.all(remaining()) }) } while (remaining().length)
  }
  t.after(async () => {
    await settle()
    await ui.close()
    assert.equal(dirname(root), temporary, 'Only remove this test’s isolated root')
    assert.ok(root.split('/').at(-1).startsWith('coach-focus-ui-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  await settle()
  await ui.click('单词')
  await settle()
  return { ui, run, api, requests, settle }
}

const term = ui => ui.container.querySelector('.ec-deck-term')?.textContent

test('学习安排和浏览共用已保存来源，取消不写入、失败留选项、下一批才消费', async t => {
  const { ui, run, api, requests, settle } = await open(t, 3)
  const current = term(ui)
  const personalBefore = (await run('review.list')).data
  await ui.click('更换新词来源'); await settle()
  await ui.input('当前词库偏好', 'ielts')
  await ui.click('取消')
  assert.equal((await run('settings.get')).data.study.activeWordListId, null)
  assert.equal(ui.window.document.activeElement, ui.button('更换新词来源'))
  await ui.click('更换新词来源'); await settle()
  await ui.input('当前词库偏好', 'ielts')
  api.intercept = command => command === 'wordlists.select' ? { ok: false, message: '来源保存暂时失败' } : null
  await ui.click('保存词库偏好'); await settle()
  assert.match(ui.text(), /来源保存暂时失败/)
  assert.equal(ui.field('当前词库偏好').value, 'ielts')
  assert.equal((await run('settings.get')).data.study.activeWordListId, null)
  api.intercept = null
  await ui.click('保存词库偏好'); await settle()
  assert.equal((await run('settings.get')).data.study.activeWordListId, 'ielts')
  assert.equal(ui.container.querySelector('[role="dialog"]'), null)
  assert.ok(ui.window.document.activeElement === ui.button('更换新词来源'), 'Saving restores focus after controls are enabled')
  assert.match(ui.text(), /下一批生效/)
  assert.equal(term(ui), current)
  assert.deepEqual((await run('review.list')).data, personalBefore)
  await ui.click('主题词库'); await settle()
  await ui.input('浏览词库', 'ielts'); await settle()
  assert.match(ui.container.querySelector('[aria-label="主题词库浏览"]').textContent, /这是当前词库/)
  assert.equal(ui.container.querySelectorAll('select[aria-label="当前词库偏好"]').length, 0, 'No second permanent source selector')
  await ui.input('浏览词库', 'cet6'); await settle()
  await ui.click('设为当前词库'); await settle()
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /六级/)
  assert.equal(term(ui), current)
  assert.deepEqual((await run('review.list')).data, personalBefore)
  await ui.click(ui.container.querySelector('.ec-choice')); await settle()
  await ui.click('下一个')
  await ui.click(ui.container.querySelector('.ec-choice')); await settle()
  await ui.click('下一个')
  await ui.click(ui.container.querySelector('.ec-choice')); await settle()
  await ui.click('完成复习')
  await ui.click('继续学习'); await settle()
  assert.match(ui.text(), /本轮第 1 \/ 3 项/)
  assert.ok((await run('wordlists.query', { id: 'cet6', filter: 'joined' })).data.total > 0)
  assert.equal(requests.some(({ command }) => command === 'generate.vocab'), false)
})

test('在学习安排调整每批数量，非法值拒绝、取消不写、失败留稿、当前轮不变', async t => {
  const { ui, run, api, settle } = await open(t, 12)
  await run('settings.save', { audio: { voiceURI: 'existing-voice', rate: 1.5 }, automation: { enabled: true, time: '08:30' } })
  await run('wordlists.select', { id: 'ielts' })
  const settingsBefore = (await run('settings.get')).data
  const current = term(ui)
  await ui.click('调整每批数量')
  await ui.input('每批学习词数', '7')
  await ui.click('取消')
  assert.equal((await run('settings.get')).data.study.wordsPerDay, 3)
  assert.equal(ui.window.document.activeElement, ui.button('调整每批数量'))
  await ui.click('调整每批数量')
  for (const invalid of ['', '2', '3.5', '31']) {
    await ui.input('每批学习词数', invalid)
    await ui.click('保存每批数量'); await settle()
    assert.equal((await run('settings.get')).data.study.wordsPerDay, 3)
    assert.ok(ui.container.querySelector('[role="dialog"]'))
  }
  await ui.input('每批学习词数', '7')
  const blocked = deferred()
  let writes = 0
  api.intercept = command => { if (command === 'settings.save') { writes++; return blocked.promise } return null }
  const save = ui.button('保存每批数量')
  await ui.flush(() => { save.click(); save.click() })
  assert.equal(writes, 1)
  await ui.flush(() => blocked.resolve({ ok: false, message: '每批数量保存失败' })); await settle()
  assert.equal(ui.field('每批学习词数').value, '7')
  assert.match(ui.text(), /每批数量保存失败/)
  api.intercept = null
  await ui.click('保存每批数量'); await settle()
  const settingsAfter = (await run('settings.get')).data
  assert.ok(ui.window.document.activeElement === ui.button('调整每批数量'), 'Saving restores focus after controls are enabled')
  assert.equal(settingsAfter.study.wordsPerDay, 7)
  assert.deepEqual(settingsAfter.audio, settingsBefore.audio)
  assert.deepEqual(settingsAfter.automation, settingsBefore.automation)
  assert.equal(settingsAfter.study.activeWordListId, 'ielts')
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /每批学习 7 项/)
  assert.equal(term(ui), current)
  assert.match(ui.text(), /本轮第 1 \/ 3 项/)
  for (let i = 0; i < 3; i++) {
    await ui.click(ui.container.querySelector('.ec-choice')); await settle()
    await ui.click(i === 2 ? '完成复习' : '下一个')
  }
  await ui.click('继续学习'); await settle()
  assert.match(ui.text(), /本轮第 1 \/ 7 项/)
  await ui.click('个人'); await settle()
  await ui.click('单词'); await settle()
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /每批学习 7 项/)
})

test('浏览区保存来源不抢走浏览焦点，重复点击与旧读取不能回退已确认偏好', async t => {
  const { ui, run, api, requests, settle } = await open(t, 3)
  await ui.click('主题词库'); await settle()
  await ui.input('浏览词库', 'ielts'); await settle()
  const button = ui.button('设为当前词库')
  button.focus()
  const saving = deferred()
  api.intercept = command => command === 'wordlists.select' ? saving.promise : null
  const before = requests.filter(({ command }) => command === 'wordlists.select').length
  await ui.flush(() => { button.click(); button.click() })
  assert.equal(requests.filter(({ command }) => command === 'wordlists.select').length, before + 1)
  const result = await run('wordlists.select', { id: 'ielts' })
  await ui.flush(() => saving.resolve(result)); await settle()
  assert.match(ui.text(), /这是当前词库/)
  assert.ok(ui.window.document.activeElement === ui.field('浏览词库'), 'After the action disappears, return focus within the same browser')
  api.intercept = null
  await ui.poll(); await settle()
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /雅思/)
})

test('本地保存后仍跟进较新的真实设置，迟到旧状态不回退批量', async t => {
  const { ui, run, api, settle } = await open(t, 12)
  await ui.click('调整每批数量')
  await ui.input('每批学习词数', '7')
  await ui.click('保存每批数量'); await settle()
  await run('settings.save', { study: { wordsPerDay: 12 } })
  await run('wordlists.select', { id: 'ielts' })
  await ui.poll(); await settle()
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /每批学习 12 项/)
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /雅思/)
  const oldState = await run('state.get')
  const pending = deferred()
  let held = false
  api.intercept = command => command === 'state.get' && !held ? (held = true, pending.promise) : null
  await ui.poll()
  await ui.click('调整每批数量')
  await ui.input('每批学习词数', '9')
  await ui.click('保存每批数量'); await settle([pending.promise])
  await ui.flush(() => pending.resolve(oldState)); await settle()
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /每批学习 9 项/)
})

test('原设置页与单词页即时同步，修改自动化不回写旧批量且反向修改也同步', async t => {
  const { ui, run, settle } = await open(t, 12, ['main', 'settings.section'])
  const settingsPanel = ui.container.querySelector('[data-test-slot="settings.section"]')
  const pace = settingsPanel.querySelector('input[type="number"]')
  assert.equal(pace.value, '3')
  await ui.click('调整每批数量')
  await ui.input('每批学习词数', '7')
  await ui.click('保存每批数量'); await settle()
  assert.equal(pace.value, '7')
  await ui.click(settingsPanel.querySelector('input[type="checkbox"]')); await settle()
  assert.equal((await run('settings.get')).data.study.wordsPerDay, 7)
  await ui.input(pace, '12')
  await ui.flush(() => pace.dispatchEvent(new ui.window.FocusEvent('focusout', { bubbles: true }))); await settle()
  assert.equal((await run('settings.get')).data.study.wordsPerDay, 12)
  assert.match(ui.container.querySelector('[aria-label="学习安排"]').textContent, /每批学习 12 项/)
})

test('无匹配时可清除搜索和筛选，列表失误不冒充空库', async t => {
  const { ui, settle } = await open(t, 6)
  await ui.click('我的词汇'); await settle()
  await ui.input('搜索词汇或中文释义', 'not-present'); await settle()
  await ui.input('词汇状态筛选', 'mastered'); await settle()
  assert.match(ui.text(), /没有匹配的词汇/)
  await ui.click('清除搜索和筛选'); await settle()
  assert.equal(ui.field('搜索词汇或中文释义').value, '')
  assert.equal(ui.field('词汇状态筛选').value, 'all')
  assert.equal(ui.container.querySelectorAll('.ec-lib-row').length, 6)
})

test('词表默认收起，展开搜索详情再收起不丢本轮答案和反馈', async t => {
  const { ui, run, requests, settle } = await open(t)
  const current = term(ui)
  assert.equal(ui.container.querySelectorAll('.ec-lib-row').length, 0)
  assert.equal(ui.button('我的词汇').getAttribute('aria-expanded'), 'false')
  assert.equal(ui.button('主题词库').getAttribute('aria-expanded'), 'false')
  await ui.click(ui.container.querySelector('.ec-choice'))
  await settle()
  assert.match(ui.text(), /答对了/)
  const batchReads = requests.filter(({ command }) => command === 'study.batch').length
  await ui.click('我的词汇'); await settle()
  assert.equal(ui.button('我的词汇').getAttribute('aria-expanded'), 'true')
  assert.equal(ui.container.querySelectorAll('.ec-lib-row').length, 50)
  await ui.input('每页条数', '20'); await settle()
  await ui.click('下一页'); await settle()
  assert.match(ui.text(), /第 2 \/ 7 页/)
  await ui.click(ui.container.querySelector('.ec-lib-row'))
  assert.ok(ui.container.querySelector('[role="dialog"]'))
  await ui.key(ui.button('关闭词汇详情'), 'Escape')
  await ui.click('收起词汇浏览')
  assert.equal(ui.window.document.activeElement, ui.button('我的词汇'))
  assert.equal(term(ui), current)
  assert.match(ui.text(), /答对了/)
  await ui.click('我的词汇'); await settle()
  assert.equal(ui.field('每页条数').value, '20')
  assert.match(ui.text(), /第 2 \/ 7 页/)
  await ui.click('主题词库'); await settle()
  await ui.click('我的词汇'); await settle()
  assert.match(ui.text(), /第 2 \/ 7 页/)
  assert.equal(term(ui), current)
  assert.equal(requests.filter(({ command }) => command === 'study.batch').length, batchReads)
  assert.equal((await run('review.list')).data.total, 121)
  await ui.click('下一个')
  assert.match(ui.text(), /本轮第 2 \/ 3 项/)
})
