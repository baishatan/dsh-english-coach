import fromText from './from-text.js'
import fromArray from './from-array.js'
import checkCycles from './check-cycles.js'
import validate from './_validate.js'
import { isArray } from '../lib/_lib.js'

const fromNested = json => {
  for (const node of checkCycles([json])) {
    validate(node)
  }
  return json
}

// 3 fmts we support
const parse = function (input = []) {
  if (typeof input === 'string') {
    return fromText(input)
  }
  if (isArray(input)) {
    return fromArray(input)
  }
  return fromNested(input)
}
export default parse
