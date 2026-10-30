import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const scopes = new WeakMap()
function scope(t) {
  if (!scopes.has(t)) {
    const value = { roots: new Map(), disposers: [] }
    scopes.set(t, value)
    t.after(async () => {
      const errors = []
      for (const dispose of value.disposers.reverse()) {
        try { await dispose() } catch (cause) { errors.push(cause) }
      }
      // Do not remove files while a failed disposer may still be using them.
      if (errors.length) throw new AggregateError(errors, 'Test fixture shutdown failed')
      for (const [path, owned] of value.roots) {
        try {
          assert.equal(dirname(path), owned.parent)
          assert.match(basename(path), new RegExp(`^${owned.prefix}[A-Za-z0-9]{6}$`))
          assert.equal(await fs.realpath(path), path)
          const current = await fs.lstat(path)
          assert.ok(current.isDirectory() && !current.isSymbolicLink())
          assert.equal(current.dev, owned.identity.dev); assert.equal(current.ino, owned.identity.ino)
          await fs.rm(path, { recursive: true })
        } catch (cause) { errors.push(cause) }
      }
      if (errors.length) throw new AggregateError(errors, 'Test fixture removal failed')
    })
  }
  return scopes.get(t)
}

// Test-owned roots only. A reboot may reuse a root created by this TestContext;
// caller-provided directories are never claimed or recursively removed.
export async function tempFixture(t, prefix, directory) {
  const value = scope(t)
  if (directory !== undefined) {
    assert.ok(value.roots.has(directory), 'A reused fixture must belong to this test')
    assert.equal(value.roots.get(directory).prefix, prefix)
    assert.equal(await fs.realpath(directory), directory)
    return directory
  }
  assert.match(prefix, /^[a-z][a-z0-9-]+-$/)
  const parent = await fs.realpath(tmpdir())
  const path = await fs.mkdtemp(join(parent, prefix))
  const identity = await fs.lstat(path)
  value.roots.set(path, { parent, prefix, identity })
  return path
}

export function disposeFixture(t, dispose) {
  scope(t).disposers.push(dispose)
}
