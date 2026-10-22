import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient, deferred } from './client-harness.js'

const card = (id, term, fresh = false) => ({ id, term, kind: 'word', fresh, due: true, box: 1, meaning: '正确释义', choices: ['正确释义', '另一个释义', '第三种释义', '第四种释义'], answerIndex: 0 })
function fixture() {
  const old = card('old', 'overdue')
  const fresh = card('fresh', 'selected-new', true)
  const api = {
    calls: [], batch: [old, fresh], personal: [fresh, old], dueCount: 1, activeWordListId: 'cet4', exhaustion: null,
    request: async (command, payload) => {
      api.calls.push({ command, payload })
      if (command === 'state.get') return { ok: true, data: { onboarded: true, now: '2026-10-22', profile: { goal: 'work', interests: [] }, settings: { study: { wordsPerDay: 3 } }, review: { dueCount: api.dueCount }, streak: { current: 0 } } }
      if (command === 'review.list') return { ok: true, data: { items: structuredClone(api.personal), dueCount: api.dueCount } }
      if (command === 'study.batch' || command === 'study.supplement') return { ok: true, data: { items: structuredClone(api.batch), dueCount: api.dueCount, batchSize: 3, activeWordListId: api.activeWordListId, exhaustion: api.exhaustion, shortfall: 3 - api.batch.length, addedCount: 0 } }
      if (command === 'review.answer') return { ok: true, data: { correct: true, explanation: '已记录' } }
      if (command === 'wordlists.list') return { ok: true, data: { lists: [{ id: 'cet4', title: '四级' }, { id: 'ielts', title: '雅思' }], activeWordListId: api.activeWordListId } }
      if (command === 'wordlists.select') { api.activeWordListId = payload.id; api.batch = [card('next', 'ielts-next', true)]; return { ok: true, data: { activeWordListId: payload.id } } }
      if (command === 'vocabulary.query' || command === 'wordlists.query') return { ok: true, data: { items: [], total: 0, page: 1, pageSize: 50, pageCount: 1 } }
      if (command === 'generate.vocab') return { ok: true, data: { mode: 'generated', status: 'pending' } }
      throw new Error(`Unexpected host call ${command}`)
    }
  }
  return api
}
async function open(t, api, entry = 'today') {
  const ui = await mountClient({ request: (command, payload) => api.request(command, payload), slot: entry === 'overlay' ? 'shell.overlay' : 'main' })
  t.after(() => ui.close())
  if (entry === 'words') await ui.click('单词')
  if (entry === 'overlay') await ui.click(ui.container.querySelector('.ec-pill-btn'))
  return ui
}
const term = (ui) => ui.container.querySelector('.ec-deck-term,.ec-pop-term')?.textContent
async function answer(ui) { await ui.click(ui.container.querySelector('.ec-choice')); await ui.click(ui.buttons('下一个')[0] ?? ui.button('完成复习')) }

for (const entry of ['today', 'words', 'overlay']) {
  test(`${entry} 从统一批次展示旧词优先，目录顺序不改变候选`, async (t) => {
    const api = fixture()
    const ui = await open(t, api, entry)
    assert.equal(term(ui), 'overdue')
    await answer(ui)
    assert.equal(term(ui), 'selected-new')
    assert.equal(api.calls.some(({ command }) => command === 'generate.vocab'), false)
    assert.equal(api.calls.some(({ command }) => command === 'study.supplement'), false, 'viewing must not enrol static words')
  })
}

for (const entry of ['today', 'overlay']) {
  test(`${entry} 下一批显式静态补足，不发模型请求；本轮题目不随后台替换`, async (t) => {
    const api = fixture()
    const ui = await open(t, api, entry)
    api.personal = [card('old', 'background-replaced'), card('fresh', 'changed')]
    api.batch = [card('next', 'next-library-word', true)]
    api.activeWordListId = 'ielts'
    api.dueCount = 0
    await ui.poll()
    assert.equal(term(ui), 'overdue')
    await answer(ui)
    assert.equal(term(ui), 'selected-new')
    await answer(ui)
    await ui.click('继续学习')
    assert.equal(term(ui), 'next-library-word')
    assert.equal(api.calls.filter(({ command }) => command === 'study.supplement').length, 1)
    assert.equal(api.calls.some(({ command }) => command === 'generate.vocab'), false)
  })
}

test('单词页实际保存新词库偏好只影响下一批，不替换当前和剩余题目', async (t) => {
  const api = fixture()
  const ui = await open(t, api, 'words')
  await ui.click('主题词库')
  await ui.input('当前词库偏好', 'ielts')
  await ui.click('保存词库偏好')
  assert.match(ui.text(), /下一批生效/)
  await ui.poll()
  assert.equal(term(ui), 'overdue')
  await answer(ui)
  assert.equal(term(ui), 'selected-new')
  api.dueCount = 0
  await answer(ui)
  await ui.click('继续学习')
  assert.equal(term(ui), 'ielts-next')
})

test('词汇浏览输入与选择框内的数字键不提交学习答案', async (t) => {
  const api = fixture()
  const ui = await open(t, api, 'words')
  await ui.key(ui.field('每页条数'), '1')
  await ui.key(ui.button('主题词库'), '1')
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 0)
})

test('悬浮层关闭期间迟到批次不替换，重开保留未完成快照', async (t) => {
  const api = fixture()
  const ui = await open(t, api, 'overlay')
  await ui.click('收起')
  api.batch = [card('new', 'new-after-collapse', true)]
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  assert.equal(term(ui), 'overdue')
  await answer(ui)
  assert.equal(term(ui), 'selected-new')
})

test('悬浮已结束快照重开不自动开始下一批，必须显式继续', async (t) => {
  const api = fixture()
  api.batch = [card('first', 'first-batch')]
  api.dueCount = 0
  const ui = await open(t, api, 'overlay')
  await answer(ui)
  assert.match(ui.text(), /这批答对 1 个/)
  await ui.click('收起')
  api.batch = [card('next', 'next-batch', true)]
  const readsBefore = api.calls.filter(({ command }) => command === 'study.batch').length
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  assert.equal(term(ui), undefined)
  assert.match(ui.text(), /这批答对 1 个/)
  assert.equal(api.calls.filter(({ command }) => command === 'study.batch').length, readsBefore)
  await ui.click('继续学习')
  assert.equal(term(ui), 'next-batch')
})

test('悬浮旧首读迟到不能覆盖重新打开后手动续批及其完成状态', async (t) => {
  const api = fixture()
  api.batch = []; api.personal = []; api.dueCount = 0
  const original = api.request
  const staleFirst = deferred()
  let reads = 0
  api.request = (command, payload) => command === 'study.batch' && ++reads === 1 ? staleFirst.promise : original(command, payload)
  const ui = await open(t, api, 'overlay')
  await ui.click('收起')
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  api.batch = [card('new', 'new-batch', true)]
  await ui.click('继续学习')
  assert.equal(term(ui), 'new-batch')
  await answer(ui)
  await ui.flush(async () => staleFirst.resolve({ ok: true, data: { items: [card('stale', 'stale-first-batch')], dueCount: 9, batchSize: 3 } }))
  assert.equal(term(ui), undefined)
  assert.match(ui.text(), /这批答对 1 个/)
  assert.doesNotMatch(ui.text(), /stale-first-batch|今天到期 9 个/)
})

test('悬浮首读期间显示加载，不能提前续批或请求模型；失败可只读重试', async (t) => {
  const api = fixture()
  api.dueCount = 0
  const original = api.request
  const first = deferred()
  api.request = (command, payload) => command === 'study.batch' ? first.promise : original(command, payload)
  const ui = await open(t, api, 'overlay')
  assert.match(ui.text(), /加载中/)
  for (const label of ['继续学习', '按画像补词']) {
    for (const button of ui.buttons(label)) {
      assert.equal(button.disabled, true)
      await ui.click(button)
    }
  }
  assert.equal(api.calls.some(({ command }) => /study.supplement|generate.vocab/.test(command)), false)
  await ui.flush(async () => first.resolve({ ok: false, message: '首读失败，请重试' }))
  assert.match(ui.text(), /首读失败/)
  assert.doesNotMatch(ui.text(), /加载中/)
  api.request = original
  await ui.click('重试')
  assert.equal(term(ui), 'overdue')
  assert.equal(api.calls.some(({ command }) => /study.supplement|generate.vocab/.test(command)), false)
})

test('批次读取失败显示可重试错误，不伪装为学完或永久加载', async (t) => {
  const api = fixture()
  const original = api.request
  let failed = true
  api.request = (command, payload) => command === 'study.batch' && failed ? { ok: false, message: '批次暂时不可用' } : original(command, payload)
  const ui = await open(t, api)
  assert.match(ui.text(), /批次暂时不可用/)
  failed = false
  await ui.click('重试')
  assert.equal(term(ui), 'overdue')
})

test('静态补充失败可重试且不模型回退，连续点击只发送一次请求', async (t) => {
  const api = fixture()
  api.batch = []; api.personal = []; api.dueCount = 0
  const original = api.request
  const pending = deferred()
  api.request = (command, payload) => {
    if (command === 'study.supplement') { api.calls.push({ command, payload }); return pending.promise }
    return original(command, payload)
  }
  const ui = await open(t, api)
  const button = ui.button('继续学习')
  await ui.flush(async () => { button.click(); button.click() })
  assert.equal(api.calls.filter(({ command }) => command === 'study.supplement').length, 1)
  await ui.flush(async () => pending.resolve({ ok: false, message: '静态补充暂时失败' }))
  assert.match(ui.text(), /静态补充暂时失败/)
  assert.equal(api.calls.some(({ command }) => command === 'generate.vocab'), false)
  api.request = original
  api.batch = [card('retry', 'retried', true)]
  await ui.click('继续学习')
  assert.equal(term(ui), 'retried')
})

test('每批输入越界恢复保存值，合法保存保留未知学习偏好', async (t) => {
  const api = fixture()
  let saved = { wordsPerDay: 3, futurePreference: 'keep' }
  const original = api.request
  api.request = async (command, payload) => {
    if (command === 'settings.save') { api.calls.push({ command, payload }); saved = payload.study; return { ok: true, data: { study: saved } } }
    const response = await original(command, payload)
    if (command === 'state.get') response.data.settings.study = saved
    return response
  }
  const ui = await mountClient({ request: api.request, slot: 'settings.section' })
  t.after(() => ui.close())
  const input = ui.container.querySelector('input[type="number"]')
  await ui.input(input, 31)
  await ui.flush(async () => input.dispatchEvent(new ui.window.FocusEvent('focusout', { bubbles: true })))
  assert.equal(input.value, '3')
  assert.equal(api.calls.filter(({ command }) => command === 'settings.save').length, 0)
  await ui.input(input, 7)
  await ui.flush(async () => input.dispatchEvent(new ui.window.FocusEvent('focusout', { bubbles: true })))
  assert.deepEqual(saved, { wordsPerDay: 7, futurePreference: 'keep' })
})

test('每批设置明确不是每日上限，保留既有批量值', async (t) => {
  const api = fixture()
  const ui = await mountClient({ request: api.request, slot: 'settings.section' })
  t.after(() => ui.close())
  assert.match(ui.text(), /每批学习/)
  assert.doesNotMatch(ui.text(), /每天学几个词/)
  assert.match(ui.text(), /不是每日上限/)
  assert.equal(ui.container.querySelector('input[type="number"]').value, '3')
})

for (const [exhaustion, notice] of [['all_joined', /全部已加入.*不等于已掌握/], ['all_mastered', /全部掌握.*到期抽检/]]) {
  test(`静态不足仍可学已有批次，并明确 ${exhaustion}`, async (t) => {
    const api = fixture()
    api.batch = []; api.personal = []; api.dueCount = 0
    const ui = await open(t, api)
    api.batch = [card('one', 'one-available', true)]
    api.exhaustion = exhaustion
    await ui.click('继续学习')
    assert.equal(term(ui), 'one-available')
    assert.match(ui.text(), /本批取得 1 \/ 3 项/)
    assert.match(ui.text(), notice)
  })
}

test('显式画像任务完成后同样从只读批次取候选，不按目录顺序挑题', async (t) => {
  const api = fixture()
  api.batch = []; api.personal = []; api.dueCount = 0
  const original = api.request
  api.request = (command, payload) => command === 'job.status' ? { ok: true, data: { status: 'done' } } : original(command, payload)
  const ui = await open(t, api)
  await ui.click('按画像补词')
  api.batch = [card('generated', 'generated-candidate', true)]
  await ui.poll()
  assert.equal(term(ui), 'generated-candidate')
})

for (const entry of ['today', 'overlay']) {
  test(`${entry} 没有合格静态候选说明原因，只有显式按画像补词才请求模型`, async (t) => {
    const api = fixture()
    api.batch = []
    api.personal = []
    api.dueCount = 0
    api.exhaustion = 'unavailable'
    const ui = await open(t, api, entry)
    await ui.click('继续学习')
    assert.match(ui.text(), /暂不可练/)
    assert.ok(ui.button('选择词库'))
    assert.equal(api.calls.some(({ command }) => command === 'generate.vocab'), false)
    await ui.click('按画像补词')
    assert.deepEqual(api.calls.filter(({ command }) => command === 'generate.vocab').map(({ payload }) => payload), [{ profile: true }])
  })

  test(`${entry} 已失效作答明确提示，不静默跳过且可主动下一题`, async (t) => {
    const api = fixture()
    const original = api.request
    api.request = (command, payload) => command === 'review.answer' ? { ok: false, code: 'not_due', message: '这项已在其他入口作答，现在还未到期' } : original(command, payload)
    const ui = await open(t, api, entry)
    await ui.click(ui.container.querySelector('.ec-choice'))
    assert.equal(term(ui), 'overdue')
    assert.match(ui.text(), /其他入口|未到期/)
    await ui.click('下一个')
    assert.equal(term(ui), 'selected-new')
  })
}
