import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

// Run only as an isolated Node child. Electron's Node mode supplies ASAR access;
// importing app-boot does not boot the App, load a Profile, or load .env files.
let report
try {
  const [hostRoot, workspace] = process.argv.slice(2)
  const root = resolve(hostRoot)
  const require = createRequire(join(root, 'package.json'))
  const entry = require.resolve('@deepseek-ai/dsh-app-boot')
  if (!entry.startsWith(`${root}${sep}`)) throw new Error()
  const { evaluatePluginCompatibility, getDshRuntimeVersion } = await import(pathToFileURL(entry).href)
  if (typeof evaluatePluginCompatibility !== 'function' || typeof getDshRuntimeVersion !== 'function') throw new Error()
  const version = getDshRuntimeVersion()
  const bytes = await fs.readFile(join(workspace, 'package.json'))
  const manifest = JSON.parse(bytes.toString('utf8'))
  const issue = evaluatePluginCompatibility(manifest, {}, version)
  report = { version, compatible: issue === undefined, manifestSha256: createHash('sha256').update(bytes).digest('hex') }
} catch {
  report = { error: 'HOST_PROBE_FAILED' }
}
process.stdout.write(`${JSON.stringify(report)}\n`)
process.exitCode = report.error ? 1 : 0
