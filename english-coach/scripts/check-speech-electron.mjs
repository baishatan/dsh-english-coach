import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { constants, promises as fs } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'

// Legacy admission fixture, not a product runtime, current-Profile test, or audio-quality admission.
// Requires an operator-owned external isolation.sb; it is not supplied or run by default.
// The Electron admission was never claimed green. No product module or existing GUI is loaded.
if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/check-speech-electron.mjs <Electron> <DSH-root> <desktop-main.js> <audio.wav> <output-root> [--validate-only|--check-isolation|--protocol-only]
All paths must be absolute. Use a development Electron executable, never the installed DSH app.
Required: SPEECH_ADMISSION_ELECTRON_SHA256=<64 hexadecimal characters>.
Isolation modes also require SPEECH_OS_POLICY=isolation.sb and SPEECH_ADMISSION_SENTINEL=<absolute non-personal test file outside output-root>.
The operator must supply and audit isolation.sb; no policy is included. Fixed source/audio snapshots are required.
Default mode fails closed as not implemented yet. --help only prints usage; it reads no fixtures and starts no process.`)
  process.exit(0)
}
const args = process.argv.slice(2)
const mode = args.at(-1)?.startsWith('--') ? args.pop() : null
const validateOnly = mode === '--validate-only'
const protocolOnly = mode === '--protocol-only'
const checkIsolation = mode === '--check-isolation'
assert.ok(mode === null || validateOnly || protocolOnly || checkIsolation,
  'Use --validate-only, --check-isolation or --protocol-only')
assert.ok(args.length === 5 && args.every(value => value && isAbsolute(value)),
  'Usage: node scripts/check-speech-electron.mjs <Electron> <DSH-root> <desktop-main.js> <audio.wav> <output-root> [--validate-only|--check-isolation|--protocol-only] (absolute paths)')
const [electronPath, runtimeRoot, desktopMain, audioPath, outputRoot] = args
const [major, minor] = process.versions.node.split('.').map(Number)
assert.ok(major === 24 && minor >= 21, 'Use the signed package-compatible Node 24.21+')
assert.equal(process.platform, 'darwin', 'This admission policy is for macOS only')
const expectedElectronSha256 = process.env.SPEECH_ADMISSION_ELECTRON_SHA256
assert.ok(typeof expectedElectronSha256 === 'string' && /^[a-f0-9]{64}$/i.test(expectedElectronSha256),
  'Set SPEECH_ADMISSION_ELECTRON_SHA256 to the approved development Electron executable SHA-256 (64 hexadecimal characters)')
const installedAppRoot = '/Applications/DeepSeek Harness.app'
const isInstalledAppPath = path => path === installedAppRoot || path.startsWith(`${installedAppRoot}${sep}`)
assert.ok(!isInstalledAppPath(resolve(electronPath)), 'Never use the installed DSH app executable for admission')
const electronRealPath = await fs.realpath(electronPath)
assert.ok(!isInstalledAppPath(electronRealPath), 'Never use the installed DSH app executable, including through a symlink')
assert.ok((await fs.stat(electronRealPath)).isFile(), 'Electron must be a regular executable file')
await fs.access(electronRealPath, constants.X_OK)
const sha256 = value => createHash('sha256').update(value).digest('hex')
const electronSha256 = sha256(await fs.readFile(electronRealPath))
assert.equal(electronSha256, expectedElectronSha256.toLowerCase(),
  'Development Electron bytes must match SPEECH_ADMISSION_ELECTRON_SHA256')
assert.ok((await fs.stat(runtimeRoot)).isDirectory(), 'Host runtime must be an existing directory')
assert.ok((await fs.stat(outputRoot)).isDirectory(), 'Output root must already exist')
const source = await fs.readFile(desktopMain, 'utf8')
const desktopMainSha256 = sha256(source)
assert.equal(desktopMainSha256, 'f05dd366f6c468bedd83f07372bc59d3d6b3f6bcc6950565c8b4173597e3ba93',
  'Use the exact installed Desktop source snapshot; do not import its side effects')
const hostPath = join(runtimeRoot, 'node_modules/@deepseek-ai/dsh-host-webserver/lib/index.js')
const hostModuleSha256 = sha256(await fs.readFile(hostPath))
assert.equal(hostModuleSha256, '08907285802f0edd3aeb68c91fb443be2804879ab3d41104c4600424be06f3ab',
  'Use the verified installed Host snapshot')
const audioStat = await fs.stat(audioPath)
assert.ok(audioStat.isFile() && audioStat.size >= 48 && audioStat.size <= 8 * 1024 * 1024, 'Use a nonempty WAV up to 8 MiB')
const audio = await fs.readFile(audioPath)
assert.equal(audio.length, audioStat.size, 'WAV size changed during validation')
assert.equal(audio.toString('ascii', 0, 4), 'RIFF')
assert.equal(audio.toString('ascii', 8, 16), 'WAVEfmt ')
assert.equal(audio.readUInt32LE(4), audio.length - 8)
assert.equal(audio.readUInt32LE(16), 16)
assert.equal(audio.readUInt16LE(20), 3, 'Use the real probe Float32 PCM WAV')
assert.equal(audio.readUInt16LE(22), 1)
assert.equal(audio.readUInt32LE(24), 24000)
assert.equal(audio.readUInt32LE(28), 96000)
assert.equal(audio.readUInt16LE(32), 4)
assert.equal(audio.readUInt16LE(34), 32)
assert.equal(audio.toString('ascii', 36, 40), 'data')
assert.equal(audio.readUInt32LE(40), audio.length - 44)
assert.equal((audio.length - 44) % 4, 0)
const audioSha256 = sha256(audio)
// Independent identity: extended/packed-audio-summary.json, af_heart, 7.25 seconds.
assert.equal(audioSha256, 'e07455f48c776e6274e11b86d1fff3b46615907d27e5de775c3886e4c0f5202d',
  'Use only the approved non-personal audio from the fixed no-GPL packed candidate')
const validation = {
  node: process.version, electronPath: electronRealPath, electronSha256,
  desktopMainSha256, hostModuleSha256, audioSha256, audioBytes: audio.length,
  electronStarted: false
}
if (validateOnly) console.log(JSON.stringify(validation, null, 2))
else if (checkIsolation) console.log(JSON.stringify({ ...validation, isolation: await verifyIsolation() }, null, 2))
else if (protocolOnly) await runProtocol()
else throw new Error('OS-isolated Electron admission is not implemented yet; no Host, Electron or output run was created')

async function verifyIsolation() {
  assert.equal(process.env.SPEECH_OS_POLICY, 'isolation.sb', 'Apply the audited isolation.sb around the signed Node parent')
  // The operator must provide a non-personal test sentinel, never real learning data or credentials.
  const sentinelPath = process.env.SPEECH_ADMISSION_SENTINEL
  assert.ok(typeof sentinelPath === 'string' && isAbsolute(sentinelPath),
    'Set SPEECH_ADMISSION_SENTINEL to an absolute non-personal test file outside the output root')
  const outsideOutput = (sentinel, root) => sentinel !== root && !sentinel.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
  assert.ok(outsideOutput(resolve(sentinelPath), resolve(outputRoot)), 'Sentinel must be outside the test output root')
  const sentinelRealPath = await fs.realpath(sentinelPath)
  assert.ok(outsideOutput(sentinelRealPath, await fs.realpath(outputRoot)),
    'Sentinel must remain outside the test output root after resolving symlinks')
  const checks = []
  async function denied(action, label) {
    try { await action() } catch (error) {
      assert.ok(['EPERM', 'EACCES'].includes(error.code), `OS isolation preflight: ${label} failed without a policy denial (${error.code})`)
      checks.push({ label, code: error.code })
      return
    }
    assert.fail(`OS isolation preflight: ${label} was not denied`)
  }
  // Read at most one byte from the operator-provided non-personal test sentinel; never write it.
  await denied(async () => {
    const handle = await fs.open(sentinelRealPath, 'r')
    try { await handle.read(Buffer.alloc(1), 0, 1, 0) } finally { await handle.close() }
  }, 'Home-content read')
  await denied(async () => {
    const handle = await fs.open(sentinelRealPath, 'r+')
    await handle.close() // Never write the policy sentinel even if an incorrect policy permits this open.
  }, 'Home write-capable open')
  for (const host of ['192.0.2.1', '2001:db8::1']) {
    await denied(async () => {
      const socket = net.createConnection({ host, port: 9 })
      try {
        await Promise.race([once(socket, 'connect'), new Promise((_, reject) => {
          socket.setTimeout(1500, () => reject(new Error('Network timeout is not an OS policy denial')))
        })])
      } finally { socket.destroy() }
    }, `external IP ${host}`)
  }
  return checks
}

async function runProtocol() {
  // A marker alone is not proof: real OS-denied operations must precede all output creation and Electron startup.
  const isolation = await verifyIsolation()
  const privilegeStart = source.indexOf('protocol.registerSchemesAsPrivileged([{')
  const privilegeEnd = source.indexOf('\nfunction runtimeResources()', privilegeStart)
  assert.ok(privilegeStart >= 0 && privilegeEnd > privilegeStart)
  const privilege = source.slice(privilegeStart, privilegeEnd)
  const output = await fs.mkdtemp(join(outputRoot, 'run-protocol-'))
  const paths = Object.fromEntries(['home', 'appData', 'userData', 'sessionData', 'temp', 'crashDumps', 'logs', 'cache']
    .map(key => [key, join(output, key)]))
  for (const path of Object.values(paths)) await fs.mkdir(path, { mode: 0o700 })
  const privilegePath = join(output, 'installed-privilege.js')
  await fs.writeFile(privilegePath, privilege)
  const config = {
    id: randomUUID(), mode: 'protocol-only', output, paths, audioPath, audioSha256,
    privilegePath, privilegeSha256: sha256(privilege),
    rendererPath: fileURLToPath(new URL('./speech-electron-renderer.js', import.meta.url))
  }
  const configPath = join(output, 'config.json')
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), { mode: 0o600 })
  const env = { HOME: paths.home, CFFIXED_USER_HOME: paths.home, TMPDIR: `${paths.temp}/`,
    XDG_CACHE_HOME: paths.cache, XDG_CONFIG_HOME: paths.appData, XDG_DATA_HOME: paths.userData,
    LANG: 'en_US.UTF-8', PATH: '/usr/bin:/bin' }
  const args = [fileURLToPath(new URL('./speech-electron-main.cjs', import.meta.url)), configPath,
    `--user-data-dir=${paths.userData}`, `--disk-cache-dir=${paths.cache}`, '--disable-background-networking', '--disable-component-update']
  // Direct log descriptors avoid waiting indefinitely on pipe handles inherited by Chromium helpers.
  const stdout = await fs.open(join(output, 'electron.stdout.log'), 'wx', 0o600)
  const stderr = await fs.open(join(output, 'electron.stderr.log'), 'wx', 0o600)
  // A dedicated process group makes the cleanup target exact; this is not an unmanaged detached job.
  const child = spawn(electronRealPath, args, { cwd: output, env, detached: true, stdio: ['ignore', stdout.fd, stderr.fd] })
  const completion = once(child, 'exit')
  const alive = pid => {
    if (!Number.isInteger(pid) || pid === 0) return false
    try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
  }
  const groupAlive = () => Number.isInteger(child.pid) && alive(-child.pid)
  const terminateGroup = signal => { if (groupAlive()) process.kill(-child.pid, signal) }
  const launched = { pid: child.pid, processGroup: child.pid, executable: electronRealPath, configPath }
  const timer = setTimeout(() => terminateGroup('SIGTERM'), 35000)
  const forceTimer = setTimeout(() => terminateGroup('SIGKILL'), 37000)
  let electron, failure, exitCode, exitSignal, rendererPidExited
  try {
    await fs.writeFile(join(output, 'launch.json'), JSON.stringify(launched, null, 2))
    ;[exitCode, exitSignal] = await completion
    electron = JSON.parse(await fs.readFile(join(output, 'electron-result.json'), 'utf8'))
    assert.equal(exitSignal, null, `Electron exceeded its bound or was terminated; see ${output}`)
    assert.equal(exitCode, 0, `Electron failed; inspect electron.stderr.log in ${output}`)
    assert.equal(electron.passed, true)
    assert.equal(electron.renderer.sha256, audioSha256)
    assert.equal(electron.renderer.bytes, audio.length)
    assert.deepEqual(await fs.readFile(join(output, 'renderer.wav')), audio)
  } catch (error) { failure = error }
  finally {
    clearTimeout(timer); clearTimeout(forceTimer)
    if (groupAlive()) {
      terminateGroup('SIGTERM')
      const deadline = Date.now() + 1500
      while (groupAlive() && Date.now() < deadline) await delay(25)
      if (groupAlive()) terminateGroup('SIGKILL')
    }
    await completion.catch(() => {})
    const deadline = Date.now() + 1500
    while (groupAlive() && Date.now() < deadline) await delay(25)
    await stdout.close()
    await stderr.close()
    if (Number.isInteger(electron?.rendererPid) && electron.rendererPid > 0) rendererPidExited = !alive(electron.rendererPid)
    const cleanup = { ...launched, exitCode, exitSignal, processExited: !alive(child.pid),
      processGroupExited: !groupAlive(), rendererPid: electron?.rendererPid ?? null, rendererPidExited: rendererPidExited ?? null }
    await fs.writeFile(join(output, 'cleanup.json'), JSON.stringify(cleanup, null, 2))
    if (!cleanup.processExited || !cleanup.processGroupExited || rendererPidExited === false) {
      failure ||= new Error(`Electron process cleanup did not finish; see ${output}`)
    }
  }
  const summary = { ...validation, electronStarted: true, passed: !failure, output, isolation, electron,
    allPidsExited: !groupAlive(), privilegeSha256: config.privilegeSha256, failure: failure?.message,
    scope: 'Independent development Electron protocol mechanism only; no Host or installed/current GUI' }
  await fs.writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
  if (failure) throw failure
}
