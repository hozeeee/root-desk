import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'
import { hardenWindow } from '@main/security/hardening'
import { isSafeRemoteUrl } from '@main/security/validation'

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: 'RootDesk',
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
