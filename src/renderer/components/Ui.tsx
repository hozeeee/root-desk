import { AlertCircle, Inbox } from 'lucide-react'
import type { ReactNode } from 'react'

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent'; children: ReactNode }): JSX.Element {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function EmptyState({ title, description }: { title: string; description: string }): JSX.Element {
  return <div className="empty-state"><Inbox size={28}/><strong>{title}</strong><span>{description}</span></div>
}

export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }): JSX.Element {
  return <div className={`notice${danger ? ' notice-danger' : ''}`}><AlertCircle size={17}/><span>{children}</span></div>
}

export function Spinner(): JSX.Element { return <span className="spinner" aria-label="加载中" /> }
