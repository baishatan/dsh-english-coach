import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { execute } from '../core/index.js'
import { clientEnvironment, mountClient, deferred } from './client-harness.js'

const now = new Date(2026, 9, 29, 9)
const word = term => ({ term, meaning: '正确释义', choices: ['另一释义', '正确释义', '第三释义', '第四释义'], answerIndex: 1, explanation: '保留已有讲解。' })
const choices = ui => [...ui.container.querySelectorAll('.ec-choice')]
const meaning = node => node.lastElementChild.textContent
const term = ui => ui.container.querySelector('.ec-deck-term,.ec-pop-term')?.textContent
async function fixture(t, terms = ['alpha', 'beta']) {
  const temporary = resolve(tmpdir())
  const root = await fs.mkdtemp(join(temporary, 'coach-effective-ui-'))
  const run = (command, payload = {}) => execute(root, command, payload, { now })
  await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })
  await run('review.add', { items: terms.map(word) })
  const environment = clientEnvironment()
  const clients = [], pending = new Set(), ignored = new Set()
  const api = { run, intercept: null, calls: [], ignored }
  api.open = async () => {
    const number = clients.length
    const ui = await mountClient({ environment, request(command, payload) {
      api.calls.push({ number, command, payload })
      const result = Promise.resolve(api.intercept?.(number, command, payload) ?? run(command === 'generate.vocab' ? 'study.supplement' : command, payload))
      pending.add(result)
      void result.finally(() => pending.delete(result))
      return result
    } })
    clients.push(ui)
    ui.settle = async () => {
      const remaining = () => [...pending].filter(promise => !ignored.has(promise))
      do { await ui.flush(() => Promise.all(remaining())) } while (remaining().length)
    }
    await ui.settle()
    return ui
  }
  t.after(async () => {
    await Promise.all([...pending])
    for (const ui of clients.reverse()) await ui.close()
    assert.equal(dirname(root), temporary)
    assert.ok(root.split('/').at(-1).startsWith('coach-effective-ui-'))
    await fs.rm(root, { recursive: true, force: true })
  })
  return api
}
async function choose(ui, text) {
  await ui.click(choices(ui).find(node => meaning(node) === text))
  await ui.settle()
}

for (const responseKind of ['plain', 'response']) {
  test(`旧显示fixture切换真实保存批次后仍由Host处理下一题（${responseKind}）`, async t => {
    const temporary = resolve(tmpdir())
    const root = await fs.mkdtemp(join(temporary, 'coach-effective-ui-'))
    const run = (command, payload = {}) => execute(root, command, payload, { now })
    assert.equal((await run('profile.save', { goal: 'work', minutesPerDay: 30, interests: [] })).ok, true)
    assert.equal((await run('review.add', { items: ['alpha', 'beta'].map(word) })).ok, true)
    let legacy = true
    const calls = [], pending = new Set()
    const request = (command, payload) => {
      const task = (async () => {
        calls.push({ command, payload })
        const result = await run(command, payload)
        if (command === 'study.batch' && legacy && result.ok) {
          const { round, ...data } = result.data
          return { ...result, data }
        }
        return !legacy && responseKind === 'response' ? Response.json(result) : result
      })()
      pending.add(task)
      task.then(() => pending.delete(task), () => pending.delete(task))
      return task
    }
    const ui = await mountClient({ request })
    ui.settle = async () => { while (pending.size) await ui.flush(() => Promise.all([...pending])) }
    t.after(async () => {
      await ui.close()
      await Promise.all([...pending])
      assert.equal(dirname(root), temporary)
      assert.ok(root.split('/').at(-1).startsWith('coach-effective-ui-'))
      await fs.rm(root, { recursive: true, force: true })
    })
    await ui.settle()
    assert.equal(term(ui), 'alpha')
    let actual = (await run('study.batch')).data
    const current = actual.round.current
    const answer = await run('review.answer', { itemId: current.itemId, choice: 1,
      roundId: actual.round.id, revision: actual.round.revision, presentationId: current.id })
    assert.equal(answer.ok, true)
    legacy = false
    await ui.click('单词'); await ui.settle()
    assert.match(ui.text(), /答对了/)
    await ui.click('下一个'); await ui.settle()
    actual = (await run('study.batch')).data
    const next = calls.filter(call => call.command === 'study.next')
    assert.equal(next.length, 1, '真实下一题请求必须经过Host adapter')
    assert.deepEqual(next[0].payload, { roundId: answer.data.batch.round.id, revision: answer.data.batch.round.revision,
      presentationId: answer.data.batch.round.current.id })
    assert.equal(actual.round.at, 1)
    assert.equal(actual.round.current.itemId, actual.items[1].id)
    assert.equal(term(ui), 'beta')
    assert.deepEqual(actual.round.summary, { total: 2, completed: 1, firstTryCorrect: 1, retryCount: 0 })
  })
}

test('两个独立VM读取同批，另一处完成后导航读取同步，陈旧点击只取已保存有效结果', async t => {
  const api = await fixture(t)
  const a = await api.open(), b = await api.open()
  assert.notEqual(a.container, b.container)
  assert.equal(a.window, b.window, '只共享外部DOM环境；每次mount运行独立VM/factory')
  assert.equal(api.calls.filter(call => call.command === 'study.batch').length, 2, '不是同factory的两个slot')
  await choose(a, '正确释义')
  assert.equal(term(b), 'alpha', '不承诺实时推送')
  await b.click('单词'); await b.settle()
  assert.match(b.text(), /答对了/)
  assert.equal(b.container.querySelectorAll('.ec-dots i[data-on="true"]').length, 1)
  await a.click('下一个'); await a.settle()
  assert.equal(term(a), 'beta')
  await b.click('下一个'); await b.settle()
  assert.equal(term(b), 'beta', '旧next不跳过beta')
  await choose(a, '正确释义')
  await choose(b, '另一释义')
  assert.match(b.text(), /答对了/)
  assert.equal((await api.run('review.list')).data.items.every(item => item.answerCount === 1), true)
  assert.deepEqual((await api.run('study.batch')).data.round.summary, { total: 2, completed: 2, firstTryCorrect: 2, retryCount: 0 })
})

test('未保存通信错误后导航会重读另一VM的正确结果，不要求再次作答', async t => {
  const api = await fixture(t, ['alpha'])
  const a = await api.open(), b = await api.open()
  let fail = true
  api.intercept = (number, command) => number === 0 && command === 'review.answer' && fail
    ? (fail = false, { ok: false, code: 'network', message: '合成未保存通信错误' }) : null
  await choose(a, '正确释义')
  assert.match(a.text(), /合成未保存通信错误/)
  assert.match(a.text(), /已完成 0 \/ 1 项/)
  assert.equal((await api.run('review.list')).data.items[0].answerCount, 0)
  await choose(b, '正确释义')
  const reads = () => api.calls.filter(call => call.number === 0 && call.command === 'study.batch').length
  const before = reads()
  await a.click('单词'); await a.settle()
  assert.equal(reads(), before + 1)
  assert.match(a.text(), /答对了/)
  assert.match(a.text(), /已完成 1 \/ 1 项/)
  assert.doesNotMatch(a.text(), /合成未保存通信错误/)
  assert.equal(choices(a).every(node => node.disabled), true)
  assert.equal(api.calls.filter(call => call.number === 0 && call.command === 'review.answer').length, 1)
  assert.deepEqual((await api.run('study.batch')).data.round.summary, { total: 1, completed: 1, firstTryCorrect: 1, retryCount: 0 })
  assert.equal((await api.run('review.list')).data.items[0].answerCount, 1)
})

test('正确结果已保存但回包丢失，另一VM和原VM导航均读取完成且新VM打开不要求重答', async t => {
  const api = await fixture(t, ['alpha'])
  const a = await api.open(), b = await api.open()
  let lose = true
  api.intercept = (number, command, payload) => number === 0 && command === 'review.answer' && lose ? (async () => {
    lose = false
    const saved = await api.run(command, payload)
    assert.equal(saved.ok, true)
    return { ok: false, code: 'network', message: '合成已保存但回包丢失' }
  })() : null
  await choose(a, '正确释义')
  assert.match(a.text(), /合成已保存但回包丢失/)
  assert.match(a.text(), /已完成 0 \/ 1 项/)
  await b.click('单词'); await b.settle()
  assert.match(b.text(), /答对了/)
  assert.equal(choices(b).every(node => node.disabled), true)
  await a.click('单词'); await a.settle()
  assert.match(a.text(), /答对了/)
  assert.match(a.text(), /已完成 1 \/ 1 项/)
  assert.doesNotMatch(a.text(), /合成已保存但回包丢失/)
  assert.equal(choices(a).every(node => node.disabled), true)
  const reopened = await api.open()
  assert.match(reopened.text(), /答对了/)
  assert.match(reopened.text(), /已完成 1 \/ 1 项/)
  assert.equal(choices(reopened).every(node => node.disabled), true)
  assert.equal(api.calls.filter(call => call.command === 'review.answer').length, 1, '没有靠再次作答取回执才能恢复')
  assert.equal((await api.run('review.list')).data.items[0].answerCount, 1)
})

test('错误后导航重读再次失败保留错误和已有成绩，随后成功读取才同步完成', async t => {
  const api = await fixture(t)
  const a = await api.open(), b = await api.open()
  await choose(a, '正确释义')
  await a.click('下一个'); await a.settle()
  await b.click('单词'); await b.settle()
  let failRead = false
  api.intercept = (number, command) => number !== 0 ? null
    : command === 'review.answer' ? { ok: false, code: 'network', message: '合成作答未保存' }
      : command === 'study.batch' && failRead ? { ok: false, code: 'network', message: '合成同步读取仍失败' } : null
  await choose(a, '正确释义')
  assert.match(a.text(), /合成作答未保存/)
  assert.match(a.text(), /已完成 1 \/ 2 项/)
  await choose(b, '正确释义')
  failRead = true
  const reads = () => api.calls.filter(call => call.number === 0 && call.command === 'study.batch').length
  const before = reads()
  await a.click('单词'); await a.settle()
  assert.equal(reads(), before + 1)
  assert.match(a.text(), /合成同步读取仍失败/)
  assert.match(a.text(), /已完成 1 \/ 2 项/)
  assert.equal(term(a), 'beta')
  assert.doesNotMatch(a.text(), /答对了|这一批学完了/)
  failRead = false
  await a.click('今日'); await a.settle()
  assert.match(a.text(), /答对了/)
  assert.match(a.text(), /已完成 2 \/ 2 项/)
  assert.doesNotMatch(a.text(), /合成同步读取仍失败/)
  assert.equal(choices(a).every(node => node.disabled), true)
  assert.equal(api.calls.filter(call => call.number === 0 && call.command === 'review.answer').length, 2)
  assert.equal((await api.run('review.list')).data.items.every(item => item.answerCount === 1), true)
})

test('保存成功响应丢失可同呈现重试，旧成功响应迟到不能覆盖另一VM更新后的反馈', async t => {
  const api = await fixture(t)
  const a = await api.open(), b = await api.open()
  let lose = true
  api.intercept = (number, command, payload) => number === 0 && command === 'review.answer' && lose ? (async () => {
    lose = false
    const saved = await api.run(command, payload)
    assert.equal(saved.ok, true)
    return { ok: false, code: 'network_error', message: '合成响应丢失，请重试' }
  })() : null
  await choose(a, '正确释义')
  assert.match(a.text(), /合成响应丢失/)
  await choose(a, '另一释义')
  assert.match(a.text(), /答对了/)
  assert.equal(choices(a).find(node => meaning(node) === '正确释义').getAttribute('data-state'), 'right')
  assert.equal((await api.run('review.list')).data.items.find(item => item.term === 'alpha').answerCount, 1)
  await b.click('单词'); await b.settle()
  await b.click('下一个'); await b.settle()
  await a.click('单词'); await a.settle()
  const delayed = deferred()
  api.ignored.add(delayed.promise)
  let late
  api.intercept = (number, command, payload) => number === 0 && command === 'review.answer' ? (late = api.run(command, payload), delayed.promise) : null
  await a.click(choices(a).find(node => meaning(node) === '另一释义'))
  const savedWrong = await late
  assert.equal(savedWrong.ok, true)
  await b.click('今日'); await b.settle()
  assert.match(b.text(), /答错了/)
  await b.click('下一个'); await b.settle()
  await choose(b, '正确释义')
  await a.click('今日'); await a.settle()
  assert.match(a.text(), /答对了/)
  const before = choices(a).map(node => node.getAttribute('data-state'))
  await a.flush(() => delayed.resolve(savedWrong)); await a.settle()
  assert.match(a.text(), /答对了/)
  assert.deepEqual(choices(a).map(node => node.getAttribute('data-state')), before)
  assert.equal(term(a), 'beta')
  assert.deepEqual((await api.run('study.batch')).data.round.summary, { total: 2, completed: 2, firstTryCorrect: 1, retryCount: 1 })
})

test('迟到失败不能清除新读取的正确反馈或重新开放已完成词', async t => {
  const api = await fixture(t, ['alpha'])
  const a = await api.open(), b = await api.open()
  const delayed = deferred()
  api.ignored.add(delayed.promise)
  api.intercept = (number, command) => number === 0 && command === 'review.answer' ? delayed.promise : null
  await a.click(choices(a).find(node => meaning(node) === '另一释义'))
  await choose(b, '正确释义')
  await a.click('单词'); await a.settle()
  assert.match(a.text(), /答对了/)
  await a.flush(() => delayed.resolve({ ok: false, message: '旧请求未保存' })); await a.settle()
  assert.match(a.text(), /答对了/)
  assert.equal(choices(a).every(node => node.disabled), true)
  assert.equal((await api.run('review.list')).data.items[0].answerCount, 1)
})
