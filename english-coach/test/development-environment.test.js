import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { tempFixture } from './temp-fixture.js'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('../scripts/check-environment.mjs', import.meta.url))

function run(args, env = {}, executable = process.execPath) {
  return spawnSync(executable, [cli, ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ENGLISH_COACH_NODE: '', ENGLISH_COACH_DSH_ROOT: '/missing/isolated-host', ENGLISH_COACH_DSH_EXECUTABLE: process.execPath,
      ENGLISH_COACH_DSH_PROFILE: '/missing/isolated-profile', ENGLISH_COACH_WORKSPACE: '', ...env }
  })
}

test('environment CLI help works without loading development dependencies or the Host', () => {
  const result = run(['--help'], { NODE_PATH: '/not-a-development-dependency', ENGLISH_COACH_NODE: '/not-node' })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Usage:.*check-environment/)
  assert.match(result.stdout, /--require-install-match/)
  assert.equal(result.stderr, '')
})

test('environment CLI reports the actual compatible launcher and explicitly selected Node', () => {
  const result = run(['--json', '--node', process.execPath])
  const report = JSON.parse(result.stdout)
  assert.equal(report.runtime.version, process.version)
  assert.equal(report.runtime.compatible, true)
  assert.equal(report.runtime.source, 'explicit')
  assert.equal(report.runtime.launcher.version, process.version)
  assert.equal(report.runtime.launcher.compatible, true)
  assert.ok(report.checks.some(check => check.code === 'NODE_COMPATIBLE' && check.status === 'pass'))
})

test('environment CLI keeps a compatible current Node without silently overriding it', () => {
  const report = JSON.parse(run(['--json']).stdout)
  assert.equal(report.runtime.source, 'current')
  assert.equal(report.runtime.compatible, true)
})

test('environment CLI chooses a real bundled or managed Node for an incompatible launcher', t => {
  const actual = spawnSync('node', ['-p', 'JSON.stringify({version:process.version,executable:process.execPath})'], { encoding: 'utf8' })
  if (actual.status !== 0) return t.skip('No separate PATH Node is available')
  const launcher = JSON.parse(actual.stdout)
  if (launcher.version.startsWith('v24.')) return t.skip('PATH Node is already compatible; no incompatible launcher available')
  const report = JSON.parse(run(['--json'], {}, launcher.executable).stdout)
  assert.equal(report.runtime.launcher.version, launcher.version)
  assert.equal(report.runtime.launcher.compatible, false)
  assert.equal(report.runtime.version, process.version)
  assert.equal(report.runtime.compatible, true)
  assert.match(report.runtime.source, /^dsh-(bundled|managed)$/)
})

test('environment CLI refuses an explicit incompatible Node instead of falling back', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  await fs.writeFile(join(root, 'package.json'), JSON.stringify({ engines: { node: '>=25.0.0 <26' } }))
  const result = run(['--json', '--workspace', root, '--node', process.execPath])
  assert.equal(result.status, 1)
  assert.ok(JSON.parse(result.stdout).checks.some(check => check.code === 'NODE_INCOMPATIBLE'))
  assert.doesNotMatch(result.stdout + result.stderr, new RegExp(root))
})

test('environment CLI refuses a missing explicit Node with a safe error', () => {
  const result = run(['--json', '--node', '/missing/user:secret?token=do-not-print'])
  assert.equal(result.status, 1)
  assert.ok(JSON.parse(result.stdout).checks.some(check => check.code === 'NODE_EXECUTABLE_INVALID'))
  assert.doesNotMatch(result.stdout + result.stderr, /secret|do-not-print|\n\s+at /)
})

test('environment CLI fails closed when the actual Host module cannot be loaded', () => {
  const result = run(['--json', '--dsh-root', '/missing/host', '--dsh-executable', process.execPath])
  assert.equal(result.status, 1)
  assert.ok(JSON.parse(result.stdout).checks.some(check => check.code === 'HOST_PROBE_FAILED' && check.status === 'fail'))
  assert.doesNotMatch(result.stdout + result.stderr, /\/missing|\n\s+at /)
})

const hostRoot = process.env.ENGLISH_COACH_TEST_DSH_ROOT
const hostExecutable = process.env.ENGLISH_COACH_TEST_DSH_EXECUTABLE
const hostOptions = { skip: !hostRoot || !hostExecutable ? 'Set ENGLISH_COACH_TEST_DSH_ROOT and ENGLISH_COACH_TEST_DSH_EXECUTABLE for actual Host admission' : false }

test('actual Host gate rejects an rc.3 manifest without exemptions before installation', hostOptions, async t => {
  const root = await tempFixture(t, 'coach-environment-')
  await fs.writeFile(join(root, 'package.json'), JSON.stringify({ name: '@lijingtong/dsh-english-coach', version: '0.1.2',
    engines: { node: '>=24.21.0 <25', dsh: '0.2.1-rc.3' } }))
  const result = run(['--json', '--workspace', root, '--dsh-root', hostRoot, '--dsh-executable', hostExecutable])
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.host.version, '0.2.1-rc.5')
  assert.equal(report.host.compatible, false)
  assert.ok(report.checks.some(check => check.code === 'HOST_INCOMPATIBLE' && /before uninstalling or installing/.test(check.message)))
})

test('actual Host gate accepts an rc.5 candidate manifest without exemptions', hostOptions, async t => {
  const root = await tempFixture(t, 'coach-environment-')
  await fs.writeFile(join(root, 'package.json'), JSON.stringify({ name: '@lijingtong/dsh-english-coach', version: '0.1.2',
    engines: { node: '>=24.21.0 <25', dsh: '0.2.1-rc.5' } }))
  const result = run(['--json', '--workspace', root, '--dsh-root', hostRoot, '--dsh-executable', hostExecutable])
  const report = JSON.parse(result.stdout)
  assert.equal(report.host.version, '0.2.1-rc.5')
  assert.equal(report.host.compatible, true)
  assert.ok(report.checks.some(check => check.code === 'HOST_COMPATIBLE' && check.status === 'pass'))
})

test('environment CLI requires package-local development dependencies even when NODE_PATH has them', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  const manifest = JSON.parse(await fs.readFile(join(packageRoot, 'package.json'), 'utf8'))
  await fs.writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  const result = run(['--json', '--workspace', root], { NODE_PATH: join(packageRoot, 'node_modules') })
  assert.equal(result.status, 1)
  const check = JSON.parse(result.stdout).checks.find(check => check.code === 'DEVELOPMENT_DEPENDENCIES_MISSING')
  assert.equal(check?.status, 'fail')
  assert.match(check.message, /npm ci/)
})

test('environment CLI reports exact local dependency versions as reproducible', () => {
  const report = JSON.parse(run(['--json']).stdout)
  assert.ok(report.checks.some(check => check.code === 'DEVELOPMENT_DEPENDENCIES_LOCAL' && check.status === 'pass'))
})

test('environment CLI distinguishes a wrong local dependency version', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  const manifest = JSON.parse(await fs.readFile(join(packageRoot, 'package.json'), 'utf8'))
  await fs.writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    const directory = join(root, 'node_modules', name)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: name === 'react' ? '18.2.0' : version, main: 'index.js' }))
    await fs.writeFile(join(directory, 'index.js'), 'module.exports = {}\n')
  }
  const result = run(['--json', '--workspace', root])
  assert.equal(result.status, 1)
  const check = JSON.parse(result.stdout).checks.find(check => check.code === 'DEVELOPMENT_DEPENDENCIES_INVALID')
  assert.deepEqual(check?.packages, ['react'])
})

test('environment CLI compares the installed source and only fails a mismatch when required', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  const profile = join(root, 'profile')
  const other = join(root, 'other-workspace')
  await fs.mkdir(join(profile, 'node_modules/@lijingtong'), { recursive: true })
  await fs.mkdir(other)
  await fs.writeFile(join(profile, 'package.json'), JSON.stringify({ dependencies: { '@lijingtong/dsh-english-coach': 'file:private-input' } }))
  const link = join(profile, 'node_modules/@lijingtong/dsh-english-coach')
  await fs.symlink(other, link, 'dir')
  const args = ['--json', '--profile', profile]
  const warn = run(args)
  const warned = JSON.parse(warn.stdout)
  assert.ok(warned.checks.some(check => check.code === 'INSTALL_SOURCE_MISMATCH' && check.status === 'warn'))
  const strict = run([...args, '--require-install-match'])
  assert.equal(strict.status, 1)
  assert.ok(JSON.parse(strict.stdout).checks.some(check => check.code === 'INSTALL_SOURCE_MISMATCH' && check.status === 'fail'))
  assert.doesNotMatch(warn.stdout + strict.stdout, /private-input|other-workspace|coach-environment-/)
})

test('environment CLI does not claim a borrowed external node_modules is reproducible', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  await fs.copyFile(join(packageRoot, 'package.json'), join(root, 'package.json'))
  await fs.symlink(join(packageRoot, 'node_modules'), join(root, 'node_modules'), 'dir')
  const result = run(['--json', '--workspace', root])
  const report = JSON.parse(result.stdout)
  assert.equal(result.status, 1)
  assert.ok(report.checks.some(check => check.code === 'DEVELOPMENT_DEPENDENCIES_INVALID'))
  assert.ok(!report.checks.some(check => check.code === 'DEVELOPMENT_DEPENDENCIES_LOCAL'))
})

test('environment CLI text output includes the launcher, selected runtime, Host and installed-source state', () => {
  const result = run([])
  assert.match(result.stdout, new RegExp(`Launcher Node: ${process.version.replaceAll('.', '\\.')} .*compatible=true`))
  assert.match(result.stdout, /Selected Node: v24\..*source=current/)
  assert.match(result.stdout, /Host DSH: unavailable/)
  assert.match(result.stdout, /Installed source: not installed/)
  assert.doesNotMatch(result.stdout + result.stderr, /\/Users\/|\/missing\/|\n\s+at /)
})

test('environment CLI records an incompatible launcher as a warning after selecting a valid runtime', t => {
  const actual = spawnSync('node', ['-p', 'process.execPath'], { encoding: 'utf8' })
  if (actual.status !== 0) return t.skip('No separate PATH Node is available')
  const executable = actual.stdout.trim()
  const report = JSON.parse(run(['--json'], {}, executable).stdout)
  if (report.runtime?.launcher.compatible) return t.skip('PATH Node is already compatible')
  assert.ok(report.checks.some(check => check.code === 'LAUNCHER_NODE_INCOMPATIBLE' && check.status === 'warn'))
  assert.ok(report.checks.some(check => check.code === 'NODE_COMPATIBLE' && check.status === 'pass'))
})

test('environment CLI leaves synthetic inputs unchanged and never reads credentials, patches or learner files', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  // Register before tempFixture cleanup so this postcondition runs after removal.
  t.after(async () => assert.rejects(fs.access(root), { code: 'ENOENT' }))
  const workspace = join(root, 'workspace')
  const profile = join(root, 'profile')
  await fs.mkdir(workspace)
  await fs.mkdir(join(profile, 'node_modules/@lijingtong'), { recursive: true })
  await fs.copyFile(join(packageRoot, 'package.json'), join(workspace, 'package.json'))
  await fs.writeFile(join(profile, 'package.json'), JSON.stringify({ privateData: 'manifest-private-value',
    dependencies: { '@lijingtong/dsh-english-coach': 'https://user:secret@example.test/?token=private-token' } }))
  await fs.symlink(workspace, join(profile, 'node_modules/@lijingtong/dsh-english-coach'), 'dir')
  const protectedNames = ['credentials.json', '.env', 'cordis.patch.yml', 'learning.json']
  for (const name of protectedNames) {
    if (process.platform !== 'win32') {
      const created = spawnSync('mkfifo', [join(profile, name)], { encoding: 'utf8' })
      assert.equal(created.status, 0, created.stderr)
    } else await fs.mkdir(join(profile, name))
  }
  const files = [join(workspace, 'package.json'), join(profile, 'package.json')]
  const fingerprint = async () => Promise.all(files.map(async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')))
  const before = await fingerprint()
  const beforeNames = await fs.readdir(profile)
  const result = run(['--json', '--workspace', workspace, '--profile', profile, '--node', process.execPath],
    { HOME: root, DSH_HOME: join(root, 'dsh-home'), NODE_DISABLE_COMPILE_CACHE: '1', NODE_COMPILE_CACHE: join(root, 'must-not-create-cache') })
  assert.equal(result.signal, null, 'Reading a protected FIFO would time out')
  const report = JSON.parse(result.stdout)
  assert.ok(report.checks.some(check => check.code === 'INSTALL_SOURCE_MATCH'))
  assert.equal(report.installation.installedSource, '$WORKSPACE')
  assert.deepEqual(await fingerprint(), before)
  assert.deepEqual(await fs.readdir(profile), beforeNames)
  assert.deepEqual((await fs.readdir(root)).sort(), ['profile', 'workspace'])
  assert.doesNotMatch(result.stdout + result.stderr, /manifest-private-value|user:secret|private-token|example\.test|coach-environment-|\n\s+at /)
})

test('environment CLI requires an actual installation in strict mode', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  await fs.writeFile(join(root, 'package.json'), '{}')
  const result = run(['--json', '--profile', root, '--require-install-match'])
  assert.equal(result.status, 1)
  assert.ok(JSON.parse(result.stdout).checks.some(check => check.code === 'PLUGIN_NOT_INSTALLED' && check.status === 'fail'))
})

test('environment CLI fails safely for a malformed manifest without exposing its contents', async t => {
  const root = await tempFixture(t, 'coach-environment-')
  await fs.writeFile(join(root, 'package.json'), 'null')
  const result = run(['--json', '--workspace', root])
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.status, 'fail')
  assert.doesNotMatch(result.stdout + result.stderr, /\n\s+at |coach-environment-/)
})

test('environment CLI rejects unknown arguments with a safe stable diagnostic', () => {
  const result = run(['--json', '--private=https://user:secret@example.test/?token=do-not-print'])
  assert.equal(result.status, 1)
  const report = JSON.parse(result.stdout)
  assert.equal(report.status, 'fail')
  assert.ok(report.checks.some(check => check.code === 'ARGUMENT_INVALID'))
  assert.doesNotMatch(result.stdout + result.stderr, /user:secret|do-not-print|example\.test|\n\s+at /)
})
