import { describe, expect, it } from 'vitest'
import { isApkPath, isPathInside, isSafeRemoteUrl, safeFileName } from '@main/security/validation'

describe('path and URL validation', () => {
  it('仅接受无内嵌凭证的 HTTPS URL', () => {
    expect(isSafeRemoteUrl('https://github.com/example/file.zip')).toBe(true)
    expect(isSafeRemoteUrl('http://example.com/file.zip')).toBe(false)
    expect(isSafeRemoteUrl('https://user:pass@example.com/file.zip')).toBe(false)
    expect(isSafeRemoteUrl('file:///etc/passwd')).toBe(false)
  })

  it('阻止父目录穿越并验证文件名', () => {
    expect(isPathInside('/tmp/rootdesk', '/tmp/rootdesk/file.zip')).toBe(true)
    expect(isPathInside('/tmp/rootdesk', '/tmp/escape.zip')).toBe(false)
    expect(safeFileName('platform-tools.zip')).toBe('platform-tools.zip')
    expect(safeFileName('../escape.zip')).toBeNull()
  })

  it('APK 路径必须为绝对路径且扩展名正确', () => {
    expect(isApkPath('/Users/test/app.apk')).toBe(true)
    expect(isApkPath('relative/app.apk')).toBe(false)
    expect(isApkPath('/Users/test/app.zip')).toBe(false)
  })
})
