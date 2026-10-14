import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { catalogSchema, commandsDocumentSchema, toolsDocumentSchema } from '@shared/schemas'

const metadata = { schemaVersion: 1, version: '2025.01', generatedAt: '2025-01-01T00:00:00.000Z' }

describe('content schemas', () => {
  it('接受包含命令引用步骤的固定 catalog', () => {
    const result = catalogSchema.safeParse({ ...metadata, brands: [{ id: 'google', name: 'Google', summary: 'Pixel', devices: [{ id: 'pixel-8', name: 'Pixel 8', codenames: ['shiba'], variants: ['global'], androidVersions: ['14'], soc: 'Tensor G3', bootloader: { unlockable: true, method: 'fastboot', notes: [] }, root: { supported: true, methods: ['Magisk'], notes: [] }, prerequisites: ['备份'], steps: [{ id: 'unlock', title: '解锁', description: '执行解锁', commands: ['fastboot-unlock'], warnings: ['清除数据'] }], rollback: [], tools: ['platform-tools'], sources: [{ title: 'Android', url: 'https://developer.android.com/' }], warning: '操作有风险' }] }] })
    expect(result.success).toBe(true)
  })

  it('拒绝缺少根版本字段和未知字段的 catalog', () => {
    expect(catalogSchema.safeParse({ brands: [], extra: true }).success).toBe(false)
  })

  it('校验工具 SHA-256 与命令可执行文件', () => {
    expect(toolsDocumentSchema.safeParse({ ...metadata, tools: [{ id: 'adb', name: 'ADB', summary: '', category: 'platform-tools', platforms: ['windows'], sha256: 'a'.repeat(64), tags: [] }] }).success).toBe(true)
    expect(commandsDocumentSchema.safeParse({ ...metadata, commands: [{ id: 'bad', title: 'bad', description: '', executable: 'sh', args: [], category: 'other', risk: 'safe' }] }).success).toBe(false)
  })

  it('校验所有必需的 seed 内容文件', async () => {
    const documents = [
      ['catalog.json', catalogSchema],
      ['tools.json', toolsDocumentSchema],
      ['commands.json', commandsDocumentSchema]
    ] as const
    for (const [name, schema] of documents) {
      const text = await readFile(resolve('resources/seed-content', name), 'utf8')
      const result = schema.safeParse(JSON.parse(text))
      expect(result.success, `${name}: ${result.success ? '' : result.error.message}`).toBe(true)
    }
  })

  it('覆盖恰好8品牌30设备，全部工具引用有效且保留说明', async () => {
    const catalog = catalogSchema.parse(JSON.parse(await readFile(resolve('resources/seed-content/catalog.json'), 'utf8')))
    const tools = toolsDocumentSchema.parse(JSON.parse(await readFile(resolve('resources/seed-content/tools.json'), 'utf8')))
    const commands = commandsDocumentSchema.parse(JSON.parse(await readFile(resolve('resources/seed-content/commands.json'), 'utf8')))
    const devices = catalog.brands.flatMap((brand) => brand.devices)
    expect(catalog.brands).toHaveLength(8)
    expect(devices).toHaveLength(30)
    expect(new Set(devices.map((device) => device.id)).size).toBe(30)
    expect(new Set(commands.commands.map((command) => command.id)).size).toBe(commands.commands.length)
    for (const device of devices) {
      expect(device.prerequisites.length).toBeGreaterThan(0)
      expect(device.steps.length).toBeGreaterThan(0)
      expect(device.rollback.length).toBeGreaterThan(0)
      expect(device.sources.length).toBeGreaterThan(0)
      expect(device.tools.every((id) => tools.tools.some((tool) => tool.id === id))).toBe(true)
      expect(device.root.status).not.toBe('verified')
    }
    for (const tool of tools.tools) {
      expect(tool.install.length).toBeGreaterThan(0)
      expect(tool.usage.length).toBeGreaterThan(0)
      expect(tool.sources.length).toBeGreaterThan(0)
    }
    expect(commands.commands.find((command) => command.id === 'fastboot-flash-boot')?.parameters[0].type).toBe('file')
  })
})
