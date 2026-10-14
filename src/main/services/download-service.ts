import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import type { DownloadTask } from '@shared/contracts'
import { safeFileName } from '@main/security/validation'
import { downloadFile, isPublicHttpsUrl, MAX_DOWNLOAD_BYTES } from '@main/security/network'
import { quarantineFile } from '@main/security/quarantine'

export class DownloadService {
  private readonly tasks = new Map<string, DownloadTask>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly completedFiles = new Map<string, { ino: number; dev: number; size: number }>()
  private readonly directory = join(app.getPath('downloads'), 'RootDesk')
  private running = 0
  private disposed = false

  list(): DownloadTask[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((task) => ({ ...task }))
  }

  async start(input: { url: string; fileName?: string; sha256?: string }): Promise<DownloadTask> {
    if (this.disposed) throw new Error('下载服务已关闭')
    if (!isPublicHttpsUrl(input.url)) throw new Error('下载仅允许无凭证的公网 HTTPS URL（443）')
    if (input.sha256 && !/^[a-fA-F0-9]{64}$/.test(input.sha256)) throw new Error('SHA-256 格式无效')
    const candidate = input.fileName ?? (basename(new URL(input.url).pathname) || 'download.bin')
    const fileName = safeFileName(candidate)
    if (!fileName) throw new Error('下载文件名无效')
    await mkdir(this.directory, { recursive: true })
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('下载目录不能是符号链接')
    if (this.disposed) throw new Error('下载服务已关闭')
    if ([...this.tasks.values()].filter((task) => task.status === 'queued').length >= 100) throw new Error('下载队列已满')
    const id = randomUUID()
    const task: DownloadTask = {
      id, url: input.url, fileName, destination: join(this.directory, `${id}-${fileName}`),
      expectedSha256: input.sha256?.toLowerCase(), receivedBytes: 0,
      status: 'queued', createdAt: new Date().toISOString()
    }
    this.tasks.set(id, task)
    const result = { ...task }
    this.pump()
    return result
  }

  cancel(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || !['queued', 'downloading', 'verifying'].includes(task.status)) return false
    task.status = 'cancelled'
    this.controllers.get(id)?.abort()
    return true
  }

  async reveal(id: string): Promise<boolean> {
    const task = this.tasks.get(id)
    const identity = this.completedFiles.get(id)
    if (!task || task.status !== 'completed' || !identity) return false
    try {
      const file = await lstat(task.destination)
      if (!file.isFile() || file.isSymbolicLink() || file.ino !== identity.ino || file.dev !== identity.dev || file.size !== identity.size) return false
      if (await realpath(task.destination) !== task.destination || (await lstat(this.directory)).isSymbolicLink()) return false
      shell.showItemInFolder(task.destination)
      return true
    } catch { return false }
  }

  dispose(): void { this.disposed = true; for (const task of this.tasks.values()) this.cancel(task.id) }

  private pump(): void {
    for (const task of this.tasks.values()) {
      if (this.disposed || this.running >= 3) break
      if (task.status !== 'queued') continue
      task.status = 'downloading'
      this.running++
      void this.download(task).finally(() => { this.running--; this.pump() })
    }
  }

  private async download(task: DownloadTask): Promise<void> {
    const temporary = `${task.destination}.part`
    const controller = new AbortController()
    this.controllers.set(task.id, controller)
    let published = false
    try {
      const result = await downloadFile(task.url, temporary, {
        maxBytes: MAX_DOWNLOAD_BYTES, signal: controller.signal,
        progress: (bytes, total) => { task.receivedBytes = bytes; task.totalBytes = total }
      })
      controller.signal.throwIfAborted()
      task.status = 'verifying'
      if (task.expectedSha256 && result.sha256 !== task.expectedSha256) throw new Error(`SHA-256 校验失败：${result.sha256}`)
      controller.signal.throwIfAborted()
      // link() is an atomic no-replace publish; rename() would overwrite an existing user file.
      await link(temporary, task.destination)
      published = true
      controller.signal.throwIfAborted()
      const file = await lstat(task.destination)
      this.completedFiles.set(task.id, { ino: file.ino, dev: file.dev, size: file.size })
      task.status = 'completed'
    } catch (error) {
      if (task.status !== 'cancelled') { task.status = 'failed'; task.error = errorMessage(error) }
      if (published) {
        try { await quarantineFile(task.destination) }
        catch (cleanupError) { task.error = `${task.error ?? '下载取消'}；保留目标文件：${errorMessage(cleanupError)}` }
      }
    } finally {
      try { await quarantineFile(temporary) }
      catch (error) { task.error = `${task.error ?? ''}；临时文件仍保留：${errorMessage(error)}` }
      this.controllers.delete(task.id)
    }
  }
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
