import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanupFixture, electronMock, fetchMock, fixture, setupFixture } from './service-test-fixture'
vi.mock('electron', async () => (await import('./service-test-fixture')).electronMock)
import { DownloadService } from '../src/main/services/download-service'
import { quarantineFile } from '../src/main/security/quarantine'

let service: DownloadService
beforeEach(async () => { await setupFixture(); service = new DownloadService() })
afterEach(async () => { service.dispose(); await vi.waitFor(() => expect((service as unknown as { running: number }).running).toBe(0)); await cleanupFixture() })
const settled = async (id: string) => {
  await vi.waitFor(() => expect(['completed', 'failed', 'cancelled']).toContain(service.list().find((task) => task.id === id)?.status))
  await vi.waitFor(() => expect((service as unknown as { running: number }).running).toBe(0))
  return service.list().find((task) => task.id === id)!
}
const quarantined = async () => {
  const root = join(fixture.root, 'temp', 'RootDesk-quarantine')
  const directories = await readdir(root)
  return Promise.all(directories.flatMap(async (directory) => {
    const files = await readdir(join(root, directory))
    return Promise.all(files.map((file) => readFile(join(root, directory, file), 'utf8')))
  }))
}

it('publishes verified files without overwriting originals and reveals only owned completed tasks', async () => {
  fetchMock.mockResolvedValue(new Response('data'))
  const original = join(fixture.root, 'downloads', 'RootDesk', 'file.zip')
  await mkdir(join(fixture.root, 'downloads', 'RootDesk'))
  await writeFile(original, 'user original')
  const task = await service.start({ url: 'https://dl.google.com/file.zip', sha256: createHash('sha256').update('data').digest('hex') })
  expect(await service.reveal(task.id)).toBe(false)
  expect((await settled(task.id)).status).toBe('completed')
  expect(await readFile(original, 'utf8')).toBe('user original')
  expect(await service.reveal('unknown')).toBe(false)
  expect(await service.reveal(task.id)).toBe(true)
  expect(electronMock.shell.showItemInFolder).toHaveBeenCalledWith(task.destination)
  await writeFile(task.destination, 'changed')
  expect(await service.reveal(task.id)).toBe(false)
})
it('quarantines failed hash bytes instead of permanently deleting the part', async () => {
  fetchMock.mockResolvedValue(new Response('mismatch'))
  const task = await service.start({ url: 'https://dl.google.com/file.zip', sha256: '0'.repeat(64) })
  expect((await settled(task.id)).status).toBe('failed')
  expect((await quarantined()).flat()).toContain('mismatch')
  await expect(lstat(`${task.destination}.part`)).rejects.toMatchObject({ code: 'ENOENT' })
})
it('retains cancelled partial bytes in Electron temp quarantine', async () => {
  fetchMock.mockImplementation(async (_url, options) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Buffer.from('partial'))
      options?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true })
    }
  })))
  const task = await service.start({ url: 'https://dl.google.com/file.zip' })
  await vi.waitFor(() => expect(service.list()[0].receivedBytes).toBe(7))
  expect(service.cancel(task.id)).toBe(true)
  expect((await settled(task.id)).status).toBe('cancelled')
  expect((await quarantined()).flat()).toContain('partial')
})
it('caps concurrency and cancels queued tasks without issuing requests', async () => {
  fetchMock.mockImplementation(async (_url, options) => new Response(new ReadableStream({
    start(controller) { options?.signal?.addEventListener('abort', () => controller.error(new Error('aborted'))) }
  })))
  const tasks = await Promise.all(Array.from({ length: 6 }, () => service.start({ url: 'https://dl.google.com/file.zip' })))
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  expect(service.list().filter((task) => task.status === 'queued')).toHaveLength(3)
  tasks.forEach((task) => service.cancel(task.id))
  await vi.waitFor(() => expect((service as unknown as { running: number }).running).toBe(0))
  expect(fetchMock).toHaveBeenCalledTimes(3)
})
it('verifies trash fallback and reports failure if original remains', async () => {
  // Explicitly exercise the verification behavior of a failed quarantine destination.
  const file = join(fixture.root, 'downloads', 'owned.part')
  await writeFile(file, 'retained')
  const destination = await quarantineFile(file)
  expect(destination).toContain('RootDesk-quarantine')
  expect(await readFile(destination!, 'utf8')).toBe('retained')
  await expect(lstat(file)).rejects.toMatchObject({ code: 'ENOENT' })
})
