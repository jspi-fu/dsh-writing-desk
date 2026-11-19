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
  { path: '/', label: '收进' },
  { path: '/sync', label: '同步' },
  { path: '/accounts', label: '账号' },
  { path: '/history', label: '历史' },
]

type ConnectionState = 'unknown' | 'off' | 'waiting' | 'on'

function useConnectionState(): ConnectionState {
  const [state, setState] = useState<ConnectionState>('unknown')

  useEffect(() => {
    let mounted = true
    const poll = () => {
      chrome.runtime.sendMessage({ type: 'BRIDGE_STATUS' }).then(response => {
        if (!mounted || !response || response.error) return
        setState(response.connected ? 'on' : response.enabled ? 'waiting' : 'off')
      }).catch(() => {})
    }
    poll()
    const timer = setInterval(poll, 5000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  return state
}

function ConnectionStatus() {
  const { t } = useI18n()
  const state = useConnectionState()
  const label = state === 'unknown'
    ? t('检查中')
    : state === 'on'
      ? t('已连接')
      : state === 'waiting'
        ? t('连接中')
        : t('未连接')
  const dot = state === 'on'
    ? 'bg-emerald-500'
    : state === 'waiting'
      ? 'bg-amber-500'
      : 'bg-muted-foreground/40'

  return (
    <span
      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
      title={t('DSwritesync 本地服务连接状态')}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
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
    chrome.storage.local.get('panelRoute').then(result => {
      const route = result.panelRoute
      if (typeof route === 'string' && route.startsWith('/')) {
        chrome.storage.local.remove('panelRoute')
        navigate(route, { replace: true })
      }
    }).catch(() => {})

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
      <header className="flex flex-none items-center gap-2 border-b border-border/70 px-4 py-3">
        <img src="/assets/icon-48.png" alt="" className="h-6 w-6 rounded-md" />
        <h1 className="text-[15px] font-semibold tracking-tight">DSwritesync</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <ConnectionStatus />
          <button
            onClick={() => navigate('/settings')}
            aria-label={t('设置')}
            title={t('设置')}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
              settingsActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </header>

      <nav className="flex-none px-4 pb-3 pt-2.5">
        <div className="flex rounded-xl bg-muted p-0.5">
          {tabs.map(tab => (
            <NavLink
              key={tab.path}
              to={tab.path}
              end={tab.path === '/'}
              className={({ isActive }) => cn(
                'flex h-8 flex-1 items-center justify-center rounded-[11px] text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>

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