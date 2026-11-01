import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import test from 'node:test'
import { tempFixture, disposeFixture } from '../temp-fixture.js'

async function delayedFixture(t) {
  const root = await tempFixture(t, 'coach-runner-child-')
  await fs.writeFile(join(root, 'synthetic.txt'), 'synthetic fixture only')
  disposeFixture(t, async () => {
    await new Promise(resolve => setTimeout(resolve, 60))
    await fs.writeFile(join(root, 'late-cleanup.txt'), 'cleanup finished before removal')
    console.log('RUNNER_FIXTURE_DRAINED')
  })
  return root
}

test('runner fixture succeeds after delayed disposal', async t => {
  await delayedFixture(t)
})

test('runner fixture assertion fails after delayed disposal', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'failure' }, async t => {
  await delayedFixture(t)
  assert.fail('intentional runner fixture assertion failure')
})

test('runner fixture worker is killed without disposal', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'killed' }, async t => {
  const root = await tempFixture(t, 'coach-runner-killed-')
  await fs.writeFile(join(root, 'unfinished.txt'), 'synthetic unfinished work')
  process.kill(process.pid, 'SIGKILL')
  await new Promise(() => {})
})

test('runner fixture hangs with its own long running child', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'hanging' }, async t => {
  const root = await tempFixture(t, 'coach-runner-hanging-')
  await fs.writeFile(join(root, 'unfinished.txt'), 'synthetic interrupted work')
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); process.on("SIGINT", () => {}); console.log("ready"); setInterval(() => {}, 1000)'], { stdio: ['ignore', 'pipe', 'ignore'] })
  await new Promise((resolve, reject) => { child.once('error', reject); child.stdout.once('data', resolve) })
  console.log(`RUNNER_FIXTURE_READY ${JSON.stringify({ workerPid: process.pid, descendantPid: child.pid })}`)
  setInterval(() => {}, 1000)
  await new Promise(() => {})
})

test('runner fixture reports an unexpected normal-exit leak without following a borrowed symlink', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'leak' }, async () => {
  await fs.writeFile(join(process.env.TMPDIR, 'unexpected-leak.txt'), 'synthetic leaked bytes')
  await fs.symlink(process.env.COACH_RUNNER_FOREIGN, join(process.env.TMPDIR, 'borrowed-link'), 'dir')
})

test('runner fixture cannot replace the owner ledger and still claim cleanup success', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'owner-change' }, async () => {
  const owner = join(process.env.TMPDIR, '..', '.test-runner-owner.json')
  await fs.writeFile(owner, JSON.stringify({ runId: 'not-the-run-owner' }))
})

test('runner fixture sees only isolated environment directories', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'environment' }, async () => {
  const directories = ['TMPDIR', 'TMP', 'TEMP', 'HOME', 'DSH_HOME', 'DSH_AGENTS_HOME'].map(name => process.env[name])
  assert.equal(new Set(directories).size, 6)
  assert.equal(tmpdir(), process.env.TMPDIR)
  assert.equal(homedir(), process.env.HOME)
  assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE, '1')
  assert.equal(process.env.NODE_COMPILE_CACHE, undefined)
  for (const directory of directories) {
    assert.equal(await fs.realpath(directory), directory)
    assert.ok((await fs.lstat(directory)).isDirectory())
    await fs.writeFile(join(directory, 'synthetic-isolation-check.txt'), 'isolated write')
    await fs.unlink(join(directory, 'synthetic-isolation-check.txt'))
  }
})

test('runner fixture preserves a nonzero coordinator exit code', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'exit-code' }, () => {
  process.exitCode = 7
})

test('runner fixture manifest is bounded for many leaked files', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'many-leaks' }, async () => {
  const root = await fs.mkdtemp(join(process.env.TMPDIR, 'coach-many-leaks-'))
  await Promise.all(Array.from({ length: 230 }, (_, index) => fs.writeFile(join(root, `${index}.txt`), 'synthetic')))
})

test('runner fixture refuses removal after failed shutdown', { skip: process.env.COACH_RUNNER_FIXTURE_MODE !== 'shutdown-failed' }, async t => {
  const root = await tempFixture(t, 'coach-runner-shutdown-')
  await fs.writeFile(join(root, 'unfinished.txt'), 'synthetic shutdown not confirmed')
  disposeFixture(t, async () => { throw new Error('intentional fixture shutdown failure') })
})
