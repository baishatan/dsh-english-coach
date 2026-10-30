import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
await fs.mkdir(join(work, 'empty-home'))
const env = {
  ...process.env,
  HOME: join(work, 'empty-home'),
  DSH_HOME: join(work, 'empty-home', 'dsh'),
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
  'data/wordlists.json', 'data/manifest.json', 'data/ECDICT-LICENSE.txt', 'data/NOTICE.md',
  'speech/assets.js', 'speech/asset-manifest.js']) {
  assert.ok(listed.has(file), `Published archive is missing ${file}`)
}
for (const file of await fs.readdir(join(root, 'core'))) {
  if (file.endsWith('.js')) assert.ok(listed.has(`core/${file}`), `Missing core/${file}`)
}
for (const asset of (await import(pathToFileURL(join(root, 'speech/asset-manifest.js')).href)).assetManifest.files) {
  assert.ok(![...listed].some(file => file === asset.path || file.endsWith(`/${asset.path}`)),
    `Downloaded model/voice assets must not be bundled: ${asset.path}`)
}
assert.ok(![...listed].some((file) => /^(test|scripts|prototypes|node_modules|\.scratch)\//.test(file)),
  'Development files and throwaway prototypes must not enter the archive')
assert.ok(![...listed].some((file) => /(^|\/)(AGENTS\.md|.*\.prototype\.html)$/.test(file)),
  'Local instructions and prototype HTML must not enter the archive')
assert.ok(![...listed].some(file => file.split('/').includes('node_modules') || file.endsWith('.node')),
  'Portable vendors must not depend on nested node_modules or native addons')
for (const file of ['speech/runtime.js', 'speech/worker.js', 'speech/vendor/SOURCE.json',
  'speech/vendor/frontend.mjs', 'speech/vendor/word-g2p.mjs', 'speech/vendor/exports/DERIVATIONS.json',
  'speech/vendor/exports/us/g2p.onnx', 'speech/vendor/exports/gb/g2p.onnx',
  'speech/vendor/deps/suffix-thumb/src/test/index.js',
  'speech/vendor/notices/onnxruntime-1.31.1-ThirdPartyNotices.txt']) {
  assert.ok(listed.has(file), `Published speech runtime is missing ${file}`)
}
const vendorSource = JSON.parse(await fs.readFile(join(root, 'speech/vendor/SOURCE.json'), 'utf8'))
const vendorExpected = new Set(['speech/vendor/SOURCE.json', ...vendorSource.inventory.map(item => `speech/vendor/${item.path}`)])
assert.deepEqual(new Set([...listed].filter(file => file.startsWith('speech/vendor/'))), vendorExpected,
  'The archive must contain the exact verified portable vendor inventory')
assert.ok(['pending', 'verified'].includes(vendorSource.runtimeBinarySourceMapping.status),
  'Record the ORT corresponding-source boundary explicitly; do not erase it')
for (const item of vendorSource.downloadedAssets) {
  assert.ok(!listed.has(`speech/vendor/${item.path}`) && !listed.has(`speech/${item.path}`),
    'Large model and voices must be prepared explicitly, not bundled')
}

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
for (const item of vendorSource.inventory) {
  const bytes = await fs.readFile(join(unpacked, 'speech/vendor', item.path))
  assert.equal(bytes.length, item.bytes, `Vendor byte size differs: ${item.path}`)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256, `Vendor checksum differs: ${item.path}`)
}
for (const file of listed) {
  if (!file.startsWith('speech/') || !/\.(?:js|mjs|json|md|txt|map)$/.test(file)) continue
  const text = await fs.readFile(join(unpacked, file), 'utf8')
  assert.ok(!/(?:\/Users\/|[A-Z]:\\\\Users\\\\|(?:^|[\s'"/])\.scratch\/)/m.test(text),
    `Personal/development path must not enter the portable speech package: ${file}`)
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
// Independent import observer in the extracted artifact: only package-owned
// files and Node builtins are allowed; no bare external npm dependency/native
// addon can escape into a developer installation. fork observes its own vendor
// closure in the production worker; this hook covers the packed parent/frontend.
const closureObserver = join(unpacked, 'test', 'packed-import-closure.mjs')
await fs.writeFile(closureObserver, `
import assert from 'node:assert/strict'
import { isBuiltin, registerHooks } from 'node:module'
import { isAbsolute } from 'node:path'
const boundary = new URL('../', import.meta.url).href
registerHooks({ resolve(specifier, context, next) {
  assert.ok(isBuiltin(specifier) || specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('file:') || isAbsolute(specifier), 'No external bare dependency: ' + specifier)
  const result = next(specifier, context)
  assert.ok(result.url.startsWith('node:') || (result.url.startsWith(boundary) && !result.url.endsWith('.node')), 'Import escaped unpacked package: ' + result.url)
  return result
} })
`)
const speechOutput = run(process.execPath, ['--import', pathToFileURL(closureObserver).href, '--test', 'test/speech-runtime.test.js'], unpacked)
await fs.writeFile(join(work, 'speech-runtime-tests.log'), speechOutput)
console.log(speechOutput)
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
  speechVendor: { files: vendorExpected.size,
    bytes: vendorSource.inventory.reduce((sum, item) => sum + item.bytes, 0) + (await fs.stat(join(unpacked, 'speech/vendor/SOURCE.json'))).size,
    downloadedAssetsBundled: false, actualSynthesisRequested: Boolean(process.env.ENGLISH_COACH_TEST_ASSETS),
    ortCorrespondingSource: vendorSource.runtimeBinarySourceMapping.status },
  catalog: (await import(pathToFileURL(join(unpacked, 'core/catalog.js')).href)).getWordCatalog().lists.map(({ id, total, playableCount }) => ({ id, total, playableCount })),
  checks: ['archive file coverage', 'source byte equality', 'license', 'exports and bundle',
    'host/core imports without activation', 'client module registration', 'locale JSON',
    'all domain, Host adapter and React DOM tests against extracted package', 'catalog checksum and complete contracts',
    'exact speech vendor inventory and hashes', 'no personal paths/native addons/nested node_modules',
    'packed speech import closure and runtime tests in empty HOME/DSH_HOME'],
  notVerified: ['DSH install/start/uninstall', 'actual host rendering and speech quality', 'Store policy approval']
}
await fs.writeFile(join(work, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
