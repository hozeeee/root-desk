import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApkService } from '@main/services/apk-service'
import { CommandService } from '@main/services/command-service'
import { confirmationFor } from '@main/security/command-policy'
import type { ContentService } from '@main/services/content-service'
import type { SettingsService } from '@main/services/settings-service'
import type { PlatformToolsService } from '@main/services/platform-tools-service'
import type { ApkInstallRequest, ConnectedDevice } from '@shared/contracts'

const { spawn, getPath, showOpenDialog } = vi.hoisted(() => ({ spawn: vi.fn(), getPath: vi.fn(), showOpenDialog: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('electron', () => ({ app: { getPath }, dialog: { showOpenDialog } }))
let root: string
let children: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> })[]
let commands: CommandService

function fixture() {
  const filePath = join(root, 'application.apk'); writeFileSync(filePath, 'mock APK')
  const state = { expertMode: false }
  const content = { getSnapshot: () => ({ commands: null }) } as unknown as ContentService
  const settings = { get: () => state } as unknown as SettingsService
  const tools = { resolveBinary: vi.fn(async () => join(root, 'mock-adb')), listAdbDevices: vi.fn(async (): Promise<ConnectedDevice[]> => [{ serial: 'A', state: 'device' }, { serial: 'B', state: 'device' }]), listFastbootDevices: vi.fn(async () => []) }
  commands = new CommandService(content, settings, tools as unknown as PlatformToolsService)
  const apk = new ApkService(commands)
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [filePath] })
  const input: ApkInstallRequest = { filePath, serial: 'B', replace: true, confirmation: confirmationFor('B') }
  return { apk, filePath, state, tools, input }
}
beforeEach(() => {
  root = mkdtempSync('/Users/fanhaozhi/Desktop/root-desk/tests/.command-apk-'); children = []
  getPath.mockReturnValue(root); showOpenDialog.mockReset(); spawn.mockReset()
  spawn.mockImplementation(() => {
    const process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) })
    children.push(process); return process
  })
})
afterEach(() => {
  commands?.dispose(); for (const process of children) process.emit('close', null)
  rmSync(root, { recursive: true, force: true })
})

describe('APK native-dialog permission and explicit installation', () => {
  it('choose 仅返回详情，绝不安装；取消不授予许可', async () => {
    const { apk, filePath } = fixture()
    expect(await apk.choose()).toEqual({ canceled: false, filePath, fileName: 'application.apk', size: 8 })
    expect(spawn).not.toHaveBeenCalled()
    showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await apk.choose()).toEqual({ canceled: true })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('手写路径未通过 app 自己文件选择器不获许可', async () => {
    const { apk, input } = fixture()
    await expect(apk.install(input)).rejects.toThrow('文件选择器')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('强制 serial 及匹配目标的确认词，普通安装仍须确认', async () => {
    const { apk, input } = fixture(); await apk.choose()
    for (const changed of [{ serial: '' }, { confirmation: undefined }, { confirmation: confirmationFor('A') }]) await expect(apk.install({ ...input, ...changed })).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
    const run = await apk.install(input)
    expect(run.args).toEqual(['-s', 'B', 'install', '-r', input.filePath])
    expect(spawn).toHaveBeenCalledOnce()
    children[0].emit('close', 0)
    await expect(apk.install(input)).rejects.toThrow('文件选择器')
  })

  it.each(['allowDowngrade', 'grantPermissions'] as const)('%s 只有专家模式并确认才能安装', async (flag) => {
    const { apk, input, state } = fixture(); await apk.choose()
    await expect(apk.install({ ...input, [flag]: true })).rejects.toThrow('专家')
    state.expertMode = true
    await expect(apk.install({ ...input, [flag]: true, confirmation: undefined })).rejects.toThrow('确认词')
    expect(spawn).not.toHaveBeenCalled()
    const run = await apk.install({ ...input, [flag]: true })
    expect(run.args).toContain(flag === 'allowDowngrade' ? '-d' : '-g')
  })

  it('设备离线/未授权或只有 fastboot 都不能安装', async () => {
    const { apk, input, tools } = fixture(); await apk.choose()
    tools.listAdbDevices.mockResolvedValue([{ serial: 'B', state: 'unauthorized' }])
    await expect(apk.install(input)).rejects.toThrow('未授权')
    tools.listAdbDevices.mockResolvedValue([{ serial: 'B', state: 'fastboot' }])
    await expect(apk.install(input)).rejects.toThrow('ADB')
    tools.listAdbDevices.mockResolvedValue([{ serial: 'A', state: 'device' }])
    await expect(apk.install(input)).rejects.toThrow('serial')
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each(['modified', 'deleted', 'directory', 'symlink'])('选择后文件 %s 必须重新选择', async (change) => {
    const { apk, input } = fixture(); await apk.choose()
    if (change === 'modified') writeFileSync(input.filePath, 'changed APK')
    else {
      unlinkSync(input.filePath)
      if (change === 'directory') mkdirSync(input.filePath)
      if (change === 'symlink') { const other = join(root, 'other.apk'); writeFileSync(other, 'mock APK'); symlinkSync(other, input.filePath) }
    }
    await expect(apk.install(input)).rejects.toThrow(/文件/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('对话框返回目录/相对路径/非 APK 时拒绝真实 stat', async () => {
    const { apk } = fixture()
    const directory = join(root, 'directory.apk'); mkdirSync(directory)
    for (const file of [directory, 'relative.apk', join(root, 'image.img'), join(root, 'missing.apk')]) {
      showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] })
      await expect(apk.choose()).rejects.toThrow()
    }
    expect(spawn).not.toHaveBeenCalled()
  })

  it('等待设备期间 APK hash 或专家授权变化同样阻止安装', async () => {
    const { apk, input, tools, state } = fixture(); state.expertMode = true; await apk.choose()
    tools.listAdbDevices.mockImplementation(async () => { state.expertMode = false; return [{ serial: 'B', state: 'device' }] })
    await expect(apk.install({ ...input, grantPermissions: true })).rejects.toThrow('专家')
    tools.listAdbDevices.mockImplementation(async () => { writeFileSync(input.filePath, 'replaced during detection'); return [{ serial: 'B', state: 'device' }] })
    await expect(apk.install(input)).rejects.toThrow('文件')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('APK 与目录命令共用同设备全局锁', async () => {
    const { apk, input, state } = fixture(); state.expertMode = true; await apk.choose()
    const request = { expert: { executable: 'adb' as const, args: ['get-state'] }, serial: 'B' }
    const preview = commands.preview(request)
    const query = await commands.execute({ ...request, previewToken: preview.token })
    await expect(apk.install(input)).rejects.toThrow('已有命令')
    commands.cancel(query.id); children[0].emit('close', null)
    expect((await apk.install(input)).status).toBe('running')
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
