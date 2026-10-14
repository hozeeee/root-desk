import { BookOpen, Boxes, Download, LayoutDashboard, Settings, TerminalSquare, type LucideIcon } from 'lucide-react'

export type PageId = 'dashboard' | 'guides' | 'tools' | 'adb' | 'downloads' | 'settings'
export interface NavigationItem { id: PageId; label: string; hint: string; icon: LucideIcon }
export const navigation: NavigationItem[] = [
  { id: 'dashboard', label: '总览', hint: '工作台状态', icon: LayoutDashboard },
  { id: 'guides', label: '设备指南', hint: '机型与步骤', icon: BookOpen },
  { id: 'tools', label: '工具目录', hint: '可信工具索引', icon: Boxes },
  { id: 'adb', label: 'ADB 工具箱', hint: '设备与命令', icon: TerminalSquare },
  { id: 'downloads', label: '下载中心', hint: '校验与任务', icon: Download },
  { id: 'settings', label: '设置', hint: '安全与网络', icon: Settings }
]
