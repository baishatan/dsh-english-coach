import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

// Audit the actual archive, never install it into a user's DSH Profile.
// Keep artifacts and logs in the ignored workspace scratch directory.
const root = fileURLToPath(new URL('../', import.meta.url))
const scratch = resolve(root, '../.scratch/package-check')
await fs.mkdir(scratch, { recursive: true })
const work = await fs.mkdtemp(join(scratch, 'run-'))
console.log(`Artifacts: ${work}`)
const env = {
  ...process.env,
  npm_config_cache: join(work, 'npm-cache'),
  npm_config_update_notifier: 'false'
}
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd, env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
})
const npmArgs = ['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', work]
const packOutput = process.env.npm_execpath
  ? run(process.execPath, [process.env.npm_execpath, ...npmArgs])
  : run('npm', npmArgs)
await fs.writeFile(join(work, 'pack.json'), packOutput)
const [pack] = JSON.parse(packOutput)
const listed = new Set(pack.files.map((file) => file.path))
assert.ok(listed.has('core/errors.js'), 'Published archive is missing core/errors.js')

const sourceManifest = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'))
assert.equal(sourceManifest.repository, 'https://github.com/baishatan/dsh-english-coach')
assert.ok(sourceManifest.engines?.node, 'Declare engines.node')
assert.ok(sourceManifest.engines?.dsh, 'Declare engines.dsh')
for (const file of ['index.js', 'client.js', 'package.json', 'cordis.patch.yml',
  'locale/en.json', 'locale/zh.json', 'icon.svg', 'README.md', 'NOTICE.md', 'LICENSE',
  'data/wordlists.json', 'data/manifest.json', 'data/ECDICT-LICENSE.txt', 'data/NOTICE.md']) {
  assert.ok(listed.has(file), `Published archive is missing ${file}`)
}
for (const file of await fs.readdir(join(root, 'core'))) {
  if (file.endsWith('.js')) assert.ok(listed.has(`core/${file}`), `Missing core/${file}`)
}
assert.ok(![...listed].some((file) => /^(test|scripts|node_modules|\.scratch)\//.test(file)),
  'Development files must not enter the archive')

const archive = resolve(work, pack.filename)
assert.equal(dirname(archive), work, 'Archive must stay in the audit directory')
const entries = run('tar', ['-tzf', archive]).trim().split('\n')
for (const entry of entries) {
  assert.ok(entry.startsWith('package/') && !entry.split('/').includes('..'),
    `Unexpected archive path: ${entry}`)
}
run('tar', ['-xzf', archive, '-C', work])
const unpacked = join(work, 'package')
const manifest = JSON.parse(await fs.readFile(join(unpacked, 'package.json'), 'utf8'))
assert.deepEqual(manifest, sourceManifest)
assert.equal(await fs.readFile(join(unpacked, 'LICENSE'), 'utf8'),
  await fs.readFile(resolve(root, '../LICENSE'), 'utf8'), 'Package license differs from repository license')
for (const file of listed) {
  assert.deepEqual(await fs.readFile(join(unpacked, file)), await fs.readFile(join(root, file)),
    `Archive bytes differ from source: ${file}`)
}
for (const target of Object.values(manifest.exports)) {
  assert.equal(typeof target, 'string', 'Update audit for conditional exports')
  if (!target.includes('*')) await fs.access(join(unpacked, target))
}
await fs.access(join(unpacked, manifest.dsh.bundle.patch))
const patch = await fs.readFile(join(unpacked, manifest.dsh.bundle.patch), 'utf8')
assert.ok(patch.includes(`name: '${manifest.name}'`), 'Bundle package name differs')

const host = await import(pathToFileURL(join(unpacked, 'index.js')).href)
assert.equal(typeof host.apply, 'function') // Import only: do not activate services.
const core = await import(pathToFileURL(join(unpacked, 'core/index.js')).href)
assert.equal(typeof core.execute, 'function')
for (const file of listed) {
  if (file.startsWith('core/') && file.endsWith('.js')) {
    await import(pathToFileURL(join(unpacked, file)).href)
  }
}
let client
vm.runInNewContext(await fs.readFile(join(unpacked, 'client.js'), 'utf8'), {
  window: { __ModuleLoader__: { load(definition) { client = definition } } }
}, { filename: 'packed-client.js', timeout: 5000 })
assert.equal(client?.id, manifest.name)
assert.equal(typeof client.factory, 'function')
for (const locale of ['en', 'zh']) {
  JSON.parse(await fs.readFile(join(unpacked, 'locale', `${locale}.json`), 'utf8'))
}

// Tests are intentionally not distributed. Stage them beside the extracted
// core so their relative imports cannot accidentally exercise the source tree.
await fs.mkdir(join(unpacked, 'test'))
const tests = []
for (const name of await fs.readdir(join(root, 'test'))) {
  if (!name.endsWith('.js')) continue
  await fs.copyFile(join(root, 'test', name), join(unpacked, 'test', name))
  if (name.endsWith('.test.js')) tests.push(`test/${name}`)
}
const testOutput = run(process.execPath, ['--test', ...tests], unpacked)
await fs.writeFile(join(work, 'core-tests.log'), testOutput)
console.log(testOutput)
const summary = {
  node: process.version,
  package: `${manifest.name}@${manifest.version}`,
  engines: manifest.engines,
  archive,
  integrity: pack.integrity,
  files: listed.size,
  compressedBytes: pack.size,
  unpackedBytes: pack.unpackedSize,
  catalog: (await import(pathToFileURL(join(unpacked, 'core/catalog.js')).href)).getWordCatalog().lists.map(({ id, total, playableCount }) => ({ id, total, playableCount })),
  checks: ['archive file coverage', 'source byte equality', 'license', 'exports and bundle',
    'host/core imports without activation', 'client module registration', 'locale JSON',
    'all domain, Host adapter and React DOM tests against extracted package', 'catalog checksum and complete contracts'],
  notVerified: ['DSH install/start/uninstall', 'actual host rendering and speech quality', 'Store policy approval']
}
await fs.writeFile(join(work, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
