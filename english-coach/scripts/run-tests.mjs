import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fs, writeSync } from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(import.meta.url)
const defaultRoot = fileURLToPath(new URL('../', import.meta.url))
const ownerFile = '.test-runner-owner.json'
const environmentDirectories = { TMPDIR: 'tmp', TMP: 'tmp-windows', TEMP: 'temp', HOME: 'home', DSH_HOME: 'dsh-home', DSH_AGENTS_HOME: 'agents-home' }
const coreFiles = ['core', 'due-review-correction', 'durable-round-recovery', 'host-preference', 'learning-experience', 'new-word-correction', 'round-outcome', 'shared-effective-result', 'translation', 'word-retry-acceptance'].map(name => `${name}.test.js`)

function parseOptions(argv) {
  const options = { root: defaultRoot, suite: 'all', tmpParent: tmpdir(), testArgs: [] }
  const names = new Map([['--root', 'root'], ['--suite', 'suite'], ['--tmp-parent', 'tmpParent'], ['--report', 'report']])
  while (argv.length) {
    const arg = argv.shift()
    if (arg === '--') { options.testArgs = argv; break }
    const [name, ...rest] = arg.split('=')
    assert.ok(names.has(name), `Unknown runner option: ${name}; put Node test options and files after --`)
    const value = rest.length ? rest.join('=') : argv.shift()
    assert.ok(value && value !== '--', `Missing value for ${name}`)
    options[names.get(name)] = value
  }
  assert.ok(['all', 'core', 'ui'].includes(options.suite), 'Suite must be all, core or ui')
  return options
}

async function selectTests(options) {
  const root = await fs.realpath(resolve(options.root))
  const testRoot = join(root, 'test')
  assert.ok((await fs.lstat(testRoot)).isDirectory(), 'Package root must contain a test directory')
  assert.equal(await fs.realpath(testRoot), testRoot, 'Test directory cannot be a symlink')
  const flags = [], files = []
  const values = new Map([
    ['--test-name-pattern', value => value.length > 0], ['--test-skip-pattern', value => value.length > 0],
    ['--test-concurrency', value => /^[1-9]\d*$/.test(value)], ['--test-timeout', value => /^[1-9]\d*$/.test(value)],
    ['--test-shard', value => /^[1-9]\d*\/[1-9]\d*$/.test(value)],
    ['--test-reporter', value => ['spec', 'tap', 'dot', 'junit', 'lcov'].includes(value)],
    ['--test-reporter-destination', value => ['stdout', 'stderr'].includes(value)]
  ])
  for (let index = 0; index < options.testArgs.length; index++) {
    const arg = options.testArgs[index]
    if (arg.startsWith('-')) {
      if (arg === '--test-only') { flags.push(arg); continue }
      const equal = arg.indexOf('=')
      const name = equal < 0 ? arg : arg.slice(0, equal)
      assert.ok(values.has(name), `Unsupported Node test option: ${name}`)
      const value = equal < 0 ? options.testArgs[++index] : arg.slice(equal + 1)
      assert.ok(typeof value === 'string' && values.get(name)(value), `Invalid value for ${name}`)
      flags.push(`${name}=${value}`)
    } else files.push(arg)
  }
  const chosen = files.length ? files : (options.suite === 'core' ? coreFiles : (await fs.readdir(testRoot)).filter(name => options.suite === 'ui' ? name.endsWith('-ui.test.js') : name.endsWith('.test.js'))).map(name => join('test', name))
  assert.ok(chosen.length, 'No test files selected')
  const selected = []
  for (const name of chosen) {
    const file = resolve(root, name)
    const withinTest = relative(testRoot, file)
    assert.ok(withinTest && !isAbsolute(withinTest) && withinTest !== '..' && !withinTest.startsWith(`..${sep}`), 'Test files must be inside packageRoot/test')
    assert.match(file, /\.(?:[cm]?js)$/i, 'Only JavaScript test files are supported')
    assert.equal(await fs.realpath(file), file, 'Test files cannot use symlinks')
    const stat = await fs.lstat(file)
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Each test must be a regular file')
    selected.push(file)
  }
  return { root, flags, files: [...new Set(selected)] }
}

async function makeRun(tmpParent, selection) {
  const parent = await fs.realpath(resolve(tmpParent))
  const root = await fs.mkdtemp(join(parent, 'english-coach-run-'))
  const identity = await fs.lstat(root)
  const owner = { version: 1, runId: randomUUID(), parentPid: process.pid, startedAt: new Date().toISOString(), root, parent, dev: identity.dev, ino: identity.ino, uid: identity.uid, runtime: process.versions.node, files: selection.files.map(file => relative(selection.root, file)) }
  await fs.writeFile(join(root, ownerFile), JSON.stringify(owner, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  const env = { ...process.env }
  delete env.NODE_OPTIONS
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_COMPILE_CACHE
  env.NODE_DISABLE_COMPILE_CACHE = '1'
  for (const [name, directory] of Object.entries(environmentDirectories)) {
    env[name] = join(root, directory)
    await fs.mkdir(env[name])
  }
  return { root, parent, identity, owner, env }
}

async function verifyOwner(run) {
  assert.equal(dirname(run.root), run.parent, 'Run root parent changed')
  assert.match(basename(run.root), /^english-coach-run-[A-Za-z0-9]{6}$/)
  assert.equal(await fs.realpath(run.root), run.root, 'Run root cannot be a symlink')
  const current = await fs.lstat(run.root)
  assert.ok(current.isDirectory() && !current.isSymbolicLink(), 'Run root must remain a real directory')
  for (const key of ['dev', 'ino', 'uid']) assert.equal(current[key], run.identity[key], `Run root ${key} changed`)
  const ledger = join(run.root, ownerFile)
  assert.ok((await fs.lstat(ledger)).isFile() && !(await fs.lstat(ledger)).isSymbolicLink(), 'Owner ledger must remain a regular file')
  const owner = JSON.parse(await fs.readFile(ledger, 'utf8'))
  assert.equal(owner.runId, run.owner.runId, 'Run owner changed')
  assert.equal(owner.root, run.root, 'Owner root changed')
}

async function residueManifest(run) {
  const entries = []
  let truncated = false
  async function visit(directory, depth = 0) {
    // opendir avoids loading a huge leaked directory just to report it. Never
    // read file contents or symlink targets. Limit both traversal and output.
    for await (const entry of await fs.opendir(directory)) {
      if (entries.length >= 200) { truncated = true; break }
      const file = join(directory, entry.name)
      const path = relative(run.root, file).split(sep).join('/')
      const stat = await fs.lstat(file)
      if (path === ownerFile) continue
      const envelope = !path.includes('/') && Object.values(environmentDirectories).includes(path)
      if (!envelope || !stat.isDirectory() || stat.isSymbolicLink()) entries.push({ path, type: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', owner: path.split('/').slice(0, 2).join('/') })
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        if (depth >= 12) truncated = true
        else await visit(file, depth + 1)
      }
    }
  }
  await visit(run.root)
  entries.sort((a, b) => a.path.localeCompare(b.path))
  return { entries, truncated }
}

// This second Node reporter observes the actual coordinator stream over a
// private inherited fd. TAP/spec output remains untouched on inherited stdio.
// A worker killed by a signal otherwise looks like an ordinary exit code 1.
export default async function* lifecycleReporter(source) {
  const signals = new Set()
  let summary, shutdownFailed = false
  function inspect(value) {
    if (!value || typeof value !== 'object') return
    if (typeof value.signal === 'string' && value.signal.startsWith('SIG')) signals.add(value.signal)
    if (value.failureType === 'hookFailed') shutdownFailed = true
    inspect(value.cause)
    inspect(value.error)
    inspect(value.details)
  }
  for await (const event of source) {
    if (event.type === 'test:fail') inspect(event.data)
    if (event.type === 'test:summary' && !event.data.file) summary = { cancelled: event.data.counts?.cancelled ?? 0 }
  }
  writeSync(3, JSON.stringify({ version: 1, complete: Boolean(summary), cancelled: summary?.cancelled ?? 0, signals: [...signals], shutdownFailed }) + '\n')
}

function reporterArguments(flags) {
  const reporters = flags.filter(value => value.startsWith('--test-reporter='))
  const destinations = flags.filter(value => value.startsWith('--test-reporter-destination='))
  assert.ok(!destinations.length || destinations.length === reporters.length, 'Reporter destinations must match reporter count')
  const args = flags.filter(value => !value.startsWith('--test-reporter=') && !value.startsWith('--test-reporter-destination='))
  if (!reporters.length) reporters.push('--test-reporter=spec')
  for (let index = 0; index < reporters.length; index++) args.push(reporters[index], destinations[index] ?? '--test-reporter-destination=stdout')
  args.push(`--test-reporter=${script}`, '--test-reporter-destination=stderr')
  return args
}

function signalExit(signal) { return 128 + (constants.signals[signal] ?? 1) }

async function runTests(options) {
  const selection = await selectTests(options)
  const run = await makeRun(options.tmpParent, selection)
  const result = { version: 1, status: 'failed', exitCode: 1, childExitCode: null, childSignal: null, runRoot: run.root, cleanup: 'retained', residue: [], residueTruncated: false, parentSignal: null }
  try {
    const grouped = process.platform !== 'win32'
    const child = spawn(process.execPath, ['--test', ...reporterArguments(selection.flags), ...selection.files], { cwd: selection.root, env: run.env, detached: grouped, stdio: ['inherit', 'inherit', 'inherit', 'pipe'] })
    let lifecycleText = '', interrupted, shutdown
    function signalTree(signal) {
      try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal) } catch (cause) { if (cause.code !== 'ESRCH') throw cause }
    }
    const handleSignal = signal => {
      interrupted ??= signal
      signalTree(signal)
      // Even if the coordinator exits first, an ignoring descendant gets a
      // bounded grace period followed by a signal to this owned process group.
      shutdown ??= new Promise(resolveShutdown => setTimeout(() => { signalTree('SIGKILL'); resolveShutdown() }, 750))
    }
    const onTerm = () => handleSignal('SIGTERM'), onInt = () => handleSignal('SIGINT')
    process.on('SIGTERM', onTerm); process.on('SIGINT', onInt)
    child.stdio[3].setEncoding('utf8')
    child.stdio[3].on('data', chunk => { lifecycleText += chunk })
    const closed = new Promise((resolveOutcome, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => resolveOutcome({ code, signal }))
    })
    // Attach rejection handling immediately; no spawn error or fast child exit
    // may be lost while the owner ledger write is still in flight.
    closed.catch(() => {})
    let outcome
    try {
      run.owner.childPid = child.pid
      run.owner.processGroup = grouped ? child.pid : null
      await fs.writeFile(join(run.root, ownerFile), JSON.stringify(run.owner, null, 2) + '\n', { mode: 0o600 })
      outcome = await closed
      await shutdown
    } catch (cause) {
      signalTree('SIGKILL')
      await closed.catch(() => {})
      throw cause
    } finally {
      process.off('SIGTERM', onTerm); process.off('SIGINT', onInt)
    }
    const lifecycle = lifecycleText.trim() ? JSON.parse(lifecycleText.trim()) : null
    result.childExitCode = outcome.code
    result.childSignal = outcome.signal ?? lifecycle?.signals[0] ?? null
    result.shutdownFailed = lifecycle?.shutdownFailed ?? false
    result.parentSignal = interrupted ?? null
    // A worker may die while one of its own children remains alive. It still
    // belongs to this run's process group, not to a system-wide prefix sweep.
    if (result.childSignal && !interrupted) signalTree('SIGKILL')
    result.exitCode = interrupted ? signalExit(interrupted) : result.childSignal ? signalExit(result.childSignal) : outcome.code ?? 1
    await verifyOwner(run)
    const manifest = await residueManifest(run)
    result.residue = manifest.entries
    result.residueTruncated = manifest.truncated
    const drained = lifecycle?.complete && !lifecycle.cancelled && !result.shutdownFailed && !result.childSignal && !interrupted
    if (!drained) {
      result.status = 'interrupted'
      result.exitCode ||= 1
    } else {
      // A leak is a test failure even though this supervisor can safely remove
      // its own tree. Never scan or claim similarly-named system directories.
      if (result.residue.length && result.exitCode === 0) result.exitCode = 1
      await verifyOwner(run)
      await fs.rm(run.root, { recursive: true })
      result.cleanup = 'removed'
      result.status = result.residue.length ? 'cleanup-failed' : result.exitCode === 0 ? 'passed' : 'failed'
    }
  } catch (cause) {
    result.status = 'runner-error'
    result.exitCode ||= 1
    result.error = cause.code ?? cause.message
  }
  return result
}

async function main() {
  if (process.argv.slice(2).some(value => value === '--help' || value === '-h')) {
    console.log('Usage: node scripts/run-tests.mjs [--suite all|core|ui] [--root packageDir] [--tmp-parent DIR] [--report FILE] [-- node-test-options-and-test-files]\nRequires Node 24 to run tests. Test files must be real JavaScript files inside packageDir/test.\nA new private run root contains TMPDIR/TMP/TEMP/HOME/DSH_HOME/DSH_AGENTS_HOME. Completed tests must leave these directories empty. Interrupted runs are retained for inspection.\nFinal output: TEST_RUNNER_RESULT <JSON>. No system-wide sweep or profile changes are performed.')
    return
  }
  let options, result
  try {
    assert.equal(Number(process.versions.node.split('.')[0]), 24, 'The test runner requires Node 24')
    options = parseOptions(process.argv.slice(2))
    result = await runTests(options)
  } catch (cause) {
    result = { version: 1, status: 'invalid-arguments', exitCode: 2, childExitCode: null, childSignal: null, runRoot: null, cleanup: 'not-created', residue: [], error: cause.code ?? cause.message }
  }
  if (options?.report) {
    try { await fs.writeFile(resolve(options.report), JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' }) } catch (cause) {
      result.exitCode ||= 1
      result.status = 'runner-error'
      result.error = `Report could not be written: ${cause.code ?? 'unknown error'}`
    }
  }
  console.log(`TEST_RUNNER_RESULT ${JSON.stringify(result)}`)
  process.exitCode = result.exitCode
}

if (process.argv[1] && resolve(process.argv[1]) === script) await main()
