import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { previewCommand, confirmationFor, isRiskCommand } from '@main/security/command-policy'
import type { CommandDefinition } from '@shared/schemas'
import type { CommandRequest } from '@shared/contracts'

const root = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), '.command-policy-'))
const image = join(root, 'boot image.img')
writeFileSync(image, 'mock image')
afterAll(() => rmSync(root, { recursive: true, force: true }))
const safe: CommandDefinition = { id: 'devices', title: '设备列表', description: '', executable: 'adb', args: ['devices', '-l'], category: 'inspect', risk: 'safe', timeoutMs: 1000, parameters: [], deviceModes: [] }
const query: CommandDefinition = { ...safe, id: 'query', args: ['shell', 'getprop', 'ro.product.device'], deviceModes: ['android'] }
const flash: CommandDefinition = { ...safe, id: 'flash', executable: 'fastboot', args: ['flash', 'boot', image], risk: 'danger' }
const catalog = new Map([[safe.id, safe], [query.id, query], [flash.id, flash]])
const expert = (args: string[], executable: 'adb' | 'fastboot' = 'adb', serial = 'SERIAL'): CommandRequest => ({ expert: { executable, args }, serial })

describe('command policy', () => {
  it('普通模式只接受本地目录；危险目录条目不能依靠 safe 标签绕过', () => {
    expect(previewCommand({ commandId: safe.id }, catalog, false).allowed).toBe(true)
    expect(previewCommand(expert(['devices']), catalog, false).allowed).toBe(false)
    expect(previewCommand({ commandId: 'missing' }, catalog, false).allowed).toBe(false)
    expect(previewCommand({ commandId: flash.id, serial: 'SERIAL' }, catalog, false).allowed).toBe(false)
    expect(previewCommand({ commandId: flash.id, serial: 'SERIAL' }, new Map([[flash.id, { ...flash, risk: 'safe' }]]), false).allowed).toBe(false)
    expect(previewCommand({ commandId: safe.id, expert: { executable: 'adb', args: ['devices'] } }, catalog, true).allowed).toBe(false)
  })

  it('所有目标查询必须指定 serial，由策略注入 -s', () => {
    expect(previewCommand({ commandId: query.id }, catalog, false).allowed).toBe(false)
    expect(previewCommand({ commandId: query.id, serial: 'SERIAL' }, catalog, false).spec).toEqual({ executable: 'adb', args: ['-s', 'SERIAL', ...query.args] })
    for (const serial of ['', '-evil', 'tcp:host:5555', 'two devices', 'S\n']) expect(previewCommand({ commandId: query.id, serial }, catalog, false).allowed).toBe(false)
  })

  it.each(['adb', 'fastboot'] as const)('仅精确的 %s 列表、版本和帮助命令无需 serial', (executable) => {
    for (const args of [['devices'], ['devices', '-l'], ['version'], ['--version'], ['help'], ['-h'], ['--help']]) {
      const preview = previewCommand({ expert: { executable, args } }, catalog, true)
      expect(preview.allowed).toBe(true); expect(preview.serial).toBeUndefined(); expect(preview.requiresConfirmation).toBe(false)
    }
    for (const args of [['devices', 'reboot'], ['version', '-w'], ['--help', 'erase', 'userdata']]) expect(previewCommand({ expert: { executable, args } }, catalog, true).allowed).toBe(false)
  })

  it.each([';', '|', '&&', '`id`', '$HOME', '$(id)', '\n', '\u0000', '>out', '{x}'])('禁止 shell 元字符 %s', (part) => {
    expect(previewCommand(expert(['shell', 'getprop', part]), catalog, true).allowed).toBe(false)
  })

  it.each(['-s', '-sOTHER', '-t', '-t2', '-d', '-e', '-H', '-Hhost', '-P', '-P5037', '-L', '-Ltcp:host:5037', '--serial=OTHER', '--transport-id=2', '--host=remote', '--port=5555'])('禁止 selector %s 的位置/拼接绕过', (selector) => {
    for (const args of [[selector, 'get-state'], ['get-state', selector], ['oem', selector]]) {
      expect(previewCommand(expert(args), catalog, true).allowed).toBe(false)
      expect(previewCommand(expert(args, 'fastboot'), catalog, true).allowed).toBe(false)
    }
  })

  it.each(['connect', 'disconnect', 'tcpip', 'usb', 'forward', 'reverse', 'start-server', 'kill-server', 'server', 'exec-out', 'exec-in', 'emu', 'keygen'])('禁止主机/远程绕行 %s', (subcommand) => {
    expect(previewCommand(expert([subcommand, '127.0.0.1:5555']), catalog, true).allowed).toBe(false)
  })

  it.each([['shell', 'sh', '-c', 'id'], ['shell', 'bash'], ['shell', 'su'], ['shell', 'getprop ro.product.device'], ['shell', 'getprop', 'ro.test reboot'], ['shell', 'getprop', '-w'], ['shell', 'pm', 'list', 'packages', '--user', '0'], ['shell', 'pm', 'list', 'packages', 'reboot'], ['shell', 'uname', '-a', 'reboot']])('shell 必须匹配完整只读 grammar %j', (...args: string[]) => {
    expect(previewCommand(expert(args), catalog, true).allowed).toBe(false)
  })

  it.each([['shell', 'getprop'], ['shell', 'getprop', 'ro.product.device'], ['shell', 'id'], ['shell', 'uname', '-a'], ['shell', 'pm', 'list', 'packages', '-f', '-3'], ['get-state']])('精确只读查询无确认 %j', (...args: string[]) => {
    const result = previewCommand(expert(args), catalog, true)
    expect(result.allowed).toBe(true); expect(result.requiresConfirmation).toBe(false)
  })

  it.each([['oem', 'anything'], ['reboot'], ['flashing', 'unlock'], ['flashing', 'lock'], ['erase', 'userdata'], ['-w'], ['unknown'], ['getvar', 'product', '--set-active=a']])('专家未知/修改命令保守确认 %j', (...args: string[]) => {
    const result = previewCommand(expert(args, 'fastboot'), catalog, true)
    expect(result.allowed).toBe(true); expect(result.requiresConfirmation).toBe(true); expect(result.confirmationWord).toBe(confirmationFor('SERIAL'))
    expect(isRiskCommand('fastboot', args)).toBe(true)
  })

  it('低风险目录重启可在普通模式确认；额外 options 不能借只读 prefix 降级', () => {
    const reboot = { ...safe, id: 'reboot', args: ['reboot', 'bootloader'] }
    const result = previewCommand({ commandId: 'reboot', serial: 'SERIAL' }, new Map([['reboot', reboot]]), false)
    expect(result.allowed).toBe(true); expect(result.requiresConfirmation).toBe(true)
    const changed = { ...query, executable: 'fastboot' as const, args: ['getvar', 'product', '--set-active=a'] }
    expect(previewCommand({ commandId: 'query', serial: 'SERIAL' }, new Map([['query', changed]]), false).allowed).toBe(false)
  })

  it('文件/枚举/字符串模板无需专家手写，并绑定完整 argv', () => {
    const template: CommandDefinition = { ...flash, args: ['flash', '{partition}_{slot}', '{image}'], parameters: [
      { name: 'partition', type: 'enum', required: true, allowedValues: ['boot', 'init_boot'], description: '' },
      { name: 'slot', type: 'enum', required: true, allowedValues: ['a', 'b'], description: '' },
      { name: 'image', type: 'file', required: true, description: '' }
    ] }
    const map = new Map([[template.id, template]])
    const input = { commandId: template.id, serial: 'SERIAL', parameters: { partition: 'boot', slot: 'b', image } }
    expect(previewCommand(input, map, true).spec?.args).toEqual(['-s', 'SERIAL', 'flash', 'boot_b', image])
    for (const parameters of [{ ...input.parameters, slot: 'c' }, { ...input.parameters, partition: 'userdata' }, { ...input.parameters, image: 'relative.img' }, { ...input.parameters, image: join(root, 'missing') }, { ...input.parameters, image: root }, { ...input.parameters, extra: 'x' }, { slot: 'a', image }]) {
      expect(previewCommand({ ...input, parameters }, map, true).allowed).toBe(false)
    }
    const string: CommandDefinition = { ...query, args: ['shell', 'getprop', '{property}'], parameters: [{ name: 'property', type: 'string', required: true, description: '' }] }
    expect(previewCommand({ commandId: string.id, serial: 'SERIAL', parameters: { property: 'ro.test' } }, new Map([[string.id, string]]), false).allowed).toBe(true)
    expect(previewCommand({ commandId: string.id, serial: 'SERIAL', parameters: { property: '-s' } }, new Map([[string.id, string]]), false).allowed).toBe(false)
  })

  it('拒绝文件缺失、目录、相对路径及隐式 flashall', () => {
    const directory = join(root, 'directory'); mkdirSync(directory)
    for (const file of ['boot.img', join(root, 'missing.img'), directory]) expect(previewCommand(expert(['flash', 'boot', file], 'fastboot'), catalog, true).allowed).toBe(false)
    expect(previewCommand(expert(['flashall'], 'fastboot'), catalog, true).allowed).toBe(false)
    expect(previewCommand(expert(['--slot', 'b', 'flash', 'boot', image], 'fastboot'), catalog, true).allowed).toBe(true)
    expect(previewCommand(expert(['--slot=all', 'getvar', 'product'], 'fastboot'), catalog, true).requiresConfirmation).toBe(true)
    expect(previewCommand(expert(['--slot', 'evil', 'getvar', 'product'], 'fastboot'), catalog, true).allowed).toBe(false)
  })
})
