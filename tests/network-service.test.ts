import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupFixture, fetchMock, fixture, setupFixture } from './service-test-fixture'
vi.mock('electron', async () => (await import('./service-test-fixture')).electronMock)
import { downloadFile, fetchBytes, isPublicHttpsUrl, secureFetch } from '../src/main/security/network'

beforeEach(setupFixture)
afterEach(cleanupFixture)
describe('default session HTTPS network boundary', () => {
  it.each(['http://google.com/a', 'https://user:password@google.com', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://2130706433/', 'https://localhost/', 'https://host.local/', 'https://google.com:8080/', 'file:///tmp/a', 'https://google.com/#fragment', 'https://foo.sslip.io/'])('rejects %s', (url) => expect(isPublicHttpsUrl(url)).toBe(false))
  it('uses Electron defaultSession and rejects an unsafe redirect before fetching it', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://evil.com/file' } }))
    await expect(secureFetch('https://dl.google.com/a')).rejects.toThrow('不安全')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual', credentials: 'omit' })
  })
  it('bounds redirect count and denies cross-policy redirects', async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: 'https://other.com/a' } }))
    await expect(secureFetch('https://dl.google.com/a', { policy: (url) => new URL(url).hostname === 'dl.google.com' })).rejects.toThrow('未授权')
    fetchMock.mockClear()
    await expect(secureFetch('https://dl.google.com/a')).rejects.toThrow('次数')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
  it('bounds declared and undeclared body bytes', async () => {
    fetchMock.mockResolvedValueOnce(new Response('small', { headers: { 'content-length': '100' } }))
    await expect(fetchBytes('https://google.com/file', 10)).rejects.toThrow('大小')
    fetchMock.mockResolvedValueOnce(new Response('too-many-bytes'))
    await expect(fetchBytes('https://google.com/file', 3)).rejects.toThrow('大小')
  })
  it('streams with byte/hash accounting and refuses to replace an existing file', async () => {
    const path = join(fixture.root, 'temp', 'file')
    const data = Buffer.from('official bytes')
    fetchMock.mockImplementation(async () => new Response(data))
    expect(await downloadFile('https://dl.google.com/file', path, { maxBytes: 100 })).toEqual({ bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') })
    await expect(downloadFile('https://dl.google.com/file', path, { maxBytes: 100 })).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(path)).toEqual(data)
  })
})
