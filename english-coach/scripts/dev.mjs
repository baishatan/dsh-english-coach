import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scriptsRoot = join(packageRoot, 'scripts')
const usage = `Usage: node scripts/dev.mjs <command> [arguments]
  environment  Read-only Node / DSH admission / dependencies / installed-source checks
  test         Supervised isolated tests; optional --core, --ui, or --all
  package      Real pack / extract / isolated artifact tests
  search       Read-only source search; excludes vendor and experiment trees
  node         Execute Node arguments with the package-compatible runtime
  npm          Run npm with the same compatible runtime (for example: npm ci)
  help         Show this usage without loading dependencies or inspecting the Host
Set ENGLISH_COACH_NODE for an explicit runtime; no PATH changes or automatic installations.`

const signals = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }
async function execute(executable, args, options = {}) {
  const child = spawn(executable, args, { cwd: packageRoot, env: process.env, stdio: 'inherit', ...options })
  const forward = signal => { if (child.exitCode === null && child.signalCode === null) child.kill(signal) }
  const handlers = Object.fromEntries(Object.keys(signals).map(signal => [signal, () => forward(signal)]))
  for (const [signal, handler] of Object.entries(handlers)) process.on(signal, handler)
  try {
    return await new Promise(resolveExit => {
      child.once('error', () => resolveExit(1))
      child.once('close', (code, signal) => resolveExit(code ?? signals[signal] ?? 1))
    })
  } finally { for (const [signal, handler] of Object.entries(handlers)) process.removeListener(signal, handler) }
}

async function npmCli(node) {
  const candidates = [process.env.npm_execpath, join(dirname(node), '../lib/node_modules/npm/bin/npm-cli.js'), join(dirname(node), '../node_modules/npm/bin/npm-cli.js')].filter(Boolean)
  try {
    const entry = createRequire(import.meta.url).resolve('npm/package.json')
    candidates.push(join(dirname(entry), 'bin/npm-cli.js'))
  } catch {}
  for (const path of candidates) {
    try {
      const actual = await realpath(path)
      if (actual.endsWith('npm-cli.js')) { await access(actual, constants.R_OK); return actual }
    } catch {}
  }
  // npm's own shim is only used to locate its CLI, never to select a test Node.
  for (const directory of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!directory) continue
    try {
      const path = await realpath(join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm'))
      if (path.endsWith('npm-cli.js')) return path
    } catch {}
  }
  throw Object.assign(Error('DEVELOPMENT_NPM_MISSING'), { code: 'DEVELOPMENT_NPM_MISSING' })
}

async function main(args) {
  const command = args.shift()
  if (!command || ['--help', '-h', 'help'].includes(command)) { console.log(usage); return 0 }
  if (!['environment', 'test', 'package', 'search', 'node', 'npm'].includes(command)) {
    console.error('DEVELOPMENT_UNKNOWN_COMMAND\n' + usage)
    return 2
  }
  if (command === 'environment' || command === 'search') {
    // Both commands are dependency-free at bootstrap and diagnose the launcher
    // actually used. Environment performs its own compatible-runtime selection.
    const env = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' }
    delete env.NODE_OPTIONS
    delete env.NODE_COMPILE_CACHE
    env.ELECTRON_RUN_AS_NODE = '1'
    return execute(process.execPath, [join(scriptsRoot, command === 'environment' ? 'check-environment.mjs' : 'source-search.mjs'), ...args], { env })
  }
  const { resolveDevelopmentNode } = await import('./development-runtime.mjs')
  const runtime = await resolveDevelopmentNode({ packageRoot })
  const env = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' }
  delete env.NODE_OPTIONS
  delete env.NODE_COMPILE_CACHE
  // Harmless for standalone Node; required if an explicit compatible executable
  // is Electron's Node carrier. Never accidentally launch its GUI.
  env.ELECTRON_RUN_AS_NODE = '1'
  if (command === 'node') return execute(runtime.executable, args, { env })
  if (command === 'npm') return execute(runtime.executable, [await npmCli(runtime.executable), ...args], { env })
  if (command === 'package') {
    env.npm_execpath = await npmCli(runtime.executable)
    return execute(runtime.executable, [join(scriptsRoot, 'check-package.mjs'), ...args], { env })
  }
  let suite = 'all'
  const selectors = args.filter(arg => ['--core', '--ui', '--all'].includes(arg))
  if (selectors.length > 1) { console.error('DEVELOPMENT_AMBIGUOUS_TEST_SUITE'); return 2 }
  if (selectors.length) { suite = selectors[0].slice(2); args = args.filter(arg => arg !== selectors[0]) }
  if (args[0] === '--') args.shift()
  return execute(runtime.executable, [join(scriptsRoot, 'run-tests.mjs'), '--suite', suite, '--', ...args], { env })
}

try { process.exitCode = await main(process.argv.slice(2)) } catch (error) {
  console.error(typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'DEVELOPMENT_COMMAND_FAILED')
  process.exitCode = 1
}
