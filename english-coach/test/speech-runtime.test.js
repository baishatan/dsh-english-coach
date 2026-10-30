import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tempFixture, disposeFixture } from './temp-fixture.js'

const runtimeUrl = new URL('../speech/runtime.js', import.meta.url)
const packageRoot = fileURLToPath(new URL('../', import.meta.url))

test('import and construction need no assets, model imports, network, or child process', async () => {
  // The Node permission boundary denies child creation, writes, and reads
  // outside the package; the fetch adapter rejects accidental network requests.
  // Actual synthesis is separately run under an OS deny-network sandbox.
  const output = execFileSync(process.execPath, [
    '--permission', `--allow-fs-read=${packageRoot}`, '--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import { registerHooks } from 'node:module'
      registerHooks({ resolve(specifier, context, next) {
        const resolved = next(specifier, context)
        assert.ok(!resolved.url.includes('/vendor/'), 'Import must not load models or frontend')
        return resolved
      } })
      globalThis.fetch = () => { throw new Error('No implicit fetch') }
      const { createSpeechRuntime } = await import(${JSON.stringify(runtimeUrl.href)})
      const runtime = createSpeechRuntime({ assetRoot: '/unreadable-local-speech-assets' })
      assert.equal(typeof runtime.synthesize, 'function')
      assert.equal(typeof runtime.dispose, 'function')
      await runtime.dispose()
      await runtime.dispose()
      console.log('lazy runtime passed')
    `
  ], { encoding: 'utf8', timeout: 10000 })
  assert.match(output, /lazy runtime passed/)
})

test('missing assets reject without creating, downloading, or changing files', async t => {
  const root = await tempFixture(t, 'english-coach-runtime-')
  const { createSpeechRuntime } = await import(runtimeUrl)
  const runtime = createSpeechRuntime({ assetRoot: join(root, 'missing') })
  disposeFixture(t, () => runtime.dispose())
  try {
    await assert.rejects(runtime.synthesize({ text: 'Opportunity.', voice: 'af_heart', rate: 1 }),
      { code: 'ASSETS_NOT_READY' })
    assert.deepEqual(await readdir(root), [])
  } finally { await runtime.dispose() }
})

test('only bounded English requests with curated voices and four rates are accepted', async () => {
  const { createSpeechRuntime } = await import(runtimeUrl)
  for (const assetRoot of [undefined, '', 'relative', 'https://example.invalid/model']) {
    assert.throws(() => createSpeechRuntime({ assetRoot }), /Host-owned local directory/)
  }
  const runtime = createSpeechRuntime({ assetRoot: packageRoot })
  try {
    for (const request of [null, {}, { text: '', voice: 'af_heart', rate: 1 },
      { text: 'a'.repeat(401), voice: 'af_heart', rate: 1 },
      { text: 'Hello\u0000', voice: 'af_heart', rate: 1 },
      { text: '中文', voice: 'af_heart', rate: 1 },
      { text: 'Hello.', voice: 'other', rate: 1 },
      { text: 'Hello.', voice: 'af_heart', rate: 0.75 },
      { text: 'Hello.', voice: 'af_heart', rate: 1, assetRoot: '/tmp/remote-input' }]) {
      await assert.rejects(runtime.synthesize(request), { code: 'INVALID_REQUEST' })
    }
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(runtime.synthesize({ text: 'Hello.', voice: 'af_heart', rate: 1 },
      { signal: controller.signal }), { name: 'AbortError' })
  } finally { await runtime.dispose() }
  await assert.rejects(runtime.synthesize({ text: 'Hello.', voice: 'af_heart', rate: 1 }),
    { code: 'RUNTIME_DISPOSED' })
})

test('vendored English frontend preserves contextual expression and clock pronunciation', async () => {
  const { createFrontend } = await import('../speech/vendor/frontend.mjs')
  const ort = await import('../speech/vendor/ort/dist/ort.node.min.mjs')
  // Independent fixed Kokoro alphabet, not derived from this frontend's output.
  const alphabet = '$;:,.!?—…\"()“” ̃ʣʥʦʨᵝꭧAIOQSTWYᵊabcdefhijklmnopqrstuvwxyzɑɐɒæβɔɕçɖðʤəɚɛɜɟɡɥɨɪʝɯɰŋɳɲɴøɸθœɹɾɻʁɽʂʃʈʧʊʋʌɣɤχʎʒʔˈˌːʰʲ↓→↗↘ᵻ'
  const vocab = Object.fromEntries([...alphabet].map((char, index) => [char, index]))
  const frontend = createFrontend(ort, vocab)
  try {
    assert.equal((await frontend.phonemize('Please record the record.', 'us')).phonemes,
      'plˈiz ɹəkˈɔɹd ðə ɹˈɛkəɹd.')
    assert.equal((await frontend.phonemize('Please record the record.', 'gb')).phonemes,
      'plˈiːz ɹɪkˈɔːd ðə ɹˈɛkɔːd.')
    const numbers = await frontend.phonemize('At 10:30.', 'us')
    assert.equal(numbers.normalizedText, 'At 10 30.')
    assert.equal(numbers.phonemes, 'ˌæt tˈɛn θˈɜɹTi.')
    const long = await frontend.phonemize('1999 '.repeat(79), 'us')
    assert.ok(long.phonemes.length > 510, 'The bounded worker must reject, not clip expanded numbers')
    const unmapped = createFrontend(ort, {})
    try { await assert.rejects(unmapped.phonemize('Hello.', 'us'), /Unmapped Kokoro phoneme/) }
    finally { await unmapped.release() }
  } finally { await frontend.release() }
})

const actualAssets = process.env.ENGLISH_COACH_TEST_ASSETS

test('real worker returns finite nonsilent Heart and Emma WAV for unknown words and numbers without mutating assets',
  { skip: !actualAssets, timeout: 120000 }, async t => {
    const source = JSON.parse(await readFile(new URL('../speech/vendor/SOURCE.json', import.meta.url)))
    const fingerprints = async () => Promise.all(source.downloadedAssets.map(async item => ({
      path: item.path,
      sha256: createHash('sha256').update(await readFile(join(actualAssets, item.path))).digest('hex')
    })))
    const before = await fingerprints()
    const { createSpeechRuntime } = await import(runtimeUrl)
    const runtime = createSpeechRuntime({ assetRoot: actualAssets, idleMs: 25 })
    try {
      await assert.rejects(runtime.synthesize({ text: '1999 '.repeat(79), voice: 'af_heart', rate: 1 }),
        { code: 'TEXT_TOO_LONG' })
      await assert.rejects(runtime.synthesize({ text: `${'z'.repeat(63)}.`, voice: 'af_heart', rate: 1 }),
        { code: 'TEXT_UNREADABLE' })
      for (const voice of ['af_heart', 'bf_emma']) {
        const started = performance.now()
        const bytes = await runtime.synthesize({ text: 'The ormex arrived at 10:30.', voice, rate: 1 })
        assert.ok(Buffer.isBuffer(bytes), 'Advanced IPC must preserve the audio Buffer')
        assert.ok(bytes.length > 44 && bytes.length <= 16 * 1024 * 1024)
        assert.equal(bytes.toString('ascii', 0, 4), 'RIFF')
        assert.equal(bytes.readUInt32LE(4), bytes.length - 8)
        assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ')
        assert.equal(bytes.readUInt16LE(20), 3, 'IEEE Float32 WAV')
        assert.equal(bytes.readUInt16LE(22), 1)
        assert.equal(bytes.readUInt32LE(24), 24000)
        assert.equal(bytes.readUInt16LE(34), 32)
        assert.equal(bytes.toString('ascii', 36, 40), 'data')
        assert.equal(bytes.readUInt32LE(40), bytes.length - 44)
        let peak = 0
        for (let offset = 44; offset < bytes.length; offset += 4) {
          const sample = bytes.readFloatLE(offset)
          assert.ok(Number.isFinite(sample))
          peak = Math.max(peak, Math.abs(sample))
        }
        assert.ok(peak > 0.00001)
        t.diagnostic(JSON.stringify({ voice, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
          elapsedMs: performance.now() - started, peak }))
      }
      assert.deepEqual(await fingerprints(), before)
      const controller = new AbortController()
      const pending = runtime.synthesize({ text: 'She thought the weather would improve by Thursday.', voice: 'af_heart', rate: 0.5 },
        { signal: controller.signal })
      const canceled = assert.rejects(pending, { name: 'AbortError' })
      await new Promise(resolve => setTimeout(resolve, 50))
      controller.abort()
      await canceled
    } finally { await runtime.dispose() }
  })

// Observe the actual OS ChildProcess at the external fork boundary. This
// wrapper never substitutes a worker, payload, IPC response, timer, or result.
test('real runtime rejects overlap and closes actual children on idle, cancel, dispose, and disconnect',
  { skip: !actualAssets, timeout: 30000 }, async t => {
    const childProcess = createRequire(import.meta.url)('node:child_process')
    const original = childProcess.fork, children = []
    childProcess.fork = (...args) => {
      const child = original(...args)
      const row = { child, closed: false }
      row.closing = new Promise(resolve => {
        let exited = false, disconnected = false
        const check = () => { if (exited && disconnected) { row.closed = true; resolve() } }
        child.once('exit', () => { exited = true; check() })
        child.once('disconnect', () => { disconnected = true; check() })
      })
      children.push(row)
      return child
    }
    syncBuiltinESMExports()
    const { createSpeechRuntime } = await import(runtimeUrl)
    const closing = async row => {
      let timer
      try { await Promise.race([row.closing, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Actual child did not close')), 3000) })]) }
      finally { clearTimeout(timer) }
    }
    let runtime
    try {
      runtime = createSpeechRuntime({ assetRoot: actualAssets, idleMs: 30 })
      const pending = runtime.synthesize({ text: '1999 '.repeat(79), voice: 'af_heart', rate: 1 })
      const rejected = assert.rejects(pending, { code: 'TEXT_TOO_LONG' })
      await assert.rejects(runtime.synthesize({ text: 'Hello.', voice: 'bf_emma', rate: 1 }), { code: 'RUNTIME_BUSY' })
      await rejected
      assert.equal(children.length, 1)
      await closing(children[0])
      t.diagnostic('idle child closed')
      assert.equal(children[0].closed, true)
      assert.throws(() => process.kill(children[0].child.pid, 0), { code: 'ESRCH' })
      await assert.rejects(runtime.synthesize({ text: '1999 '.repeat(79), voice: 'af_heart', rate: 1 }),
        { code: 'TEXT_TOO_LONG' })
      assert.equal(children.length, 2, 'A request after idle exit starts a new real worker')
      await runtime.dispose()
      assert.equal(children[1].closed, true, 'dispose resolves only after the actual OS child closes')
      t.diagnostic('disposed child closed')
      runtime = createSpeechRuntime({ assetRoot: actualAssets })
      const controller = new AbortController()
      const canceling = assert.rejects(runtime.synthesize({ text: '1999 '.repeat(79), voice: 'af_heart', rate: 1 },
        { signal: controller.signal }), { name: 'AbortError' })
      // The fork observer resolves only after the real child exists.
      for (let attempt = 0; children.length < 3 && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
      assert.equal(children.length, 3)
      controller.abort()
      await canceling
      assert.equal(children[2].closed, true, 'A canceled public request settles after its actual child exits')
      await runtime.dispose()
      assert.equal(children[2].closed, true)
      runtime = createSpeechRuntime({ assetRoot: actualAssets })
      await assert.rejects(runtime.synthesize({ text: '1999 '.repeat(79), voice: 'af_heart', rate: 1 }), { code: 'TEXT_TOO_LONG' })
      assert.equal(children.length, 4)
      children[3].child.disconnect()
      await closing(children[3])
      assert.equal(children[3].child.exitCode, 0, 'A disconnected parent causes the actual worker to exit')
      assert.throws(() => process.kill(children[3].child.pid, 0), { code: 'ESRCH' })
    } finally {
      await runtime?.dispose()
      childProcess.fork = original
      syncBuiltinESMExports()
    }
  })
