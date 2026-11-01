import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { tempFixture } from './temp-fixture.js'

const script = name => fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))
const invoke = (name, args = [], options = {}) => spawnSync(process.execPath, [script(name), ...args], {
  encoding: 'utf8', timeout: 15000, ...options
})

test('source search excludes dependencies, experiments and borrowed links by default', async t => {
  const root = await tempFixture(t, 'coach-source-search-')
  const files = {
    'core/visible.js': 'const marker = "source-needle"\n',
    'test/visible.test.js': '// source-needle\n',
    'speech/vendor/upstream.js': '// source-needle\n',
    'node_modules/external/index.js': '// source-needle\n',
    '.scratch/old-worktree/client.js': '// source-needle\n',
    '.firecrawl/capture.md': 'source-needle\n',
    'prototype/index.html': '<p>source-needle</p>\n',
    'prototypes/demo.js': '// source-needle\n',
    '.env': 'SECRET=source-needle\n'
  }
  for (const [name, body] of Object.entries(files)) {
    await fs.mkdir(join(root, name, '..'), { recursive: true })
    await fs.writeFile(join(root, name), body)
  }
  await fs.symlink(join(root, 'speech/vendor/upstream.js'), join(root, 'core/borrowed.js'))
  const before = (await fs.readdir(root)).sort()
  const child = invoke('source-search.mjs', ['--root', root, '--json', 'source-needle'])
  assert.equal(child.status, 0, child.stderr)
  const result = JSON.parse(child.stdout)
  assert.deepEqual(result.matches.map(row => [row.path, row.line]), [['core/visible.js', 1], ['test/visible.test.js', 1]])
  assert.equal(result.truncated, false)
  assert.deepEqual((await fs.readdir(root)).sort(), before, 'search is read-only')
})

test('source search reports invalid, empty and bounded results through its CLI', async t => {
  const root = await tempFixture(t, 'coach-search-status-')
  await fs.writeFile(join(root, 'source.js'), '// Needle\n// needle\n// needle\n')
  const limited = invoke('source-search.mjs', ['--root', root, '--json', '--ignore-case', '--limit', '1', 'needle'])
  assert.equal(limited.status, 0, limited.stderr)
  assert.deepEqual(JSON.parse(limited.stdout), { matches: [{ path: 'source.js', line: 1, text: '// Needle' }], truncated: true })
  const absent = invoke('source-search.mjs', ['--root', root, '--json', 'missing'])
  assert.equal(absent.status, 1)
  assert.deepEqual(JSON.parse(absent.stdout), { matches: [], truncated: false })
  const invalid = invoke('source-search.mjs', ['--root', root, '--regex', '['])
  assert.equal(invalid.status, 2)
  assert.equal(invalid.stderr.trim(), 'SEARCH_INVALID_PATTERN')
  assert.ok(!invalid.stderr.includes(root))
})

test('developer entrypoint offers help before loading runtime or test dependencies', () => {
  const child = invoke('dev.mjs', ['--help'], { env: { ...process.env, NODE_PATH: '', ENGLISH_COACH_NODE: '/missing/private-node' } })
  assert.equal(child.status, 0, child.stderr)
  for (const command of ['environment', 'test', 'package', 'search', 'node', 'npm']) assert.match(child.stdout, new RegExp(`\\b${command}\\b`))
  const unknown = invoke('dev.mjs', ['not-a-command'])
  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /DEVELOPMENT_UNKNOWN_COMMAND/)
})

test('developer Node entry preserves the actual child exit code and rejects an explicit invalid runtime', () => {
  const env = { ...process.env, ENGLISH_COACH_NODE: process.execPath, NODE_PATH: '' }
  const failed = invoke('dev.mjs', ['node', '-e', 'process.exit(23)'], { env })
  assert.equal(failed.status, 23, failed.stderr)
  const safe = invoke('dev.mjs', ['node', '-e', 'console.log(process.versions.node)'], { env })
  assert.equal(safe.status, 0, safe.stderr)
  assert.match(safe.stdout, /^24\.\d+\.\d+\s*$/)
  const invalid = invoke('dev.mjs', ['node', '-e', 'console.log("must-not-run")'], { env: { ...env, ENGLISH_COACH_NODE: '/private/nonexistent-development-node' } })
  assert.equal(invalid.status, 1)
  assert.doesNotMatch(invalid.stdout, /must-not-run/)
  assert.doesNotMatch(invalid.stderr, /\/private\/|at file:|Error:/)
})

test('developer entry uses the locked local UI dependencies without NODE_PATH', () => {
  const child = invoke('dev.mjs', ['node', '--input-type=module', '-e', `
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    const require = createRequire(import.meta.url)
    for (const [name, version] of [['react','18.3.1'],['react-dom','18.3.1'],['jsdom','29.1.1']]) {
      assert.equal(require(name + '/package.json').version, version)
      assert.ok(require.resolve(name + '/package.json').startsWith(process.cwd() + '/node_modules/'))
    }
    console.log('local development dependencies ready')
  `], { cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, ENGLISH_COACH_NODE: process.execPath, NODE_PATH: '' } })
  assert.equal(child.status, 0, child.stderr)
  assert.match(child.stdout, /local development dependencies ready/)
})
