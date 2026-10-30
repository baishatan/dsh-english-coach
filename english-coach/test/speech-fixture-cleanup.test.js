import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// Observe the real test runner's filesystem result, not a mocked rm callback.
// The parent owns only this newly-created child TMPDIR, never global prefixes.
async function isolatedRunner(run) {
  const parent = await fs.realpath(tmpdir())
  const root = await fs.mkdtemp(join(parent, 'coach-cleanup-runner-'))
  const identity = await fs.lstat(root)
  try { await run(root) } finally {
    assert.equal(dirname(root), parent)
    assert.ok(basename(root).startsWith('coach-cleanup-runner-'))
    const current = await fs.lstat(root)
    assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino)
    assert.equal(current.isSymbolicLink(), false)
    assert.equal(await fs.realpath(root), root)
    await fs.rm(root, { recursive: true })
  }
}

test('a failed test runner still removes its own root and cannot claim a borrowed directory', async () => {
  await isolatedRunner(async directory => {
    const foreign = join(directory, 'borrowed'); await fs.mkdir(foreign)
    await fs.writeFile(join(foreign, 'keep.txt'), 'keep foreign bytes')
    const child = spawnSync(process.execPath, ['--test', fileURLToPath(new URL('./temp-fixture-failure-child.js', import.meta.url))], {
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, TMPDIR: directory, TMP: directory, TEMP: directory, COACH_FOREIGN_FIXTURE: foreign }, encoding: 'utf8', timeout: 10000
    })
    assert.equal(child.status, 1, child.stdout + child.stderr)
    assert.match(child.stdout, /intentional cleanup assertion failure/)
    assert.deepEqual(await fs.readdir(directory), ['borrowed'])
    assert.equal(await fs.readFile(join(foreign, 'keep.txt'), 'utf8'), 'keep foreign bytes')
  })
})

test('short article test runners finish delayed shutdown writes before removing their fixtures on success and failure', async () => {
  for (const failing of [false, true]) await isolatedRunner(async directory => {
    const child = spawnSync(process.execPath, ['--test', '--test-name-pattern=article shutdown drains a delayed bookmark', fileURLToPath(new URL('./short-reading-ui.test.js', import.meta.url))], {
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, TMPDIR: directory, TMP: directory, TEMP: directory, COACH_SHORT_CLEANUP_FAILURE: failing ? '1' : '0' }, encoding: 'utf8', timeout: 10000
    })
    assert.equal(child.status, failing ? 1 : 0, child.stdout + child.stderr)
    assert.match(child.stdout, failing ? /intentional short article shutdown failure/ : /article shutdown drains a delayed bookmark/)
    assert.deepEqual(await fs.readdir(directory), [], 'unmount must not recreate a fixture after early rm')
  })
})

test('public Host test runners remove their owned temporary roots after completion and reboot reuse', async () => {
  await isolatedRunner(async directory => {
    const pattern = process.env.ENGLISH_COACH_TEST_ASSETS
      ? 'asset status reports the fixed|all eight fixed assets become ready'
      : 'asset status reports the fixed'
    const child = spawnSync(process.execPath, ['--test', `--test-name-pattern=${pattern}|a manual synthesis request`, fileURLToPath(new URL('./host-speech-assets.test.js', import.meta.url)), fileURLToPath(new URL('./host-speech-audio.test.js', import.meta.url))], {
      env: { ...process.env, NODE_TEST_CONTEXT: undefined, TMPDIR: directory, TMP: directory, TEMP: directory }, encoding: 'utf8', timeout: 30000
    })
    assert.equal(child.status, 0, child.stdout + child.stderr)
    assert.match(child.stdout, /asset status reports the fixed/)
    assert.match(child.stdout, /a manual synthesis request/)
    assert.deepEqual(await fs.readdir(directory), [], 'completed Host tests must not leave 94 MB resource fixtures')
  })
})
