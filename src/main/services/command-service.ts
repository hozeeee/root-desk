import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { app } from 'electron'
import type { CommandDefinition } from '@shared/schemas'
import type { ApkInstallRequest, CommandPreview, CommandRequest, CommandRun, CommandSpec } from '@shared/contracts'
import { commandFilePaths, confirmationFor, fingerprintFile, previewCommand, type FileFingerprint } from '@main/security/command-policy'
import type { ContentService } from './content-service'
import type { PlatformToolsService } from './platform-tools-service'
import type { SettingsService } from './settings-service'

const MAX_STREAM_OUTPUT = 1024 * 1024
const TOKEN_TTL = 60_000
const MAX_TOKENS = 128
const deviceLocks = new Set<string>() // Shared by all CommandService instances, including APK installs.
interface PreviewTicket { expires: number; binding: string; files: FileFingerprint[] }
interface AuditContext { specHash: string; serialHash?: string; source: string }

export class CommandService {
  private readonly runs = new Map<string, CommandRun>()
  private readonly processes = new Map<string, ChildProcessWithoutNullStreams>()
  private readonly terminators = new Map<string, () => void>()
  private readonly probeStops = new Set<() => void>()
  private readonly tickets = new Map<string, PreviewTicket>()
  private readonly auditDirectory: string
  private disposed = false

  constructor(
    private readonly content: ContentService,
    private readonly settings: SettingsService,
    private readonly platformTools: PlatformToolsService
  ) {
    this.auditDirectory = join(app.getPath('userData'), 'audit')
    this.restoreHistory()
  }

  preview(request: CommandRequest): CommandPreview {
    const expertMode = this.settings.get().expertMode
    const preview = previewCommand(request, this.catalogCommands(), expertMode)
    if (!preview.allowed || !preview.spec || this.disposed) return this.disposed ? { ...preview, allowed: false, reason: '命令服务已停止' } : preview
    try {
      const files = this.filesFor(preview, request)
      const now = Date.now()
      for (const [token, ticket] of this.tickets) if (ticket.expires <= now) this.tickets.delete(token)
      while (this.tickets.size >= MAX_TOKENS) this.tickets.delete(this.tickets.keys().next().value!)
      const token = randomUUID()
      this.tickets.set(token, { expires: now + TOKEN_TTL, binding: binding(request, preview, expertMode), files })
      return { ...preview, token }
    } catch (error) { return { ...preview, allowed: false, reason: message(error), token: undefined } }
  }

  async execute(request: CommandRequest): Promise<CommandRun> {
    request = { ...request, parameters: request.parameters ? { ...request.parameters } : undefined,
      expert: request.expert ? { ...request.expert, args: [...request.expert.args] } : undefined }
    try {
      if (this.disposed) throw new Error('命令服务已停止')
      const ticket = request.previewToken ? this.tickets.get(request.previewToken) : undefined
      // Consume synchronously, before any awaits. Even failed execution cannot replay a ticket.
      if (request.previewToken) this.tickets.delete(request.previewToken)
      if (!ticket || ticket.expires <= Date.now()) throw new Error('预览 token 缺失、过期或已消费，请重新预览')
      const expertMode = this.settings.get().expertMode
      const preview = previewCommand(request, this.catalogCommands(), expertMode)
      this.assertAllowed(preview, request)
      if (ticket.binding !== binding(request, preview, expertMode)) throw new Error('命令参数或授权已变化，请重新预览')
      this.assertFiles(ticket.files, this.filesFor(preview, request))
      return await this.run(preview.spec!, preview.serial, preview.command?.timeoutMs ?? 120_000,
        () => {
          if (ticket.expires <= Date.now()) throw new Error('预览 token 已过期，请重新预览')
          const fresh = previewCommand(request, this.catalogCommands(), this.settings.get().expertMode)
          this.assertAllowed(fresh, request)
          if (ticket.binding !== binding(request, fresh, this.settings.get().expertMode)) throw new Error('命令参数或授权已变化，请重新预览')
          this.assertFiles(ticket.files, this.filesFor(fresh, request))
        }, preview.command?.deviceModes ?? [], preview.source)
    } catch (error) {
      this.auditRejection('command')
      throw error
    }
  }

  // Only ApkService calls this route after checking its native-dialog permission list.
  async installApk(filePath: string, options: ApkInstallRequest): Promise<CommandRun> {
    options = { ...options }
    try {
      if (this.disposed) throw new Error('命令服务已停止')
      const serial = options.serial
      const authorize = (): void => {
        if (!serial || !/^[a-zA-Z0-9_.-]{1,256}$/.test(serial) || serial.startsWith('-')) throw new Error('安装 APK 必须指定有效 USB serial')
        if ((options.allowDowngrade || options.grantPermissions) && !this.settings.get().expertMode) throw new Error('降级或授予权限需要专家模式')
        if (options.confirmation !== confirmationFor(serial)) throw new Error(`安装 APK 需要确认词：${confirmationFor(serial)}`)
      }
      authorize()
      const file = fingerprintFile(filePath)
      const args = ['-s', serial, 'install']
      if (options.replace) args.push('-r')
      if (options.allowDowngrade) args.push('-d')
      if (options.grantPermissions) args.push('-g')
      args.push(filePath)
      return await this.run({ executable: 'adb', args }, serial, 300_000, () => {
        authorize()
        this.assertFiles([file], [fingerprintFile(filePath)])
      }, ['adb'], 'apk')
    } catch (error) { this.auditRejection('apk'); throw error }
  }

  cancel(id: string): boolean {
    const run = this.runs.get(id)
    const terminate = this.terminators.get(id)
    if (!terminate || !run || run.status !== 'running') return false
    run.status = 'cancelled'
    run.finishedAt = new Date().toISOString()
    terminate()
    return true
  }

  list(): CommandRun[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200).map((run) => ({ ...run, args: [...run.args] }))
  }

  dispose(): void {
    this.disposed = true
    this.tickets.clear()
    for (const id of this.processes.keys()) this.cancel(id)
    for (const stop of this.probeStops) stop()
  }

  private assertAllowed(preview: CommandPreview, request: CommandRequest): void {
    if (!preview.allowed || !preview.spec) throw new Error(preview.reason ?? '命令未获允许')
    if (preview.requiresConfirmation && request.confirmation !== preview.confirmationWord) throw new Error(`风险命令需要输入确认词：${preview.confirmationWord}`)
  }

  private filesFor(preview: CommandPreview, request: CommandRequest): FileFingerprint[] {
    return commandFilePaths(preview.spec!, preview.command, request.parameters).map(fingerprintFile)
  }

  private assertFiles(before: FileFingerprint[], after: FileFingerprint[]): void {
    if (stable(before) !== stable(after)) throw new Error('文件内容、路径或身份已变化，请重新预览/选择')
  }

  private async assertDevice(spec: CommandSpec, serial: string | undefined, modes: string[], binary: string): Promise<void> {
    if (!serial) return
    const devices = spec.executable === 'adb' ? await this.platformTools.listAdbDevices() : await this.platformTools.listFastbootDevices()
    const matches = devices.filter((device) => device.serial === serial)
    if (matches.length !== 1) throw new Error('目标 serial 不在线或不唯一，请刷新设备')
    const state = matches[0].state
    if (spec.executable === 'adb' && !['device', 'recovery', 'sideload'].includes(state)) throw new Error('目标设备未授权、离线或不是 ADB 模式')
    if (spec.executable === 'fastboot' && !['fastboot', 'bootloader', 'fastbootd'].includes(state)) throw new Error('目标设备不是 Fastboot 模式')
    if (!modes.length) return
    let actual = spec.executable === 'adb' ? (state === 'device' ? 'android' : state) : state
    // Transport listings cannot distinguish bootloader/fastbootd, or Android/recovery.
    // Probe only read-only properties on the SAME serial; unknown results fail closed.
    if (spec.executable === 'fastboot' && state === 'fastboot' && !modes.includes('fastboot')) {
      const result = await this.probe(binary, ['-s', serial, 'getvar', 'is-userspace'])
      const match = /(?:^|\n)\s*(?:\(bootloader\)\s*)?is-userspace:\s*(yes|no)\s*(?:\r?\n|$)/i.exec(result)
      if (!match) throw new Error('无法核验 bootloader / fastbootd 模式')
      actual = match[1].toLowerCase() === 'yes' ? 'fastbootd' : 'bootloader'
    }
    if (spec.executable === 'adb' && state === 'device' && !modes.includes('adb') && !(modes.includes('android') && modes.includes('recovery'))) {
      const result = (await this.probe(binary, ['-s', serial, 'shell', 'getprop', 'ro.bootmode'])).trim()
      if (['normal', 'unknown', 'android'].includes(result)) actual = 'android'
      else if (result === 'recovery') actual = 'recovery'
      else throw new Error('无法核验 Android / recovery 模式')
    }
    const transport = spec.executable === 'adb' ? 'adb' : 'fastboot'
    if (!modes.includes(transport) && !modes.includes(actual)) throw new Error('目标设备模式与命令 deviceModes 不匹配')
  }

  private probe(binary: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const executable = args.includes('getvar') ? 'fastboot' : 'adb'
      const audit: AuditContext = { source: 'device-mode', specHash: digest({ executable, args }), serialHash: digest(args[1]) }
      const record: CommandRun = { id: randomUUID(), executable, args: [], status: 'running', startedAt: new Date().toISOString(), stdout: '', stderr: '' }
      this.saveAudit(record, audit)
      let child: ChildProcessWithoutNullStreams
      try { child = spawn(binary, args, spawnOptions()) }
      catch { record.status = 'failed'; record.finishedAt = new Date().toISOString(); this.saveAudit(record, audit); reject(new Error('设备模式核验失败')); return }
      let output = ''
      let stopped = false
      let finished = false
      let escalation: ReturnType<typeof setTimeout> | undefined
      const stop = (): void => {
        if (finished || stopped) return
        stopped = true; child.kill()
        if (!finished) escalation = setTimeout(() => { if (!finished) child.kill('SIGKILL') }, 1000)
      }
      this.probeStops.add(stop)
      // Do NOT reject until close/error: the global device lock must outlive a killed probe.
      const timer = setTimeout(stop, 10_000)
      const append = (chunk: Buffer): void => { output = appendLimited(output, chunk.toString('utf8'), 16 * 1024) }
      const finish = (code: number | null): void => {
        if (finished) return
        finished = true
        clearTimeout(timer); if (escalation) clearTimeout(escalation)
        this.probeStops.delete(stop)
        record.status = !stopped && code === 0 ? 'completed' : 'failed'
        record.finishedAt = new Date().toISOString(); record.exitCode = code
        try { this.saveAudit(record, audit) } catch { reject(new Error('审计日志保存失败')); return }
        if (stopped || code !== 0) reject(new Error(stopped ? '设备模式核验超时或取消' : '设备模式核验失败'))
        else resolve(output)
      }
      child.stdout.on('data', append); child.stderr.on('data', append)
      child.once('error', () => finish(null))
      child.once('close', (code) => finish(code))
    })
  }

  private async run(spec: CommandSpec, serial: string | undefined, timeoutMs: number, revalidate: () => void, modes: string[], source: string): Promise<CommandRun> {
    if (serial && deviceLocks.has(serial)) throw new Error('同一设备已有命令运行，请等待结束或取消')
    if (serial) deviceLocks.add(serial)
    let handedOff = false
    try {
      const binary = await this.platformTools.resolveBinary(spec.executable)
      await this.assertDevice(spec, serial, modes, binary)
      if (this.disposed) throw new Error('命令服务已停止')
      revalidate()
      const run: CommandRun = { id: randomUUID(), status: 'running', executable: spec.executable, args: [...spec.args], startedAt: new Date().toISOString(), stdout: '', stderr: '' }
      const audit: AuditContext = { source, specHash: digest(spec), serialHash: serial ? digest(serial) : undefined }
      this.saveAudit(run, audit) // Fail closed BEFORE spawning when audit cannot be written.
      this.runs.set(run.id, run)
      let child: ChildProcessWithoutNullStreams
      try { child = spawn(binary, spec.args, spawnOptions()) }
      catch (error) { run.status = 'failed'; run.finishedAt = new Date().toISOString(); this.saveAudit(run, audit); throw error }
      this.processes.set(run.id, child)
      handedOff = true
      let escalation: ReturnType<typeof setTimeout> | undefined
      let finished = false
      const timeout = Math.min(600_000, Math.max(1000, Number.isFinite(timeoutMs) ? timeoutMs : 120_000))
      const persist = (): void => {
        try { this.saveAudit(run, audit) } catch { run.error = '审计日志保存失败'; if (run.status === 'completed') run.status = 'failed' }
      }
      const terminate = (): void => {
        persist()
        child.kill()
        if (!finished && !escalation) escalation = setTimeout(() => { if (!finished) child.kill('SIGKILL') }, 1000)
      }
      this.terminators.set(run.id, terminate)
      const timer = setTimeout(() => {
        if (run.status === 'running') {
          run.status = 'failed'; run.error = `命令执行超过 ${Math.round(timeout / 1000)} 秒`; run.finishedAt = new Date().toISOString()
          terminate()
        }
      }, timeout)
      const finish = (code: number | null, error?: Error): void => {
        if (finished) return
        finished = true
        clearTimeout(timer); if (escalation) clearTimeout(escalation)
        this.processes.delete(run.id); this.terminators.delete(run.id)
        if (serial) deviceLocks.delete(serial)
        run.exitCode = code; run.finishedAt ??= new Date().toISOString()
        if (error) run.error = '进程启动或执行失败'
        if (run.status === 'running') run.status = code === 0 && !error ? 'completed' : 'failed'
        persist()
      }
      child.stdout.on('data', (chunk: Buffer) => { run.stdout = appendLimited(run.stdout, chunk.toString('utf8')) })
      child.stderr.on('data', (chunk: Buffer) => { run.stderr = appendLimited(run.stderr, chunk.toString('utf8')) })
      child.once('error', (error) => finish(null, error))
      child.once('close', (code) => finish(code))
      while (this.runs.size > 200) {
        const old = [...this.runs.values()].find((item) => item.status !== 'running' && !this.processes.has(item.id))
        if (!old) break
        this.runs.delete(old.id)
      }
      return { ...run, args: [...run.args] }
    } finally { if (!handedOff && serial) deviceLocks.delete(serial) }
  }

  private catalogCommands(): Map<string, CommandDefinition> {
    return new Map((this.content.getSnapshot().commands?.commands ?? []).map((command) => [command.id, command]))
  }

  private saveAudit(run: CommandRun, context: AuditContext): void {
    mkdirSync(this.auditDirectory, { recursive: true, mode: 0o700 })
    // Never persist argv, file paths, confirmation text, stdout/stderr or raw errors.
    writeFileSync(join(this.auditDirectory, `${run.id}.json`), JSON.stringify({ version: 1, id: run.id, executable: run.executable, status: run.status,
      startedAt: run.startedAt, finishedAt: run.finishedAt, exitCode: run.exitCode, ...context }), { mode: 0o600 })
  }

  private auditRejection(source: string): void {
    try {
      this.saveAudit({ id: randomUUID(), executable: 'redacted', args: [], status: 'failed', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), stdout: '', stderr: '' },
        { specHash: digest('rejected'), source })
    } catch { /* The original rejection remains authoritative; successful execution still requires audit. */ }
  }

  private restoreHistory(): void {
    try {
      const files = readdirSync(this.auditDirectory).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name)).slice(-1000)
      for (const file of files) {
        try {
          const record = JSON.parse(readFileSync(join(this.auditDirectory, file), 'utf8')) as Partial<CommandRun>
          if (!record.id || !['adb', 'fastboot'].includes(record.executable ?? '') || !record.startedAt ||
            !['running', 'completed', 'failed', 'cancelled'].includes(record.status ?? '')) continue
          this.runs.set(record.id, { id: record.id, executable: record.executable!, status: record.status === 'running' ? 'failed' : record.status!,
            args: ['[历史参数已脱敏]'], startedAt: record.startedAt, finishedAt: record.finishedAt, exitCode: record.exitCode,
            stdout: '', stderr: '', error: record.status === 'running' ? '上次运行被中断' : undefined })
        } catch { /* Ignore incomplete audit files after an interrupted write. */ }
      }
    } catch { /* First launch has no history. Writes are mandatory at execution time. */ }
  }
}

function spawnOptions(): { shell: false; windowsHide: true; env: NodeJS.ProcessEnv } {
  const env = { ...process.env }
  for (const name of ['ANDROID_SERIAL', 'ADB_SERVER_SOCKET', 'ANDROID_ADB_SERVER_ADDRESS', 'ANDROID_ADB_SERVER_PORT', 'ADB_MDNS_AUTO_CONNECT']) delete env[name]
  return { shell: false, windowsHide: true, env }
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function digest(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex') }
function binding(request: CommandRequest, preview: CommandPreview, expertMode: boolean): string {
  return digest({ commandId: request.commandId, expert: request.expert, parameters: request.parameters ?? {}, serial: request.serial,
    spec: preview.spec, command: preview.command, requiresConfirmation: preview.requiresConfirmation, confirmationWord: preview.confirmationWord, expertMode })
}
function appendLimited(current: string, addition: string, limit = MAX_STREAM_OUTPUT): string {
  const buffer = Buffer.from(current + addition, 'utf8')
  let start = Math.max(0, buffer.length - limit)
  // Skip UTF-8 continuation bytes, so truncation cannot expand through replacement characters.
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) start++
  return buffer.subarray(start).toString('utf8')
}
function message(error: unknown): string { return error instanceof Error ? error.message : '命令预检失败' }
