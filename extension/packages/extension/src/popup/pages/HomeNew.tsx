import { useEffect, useState } from 'react'
import { AlertTriangle, Inbox, X } from 'lucide-react'
import { useSyncStore } from '../stores/sync'
import { SyncDialog } from '@/components/sync-dialog'
import type { Platform as DialogPlatform } from '@/components/sync-dialog'
import { createLogger } from '../../lib/logger'
import { useI18n } from '../LocaleProvider'

const logger = createLogger('HomeNew')

export function HomeNew() {
  const { t } = useI18n()
  const {
    status,
    article,
    selectedPlatforms,
    results,
    error,
    platformProgress,
    hiddenPlatforms,
    deskTask,
    loadPlatforms,
    loadArticle,
    recoverSyncState,
    togglePlatform,
    selectAll,
    deselectAll,
    startSync,
    retryFailed,
    reset,
    checkRateLimit,
  } = useSyncStore()

  const [rateLimitWarning, setRateLimitWarning] = useState<string | null>(null)
  const [allPlatforms, setAllPlatforms] = useState<DialogPlatform[]>([])

  useEffect(() => {
    let reloadTimer: ReturnType<typeof setTimeout> | null = null

    // 标签切换 / 页面加载完成都会触发，合并成一次提取
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => {
        reloadTimer = null
        void useSyncStore.getState().reloadArticle()
      }, 250)
    }

    const init = async () => {
      await recoverSyncState()
      // Render from cache first, then refresh
      try {
        const cached = await chrome.storage.local.get('platformListCache')
        if (cached.platformListCache?.length) {
          setAllPlatforms(cached.platformListCache.map((p: any) => ({
            id: p.id, name: p.name, icon: p.icon,
            isAuthenticated: p.isAuthenticated, username: p.username,
            homepage: p.homepage,
          })))
        }
      } catch {}
      loadAllPlatforms()
      loadArticle()
    }
    init()

    const handleTabActivated = () => scheduleReload()
    const handleTabUpdated = (
      _tabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (changeInfo.status === 'complete' && tab.active) scheduleReload()
    }

    // client.ts 投递新任务时广播：已挂载的同步页强制重读 pendingSyncTask
    const handleMessage = (
      message: { type?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (message?.type !== 'SYNC_TASK_QUEUED') return
      sendResponse({ handled: true })
      void (async () => {
        const store = useSyncStore.getState()
        await store.recoverSyncState(true)
        await store.reloadArticle(true)
      })()
    }

    chrome.tabs.onActivated.addListener(handleTabActivated)
    chrome.tabs.onUpdated.addListener(handleTabUpdated)
    chrome.runtime.onMessage.addListener(handleMessage)

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer)
      chrome.tabs.onActivated.removeListener(handleTabActivated)
      chrome.tabs.onUpdated.removeListener(handleTabUpdated)
      chrome.runtime.onMessage.removeListener(handleMessage)
    }
  }, [])

  const loadAllPlatforms = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH', payload: { forceRefresh: false } })
      const mapped: DialogPlatform[] = (response.platforms || []).map((p: any) => ({
        id: p.id, name: p.name, icon: p.icon,
        isAuthenticated: p.isAuthenticated, username: p.username,
        homepage: p.homepage,
      }))
      setAllPlatforms(mapped)
      await loadPlatforms()
    } catch (error) {
      logger.error('Failed to load platforms:', error)
    }
  }

  // Start sync with rate-limit check
  const handleStartSync = async () => {
    const warning = await checkRateLimit()
    if (warning) {
      setRateLimitWarning(warning)
      setTimeout(() => setRateLimitWarning(null), 8000)
    }
    startSync()
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Desk dispatch hint — the task arrived through the workbench bridge */}
      {deskTask && (
        <div className="flex-none px-4 pt-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
            <Inbox className="h-3 w-3 flex-shrink-0"  strokeWidth={1.6} />
            <span className="truncate">{t('来自工作台投递：{title}', { title: deskTask.title })}</span>
          </div>
        </div>
      )}

      {/* SyncDialog — the unified sync flow */}
      <SyncDialog
        article={article}
        platforms={allPlatforms.filter(p => !hiddenPlatforms.includes(p.id))}
        status={status}
        selectedPlatforms={selectedPlatforms}
        results={results}
        platformProgress={platformProgress}
        error={error}
        onTogglePlatform={togglePlatform}
        onSelectAll={selectAll}
        onDeselectAll={deselectAll}
        onStartSync={handleStartSync}
        onRetryFailed={retryFailed}
        onReset={reset}
        onCancel={reset}
        className="min-h-0 flex-1"
      />

      {/* Rate limit warning (non-blocking toast) */}
      {rateLimitWarning && (
        <div className="absolute left-3 right-3 top-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-start gap-2 rounded-lg border border-status-outline/30 bg-status-outline/10 p-3 shadow-lg">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-status-outline" strokeWidth={1.6} />
            <p className="flex-1 text-sm text-foreground">{rateLimitWarning}</p>
            <button
              onClick={() => setRateLimitWarning(null)}
              aria-label={t('关闭')}
              className="flex-shrink-0 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" strokeWidth={1.6} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}