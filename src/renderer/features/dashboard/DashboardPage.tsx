import { ArrowRight, BookOpen, Boxes, CheckCircle2, Download, Smartphone, TerminalSquare, TriangleAlert } from 'lucide-react'
import type { PageId } from '../../app/navigation'
import { useApp } from '../../app/AppContext'
import { PageHeader } from '../../components/PageHeader'
import { Badge, Notice } from '../../components/Ui'

export function DashboardPage({ onNavigate }: { onNavigate: (page: PageId) => void }): JSX.Element {
  const { content, reloadContent } = useApp()
  const brands = content?.catalog?.brands.length ?? 0
  const devices = content?.catalog?.brands.reduce((sum, brand) => sum + brand.devices.length, 0) ?? 0
  const tools = content?.tools?.tools.length ?? 0
  const commands = content?.commands?.commands.length ?? 0
  return <div className="page-stack">
    <PageHeader eyebrow="ROOTDESK WORKSPACE" title="你的 Android 知识库与工具台" description="从设备研究到安全执行，把分散的刷机流程收进一个可信、可追溯的桌面工作区。" actions={<button className="button secondary" onClick={() => void reloadContent()}>重新载入内容</button>}/>
    {Boolean(content?.issues.length) && <Notice>{content!.issues.map((issue) => issue.message).join('；')}。资料文件就绪后可直接重新载入，无需重新构建。</Notice>}
    <section className="hero-panel">
      <div><Badge tone="accent"><CheckCircle2 size={13}/> 安全策略已启用</Badge><h2>先理解设备，再执行命令。</h2><p>RootDesk 将指南、依赖、命令预览、下载校验和连接状态组织在同一个工作流中。</p><button className="button primary" onClick={() => onNavigate('guides')}>打开设备指南 <ArrowRight size={17}/></button></div>
      <div className="hero-orbit"><div className="orbit-ring"/><div className="phone-glyph"><Smartphone size={54}/><span>ADB</span></div><i className="orbit-dot dot-one"/><i className="orbit-dot dot-two"/></div>
    </section>
    <section className="metric-grid">
      <Metric icon={BookOpen} label="品牌资料" value={brands} meta={`${devices} 台设备`}/>
      <Metric icon={Boxes} label="可信工具" value={tools} meta="跨平台索引"/>
      <Metric icon={TerminalSquare} label="命令模板" value={commands} meta="执行前预览"/>
      <Metric icon={Download} label="内容版本" value={content?.catalog?.version ?? '—'} meta="本地内容源"/>
    </section>
    <section className="dashboard-grid">
      <div className="panel quick-panel"><div className="panel-heading"><div><span className="eyebrow">QUICK START</span><h3>继续你的工作</h3></div></div>
        {[['guides', BookOpen, '查阅设备解锁与 Root 指南', '按品牌、代号与 Android 版本筛选'], ['adb', TerminalSquare, '连接 Android 设备', '检测 adb / fastboot 与授权状态'], ['downloads', Download, '管理工具下载', 'HTTPS 下载与 SHA-256 校验']].map(([id, Icon, title, subtitle]) => <button className="quick-row" key={String(id)} onClick={() => onNavigate(id as PageId)}><span className="quick-icon"><Icon size={19}/></span><span><strong>{String(title)}</strong><small>{String(subtitle)}</small></span><ArrowRight size={17}/></button>)}
      </div>
      <div className="panel health-panel"><div className="panel-heading"><div><span className="eyebrow">SYSTEM HEALTH</span><h3>安全概览</h3></div></div>
        <Health label="渲染器隔离" value="已启用" ok/><Health label="命令执行" value="参数化 spawn" ok/><Health label="远程内容" value="仅校验，不执行" ok/><Health label="内容状态" value={content?.issues.length ? '等待资料' : '通过校验'} ok={!content?.issues.length}/>
        <div className="health-note"><TriangleAlert size={16}/> 风险命令始终要求输入确认词。</div>
      </div>
    </section>
  </div>
}

function Metric({ icon: Icon, label, value, meta }: { icon: typeof BookOpen; label: string; value: string | number; meta: string }): JSX.Element { return <div className="metric-card"><span className="metric-icon"><Icon size={20}/></span><div><span>{label}</span><strong>{value}</strong><small>{meta}</small></div></div> }
function Health({ label, value, ok }: { label: string; value: string; ok: boolean }): JSX.Element { return <div className="health-row"><span><i className={`status-dot ${ok ? '' : 'warning'}`}/>{label}</span><strong>{value}</strong></div> }
