import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { session } from 'electron'

export type UrlPolicy = (url: string) => boolean
export const MAX_DOWNLOAD_BYTES = 4 * 1024 ** 3

// Chromium owns DNS, TLS and proxy resolution. Never use Node fetch or a separate session.
export function isPublicHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
      (!url.port || url.port === '443') && host.includes('.') &&
      !/^[\d.]+$/.test(host) && !host.includes(':') &&
      !/(^|\.)(localhost|local|internal|test|invalid|example|lan|home|nip\.io|sslip\.io)$/.test(host)
  } catch { return false }
}

export async function secureFetch(url: string, options: {
  signal?: AbortSignal; policy?: UrlPolicy; headers?: Record<string, string>
} = {}): Promise<Response> {
  const policy = options.policy ?? isPublicHttpsUrl
  let current = url
  for (let count = 0; count <= 5; count++) {
    if (!isPublicHttpsUrl(current) || !policy(current)) throw new Error('拒绝不安全或未授权的 HTTPS 地址')
    options.signal?.throwIfAborted()
    const response = await session.defaultSession.fetch(current, {
      method: 'GET', redirect: 'manual', signal: options.signal, headers: options.headers,
      credentials: 'omit', cache: 'no-store'
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location || count === 5) throw new Error('无效重定向或重定向次数超限')
      current = new URL(location, current).href
      continue
    }
    if (response.url && (!isPublicHttpsUrl(response.url) || !policy(response.url))) {
      await response.body?.cancel()
      throw new Error('响应地址不安全')
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new Error(`服务器返回 HTTP ${response.status}`)
    }
    return response
  }
  throw new Error('重定向次数超限')
}

async function consume(response: Response, maxBytes: number, signal: AbortSignal,
  chunk: (value: Uint8Array) => Promise<void>): Promise<number> {
  const declared = response.headers.get('content-length')
  const reader = response.body!.getReader()
  let bytes = 0
  try {
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new Error('文件大小超过安全上限')
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new Error('文件大小超过安全上限')
      await chunk(value)
    }
    signal.throwIfAborted()
    return bytes
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}

export async function fetchBytes(url: string, maxBytes: number, policy?: UrlPolicy, signal?: AbortSignal): Promise<Buffer> {
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
  const response = await secureFetch(url, { policy, signal: combined })
  const chunks: Buffer[] = []
  await consume(response, maxBytes, combined, async (chunk) => { chunks.push(Buffer.from(chunk)) })
  return Buffer.concat(chunks)
}

export async function downloadFile(url: string, file: string, options: {
  maxBytes: number; signal?: AbortSignal; policy?: UrlPolicy;
  progress?: (bytes: number, total?: number) => void
}): Promise<{ bytes: number; sha256: string }> {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30 * 60_000)]) : AbortSignal.timeout(30 * 60_000)
  const response = await secureFetch(url, { policy: options.policy, signal })
  let output
  const hash = createHash('sha256')
  let received = 0
  try {
    output = await open(file, 'wx', 0o600)
    const bytes = await consume(response, options.maxBytes, signal, async (chunk) => {
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.byteLength) {
        const written = await output!.write(chunk, offset, chunk.byteLength - offset)
        if (!written.bytesWritten) throw new Error('写入文件失败')
        offset += written.bytesWritten
      }
      received += chunk.byteLength
      const total = Number(response.headers.get('content-length'))
      options.progress?.(received, total > 0 ? total : undefined)
    })
    await output.sync()
    return { bytes, sha256: hash.digest('hex') }
  } finally { await output?.close(); await response.body?.cancel().catch(() => undefined) }
}
