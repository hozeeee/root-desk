import { describe, expect, it } from 'vitest'
import { settingsPatchSchema, settingsSchema } from '@shared/settings'

describe('settings IPC validation', () => {
  it('拒绝未知字段及内嵌代理凭证', () => {
    expect(settingsPatchSchema.safeParse({ arbitraryInvoke: 'x' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ proxy: { mode: 'custom', protocol: 'http', host: 'user:pass@localhost', port: 8080 } }).success).toBe(false)
  })
  it('自定义代理必须提供有效主机和端口', () => {
    expect(settingsSchema.safeParse({ theme: 'dark', expertMode: false, proxy: { mode: 'custom', protocol: 'socks5', host: '127.0.0.1', port: 1080 } }).success).toBe(true)
    expect(settingsSchema.safeParse({ theme: 'dark', expertMode: false, proxy: { mode: 'custom', protocol: 'https', host: '', port: 8080 } }).success).toBe(false)
  })
})
