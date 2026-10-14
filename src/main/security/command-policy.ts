import { createHash } from 'node:crypto'
import { constants, accessSync, closeSync, fstatSync, openSync, readSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { CommandDefinition } from '@shared/schemas'
import type { CommandPreview, CommandRequest, CommandSpec } from '@shared/contracts'

export const RISK_CONFIRMATION = '我已了解风险'
export function confirmationFor(serial: string): string { return `${RISK_CONFIRMATION} ${serial}` }
const forbiddenShellSyntax = /[\u0000-\u001f;&|`$<>{}()*?]/
const selectors = /^(?:-[stdeHPL](?:.*)?|--(?:serial|transport-id|host|port|socket)(?:=|$))/
const forbiddenAdb = new Set(['connect', 'disconnect', 'tcpip', 'usb', 'forward', 'reverse', 'start-server', 'kill-server', 'server', 'host-features', 'keygen', 'ppp', 'emu', 'exec-in', 'exec-out'])
const word = /^[a-zA-Z0-9_.:-]+$/

export function hasShellMetacharacter(parts: string[]): boolean {
  return parts.some((part) => typeof part !== 'string' || forbiddenShellSyntax.test(part))
}

export function isHostQuery(args: string[]): boolean {
  return (args.length === 1 && ['devices', 'version', '--version', 'help', '--help', '-h'].includes(args[0])) ||
    (args.length === 2 && args[0] === 'devices' && args[1] === '-l')
}

function isReadOnly(executable: string, args: string[]): boolean {
  if (isHostQuery(args)) return true
  if (executable === 'fastboot') return args.length === 2 && args[0] === 'getvar' && word.test(args[1]) && !args[1].startsWith('-')
  if (args.length === 1 && ['get-state', 'get-serialno', 'get-devpath', 'features'].includes(args[0])) return true
  if (args[0] !== 'shell') return false
  const shell = args.slice(1)
  if (shell[0] === 'getprop') return shell.length === 1 || (shell.length === 2 && /^[a-zA-Z0-9_.]+$/.test(shell[1]))
  if (shell[0] === 'id') return shell.length === 1
  if (shell[0] === 'uname') return shell.length === 1 || (shell.length === 2 && ['-a', '-r', '-m', '-s'].includes(shell[1]))
  // Exact grammar: never classify "pm list ..." by a prefix or substring.
  if (shell[0] === 'pm' && shell[1] === 'list' && shell[2] === 'packages') {
    return shell.slice(3).every((arg) => ['-f', '-3', '-s', '-u', '-U', '-i'].includes(arg))
  }
  return false
}

function isLowRisk(executable: string, args: string[]): boolean {
  if (args[0] === 'reboot') return args.length === 1 || (args.length === 2 && ['bootloader', 'recovery', 'fastboot'].includes(args[1]))
  if (executable === 'fastboot' && args.length === 1 && args[0] === 'reboot-bootloader') return true
  return executable === 'adb' && args[0] === 'install' &&
    ((args.length === 2 && isAbsolute(args[1])) || (args.length === 3 && args[1] === '-r' && isAbsolute(args[2])))
}

export function isRiskCommand(executable: string, args: string[]): boolean {
  return !isReadOnly(executable, args)
}

export interface FileFingerprint { path: string; realPath: string; sha256: string; size: number; device: number; inode: number; modified: number }

// Hash in bounded chunks, and reject replacement/modification while hashing.
export function fingerprintFile(path: string): FileFingerprint {
  if (!isAbsolute(path)) throw new Error('文件参数必须是绝对路径')
  let fd: number | undefined
  try {
    accessSync(path, constants.R_OK)
    const realPath = realpathSync(path)
    fd = openSync(realPath, 'r')
    const before = fstatSync(fd)
    if (!before.isFile()) throw new Error('not a file')
    const hash = createHash('sha256')
    const chunk = Buffer.alloc(64 * 1024)
    let count: number
    while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count))
    const after = fstatSync(fd)
    const current = statSync(path)
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
      current.dev !== after.dev || current.ino !== after.ino || realpathSync(path) !== realPath) throw new Error('changed')
    return { path, realPath, sha256: hash.digest('hex'), size: after.size, device: after.dev, inode: after.ino, modified: after.mtimeMs }
  } catch { throw new Error('文件必须存在、可读且为未变化的普通文件') }
  finally { if (fd !== undefined) closeSync(fd) }
}

function templateArgs(command: CommandDefinition, parameters: Record<string, string>): string[] {
  const definitions = command.parameters ?? []
  if (Object.keys(parameters).some((key) => !definitions.some((item) => item.name === key))) throw new Error('存在未声明的模板参数')
  for (const parameter of definitions) {
    const value = parameters[parameter.name]
    if (value === undefined || value === '') {
      if (parameter.required) throw new Error(`请填写参数 ${parameter.name}`)
      continue
    }
    if (typeof value !== 'string' || value.length > 4096 || hasShellMetacharacter([value]) || value.startsWith('-')) throw new Error('模板参数不符合安全限制')
    if (parameter.type === 'enum' && !parameter.allowedValues?.includes(value)) throw new Error(`参数 ${parameter.name} 不在允许的枚举值中`)
    if (parameter.type === 'file') {
      fingerprintFile(value)
      if (!command.args.includes(`{${parameter.name}}`)) throw new Error('文件参数必须独占一个参数位置')
    }
  }
  return command.args.flatMap((arg) => {
    if (/^\{[a-zA-Z0-9_-]+\}$/.test(arg)) {
      const name = arg.slice(1, -1)
      const definition = definitions.find((item) => item.name === name)
      if (!definition) throw new Error('模板包含未声明参数')
      if (!parameters[name] && !definition.required) return []
    }
    return [arg.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
      if (!definitions.some((item) => item.name === name) || !parameters[name]) throw new Error('模板参数未填写')
      return parameters[name]
    })]
  })
}

// Strip only explicitly understood fastboot global options; unknown options fail closed.
function fastbootOperands(args: string[]): string[] {
  let index = 0
  while (args[index]?.startsWith('-')) {
    const option = args[index++]
    if (option === '--slot') {
      if (!['a', 'b', 'all'].includes(args[index++] ?? '')) throw new Error('无效的 --slot 参数')
    } else if (option.startsWith('--slot=')) {
      if (!['a', 'b', 'all'].includes(option.slice(7))) throw new Error('无效的 --slot 参数')
    } else if (!['-w', '-v', '--verbose', '--force', '--disable-verity', '--disable-verification', '--skip-secondary', '--skip-reboot'].includes(option)) {
      throw new Error('不允许的 fastboot option')
    }
  }
  return args.slice(index)
}

export function commandFilePaths(spec: CommandSpec, command?: CommandDefinition, parameters: Record<string, string> = {}): string[] {
  const args = spec.args[0] === '-s' ? spec.args.slice(2) : spec.args
  const paths = (command?.parameters ?? []).filter((item) => item.type === 'file' && parameters[item.name]).map((item) => parameters[item.name])
  const operands = spec.executable === 'fastboot' && !isHostQuery(args) ? fastbootOperands(args) : args
  const required: string[] = []
  if (spec.executable === 'fastboot') {
    if (operands[0] === 'flashall') throw new Error('flashall 的隐式文件不可核验，请使用明确文件模板')
    if (['flash', 'flash:raw'].includes(operands[0])) {
      if (operands.length < 3) throw new Error('刷写命令缺少镜像文件')
      required.push(...operands.slice(2))
    }
    if (['boot', 'update'].includes(operands[0])) {
      if (operands.length < 2) throw new Error('命令缺少镜像文件')
      required.push(...operands.slice(1))
    }
  } else if (['install', 'install-multiple', 'sideload', 'push'].includes(operands[0])) {
    const files = operands.slice(1).filter((arg) => !arg.startsWith('-'))
    if (operands[0] === 'push') files.pop()
    if (!files.length) throw new Error('命令缺少本地文件')
    required.push(...files)
  }
  for (const file of required) if (!isAbsolute(file)) throw new Error('文件参数必须是绝对路径')
  return [...new Set([...paths, ...required, ...args.filter(isAbsolute)])]
}

export function previewCommand(request: CommandRequest, catalog: Map<string, CommandDefinition>, expertMode: boolean): CommandPreview {
  try {
    if (Boolean(request.commandId) === Boolean(request.expert)) return denied('必须且只能指定一种命令来源')
    let command: CommandDefinition | undefined
    let executable: 'adb' | 'fastboot'
    let args: string[]
    const source = request.commandId ? 'catalog' : 'expert'
    if (request.commandId) {
      command = catalog.get(request.commandId)
      if (!command) return denied('命令不在本地内容目录白名单中')
      if (command.expertOnly && !expertMode) return denied('该目录命令仅在专家模式可用')
      executable = command.executable
      args = templateArgs(command, request.parameters ?? {})
    } else {
      if (!expertMode) return denied('请先在设置中启用专家模式')
      if (Object.keys(request.parameters ?? {}).length) return denied('专家命令不接受模板参数')
      executable = request.expert!.executable
      args = [...request.expert!.args]
    }
    if (!['adb', 'fastboot'].includes(executable)) return denied('仅允许 adb 或 fastboot')
    if (!args.length || args.length > 128 || args.some((arg) => typeof arg !== 'string' || !arg || arg.length > 4096)) return denied('命令参数超出安全限制')
    if (hasShellMetacharacter([executable, ...args])) return denied('参数包含被禁止的 shell 元字符')
    if (args.some((arg) => selectors.test(arg) || /^(?:tcp|udp):/i.test(arg))) return denied('禁止自行指定设备 selector 或远程连接')
    const host = isHostQuery(args)
    if (executable === 'adb') {
      if (forbiddenAdb.has(args[0]) || args[0].startsWith('-') && !host) return denied('禁止主机/远程连接绕行及未知 adb option')
      if (args[0] === 'shell' && !isReadOnly(executable, args)) return denied('shell 仅允许精确的只读查询，不允许解释器或修改命令')
    } else if (!host) {
      const operands = fastbootOperands(args)
      if (operands.some((arg) => /^(?:tcp|udp):/i.test(arg))) return denied('禁止远程连接')
      if (operands.length && operands[0].startsWith('-')) return denied('未知命令 option')
    }
    if (!host && (!request.serial || !/^[a-zA-Z0-9_.-]{1,256}$/.test(request.serial) || request.serial.startsWith('-'))) return denied('设备目标命令必须指定有效 USB serial')
    const readOnly = isReadOnly(executable, args)
    const highRisk = command?.risk === 'danger' || (!readOnly && !isLowRisk(executable, args))
    if (highRisk && !expertMode) return denied('高风险或未知命令仅在专家模式可用')
    const requiresConfirmation = !readOnly || command?.risk === 'caution' || command?.risk === 'danger'
    const serial = host ? undefined : request.serial
    const spec: CommandSpec = { executable, args: serial ? ['-s', serial, ...args] : [...args] }
    for (const path of commandFilePaths(spec, command, request.parameters)) fingerprintFile(path)
    return { allowed: true, display: [executable, ...spec.args].map(quoteDisplay).join(' '), source, command, spec, serial,
      requiresConfirmation, confirmationWord: requiresConfirmation ? confirmationFor(serial ?? 'HOST') : undefined }
  } catch (error) { return denied(error instanceof Error ? error.message : '命令参数无效') }
}

function denied(reason: string): CommandPreview {
  return { allowed: false, display: '', source: 'catalog', requiresConfirmation: false, reason }
}
function quoteDisplay(value: string): string { return /^[a-zA-Z0-9_./:=+-]+$/.test(value) ? value : JSON.stringify(value) }
