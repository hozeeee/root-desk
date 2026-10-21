import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const icon = { isEmpty: () => false }
  const window = {
    once: vi.fn(), show: vi.fn(), loadURL: vi.fn(), loadFile: vi.fn(),
    webContents: { on: vi.fn() }
  }
  return {
    app: { isPackaged: false, getAppPath: vi.fn(), dock: { setIcon: vi.fn() } },
    nativeImage: { createFromPath: vi.fn(() => icon) },
    BrowserWindow: vi.fn(function () { return window }),
    shell: { openExternal: vi.fn() },
    icon
  }
})
vi.mock('electron', () => electron)
vi.mock('../src/main/security/hardening', () => ({ hardenWindow: vi.fn() }))

import { createMainWindow } from '../src/main/windows/main-window'

beforeEach(() => {
  vi.clearAllMocks()
  electron.app.isPackaged = false
  electron.app.getAppPath.mockReturnValue(join('workspace', 'rootdesk'))
  vi.stubGlobal('process', { ...process, platform: 'linux', resourcesPath: join('installed', 'resources') })
  vi.stubEnv('ELECTRON_RENDERER_URL', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('Electron 应用图标', () => {
  it('开发环境从项目资源目录加载并设置窗口图标', () => {
    createMainWindow()
    expect(electron.nativeImage.createFromPath).toHaveBeenCalledWith(join('workspace', 'rootdesk', 'resources', 'icons', 'icon.png'))
    expect(electron.BrowserWindow).toHaveBeenCalledWith(expect.objectContaining({ icon: electron.icon }))
    expect(electron.app.dock.setIcon).not.toHaveBeenCalled()
  })

  it('打包后从 extraResources 目录加载图标', () => {
    electron.app.isPackaged = true
    createMainWindow()
    expect(electron.nativeImage.createFromPath).toHaveBeenCalledWith(join('installed', 'resources', 'icons', 'icon.png'))
    expect(electron.app.getAppPath).not.toHaveBeenCalled()
  })

  it('macOS 开发环境设置 Dock 图标', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    createMainWindow()
    expect(electron.app.dock.setIcon).toHaveBeenCalledWith(electron.icon)
  })

  it('macOS 打包后保留原生 ICNS Dock 图标', () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' })
    electron.app.isPackaged = true
    createMainWindow()
    expect(electron.app.dock.setIcon).not.toHaveBeenCalled()
  })
})

describe('跨平台图标资源', () => {
  it('PNG 是带 Alpha 通道的 1024 像素方形图标', () => {
    const png = readFileSync(new URL('../resources/icons/icon.png', import.meta.url))
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.toString('ascii', 12, 16)).toBe('IHDR')
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
    expect(png[25]).toBe(6)
  })

  it('Windows ICO 包含 16 至 256 像素的多尺寸图标', () => {
    const ico = readFileSync(new URL('../resources/icons/icon.ico', import.meta.url))
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(7)
    const sizes = Array.from({ length: 7 }, (_, index) => {
      const offset = 6 + index * 16
      const size = ico[offset] || 256
      expect(ico[offset + 1] || 256).toBe(size)
      expect(ico.readUInt32LE(offset + 12) + ico.readUInt32LE(offset + 8)).toBeLessThanOrEqual(ico.length)
      return size
    })
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
  })

  it('macOS ICNS 包含 1024 像素的 Retina 图标', () => {
    const icns = readFileSync(new URL('../resources/icons/icon.icns', import.meta.url))
    expect(icns.toString('ascii', 0, 4)).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    const types: string[] = []
    let offset = 8
    while (offset < icns.length) {
      types.push(icns.toString('ascii', offset, offset + 4))
      const length = icns.readUInt32BE(offset + 4)
      expect(length).toBeGreaterThan(8)
      offset += length
    }
    expect(offset).toBe(icns.length)
    expect(types).toContain('ic10')
  })
})
