import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { HomeNew } from './pages/HomeNew'
import { AccountsPage } from './pages/Accounts'
import { HistoryPage } from './pages/History'
import { StashPage } from './pages/StashPage'
import { SettingsPage } from './pages/SettingsPage'
import { useI18n } from './LocaleProvider'

const TABS = [
  { path: '/', label: '收录' },
  { path: '/sync', label: '同步' },
  { path: '/accounts', label: '账号' },
  { path: '/history', label: '历史' },
]

type ConnectionState = 'unknown' | 'off' | 'waiting' | 'on'

function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>('unknown')

  useEffect(() => {
    // 面板打开期间开 NM 长端口(ADR 0012):投递与收录回执近实时,离开时归还
    chrome.runtime.sendMessage({ type: 'BRIDGE_WATCH_START' }).catch(() => {})
    let mounted = true
    const poll = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' })
        if (!mounted || !response || response.error) return
        setState(response.connected ? 'on' : response.paired ? 'waiting' : 'off')
      } catch {
        // 桥状态轮询失败不打断面板
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 5000)
    return () => {
      mounted = false
      clearInterval(timer)
      chrome.runtime.sendMessage({ type: 'BRIDGE_WATCH_STOP' }).catch(() => {})
    }
  }, [])

  return state
}

function ConnectionStatus() {
  const { t } = useI18n()
  const state = useConnectionState()
  // 词汇与设置页同一组:未配对 / 连接中 / 已连接,同一时刻全应用只有一个说法
  const label = state === 'unknown'
    ? t('检查中')
    : state === 'on'
      ? t('已连接')
      : state === 'waiting'
        ? t('连接中')
        : t('未配对')
  const dot = state === 'on'
    ? 'bg-status-published'
    : state === 'waiting'
      ? 'bg-status-outline'
      : 'bg-muted-foreground/40'

  return (
    <span
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title={t('DSwritesync 本地助手连接状态')}
    >
      <span className={cn('h-2 w-2 rounded-full', dot)} />
      {label}
    </span>
  )
}

/**
 * Side-panel shell: brand header, connection state, settings gear and the four
 * top-level tabs. Settings lives behind the gear instead of taking a tab.
 */
export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const settingsActive = location.pathname === '/settings'
  const tabs = TABS.map(tab => ({ ...tab, label: t(tab.label) }))
  const activeTab = tabs.find(tab => tab.path === location.pathname)
  const pageName = settingsActive ? t('设置') : activeTab?.label ?? tabs[0].label

  useEffect(() => {
    document.title = `${pageName} · DSwritesync`
  }, [pageName])

  // The FAB asks the service worker to open /sync; a freshly opened panel may
  // read the route from storage, an already-open one gets the message.
  useEffect(() => {
    ;(async () => {
      try {
        const result = await chrome.storage.local.get('panelRoute')
        const route = result.panelRoute
        if (typeof route === 'string' && route.startsWith('/')) {
          chrome.storage.local.remove('panelRoute')
          navigate(route, { replace: true })
        }
      } catch {
        // 路由恢复失败不影响面板默认页
      }
    })()

    const listener = (message: { type?: string; path?: string }) => {
      if (message?.type === 'PANEL_NAVIGATE' && typeof message.path === 'string') {
        chrome.storage.local.remove('panelRoute')
        navigate(message.path)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [navigate])

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* 浏览器侧栏标题栏已有品牌,页内不再重复:一行放下切换栏 + 连接状态 + 设置 */}
      <header className="flex flex-none items-center gap-1.5 border-b border-border/70 px-2.5 py-2.5">
        <nav className="flex min-w-0 flex-1 rounded-xl bg-muted p-0.5">
          {tabs.map(tab => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.path === '/'}
              className={({ isActive }) => cn(
                'flex h-8 min-w-0 flex-1 items-center justify-center rounded-[11px] px-0.5 text-[12.5px] font-medium transition-colors',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <ConnectionStatus />
        <button
          onClick={() => navigate('/settings')}
          aria-label={t('设置')}
          title={t('设置')}
          className={cn(
            'flex h-8 w-8 flex-none items-center justify-center rounded-full transition-colors',
            settingsActive
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Settings className="h-4 w-4" strokeWidth={1.6} />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        <Routes>
          <Route path="/" element={<StashPage />} />
          <Route path="/sync" element={<HomeNew />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<StashPage />} />
        </Routes>
      </main>
    </div>
  )
}