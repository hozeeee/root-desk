import { createHash, createPublicKey, verify } from 'node:crypto'
import { z } from 'zod'
import { catalogSchema, toolsDocumentSchema } from '@shared/schemas'
import type { Catalog, CommandsDocument, ToolsDocument } from '@shared/schemas'
import { isPublicHttpsUrl } from './network'

export const MAX_CONTENT_BYTES = 16 * 1024 ** 2
export const MAX_MANIFEST_BYTES = 128 * 1024
export const contentVersion = z.string().regex(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), version: contentVersion,
  files: z.array(z.object({
    name: z.enum(['catalog.json', 'tools.json']), url: z.string().refine(isPublicHttpsUrl),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(MAX_CONTENT_BYTES)
  }).strict()).length(2).refine((files) => new Set(files.map((file) => file.name)).size === 2, '必须且只能包含 catalog.json 和 tools.json'),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/)
}).strict()
export type UpdateManifest = z.infer<typeof manifestSchema>

export function signaturePayload(manifest: Pick<UpdateManifest, 'schemaVersion' | 'version' | 'files'>): Buffer {
  return Buffer.from(JSON.stringify({ schemaVersion: manifest.schemaVersion, version: manifest.version,
    files: manifest.files.map(({ name, url, sha256, bytes }) => ({ name, url, sha256, bytes })) }))
}
export function verifyManifest(manifest: UpdateManifest, pem: string): void {
  if (!pem.trim().startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('必须配置可信 Ed25519 PEM 公钥')
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('内容公钥必须为 Ed25519')
  const signature = Buffer.from(manifest.signature, 'base64')
  if (signature.length !== 64 || signature.toString('base64') !== manifest.signature || !verify(null, signaturePayload(manifest), key, signature)) {
    throw new Error('内容清单签名校验失败')
  }
}
export function verifyContentBytes(data: Buffer, file: UpdateManifest['files'][number]): void {
  if (data.length !== file.bytes || data.length > MAX_CONTENT_BYTES) throw new Error(`${file.name} 字节数校验失败`)
  if (createHash('sha256').update(data).digest('hex') !== file.sha256) throw new Error(`${file.name} SHA-256 校验失败`)
}
export function normalizeVersion(version: string): string { return version.replace(/^v/, '') }
export function isNewerVersion(latest: string, current: string): boolean {
  const a = contentVersion.parse(latest).replace(/^v/, '').split('.').map(Number)
  const b = contentVersion.parse(current).replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}
export function repositoryName(value: string): string {
  if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(value) || value.split('/').some((part) => part === '.' || part === '..')) throw new Error('仓库格式应为 owner/repo')
  return value
}
export function isRepositoryAsset(value: string, repository: string, tag: string, name: string): boolean {
  try {
    const url = new URL(value)
    return isPublicHttpsUrl(value) && url.hostname === 'github.com' && !url.search &&
      url.pathname === `/${repository}/releases/download/${encodeURIComponent(tag)}/${name}`
  } catch { return false }
}
export function githubAssetPolicy(initial: string): (value: string) => boolean {
  return (value) => value === initial || (isPublicHttpsUrl(value) &&
    ['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(new URL(value).hostname))
}

export function validateContent(catalogBytes: Buffer, toolsBytes: Buffer, expectedVersion: string, commands: CommandsDocument): { catalog: Catalog; tools: ToolsDocument } {
  const catalog = catalogSchema.parse(JSON.parse(catalogBytes.toString('utf8')))
  const tools = toolsDocumentSchema.parse(JSON.parse(toolsBytes.toString('utf8')))
  if (catalog.schemaVersion !== 1 || tools.schemaVersion !== 1 || normalizeVersion(catalog.version) !== normalizeVersion(expectedVersion) || normalizeVersion(tools.version) !== normalizeVersion(expectedVersion)) throw new Error('内容 schemaVersion 或版本与清单不符')
  const unique = (values: string[], label: string): void => { if (new Set(values).size !== values.length) throw new Error(`${label} ID 重复`) }
  unique(catalog.brands.map((brand) => brand.id), '品牌')
  unique(catalog.brands.flatMap((brand) => brand.devices.map((device) => device.id)), '设备')
  unique(tools.tools.map((tool) => tool.id), '工具')
  const toolIds = new Set(tools.tools.map((tool) => tool.id))
  const commandIds = new Set(commands.commands.map((command) => command.id))
  for (const brand of catalog.brands) for (const device of brand.devices) {
    unique(device.steps.map((step) => step.id), '步骤')
    for (const tool of device.tools) if (!toolIds.has(tool)) throw new Error(`设备 ${device.id} 引用了不存在的工具 ${tool}`)
    // Whitespace-containing command text is documentation only; bare IDs must resolve to seed commands.
    for (const step of [...device.steps, ...device.rollback]) for (const command of step.commands) {
      if (/^[a-zA-Z0-9._-]+$/.test(command) && !commandIds.has(command)) throw new Error(`步骤引用了不存在的捆绑命令 ${command}`)
    }
  }
  return { catalog, tools }
}
