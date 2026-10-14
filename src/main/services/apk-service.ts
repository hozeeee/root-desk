import { stat } from 'node:fs/promises'
import { basename, isAbsolute } from 'node:path'
import { dialog } from 'electron'
import type { ApkInstallRequest, ApkSelection, CommandRun } from '@shared/contracts'
import { isApkPath } from '@main/security/validation'
import { fingerprintFile, type FileFingerprint } from '@main/security/command-policy'
import type { CommandService } from './command-service'

export class ApkService {
  private readonly approved = new Map<string, FileFingerprint>()

  constructor(private readonly commands: CommandService) {}

  async choose(): Promise<ApkSelection> {
    const result = await dialog.showOpenDialog({
      title: '选择要安装的 APK',
      properties: ['openFile'],
      filters: [{ name: 'Android 应用安装包', extensions: ['apk'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const filePath = result.filePaths[0]
    if (!isAbsolute(filePath) || !isApkPath(filePath)) throw new Error('请选择有效的 APK 绝对路径')
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('所选路径不是普通文件')
    const fingerprint = fingerprintFile(filePath)
    // Permission is native-dialog issued, bounded, and bound to the actual file identity/content.
    while (this.approved.size >= 32) this.approved.delete(this.approved.keys().next().value!)
    this.approved.set(filePath, fingerprint)
    return { canceled: false, filePath, fileName: basename(filePath), size: fingerprint.size }
  }

  async install(request: ApkInstallRequest): Promise<CommandRun> {
    const input = { ...request }
    if (!isAbsolute(input.filePath) || !isApkPath(input.filePath) || !this.approved.has(input.filePath)) throw new Error('请先通过文件选择器选择 APK')
    const selected = this.approved.get(input.filePath)!
    if (JSON.stringify(selected) !== JSON.stringify(fingerprintFile(input.filePath))) {
      this.approved.delete(input.filePath)
      throw new Error('APK 文件已变化，请重新选择并确认')
    }
    // No await between verifying the dialog fingerprint and CommandService taking its snapshot.
    const run = await this.commands.installApk(input.filePath, input)
    this.approved.delete(input.filePath)
    return run
  }
}
