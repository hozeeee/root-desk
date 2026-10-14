import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { ZodTypeAny, output } from 'zod'
import { catalogSchema, commandsDocumentSchema, toolsDocumentSchema } from '@shared/schemas'
import type { ContentSnapshot, SearchResult } from '@shared/contracts'
import { ContentStore, readBoundedFile } from '@main/security/content-store'
import type { UpdateManifest } from '@main/security/content-validation'

export class ContentService {
  private snapshot: ContentSnapshot = emptySnapshot()
  private readonly store = new ContentStore()
  private queue: Promise<unknown> = Promise.resolve()
  private installedKey: string | undefined

  load(): Promise<ContentSnapshot> {
    return this.serial(async () => {
      const seed = await this.readSeed()
      try {
        if (!seed.commands) throw new Error('捆绑命令库无效，拒绝加载远程内容')
        const active = await this.store.readActive(await this.trustedKey(), seed.commands)
        this.snapshot = active ? { ...seed, ...active } : seed
      } catch (error) {
        this.snapshot = { ...seed, issues: [...seed.issues, { file: 'active.json', message: errorMessage(error) }] }
      }
      return this.getSnapshot()
    })
  }

  createStage(): Promise<string> { return this.store.createStage() }

  activate(stage: string, manifest: UpdateManifest, publicKey: string): Promise<ContentSnapshot> {
    return this.serial(async () => {
      const seed = await this.readSeed()
      if (!seed.commands) throw new Error('捆绑命令库无效，拒绝更新')
      const active = await this.store.activate(stage, manifest, publicKey, seed.commands)
      this.installedKey = publicKey
      this.snapshot = { ...seed, ...active }
      return this.getSnapshot()
    })
  }

  rollback(): Promise<ContentSnapshot> {
    return this.serial(async () => {
      const seed = await this.readSeed()
      if (!seed.commands) throw new Error('捆绑命令库无效，拒绝回退')
      const previous = await this.store.rollback(await this.trustedKey(), seed.commands)
      this.snapshot = previous ? { ...seed, ...previous } : seed
      return this.getSnapshot()
    })
  }

  getSnapshot(): ContentSnapshot { return structuredClone(this.snapshot) }

  private async trustedKey(): Promise<string> {
    try {
      const settings = JSON.parse((await readBoundedFile(join(app.getPath('userData'), 'settings.json'), 64 * 1024)).toString('utf8')) as { contentPublicKey?: unknown }
      return typeof settings.contentPublicKey === 'string' ? settings.contentPublicKey : ''
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return this.installedKey ?? ''
    }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }

  private async readSeed(): Promise<ContentSnapshot> {
    const directory = app.isPackaged ? join(process.resourcesPath, 'seed-content') : join(app.getAppPath(), 'resources', 'seed-content')
    const [catalog, tools, commands] = await Promise.all([
      this.readDocument(join(directory, 'catalog.json'), catalogSchema),
      this.readDocument(join(directory, 'tools.json'), toolsDocumentSchema),
      this.readDocument(join(directory, 'commands.json'), commandsDocumentSchema)
    ])
    return {
      catalog: catalog.data, tools: tools.data, commands: commands.data,
      issues: [catalog.issue, tools.issue, commands.issue].filter((item): item is NonNullable<typeof item> => Boolean(item)),
      loadedAt: new Date().toISOString()
    }
  }

  search(query: string): SearchResult[] {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    if (!needle) return []
    const results: SearchResult[] = []
    const add = (kind: SearchResult['kind'], id: string, title: string, subtitle: string, searchText: string): void => {
      const normalized = searchText.toLocaleLowerCase('zh-CN')
      const index = normalized.indexOf(needle)
      if (index >= 0) results.push({ kind, id, title, subtitle, score: index === 0 ? 100 : 60 - Math.min(index, 50) })
    }

    for (const brand of this.snapshot.catalog?.brands ?? []) {
      add('brand', brand.id, brand.name, brand.summary, `${brand.name} ${brand.summary}`)
      for (const device of brand.devices) {
        add('device', device.id, device.name, `${brand.name} · ${device.soc}`, [device.name, ...device.codenames, ...device.variants, device.soc].join(' '))
      }
    }
    for (const tool of this.snapshot.tools?.tools ?? []) {
      add('tool', tool.id, tool.name, tool.summary, `${tool.name} ${tool.summary} ${tool.tags.join(' ')}`)
    }
    for (const command of this.snapshot.commands?.commands ?? []) {
      add('command', command.id, command.title, command.description, `${command.title} ${command.description} ${command.executable} ${command.args.join(' ')}`)
    }
    return results.sort((a, b) => b.score - a.score).slice(0, 50)
  }

  private async readDocument<S extends ZodTypeAny>(file: string, schema: S): Promise<{ data: output<S> | null; issue?: { file: string; message: string } }> {
    try {
      const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
      const result = schema.safeParse(raw)
      if (!result.success) return { data: null, issue: { file, message: result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') } }
      return { data: result.data as output<S> }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      return { data: null, issue: { file, message: code === 'ENOENT' ? '内容文件尚未提供' : errorMessage(error) } }
    }
  }
}

function emptySnapshot(): ContentSnapshot {
  return { catalog: null, tools: null, commands: null, issues: [], loadedAt: new Date(0).toISOString() }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
