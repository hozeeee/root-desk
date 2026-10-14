import { useEffect, useRef, useState } from 'react'
import { Menu, Search, ShieldCheck, X } from 'lucide-react'
import type { SearchResult } from '@shared/contracts'
import { navigation, type PageId } from './navigation'
import { useApp } from './AppContext'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { GuidesPage } from '../features/guides/GuidesPage'
import { ToolsPage } from '../features/tools/ToolsPage'
import { AdbPage } from '../features/adb/AdbPage'
import { DownloadsPage } from '../features/downloads/DownloadsPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { Spinner } from '../components/Ui'

export function AppShell(): JSX.Element {
  const { loading, error, content, appInfo } = useApp()
  const [page, setPage] = useState<PageId>('dashboard')
  const [sidebar, setSidebar] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [focus, setFocus] = useState<SearchResult | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const searchSequence = useRef(0)
  useEffect(() => {
    const shortcut = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus() }
      if (event.key === 'Escape') { setQuery(''); setResults([]); searchSequence.current++ }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  const search = async (value: string): Promise<void> => {
    setQuery(value)
    const sequence = ++searchSequence.current
    try {
      const next = value.trim() ? await window.rootDesk.searchContent(value) : []
      if (sequence === searchSequence.current) setResults(next)
    } catch { if (sequence === searchSequence.current) setResults([]) }
  }
  const navigate = (next: PageId): void => { setPage(next); setSidebar(false); setQuery(''); setResults([]); setFocus(null); searchSequence.current++ }
  const openResult = (result: SearchResult): void => {
    navigate(result.kind === 'tool' ? 'tools' : result.kind === 'command' ? 'adb' : 'guides')
    setFocus(result)
  }

  if (loading) return <div className="app-loading"><div className="brand-mark">R</div><Spinner/><span>正在准备安全工作区…</span></div>
  if (error) return <div className="app-loading error-screen"><strong>RootDesk 无法启动</strong><span>{error}</span></div>

  return <div className="app-shell">
    <aside className={`sidebar ${sidebar ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><div className="brand-mark">R</div><div><strong>RootDesk</strong><span>Android 工作台</span></div><button className="icon-button sidebar-close" onClick={() => setSidebar(false)}><X size={18}/></button></div>
      <nav>{navigation.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><item.icon size={19}/><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}</nav>
      <div className="sidebar-trust"><ShieldCheck size={18}/><div><strong>本地优先</strong><span>命令经过白名单策略</span></div></div>
      <div className="sidebar-version">RootDesk {appInfo?.version ?? '0.1.0'}</div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setSidebar(true)}><Menu size={20}/></button>
        <div className="search-box"><Search size={18}/><input ref={searchInput} value={query} onChange={(event) => void search(event.target.value)} placeholder="搜索设备、工具或命令…"/><kbd>{appInfo?.platform === 'darwin' ? '⌘ K' : 'Ctrl K'}</kbd>
          {query && <div className="search-results">{results.length ? results.map((result) => <button key={`${result.kind}-${result.id}`} onClick={() => openResult(result)}><span>{result.title}</span><small>{result.subtitle}</small></button>) : <div className="search-empty">没有匹配内容</div>}</div>}
        </div>
        <div className="topbar-status"><span className={`status-dot ${content?.issues.length ? 'warning' : ''}`}/>{content?.issues.length ? `${content.issues.length} 个内容提示` : '内容已校验'}</div>
      </header>
      <main className="main-content">
        {page === 'dashboard' && <DashboardPage onNavigate={navigate}/>} 
        {page === 'guides' && <GuidesPage key={focus?.id ?? 'guides'} focusId={focus?.id}/>}
        {page === 'tools' && <ToolsPage key={focus?.id ?? 'tools'} initialQuery={focus?.title}/>}
        {page === 'adb' && <AdbPage key={focus?.id ?? 'adb'} initialCommandId={focus?.id}/>}
        {page === 'downloads' && <DownloadsPage/>}
        {page === 'settings' && <SettingsPage/>}
      </main>
    </div>
    {sidebar && <button className="sidebar-scrim" onClick={() => setSidebar(false)} aria-label="关闭导航"/>}
  </div>
}
