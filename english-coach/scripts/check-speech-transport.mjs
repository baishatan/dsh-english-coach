import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

// Legacy admission fixture, not a product runtime, current-Profile test, or audio-quality admission.
// Composes a real Host carrier with synthetic route credentials, without a learner Profile.
if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/check-speech-transport.mjs <DSH-root> <desktop-main.js> <audio.wav>
All paths must be absolute. Legacy Host-carrier admission fixture; not a product or current-Profile test.
Normal execution starts an isolated Host listener and writes to .scratch/speech-admission/.
It does not verify Electron protocol registration, actual playback, or audio quality.
--help only prints usage; it reads no fixtures and starts no listener.`)
  process.exit(0)
}
const [runtimeRoot, desktopMain, audioPath] = process.argv.slice(2)
assert.ok([runtimeRoot, desktopMain, audioPath].every(value => value && isAbsolute(value)),
  'Usage: node scripts/check-speech-transport.mjs <DSH-root> <desktop-main.js> <audio.wav> (absolute paths)')
const [major, minor, patch] = process.versions.node.split('.').map(Number)
assert.ok(major === 24 && (minor > 21 || (minor === 21 && patch >= 0)), 'Use the package-compatible Node 24.21+')
const info = await fs.stat(audioPath)
assert.ok(info.isFile() && info.size >= 48 && info.size <= 8 * 1024 * 1024, 'Use a nonempty WAV up to 8 MiB')
const audio = await fs.readFile(audioPath)
assert.ok(audio.length === info.size && audio.length <= 8 * 1024 * 1024, 'WAV size changed during validation')
assert.equal(audio.toString('ascii', 0, 4), 'RIFF')
assert.equal(audio.toString('ascii', 8, 12), 'WAVE')
assert.equal(audio.toString('ascii', 12, 16), 'fmt ')
assert.equal(audio.readUInt32LE(16), 16)
assert.equal(audio.readUInt16LE(20), 3, 'The real probe produces Float32 PCM')
assert.equal(audio.readUInt16LE(22), 1)
assert.equal(audio.readUInt32LE(24), 24000)
assert.equal(audio.readUInt16LE(34), 32)
assert.equal(audio.toString('ascii', 36, 40), 'data')
assert.equal(audio.readUInt32LE(4), audio.length - 8)
assert.equal(audio.readUInt32LE(40), audio.length - 44)
assert.equal((audio.length - 44) % 4, 0)

const cordisPath = join(runtimeRoot, 'node_modules/@deepseek-ai/cordis/lib/index.js')
const hostPath = join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js')
const [{ Context }, { default: WebServer }] = await Promise.all([
  import(pathToFileURL(cordisPath).href), import(pathToFileURL(hostPath).href)
])
const source = await fs.readFile(desktopMain, 'utf8')
const start = source.indexOf('const WITHHELD_RESPONSE_HEADERS = [')
const end = source.indexOf('\n//#endregion', start)
assert.ok(start >= 0 && end > start && source.indexOf('const WITHHELD_RESPONSE_HEADERS = [', start + 1) === -1,
  'The installed Desktop forwarding section must be identifiable')
// shortcut: this executes the installed forwarder outside Electron; require a real desktop protocol run before delivery.
const forward = vm.runInNewContext(`${source.slice(start, end)}\nforwardWebRequest`, {
  URL, Headers, Response, fetch
}, { filename: 'installed-desktop-forwarder.js', timeout: 1000 })
assert.equal(typeof forward, 'function')

const scratch = resolve(fileURLToPath(new URL('../../.scratch/speech-admission/', import.meta.url)))
await fs.mkdir(scratch, { recursive: true })
const output = await fs.mkdtemp(join(scratch, 'transport-'))
const ctx = new Context()
const prefix = `/english-coach/_admission/${randomUUID()}`
const routePath = `${prefix}/audio`
const pendingPath = `${prefix}/pending`
const cookie = `speech_admission=${randomUUID()}`
const checks = []
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
let origin, unregister, pendingReader, pendingSignal
const request = (path = routePath, headers = {}, method = 'GET') => fetch(`${origin}${path}`, {
  method, headers: { cookie, ...headers }, signal: AbortSignal.timeout(5000)
})
const assertStatus = async (response, status, label) => {
  assert.equal(response.status, status, label)
  await response.arrayBuffer()
  checks.push(label)
}

try {
  await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  const server = ctx.get('webServer')
  origin = server.getOrigin()
  unregister = server.register({
    kind: 'prefix', path: prefix,
    handler(req, res) {
      const url = new URL(req.url, origin)
      if (req.headers.cookie !== cookie || (req.headers.origin && req.headers.origin !== origin)) {
        res.writeHead(403).end(); return
      }
      if (req.method !== 'GET') { res.writeHead(405).end(); return }
      if (![routePath, pendingPath].includes(url.pathname)) { res.writeHead(404).end(); return }
      if (url.search) { res.writeHead(400).end(); return }
      res.writeHead(200, {
        'content-type': 'audio/wav', 'content-length': audio.length,
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff'
      })
      // Keep one real response open to check disposal of an active connection.
      if (url.pathname === pendingPath) res.write(audio.subarray(0, 48))
      else res.end(audio)
    }
  })
  const direct = await request()
  assert.equal(direct.status, 200)
  assert.equal(direct.headers.get('content-type'), 'audio/wav')
  assert.equal(direct.headers.get('cache-control'), 'no-store')
  const httpAudio = Buffer.from(await direct.arrayBuffer())
  assert.deepEqual(httpAudio, audio, 'Real Host HTTP must preserve every WAV byte')
  await fs.writeFile(join(output, 'http.wav'), httpAudio)
  checks.push('real Host HTTP binary equality and no-store')
  await assertStatus(await request(routePath, { cookie: '' }), 403, 'unauthenticated request rejected')
  await assertStatus(await request(routePath, { cookie: 'speech_admission=other-owner' }), 403, 'other owner rejected')
  await assertStatus(await request(routePath, { origin: 'https://example.com' }), 403, 'foreign origin rejected')
  await assertStatus(await request(routePath, {}, 'POST'), 405, 'unsupported method rejected')
  await assertStatus(await request(`${routePath}?path=/etc/passwd`), 400, 'disk path query rejected')
  await assertStatus(await request(`${prefix}/other`), 404, 'unknown audio handle rejected')

  const forwarded = await forward(new Request(`dsh-app://app${routePath}`, {
    headers: { origin: 'dsh-app://app', cookie: 'untrusted-renderer-cookie' }, signal: AbortSignal.timeout(5000)
  }), origin, cookie)
  assert.equal(forwarded.status, 200)
  assert.equal(forwarded.headers.get('content-type'), 'audio/wav')
  assert.equal(forwarded.headers.get('content-length'), null)
  const desktopAudio = Buffer.from(await forwarded.arrayBuffer())
  assert.deepEqual(desktopAudio, audio, 'Installed Desktop forwarder must preserve WAV bytes')
  await fs.writeFile(join(output, 'desktop-forwarder.wav'), desktopAudio)
  checks.push('installed Desktop forwarding function binary equality')
  await assertStatus(await forward(new Request(`dsh-app://app${routePath}`, {
    headers: { origin: 'https://example.com' }
  }), origin, cookie), 403, 'Desktop forwarder rejects foreign origin')
  await assertStatus(await forward(new Request(`dsh-app://app${routePath}`), origin,
    'speech_admission=other-owner'), 403, 'Desktop forwarder cannot substitute another owner')
  pendingSignal = AbortSignal.timeout(5000)
  const pending = await fetch(`${origin}${pendingPath}`, { headers: { cookie }, signal: pendingSignal })
  assert.equal(pending.status, 200)
  pendingReader = pending.body.getReader()
  const chunk = await pendingReader.read()
  assert.equal(chunk.done, false)
  assert.deepEqual(Buffer.from(chunk.value), audio.subarray(0, 48))
} finally {
  unregister?.()
  await ctx.fiber.dispose()
}
await assert.rejects(() => pendingReader.read(), 'Disposal must terminate the open audio response')
assert.equal(pendingSignal.aborted, false, 'The listener closed the connection before the request timeout')
checks.push('active audio response terminates during Host disposal')
await assert.rejects(() => request(), 'Host listener must be closed after disposal')
checks.push('Host listener closes after disposal')
const summary = {
  node: process.version, output, bytes: audio.length, audioSha256: sha256(audio), checks,
  hostModuleSha256: sha256(await fs.readFile(hostPath)), desktopMainSha256: sha256(source),
  scope: 'Isolated actual Host carrier and installed forwarding function; synthetic probe route credentials only',
  notVerified: ['Electron protocol registration and renderer playback', 'production audio authentication and cancellation',
    'plugin install, learner Profile and current GUI', 'TTS quality and licence admission']
}
await fs.writeFile(join(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
