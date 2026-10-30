import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { tempFixture, disposeFixture } from './temp-fixture.js'

// Spawned explicitly by the cleanup regression, not discovered by *.test.js.
// A failing real test still shuts down users of its files before removing them.
if (process.env.COACH_FOREIGN_FIXTURE) test('intentional assertion failure still disposes and removes only its fixture', async t => {
  const directory = await tempFixture(t, 'english-coach-speech-')
  const open = await fs.open(join(directory, 'open-test-file.txt'), 'wx')
  disposeFixture(t, async () => { await open.close() })
  const same = await tempFixture(t, 'english-coach-speech-', directory)
  assert.equal(same, directory)
  await assert.rejects(tempFixture(t, 'english-coach-speech-', process.env.COACH_FOREIGN_FIXTURE), /must belong to this test/)
  assert.fail('intentional cleanup assertion failure')
})
