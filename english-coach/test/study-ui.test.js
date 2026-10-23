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
      if (command === 'settings.get') return { ok: true, data: { study: { wordsPerDay: 3 } } }
      if (command === 'state.get') return { ok: true, data: { onboarded: true, now: '2026-10-22', profile: { goal: 'work', interests: [] }, settings: { study: { wordsPerDay: 3 } }, review: { dueCount: api.dueCount }, streak: { current: 0 } } }
      if (command === 'review.list') return { ok: true, data: { items: structuredClone(api.personal), dueCount: api.dueCount } }
      if (command === 'study.batch' || command === 'study.supplement') return { ok: true, data: { items: structuredClone(api.batch), dueCount: api.dueCount, batchSize: 3, activeWordListId: api.activeWordListId, exhaustion: api.exhaustion, shortfall: 3 - api.batch.length, addedCount: 0 } }
      if (command === 'review.answer') return { ok: true, data: { correct: true, explanation: '已记录' } }
      if (command === 'wordlists.list') return { ok: true, data: { lists: [{ id: 'cet4', title: '四级' }, { id: 'ielts', title: '雅思' }], activeWordListId: api.activeWordListId } }
      if (command === 'wordlists.select') { api.activeWordListId = payload.id; api.batch = [card('next', 'ielts-next', true)]; return { ok: true, data: { activeWordListId: payload.id } } }
      if (command === 'vocabulary.query' || command === 'wordlists.query') return { ok: true, data: { items: [], total: 0, page: 1, pageSize: 50, pageCount: 1 } }
      if (command === 'generate.vocab') {
        if (payload?.profile === true || (!api.activeWordListId && !api.batch.length)) return { ok: true, data: { mode: 'generated', status: 'pending' } }
        return { ok: true, data: { mode: 'static', items: structuredClone(api.batch), dueCount: api.dueCount, batchSize: 3, activeWordListId: api.activeWordListId, exhaustion: api.exhaustion, shortfall: 3 - api.batch.length, addedCount: 0 } }
      }
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
  test(`${entry} 只有继续学习入口，无词库时由统一请求进入画像生成`, async t => {
    const api = fixture()
    api.batch = []; api.personal = []; api.dueCount = 0; api.activeWordListId = null
    const ui = await open(t, api, entry)
    assert.equal(ui.buttons('按画像补词').length, 0)
    assert.equal(api.calls.filter(({ command }) => command === 'generate.vocab').length, 0)
    await ui.click('继续学习')
    assert.match(ui.text(), /正在出词/)
    assert.deepEqual(api.calls.filter(({ command }) => command === 'generate.vocab').map(({ payload }) => payload), [{}])
  })
}

for (const entry of ['today', 'words', 'overlay']) {
  test(`${entry} 无词库续学失败可重试，生成失败可恢复且重复点击不叠加请求`, async t => {
    const api = fixture()
    api.batch = []; api.personal = []; api.dueCount = 0; api.activeWordListId = null
    let fail = true
    const original = api.request
    api.request = (command, payload) => {
      if (command === 'generate.vocab' && fail) { api.calls.push({ command, payload }); return { ok: false, message: '画像新词请求暂时失败' } }
      if (command === 'job.status') return { ok: true, data: { status: 'failed', failure: '画像新词生成失败' } }
      return original(command, payload)
    }
    const ui = await open(t, api, entry)
    await ui.click('继续学习')
    assert.match(ui.text(), /画像新词请求暂时失败/)
    fail = false
    const retry = ui.button('继续学习')
    await ui.flush(() => { retry.click(); retry.click() })
    assert.equal(api.calls.filter(({ command }) => command === 'generate.vocab').length, 2)
    assert.match(ui.text(), /正在出词/)
    await ui.poll()
    assert.match(ui.text(), /画像新词生成失败/)
    assert.equal(ui.button('继续学习').disabled, false)
    await ui.click('继续学习')
    assert.match(ui.text(), /正在出词/)
  })
}

test('悬浮窗推进动作与打开主页共用最左侧操作行', async t => {
  const api = fixture()
  const ui = await open(t, api, 'overlay')
  const home = () => ui.button('打开主页')
  await ui.click(ui.container.querySelector('.ec-choice'))
  assert.ok(ui.button('下一个').parentElement === home().parentElement)
  assert.equal(home().parentElement.querySelector('button').textContent.trim(), '下一个')
  await ui.click('下一个')
  await ui.click(ui.container.querySelector('.ec-choice'))
  assert.ok(ui.button('完成复习').parentElement === home().parentElement)
  await ui.click('完成复习')
  assert.ok(ui.button('继续学习').parentElement === home().parentElement)
  assert.equal(home().parentElement.querySelector('button').textContent.trim(), '继续学习')
  assert.equal(ui.buttons('按画像补词').length, 0)
})

test('学习空态与完成态不再显示下一批数量说明', async t => {
  const api = fixture()
  api.batch = []; api.personal = []; api.dueCount = 0
  const ui = await open(t, api)
  assert.doesNotMatch(ui.text(), /下一批最多 .*先复习旧词；词库新词可直接学习/)
  api.batch = [card('single', 'single-word')]
  await ui.click('继续学习')
  await answer(ui)
  assert.doesNotMatch(ui.text(), /下一批最多 .*先复习旧词；词库新词可直接学习/)
})

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
    assert.deepEqual(api.calls.filter(({ command }) => command === 'generate.vocab').map(({ payload }) => payload), [{}])
    assert.equal(api.calls.some(({ command, payload }) => command === 'generate.vocab' && payload.profile === true), false)
  })
}

test('单词页先到本轮学习，实际项数与全部待复习分开呈现', async (t) => {
  const api = fixture()
  api.dueCount = 31
  const ui = await open(t, api, 'words')
  const sections = [...ui.container.querySelectorAll('section')]
  assert.match(sections[0].textContent, /单词学习/)
  assert.match(sections[0].textContent, /本轮第 1 \/ 2 项/)
  assert.doesNotMatch(sections[0].textContent, /3 \/ 31/)
  assert.match(ui.text(), /全部待复习 31 项/)
  await answer(ui)
  await answer(ui)
  assert.match(ui.text(), /本轮 2 项，已作答 2 项/)
})

test('单词页实际保存新词库偏好只影响下一批，不替换当前和剩余题目', async (t) => {
  const api = fixture()
  const ui = await open(t, api, 'words')
  await ui.click('更换新词来源')
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

test('今天页去词库明确展开我的词汇，不只停在折叠入口', async (t) => {
  const api = fixture()
  api.batch = []; api.personal = []; api.dueCount = 0
  const ui = await open(t, api)
  await ui.click('去词库')
  assert.ok(ui.container.querySelector('[aria-label="我的词汇浏览"]'))
  assert.equal(ui.button('我的词汇').getAttribute('aria-expanded'), 'true')
})

test('查个人词汇后再从今天选择词库，最近的明确浏览意图不会被旧入口吞掉', async (t) => {
  const api = fixture()
  api.batch = []; api.personal = []; api.dueCount = 0
  const ui = await open(t, api)
  await ui.click('去词库')
  await ui.click('今日')
  await ui.click('选择词库')
  assert.ok(ui.container.querySelector('[aria-label="主题词库浏览"]'))
  assert.equal(ui.button('主题词库').getAttribute('aria-expanded'), 'true')
})

test('词汇浏览输入与选择框内的数字键不提交学习答案', async (t) => {
  const api = fixture()
  const ui = await open(t, api, 'words')
  await ui.click('我的词汇')
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
    if (command === 'generate.vocab') { api.calls.push({ command, payload }); return pending.promise }
    return original(command, payload)
  }
  const ui = await open(t, api)
  const button = ui.button('继续学习')
  await ui.flush(async () => { button.click(); button.click() })
  assert.equal(api.calls.filter(({ command }) => command === 'generate.vocab').length, 1)
  await ui.flush(async () => pending.resolve({ ok: false, message: '静态补充暂时失败' }))
  assert.match(ui.text(), /静态补充暂时失败/)
  assert.equal(api.calls.some(({ command, payload }) => command === 'generate.vocab' && payload.profile === true), false)
  api.request = original
  api.batch = [card('retry', 'retried', true)]
  await ui.click('继续学习')
  assert.equal(term(ui), 'retried')
})

test('中文输入法和组合快捷键不作答，失败保留当前题且重复点击只提交一次', async (t) => {
  const api = fixture()
  const ui = await open(t, api, 'words')
  await ui.flush(() => {
    for (const options of [{ isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      ui.container.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: '1', bubbles: true, ...options }))
    }
  })
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 0)
  const original = api.request
  const pending = deferred()
  api.request = (command, payload) => {
    if (command === 'review.answer') { api.calls.push({ command, payload }); return pending.promise }
    return original(command, payload)
  }
  const choice = ui.container.querySelector('.ec-choice')
  await ui.flush(() => { choice.click(); choice.click() })
  assert.equal(api.calls.filter(({ command }) => command === 'review.answer').length, 1)
  await ui.flush(() => pending.resolve({ ok: false, message: '作答未保存，请重试' }))
  assert.equal(term(ui), 'overdue')
  assert.match(ui.text(), /作答未保存/)
  assert.equal(ui.container.querySelector('.ec-choice').disabled, false)
  api.request = original
  await ui.click(ui.container.querySelector('.ec-choice'))
  assert.match(ui.text(), /答对了/)
})

test('每批输入越界恢复保存值，合法保存保留未知学习偏好', async (t) => {
  const api = fixture()
  let saved = { wordsPerDay: 3, futurePreference: 'keep' }
  const original = api.request
  api.request = async (command, payload) => {
    if (command === 'settings.get') return { ok: true, data: { study: structuredClone(saved) } }
    if (command === 'settings.save') { api.calls.push({ command, payload }); saved = { ...saved, ...payload.study }; return { ok: true, data: { study: saved } } }
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

test('设置偏好先返回而状态首读仍加载时不崩溃', async (t) => {
  const api = fixture()
  const waiting = deferred()
  const original = api.request
  api.request = (command, payload) => command === 'state.get' ? waiting.promise : original(command, payload)
  const ui = await mountClient({ request: api.request, slot: 'settings.section' })
  t.after(() => ui.close())
  assert.match(ui.text(), /加载中/)
  await ui.flush(() => waiting.resolve({ ok: true, data: { settings: { study: { wordsPerDay: 3 } }, dataRoot: 'isolated-test-root' } }))
  assert.equal(ui.container.querySelector('input[type="number"]').value, '3')
  assert.match(ui.text(), /isolated-test-root/)
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

test('无词库继续学习的画像任务完成后从只读批次取候选，不按目录顺序挑题', async (t) => {
  const api = fixture()
  api.batch = []; api.personal = []; api.dueCount = 0; api.activeWordListId = null
  const original = api.request
  api.request = (command, payload) => command === 'job.status' ? { ok: true, data: { status: 'done' } } : original(command, payload)
  const ui = await open(t, api)
  await ui.click('继续学习')
  api.batch = [card('generated', 'generated-candidate', true)]
  await ui.poll()
  assert.equal(term(ui), 'generated-candidate')
})

for (const entry of ['today', 'overlay']) {
  test(`${entry} 所选词库没有合格静态候选时说明原因且不强制画像回退`, async (t) => {
    const api = fixture()
    api.batch = []
    api.personal = []
    api.dueCount = 0
    api.exhaustion = 'unavailable'
    const ui = await open(t, api, entry)
    await ui.click('继续学习')
    assert.match(ui.text(), /暂不可练/)
    assert.ok(ui.button('选择词库'))
    assert.equal(ui.buttons('按画像补词').length, 0)
    await ui.click('继续学习')
    assert.deepEqual(api.calls.filter(({ command }) => command === 'generate.vocab').map(({ payload }) => payload), [{}, {}])
    assert.doesNotMatch(ui.text(), /正在出词/)
    assert.equal(api.activeWordListId, 'cet4')
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
