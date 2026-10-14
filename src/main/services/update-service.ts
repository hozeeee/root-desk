import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { UpdateStatus } from '@shared/contracts'
import { downloadFile, fetchBytes } from '@main/security/network'
import { contentVersion, githubAssetPolicy, isNewerVersion, isRepositoryAsset, manifestSchema,
  MAX_MANIFEST_BYTES, normalizeVersion, repositoryName, verifyManifest, type UpdateManifest } from '@main/security/content-validation'
import type { ContentService } from './content-service'
import type { SettingsService } from './settings-service'

const releaseSchema = z.object({
  tag_name: contentVersion, html_url: z.string().url(),
  assets: z.array(z.object({ name: z.string().max(200), browser_download_url: z.string().url() })).max(1000)
})
export type { UpdateManifest } from '@main/security/content-validation'

export class UpdateService {
  private status: UpdateStatus = { state: 'idle', message: '可检查指南与工具内容更新', currentVersion: 'unknown' }
  private manifest: UpdateManifest | null = null
  private busy: Promise<UpdateStatus> | null = null

  constructor(private readonly content: ContentService, private readonly settings: SettingsService) {
    if (!this.repository()) this.status = { state: 'not-configured', message: '尚未配置内容仓库', currentVersion: this.currentVersion() }
  }

  getStatus(): UpdateStatus { return { ...this.status, currentVersion: this.currentVersion() } }
  getManifest(): UpdateManifest | null { return this.manifest ? structuredClone(this.manifest) : null }
  check(): Promise<UpdateStatus> { return this.lock(() => this.checkNow()) }

  install(): Promise<UpdateStatus> {
    return this.lock(async () => {
      try {
        const publicKey = this.settings.get().contentPublicKey
        if (!publicKey) throw new Error('安装内容更新前必须配置可信 Ed25519 PEM 公钥')
        const checked = await this.checkNow()
        if (checked.state !== 'available') return checked
        const manifest = this.manifest!
        verifyManifest(manifest, publicKey)
        this.status = { ...this.status, state: 'installing', message: '正在下载并校验签名内容包…' }
        const stage = await this.content.createStage()
        for (const file of manifest.files) {
          const result = await downloadFile(file.url, join(stage, file.name), { maxBytes: file.bytes, policy: githubAssetPolicy(file.url) })
          if (result.bytes !== file.bytes || result.sha256 !== file.sha256) throw new Error(`${file.name} 字节数或 SHA-256 校验失败`)
        }
        // Abort if repository or trust configuration changed while downloads were in progress.
        if (publicKey !== this.settings.get().contentPublicKey || manifest.files.some((file) => !isRepositoryAsset(file.url, this.repository()!, manifest.version, file.name))) throw new Error('下载期间仓库或可信公钥配置已改变')
        await this.content.activate(stage, manifest, publicKey)
        this.status = { ...this.status, state: 'installed', message: `指南与工具内容 ${manifest.version} 已安装；命令白名单仍来自捆绑内容`, currentVersion: this.currentVersion() }
        return this.getStatus()
      } catch (error) { return this.setError(errorMessage(error)) }
    })
  }

  private async checkNow(): Promise<UpdateStatus> {
    this.manifest = null
    if (!this.content.getSnapshot().catalog) await this.content.load()
    const configured = this.repository()
    if (!configured) {
      this.status = { state: 'not-configured', message: '尚未配置内容仓库', currentVersion: this.currentVersion() }
      return this.getStatus()
    }
    this.status = { state: 'checking', message: '正在检查 GitHub 内容 Release…', currentVersion: this.currentVersion() }
    try {
      const repository = repositoryName(configured)
      const api = `https://api.github.com/repos/${repository}/releases/latest`
      const release = releaseSchema.parse(JSON.parse((await fetchBytes(api, 2 * 1024 ** 2, (url) => url === api)).toString('utf8')))
      const releaseUrl = `https://github.com/${repository}/releases/tag/${encodeURIComponent(release.tag_name)}`
      if (release.html_url !== releaseUrl) throw new Error('Release 页面不属于配置仓库')
      const assets = release.assets.filter((asset) => asset.name === 'rootdesk-manifest.json')
      if (assets.length !== 1 || !isRepositoryAsset(assets[0].browser_download_url, repository, release.tag_name, 'rootdesk-manifest.json')) throw new Error('Release 缺少唯一且同仓库的 rootdesk-manifest.json')
      const url = assets[0].browser_download_url
      const manifest = manifestSchema.parse(JSON.parse((await fetchBytes(url, MAX_MANIFEST_BYTES, githubAssetPolicy(url))).toString('utf8')))
      // Use an exact tag match so every URL is pinned to this same immutable release identity.
      if (manifest.version !== release.tag_name) throw new Error('清单版本与 Release tag 不一致')
      for (const file of manifest.files) {
        if (!isRepositoryAsset(file.url, repository, release.tag_name, file.name) || !release.assets.some((asset) => asset.name === file.name && asset.browser_download_url === file.url)) throw new Error(`${file.name} 不属于本仓库 Release 资产`)
      }
      const key = this.settings.get().contentPublicKey
      if (key) verifyManifest(manifest, key)
      this.manifest = manifest
      const available = isNewerVersion(normalizeVersion(manifest.version), this.currentVersion())
      this.status = {
        state: available ? 'available' : 'up-to-date', currentVersion: this.currentVersion(),
        latestVersion: manifest.version, releaseUrl,
        message: available ? `发现内容版本 ${manifest.version}${key ? '' : '；安装前须配置可信公钥'}` : '当前内容没有更新版本'
      }
      return this.getStatus()
    } catch (error) { return this.setError(errorMessage(error)) }
  }

  async verifyFile(path: string, expectedSha256: string): Promise<boolean> {
    if (!/^[a-fA-F0-9]{64}$/.test(expectedSha256)) return false
    try {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
      return hash.digest('hex') === expectedSha256.toLowerCase()
    } catch { return false }
  }

  private repository(): string | undefined { return this.settings.get().contentRepository || process.env.ROOTDESK_CONTENT_REPOSITORY || process.env.ROOTDESK_GITHUB_REPOSITORY }
  private currentVersion(): string { return this.content.getSnapshot().catalog?.version ?? 'unknown' }
  private lock(operation: () => Promise<UpdateStatus>): Promise<UpdateStatus> {
    if (this.busy) return this.busy
    const result = operation().catch((error) => this.setError(errorMessage(error)))
    this.busy = result
    void result.then(() => { this.busy = null })
    return result
  }
  private setError(message: string): UpdateStatus {
    this.manifest = null
    this.status = { state: 'error', message, currentVersion: this.currentVersion() }
    return this.getStatus()
  }
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
