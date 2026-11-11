import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'

export function createId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

export function nowIso() {
  return new Date().toISOString()
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function shortHash(value, length = 10) {
  return sha256(value).slice(0, length)
}

export function stableStringify(value) {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

export async function ensureDir(path) {
  await mkdir(path, { recursive: true })
  return path
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback
    throw error
  }
}

export async function atomicWriteJson(path, value) {
  await ensureDir(dirname(path))
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temp, path)
}

export async function atomicWrite(path, value) {
  await ensureDir(dirname(path))
  const temp = `${path}.${randomUUID()}.tmp`
  await writeFile(temp, value)
  await rename(temp, path)
}

export function safeJoin(root, child) {
  const base = resolve(root)
  const target = resolve(base, child)
  const rel = relative(base, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escapes its root: ${child}`)
  }
  return target
}

export function normalizeRelative(root, target) {
  return normalize(relative(root, target)).replaceAll('\\', '/')
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function parseDataUrl(value) {
  if (typeof value !== 'string') return undefined
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/su.exec(value)
  if (!match) return undefined
  const mediaType = match[1] || 'application/octet-stream'
  const body = match[3] ?? ''
  return {
    mediaType,
    data: match[2] ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8'),
  }
}

export function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Minimal raster dimension reader for the formats the canvas accepts. */
export function imageDimensions(buffer) {
  if (!buffer || buffer.length < 16) return undefined
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), mediaType: 'image/png' }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
          mediaType: 'image/jpeg',
        }
      }
      offset += 2 + length
    }
  }
  if (buffer.toString('ascii', 0, 4) === 'GIF8') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8), mediaType: 'image/gif' }
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        mediaType: 'image/webp',
      }
    }
    if (chunk === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
        mediaType: 'image/webp',
      }
    }
  }
  return undefined
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function asArray(value) {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
}

export function assertString(value, name, { min = 1, max = 4000 } = {}) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max) {
    throw new Error(`${name} must be a string between ${min} and ${max} characters`)
  }
  return value
}

export function optionalString(value, name, max = 4000) {
  if (value === undefined || value === null || value === '') return undefined
  return assertString(value, name, { min: 1, max })
}

export function relativeToRoot(root, absolutePath) {
  return normalizeRelative(root, join(root, relative(root, absolutePath)))
}
