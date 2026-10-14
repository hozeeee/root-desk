import { access, readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electronDir = join(root, 'node_modules', 'electron')
let metadata
try { metadata = JSON.parse(await readFile(join(electronDir, 'package.json'), 'utf8')) }
catch { throw new Error('请先运行 npm install 安装 Electron 依赖') }

async function installed() {
  try {
    const binary = (await readFile(join(electronDir, 'path.txt'), 'utf8')).trim()
    const dist = join(electronDir, 'dist')
    const path = resolve(dist, binary)
    if (!binary || isAbsolute(binary) || relative(dist, path).startsWith('..')) return false
    const version = (await readFile(join(dist, 'version'), 'utf8')).trim().replace(/^v/, '')
    if (version !== metadata.version) return false
    await access(path)
    return true
  } catch { return false }
}
if (await installed()) process.exit(0)

const official = typeof metadata.bin === 'object' ? metadata.bin['install-electron'] : undefined
const installer = join(electronDir, official || 'install.js')
await access(installer)
const cache = join(root, 'node_modules', '.cache', 'electron')
const env = { ...process.env, ELECTRON_CACHE: cache, electron_config_cache: cache }
for (const key of ['ELECTRON_SKIP_BINARY_DOWNLOAD', 'ELECTRON_MIRROR', 'ELECTRON_CUSTOM_DIR', 'ELECTRON_CUSTOM_FILENAME', 'NODE_TLS_REJECT_UNAUTHORIZED']) delete env[key]
console.log(`[prepare:electron] 使用官方安装器安装 Electron ${metadata.version}`)
await new Promise((resolvePromise, reject) => {
  const child = spawn(process.execPath, [installer], { cwd: electronDir, stdio: 'inherit', shell: false, env })
  child.once('error', reject)
  child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`Electron 官方安装器退出码 ${code}`)))
})
if (!await installed()) throw new Error('Electron 安装后路径或版本验证失败')
