import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentService } from '@main/services/content-service'
import type { SettingsService } from '@main/services/settings-service'
import type { PlatformToolsService } from '@main/services/platform-tools-service'
import type { CommandDefinition } from '@shared/schemas'
import type { CommandRequest, ConnectedDevice } from '@shared/contracts'
import { CommandService } from '@main/services/command-service'
import { confirmationFor } from '@main/security/command-policy'

const { spawn, getPath } = vi.hoisted(() => ({ spawn: vi.fn(), getPath: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('electron', () => ({ app: { getPath } }))

type Child = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
let root: string
let children: Child[]
let services: CommandService[]
function child(): Child {
  const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) })
  children.push(process)
  return process
}
function fixture() {
  const state = { expertMode: false }
  const image = join(root, 'image.img'); writeFileSync(image, 'mock original')
  const definitions: CommandDefinition[] = [
    { id: 'query', title: '查询', description: '', executable: 'adb', args: ['get-state'], category: 'inspect', risk: 'safe', timeoutMs: 1000, parameters: [], deviceModes: [] },
    { id: 'devices', title: '列表', description: '', executable: 'adb', args: ['devices'], category: 'inspect', risk: 'safe', timeoutMs: 1000, parameters: [], deviceModes: [] },
    { id: 'flash', title: '镜像', description: '', executable: 'fastboot', args: ['flash', 'boot', image], category: 'flash', risk: 'danger', timeoutMs: 1000, parameters: [], deviceModes: [] }
  ]
  const content = { getSnapshot: () => ({ commands: { commands: definitions } }) } as unknown as ContentService
  const settings = { get: () => state } as unknown as SettingsService
  const tools = { resolveBinary: vi.fn(async (name: string) => join(root, `mock-${name}`)), listAdbDevices: vi.fn(async (): Promise<ConnectedDevice[]> => [{ serial: 'A', state: 'device' }, { serial: 'B', state: 'device' }]), listFastbootDevices: vi.fn(async (): Promise<ConnectedDevice[]> => [{ serial: 'A', state: 'fastboot' }, { serial: 'B', state: 'fastboot' }]) }
  const service = new CommandService(content, settings, tools as unknown as PlatformToolsService)
  services.push(service)
  const confirmed = (input: CommandRequest): CommandRequest => {
    const preview = service.preview(input)
    expect(preview.allowed, preview.reason).toBe(true)
    return { ...input, previewToken: preview.token, confirmation: preview.confirmationWord }
  }
  return { service, state, image, definitions, tools, confirmed, content, settings }
}

beforeEach(() => {
  root = mkdtempSync('/Users/fanhaozhi/Desktop/root-desk/tests/.command-service-')
  children = []; services = []
  getPath.mockReturnValue(root); spawn.mockReset(); spawn.mockImplementation(() => child())
})
afterEach(() => {
  for (const service of services) service.dispose()
  for (const process of children) process.emit('close', null)
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

describe('command execution boundary (all processes mocked)', () => {
  it('无预览 token 不执行，包括只读命令', async () => {
    const { service } = fixture()
    await expect(service.execute({ commandId: 'query', serial: 'A' })).rejects.toThrow('token')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('多设备执行按 serial 注入 -s；以数组及 shell:false 执行', async () => {
    const { service, tools, confirmed } = fixture()
    const run = await service.execute(confirmed({ commandId: 'query', serial: 'B' }))
    expect(tools.listAdbDevices).toHaveBeenCalledOnce()
    expect(tools.listFastbootDevices).not.toHaveBeenCalled()
    expect(run.args).toEqual(['-s', 'B', 'get-state'])
    expect(spawn).toHaveBeenCalledWith(join(root, 'mock-adb'), ['-s', 'B', 'get-state'], expect.objectContaining({ shell: false, windowsHide: true }))
    children[0].emit('close', 0)
    expect(service.list()[0].status).toBe('completed')
  })

  it('精确 host 查询无需设备列表/serial', async () => {
    const { service, tools, confirmed } = fixture()
    const run = await service.execute(confirmed({ commandId: 'devices' }))
    expect(tools.listAdbDevices).not.toHaveBeenCalled(); expect(run.args).toEqual(['devices'])
  })

  it.each(['unauthorized', 'offline', 'fastboot', 'no permissions'])('拒绝同 serial 未授权/错模式状态 %s', async (state) => {
    const { service, tools, confirmed } = fixture()
    const input = confirmed({ commandId: 'query', serial: 'A' })
    tools.listAdbDevices.mockResolvedValue([{ serial: 'A', state }, { serial: 'B', state: 'device' }])
    await expect(service.execute(input)).rejects.toThrow(/未授权|模式/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('不能回退到另一在线设备；同 serial 重复也拒绝', async () => {
    const { service, tools, confirmed } = fixture()
    tools.listAdbDevices.mockResolvedValue([{ serial: 'B', state: 'device' }])
    await expect(service.execute(confirmed({ commandId: 'query', serial: 'A' }))).rejects.toThrow('serial')
    tools.listAdbDevices.mockResolvedValue([{ serial: 'A', state: 'device' }, { serial: 'A', state: 'device' }])
    await expect(service.execute(confirmed({ commandId: 'query', serial: 'A' }))).rejects.toThrow('不唯一')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('Fastboot 不接受仅出现在 ADB 列表中的目标', async () => {
    const { service, state, tools, confirmed } = fixture(); state.expertMode = true
    tools.listFastbootDevices.mockResolvedValue([{ serial: 'B', state: 'fastboot' }])
    await expect(service.execute(confirmed({ commandId: 'flash', serial: 'A' }))).rejects.toThrow('serial')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('token 一次性，重放和并发重放只 spawn 一次', async () => {
    const { service, confirmed } = fixture()
    const input = confirmed({ commandId: 'query', serial: 'A' })
    const first = service.execute(input)
    await expect(service.execute(input)).rejects.toThrow('已消费')
    const run = await first; children[0].emit('close', 0)
    await expect(service.execute(input)).rejects.toThrow('已消费')
    expect(spawn).toHaveBeenCalledOnce(); expect(run.status).toBe('running')
  })

  it.each([
    { commandId: 'devices' }, { serial: 'B' }, { parameters: { unexpected: 'x' } },
    { commandId: undefined, expert: { executable: 'adb' as const, args: ['reboot'] } }
  ])('预览后改参不能执行 %j', async (change) => {
    const { service, confirmed, state } = fixture(); state.expertMode = true
    const input = confirmed({ commandId: 'query', serial: 'A' })
    await expect(service.execute({ ...input, ...change })).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
    await expect(service.execute(input)).rejects.toThrow('已消费')
  })

  it('专家 argv 改参、目录内容更改、专家设置变化均失效', async () => {
    const { service, confirmed, state, definitions } = fixture(); state.expertMode = true
    const input = confirmed({ expert: { executable: 'fastboot', args: ['oem', 'query'] }, serial: 'A' })
    await expect(service.execute({ ...input, expert: { executable: 'fastboot', args: ['oem', 'reboot'] } })).rejects.toThrow('变化')
    const catalogInput = confirmed({ commandId: 'query', serial: 'A' }); definitions[0].timeoutMs = 2000
    await expect(service.execute(catalogInput)).rejects.toThrow('变化')
    const modeInput = confirmed({ commandId: 'query', serial: 'A' }); state.expertMode = false
    await expect(service.execute(modeInput)).rejects.toThrow('变化')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('token 短期过期；执行等待设备期间过期也拒绝', async () => {
    vi.useFakeTimers()
    const { service, confirmed, tools } = fixture()
    const expired = confirmed({ commandId: 'query', serial: 'A' })
    vi.advanceTimersByTime(60_001)
    await expect(service.execute(expired)).rejects.toThrow('过期')
    const waiting = confirmed({ commandId: 'query', serial: 'A' })
    tools.listAdbDevices.mockImplementation(async () => { vi.advanceTimersByTime(60_001); return [{ serial: 'A', state: 'device' }] })
    await expect(service.execute(waiting)).rejects.toThrow('过期')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('高风险必须启用专家并输入包含 serial 的确认词', async () => {
    const { service, state } = fixture()
    expect(service.preview({ commandId: 'flash', serial: 'A' }).allowed).toBe(false)
    state.expertMode = true
    const input = { commandId: 'flash', serial: 'A' }
    const preview = service.preview(input)
    expect(preview.confirmationWord).toBe(confirmationFor('A'))
    await expect(service.execute({ ...input, previewToken: preview.token, confirmation: confirmationFor('B') })).rejects.toThrow('确认词')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('执行前再检查授权；设备列表等待期间禁用专家不可执行', async () => {
    const { service, state, confirmed, tools } = fixture(); state.expertMode = true
    const input = confirmed({ commandId: 'flash', serial: 'A' })
    tools.listFastbootDevices.mockImplementation(async () => { state.expertMode = false; return [{ serial: 'A', state: 'fastboot' }] })
    await expect(service.execute(input)).rejects.toThrow('专家')
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['modify', 'delete', 'replace'])('预览后文件 %s 失效', async (action) => {
    const { service, state, image, confirmed } = fixture(); state.expertMode = true
    const input = confirmed({ commandId: 'flash', serial: 'A' })
    if (action === 'modify') writeFileSync(image, 'changed mock')
    else { unlinkSync(image); if (action === 'replace') writeFileSync(image, 'mock original') }
    await expect(service.execute(input)).rejects.toThrow(/文件/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('文件在设备核验等待期间被替换也不能执行；symlink 变更不能绕过 hash', async () => {
    const { service, state, image, confirmed, tools, definitions } = fixture(); state.expertMode = true
    const target = join(root, 'second.img'); writeFileSync(target, 'mock original')
    const link = join(root, 'link.img'); symlinkSync(image, link); definitions[2].args[2] = link
    const input = confirmed({ commandId: 'flash', serial: 'A' })
    tools.listFastbootDevices.mockImplementation(async () => { unlinkSync(link); symlinkSync(target, link); return [{ serial: 'A', state: 'fastboot' }] })
    await expect(service.execute(input)).rejects.toThrow('文件')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('bootloader / fastbootd 通过同 serial 的只读 getvar 精确核验', async () => {
    const { service, state, definitions, confirmed } = fixture(); state.expertMode = true; definitions[2].deviceModes = ['bootloader']
    spawn.mockImplementation((_binary, args: string[]) => {
      const process = child()
      if (args.includes('getvar')) queueMicrotask(() => { process.stderr.write('is-userspace: yes\n'); process.emit('close', 0) })
      return process
    })
    await expect(service.execute(confirmed({ commandId: 'flash', serial: 'B' }))).rejects.toThrow('deviceModes')
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0][1]).toEqual(['-s', 'B', 'getvar', 'is-userspace'])
    definitions[2].deviceModes = ['fastbootd']
    const run = await service.execute(confirmed({ commandId: 'flash', serial: 'B' }))
    expect(run.status).toBe('running'); expect(spawn.mock.calls[2][1]).toEqual(['-s', 'B', 'flash', 'boot', definitions[2].args[2]])
  })

  it('Android/recovery 模式按 ro.bootmode 核验，不能将 recovery 当 android', async () => {
    const { service, definitions, confirmed } = fixture(); definitions[0].deviceModes = ['android']
    spawn.mockImplementation(() => {
      const process = child(); queueMicrotask(() => { process.stdout.write('recovery\n'); process.emit('close', 0) }); return process
    })
    await expect(service.execute(confirmed({ commandId: 'query', serial: 'A' }))).rejects.toThrow('deviceModes')
    expect(spawn).toHaveBeenCalledOnce()
    expect(spawn.mock.calls[0][1]).toEqual(['-s', 'A', 'shell', 'getprop', 'ro.bootmode'])
  })

  it('全局同 serial 锁覆盖多个 service、ADB / Fastboot；不同设备可并行', async () => {
    const { service, state, confirmed, content, settings, tools } = fixture(); state.expertMode = true
    const second = new CommandService(content, settings, tools as unknown as PlatformToolsService); services.push(second)
    const first = await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    const p = second.preview({ commandId: 'flash', serial: 'A' })
    await expect(second.execute({ commandId: 'flash', serial: 'A', previewToken: p.token, confirmation: p.confirmationWord })).rejects.toThrow('已有命令')
    const parallel = await service.execute(confirmed({ commandId: 'query', serial: 'B' }))
    expect(parallel.status).toBe('running'); expect(spawn).toHaveBeenCalledTimes(2)
    service.cancel(first.id)
    await expect(service.execute(confirmed({ commandId: 'query', serial: 'A' }))).rejects.toThrow('已有命令')
    children[0].emit('close', null)
    await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('取消可控、升级 SIGKILL；只有 close 后才释放锁', async () => {
    vi.useFakeTimers()
    const { service, confirmed } = fixture()
    const run = await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    expect(service.cancel(run.id)).toBe(true); expect(service.cancel(run.id)).toBe(false)
    expect(children[0].kill).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1000)
    expect(children[0].kill).toHaveBeenLastCalledWith('SIGKILL')
    children[0].emit('close', 0)
    expect(service.list()[0].status).toBe('cancelled')
  })

  it('超时标记失败并 kill；close 0 不能将超时标记成功', async () => {
    vi.useFakeTimers()
    const { service, confirmed } = fixture()
    const run = await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    vi.advanceTimersByTime(1000)
    expect(children[0].kill).toHaveBeenCalledOnce(); children[0].emit('close', 0)
    const saved = service.list().find((item) => item.id === run.id)!
    expect(saved.status).toBe('failed'); expect(saved.error).toContain('超过')
  })

  it('输出按字节限额、非零退出保留；日志无原参数/输出/确认词，重启可见脱敏历史', async () => {
    const { service, confirmed, content, settings, tools } = fixture()
    const run = await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    children[0].stdout.write('敏'.repeat(900_000)); children[0].stdout.write('tail-marker')
    children[0].stderr.write('private stderr'); children[0].emit('close', 1)
    const saved = service.list().find((item) => item.id === run.id)!
    expect(Buffer.byteLength(saved.stdout)).toBeLessThanOrEqual(1024 * 1024 + 3)
    expect(saved.stdout).toContain('tail-marker'); expect(saved.status).toBe('failed')
    const audit = readFileSync(join(root, 'audit', `${run.id}.json`), 'utf8')
    expect(audit).not.toContain('get-state'); expect(audit).not.toContain('private stderr'); expect(audit).not.toContain('tail-marker'); expect(audit).not.toContain(confirmationFor('A'))
    const restored = new CommandService(content, settings, tools as unknown as PlatformToolsService); services.push(restored)
    expect(restored.list()[0].status).toBe('failed'); expect(restored.list()[0].args).toEqual(['[历史参数已脱敏]'])
    expect(readdirSync(join(root, 'audit'))).toHaveLength(1)
  })

  it('spawn error 释放锁，失败写审计；审计不可写时不得 spawn', async () => {
    const { service, confirmed } = fixture()
    const run = await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    children[0].emit('error', new Error('sensitive error'))
    expect(service.list()[0].status).toBe('failed'); expect(service.list()[0].error).not.toContain('sensitive')
    await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    children[1].emit('close', 0)
    rmSync(join(root, 'audit'), { recursive: true }); writeFileSync(join(root, 'audit'), 'not directory')
    await expect(service.execute(confirmed({ commandId: 'query', serial: 'A' }))).rejects.toThrow()
    expect(spawn).toHaveBeenCalledTimes(2); expect(service.cancel(run.id)).toBe(false)
  })

  it('spawn 清除 ANDROID_SERIAL / 远程 ADB server 环境 selector', async () => {
    const previous = { ...process.env }
    Object.assign(process.env, { ANDROID_SERIAL: 'OTHER', ADB_SERVER_SOCKET: 'tcp:remote:5037', ANDROID_ADB_SERVER_ADDRESS: 'remote', ANDROID_ADB_SERVER_PORT: '5555' })
    try {
      const { service, confirmed } = fixture()
      await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
      const env = spawn.mock.calls[0][2].env as NodeJS.ProcessEnv
      for (const name of ['ANDROID_SERIAL', 'ADB_SERVER_SOCKET', 'ANDROID_ADB_SERVER_ADDRESS', 'ANDROID_ADB_SERVER_PORT']) expect(env[name]).toBeUndefined()
    } finally { process.env = previous }
  })

  it('模式核验超时后升级终止，并在 probe close 前保持设备锁', async () => {
    vi.useFakeTimers()
    const { service, definitions, confirmed } = fixture(); definitions[0].deviceModes = ['android']
    const pending = service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    const rejected = expect(pending).rejects.toThrow('超时')
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    vi.advanceTimersByTime(11_000)
    expect(children[0].kill).toHaveBeenLastCalledWith('SIGKILL')
    await expect(service.execute(confirmed({ commandId: 'query', serial: 'A' }))).rejects.toThrow('已有命令')
    children[0].emit('close', null); await rejected
    definitions[0].deviceModes = []
    expect((await service.execute(confirmed({ commandId: 'query', serial: 'A' }))).args).toEqual(['-s', 'A', 'get-state'])
  })

  it('dispose 撤销 token 并取消运行，之后不接受执行', async () => {
    const { service, confirmed } = fixture()
    const run = await service.execute(confirmed({ commandId: 'query', serial: 'A' }))
    const unused = confirmed({ commandId: 'query', serial: 'B' }); service.dispose()
    expect(service.list().find((item) => item.id === run.id)?.status).toBe('cancelled')
    await expect(service.execute(unused)).rejects.toThrow('已停止')
    expect(service.preview({ commandId: 'devices' }).allowed).toBe(false)
  })
})
