import { beforeEach, describe, expect, it, vi } from 'vitest'
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
import { resolveToolAssets } from '@main/services/tool-assets-service'

beforeEach(() => fetchMock.mockReset())
describe('publisher tool assets', () => {
  it('only returns Google Platform Tools HTTPS assets', async () => {
    const assets = await resolveToolAssets('android-platform-tools')
    expect(assets).toHaveLength(3)
    expect(assets.every((asset) => new URL(asset.url).hostname === 'dl.google.com')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('does not allow arbitrary repository IDs', async () => {
    expect(await resolveToolAssets('evil/repository')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('filters foreign and non-APK release assets', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ assets: [
      { name: 'Magisk-v30.0.apk', browser_download_url: 'https://github.com/topjohnwu/Magisk/releases/download/v30.0/Magisk-v30.0.apk', digest: `sha256:${'a'.repeat(64)}` },
      { name: 'Magisk-v30.0.apk', browser_download_url: 'https://github.com/evil/fake/releases/download/v30.0/Magisk-v30.0.apk' },
      { name: 'installer.exe', browser_download_url: 'https://github.com/topjohnwu/Magisk/releases/download/v30.0/installer.exe' }
    ] })))
    const assets = await resolveToolAssets('magisk')
    expect(assets).toHaveLength(1)
    expect(assets[0].platform).toBe('android')
    expect(assets[0].sha256).toBe('a'.repeat(64))
  })
  it('gives an actionable HTTP error', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 403 }))
    await expect(resolveToolAssets('magisk')).rejects.toThrow('代理')
  })
})
