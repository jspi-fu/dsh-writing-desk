/**
 * 投递页(ADR 0017):只呈现工作台下发的任务与逐平台进度。
 * 不再从当前标签页提取文章,也没有平台选择、重试与历史。
 */
import { useEffect } from 'react'
import { Inbox, Mailbox } from 'lucide-react'
import { useSyncStore } from '../stores/sync'
import { ArticleCard } from '@/components/sync-dialog/ArticleCard'
import { PlatformList } from '@/components/sync-dialog/PlatformList'
import type { Platform } from '@/components/sync-dialog/types'
import { EmptyState } from '../components/EmptyState'
import { useI18n } from '../LocaleProvider'

export function DispatchPage() {
  const { t } = useI18n()
  const {
    status,
    article,
    platforms,
    selectedPlatforms,
    results,
    error,
    platformProgress,
    deskTask,
    loadPlatforms,
    recoverSyncState,
    reset,
  } = useSyncStore()

  useEffect(() => {
    void recoverSyncState()
    void loadPlatforms()

    // client.ts 投递新任务时广播:已挂载的投递页重读 pendingSyncTask
    const handleMessage = (
      message: { type?: string },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void,
    ) => {
      if (message?.type !== 'SYNC_TASK_QUEUED') return
      sendResponse({ handled: true })
      void (async () => {
        await useSyncStore.getState().recoverSyncState(true)
        await useSyncStore.getState().loadPlatforms()
      })()
    }
    chrome.runtime.onMessage.addListener(handleMessage)
    return () => chrome.runtime.onMessage.removeListener(handleMessage)
  }, [])

  const known = new Map(platforms.map(platform => [platform.id, platform]))
  const taskPlatforms: Platform[] = selectedPlatforms.map(id => known.get(id) ?? {
    id,
    name: id,
    icon: '/assets/icon-48.png',
    isAuthenticated: true,
  })
  const selection = new Set(selectedPlatforms)
  const finished = status === 'completed' || status === 'failed' || status === 'cancelled'

  return (
    <div className="flex h-full flex-col">
      {deskTask && (
        <div className="flex-none px-4 pt-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
            <Inbox className="h-3 w-3 flex-shrink-0" strokeWidth={1.6} />
            <span className="truncate">{t('来自工作台投递：{title}', { title: deskTask.title })}</span>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {article ? (
          <ArticleCard article={article} compact={status !== 'idle'} />
        ) : (
          <div className="rounded-lg bg-muted/50 p-4">
            <EmptyState
              icon={Mailbox}
              message={t('还没有投递任务。在工作台发布对话框点「投递」，任务会出现在这里。')}
              className="py-2"
            />
          </div>
        )}

        {article && taskPlatforms.length > 0 && (
          <PlatformList
            platforms={taskPlatforms}
            selected={selection}
            status={status}
            results={results}
            platformProgress={platformProgress}
            selectedPlatforms={selectedPlatforms}
            onToggle={() => {}}
            onSelectAll={() => {}}
          />
        )}

        {error && (
          <div className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">
            {error}
          </div>
        )}
      </div>

      {(article || finished) && (
        <div className="flex-shrink-0 border-t p-4">
          {status === 'syncing' ? (
            <p className="py-2.5 text-center text-sm text-muted-foreground">{t('投递中…')}</p>
          ) : (
            <button
              type="button"
              onClick={reset}
              className="w-full rounded-lg bg-muted py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/80"
            >
              {t('清除')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
