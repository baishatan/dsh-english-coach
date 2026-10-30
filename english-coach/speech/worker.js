import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { isBuiltin, registerHooks } from 'node:module'
import { isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// This entry is private to runtime.js. Only the Host constructor supplies root;
// speech payloads cannot choose paths, models, imports, or network sources.
const root = process.argv[2]
const vendor = new URL('./vendor/', import.meta.url)
const fail = (code, message) => Object.assign(new Error(message), { code })
const requireCondition = (condition, code, message) => { if (!condition) throw fail(code, message) }
let loaded, busy = false

if (!process.send || !process.connected || typeof root !== 'string' || !isAbsolute(root)) process.exit(1)
process.once('disconnect', () => process.exit(0))
// Do not catch SIGTERM: cancellation must also stop active WASM CPU inference.
globalThis.fetch = async () => { throw fail('NETWORK_FORBIDDEN', 'Local speech cannot fetch resources') }
registerHooks({ resolve(specifier, context, next) {
  requireCondition(isBuiltin(specifier) || specifier.startsWith('./') || specifier.startsWith('../') ||
    specifier.startsWith('file:'), 'IMPORT_FORBIDDEN', 'Local speech imports must be package-owned or Node builtins')
  const resolved = next(specifier, context)
  requireCondition(resolved.url.startsWith('node:') ||
    (resolved.url.startsWith(vendor.href) && !resolved.url.endsWith('.node')),
  'IMPORT_FORBIDDEN', 'Local speech imports must stay in the packaged vendor directory')
  return resolved
} })

function send(message) {
  return new Promise((resolve, reject) => {
    if (!process.connected) { resolve(); process.exit(0); return }
    try { process.send(message, error => error ? reject(error) : resolve()) }
    catch (error) { reject(error) }
  })
}

async function verifiedFile(path, item, boundary) {
  const canonical = await fs.realpath(path)
  const info = await fs.lstat(path)
  requireCondition(canonical.startsWith(`${boundary}${sep}`) && info.isFile() && !info.isSymbolicLink() &&
    info.size === item.bytes, 'ASSETS_NOT_READY', 'Local speech resources are missing or invalid; prepare them explicitly')
  const digest = createHash('sha256')
  for await (const bytes of createReadStream(path)) digest.update(bytes)
  requireCondition(digest.digest('hex') === item.sha256, 'ASSETS_NOT_READY',
    'Local speech resource checksum failed; repair requires explicit preparation')
}

async function load() {
  if (loaded) return loaded
  const source = JSON.parse(await fs.readFile(new URL('SOURCE.json', vendor), 'utf8'))
  const packageBoundary = fileURLToPath(vendor).replace(/[\\/]$/, '')
  for (const item of source.inventory) {
    requireCondition(typeof item.path === 'string' && !item.path.includes('\\') &&
      item.path.split('/').every(part => part && part !== '.' && part !== '..'),
    'ASSETS_NOT_READY', 'The packaged local speech inventory is invalid')
    await verifiedFile(new URL(item.path, vendor), item, packageBoundary)
  }
  // Preparation is a separate explicit Host action. Never write or fetch here.
  for (const item of source.downloadedAssets) await verifiedFile(join(root, item.path), item, root)
  const ort = await import('./vendor/ort/dist/ort.node.min.mjs')
  const { createFrontend } = await import('./vendor/frontend.mjs')
  // Explicit package-relative URLs prevent ORT's fallback from choosing a CDN.
  ort.env.wasm.wasmPaths = {
    mjs: new URL('ort/dist/ort-wasm-simd-threaded.mjs', vendor).href,
    wasm: new URL('ort/dist/ort-wasm-simd-threaded.wasm', vendor).href
  }
  ort.env.wasm.numThreads = 4
  const vocab = JSON.parse(await fs.readFile(join(root, 'tokenizer.json'), 'utf8')).model.vocab
  const frontend = createFrontend(ort, vocab)
  let session
  const voices = new Map()
  return loaded = {
    ort, vocab, frontend, voices,
    async session() {
      if (!session) session = await ort.InferenceSession.create(await fs.readFile(join(root, 'onnx/model_quantized.onnx')), {
        executionProviders: ['wasm'], enableCpuMemArena: false, enableMemPattern: false
      })
      return session
    }
  }
}

async function synthesize(request) {
  requireCondition(request?.type === 'synthesize' && typeof request.id === 'string' && /^\d{1,16}$/.test(request.id) &&
    typeof request.text === 'string' && request.text.trim() && request.text.length <= 400 &&
    /^[\x20-\x7e\t\r\n\u00a0\u00a3\u2010-\u2015\u2018-\u201f\u2026]+$/.test(request.text) && /[A-Za-z0-9]/.test(request.text) &&
    ['af_heart', 'am_michael', 'bf_emma', 'bm_george'].includes(request.voice) && [0.5, 1, 1.5, 2].includes(request.rate),
  'INVALID_REQUEST', 'Use bounded English text, a curated voice, and one of the four speech rates')
  const engine = await load()
  let result
  try { result = await engine.frontend.phonemize(request.text, request.voice.startsWith('b') ? 'gb' : 'us') }
  catch { throw fail('TEXT_UNREADABLE', 'The local English frontend cannot read this text without omission') }
  requireCondition(result.phonemes.length > 0 && result.phonemes.length <= 510,
    'TEXT_TOO_LONG', 'This text exceeds the local phoneme limit; split it into smaller sentence segments')
  const chars = [...result.phonemes]
  requireCondition(chars.every(char => Object.hasOwn(engine.vocab, char)),
    'TEXT_UNREADABLE', 'The local English frontend returned an unmapped phoneme')
  if (!engine.voices.has(request.voice)) {
    const bytes = await fs.readFile(join(root, `voices/${request.voice}.bin`))
    engine.voices.set(request.voice, new Float32Array(Uint8Array.from(bytes).buffer))
  }
  // Length 510 is allowed; a voice has only rows 0..509. Never clip phonemes.
  const row = Math.min(chars.length, 509)
  const style = engine.voices.get(request.voice).slice(row * 256, (row + 1) * 256)
  requireCondition(style.length === 256 && style.every(Number.isFinite), 'ASSETS_NOT_READY', 'The selected local voice is invalid')
  const ids = [0, ...chars.map(char => engine.vocab[char]), 0]
  const session = await engine.session()
  const { waveform } = await session.run({
    input_ids: new engine.ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
    style: new engine.ort.Tensor('float32', style, [1, 256]),
    speed: new engine.ort.Tensor('float32', [request.rate], [1])
  })
  const data = waveform?.data
  requireCondition(data instanceof Float32Array && data.length > 0 && data.length * 4 + 44 <= 16 * 1024 * 1024 &&
    data.every(Number.isFinite) && data.some(sample => Math.abs(sample) > 0.00001),
  'INVALID_AUDIO', 'Local synthesis did not return bounded, finite, nonsilent audio')
  const bytes = Buffer.alloc(44 + data.length * 4)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(3, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(24000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(4, 32)
  bytes.writeUInt16LE(32, 34); bytes.write('data', 36); bytes.writeUInt32LE(data.length * 4, 40)
  data.forEach((sample, i) => bytes.writeFloatLE(sample, 44 + i * 4))
  return bytes
}

process.on('message', async request => {
  if (busy) {
    await send({ type: 'error', id: request?.id, code: 'RUNTIME_BUSY', message: 'Only one local synthesis request can run at a time' }).catch(() => process.exit(0))
    return
  }
  busy = true
  try {
    const bytes = await synthesize(request)
    await send({ type: 'result', id: request.id, bytes })
  } catch (error) {
    const known = ['INVALID_REQUEST', 'ASSETS_NOT_READY', 'TEXT_UNREADABLE', 'TEXT_TOO_LONG', 'INVALID_AUDIO', 'RUNTIME_BUSY']
    const code = known.includes(error.code) ? error.code :
      ['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code) ? 'ASSETS_NOT_READY' : 'SYNTHESIS_FAILED'
    const message = known.includes(error.code) ? error.message : code === 'ASSETS_NOT_READY' ?
      'Local speech resources are missing or unreadable; prepare them explicitly' : 'Local speech synthesis failed'
    await send({ type: 'error', id: request?.id, code, message }).catch(() => process.exit(0))
  } finally { busy = false }
})
await send({ type: 'ready', protocol: 1 }).catch(() => process.exit(0))
