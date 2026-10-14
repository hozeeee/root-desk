import { access, chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { app } from 'electron'
import type { BinaryStatus, ConnectedDevice } from '@shared/contracts'
import type { SettingsService } from './settings-service'
import { downloadFile } from '@main/security/network'
import { quarantineFile } from '@main/security/quarantine'
import { extractPlatformToolsZip } from '@main/security/archive-validation'

export interface SpawnResult { code: number | null; stdout: string; stderr: string }

export class PlatformToolsService {
  private installing: Promise<BinaryStatus[]> | null = null
  constructor(private readonly settings: SettingsService) {}

  install(): Promise<BinaryStatus[]> {
    if (this.installing) return this.installing
    const result = this.installNow()
    this.installing = result
    void result.then(() => { this.installing = null })
    return result
  }

  private async installNow(): Promise<BinaryStatus[]> {
    let partial: string | undefined
    try {
      if (!['darwin', 'win32'].includes(process.platform)) throw new Error('自动安装仅支持 macOS 和 Windows，请使用 Google 官方安装指南')
      const root = join(app.getPath('userData'), 'cache', 'platform-tools')
      await mkdir(root, { recursive: true, mode: 0o700 })
      if (await realpath(root) !== root || (await lstat(root)).isSymbolicLink()) throw new Error('工具缓存目录不能是符号链接')
      const work = await mkdtemp(join(root, 'install-'))
      partial = join(work, 'platform-tools.zip.part')
      const platform = process.platform === 'win32' ? 'windows' : 'darwin'
      const url = `https://dl.google.com/android/repository/platform-tools-latest-${platform}.zip`
      await downloadFile(url, partial, { maxBytes: 100 * 1024 ** 2, policy: (value) => value === url })
      const archive = join(work, 'platform-tools.zip')
      await rename(partial, archive)
      partial = undefined
      const stage = join(work, 'extracted')
      await mkdir(stage, { mode: 0o700 })
      await extractPlatformToolsZip(archive, stage)
      const tools = join(stage, 'platform-tools')
      const revision = /(?:^|\n)Pkg\.Revision\s*=\s*(\d+\.\d+\.\d+)(?:\s|$)/.exec(await readFile(join(tools, 'source.properties'), 'utf8'))?.[1]
      if (!revision) throw new Error('官方包缺少有效版本元数据')
      const statuses: BinaryStatus[] = []
      for (const name of ['adb', 'fastboot'] as const) {
        const binary = join(tools, process.platform === 'win32' ? `${name}.exe` : name)
        const info = await lstat(binary)
        if (!info.isFile() || info.isSymbolicLink() || await realpath(binary) !== binary) throw new Error('工具二进制文件类型不安全')
        if (process.platform !== 'win32') await chmod(binary, 0o755)
        const result = await spawnCapture(binary, [name === 'adb' ? 'version' : '--version'], 10_000)
        const output = result.stdout || result.stderr
        const verified = name === 'adb' ? /^Android Debug Bridge version \d+\.\d+\.\d+/m.test(output) && output.includes(`Version ${revision}`) : output.includes(`fastboot version ${revision}`)
        if (result.code !== 0 || !verified) throw new Error(`${name} 官方版本验证失败：${output}`)
        statuses.push({ name, available: true, version: revision })
      }
      // Fresh, immutable version directory; existing user-selected tools and old versions are retained.
      const destination = join(root, `${revision}-${randomUUID()}`)
      await rename(stage, destination)
      const platformToolsPath = join(destination, 'platform-tools')
      await this.settings.update({ platformToolsPath })
      return statuses.map((status) => ({ ...status, path: join(platformToolsPath, process.platform === 'win32' ? `${status.name}.exe` : status.name) }))
    } catch (error) {
      let message = errorMessage(error)
      if (partial) {
        try { await quarantineFile(partial) }
        catch (cleanupError) { message += `；临时文件仍保留：${errorMessage(cleanupError)}` }
      }
      return (['adb', 'fastboot'] as const).map((name) => ({ name, available: false, error: message }))
    }
  }

  async detect(): Promise<BinaryStatus[]> {
    return Promise.all((['adb', 'fastboot'] as const).map(async (name) => {
      try {
        const path = await this.resolveBinary(name)
        const result = await spawnCapture(path, [name === 'adb' ? 'version' : '--version'], 10_000)
        if (result.code !== 0) throw new Error(result.stderr || `退出码 ${result.code}`)
        return { name, available: true, path, version: firstLine(result.stdout || result.stderr) }
      } catch (error) {
        return { name, available: false, error: errorMessage(error) }
      }
    }))
  }

  async listAdbDevices(): Promise<ConnectedDevice[]> {
    const binary = await this.resolveBinary('adb')
    const result = await spawnCapture(binary, ['devices', '-l'], 15_000)
    if (result.code !== 0) throw new Error(result.stderr || 'adb devices 执行失败')
    return result.stdout.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map(parseDeviceLine)
  }

  async listFastbootDevices(): Promise<ConnectedDevice[]> {
    const binary = await this.resolveBinary('fastboot')
    const result = await spawnCapture(binary, ['devices'], 15_000)
    if (result.code !== 0) throw new Error(result.stderr || 'fastboot devices 执行失败')
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [serial, state = 'fastboot'] = line.split(/\s+/)
      return { serial, state }
    })
  }

  async resolveBinary(name: 'adb' | 'fastboot'): Promise<string> {
    const executable = process.platform === 'win32' ? `${name}.exe` : name
    const custom = this.settings.get().platformToolsPath
    const candidates: string[] = []
    if (custom) {
      if (!isAbsolute(custom)) throw new Error('Platform Tools 路径必须是绝对路径')
      const isBinary = /^(adb|fastboot)(\.exe)?$/i.test(basename(custom))
      candidates.push(join(isBinary ? dirname(resolve(custom)) : resolve(custom), executable))
    }
    for (const segment of (process.env.PATH ?? '').split(delimiter).filter(isAbsolute)) candidates.push(join(segment, executable))
    for (const candidate of candidates) {
      try {
        await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
        return candidate
      } catch { /* continue */ }
    }
    throw new Error(`${name} 未找到，请安装 Android Platform Tools 或在设置中指定路径`)
  }
}

export function spawnCapture(executable: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, cwd: dirname(executable) })
    let stdout = ''
    let stderr = ''
    let bytes = 0
    const stop = (message: string): void => { child.kill('SIGKILL'); reject(new Error(message)) }
    const timer = setTimeout(() => stop('工具版本/设备检测超时'), timeoutMs)
    const capture = (chunk: Buffer, target: 'stdout' | 'stderr'): void => {
      bytes += chunk.length
      if (bytes > 1024 * 1024) { clearTimeout(timer); stop('工具输出超过安全上限'); return }
      if (target === 'stdout') stdout += chunk.toString('utf8')
      else stderr += chunk.toString('utf8')
    }
    child.stdout.on('data', (chunk: Buffer) => capture(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => capture(chunk, 'stderr'))
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', (code) => { clearTimeout(timer); resolvePromise({ code, stdout, stderr }) })
  })
}

function parseDeviceLine(line: string): ConnectedDevice {
  const [serial = '', state = 'unknown', ...properties] = line.split(/\s+/)
  const fields = Object.fromEntries(properties.map((item) => item.split(':', 2)).filter((entry) => entry.length === 2))
  return { serial, state, product: fields.product, model: fields.model, device: fields.device, transportId: fields.transport_id }
}
function firstLine(value: string): string { return value.trim().split(/\r?\n/)[0] ?? '' }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
