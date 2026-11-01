import { promises as fs } from 'node:fs'
import { dirname, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Read-only source search. Never traverse dependencies, private experiment trees,
// prototype artifacts, Git metadata, or symlinks into another checkout.
const excluded = new Set(['.git', '.scratch', '.firecrawl', 'node_modules', 'vendor', 'prototype', 'prototypes', 'coverage', 'dist', 'build'])
const extensions = new Set(['.js', '.mjs', '.cjs', '.json', '.md', '.html', '.css', '.yml', '.yaml', '.txt', '.sh'])
const usage = 'Usage: node scripts/source-search.mjs [--root DIR] [--json] [--ignore-case] [--regex] [--limit N] [--] PATTERN\nDefaults exclude vendor, dependencies, experiments, prototypes, hidden files and symlinks. Exit 0: matches; 1: none; 2: invalid input or unreadable source.'

async function main(args) {
  if (args.includes('--help')) { console.log(usage); return 0 }
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), json = false, ignoreCase = false, regex = false, limit = 100, pattern
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--json') json = true
    else if (arg === '--ignore-case') ignoreCase = true
    else if (arg === '--regex') regex = true
    else if (arg === '--root' || arg === '--limit') {
      const value = args[++i]
      if (!value) throw Error('SEARCH_INVALID_ARGUMENT')
      if (arg === '--root') root = resolve(value)
      else { limit = Number(value); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw Error('SEARCH_INVALID_ARGUMENT') }
    } else if (arg === '--') {
      if (pattern !== undefined || i + 2 !== args.length) throw Error('SEARCH_INVALID_ARGUMENT')
      pattern = args[++i]
    } else if (arg.startsWith('-') || pattern !== undefined) throw Error('SEARCH_INVALID_ARGUMENT')
    else pattern = arg
  }
  if (!pattern || pattern.includes('\0')) throw Error('SEARCH_INVALID_ARGUMENT')
  const expression = regex ? new RegExp(pattern, ignoreCase ? 'i' : '') : null
  root = await fs.realpath(root)
  if (!(await fs.stat(root)).isDirectory()) throw Error('SEARCH_INVALID_ROOT')
  const matches = []; let truncated = false
  async function scan(directory) {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    for (const entry of entries) {
      if (truncated) return
      if (entry.name.startsWith('.') || excluded.has(entry.name) || entry.isSymbolicLink()) continue
      const path = resolve(directory, entry.name), stat = await fs.lstat(path)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) { await scan(path); continue }
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024 || !extensions.has(extname(entry.name))) continue
      const text = await fs.readFile(path, 'utf8')
      if (text.includes('\0')) continue
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        const found = expression ? expression.test(line) : ignoreCase ? line.toLowerCase().includes(pattern.toLowerCase()) : line.includes(pattern)
        if (!found) continue
        if (matches.length === limit) { truncated = true; return }
        matches.push({ path: relative(root, path).split(sep).join('/'), line: index + 1, text: line.length > 500 ? `${line.slice(0, 500)}…` : line })
      }
    }
  }
  await scan(root)
  if (json) console.log(JSON.stringify({ matches, truncated }))
  else {
    for (const match of matches) console.log(`${match.path}:${match.line}:${match.text}`)
    if (truncated) console.error(`SEARCH_TRUNCATED: first ${limit} matches; narrow the query or increase --limit.`)
  }
  return matches.length ? 0 : 1
}

try { process.exitCode = await main(process.argv.slice(2)) } catch (error) {
  const code = error instanceof SyntaxError ? 'SEARCH_INVALID_PATTERN' : /^SEARCH_[A-Z_]+$/.test(error.message) ? error.message : 'SEARCH_READ_FAILED'
  console.error(code)
  process.exitCode = 2
}
