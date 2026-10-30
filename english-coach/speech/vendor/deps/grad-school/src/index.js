import parse from './input/index.js'
import View from './View.js'

const grad = function (input) {
  const data = parse(input)
  return new View(data)
}

export default grad
