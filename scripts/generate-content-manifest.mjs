import { createHash } from 'node:crypto'
import { lstat, open, realpath, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalogSchema, toolsDocumentSchema } from '../src/shared/schemas.ts'

// node --experimental-strip-types scripts/generate-content-manifest.mjs owner/repo 1.2.3 <content-dir> <output.json>
const [repository, version, input, output] = process.argv.slice(2)
if (!repository || !/^[\w-][\w.-]*\/[\w-][\w.-]*$/.test(repository) || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? '') || !input || !output) throw new Error('用法：owner/repo version content-directory output.json（输出不覆盖已有文件）')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inside = (path) => { const rel = relative(root, path); if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('输入内容和输出必须位于本项目内') }
const directory = await realpath(resolve(input)); inside(directory)
const destination = resolve(output); inside(destination); inside(await realpath(dirname(destination)))
const documents = {}
const files = []
for (const name of ['catalog.json', 'tools.json']) {
  const path = join(directory, name)
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 ** 2) throw new Error(`${name} 类型或大小无效`)
  const data = await readFile(path)
  if (data.length > 16 * 1024 ** 2) throw new Error('内容大小超限')
  const schema = name === 'catalog.json' ? catalogSchema : toolsDocumentSchema
  const document = schema.parse(JSON.parse(data.toString('utf8')))
  if (document.schemaVersion !== 1 || document.version.replace(/^v/, '') !== version.replace(/^v/, '')) throw new Error('所有文件的 schemaVersion/版本必须与清单一致')
  documents[name] = document
  files.push({ name, url: `https://github.com/${repository}/releases/download/${encodeURIComponent(version)}/${name}`,
    sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length })
}
const tools = new Set(documents['tools.json'].tools.map((tool) => tool.id))
if (tools.size !== documents['tools.json'].tools.length) throw new Error('工具 ID 重复')
const devices = new Set()
for (const brand of documents['catalog.json'].brands) for (const device of brand.devices) {
  if (devices.has(device.id)) throw new Error('设备 ID 重复')
  devices.add(device.id)
  for (const tool of device.tools) if (!tools.has(tool)) throw new Error(`缺失工具引用 ${tool}`)
}
const handle = await open(destination, 'wx', 0o600)
try { await handle.writeFile(JSON.stringify({ schemaVersion: 1, version, files }, null, 2) + '\n'); await handle.sync() }
finally { await handle.close() }
console.log(`已生成未签名清单：${destination}`)
