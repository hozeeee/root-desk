import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanupFixture, electronMock, fetchMock, setupFixture } from './service-test-fixture'
vi.mock('electron', async () => (await import('./service-test-fixture')).electronMock)
import { ProxyService } from '../src/main/services/proxy-service'
import { SettingsService } from '../src/main/services/settings-service'
import type { ProxySettings } from '../src/shared/contracts'
let settings: SettingsService
let proxy: ProxyService
const custom: ProxySettings = { mode: 'custom', protocol: 'https', host: 'proxy.example.com', port: 8443, username: 'alice' }
beforeEach(async () => { await setupFixture(); settings = new SettingsService(); proxy = new ProxyService(settings) })
afterEach(cleanupFixture)
function challenge(host: string, port: number) {
  const callback = vi.fn()
  const event = { preventDefault: vi.fn() }
  electronMock.app.on.mock.calls[0][1](event, null, {}, { isProxy: true, host, port }, callback)
  return callback
}
it('never forwards an old password after address, protocol, port or username changes', async () => {
  for (const changed of [{ host: 'other.example.com' }, { port: 8888 }, { protocol: 'http' as const }, { username: 'bob' }]) {
    await proxy.apply(custom, 'secret')
    expect(challenge(custom.host, custom.port)).toHaveBeenCalledWith('alice', 'secret')
    const next = { ...custom, ...changed }
    await proxy.apply(next)
    expect(challenge(next.host, next.port)).toHaveBeenCalledWith('', '')
  }
  expect(electronMock.session.defaultSession.clearAuthCache).toHaveBeenCalled()
})
it('retains credentials only for the identical endpoint and clears them on system mode', async () => {
  await proxy.apply(custom, 'secret'); await proxy.apply({ ...custom })
  expect(challenge(custom.host, custom.port)).toHaveBeenCalledWith('alice', 'secret')
  await proxy.apply({ ...custom, mode: 'system' })
  expect(challenge(custom.host, custom.port)).not.toHaveBeenCalled()
  await proxy.apply(custom)
  expect(challenge(custom.host, custom.port)).toHaveBeenCalledWith('', '')
})
it.each([{ username: 'alice' }, { hasCredential: true }, { password: 'secret' }])('explicitly rejects SOCKS5 authentication %j', async (auth) => {
  const { password, ...settings } = auth as { password?: string; username?: string; hasCredential?: boolean }
  await expect(proxy.apply({ ...custom, protocol: 'socks5', username: undefined, ...settings }, password)).rejects.toThrow('SOCKS5')
  expect(electronMock.session.defaultSession.setProxy).not.toHaveBeenCalled()
})
it.each(['http', 'https', 'socks5'] as const)('supports unauthenticated %s and tests official HTTPS through defaultSession', async (protocol) => {
  await proxy.apply({ ...custom, protocol, username: undefined })
  fetchMock.mockResolvedValue(new Response('official'))
  electronMock.session.defaultSession.resolveProxy.mockResolvedValue('PROXY proxy.example.com:8443')
  const result = await proxy.test()
  expect(result).toMatchObject({ ok: true, resolvedProxy: 'PROXY proxy.example.com:8443' })
  expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  expect(fetchMock.mock.calls[0][0]).toBe('https://dl.google.com/android/repository/repository2-1.xml')
  expect(electronMock.session.defaultSession.setProxy).toHaveBeenCalledWith({ mode: 'fixed_servers', proxyRules: `${protocol}://proxy.example.com:8443` })
})
it('returns structured failure instead of throwing on a failed TLS/network test', async () => {
  fetchMock.mockRejectedValue(new Error('TLS certificate invalid'))
  expect(await proxy.test()).toMatchObject({ ok: false, message: 'TLS certificate invalid', resolvedProxy: 'DIRECT' })
})
it('restores the exact old credentials if saving new settings fails and never persists passwords', async () => {
  await proxy.update({ proxy: custom, proxyPassword: 'old-secret' })
  const save = vi.spyOn(settings, 'update').mockRejectedValueOnce(new Error('disk full'))
  await expect(proxy.update({ proxy: { ...custom, host: 'other.example.com' }, proxyPassword: 'new-secret' })).rejects.toThrow('disk full')
  expect(challenge(custom.host, custom.port)).toHaveBeenCalledWith('alice', 'old-secret')
  expect(save.mock.calls[0][0]).not.toHaveProperty('proxyPassword')
})
