import { z } from 'zod'

const id = z.string().min(1).regex(/^[a-zA-Z0-9._-]+$/)
const webUrl = z.string().url().refine((value) => {
  const url = new URL(value)
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
}, '仅支持无内嵌凭证的 HTTP(S) URL')
const metadata = {
  schemaVersion: z.number().int().positive(),
  version: z.string().min(1),
  generatedAt: z.string().datetime()
}
const contentRisk = z.enum(['low', 'medium', 'high', 'critical'])

export const sourceSchema = z.object({
  title: z.string().min(1),
  url: webUrl,
  kind: z.string().optional(),
  verifiedAt: z.string().nullable().optional()
}).strict()

export const deviceStepSchema = z.object({
  id,
  title: z.string().min(1),
  description: z.string().min(1),
  // Step commands are informational text or IDs, never execution instructions.
  commands: z.array(z.string().min(1)).default([]),
  warnings: z.array(z.string()).default([]),
  risk: contentRisk.optional()
}).strict()

const bootloaderSchema = z.union([
  z.object({ unlockable: z.boolean(), method: z.string(), notes: z.array(z.string()) }).strict(),
  z.object({ availability: z.string(), dataWipe: z.boolean(), notes: z.string() }).strict()
    .transform((value) => ({
      unlockable: value.availability === 'official' || value.availability === 'limited',
      method: value.availability === 'official' ? '官方流程（请确认精确变体资格）' : value.availability === 'limited' ? '受地区、账号和型号限制' : `资格状态：${value.availability}`,
      notes: [value.notes, ...(value.dataWipe ? ['解锁将清除用户数据'] : [])]
    }))
])
const rootStatusSchema = z.union([
  z.object({ supported: z.boolean(), methods: z.array(z.string()), notes: z.array(z.string()), status: z.enum(['verified', 'community', 'research-needed', 'blocked']).default('research-needed') }).strict(),
  z.object({ status: z.enum(['verified', 'community', 'research-needed', 'blocked']), method: z.string(), summary: z.string() }).strict()
    .transform((value) => ({ supported: ['verified', 'community'].includes(value.status), methods: [value.method], notes: [value.summary], status: value.status }))
])

export const deviceSchema = z.object({
  id,
  name: z.string().min(1),
  codenames: z.array(z.string()),
  variants: z.array(z.string()),
  androidVersions: z.array(z.string()),
  soc: z.string().min(1),
  bootloader: bootloaderSchema,
  root: rootStatusSchema,
  prerequisites: z.array(z.string()),
  steps: z.array(deviceStepSchema),
  rollback: z.array(z.union([deviceStepSchema, z.string().min(1).transform((description) => ({
    id: `rollback-${description.slice(0, 20)}`,
    title: '恢复建议', description, commands: [], warnings: [], risk: undefined
  }))])),
  tools: z.array(id),
  sources: z.array(sourceSchema),
  warning: z.string()
}).strict()

export const brandSchema = z.object({ id, name: z.string().min(1), summary: z.string(), devices: z.array(deviceSchema) }).strict()
export const catalogSchema = z.object({ ...metadata, brands: z.array(brandSchema) }).strict()

const normalizedToolSchema = z.object({
  id,
  name: z.string().min(1),
  summary: z.string(),
  category: z.enum(['platform-tools', 'driver', 'root', 'recovery', 'utility', 'firmware']),
  platforms: z.array(z.enum(['windows', 'macos', 'linux', 'android'])),
  version: z.string().optional(),
  homepage: webUrl.optional(),
  downloadUrl: webUrl.optional(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  tags: z.array(z.string()).default([]),
  install: z.array(z.string()).default([]),
  usage: z.array(z.string()).default([]),
  downloads: z.array(z.object({ platform: z.string(), url: webUrl, notes: z.string() }).strict()).default([]),
  sources: z.array(sourceSchema).default([]),
  license: z.string().default('请查看发布者许可'),
  redistributable: z.boolean().default(false)
}).strict()
const seedToolSchema = z.object({
  id, name: z.string().min(1), category: z.string(), platforms: z.array(z.string()), description: z.string(),
  install: z.array(z.string()), usage: z.array(z.string()),
  downloads: z.array(z.object({ platform: z.string(), url: webUrl, notes: z.string() }).strict()),
  sources: z.array(sourceSchema), license: z.string(), redistributable: z.boolean()
}).strict().transform((tool): z.output<typeof normalizedToolSchema> => ({
  id: tool.id,
  name: tool.name,
  summary: tool.description,
  category: tool.category.includes('driver') ? 'driver' : tool.id === 'android-platform-tools' ? 'platform-tools' : tool.id === 'magisk' ? 'root' : 'utility',
  platforms: tool.platforms.map((platform) => platform.toLowerCase()).filter((platform): platform is 'windows' | 'macos' | 'linux' | 'android' => ['windows', 'macos', 'linux', 'android'].includes(platform)),
  // Seed downloads point to release/description pages, not distributable binaries.
  homepage: tool.downloads[0]?.url ?? tool.sources[0]?.url,
  tags: [tool.category, tool.redistributable ? '查看分发许可' : '仅链接来源'],
  install: tool.install,
  usage: tool.usage,
  downloads: tool.downloads,
  sources: tool.sources,
  license: tool.license,
  redistributable: tool.redistributable
}))
export const toolSchema = z.union([normalizedToolSchema, seedToolSchema])
export const toolsDocumentSchema = z.object({ ...metadata, tools: z.array(toolSchema) }).strict()

const normalizedCommandSchema = z.object({
  id,
  title: z.string().min(1),
  description: z.string(),
  executable: z.enum(['adb', 'fastboot']),
  args: z.array(z.string()),
  category: z.enum(['inspect', 'transfer', 'install', 'reboot', 'unlock', 'flash', 'erase', 'other']),
  risk: z.enum(['safe', 'caution', 'danger']),
  confirmationWord: z.string().min(1).optional(),
  expertOnly: z.boolean().optional(),
  deviceModes: z.array(z.string()).default([]),
  parameters: z.array(z.object({
    name: id, type: z.enum(['file', 'enum', 'string']), required: z.boolean(),
    allowedValues: z.array(z.string()).optional(), description: z.string()
  }).strict()).default([]),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000)
}).strict()
const seedCommandSchema = z.object({
  id, name: z.string().min(1),
  template: z.string().regex(/^(adb|fastboot)\s/),
  risk: contentRisk, deviceModes: z.array(z.string()), description: z.string(),
  parameters: z.array(z.object({
    name: id, type: z.enum(['file', 'enum', 'string']), required: z.boolean(),
    allowedValues: z.array(z.string()).optional(), description: z.string()
  }).strict()),
  expertMode: z.boolean()
}).strict().transform((command): z.output<typeof normalizedCommandSchema> => {
  const [executable, ...args] = command.template.trim().split(/\s+/)
  return {
    id: command.id, title: command.name, description: command.description,
    executable: executable as 'adb' | 'fastboot', args,
    category: args.includes('flash') ? 'flash' : args.includes('unlock') ? 'unlock' : args.includes('reboot') ? 'reboot' : 'inspect',
    risk: command.risk === 'critical' || command.risk === 'high' ? 'danger' : command.risk === 'medium' ? 'caution' : 'safe',
    expertOnly: command.expertMode,
    deviceModes: command.deviceModes,
    parameters: command.parameters,
    timeoutMs: 120_000
  }
})
export const commandSchema = z.union([normalizedCommandSchema, seedCommandSchema])
export const commandsDocumentSchema = z.object({ ...metadata, commands: z.array(commandSchema) }).strict()

export type Catalog = z.infer<typeof catalogSchema>
export type Brand = z.infer<typeof brandSchema>
export type Device = z.infer<typeof deviceSchema>
export type ToolDefinition = z.infer<typeof toolSchema>
export type CommandDefinition = z.infer<typeof commandSchema>
export type ToolsDocument = z.infer<typeof toolsDocumentSchema>
export type CommandsDocument = z.infer<typeof commandsDocumentSchema>
