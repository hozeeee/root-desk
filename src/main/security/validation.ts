import { isAbsolute, relative, resolve, basename } from 'node:path'

export function isSafeRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && Boolean(url.hostname)
  } catch {
    return false
  }
}

export function isLoopbackDevUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

export function isPathInside(parent: string, child: string): boolean {
  const parentPath = resolve(parent)
  const childPath = resolve(child)
  const rel = relative(parentPath, childPath)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function safeFileName(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 200 || trimmed !== basename(trimmed) || /[\u0000-\u001f<>:"/\\|?*]/.test(trimmed)) return null
  if (trimmed === '.' || trimmed === '..' || /[. ]$/.test(trimmed) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(trimmed)) return null
  return trimmed
}

export function isApkPath(value: string): boolean {
  return isAbsolute(value) && value.toLowerCase().endsWith('.apk') && !value.includes('\u0000')
}
