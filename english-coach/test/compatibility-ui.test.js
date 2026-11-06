import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import { mountClient } from './client-harness.js'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('兼容声明只接受已核对的 DSH 0.2.2-rc.1，保留 Node 24 运行边界', () => {
  assert.equal(manifest.engines.dsh, '0.2.2-rc.1')
  assert.equal(manifest.engines.node, '>=24.21.0 <25')
})

test('客户端等待 0.2.2-rc.1 槽位声明，并注册一致的面板、设置与悬浮入口', async () => {
  let plugin
  vm.runInNewContext(await readFile(new URL('../client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load({ id, factory }) {
      assert.equal(id, manifest.name)
      plugin = factory(name => {
        assert.equal(name, 'react', 'Use the Host React identity, not a bundled copy')
        return { createElement() {} }
      })
    } } }
  })
  const waiting = new Map(), registrations = new Map()
  const kinds = new Map([
    ['main', 'keyed'], ['sidebar.panellist', 'list'],
    ['settings.section', 'list'], ['shell.overlay', 'list']
  ])
  plugin.apply({
    slots: {
      inject(name, callback) {
        assert.ok(kinds.has(name), `Unknown 0.2.2-rc.1 slot: ${name}`)
        assert.ok(!waiting.has(name), `Duplicate slot wait: ${name}`)
        waiting.set(name, callback)
      },
      register(options, Component) {
        assert.equal(typeof Component, 'function')
        const identity = kinds.get(options.name) === 'keyed' ? options.key : options.id
        assert.equal(identity, 'english-coach')
        if (options.name !== 'main' && options.name !== 'shell.overlay') assert.equal(options.label(), '英语教练')
        registrations.set(options.name, options)
        return () => registrations.delete(options.name)
      }
    }
  })
  assert.equal(registrations.size, 0, 'Do not register before the Host declares the slots')
  const disposers = [...waiting.values()].reverse().map(callback => callback())
  assert.equal(registrations.size, 4)
  for (const dispose of disposers) { assert.equal(typeof dispose, 'function'); dispose() }
  assert.equal(registrations.size, 0, 'Each contribution returns its lifecycle disposer')
})

function request(command) {
  if (command === 'state.get') return { ok: true, data: {
    onboarded: true, now: '2026-10-26', profile: { goal: 'work', interests: [] },
    settings: { study: { wordsPerDay: 3 } }, review: { dueCount: 0 }, streak: { current: 0 }
  } }
  if (command === 'review.list' || command === 'study.batch') return { ok: true, data: { items: [], dueCount: 0, batchSize: 3 } }
  if (command === 'settings.get') return { ok: true, data: { study: { wordsPerDay: 3 } } }
  if (command === 'wordlists.list') return { ok: true, data: { lists: [] } }
  throw new Error(`Unexpected Host request: ${command}`)
}

test('悬浮入口通过 layout.selectPanel 打开已注册主页，并可转到词库', async t => {
  const selected = []
  const ui = await mountClient({ request, slot: ['main', 'shell.overlay'], layout: {
    selectPanel(id) {
      assert.equal(id, 'english-coach', '0.2.2-rc.1 requires an existing main-slot key')
      selected.push(id)
    }
  } })
  t.after(() => ui.close())
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.click('打开主页')
  assert.deepEqual(selected, ['english-coach'])
  assert.equal(ui.container.querySelector('.ec-pop'), null)
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.click([...ui.container.querySelector('.ec-pop').querySelectorAll('button')].find(button => button.textContent.trim() === '选择词库'))
  assert.equal(selected.length, 2)
  assert.equal(ui.container.querySelector('.ec-pop'), null)
  assert.ok(ui.field('浏览词库'), 'The public overlay action opens the vocabulary view')
})

test('宿主面板暂不可用时，悬浮入口仍能关闭而不产生学习写入', async t => {
  const calls = []
  const ui = await mountClient({ request: command => { calls.push(command); return request(command) }, slot: 'shell.overlay', layout: {
    selectPanel() { throw new Error('main panel is not registered') }
  } })
  t.after(() => ui.close())
  await ui.click(ui.container.querySelector('.ec-pill-btn'))
  await ui.click('打开主页')
  assert.equal(ui.container.querySelector('.ec-pop'), null)
  assert.ok(calls.every(command => ['state.get', 'study.batch'].includes(command)))
})

test('主面板使用 0.2.2-rc.1 macOS 顶部避让变量，不给设置和悬浮层重复加顶距', async t => {
  const ui = await mountClient({ request, setupWindow: window => {
    window.document.documentElement.dataset.platform = 'darwin'
    window.document.documentElement.style.setProperty('--dsh-frame-top-clearance', '48px')
  } })
  t.after(() => ui.close())
  const rules = [...ui.container.querySelector('style').sheet.cssRules]
  const chromeRule = rules.find(rule => rule.selectorText?.includes('[data-platform="darwin"]') && rule.selectorText.includes('.ec-wrap'))
  assert.ok(chromeRule, 'The main panel must opt into the desktop chrome contract')
  assert.match(chromeRule.style.getPropertyValue('padding-top'), /var\(--dsh-frame-top-clearance,\s*0px\)/)
  assert.ok(!chromeRule.selectorText.includes('.ec-settings'))
  assert.ok(!chromeRule.selectorText.includes('.ec-overlay-layer'))
  assert.ok(ui.button('今日'))
})
