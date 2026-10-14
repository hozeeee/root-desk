import { performance } from 'node:perf_hooks'
import { app, session } from 'electron'
import { settingsSchema, proxySettingsSchema } from '@shared/settings'
import type { AppSettings, ProxySettings } from '@shared/contracts'
import type { SettingsService } from './settings-service'
import { secureFetch } from '@main/security/network'

export class ProxyService {
  private credential: string | undefined
  private activeProxy: ProxySettings | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly settings: SettingsService) {
    app.on('login', (event, _webContents, _request, authInfo, callback) => {
      const proxy = this.activeProxy
      if (!authInfo.isProxy || proxy?.mode !== 'custom') return
      event.preventDefault()
      if (proxy.protocol !== 'socks5' && authInfo.host.toLowerCase() === proxy.host.replace(/^\[|\]$/g, '').toLowerCase() &&
          authInfo.port === proxy.port && proxy.username && this.credential) callback(proxy.username, this.credential)
      else callback('', '')
    })
  }

  apply(proxy: ProxySettings, password?: string): Promise<void> {
    return this.serial(() => this.applyNow(proxy, password))
  }

  private async applyNow(input: ProxySettings, password?: string): Promise<void> {
    const proxy = proxySettingsSchema.parse(input)
    if (proxy.mode === 'custom' && !proxy.host.trim()) throw new Error('自定义代理需要填写主机')
    if (proxy.mode === 'custom' && proxy.protocol === 'socks5' && (proxy.username || password || proxy.hasCredential)) {
      throw new Error('Chromium SOCKS5 不支持用户名/密码认证，请使用无认证代理或 HTTP(S) 代理')
    }
    const previous = this.activeProxy
    const sameEndpoint = previous?.mode === 'custom' && proxy.mode === 'custom' &&
      previous.protocol === proxy.protocol && previous.host.toLowerCase() === proxy.host.toLowerCase() &&
      previous.port === proxy.port && previous.username === proxy.username
    const nextCredential = proxy.mode === 'custom' && proxy.protocol !== 'socks5'
      ? (password !== undefined ? password || undefined : sameEndpoint ? this.credential : undefined) : undefined
    // Invalidate credentials before awaiting network reconfiguration or closing pooled connections.
    this.credential = undefined
    this.activeProxy = undefined
    await session.defaultSession.closeAllConnections()
    await session.defaultSession.clearAuthCache()
    if (proxy.mode === 'system') await session.defaultSession.setProxy({ mode: 'system' })
    else await session.defaultSession.setProxy({ mode: 'fixed_servers', proxyRules: `${proxy.protocol}://${proxy.host}:${proxy.port}` })
    this.activeProxy = { ...proxy, hasCredential: Boolean(nextCredential) }
    this.credential = nextCredential
    await session.defaultSession.closeAllConnections()
  }

  update(patch: Partial<AppSettings> & { proxyPassword?: string }): Promise<AppSettings> {
    return this.serial(async () => {
      const { proxyPassword, ...persisted } = patch
      const previous = this.settings.get()
      const previousCredential = this.credential
      const next = settingsSchema.parse({ ...previous, ...persisted })
      const changed = Boolean(patch.proxy || proxyPassword !== undefined)
      try {
        if (changed) await this.applyNow(next.proxy, proxyPassword)
        next.proxy.hasCredential = Boolean(this.credential)
        return await this.settings.update(next)
      } catch (error) {
        if (changed) await this.applyNow(previous.proxy, previousCredential ?? '')
        throw error
      }
    })
  }

  test(): Promise<{ ok: boolean; message: string; resolvedProxy: string; latencyMs: number }> {
    return this.serial(async () => {
      const started = performance.now()
      let resolvedProxy = ''
      try {
        const url = 'https://dl.google.com/android/repository/repository2-1.xml'
        if (!this.activeProxy) await this.applyNow(this.settings.get().proxy)
        resolvedProxy = await session.defaultSession.resolveProxy(url)
        const response = await secureFetch(url, { signal: AbortSignal.timeout(15_000), policy: (value) => new URL(value).hostname === 'dl.google.com' })
        await response.body?.cancel()
        return { ok: true, message: '官方 HTTPS 连接测试成功', resolvedProxy, latencyMs: Math.round(performance.now() - started) }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error), resolvedProxy, latencyMs: Math.round(performance.now() - started) }
      }
    })
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation)
    this.queue = result.catch(() => undefined)
    return result
  }
}
