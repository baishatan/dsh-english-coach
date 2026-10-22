import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

// Use an existing test environment (NODE_PATH); do not install a second React in the plugin.
const require = createRequire(import.meta.url)
const { JSDOM } = require('jsdom')
const React = require('react')
const { act } = React
let createRoot

export async function mountClient({ request, slot = 'main', setupWindow, layout } = {}) {
  const dom = new JSDOM('<!doctype html><div id="test-root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const previous = new Map()
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
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
    fetch: async (url, options) => ({ ok: true, json: async () => request(url.split('/').at(-1), JSON.parse(options.body)) }),
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
  const entry = registrations.find(({ options }) => options.name === slot)
  assert.ok(entry, `Missing registered UI slot: ${slot}`)
  const container = dom.window.document.getElementById('test-root')
  const root = createRoot(container)
  await act(async () => root.render(React.createElement(entry.Component)))
  const ui = {
    window: dom.window, container,
    text: () => { const visible = container.cloneNode(true); visible.querySelectorAll('style,script').forEach((node) => node.remove()); return visible.textContent },
    buttons: (text) => [...container.querySelectorAll('button')].filter((button) => button.textContent.trim() === text),
    button(text) { const matches = this.buttons(text); assert.equal(matches.length, 1, `Expected one visible button: ${text}`); return matches[0] },
    field(label) {
      const field = [...container.querySelectorAll('input,select,textarea')].find((node) => node.getAttribute('aria-label') === label || [...node.labels ?? []].some((item) => item.textContent === label))
      assert.ok(field, `Missing labelled field: ${label}`)
      return field
    },
    async click(target) { const node = typeof target === 'string' ? this.button(target) : target; await act(async () => node.click()) },
    async input(label, value) {
      const node = typeof label === 'string' ? this.field(label) : label
      const prototype = node.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
      await act(async () => {
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, String(value))
        node.dispatchEvent(new dom.window.Event(node.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
      })
    },
    async key(node, key) { await act(async () => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }))) },
    async poll() { await act(async () => { for (const { callback } of [...intervals.values()]) callback() }) },
    async flush(callback = () => {}) { await act(callback) },
    async close() {
      await act(async () => root.unmount())
      dom.window.close()
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
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
