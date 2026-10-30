import validate from './_validate.js'

const isComment = /^[ \t]*(#|\/\/)/

const indentLevel = str => {
  const reg = /^( {2}|\t)/
  let indent = 0
  while (reg.test(str)) {
    str = str.replace(reg, '')
    indent += 1
  }
  return indent
}

const parseOne = function (str) {
  str = str.trim()
  if (!str) {
    return null
  }
  if (/^\[/.test(str) && /\]$/.test(str)) {
    str = str.replace(/^\[/, '')
    str = str.replace(/\]$/, '')
    let list = str.split(/,/)
    list = list.map((s) => s.trim()).filter(Boolean)
    list = list.map(label => {
      return validate({ id: label })
    })
    return list
  }
  return [validate({ id: str })]
}

// a -> a1 -> a2
const parseLine = function (str) {
  const split = str.trim().split(/->/)
  let list = []
  split.forEach(s => {
    list = list.concat(parseOne(s))
  })
  list = list.filter(Boolean)
  let node = list[0]
  for (let i = 1; i < list.length; i += 1) {
    node.children.push(list[i])
    node = list[i]
  }
  return list[0]
}

// find the parent
const rollBackWards = function (list, i) {
  const have = list[i].indent
  for (; i >= 0; i -= 1) {
    if (list[i].indent < have) {
      return list[i]
    }
  }
  return list[0]
}

const byIndent = function (list) {
  // add them to nth child
  const root = { children: [] }
  list.forEach((o, i) => {
    if (o.indent === 0) {
      // add it to the root
      root.children = root.children.concat(o.node)
    } else if (list[i - 1]) {
      const parent = rollBackWards(list, i)
      // add it to the deepest node last line
      parent.node.children.push(o.node)
    }
  })
  return root
}

const fromText = function (txt) {
  const lines = txt.split(/\r?\n/)
  const list = []
  lines.forEach(line => {
    if (!line.trim() || isComment.test(line)) {
      return
    }
    const indent = indentLevel(line)
    const node = parseLine(line)
    if (node) {
      list.push({ indent, node })
    }
  })
  const base = list.reduce((min, line) => Math.min(min, line.indent), Infinity)
  list.forEach(line => {
    line.indent -= base
  })
  let root = byIndent(list)
  root = validate(root)
  return root
}
export default fromText
