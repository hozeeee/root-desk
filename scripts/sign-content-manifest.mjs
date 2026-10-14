import { createPrivateKey, sign } from 'node:crypto'
import { lstat, open, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// node scripts/sign-content-manifest.mjs <unsigned.json> <private-key.pem> <rootdesk-manifest.json>
const [input, keyFile, output] = process.argv.slice(2)
if (!input || !keyFile || !output) throw new Error('用法：unsigned.json private-key.pem rootdesk-manifest.json（仅本地签名；输出不覆盖）')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const inside = (path) => { const rel = relative(root, path); if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('清单输入和输出必须位于本项目内') }
const source = await realpath(resolve(input)); inside(source)
const destination = resolve(output); inside(destination); inside(await realpath(dirname(destination)))
const info = await lstat(source)
if (!info.isFile() || info.size > 128 * 1024) throw new Error('清单大小无效')
const raw = JSON.parse(await readFile(source, 'utf8'))
if (Object.keys(raw).sort().join(',') !== 'files,schemaVersion,version' || raw.schemaVersion !== 1 || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(raw.version) || !Array.isArray(raw.files) || raw.files.length !== 2) throw new Error('清单格式无效')
const names = new Set()
const files = raw.files.map((file) => {
  if (Object.keys(file).sort().join(',') !== 'bytes,name,sha256,url' || !['catalog.json', 'tools.json'].includes(file.name) || names.has(file.name) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 1 || file.bytes > 16 * 1024 ** 2) throw new Error('清单文件条目无效')
  const url = new URL(file.url)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port || url.hash || url.search || !url.pathname.endsWith(`/releases/download/${encodeURIComponent(raw.version)}/${file.name}`)) throw new Error('清单 URL 必须是相同版本 GitHub Release 资产')
  names.add(file.name)
  return { name: file.name, url: file.url, sha256: file.sha256, bytes: file.bytes }
})
if (new URL(files[0].url).pathname.split('/').slice(0, 3).join('/') !== new URL(files[1].url).pathname.split('/').slice(0, 3).join('/')) throw new Error('文件必须属于同一仓库')
const privateKey = createPrivateKey(await readFile(resolve(keyFile), 'utf8'))
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('私钥必须是 Ed25519 PEM；私钥不得上传或放入资源包')
const payload = { schemaVersion: 1, version: raw.version, files }
const signature = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64')
const handle = await open(destination, 'wx', 0o600)
try { await handle.writeFile(JSON.stringify({ ...payload, signature }, null, 2) + '\n'); await handle.sync() }
finally { await handle.close() }
console.log(`已签名：${destination}（发布此文件与 catalog.json/tools.json，勿发布私钥）`)
