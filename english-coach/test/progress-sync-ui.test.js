import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient, deferred } from './client-harness.js'

const card = (id, term) => ({ id, term, kind: 'word', fresh: false, due: true, box: 1, meaning: '正确释义', choices: ['正确释义', '其他释义', '第三释义', '第四释义'], answerIndex: 0 })
function fixture() {
  const items = [card('one', 'first-word'), card('two', 'second-word')]
  const api = { calls: [], async request(command, payload) {
    api.calls.push({ command, payload })
    if (command === 'state.get') return { ok: true, data: { onboarded: true, now: '2026-10-26', profile: { goal: 'work', interests: [] }, settings: { study: { wordsPerDay: 3 } }, review: { dueCount: 3 }, streak: { current: 0 } } }
    if (command === 'review.list' || command === 'study.batch') return { ok: true, data: { items: structuredClone(items), dueCount: 3, batchSize: 3 } }
    if (command === 'review.answer') return { ok: true, data: { correct: true, explanation: '已记录' } }
    if (command === 'settings.get') return { ok: true, data: { study: { wordsPerDay: 3 } } }
    if (command === 'wordlists.list') return { ok: true, data: { lists: [] } }
    throw new Error(`Unexpected Host request: ${command}`)
  } }
  return api
}
const main = ui => ui.container.querySelector('[data-test-slot="main"]')
const pop = ui => ui.container.querySelector('.ec-pop')
const button = (root, text) => {
  const node = [...root.querySelectorAll('button')].find(node => node.textContent.trim() === text)
  assert.ok(node, `Missing visible action: ${text}`)
  return node
}

test('主页推进后打开悬浮窗，同步当前单词及本轮题号而不重新开始', async t => {
  const api = fixture()
  const ui = await mountClient({ request: api.request, slot: ['main', 'shell.overlay'] })
  t.after(() => ui.close())
  await ui.click(main(ui).querySelector('.ec-choice'))
  await ui.click(button(main(ui), '下一个'))
  assert.equal(main(ui).querySelector('.ec-deck-term').textContent, 'second-word')
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  assert.equal(pop(ui).querySelector('.ec-pop-term').textContent, 'second-word', 'Opening the overlay must resume the shared round, not its first item')
  assert.match(pop(ui).textContent, /第 2 个 \/ 共 2 个/)
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 1)
})

test('离开今日再返回，保留当前轮题号和未答单词', async t => {
  const api = fixture()
  const ui = await mountClient({ request: api.request })
  t.after(() => ui.close())
  await ui.click(ui.container.querySelector('.ec-choice'))
  await ui.click('下一个')
  assert.match(ui.text(), /本轮第 2 \/ 2 项/)
  await ui.click('单词')
  await ui.click('今日')
  assert.equal(ui.container.querySelector('.ec-deck-term').textContent, 'second-word', 'Returning to today must not create a fresh round')
  assert.match(ui.text(), /本轮第 2 \/ 2 项/)
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 1)
})

test('悬浮答题与主页共享反馈、题号、完成统计及唯一作答锁', async t => {
  const api = fixture()
  const ui = await mountClient({ request: api.request, slot: ['main', 'shell.overlay'] })
  t.after(() => ui.close())
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  const one = main(ui).querySelector('.ec-choice'), other = pop(ui).querySelector('.ec-choice')
  await ui.flush(() => { other.click(); one.click() })
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 1)
  assert.match(main(ui).textContent, /答对了/)
  assert.match(pop(ui).textContent, /答对了/)
  const a = button(main(ui), '下一个'), b = button(pop(ui), '下一个')
  await ui.flush(() => { a.click(); b.click() })
  assert.equal(main(ui).querySelector('.ec-deck-term').textContent, 'second-word')
  assert.equal(pop(ui).querySelector('.ec-pop-term').textContent, 'second-word')
  await ui.click(pop(ui).querySelector('.ec-choice'))
  await ui.click(button(pop(ui), '完成复习'))
  assert.match(main(ui).textContent, /已完成 2 \/ 2 项/)
  assert.match(pop(ui).textContent, /已完成 2 \/ 2 项/)
  await ui.click('收起')
  await ui.click('单词')
  assert.match(main(ui).textContent, /已完成 2 \/ 2 项/)
  assert.equal(api.calls.filter(({ command }) => command === 'study.batch').length, 3, '入口切换重新读取相同保存批次')
})

test('作答请求跨导航保留忙状态，迟到成功只记录一次并恢复反馈', async t => {
  const api = fixture(), pending = deferred(), request = api.request
  api.request = (command, payload) => {
    if (command !== 'review.answer') return request(command, payload)
    api.calls.push({ command, payload }); return pending.promise
  }
  const ui = await mountClient({ request: (command, payload) => api.request(command, payload) })
  t.after(() => ui.close())
  await ui.click(ui.container.querySelector('.ec-choice'))
  await ui.click('单词')
  assert.equal(ui.container.querySelector('.ec-choice').disabled, true)
  await ui.click('今日')
  assert.equal(ui.container.querySelector('.ec-choice').disabled, true)
  await ui.flush(() => pending.resolve({ ok: true, data: { correct: false, explanation: '合成错题讲解', dueCount: 2 } }))
  assert.match(ui.text(), /答错了.*合成错题讲解/)
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 1)
  assert.equal(api.calls.filter(({ command }) => command === 'study.batch').length, 3, '入口切换重新读取相同保存批次')
  await ui.click('下一个')
  assert.equal(ui.container.querySelector('.ec-deck-term').textContent, 'second-word')
  assert.match(ui.text(), /已完成 0 \/ 2 项/)
})

test('双入口可见时共享下一批请求锁，显式继续后一起回到新批次第一项', async t => {
  const api = fixture(), pending = deferred(), request = api.request
  api.request = (command, payload) => {
    if (command !== 'generate.vocab') return request(command, payload)
    api.calls.push({ command, payload }); return pending.promise
  }
  const ui = await mountClient({ request: api.request, slot: ['main', 'shell.overlay'] })
  t.after(() => ui.close())
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  for (const label of ['下一个', '完成复习']) {
    await ui.click(main(ui).querySelector('.ec-choice'))
    await ui.click(button(main(ui), label))
  }
  const a = button(main(ui), '继续学习'), b = button(pop(ui), '继续学习')
  await ui.flush(() => { a.click(); b.click() })
  assert.equal(api.calls.filter(({ command }) => command === 'generate.vocab').length, 1)
  await ui.flush(() => pending.resolve({ ok: true, data: { mode: 'static', items: [card('next', 'next-round')], dueCount: 1, batchSize: 3 } }))
  assert.equal(main(ui).querySelector('.ec-deck-term').textContent, 'next-round')
  assert.equal(pop(ui).querySelector('.ec-pop-term').textContent, 'next-round')
  assert.match(main(ui).textContent, /本轮第 1 \/ 1 项/)
  assert.match(pop(ui).textContent, /第 1 个 \/ 共 1 个/)
})

test('画像补词请求与生成状态跨计划页导航保留，新批次只加载一次', async t => {
  const api = fixture(), pending = deferred(), request = api.request
  api.request = (command, payload) => {
    if (command === 'study.batch') return { ok: true, data: { items: api.ready ? [card('generated', 'generated-after-navigation')] : [], dueCount: 0, batchSize: 3 } }
    if (command === 'generate.vocab') { api.calls.push({ command, payload }); return pending.promise }
    if (command === 'job.status' && payload.kind === 'vocab') { api.calls.push({ command, payload }); api.ready = true; return { ok: true, data: { status: 'done' } } }
    return request(command, payload)
  }
  const ui = await mountClient({ request: api.request })
  t.after(() => ui.close())
  await ui.click('继续学习')
  await ui.click('计划')
  await ui.flush(() => pending.resolve({ ok: true, data: { mode: 'generated', status: 'pending' } }))
  await ui.poll()
  await ui.click('今日')
  assert.equal(ui.container.querySelector('.ec-deck-term').textContent, 'generated-after-navigation')
  assert.match(ui.text(), /本轮第 1 \/ 1 项/)
  assert.equal(api.calls.filter(({ command }) => command === 'generate.vocab').length, 1)
  assert.equal(api.calls.filter(({ command, payload }) => command === 'job.status' && payload.kind === 'vocab').length, 1)
})

test('同一轮中较早的轮询不能覆盖较新的宿主待复习数', async t => {
  const api = fixture(), stale = deferred(), request = api.request
  let block = false, reads = 0
  api.request = async (command, payload) => {
    if (command === 'state.get' && block && reads++ < 2) return stale.promise
    const result = await request(command, payload)
    if (command === 'state.get' && block) result.data.review.dueCount = 2
    return result
  }
  const ui = await mountClient({ request: api.request, slot: ['main', 'shell.overlay'] })
  t.after(() => ui.close())
  block = true
  await ui.poll()
  await ui.poll()
  assert.equal(ui.container.querySelector('.ec-pill-count').textContent, '2')
  await ui.flush(() => stale.resolve({ ok: true, data: { onboarded: true, settings: {}, review: { dueCount: 3 } } }))
  assert.match(main(ui).querySelector('.ec-status').textContent, /待复习 2/)
  assert.equal(ui.container.querySelector('.ec-pill-count').textContent, '2')
})

test('旧状态轮询迟到不会把已更新的双入口待复习数倒退', async t => {
  const api = fixture(), stale = deferred(), request = api.request
  let block = false, staleReads = 0, answered = false
  api.request = async (command, payload) => {
    if (command === 'state.get' && block && staleReads++ < 2) return stale.promise
    if (command === 'review.answer') { answered = true; return { ok: true, data: { correct: true, dueCount: 2 } } }
    if (command === 'review.list' && answered) return { ok: true, data: { items: [], dueCount: 2 } }
    const result = await request(command, payload)
    if (command === 'state.get' && answered) result.data.review.dueCount = 2
    return result
  }
  const ui = await mountClient({ request: api.request, slot: ['main', 'shell.overlay'] })
  t.after(() => ui.close())
  block = true
  await ui.poll()
  await ui.click(main(ui).querySelector('.ec-choice'))
  assert.match(main(ui).querySelector('.ec-status').textContent, /待复习 2/)
  assert.equal(ui.container.querySelector('.ec-pill-count').textContent, '2')
  await ui.flush(() => stale.resolve({ ok: true, data: { onboarded: true, settings: {}, review: { dueCount: 3 } } }))
  assert.match(main(ui).querySelector('.ec-status').textContent, /待复习 2/)
  assert.equal(ui.container.querySelector('.ec-pill-count').textContent, '2')
})
