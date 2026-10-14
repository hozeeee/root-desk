import { mkdir, mkdtemp, lstat, rename } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'

async function absent(file: string): Promise<boolean> {
  try { await lstat(file); return false }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true; throw error }
}

// No unlink/rm: retain partial downloads, including files in the user's Downloads folder.
export async function quarantineFile(file: string): Promise<string | undefined> {
  if (await absent(file)) return undefined
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('隔离对象必须是普通文件')
  const root = join(app.getPath('temp'), 'RootDesk-quarantine')
  await mkdir(root, { recursive: true, mode: 0o700 })
  if ((await lstat(root)).isSymbolicLink()) throw new Error('隔离目录不能是符号链接')
  const directory = await mkdtemp(join(root, 'download-'))
  const destination = join(directory, basename(file))
  try {
    await rename(file, destination)
    const after = await lstat(destination)
    if (!await absent(file) || !after.isFile() || after.size !== before.size || after.ino !== before.ino || after.dev !== before.dev) {
      throw new Error('隔离文件验证失败，请保留文件手动检查')
    }
    return destination
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await shell.trashItem(file)
    if (!await absent(file)) throw new Error('移到废纸篓后原文件仍存在')
    return 'trash'
  }
}
