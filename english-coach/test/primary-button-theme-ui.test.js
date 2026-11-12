import test from 'node:test'
import assert from 'node:assert/strict'
import { mountClient, clientEnvironment, deferred } from './client-harness.js'

// Fixed external theme fixtures, not a parallel theme implementation. The default
// values are resolved from @deepseek-ai/dsh-client-ui-theme@0.2.2-rc.1's
// design-platform.css. Animal Island values are from the published 0.3.38
// https://unpkg.com/dsh-theme-animal-island-ui@0.3.38/lib/tokens.js (2026-11-11).
// These fixtures do not certify arbitrary theme overrides or Windows rendering.
const themes = [
  { name: 'default light 0.2.2-rc.1', dark: false, fill: '#0f1115', hover: '#43454a', ink: '#ffffff', page: '#ffffff', surface: '#ffffff', secondary: '#ffffff', label: '#0f1115', brand: '#0f1115' },
  { name: 'default dark 0.2.2-rc.1', dark: true, fill: '#f9fafb', hover: '#ebeef2', ink: '#0f1115', page: '#151517', surface: '#232324', secondary: '#2c2c2e', label: '#f9fafb', brand: '#f9fafb' },
  { name: 'Animal Island light 0.3.38', dark: false, fill: '#f8f8f0', hover: '#fffbe7', ink: '#2a2118', page: '#f8f8f0', surface: '#ffffff', secondary: '#f7f3df', label: '#6f451f', brand: '#19c8b9' },
  { name: 'Animal Island dark 0.3.38', dark: true, fill: '#4a4035', hover: '#5a4d3e', ink: '#fffbe7', page: '#29231c', surface: '#362e25', secondary: '#2d2923', label: '#f7e7c7', brand: '#61d9cb' }
]

function applyTheme(window, theme) {
  const { body } = window.document
  body.toggleAttribute('data-ds-dark-theme', theme.dark)
  for (const [name, value] of Object.entries({
    '--dsw-alias-button-primary-fill': theme.fill,
    '--dsw-alias-button-primary-hover': theme.hover,
    '--dsw-alias-label-primary-foreground': theme.ink,
    '--dsw-alias-brand-primary': theme.brand,
    '--dsw-alias-bg-base': theme.page,
    '--dsw-alias-bg-layer-1': theme.surface,
    '--dsw-alias-bg-layer-2': theme.secondary,
    '--dsw-alias-label-primary': theme.label,
    '--dsw-alias-label-secondary': theme.label,
    '--dsw-alias-border-l1': '#808080',
    '--dsw-alias-border-l2': '#808080'
  })) body.style.setProperty(name, value)
}

function host() {
  const api = {
    generated: 0,
    generate: async () => ({ ok: false, message: '合成生成失败，可重试' }),
    request: async command => {
      if (command === 'state.get') return { ok: true, data: {
        onboarded: true, today: '2026-11-11', now: '2026-11-11T08:00:00Z',
        profile: { goal: 'work', minutesPerDay: 30, goalNote: '合成学习目标', interests: [] }, settings: { study: { wordsPerDay: 3 } },
        review: { dueCount: 0 }, streak: { current: 0 }
      } }
      if (command === 'review.list' || command === 'study.batch') return { ok: true, data: { items: [], dueCount: 0 } }
      if (command === 'job.status') return { ok: true, data: null }
      if (command === 'progress.get') return { ok: true, data: { completions: [], streak: { current: 0, best: 0 }, mastered: 0, learning: 0, curve: [] } }
      if (command === 'speech.preferences.get') return { ok: true, data: { provider: 'web-speech', rate: 1 } }
      if (command === 'generate') { api.generated++; return api.generate() }
      throw Error(`Unexpected synthetic Host request: ${command}`)
    }
  }
  return api
}

async function open(t, theme, missing = []) {
  const api = host()
  const ui = await mountClient({ request: api.request, setupWindow: window => {
    applyTheme(window, theme)
    for (const name of missing) window.document.body.style.removeProperty(name)
  } })
  t.after(() => ui.close())
  return { ui, api }
}

// jsdom 29 exposes selected CSS declarations but does not substitute var().
// Resolve only those declarations through its computed custom properties; this
// does not read Client source, predict its selectors, or replace its CSS cascade.
// A rendering browser is still required for layout/antialiasing/visual acceptance.
function resolved(style, value) {
  for (let depth = 0; value.includes('var(') && depth < 12; depth++) {
    const next = value.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, name, fallback) => style.getPropertyValue(name).trim() || fallback || '')
    assert.notEqual(next, value, `Unresolved CSS declaration: ${value}`)
    value = next
  }
  assert.ok(value.trim(), 'Visible control must have a resolved colour')
  return value.trim()
}
function appearance(ui, node) {
  const style = ui.window.getComputedStyle(node)
  return { style, fill: resolved(style, style.background || style.backgroundColor), ink: resolved(style, style.color) }
}
function rgb(value) {
  if (value.startsWith('#')) {
    const hex = value.slice(1)
    assert.equal(hex.length, 6, `Expected opaque fixture colour: ${value}`)
    return [0, 2, 4].map(index => Number.parseInt(hex.slice(index, index + 2), 16))
  }
  const match = value.match(/^rgb\((\d+), (\d+), (\d+)\)$/)
  assert.ok(match, `Expected opaque rendered colour: ${value}`)
  return match.slice(1).map(Number)
}
function contrast(a, b) {
  const luminance = value => rgb(value).map(channel => {
    const s = channel / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const left = luminance(a), right = luminance(b)
  return (Math.max(left, right) + 0.05) / (Math.min(left, right) + 0.05)
}
function sameColour(actual, expected, message) { assert.deepEqual(rgb(actual), rgb(expected), message) }
function buttonBorder(ui, button, style) {
  // jsdom also loses var() border-colour shorthands when expanding to longhands.
  // Observe the matching rendered CSSOM declaration for this one unsupported
  // property, not source text; selectors still must match the visible button.
  const rules = [...ui.window.document.styleSheets].flatMap(sheet => [...sheet.cssRules])
  const rule = rules.filter(rule => rule.selectorText && button.matches(rule.selectorText) && rule.style.getPropertyValue('border-color')).at(-1)
  return resolved(style, rule?.style.getPropertyValue('border-color') || style.borderTopColor)
}

// Approved seams: the real Client's visible controls, external theme tokens and
// synthetic Host transport. No private Client/component exports are introduced.
test('主按钮在默认和动森浅深主题使用配套前景/背景，可操作小文字达到4.5:1', async t => {
  for (const theme of themes) await t.test(theme.name, async t => {
    const { ui, api } = await open(t, theme)
    const generate = ui.button('生成今天')
    assert.equal(generate.disabled, false)
    const { fill, ink, style } = appearance(ui, generate)
    assert.ok(Number.parseFloat(style.fontSize) < 18, 'Button label is not large text; use the 4.5:1 threshold')
    sameColour(fill, theme.fill, 'Use the semantic primary fill, not the brand accent')
    sameColour(ink, theme.ink, 'Use the foreground paired with the primary fill, not the page background')
    assert.ok(contrast(fill, ink) >= 4.5, `${theme.name}: ${contrast(fill, ink).toFixed(4)}:1`)
    await ui.click(generate)
    assert.equal(api.generated, 1)
    assert.match(ui.text(), /合成生成失败，可重试/)
  })
})

test('悬停仍使用同一配套文字与主题悬停底色，不对整颗按钮套亮度滤镜', async t => {
  for (const theme of themes) await t.test(theme.name, async t => {
    const { ui } = await open(t, theme)
    const generate = ui.button('生成今天')
    generate.dispatchEvent(new ui.window.MouseEvent('mouseover', { bubbles: true }))
    // jsdom caches styles across pointer/focus changes; a harmless external DOM
    // invalidation makes its next computed-style read observe the pseudo-state.
    ui.window.document.body.toggleAttribute('data-fixture-pointer')
    assert.equal(generate.matches(':hover'), true)
    const { fill, ink, style } = appearance(ui, generate)
    sameColour(fill, theme.hover)
    sameColour(ink, theme.ink)
    assert.ok(contrast(fill, ink) >= 4.5, `${theme.name} hover: ${contrast(fill, ink).toFixed(4)}:1`)
    assert.ok(!style.filter || style.filter === 'none', 'Keep foreground/background colours unfiltered')
  })
})

test('任一按钮语义token缺失时整组回退，不混用主题前景与后备背景', async t => {
  const tokens = ['--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover', '--dsw-alias-label-primary-foreground']
  for (const missing of [...tokens.map(name => [name]), tokens]) await t.test(missing.join(', '), async t => {
    const { ui } = await open(t, themes[3], missing)
    const generate = ui.button('生成今天')
    const normal = appearance(ui, generate)
    sameColour(normal.fill, '#0f1115')
    sameColour(normal.ink, '#ffffff')
    assert.ok(contrast(normal.fill, normal.ink) >= 4.5)
    generate.dispatchEvent(new ui.window.MouseEvent('mouseover', { bubbles: true }))
    ui.window.document.body.toggleAttribute('data-fixture-pointer')
    const hover = appearance(ui, generate)
    sameColour(hover.fill, '#43454a')
    sameColour(hover.ink, '#ffffff')
    assert.ok(contrast(hover.fill, hover.ink) >= 4.5)
  })
})

test('可见主按钮键盘聚焦时有清楚且不改变文字对比的焦点环', async t => {
  for (const theme of themes) await t.test(theme.name, async t => {
    const { ui } = await open(t, theme)
    const generate = ui.button('生成今天')
    generate.focus()
    ui.window.document.body.toggleAttribute('data-fixture-focus')
    assert.equal(ui.window.document.activeElement, generate)
    assert.equal(generate.matches(':focus-visible'), true)
    const { fill, ink, style } = appearance(ui, generate)
    const ring = resolved(style, style.outline)
    const match = ring.match(/^(\d+)px solid (.+)$/)
    assert.ok(match, `Expected an explicit visible solid focus ring: ${ring}`)
    assert.ok(Number(match[1]) >= 2)
    assert.ok(Number.parseFloat(style.outlineOffset) >= 2)
    assert.ok(contrast(match[2], theme.surface) >= 3, 'Focus indicator must stand out from the surrounding card')
    assert.ok(contrast(fill, ink) >= 4.5)
  })
})

test('纸面色主按钮仍有清晰边界和主次层级，不与次操作混成同一外观', async t => {
  for (const theme of themes) await t.test(theme.name, async t => {
    const { ui } = await open(t, theme)
    const button = ui.button('生成今天')
    const primary = appearance(ui, button)
    const secondary = ui.window.getComputedStyle(ui.button('看进度'))
    const border = buttonBorder(ui, button, primary.style)
    assert.equal(primary.style.borderTopStyle, 'solid')
    assert.ok(Number.parseFloat(primary.style.borderTopWidth) >= 1)
    assert.ok(contrast(border, theme.surface) >= 3, 'Primary action has a discernible boundary on the surrounding card')
    assert.ok(Number(primary.style.fontWeight) >= 600, 'Primary label retains stronger emphasis than secondary text')
    assert.notEqual(primary.style.fontWeight, secondary.fontWeight)
  })
})

test('页面保持打开时主题和浅深来回切换，含token移除恢复，不重挂控制也不丢焦点', async t => {
  const { ui } = await open(t, themes[0])
  const generate = ui.button('生成今天')
  generate.focus()
  for (const theme of [themes[2], themes[3], themes[1], themes[0]]) {
    await ui.flush(() => applyTheme(ui.window, theme))
    assert.equal(ui.button('生成今天'), generate)
    assert.equal(ui.window.document.activeElement, generate)
    const normal = appearance(ui, generate)
    sameColour(normal.fill, theme.fill)
    sameColour(normal.ink, theme.ink)
    assert.ok(contrast(normal.fill, normal.ink) >= 4.5)
  }
  await ui.flush(() => ui.window.document.body.style.removeProperty('--dsw-alias-label-primary-foreground'))
  sameColour(appearance(ui, generate).fill, '#0f1115')
  sameColour(appearance(ui, generate).ink, '#ffffff')
  await ui.flush(() => applyTheme(ui.window, themes[3]))
  sameColour(appearance(ui, generate).fill, themes[3].fill)
  sameColour(appearance(ui, generate).ink, themes[3].ink)
  assert.equal(ui.window.document.activeElement, generate)
})

test('主题切换时忙主按钮仍原生disabled，鼠标和键盘不会重复触发，失败后可再试', async t => {
  for (const theme of themes) await t.test(theme.name, async t => {
    const { ui, api } = await open(t, theme)
    const pending = deferred()
    api.generate = () => pending.promise
    const generate = ui.button('生成今天')
    const enabled = appearance(ui, generate)
    await ui.click(generate)
    assert.equal(generate.disabled, true)
    assert.equal(generate.matches(':disabled'), true)
    const disabled = appearance(ui, generate)
    assert.ok(Number(disabled.style.opacity) < Number(enabled.style.opacity || 1), 'Disabled appearance must differ from the operable control')
    await ui.flush(() => applyTheme(ui.window, themes[3]))
    await ui.click(generate)
    await ui.key(generate, 'Enter')
    await ui.key(generate, ' ')
    await ui.click(generate)
    assert.equal(api.generated, 1)
    generate.dispatchEvent(new ui.window.MouseEvent('mouseover', { bubbles: true }))
    ui.window.document.body.toggleAttribute('data-fixture-pointer')
    sameColour(appearance(ui, generate).fill, themes[3].fill, 'Disabled hover must not get the active hover fill')
    await ui.flush(() => pending.resolve({ ok: false, message: '合成生成失败，可重试' }))
    assert.equal(generate.disabled, false)
    assert.match(ui.text(), /合成生成失败，可重试/)
    api.generate = async () => ({ ok: false, message: '重试已提交' })
    await ui.click(generate)
    assert.equal(api.generated, 2)
    assert.match(ui.text(), /重试已提交/)
  })
})

test('320px合成窄面板保持主按钮标签和操作，主题切换不隐藏控制', async t => {
  const { ui, api } = await open(t, themes[2])
  Object.defineProperty(ui.window, 'innerWidth', { configurable: true, value: 320 })
  ui.container.style.width = '320px'
  const generate = ui.button('生成今天')
  await ui.flush(() => ui.window.dispatchEvent(new ui.window.Event('resize')))
  await ui.flush(() => applyTheme(ui.window, themes[3]))
  assert.equal(generate.textContent.trim(), '生成今天')
  assert.equal(generate.closest('[hidden]'), null)
  const { style, fill, ink } = appearance(ui, generate)
  assert.notEqual(style.display, 'none')
  assert.notEqual(style.visibility, 'hidden')
  assert.ok(contrast(fill, ink) >= 4.5)
  await ui.click(generate)
  assert.equal(api.generated, 1)
  // jsdom has no layout engine: actual clipping/wrapping is a real-browser check.
})

test('外部主题样式表加载完成后从缺token的后备整组恢复，不需要重开面板', async t => {
  const { ui } = await open(t, themes[2], ['--dsw-alias-label-primary-foreground'])
  const generate = ui.button('生成今天')
  const sheet = ui.window.document.createElement('style')
  await ui.flush(() => ui.window.document.head.append(sheet))
  sameColour(appearance(ui, generate).fill, '#0f1115')
  // A delayed stylesheet can become available without a DOM text mutation.
  // Supply only external CSS and its load event; do not reach into the Client.
  await ui.flush(() => {
    sheet.sheet.insertRule('body { --dsw-alias-label-primary-foreground: #2a2118; }')
    ui.window.document.body.toggleAttribute('data-fixture-css-cache')
    sheet.dispatchEvent(new ui.window.Event('load'))
  })
  sameColour(appearance(ui, generate).fill, themes[2].fill)
  sameColour(appearance(ui, generate).ink, themes[2].ink)
  assert.equal(ui.button('生成今天'), generate)
})

test('主面板和悬浮层同时打开及分开卸载后，剩余主按钮仍跟随主题', async t => {
  const environment = clientEnvironment()
  const api = host()
  applyTheme(environment.dom.window, themes[2])
  const main = await mountClient({ request: api.request, environment })
  const overlay = await mountClient({ request: api.request, environment, slot: 'shell.overlay' })
  t.after(async () => { await main.close(); await overlay.close() })
  await overlay.click(overlay.container.querySelector('.ec-pill-btn'))
  const generate = main.button('生成今天')
  const next = overlay.button('继续学习')
  await main.flush(() => applyTheme(main.window, themes[3]))
  for (const [ui, button] of [[main, generate], [overlay, next]]) {
    sameColour(appearance(ui, button).fill, themes[3].fill)
    sameColour(appearance(ui, button).ink, themes[3].ink)
  }
  await main.close()
  await overlay.flush(() => applyTheme(overlay.window, themes[0]))
  sameColour(appearance(overlay, next).fill, themes[0].fill)
  sameColour(appearance(overlay, next).ink, themes[0].ink)
  assert.equal(overlay.button('继续学习'), next)
})

test('未修改个人目标时主保存按钮是真禁用，修改后恢复可操作颜色和语义', async t => {
  const { ui } = await open(t, themes[2])
  await ui.click('个人')
  await ui.click('编辑个人目标')
  const save = ui.button('保存')
  assert.equal(save.disabled, true)
  assert.equal(save.matches(':disabled'), true)
  await ui.click(save)
  await ui.key(save, 'Enter')
  await ui.key(save, ' ')
  await ui.input('为什么学英语', '另一个合成目标')
  assert.equal(save.disabled, false)
  const { fill, ink } = appearance(ui, save)
  sameColour(fill, themes[2].fill)
  sameColour(ink, themes[2].ink)
  assert.ok(contrast(fill, ink) >= 4.5)
})

test('个人页主按钮焦点不被页面通用品牌色规则覆盖', async t => {
  const { ui } = await open(t, themes[2])
  await ui.click('个人')
  await ui.click('编辑个人目标')
  await ui.input('为什么学英语', '焦点验证的合成目标')
  const save = ui.button('保存')
  // The preceding click put jsdom into pointer modality; mark the next input as
  // keyboard before moving focus to this enabled native button.
  await ui.key(ui.window.document.body, 'Tab')
  save.focus()
  ui.window.document.body.toggleAttribute('data-fixture-focus')
  assert.equal(save.matches(':focus-visible'), true)
  const style = ui.window.getComputedStyle(save)
  const ring = resolved(style, style.outline)
  const match = ring.match(/^(\d+)px solid (.+)$/)
  assert.ok(match)
  assert.ok(contrast(match[2], themes[2].surface) >= 3, 'Page-level brand focus rule must not hide the primary focus ring')
})
