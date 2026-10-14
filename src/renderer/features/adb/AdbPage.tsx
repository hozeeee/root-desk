import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileUp, Play, RefreshCw, Smartphone, Square, TerminalSquare, XCircle } from 'lucide-react'
import type { ApkSelection, BinaryStatus, CommandPreview, CommandRequest, CommandRun, ConnectedDevice } from '@shared/contracts'
import { useApp } from '../../app/AppContext'
import { PageHeader } from '../../components/PageHeader'
import { Badge, EmptyState, Notice, Spinner } from '../../components/Ui'

export function AdbPage({ initialCommandId = '' }: { initialCommandId?: string }): JSX.Element {
  const { content, settings } = useApp()
  const [binaries, setBinaries] = useState<BinaryStatus[]>([])
  const [devices, setDevices] = useState<ConnectedDevice[]>([])
  const [mode, setMode] = useState<'adb' | 'fastboot'>('adb')
  const [serial, setSerial] = useState('')
  const [selected, setSelected] = useState(initialCommandId)
  const [parameters, setParameters] = useState<Record<string, string>>({})
  const [expert, setExpert] = useState('adb devices -l')
  const [preview, setPreview] = useState<CommandPreview | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const [run, setRun] = useState<CommandRun | null>(null)
  const [history, setHistory] = useState<CommandRun[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [apk, setApk] = useState<ApkSelection | null>(null)
  const [replace, setReplace] = useState(true)
  const [downgrade, setDowngrade] = useState(false)
  const [grantPermissions, setGrantPermissions] = useState(false)
  const [apkConfirmation, setApkConfirmation] = useState('')
  const revision = useRef(0)
  const refreshRevision = useRef(0)
  const modeRef = useRef(mode)
  const commands = content?.commands?.commands ?? []
  const definition = commands.find((command) => command.id === selected)
  const request = useMemo<CommandRequest | null>(() => selected
    ? { commandId: selected, parameters, serial: serial || undefined }
    : settings?.expertMode ? expertRequest(expert, serial) : null, [selected, parameters, serial, expert, settings?.expertMode])

  const executeBlocker = busy ? '正在处理…'
    : !request ? (settings?.expertMode ? '请选择目录命令，或输入以 adb / fastboot 开头的专家命令。' : '请先选择目录命令。')
    : !preview ? '先点击“预览策略”获取一次性执行许可（60 秒内有效）。'
    : !preview.allowed ? '策略未通过，请按提示调整后重新预览。'
    : !preview.token ? '未获得执行许可，请重新预览。'
    : preview.requiresConfirmation && confirmation !== preview.confirmationWord ? '请在下方输入确认词后执行。'
    : ''

  const invalidate = (): void => { revision.current++; setPreview(null); setConfirmation('') }
  const changeSerial = (value: string): void => { invalidate(); setSerial(value); setApkConfirmation('') }
  const changeMode = (value: 'adb' | 'fastboot'): void => {
    if (value === mode) return
    modeRef.current = value; refreshRevision.current++
    invalidate(); setMode(value); setDevices([]); setSerial(''); setSelected(''); setParameters({})
    setExpert(`${value} devices`); setApk(null); setApkConfirmation('')
  }
  const refresh = async (): Promise<void> => {
    const requestedMode = modeRef.current
    const generation = ++refreshRevision.current
    setBusy(true); setMessage(null)
    try {
      const [nextBinaries, nextDevices] = await Promise.all([window.rootDesk.detectPlatformTools(), requestedMode === 'adb' ? window.rootDesk.listAdbDevices() : window.rootDesk.listFastbootDevices()])
      if (generation !== refreshRevision.current || requestedMode !== modeRef.current) return
      setBinaries(nextBinaries); setDevices(nextDevices)
      // Refresh is also a boundary: do not retain a confirmation for changed device state.
      invalidate(); setApkConfirmation('')
      setSerial((current) => nextDevices.some((device) => device.serial === current && isOnline(device, requestedMode)) ? current : '')
    } catch (error) { if (generation === refreshRevision.current) setMessage(errorMessage(error)) }
    finally { if (generation === refreshRevision.current) setBusy(false) }
  }
  const loadHistory = async (): Promise<void> => {
    try {
      const runs = await window.rootDesk.listCommandRuns()
      setHistory(runs)
      setRun((current) => current ? runs.find((item) => item.id === current.id) ?? current : null)
    } catch (error) { setMessage(errorMessage(error)) }
  }
  useEffect(() => { void refresh(); void loadHistory() }, [mode])
  useEffect(() => {
    invalidate(); setApkConfirmation('')
    if (!settings?.expertMode) { setDowngrade(false); setGrantPermissions(false) }
  }, [settings?.expertMode, content?.commands])
  useEffect(() => {
    if (!preview?.token) return
    const timer = window.setTimeout(() => { invalidate(); setMessage('执行许可已超过 60 秒失效，请重新预览。') }, 58_000)
    return () => window.clearTimeout(timer)
  }, [preview])
  useEffect(() => {
    if (!history.some((item) => item.status === 'running')) return
    const timer = window.setInterval(() => void loadHistory(), 700)
    return () => window.clearInterval(timer)
  }, [history])

  const showPreview = async (): Promise<void> => {
    invalidate(); setMessage(null)
    if (!request) return
    const generation = revision.current
    try {
      const result = await window.rootDesk.previewCommand(request)
      if (generation === revision.current) setPreview(result)
    } catch (error) { if (generation === revision.current) setMessage(errorMessage(error)) }
  }
  const execute = async (): Promise<void> => {
    if (!request || !preview?.allowed || !preview.token) return
    const input = { ...request, confirmation, previewToken: preview.token }
    invalidate(); setBusy(true); setMessage(null)
    try { setRun(await window.rootDesk.executeCommand(input)); await loadHistory() }
    catch (error) { setMessage(errorMessage(error)) } finally { setBusy(false) }
  }
  const chooseApk = async (): Promise<void> => {
    setMessage(null); setApkConfirmation('')
    try {
      const chosen = await window.rootDesk.chooseApk()
      setApk(chosen.canceled ? null : chosen)
      // Deliberately no install here: selecting a file never executes a command.
    } catch (error) { setMessage(errorMessage(error)) }
  }
  const installApk = async (): Promise<void> => {
    if (!apk?.filePath || !serial || mode !== 'adb') return
    setBusy(true); setMessage(null)
    const input = { filePath: apk.filePath, serial, replace, allowDowngrade: downgrade, grantPermissions, confirmation: apkConfirmation }
    setApkConfirmation('')
    try { setRun(await window.rootDesk.installApk(input)); setApk(null); await loadHistory() }
    catch (error) { setMessage(errorMessage(error)) } finally { setBusy(false) }
  }

  return <div className="page-stack">
    <PageHeader eyebrow="DEVICE CONSOLE" title="ADB 工具箱" description="选择目标设备、填写模板，预览并确认后才会执行。预览许可仅有效 60 秒且只能使用一次。" actions={<button className="button secondary" disabled={busy} onClick={() => void refresh()}>{busy ? <Spinner/> : <RefreshCw size={16}/>} 刷新连接</button>}/>
    {message && <Notice danger>{message}</Notice>}
    <section className="binary-strip panel">{(['adb', 'fastboot'] as const).map((name) => {
      const status = binaries.find((item) => item.name === name)
      return <div key={name}><span className={`binary-icon ${status?.available ? 'ok' : ''}`}><TerminalSquare size={18}/></span><div><strong>{name}</strong><small>{status?.available ? status.version : status?.error ?? '正在检测…'}</small></div>{status?.available ? <CheckCircle2 className="success-text" size={18}/> : <XCircle className="danger-text" size={18}/>}</div>
    })}<button className="button ghost" disabled={busy || mode !== 'adb'} onClick={() => void chooseApk()}><FileUp size={16}/> 选择 APK</button></section>
    <div className="console-grid">
      <section className="panel device-console"><div className="panel-heading"><div><span className="eyebrow">CONNECTED DEVICES</span><h3>连接设备</h3></div><div className="segmented"><button className={mode === 'adb' ? 'active' : ''} onClick={() => changeMode('adb')}>ADB</button><button className={mode === 'fastboot' ? 'active' : ''} onClick={() => changeMode('fastboot')}>Fastboot</button></div></div>
        {!devices.length ? <EmptyState title="暂无设备" description="连接 USB、启用调试并点击“刷新连接”。"/> : <div className="connected-list">{devices.map((device) => <div key={device.serial}><span className="device-avatar"><Smartphone size={20}/></span><div><strong>{device.model ?? device.product ?? device.serial}</strong><small>{device.serial}</small></div><Badge tone={isOnline(device, mode) ? 'success' : 'warning'}>{device.state}</Badge><button className="button secondary" aria-pressed={serial === device.serial} disabled={busy || !isOnline(device, mode)} onClick={() => changeSerial(device.serial)}>{serial === device.serial ? '已选择' : '选择'}</button></div>)}</div>}
        <p>目标序列号：<code>{serial || '未选择（仅设备列表 / 版本 / 帮助无需目标）'}</code></p>
      </section>
      <section className="panel command-console"><div className="panel-heading"><div><span className="eyebrow">SAFE COMMAND RUNNER</span><h3>命令执行器</h3></div><Badge tone={settings?.expertMode ? 'warning' : 'success'}>{settings?.expertMode ? '专家模式' : '白名单模式'}</Badge></div>
        {commands.length > 0 && <label className="field"><span>目录命令</span><select value={selected} onChange={(event) => { invalidate(); setSelected(event.target.value); setParameters({}) }}><option value="">选择命令…</option>{commands.map((command) => <option key={command.id} value={command.id} disabled={!settings?.expertMode && (command.expertOnly || command.risk === 'danger')}>{command.title} · {command.executable}</option>)}</select></label>}
        {definition && <><small>{definition.description} · 允许模式：{definition.deviceModes?.join(' / ') || definition.executable}</small>{(definition.parameters ?? []).map((parameter) => <label className="field" key={parameter.name}><span>{parameter.name}{parameter.required ? '（必填）' : '（可选）'} · {parameter.description}</span>{parameter.type === 'enum'
          ? <select value={parameters[parameter.name] ?? ''} onChange={(event) => { invalidate(); setParameters((current) => ({ ...current, [parameter.name]: event.target.value })) }}><option value="">请选择…</option>{parameter.allowedValues?.map((value) => <option key={value} value={value}>{value}</option>)}</select>
          : <input value={parameters[parameter.name] ?? ''} placeholder={parameter.type === 'file' ? '可读普通文件的本机绝对路径' : '参数值'} onChange={(event) => { invalidate(); setParameters((current) => ({ ...current, [parameter.name]: event.target.value })) }}/>}</label>)}</>}
        {settings?.expertMode && (selected
          ? <small className="section-help">已选择目录命令，专家命令输入已停用；将“目录命令”改回“选择命令…”即可手动输入。</small>
          : <label className="field"><span>专家命令（仅 adb / fastboot）</span><input value={expert} onChange={(event) => { invalidate(); setExpert(event.target.value) }}/><small>无需手写 -s；系统注入目标。仅精确只读 shell 查询可用；未知命令仍需确认。</small></label>)}
        {!commands.length && !settings?.expertMode && <Notice>命令目录尚未载入。普通模式不会执行目录外命令。</Notice>}
        <div className="command-actions"><span className="command-hint">{executeBlocker}</span><button className="button secondary" disabled={!request || busy} onClick={() => void showPreview()}>{preview ? '重新预览' : '1. 预览策略'}</button><button className="button primary" disabled={Boolean(executeBlocker)} onClick={() => void execute()}><Play size={15}/> 2. 执行</button></div>
        {preview && <div className={`preview-box ${preview.allowed ? '' : 'denied'}`}><code>{preview.allowed ? preview.display : preview.reason}</code>{preview.requiresConfirmation && preview.allowed && <label className="field"><span>核对目标后输入确认词：{preview.confirmationWord}</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label>}</div>}
      </section>
    </div>
    {apk?.filePath && <section className="panel command-console"><div className="panel-heading"><h3>确认 APK 安装</h3><button className="button ghost" onClick={() => { setApk(null); setApkConfirmation('') }}>关闭</button></div><p>{apk.fileName} · {((apk.size ?? 0) / 1024 / 1024).toFixed(2)} MB</p><code>{apk.filePath}</code><p>目标：{serial || '请先选择已授权 ADB 设备'}</p>
      <label className="field"><span><input type="checkbox" checked={replace} onChange={(event) => { setReplace(event.target.checked); setApkConfirmation('') }}/> 替换现有应用</span></label>
      {settings?.expertMode && <><label className="field"><span><input type="checkbox" checked={downgrade} onChange={(event) => { setDowngrade(event.target.checked); setApkConfirmation('') }}/> 允许降级（专家风险选项）</span></label><label className="field"><span><input type="checkbox" checked={grantPermissions} onChange={(event) => { setGrantPermissions(event.target.checked); setApkConfirmation('') }}/> 授予运行时权限（专家风险选项）</span></label></>}
      <label className="field"><span>安装会修改设备。请输入：我已了解风险 {serial || 'SERIAL'}</span><input value={apkConfirmation} onChange={(event) => setApkConfirmation(event.target.value)}/></label><button className="button primary" disabled={busy || !serial || mode !== 'adb' || apkConfirmation !== `我已了解风险 ${serial}`} onClick={() => void installApk()}><Play size={15}/> 确认安装</button>
    </section>}
    {run && <section className="panel output-panel"><div className="panel-heading"><div><span className="eyebrow">COMMAND OUTPUT</span><h3>{run.executable} {run.args.join(' ')}</h3></div><div className="run-status"><Badge tone={run.status === 'completed' ? 'success' : run.status === 'running' ? 'accent' : 'danger'}>{statusLabel(run.status)}</Badge>{run.status === 'running' && <button className="button danger" onClick={() => void window.rootDesk.cancelCommand(run.id).then(loadHistory).catch((error) => setMessage(errorMessage(error)))}><Square size={14}/> 取消</button>}</div></div><pre>{[run.stdout, run.stderr, run.error].filter(Boolean).join('\n') || '无输出（历史仅持久化脱敏审计信息）'}</pre></section>}
    <section className="panel command-console"><div className="panel-heading"><h3>执行历史</h3><small>审计保存在 userData/audit；不保存原参数或输出。</small></div>{history.length ? history.map((item) => <button className="button ghost" key={item.id} onClick={() => setRun(item)}>{new Date(item.startedAt).toLocaleString()} · {item.executable} · {statusLabel(item.status)}</button>) : <p>暂无执行历史</p>}</section>
  </div>
}

function expertRequest(value: string, serial: string): CommandRequest | null {
  // A tokenizer only, never a shell. Reject unmatched quotes rather than repairing input.
  const parts: string[] = []
  let token = ''; let quoted = false; let started = false
  for (const character of value.trim()) {
    if (character === '"') { quoted = !quoted; started = true }
    else if (/\s/.test(character) && !quoted) { if (started) { parts.push(token); token = ''; started = false } }
    else { token += character; started = true }
  }
  if (quoted) return null
  if (started) parts.push(token)
  const executable = parts.shift()
  return executable === 'adb' || executable === 'fastboot' ? { expert: { executable, args: parts }, serial: serial || undefined } : null
}
function isOnline(device: ConnectedDevice, mode: 'adb' | 'fastboot'): boolean { return (mode === 'adb' ? ['device', 'recovery', 'sideload'] : ['fastboot', 'bootloader', 'fastbootd']).includes(device.state) }
function statusLabel(status: CommandRun['status']): string { return { running: '运行中', completed: '已完成', failed: '失败', cancelled: '已取消' }[status] }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
