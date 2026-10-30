import out from './out/index.js'
import { normalize, getByPointer, isArray } from './lib/_lib.js'
import byDepth from './crawl/crawl.js'
import { cacheDown, cacheUp } from './crawl/cache.js'
import fillDown from './crawl/fillDown.js'
import validate from './input/_validate.js'

class View {
  constructor(json = validate({})) {
    Object.defineProperty(this, 'json', {
      enumerable: false,
      value: json,
      writable: true,
    })
  }
  get children() {
    return this.json.children
  }
  get id() {
    return this.json.id
  }
  get found() {
    return Boolean(this.json.id || this.json.children.length > 0)
  }
  props(input = {}) {
    const props = this.json.props || {}
    if (typeof input === 'string') {
      input = { [input]: true }
    }
    this.json.props = Object.assign(props, input)
    return this
  }
  get(id) {
    id = normalize(id)
    const obj = getByPointer(this.json, id) || validate({})
    return new View(obj)
  }
  add(id, props = {}) {
    if (isArray(id)) {
      id.forEach(str => this.add(normalize(str), props))
      return this
    }
    id = normalize(id)
    const node = validate({ id, props: { ...props } })
    this.json.children.push(node)
    return new View(node)
  }
  remove(id) {
    id = normalize(id)
    this.json.children = this.json.children.filter(obj => obj.id !== id)
    return this
  }
  nodes() {
    const nodes = byDepth(this.json)
    return nodes.map(node => {
      const { children: _children, ...row } = node // eslint-disable-line no-unused-vars
      return row
    })
  }
  cache() {
    cacheUp(this.json)
    return this
  }
  list() {
    return byDepth(this.json)
  }
  fillDown() {
    fillDown(this.json)
    return this
  }
  depth() {
    let max = this.id ? 1 : 0
    const depths = new Map([[this.json, max]])
    byDepth(this.json, (parent, child) => {
      const depth = depths.get(parent) + 1
      depths.set(child, depth)
      max = Math.max(max, depth)
    }, false)
    return max
  }
  out(fmt) {
    cacheDown(this.json)
    return out(this.json, fmt)
  }
  debug() {
    cacheDown(this.json)
    out(this.json, 'debug')
    return this
  }
}

export default View
