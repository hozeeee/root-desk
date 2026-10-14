import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AppInfo, AppSettings, ContentSnapshot } from '@shared/contracts'

interface AppContextValue {
  content: ContentSnapshot | null
  settings: AppSettings | null
  appInfo: AppInfo | null
  loading: boolean
  error: string | null
  reloadContent(): Promise<void>
  updateSettings(patch: Partial<AppSettings> & { proxyPassword?: string }): Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [content, setContent] = useState<ContentSnapshot | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([window.rootDesk.getContent(), window.rootDesk.getSettings(), window.rootDesk.getAppInfo()])
      .then(([nextContent, nextSettings, nextInfo]) => {
        setContent(nextContent); setSettings(nextSettings); setAppInfo(nextInfo)
      })
      .catch((reason) => setError(message(reason)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!settings) return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => { document.documentElement.dataset.theme = settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings])

  const reloadContent = useCallback(async () => {
    setContent(await window.rootDesk.reloadContent())
  }, [])
  const updateSettings = useCallback(async (patch: Partial<AppSettings> & { proxyPassword?: string }) => {
    setSettings(await window.rootDesk.updateSettings(patch))
  }, [])

  const value = useMemo(() => ({ content, settings, appInfo, loading, error, reloadContent, updateSettings }), [content, settings, appInfo, loading, error, reloadContent, updateSettings])
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp 必须在 AppProvider 内使用')
  return value
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
