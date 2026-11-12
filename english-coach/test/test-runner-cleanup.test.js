import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const runner = fileURLToPath(new URL('../scripts/run-tests.mjs', import.meta.url))

function resultFrom(child) {
  assert.equal(child.error, undefined, child.error?.message)
  const line = child.stdout.split('\n').findLast(value => value.startsWith('TEST_RUNNER_RESULT '))
  assert.ok(line, child.stdout + child.stderr)
  return JSON.parse(line.slice('TEST_RUNNER_RESULT '.length))
}

function runCLI(env, args) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: packageRoot, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024
  })
}

async function isolatedEnvironment(t) {
  const base = await tempFixture(t, 'coach-runner-check-')
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  delete env.NODE_OPTIONS
  for (const [name, directory] of Object.entries({ TMPDIR: 'tmp', TMP: 'tmp', TEMP: 'tmp', HOME: 'home', DSH_HOME: 'dsh', DSH_AGENTS_HOME: 'agents' })) {
    env[name] = join(base, directory)
    await fs.mkdir(env[name], { recursive: true })
  }
  return { base, env }
}

test('core and Host preference test processes remove all owned fixtures after their real requests finish', async t => {
  const { env } = await isolatedEnvironment(t)
  const child = spawnSync(process.execPath, ['--test', 'test/core.test.js', 'test/host-preference.test.js'], {
    cwd: packageRoot, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024
  })
  assert.equal(child.error, undefined, child.error?.message)
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.deepEqual(await fs.readdir(env.TMPDIR), [], 'completed domain and Host tests must remove their own roots')
  assert.deepEqual(await fs.readdir(env.DSH_HOME), [], 'Host fixtures cannot borrow the default speech root')
})

test('public runner waits for delayed disposal and removes its isolated run on success', async t => {
  const { base, env } = await isolatedEnvironment(t)
  const report = join(base, 'success-report.json')
  const child = runCLI(env, ['--tmp-parent', env.TMPDIR, '--report', report, '--', '--test-name-pattern=succeeds after delayed disposal', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.equal(result.exitCode, 0)
  assert.equal(result.cleanup, 'removed')
  assert.deepEqual(result.residue, [])
  assert.match(child.stdout, /RUNNER_FIXTURE_DRAINED/)
  await assert.rejects(fs.lstat(result.runRoot), { code: 'ENOENT' })
  assert.deepEqual(JSON.parse(await fs.readFile(report, 'utf8')), result)
  assert.deepEqual(await fs.readdir(env.TMPDIR), [])
})

test('public runner preserves assertion failure and still waits for fixture cleanup', async t => {
  const { env } = await isolatedEnvironment(t)
  const child = runCLI({ ...env, COACH_RUNNER_FIXTURE_MODE: 'failure' }, ['--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=assertion fails after delayed disposal', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 1, child.stdout + child.stderr)
  assert.equal(result.childExitCode, 1)
  assert.equal(result.exitCode, 1)
  assert.equal(result.status, 'failed')
  assert.equal(result.cleanup, 'removed')
  assert.deepEqual(result.residue, [])
  assert.match(child.stdout, /intentional runner fixture assertion failure/)
  assert.match(child.stdout, /RUNNER_FIXTURE_DRAINED/)
  assert.deepEqual(await fs.readdir(env.TMPDIR), [])
})

test('public runner retains its owned run and manifest when a Node test worker is killed', async t => {
  const { env } = await isolatedEnvironment(t)
  const child = runCLI({ ...env, COACH_RUNNER_FIXTURE_MODE: 'killed' }, ['--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=worker is killed without disposal', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 137, child.stdout + child.stderr)
  assert.equal(result.exitCode, 137)
  assert.equal(result.childSignal, 'SIGKILL')
  assert.equal(result.status, 'interrupted')
  assert.equal(result.cleanup, 'retained')
  assert.ok(result.residue.some(value => value.path.endsWith('/unfinished.txt')))
  const owner = JSON.parse(await fs.readFile(join(result.runRoot, '.test-runner-owner.json'), 'utf8'))
  assert.equal(owner.root, result.runRoot)
  assert.equal(typeof owner.runId, 'string')
  assert.deepEqual(await fs.readdir(env.TMPDIR), [result.runRoot.split('/').at(-1)])
})

for (const [signal, expectedExit] of [['SIGTERM', 143], ['SIGINT', 130]]) test(`public runner forwards ${signal}, bounds child-tree shutdown, and retains an inspectable owned run`, { skip: process.platform === 'win32' && 'POSIX process groups are not available on Windows' }, async t => {
  const { env } = await isolatedEnvironment(t)
  const child = spawn(process.execPath, [runner, '--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=hangs with its own long running child', 'test/fixtures/runner-lifecycle.mjs'], {
    cwd: packageRoot, env: { ...env, COACH_RUNNER_FIXTURE_MODE: 'hanging' }, stdio: ['ignore', 'pipe', 'pipe']
  })
  let stdout = '', stderr = '', fixture, treeStopped = false
  const closed = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (status, signal) => resolve({ status, signal })) })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Hanging fixture did not start')), 5000)
    child.stdout.on('data', chunk => {
      stdout += chunk
      const match = stdout.match(/RUNNER_FIXTURE_READY (\{[^\n]*\})/)
      if (match && !fixture) { fixture = JSON.parse(match[1]); clearTimeout(timer); resolve() }
    })
    child.once('exit', () => { if (!fixture) { clearTimeout(timer); reject(new Error(stdout + stderr)) } })
  })
  child.stderr.on('data', chunk => { stderr += chunk })
  // Own only these spawned PIDs. A failed assertion must not orphan the real
  // long-running fixture or remove its files while the child still uses them.
  disposeFixture(t, async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (!treeStopped) for (const pid of [fixture?.workerPid, fixture?.descendantPid].filter(Boolean)) {
      try { process.kill(pid, 'SIGKILL') } catch (cause) { if (cause.code !== 'ESRCH') throw cause }
    }
    await closed
  })
  await ready
  child.kill(signal)
  let deadline
  const outcome = await Promise.race([closed, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Supervisor did not bound child shutdown')), 7000) })]).finally(() => clearTimeout(deadline))
  const result = resultFrom({ stdout, stderr })
  assert.equal(outcome.status, expectedExit, stdout + stderr)
  assert.equal(outcome.signal, null)
  assert.equal(result.exitCode, expectedExit)
  assert.equal(result.parentSignal, signal)
  assert.equal(result.status, 'interrupted')
  assert.equal(result.cleanup, 'retained')
  assert.ok(result.residue.some(value => value.path.endsWith('/unfinished.txt')))
  const shutdownDeadline = Date.now() + 2000
  let running
  do {
    running = false
    for (const pid of [fixture.workerPid, fixture.descendantPid]) {
      try { process.kill(pid, 0); running = true } catch (cause) { if (cause.code !== 'ESRCH') throw cause }
    }
    if (running) await new Promise(resolve => setTimeout(resolve, 20))
  } while (running && Date.now() < shutdownDeadline)
  treeStopped = !running
  assert.equal(running, false, 'A worker or signal-ignoring descendant cannot outlive its supervised tree')
})

test('public runner reports unexpected normal-exit residue, fails, and never follows borrowed symlinks', async t => {
  const { base, env } = await isolatedEnvironment(t)
  const foreign = join(base, 'foreign')
  await fs.mkdir(foreign)
  await fs.writeFile(join(foreign, 'keep.txt'), 'borrowed bytes must remain')
  const child = runCLI({ ...env, COACH_RUNNER_FIXTURE_MODE: 'leak', COACH_RUNNER_FOREIGN: foreign }, ['--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=unexpected normal-exit leak', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 1, child.stdout + child.stderr)
  assert.equal(result.childExitCode, 0)
  assert.equal(result.status, 'cleanup-failed')
  assert.equal(result.cleanup, 'removed')
  assert.ok(result.residue.some(value => value.path === 'tmp/unexpected-leak.txt' && value.owner === 'tmp/unexpected-leak.txt'))
  assert.ok(result.residue.some(value => value.path === 'tmp/borrowed-link' && value.type === 'symlink'))
  assert.equal(result.residue.some(value => value.path.endsWith('keep.txt')), false)
  assert.equal(await fs.readFile(join(foreign, 'keep.txt'), 'utf8'), 'borrowed bytes must remain')
  assert.deepEqual(await fs.readdir(env.TMPDIR), [])
})

test('public runner refuses removal when its owner ledger changes and must not return success', async t => {
  const { env } = await isolatedEnvironment(t)
  const child = runCLI({ ...env, COACH_RUNNER_FIXTURE_MODE: 'owner-change' }, ['--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=replace the owner ledger', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 1, child.stdout + child.stderr)
  assert.equal(result.childExitCode, 0)
  assert.equal(result.status, 'runner-error')
  assert.equal(result.cleanup, 'retained')
  assert.ok((await fs.lstat(result.runRoot)).isDirectory())
})

test('public runner retains fixture files when asynchronous shutdown fails instead of claiming drain', async t => {
  const { env } = await isolatedEnvironment(t)
  const child = runCLI({ ...env, COACH_RUNNER_FIXTURE_MODE: 'shutdown-failed' }, ['--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=refuses removal after failed shutdown', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 1, child.stdout + child.stderr)
  assert.equal(result.childExitCode, 1)
  assert.equal(result.status, 'interrupted')
  assert.equal(result.cleanup, 'retained')
  assert.equal(result.shutdownFailed, true)
  assert.ok(result.residue.some(value => value.path.endsWith('/unfinished.txt')))
  assert.deepEqual(await fs.readdir(env.TMPDIR), [result.runRoot.split('/').at(-1)])
})

test('public runner isolates all temporary and Host homes and does not use an inherited compile cache', async t => {
  const { base, env } = await isolatedEnvironment(t)
  const cache = join(base, 'borrowed-compile-cache')
  await fs.mkdir(cache)
  const child = runCLI({ ...env, NODE_COMPILE_CACHE: cache, COACH_RUNNER_FIXTURE_MODE: 'environment' }, ['--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=only isolated environment directories', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.equal(result.cleanup, 'removed')
  assert.deepEqual(result.residue, [])
  assert.deepEqual(await fs.readdir(env.TMPDIR), [])
  // The runner itself can be started by an inherited Node cache setting; only
  // the test child is required not to use or add to that external cache.
})

test('public runner bounds the residue manifest without hiding cleanup failure', async t => {
  const { env } = await isolatedEnvironment(t)
  const child = runCLI({ ...env, COACH_RUNNER_FIXTURE_MODE: 'many-leaks' }, ['--tmp-parent', env.TMPDIR, '--', '--test-name-pattern=manifest is bounded', 'test/fixtures/runner-lifecycle.mjs'])
  const result = resultFrom(child)
  assert.equal(child.status, 1, child.stdout + child.stderr)
  assert.equal(result.childExitCode, 0)
  assert.equal(result.status, 'cleanup-failed')
  assert.equal(result.residueTruncated, true)
  assert.ok(result.residue.length > 0 && result.residue.length <= 200)
  assert.equal(result.cleanup, 'removed')
  assert.deepEqual(await fs.readdir(env.TMPDIR), [])
})

test('public runner rejects command injection, out-of-package files and symlinked tests before creating a run', async t => {
  const { base, env } = await isolatedEnvironment(t)
  const extracted = join(base, 'package')
  await fs.mkdir(join(extracted, 'test'), { recursive: true })
  const foreign = join(base, 'outside.mjs')
  await fs.writeFile(foreign, 'throw new Error("An out-of-package script must not run")')
  await fs.symlink(foreign, join(extracted, 'test', 'linked.mjs'))
  for (const args of [
    ['--', '--eval=throw new Error("must not execute")'],
    ['--', '--import', foreign],
    ['--', '--test-force-exit', 'test/fixtures/runner-lifecycle.mjs'],
    ['--', foreign],
    ['--root', extracted, '--', 'test/linked.mjs']
  ]) {
    const child = runCLI(env, ['--tmp-parent', env.TMPDIR, ...args])
    const result = resultFrom(child)
    assert.equal(child.status, 2, child.stdout + child.stderr)
    assert.equal(result.status, 'invalid-arguments')
    assert.equal(result.runRoot, null)
    assert.equal(result.cleanup, 'not-created')
    assert.deepEqual(await fs.readdir(env.TMPDIR), [])
  }
})

test('public core suite includes the assessment, route and onboarding domain suites through its existing CLI', async t => {
  const { base, env } = await isolatedEnvironment(t)
  const extracted = join(base, 'core-selection')
  await fs.mkdir(join(extracted, 'test'), { recursive: true })
  await fs.writeFile(join(extracted, 'package.json'), JSON.stringify({ name: 'synthetic-core-selection', type: 'module' }))
  const expected = [
    'assessment-anchors', 'assessment-bank', 'assessment-history', 'assessment-response', 'assessment-scoring',
    'band-syllabus', 'core', 'due-review-correction', 'durable-round-recovery', 'host-preference',
    'learning-experience', 'new-word-correction', 'onboarding-profile', 'round-outcome',
    'shared-effective-result', 'translation', 'word-retry-acceptance'
  ]
  for (const name of expected) await fs.writeFile(join(extracted, 'test', `${name}.test.js`),
    `import test from 'node:test'; test(${JSON.stringify(`selected domain suite: ${name}`)}, () => {})\n`)
  await fs.writeFile(join(extracted, 'test', 'unrelated-ui.test.js'), "throw Error('core must not select UI suites')\n")
  const child = runCLI(env, ['--root', extracted, '--suite', 'core', '--tmp-parent', env.TMPDIR, '--', '--test-reporter=tap'])
  const result = resultFrom(child)
  assert.equal(child.status, 0, child.stdout + child.stderr)
  for (const name of expected) assert.ok(child.stdout.includes(`selected domain suite: ${name}`), `core omitted ${name}`)
  assert.equal(result.status, 'passed')
  assert.equal(result.cleanup, 'removed')
  assert.deepEqual(result.residue, [])
  assert.deepEqual(await fs.readdir(env.TMPDIR), [])
})

test('public runner executes explicit tests in an extracted package root without development dependencies', async t => {
  const { base, env } = await isolatedEnvironment(t)
  const extracted = join(base, 'unpacked')
  await fs.mkdir(join(extracted, 'test'), { recursive: true })
  await fs.writeFile(join(extracted, 'package.json'), JSON.stringify({ name: 'synthetic-unpacked', type: 'module' }))
  await fs.writeFile(join(extracted, 'test', 'packed.test.js'), 'import test from "node:test"; import assert from "node:assert/strict"; test("synthetic packed root test", () => assert.equal(2 + 2, 4))\n')
  const child = runCLI(env, ['--root', extracted, '--tmp-parent', env.TMPDIR, '--', '--test-reporter=tap', 'test/packed.test.js'])
  const result = resultFrom(child)
  assert.equal(child.status, 0, child.stdout + child.stderr)
  assert.match(child.stdout, /synthetic packed root test/)
  assert.equal(result.status, 'passed')
  assert.equal(result.cleanup, 'removed')
  assert.deepEqual(await fs.readdir(env.TMPDIR), [])
})
