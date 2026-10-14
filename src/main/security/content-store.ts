import { constants } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rename, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import type { CommandsDocument } from '@shared/schemas'
import { manifestSchema, MAX_CONTENT_BYTES, MAX_MANIFEST_BYTES, validateContent, verifyContentBytes, verifyManifest, type UpdateManifest } from './content-validation'

const pointerSchema = z.object({ schemaVersion: z.literal(1), active: z.string().uuid().nullable(), previous: z.string().uuid().nullable() }).strict()
type Pointer = z.infer<typeof pointerSchema>

export async function readBoundedFile(file: string, limit: number): Promise<Buffer> {
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > limit || (await lstat(file)).isSymbolicLink()) throw new Error('内容文件类型或大小无效')
    const data = Buffer.alloc(Math.min(info.size, limit) + 1)
    let length = 0
    while (length < data.length) {
      const result = await handle.read(data, length, data.length - length, null)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    if (length > limit || length !== info.size) throw new Error('内容文件大小已变化或超限')
    return data.subarray(0, length)
  } finally { await handle.close() }
}

export class ContentStore {
  readonly root = join(app.getPath('userData'), 'content')

  async createStage(): Promise<string> {
    await this.ensureDirectories()
    return mkdtemp(join(this.root, 'staging', 'update-'))
  }

  async readActive(key: string, commands: CommandsDocument): Promise<ReturnType<typeof validateContent> | null> {
    const pointer = await this.pointer()
    if (!pointer.active) return null
    return this.readPackage(join(this.root, 'packages', pointer.active), key, commands)
  }

  async activate(stage: string, manifest: UpdateManifest, key: string, commands: CommandsDocument): Promise<ReturnType<typeof validateContent>> {
    await this.ensureDirectories()
    if (!stage.startsWith(`${join(this.root, 'staging', 'update-')}`) || await realpath(stage) !== stage || !(await lstat(stage)).isDirectory()) throw new Error('非法内容 staging 目录')
    verifyManifest(manifest, key)
    await writeFile(join(stage, 'rootdesk-manifest.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 })
    const content = await this.readPackage(stage, key, commands)
    const previous = await this.pointer()
    const id = randomUUID()
    for (const file of ['catalog.json', 'tools.json', 'rootdesk-manifest.json']) await chmod(join(stage, file), 0o444)
    // macOS requires directory write permission during a cross-parent rename; seal after moving.
    const destination = join(this.root, 'packages', id)
    await rename(stage, destination)
    await chmod(destination, 0o555)
    await this.writePointer({ schemaVersion: 1, active: id, previous: previous.active })
    return content
  }

  async rollback(key: string, commands: CommandsDocument): Promise<ReturnType<typeof validateContent> | null> {
    await this.ensureDirectories()
    const pointer = await this.pointer()
    const content = pointer.previous ? await this.readPackage(join(this.root, 'packages', pointer.previous), key, commands) : null
    await this.writePointer({ schemaVersion: 1, active: pointer.previous, previous: pointer.active })
    return content
  }

  private async readPackage(directory: string, key: string, commands: CommandsDocument): Promise<ReturnType<typeof validateContent>> {
    if (await realpath(directory) !== directory || (await lstat(directory)).isSymbolicLink()) throw new Error('内容包不能包含目录符号链接')
    const manifest = manifestSchema.parse(JSON.parse((await readBoundedFile(join(directory, 'rootdesk-manifest.json'), MAX_MANIFEST_BYTES)).toString('utf8')))
    verifyManifest(manifest, key)
    const documents = new Map<string, Buffer>()
    for (const file of manifest.files) {
      const bytes = await readBoundedFile(join(directory, file.name), MAX_CONTENT_BYTES)
      verifyContentBytes(bytes, file)
      documents.set(file.name, bytes)
    }
    return validateContent(documents.get('catalog.json')!, documents.get('tools.json')!, manifest.version, commands)
  }

  private async pointer(): Promise<Pointer> {
    try {
      if (await realpath(this.root) !== this.root) throw new Error('内容根目录不能是符号链接')
      return pointerSchema.parse(JSON.parse((await readBoundedFile(join(this.root, 'active.json'), 4096)).toString('utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, active: null, previous: null }
      throw error
    }
  }

  private async ensureDirectories(): Promise<void> {
    for (const directory of [this.root, join(this.root, 'packages'), join(this.root, 'staging')]) {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      if (await realpath(directory) !== directory || (await lstat(directory)).isSymbolicLink()) throw new Error('内容目录不能是符号链接')
    }
  }

  private async writePointer(pointer: Pointer): Promise<void> {
    const file = join(this.root, `active-${randomUUID()}.tmp`)
    const handle = await open(file, 'wx', 0o600)
    try { await handle.writeFile(JSON.stringify(pointer)); await handle.sync() }
    finally { await handle.close() }
    await rename(file, join(this.root, 'active.json'))
  }
}
