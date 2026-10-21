import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanupFixture, fetchMock, setupFixture } from './service-test-fixture'
import { testZip } from './zip-test-fixture'
vi.mock('electron', async () => (await import('./service-test-fixture')).electronMock)
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: spawnMock }))
import { PlatformToolsService } from '../src/main/services/platform-tools-service'
import { SettingsService } from '../src/main/services/settings-service'
import { validateZipEntry } from '../src/main/security/archive-validation'

let settings: SettingsService
let service: PlatformToolsService
const platform = process.platform
function officialZip(windows = false): Uint8Array<ArrayBuffer> {
  return testZip([
    { name: `platform-tools/adb${windows ? '.exe' : ''}`, data: 'mock official binary' },
    { name: `platform-tools/fastboot${windows ? '.exe' : ''}`, data: 'mock official binary' },
    { name: 'platform-tools/source.properties', data: 'Pkg.Revision = 37.0.0\n' }
  ])
}
beforeEach(async () => {
  await setupFixture(); settings = new SettingsService(); service = new PlatformToolsService(settings)
  spawnMock.mockReset().mockImplementation((binary: string) => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from(binary.includes('fastboot') ? 'fastboot version 37.0.0-123\n' : 'Android Debug Bridge version 1.0.41\nVersion 37.0.0-123\n')); child.emit('close', 0) })
    return child
  })
  fetchMock.mockImplementation(async () => new Response(officialZip(process.platform === 'win32')))
})
afterEach(async () => { Object.defineProperty(process, 'platform', { value: platform }); await cleanupFixture() })
it.each(['darwin', 'win32'])('installs and verifies %s official tools into a fresh cache path without overwriting an old install', async (os) => {
  Object.defineProperty(process, 'platform', { value: os })
  fetchMock.mockImplementation(async () => new Response(officialZip(os === 'win32')))
  const installed = await service.install()
  expect(installed.every((status) => status.available)).toBe(true)
  const previous = settings.get().platformToolsPath!
  const firstBytes = await readFile(installed[0].path!)
  const newer = await service.install()
  expect(settings.get().platformToolsPath).not.toBe(previous)
  expect(await readFile(installed[0].path!)).toEqual(firstBytes)
  expect(newer.every((status) => status.available)).toBe(true)
  expect(String(fetchMock.mock.calls[0][0])).toBe(`https://dl.google.com/android/repository/platform-tools-latest-${os === 'win32' ? 'windows' : 'darwin'}.zip`)
  expect(spawnMock.mock.calls.every(([, args]) => JSON.stringify(args) === '["version"]' || JSON.stringify(args) === '["--version"]')).toBe(true)
})
it('deduplicates concurrent installs and preserves settings on invalid archives', async () => {
  const a = service.install(); const b = service.install(); expect(a).toBe(b)
  expect((await a).every((status) => status.available)).toBe(true)
  const previous = settings.get().platformToolsPath
  fetchMock.mockResolvedValue(new Response('not a ZIP'))
  expect((await service.install()).every((status) => !status.available)).toBe(true)
  expect(settings.get().platformToolsPath).toBe(previous)
})
it.each([
  { name: 'platform-tools/../../escape', data: 'bad' },
  { name: 'platform-tools/link', data: '/tmp/escape', mode: 0o120777 },
  { name: 'platform-tools/large', declaredSize: 101 * 1024 ** 2 }
])('rejects malicious ZIP entry $name without executing a binary or updating settings', async (entry) => {
  fetchMock.mockResolvedValue(new Response(testZip([entry])))
  const result = await service.install()
  expect(result.every((status) => !status.available)).toBe(true)
  expect(spawnMock).not.toHaveBeenCalled()
  expect(settings.get().platformToolsPath).toBeUndefined()
})
it.each(['../escape', '/absolute', 'platform-tools/../escape', 'platform-tools/\\escape', 'platform-tools/C:drive', 'platform-tools/CON', 'platform-tools/trailing.', 'platform-tools/a//b'])('rejects unsafe entry %s', (fileName) => {
  expect(() => validateZipEntry({ fileName, externalFileAttributes: 0o100644 << 16, uncompressedSize: 0, generalPurposeBitFlag: 0 }, new Set())).toThrow()
})
it('rejects case-folded duplicate ZIP paths and encrypted entries', () => {
  const seen = new Set<string>()
  validateZipEntry({ fileName: 'platform-tools/adb', externalFileAttributes: 0, uncompressedSize: 0, generalPurposeBitFlag: 0 }, seen)
  expect(() => validateZipEntry({ fileName: 'platform-tools/ADB', externalFileAttributes: 0, uncompressedSize: 0, generalPurposeBitFlag: 0 }, seen)).toThrow('重复')
  expect(() => validateZipEntry({ fileName: 'platform-tools/fastboot', externalFileAttributes: 0, uncompressedSize: 0, generalPurposeBitFlag: 1 }, new Set())).toThrow('加密')
})
it('rejects unverified versions and never changes existing settings', async () => {
  await settings.update({ platformToolsPath: '/existing/user/tools' })
  spawnMock.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from('wrong version')); child.emit('close', 0) })
    return child
  })
  expect((await service.install()).every((status) => !status.available)).toBe(true)
  expect(settings.get().platformToolsPath).toBe('/existing/user/tools')
})
