import type { BrowserWindow } from 'electron'
import { app, session, shell } from 'electron'
import { isSafeRemoteUrl } from './validation'
import { isTrustedRendererUrl } from './sender'

export function installSessionHardening(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const dev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
    const nonce = dev ? process.env.ROOTDESK_DEV_CSP_NONCE : undefined
    const inlineNonce = nonce ? ` 'nonce-${nonce}'` : ''
    const devConnect = dev ? "'self' ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*" : "'self'"
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'${inlineNonce}; style-src 'self'${inlineNonce}; img-src 'self' data:; font-src 'self'; connect-src ${devConnect}; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'`
        ]
      }
    })
  })
}

export function hardenWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeRemoteUrl(url)) void shell.openExternal(url).catch(console.warn)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
}
