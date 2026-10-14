import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { isLoopbackDevUrl } from './validation'

export function isTrustedRendererUrl(value: string): boolean {
  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
    if (dev && isLoopbackDevUrl(dev)) {
      const expected = new URL(dev)
      return url.origin === expected.origin && url.pathname === expected.pathname
    }
    return url.href === pathToFileURL(join(__dirname, '../renderer/index.html')).href
  } catch { return false }
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  if (BrowserWindow.fromWebContents(event.sender) && event.senderFrame === event.sender.mainFrame && isTrustedRendererUrl(event.senderFrame.url)) return
  throw new Error('拒绝来自非可信页面或子框架的 IPC 请求')
}
