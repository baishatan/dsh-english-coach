// Legacy admission-only Electron entry, not a product or current-Profile runtime.
// Muted protocol fixture, not an audio-quality admission. Never import the installed Desktop main.
if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/speech-electron-main.cjs --help
Internal Electron entry; use check-speech-electron.mjs for the isolated admission driver.
Normal execution requires an operator-owned isolation policy and a driver-created absolute config.
Do not run this entry against the installed DSH app or a learner Profile.
--help exits before requiring Electron or reading a config.`)
  process.exit(0)
}
const { app, BrowserWindow, protocol, session } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const { createHash } = require('node:crypto')

const configPath = process.argv[2]
assert.ok(path.isAbsolute(configPath), 'An isolated absolute config path is required')
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
// Configure every owned path before app readiness, session creation, or logging.
for (const key of ['home', 'appData', 'userData', 'sessionData', 'temp', 'crashDumps']) {
  app.setPath(key, config.paths[key])
}
app.setAppLogsPath(config.paths.logs)
app.setName('English Coach isolated speech admission')
app.commandLine.appendSwitch('disk-cache-dir', config.paths.cache)
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('disable-component-update')
app.enableSandbox()
const hash = value => createHash('sha256').update(value).digest('hex')
const privilegeSource = fs.readFileSync(config.privilegePath, 'utf8')
assert.equal(hash(privilegeSource), config.privilegeSha256)
vm.runInNewContext(privilegeSource, { protocol, SCHEME: 'dsh-app' }, { timeout: 1000 })

let window, ses
const output = { versions: process.versions, mode: config.mode, paths: {}, failures: [] }
let failing = false
const fail = error => {
  if (failing) return
  failing = true
  clearTimeout(watchdog)
  output.failures.push(error.stack || String(error))
  try { fs.writeFileSync(path.join(config.output, 'electron-result.json'), JSON.stringify(output, null, 2)) } catch {}
  console.error(error.stack || String(error))
  if (window && !window.isDestroyed()) window.destroy()
  app.exit(1)
}
process.on('uncaughtException', fail)
process.on('unhandledRejection', fail)
app.on('window-all-closed', () => {})
const watchdog = setTimeout(() => fail(new Error('Electron admission exceeded 30 second bound')), 30000)

app.whenReady().then(async () => {
  assert.equal(process.versions.electron, '44.7.0', 'Record and require the actual approved runtime version')
  for (const key of ['home', 'appData', 'userData', 'sessionData', 'temp', 'crashDumps', 'logs']) {
    output.paths[key] = app.getPath(key)
    assert.equal(output.paths[key], config.paths[key])
  }
  ses = session.fromPartition(`speech-admission-${config.id}`, { cache: false })
  assert.equal(ses.storagePath, null)
  output.storagePath = ses.storagePath
  ses.setPermissionCheckHandler(() => false)
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  await ses.setProxy({ mode: 'direct' })
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('dsh-app://app/') }))
  const audio = fs.readFileSync(config.audioPath)
  assert.equal(hash(audio), config.audioSha256)
  const renderer = fs.readFileSync(config.rendererPath, 'utf8')
  const html = '<!doctype html><meta charset="utf-8"><title>Isolated speech protocol admission</title><h1>Isolated speech protocol admission</h1><p>No personal data. Muted mechanism test, not the current DSH GUI.</p><output id="status">Checking protocol bytes…</output><script src="/probe.js"></script>'
  ses.protocol.handle('dsh-app', request => {
    const url = new URL(request.url)
    if (url.hostname !== 'app') return new Response(null, { status: 404 })
    if (url.pathname === '/admission') return new Response(html, { headers: {
      'content-type': 'text/html', 'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; script-src 'self'; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-src 'none'"
    } })
    if (url.pathname === '/probe.js') return new Response(renderer, { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } })
    if (url.pathname === '/audio') return new Response(audio, { headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' } })
    return new Response(null, { status: 404 })
  })
  window = new BrowserWindow({ width: 650, height: 280, show: true, focusable: false,
    title: 'English Coach — isolated muted protocol test',
    webPreferences: { session: ses, nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, safeDialogs: true }
  })
  window.webContents.setAudioMuted(true)
  output.audioMuted = window.webContents.isAudioMuted()
  output.preferences = window.webContents.getLastWebPreferences()
  output.rendererPid = window.webContents.getOSProcessId()
  window.webContents.on('did-start-loading', () => { output.rendererPid = window.webContents.getOSProcessId() })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.on('will-frame-navigate', event => event.preventDefault())
  window.webContents.on('render-process-gone', (_event, details) => fail(new Error(`Renderer gone: ${details.reason}`)))
  await window.loadURL('dsh-app://app/admission')
  // Runs in the real sandboxed renderer without Node or an artificial user gesture.
  const result = await window.webContents.executeJavaScript('window.__admissionResult', false)
  const { base64, ...rendererResult } = result
  const rendererAudio = Buffer.from(base64, 'base64')
  assert.deepEqual(rendererAudio, audio, 'Every WAV byte fetched by the renderer must match the independent source')
  fs.writeFileSync(path.join(config.output, 'renderer.wav'), rendererAudio)
  output.renderer = rendererResult
  output.audioMuted = window.webContents.isAudioMuted()
  output.preferences = window.webContents.getLastWebPreferences()
  output.rendererPid = window.webContents.getOSProcessId()
  output.passed = true
  clearTimeout(watchdog)
  window.destroy()
  ses.protocol.unhandle('dsh-app')
  await ses.clearStorageData()
  await ses.clearCache()
  fs.writeFileSync(path.join(config.output, 'electron-result.json'), JSON.stringify(output, null, 2))
  app.quit()
}).catch(fail)
