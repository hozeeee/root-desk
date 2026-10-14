import { createWriteStream } from 'node:fs'
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, posix, relative } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform } from 'node:stream'
import yauzl, { type Entry, type ZipFile } from 'yauzl'

export interface ZipEntryMetadata {
  fileName: string; externalFileAttributes: number; uncompressedSize: number; generalPurposeBitFlag: number
}
const MAX_ENTRY_BYTES = 100 * 1024 ** 2
const MAX_TOTAL_BYTES = 250 * 1024 ** 2
const MAX_ENTRIES = 5000

export function validateZipEntry(entry: ZipEntryMetadata, seen: Set<string>): number {
  const name = entry.fileName
  const parts = name.replace(/\/$/, '').split('/')
  if (!name.startsWith('platform-tools/') || isAbsolute(name) || name.includes('\\') || /[\u0000-\u001f:]/.test(name) ||
      parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) || posix.normalize(name) !== name) throw new Error(`ZIP 路径不安全：${name}`)
  const normalized = name.replace(/\/$/, '').normalize('NFC').toLowerCase()
  if (seen.has(normalized)) throw new Error(`ZIP 存在重复路径：${name}`)
  seen.add(normalized)
  const type = (entry.externalFileAttributes >>> 16) & 0xf000
  if (type && type !== 0x8000 && type !== 0x4000) throw new Error('ZIP 禁止 symlink 或特殊文件')
  if (type === 0x4000 && !name.endsWith('/')) throw new Error('ZIP 目录条目格式无效')
  if (entry.generalPurposeBitFlag & 1) throw new Error('ZIP 禁止加密条目')
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 || entry.uncompressedSize > MAX_ENTRY_BYTES) throw new Error('ZIP 条目大小超限')
  return entry.uncompressedSize
}

function openZip(file: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, strictFileNames: true, validateEntrySizes: true, decodeStrings: true }, (error, zip) => error ? reject(error) : resolve(zip)))
}
async function entries(zip: ZipFile, onEntry: (entry: Entry) => Promise<void>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let failed = false
    zip.once('end', () => { if (!failed) resolve() })
    zip.once('error', (error) => { failed = true; reject(error) })
    zip.on('entry', (entry: Entry) => {
      void onEntry(entry).then(() => zip.readEntry(), (error) => { failed = true; reject(error) })
    })
    zip.readEntry()
  })
}
function readStream(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => error ? reject(error) : resolve(stream)))
}

// Two passes: validate the whole central directory before any filesystem writes, then extract only regular files.
export async function extractPlatformToolsZip(archive: string, destination: string): Promise<void> {
  const root = await realpath(destination)
  if ((await lstat(root)).isSymbolicLink()) throw new Error('解压目录不能是符号链接')
  let zip = await openZip(archive)
  try {
    const seen = new Set<string>()
    let total = 0
    let count = 0
    await entries(zip, async (entry) => {
      if (++count > MAX_ENTRIES) throw new Error('ZIP 条目数超限')
      total += validateZipEntry(entry, seen)
      if (total > MAX_TOTAL_BYTES) throw new Error('ZIP 解压总大小超限')
    })
  } finally { zip.close() }
  zip = await openZip(archive)
  try {
    await entries(zip, async (entry) => {
      const target = join(root, ...entry.fileName.replace(/\/$/, '').split('/'))
      const rel = relative(root, target)
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('ZIP 路径越界')
      if (entry.fileName.endsWith('/')) { await mkdir(target, { recursive: true, mode: 0o700 }); return }
      const parent = join(target, '..')
      await mkdir(parent, { recursive: true, mode: 0o700 })
      const realParent = await realpath(parent)
      const parentRel = relative(root, realParent)
      if (parentRel.startsWith('..') || isAbsolute(parentRel)) throw new Error('ZIP 父目录越界')
      let written = 0
      const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length
        callback(written > entry.uncompressedSize ? new Error('ZIP 条目实际大小超限') : null, chunk)
      } })
      await pipeline(await readStream(zip, entry), limit, createWriteStream(target, { flags: 'wx', mode: 0o600 }))
      if (written !== entry.uncompressedSize) throw new Error('ZIP 条目大小不一致')
    })
  } finally { zip.close() }
}
