import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

// Resolve pinned repository devDependencies. Extracted-package audits provide
// only this repository's node_modules through NODE_PATH; no sibling checkout.
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
let createRoot
const environments = []
let originalGlobals

// Compatibility lives only at the external Host seam: older display fixtures
// supply candidates and feedback, while production always supplies a saved round.
// Recovery tests use real execute and pass through this Adapter unchanged.
function fixtureHost(request) {
  let batch = null, serial = 0, awaitingGeneration = false, realRound = false
  const attempts = new Map()
  const snapshot = () => structuredClone(batch)
  const begin = data => {
    attempts.clear()
    const revision = (batch?.round.revision ?? 0) + 1
    const id = `fixture-round-${++serial}`
    batch = { ...structuredClone(data), round: { id, revision, status: data.items.length ? 'active' : 'empty', at: 0,
      current: data.items.length ? { id: `${id}:1`, itemId: data.items[0].id, choiceOrder: [0, 1, 2, 3], picked: null, feedback: null } : null,
      summary: { total: data.items.length, completed: 0, firstTryCorrect: 0, retryCount: 0 } } }
  }
  return async (command, payload, options) => {
    if (command === 'study.next' && batch) {
      const round = batch.round, current = round.current
      if (current.feedback.correct) round.at++
      else {
        const [item] = batch.items.splice(round.at, 1)
        const order = [1, 2, 3, 0]
        batch.items.push({ ...item, choices: order.map(i => item.choices[i]), answerIndex: order.indexOf(item.answerIndex), choiceOrder: order.map(i => item.choiceOrder?.[i] ?? i) })
      }
      round.revision++
      const item = batch.items[round.at]
      round.current = item ? { id: `${round.id}:${round.revision}`, itemId: item.id, choiceOrder: item.choiceOrder ?? [0, 1, 2, 3], picked: null, feedback: null } : null
      if (!item) round.status = 'completed'
      return { ok: true, data: snapshot() }
    }
    const result = await request(command, payload, options)
    const response = result && typeof result.arrayBuffer === 'function' && typeof result.json === 'function'
    // An external Host may replace an old display fixture with a real saved
    // batch. Inspect only a clone of JSON batch responses, never binary audio.
    if (command === 'study.batch') {
      let body = result
      if (response && result.ok && typeof result.clone === 'function') {
        try { body = await result.clone().json() } catch { body = null }
      }
      if (body?.ok && body.data?.round) {
        realRound = true
        batch = null
        attempts.clear()
        awaitingGeneration = false
      }
    }
    if (!result?.ok || response || realRound) return result
    if (command === 'generate.vocab' && result.data.mode === 'generated') awaitingGeneration = true
    if (['study.batch', 'study.supplement', 'generate.vocab'].includes(command) && Array.isArray(result.data?.items) && !result.data.round) {
      if (!batch || command !== 'study.batch' || awaitingGeneration) { begin(result.data); awaitingGeneration = false }
      return { ...result, data: snapshot() }
    }
    if (command === 'review.answer' && batch && !result.data.batch) {
      const { round } = batch
      const count = attempts.get(payload.itemId) ?? 0
      attempts.set(payload.itemId, count + 1)
      if (count) round.summary.retryCount++
      else if (result.data.correct) round.summary.firstTryCorrect++
      if (result.data.correct) round.summary.completed++
      round.revision++
      round.current.picked = round.current.choiceOrder.indexOf(payload.choice)
      round.current.feedback = { correct: result.data.correct, explanation: result.data.explanation }
      const item = batch.items[round.at]
      for (const key of ['box', 'fresh', 'status', 'dueAt']) if (result.data[key] !== undefined) item[key] = result.data[key]
      if (result.data.dueCount !== undefined) batch.dueCount = result.data.dueCount
      return { ...result, data: { ...result.data, batch: snapshot() } }
    }
    return result
  }
}

// Multiple independent VM/factories can share this one external DOM environment.
// React DOM then never observes another mount replacing its global window.
export function clientEnvironment() {
  return { dom: new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true }), mounts: 0 }
}

export async function mountClient({ request, slot = 'main', setupWindow, layout, environment = clientEnvironment() } = {}) {
  const hostRequest = fixtureHost(request)
  const { dom } = environment
  if (!environment.mounts++) {
    environment.globals = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
    if (!environments.length) originalGlobals = new Map(Object.keys(environment.globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
    environments.push(environment)
    for (const [key, value] of Object.entries(environment.globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  // React DOM detects browser input support at import time, after the DOM exists.
  createRoot ??= require('react-dom/client').createRoot
  setupWindow?.(dom.window)
  const registrations = []
  const intervals = new Map()
  let timerId = 0
  let plugin
  dom.window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(require) } }
  const context = vm.createContext({
    window: dom.window, document: dom.window.document, console,
    fetch: async (url, options) => {
      const value = await hostRequest(url.split('/').at(-1), JSON.parse(options.body), options)
      // The transport adapter can return a real binary/error Response, not just
      // JSON. Existing fixtures keep their ordinary result objects.
      return value && typeof value.arrayBuffer === 'function' && typeof value.json === 'function'
        ? value : { ok: true, json: async () => value }
    },
    setTimeout, clearTimeout,
    setInterval: (callback, delay) => { intervals.set(++timerId, { callback, delay }); return timerId },
    clearInterval: (id) => intervals.delete(id)
  })
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  vm.runInContext(source, context)
  plugin.apply({
    get: () => layout,
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, Component) => { registrations.push({ options, Component }); return () => {} }
    }
  })
  const slots = Array.isArray(slot) ? slot : [slot]
  const entries = slots.map(name => {
    const entry = registrations.find(({ options }) => options.name === name)
    assert.ok(entry, `Missing registered UI slot: ${name}`)
    return entry
  })
  const container = dom.window.document.createElement('div')
  dom.window.document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(Array.isArray(slot)
    ? React.createElement(React.Fragment, null, ...entries.map(({ options, Component }) => React.createElement('div', { key: options.name, 'data-test-slot': options.name }, React.createElement(Component))))
    : React.createElement(entries[0].Component)))
  let closed = false
  const ui = {
    window: dom.window, container,
    text: () => { const visible = container.cloneNode(true); visible.querySelectorAll('style,script').forEach((node) => node.remove()); return visible.textContent },
    buttons: (text) => [...container.querySelectorAll('button')].filter((button) => {
      if (button.closest('[hidden]')) return false
      const content = button.cloneNode(true)
      content.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove())
      return (button.getAttribute('aria-label') ?? content.textContent).trim() === text
    }),
    button(text) { const matches = this.buttons(text); assert.equal(matches.length, 1, `Expected one visible button: ${text}`); return matches[0] },
    field(label) {
      const field = [...container.querySelectorAll('input,select,textarea')].find((node) => node.getAttribute('aria-label') === label || [...node.labels ?? []].some((item) => item.textContent === label))
      assert.ok(field, `Missing labelled field: ${label}`)
      return field
    },
    async click(target) { const node = typeof target === 'string' ? this.button(target) : target; await act(async () => node.click()) },
    async input(label, value) {
      const node = typeof label === 'string' ? this.field(label) : label
      const prototype = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype
        : node.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, String(value))
        node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      })
    },
    async key(node, key) { await act(async () => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }))) },
    async poll() { await act(async () => { for (const { callback } of [...intervals.values()]) callback() }) },
    async flush(callback = () => {}) { await act(callback) },
    async close() {
      if (closed) return
      closed = true
      await act(async () => root.unmount())
      container.remove()
      if (!--environment.mounts) {
        dom.window.close()
        environments.splice(environments.indexOf(environment), 1)
        if (environments.length) {
          for (const [key, value] of Object.entries(environments.at(-1).globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
        } else {
          for (const [key, descriptor] of originalGlobals) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor)
            else delete globalThis[key]
          }
          originalGlobals = null
        }
      }
    }
  }
  return ui
}

export function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
