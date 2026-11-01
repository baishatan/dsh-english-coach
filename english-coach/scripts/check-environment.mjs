import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { resolveDevelopmentNode } from './development-runtime.mjs'

const execute = promisify(execFile)

const help = `Usage: node scripts/check-environment.mjs [options]
Read-only development environment preflight. Does not install or start the App.

  --json                   Print structured JSON
  --node PATH              Explicit development Node (ENGLISH_COACH_NODE)
  --dsh-root DIR           Host package root (ENGLISH_COACH_DSH_ROOT)
  --dsh-executable EXE     Host Node/Electron executable (ENGLISH_COACH_DSH_EXECUTABLE)
  --profile DIR            Host Profile directory (ENGLISH_COACH_DSH_PROFILE)
  --workspace DIR          Plugin package root (ENGLISH_COACH_WORKSPACE)
  --require-install-match  Require an installed plugin from this workspace
  --help                   Print this help without loading dependencies or the Host
`

function argumentError() {
  return Object.assign(new Error('Invalid arguments. Use --help for supported options.'), { code: 'ARGUMENT_INVALID' })
}

function parseArguments(args) {
  const options = { json: false, requireInstallMatch: false }
  const values = new Map([['--node', 'nodePath'], ['--dsh-root', 'dshRoot'], ['--dsh-executable', 'dshExecutable'],
    ['--profile', 'profile'], ['--workspace', 'workspace']])
  const seen = new Set()
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    if (seen.has(flag)) throw argumentError()
    seen.add(flag)
    if (flag === '--json') options.json = true
    else if (flag === '--help') options.help = true
    else if (flag === '--require-install-match') options.requireInstallMatch = true
    else if (values.has(flag)) {
      const value = args[++index]
      if (!value || value.startsWith('--')) throw argumentError()
      options[values.get(flag)] = value
    } else throw argumentError()
  }
  return options
}

function output(report, json) {
  report.status = report.checks.some(check => check.status === 'fail') ? 'fail'
    : report.checks.some(check => check.status === 'warn') ? 'warn' : 'pass'
  const runtime = report.runtime
  const lines = [`Environment: ${report.status}`,
    runtime ? `Launcher Node: ${runtime.launcher.version} executable=${runtime.launcher.executable} compatible=${runtime.launcher.compatible}` : `Launcher Node: ${process.version}; runtime check failed`,
    runtime ? `Selected Node: ${runtime.version} source=${runtime.source} executable=${runtime.executable} compatible=${runtime.compatible}` : 'Selected Node: unavailable',
    report.host ? `Host DSH: ${report.host.version} compatible=${report.host.compatible} root=${report.host.root}` : 'Host DSH: unavailable',
    report.installation?.installed ? `Installed source: ${report.installation.installedSource} matchesWorkspace=${report.installation.matchesWorkspace} profile=${report.installation.profile}` : 'Installed source: not installed',
    ...report.checks.map(check => `${check.status.toUpperCase()} ${check.code}: ${check.message}`), '']
  process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : lines.join('\n'))
  process.exitCode = report.status === 'fail' ? 1 : 0
}

function safePath(path, workspace) {
  const roots = [[resolve(workspace), '$WORKSPACE'], [resolve(process.env.DSH_HOME || `${homedir()}/.dsh`), '$DSH_HOME'], [homedir(), '$HOME']]
  for (const [root, label] of roots) {
    if (path === root) return label
    if (path.startsWith(`${root}${sep}`)) return `${label}/<redacted>`
  }
  return '<external>'
}

async function checkDevelopmentDependencies(workspace) {
  const required = { react: '18.3.1', 'react-dom': '18.3.1', jsdom: '29.1.1' }
  const missing = []
  const invalid = []
  let manifest
  try { manifest = JSON.parse(await fs.readFile(join(workspace, 'package.json'), 'utf8')) }
  catch { return { status: 'fail', code: 'WORKSPACE_MANIFEST_INVALID', message: 'Cannot read a valid workspace package.json.' } }
  const modules = join(workspace, 'node_modules')
  let realModules
  let modulesAreLocal = false
  try {
    realModules = await fs.realpath(modules)
    modulesAreLocal = realModules === join(await fs.realpath(workspace), 'node_modules')
  } catch { /* Every required local package is missing. */ }
  const require = createRequire(join(workspace, 'package.json'))
  for (const [name, version] of Object.entries(required)) {
    const directory = join(modules, name)
    let installed
    try { installed = JSON.parse(await fs.readFile(join(directory, 'package.json'), 'utf8')) }
    catch { missing.push(name); continue }
    try {
      const actualDirectory = await fs.realpath(directory)
      const entry = await fs.realpath(require.resolve(directory))
      if (!modulesAreLocal || !realModules || !actualDirectory.startsWith(`${realModules}${sep}`)
        || !entry.startsWith(`${actualDirectory}${sep}`) || installed.name !== name || installed.version !== version
        || manifest.devDependencies?.[name] !== version || Object.hasOwn(manifest.dependencies || {}, name)) invalid.push(name)
    } catch { invalid.push(name) }
  }
  if (missing.length) return { status: 'fail', code: 'DEVELOPMENT_DEPENDENCIES_MISSING', packages: missing,
    message: 'Package-local development dependencies are missing. Run npm ci with a compatible development Node.' }
  if (invalid.length) return { status: 'fail', code: 'DEVELOPMENT_DEPENDENCIES_INVALID', packages: invalid,
    message: 'Development dependencies must use the exact local devDependency versions. Run npm ci with a compatible development Node.' }
  return { status: 'pass', code: 'DEVELOPMENT_DEPENDENCIES_LOCAL',
    message: 'Exact development dependency versions resolve only from this package node_modules; NODE_PATH is not used.' }
}

async function checkInstalledSource(options, workspace) {
  const name = '@lijingtong/dsh-english-coach'
  const profileName = process.env.DSH_PROFILE || 'desktop'
  const profile = options.profile || process.env.ENGLISH_COACH_DSH_PROFILE
    || (/^[a-zA-Z0-9_-]+$/.test(profileName) ? join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', profileName) : undefined)
  const checks = []
  const installation = { profile: profile ? safePath(resolve(profile), workspace) : '<external>', declared: false, enabled: false, installed: false }
  if (!profile) return { installation, checks: [{ status: 'fail', code: 'PROFILE_INVALID', message: 'Invalid Profile selection. Set --profile to a Profile directory.' }] }
  try {
    const manifest = JSON.parse(await fs.readFile(join(profile, 'package.json'), 'utf8'))
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error()
    installation.declared = Object.hasOwn(manifest.dependencies || {}, name)
    installation.enabled = Array.isArray(manifest.dsh?.profile?.bundles) && manifest.dsh.profile.bundles.includes(name)
  } catch (error) {
    checks.push({ status: error.code === 'ENOENT' && !options.requireInstallMatch ? 'warn' : 'fail', code: 'PROFILE_MANIFEST_UNAVAILABLE',
      message: 'Profile package.json is missing or invalid. Set --profile; no Profile was created or changed.' })
  }
  try {
    const entry = join(profile, 'node_modules', name)
    const stat = await fs.lstat(entry)
    const source = await fs.realpath(entry)
    if (!(await fs.stat(source)).isDirectory()) throw new Error()
    installation.installed = true
    installation.linked = stat.isSymbolicLink()
    installation.installedSource = safePath(source, workspace)
    installation.matchesWorkspace = source === await fs.realpath(workspace)
    checks.push(installation.matchesWorkspace
      ? { status: 'pass', code: 'INSTALL_SOURCE_MATCH', message: 'Installed plugin source matches the current workspace realpath.' }
      : { status: options.requireInstallMatch ? 'fail' : 'warn', code: 'INSTALL_SOURCE_MISMATCH',
        message: 'Installed plugin source differs from this workspace. Local checks do not update the installed plugin.' })
  } catch (error) {
    checks.push({ status: error.code === 'ENOENT' && !options.requireInstallMatch ? 'warn' : 'fail', code: 'PLUGIN_NOT_INSTALLED',
      message: 'Plugin is not installed from a readable source in the selected Profile. No installation was attempted.' })
  }
  return { installation, checks }
}

async function checkEnvironment(options) {
  const workspace = resolve(options.workspace || process.env.ENGLISH_COACH_WORKSPACE || fileURLToPath(new URL('..', import.meta.url)))
  const report = { schemaVersion: 1, checks: [] }
  try {
    const runtime = await resolveDevelopmentNode({ packageRoot: workspace, nodePath: options.nodePath })
    report.runtime = { ...runtime, executable: safePath(runtime.executable, workspace),
      launcher: { ...runtime.launcher, executable: safePath(runtime.launcher.executable, workspace) } }
    report.checks.push({ status: 'pass', code: 'NODE_COMPATIBLE', message: 'Selected development Node satisfies engines.node.' })
    if (!runtime.launcher.compatible) report.checks.push({ status: 'warn', code: 'LAUNCHER_NODE_INCOMPATIBLE',
      message: 'Launcher Node is outside engines.node. A compatible development runtime was selected without changing PATH.' })
  } catch (error) {
    report.checks.push({ status: 'fail', code: error.code || 'NODE_CHECK_FAILED', message: error.code ? error.message : 'Node runtime check failed.' })
  }
  const installed = await checkInstalledSource(options, workspace)
  report.installation = installed.installation
  report.checks.push(...installed.checks)
  report.checks.push(await checkDevelopmentDependencies(workspace))
  const hostRoot = options.dshRoot || process.env.ENGLISH_COACH_DSH_ROOT
    || (process.platform === 'darwin' ? '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh' : undefined)
  const hostExecutable = options.dshExecutable || process.env.ENGLISH_COACH_DSH_EXECUTABLE
    || (process.platform === 'darwin' ? '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness' : process.execPath)
  try {
    if (!hostRoot) throw new Error()
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_DISABLE_COMPILE_CACHE: '1' }
    delete env.NODE_OPTIONS
    delete env.NODE_PATH
    delete env.NODE_COMPILE_CACHE
    const { stdout } = await execute(hostExecutable, ['--expose-internals',
      fileURLToPath(new URL('./environment-host-probe.mjs', import.meta.url)), resolve(hostRoot), workspace],
    { env, timeout: 15000, maxBuffer: 16384, windowsHide: true })
    const host = JSON.parse(stdout)
    if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(host.version)
      || typeof host.compatible !== 'boolean' || !/^[a-f0-9]{64}$/.test(host.manifestSha256)) throw new Error()
    report.host = { ...host, root: safePath(resolve(hostRoot), workspace), executable: safePath(resolve(hostExecutable), workspace) }
    report.checks.push(host.compatible
      ? { status: 'pass', code: 'HOST_COMPATIBLE', message: 'Actual Host public compatibility gate accepts the workspace manifest with no exemptions.' }
      : { status: 'fail', code: 'HOST_INCOMPATIBLE', message: 'Actual Host rejects the workspace manifest. Resolve compatibility before uninstalling or installing the plugin.' })
  } catch {
    report.checks.push({ status: 'fail', code: 'HOST_PROBE_FAILED', message: 'Cannot load the actual Host public compatibility gate. Set --dsh-root and --dsh-executable; no version was guessed.' })
  }
  return report
}

let options
try { options = parseArguments(process.argv.slice(2)) }
catch {
  const error = argumentError()
  output({ schemaVersion: 1, checks: [{ status: 'fail', code: error.code, message: error.message }] }, process.argv.includes('--json'))
  process.stderr.write(`Environment check failed: ${error.code}.\n`)
}
if (options?.help) process.stdout.write(help)
else if (options) output(await checkEnvironment(options), options.json)
