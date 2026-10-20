import { promises as fs } from 'node:fs'
import { basename, dirname } from 'node:path'

/** Read a UTF-8 JSON file, tolerating a missing or corrupt file. */
async function tryRead(file) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return { ok: false, missing: true }
    return { ok: false, missing: false, error }
  }
  if (!text.trim()) return { ok: false, missing: false, error: new Error('empty file') }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, missing: false, error }
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/**
 * Read `file`, falling back to `file.bak` when the main copy is unusable.
 * Never throws for a missing or corrupt file: returns the fallback plus a
 * human-readable warning the caller can surface.
 */
export async function readJson(file, fallback) {
  const main = await tryRead(file)
  if (main.ok) return { value: main.value, warning: null }

  const backup = await tryRead(`${file}.bak`)
  const name = basename(file)

  if (main.missing) {
    return backup.ok
      ? { value: backup.value, warning: `${name} 不存在，已从备份恢复` }
      : { value: clone(fallback), warning: null }
  }
  if (backup.ok) {
    return { value: backup.value, warning: `${name} 已损坏，已回退到上一个可用版本` }
  }
  return { value: clone(fallback), warning: `${name} 已损坏且没有可用备份，已按空数据继续` }
}

/**
 * Write JSON atomically: the previous copy is kept as `.bak`, the new bytes go
 * to a temporary file, then a single rename publishes them. A crash between
 * any two steps leaves either the old file or the new one, never half of each.
 */
export async function writeJson(file, value) {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  const text = `${JSON.stringify(value, null, 2)}\n`
  await fs.writeFile(tmp, text, 'utf8')
  try {
    await fs.copyFile(file, `${file}.bak`)
  } catch (error) {
    if (!error || error.code !== 'ENOENT') {
      await fs.rm(tmp, { force: true })
      throw error
    }
  }
  try {
    await fs.rename(tmp, file)
  } catch (error) {
    await fs.rm(tmp, { force: true })
    throw error
  }
}

/** Replace a whole JSONL file atomically. */
export async function writeJsonl(file, records) {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  const text = records.length ? `${records.map((record) => JSON.stringify(record)).join('\n')}\n` : ''
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
}

/** Write text through a temp file and a rename, so a reader never sees half. */
export async function writeText(file, text) {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`
  await fs.writeFile(tmp, text, 'utf8')
  await fs.rename(tmp, file)
}

/** Append one JSON line, creating the parent directory when needed. */
export async function appendJsonl(file, record) {
  await fs.mkdir(dirname(file), { recursive: true })
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
}

/** Read a JSONL file into an array, skipping lines that no longer parse. */
export async function readJsonl(file) {
  let text
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* a torn tail line is not worth failing the read */
    }
  }
  return out
}

/** List a directory, returning [] when it does not exist yet. */
export async function listDir(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

export async function pathExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
