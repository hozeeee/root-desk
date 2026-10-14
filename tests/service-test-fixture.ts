import { chmod, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'

export const project = join(dirname(fileURLToPath(import.meta.url)), '..')
export const fixture = { root: '' }
export const fetchMock = vi.fn<typeof fetch>()
export const electronMock = {
  app: {
    isPackaged: false, getVersion: () => '99.0.0',
    getPath: (name: string) => join(fixture.root, name), getAppPath: () => fixture.root,
    on: vi.fn()
  },
  shell: { showItemInFolder: vi.fn(), trashItem: vi.fn(async () => undefined) },
  session: { defaultSession: {
    fetch: fetchMock, setProxy: vi.fn(async (_config: unknown) => undefined),
    closeAllConnections: vi.fn(async () => undefined), clearAuthCache: vi.fn(async () => undefined),
    resolveProxy: vi.fn(async (_url: string) => 'DIRECT')
  } }
}
export const defaults = { theme: 'dark' as const, expertMode: false, proxy: { mode: 'system' as const, protocol: 'https' as const, host: '', port: 8080 } }
export const catalog = (version = '1.0.0') => ({ schemaVersion: 1, version, generatedAt: '2026-10-14T00:00:00.000Z', brands: [] })
export const tools = (version = '1.0.0') => ({ schemaVersion: 1, version, generatedAt: '2026-10-14T00:00:00.000Z', tools: [] })
export const commands = { schemaVersion: 1, version: '1.0.0', generatedAt: '2026-10-14T00:00:00.000Z', commands: [{ id: 'adb-version', title: 'Version', description: '', executable: 'adb', args: ['version'], category: 'inspect', risk: 'safe' }] }
export async function setupFixture(): Promise<void> {
  fixture.root = await mkdtemp(join(project, 'tests', '.service-fixture-'))
  for (const path of ['downloads', 'temp', 'userData', 'resources/seed-content']) await mkdir(join(fixture.root, path), { recursive: true })
  for (const [name, value] of [['catalog', catalog()], ['tools', tools()], ['commands', commands]] as const) await writeFile(join(fixture.root, 'resources', 'seed-content', `${name}.json`), JSON.stringify(value))
  fetchMock.mockReset()
  electronMock.app.on.mockClear()
  electronMock.shell.showItemInFolder.mockClear()
  electronMock.shell.trashItem.mockReset().mockResolvedValue(undefined)
  electronMock.session.defaultSession.setProxy.mockReset().mockResolvedValue(undefined)
  electronMock.session.defaultSession.clearAuthCache.mockReset().mockResolvedValue(undefined)
  electronMock.session.defaultSession.closeAllConnections.mockReset().mockResolvedValue(undefined)
  electronMock.session.defaultSession.resolveProxy.mockReset().mockResolvedValue('DIRECT')
}
export async function cleanupFixture(): Promise<void> {
  // Only disposable fixtures owned by this test; never run cleanup on app/user files.
  if (!fixture.root.startsWith(join(project, 'tests', '.service-fixture-'))) throw new Error('Unsafe fixture cleanup')
  async function writable(path: string): Promise<void> {
    const info = await lstat(path)
    if (info.isSymbolicLink()) return
    if (info.isDirectory()) { await chmod(path, 0o700); for (const child of await readdir(path)) await writable(join(path, child)) }
    else await chmod(path, 0o600)
  }
  await writable(fixture.root)
  await rm(fixture.root, { recursive: true })
}
