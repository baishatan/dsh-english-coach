import { execFile } from 'node:child_process'
import { constants, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execute = promisify(execFile)
const defaultPackageRoot = fileURLToPath(new URL('..', import.meta.url))
const messages = {
  WORKSPACE_MANIFEST_INVALID: 'Cannot read a valid workspace package.json.',
  NODE_REQUIREMENT_UNSUPPORTED: 'Unsupported Node requirement. Use the package-declared Node range.',
  NODE_EXECUTABLE_INVALID: 'Cannot run the explicit Node executable. Set --node or ENGLISH_COACH_NODE to a compatible Node.',
  NODE_INCOMPATIBLE: 'The explicit Node is incompatible with engines.node. No fallback was used.',
  NODE_NOT_FOUND: 'No compatible development Node was found. Set --node or ENGLISH_COACH_NODE; no installation was attempted.'
}
const failure = code => Object.assign(new Error(messages[code]), { code })

// Bootstrap must work before npm ci. Deliberately accept only this project's
// bounded stable-Node requirement, not an incomplete general SemVer evaluator.
function nodeCompatibility(requirement) {
  const range = typeof requirement === 'string' && /^>=(\d+)\.(\d+)\.(\d+) <(\d+)$/.exec(requirement)
  if (!range) throw failure('NODE_REQUIREMENT_UNSUPPORTED')
  const [major, minor, patch, upper] = range.slice(1).map(Number)
  if (![major, minor, patch, upper].every(Number.isSafeInteger) || upper !== major + 1) throw failure('NODE_REQUIREMENT_UNSUPPORTED')
  return version => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version)
    if (!match) return false
    const [actualMajor, actualMinor, actualPatch] = match.slice(1).map(Number)
    return actualMajor === major && (actualMinor > minor || actualMinor === minor && actualPatch >= patch)
  }
}

async function inspectNode(candidate) {
  try {
    if (typeof candidate !== 'string' || !candidate || candidate.includes('\0')) throw new Error()
    const executable = await fs.realpath(resolve(candidate))
    if (!(await fs.stat(executable)).isFile()) throw new Error()
    await fs.access(executable, constants.X_OK)
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_DISABLE_COMPILE_CACHE: '1' }
    delete env.NODE_OPTIONS
    delete env.NODE_PATH
    delete env.NODE_COMPILE_CACHE
    const { stdout } = await execute(executable, ['--expose-internals', '-p', 'JSON.stringify({version:process.version})'], {
      env, timeout: 10000, maxBuffer: 4096, windowsHide: true
    })
    const { version } = JSON.parse(stdout)
    if (typeof version !== 'string' || !/^v\d+\.\d+\.\d+$/.test(version)) throw new Error()
    return { executable, version }
  } catch {
    throw failure('NODE_EXECUTABLE_INVALID')
  }
}

/** Select a development runtime without installing anything or changing PATH.
 * Explicit nodePath / ENGLISH_COACH_NODE never silently falls back.
 */
export async function resolveDevelopmentNode({ packageRoot = defaultPackageRoot, nodePath } = {}) {
  let manifest
  try { manifest = JSON.parse(await fs.readFile(resolve(packageRoot, 'package.json'), 'utf8')) }
  catch { throw failure('WORKSPACE_MANIFEST_INVALID') }
  const compatibleWithPackage = nodeCompatibility(manifest?.engines?.node)
  const launcher = { executable: process.execPath, version: process.version, compatible: compatibleWithPackage(process.version) }
  const explicit = nodePath !== undefined ? nodePath : process.env.ENGLISH_COACH_NODE || undefined
  if (explicit !== undefined) {
    const selected = await inspectNode(explicit)
    if (!compatibleWithPackage(selected.version)) throw failure('NODE_INCOMPATIBLE')
    return { ...selected, source: 'explicit', launcher, compatible: true }
  }
  if (launcher.compatible) return { executable: process.execPath, version: process.version, source: 'current', launcher, compatible: true }
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node'
  const dshHome = resolve(process.env.DSH_HOME || join(homedir(), '.dsh'))
  const candidates = []
  if (process.platform === 'darwin') candidates.push({ source: 'dsh-bundled',
    path: '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node' })
  // Other installations can point to their standalone runtime without changing PATH.
  const hostRoot = process.env.ENGLISH_COACH_DSH_ROOT
  if (hostRoot) candidates.push({ source: 'dsh-bundled',
    path: resolve(hostRoot, '../../runtime/primary-runtime/dependencies/node/bin', executableName) })
  candidates.push({ source: 'dsh-managed', path: join(dshHome, 'dsh-runtimes/dsh-primary-runtime/dependencies/node/bin', executableName) })
  for (const candidate of candidates) {
    try {
      const selected = await inspectNode(candidate.path)
      if (compatibleWithPackage(selected.version)) return { ...selected, source: candidate.source, launcher, compatible: true }
    } catch { /* A missing fallback is not permission to install or change PATH. */ }
  }
  throw failure('NODE_NOT_FOUND')
}
