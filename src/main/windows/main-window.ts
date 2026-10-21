import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, shell } from 'electron'
import { hardenWindow } from '@main/security/hardening'
import { isSafeRemoteUrl } from '@main/security/validation'

export function createMainWindow(): BrowserWindow {
  const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const icon = nativeImage.createFromPath(join(resources, 'icons', 'icon.png'))
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(icon)

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: 'RootDesk',
    icon,
    backgroundColor: '#0b0e13',
    show: false,
    titleBarStyle: 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  })

  hardenWindow(window)
  window.once('ready-to-show', () => window.show())
  window.webContents.on('will-navigate', (event, url) => {
    if (isSafeRemoteUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}
