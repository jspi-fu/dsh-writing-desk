import { useEffect, useState } from 'react'
import { CheckCircle, XCircle, ExternalLink, Clock, Trash2, ImageIcon, Loader2 } from 'lucide-react'
import { platformDisplayName } from '@/lib/platform-names'
import { translateAdapterError } from '@/lib/i18n'
import { useSyncStore } from '../stores/sync'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/EmptyState'
import { useI18n } from '../LocaleProvider'

export function HistoryPage() {
  const { history, loadHistory } = useSyncStore()
  const { t, lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  // 清空全部/逐条删除都不可恢复,两步确认防误触
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null)

  useEffect(() => {
    loadHistory()
  }, [])

  const clearHistory = async () => {
    await chrome.storage.local.remove('syncHistory')
    setConfirmingClear(false)
    loadHistory()
  }

  const deleteHistoryItem = async (id: string) => {
    const storage = await chrome.storage.local.get('syncHistory')
    await chrome.storage.local.set({
      syncHistory: (storage.syncHistory || []).filter((row: { id: string }) => row.id !== id),
    })
    setConfirmingDeleteId(null)
    loadHistory()
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    // 今天
    if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
      return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    }

    // 昨天
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (date.getDate() === yesterday.getDate()) {
      return t('昨天 {time}', {
        time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      })
    }

    // 其他
    return date.toLocaleDateString(locale, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (history.length === 0) {
    return (
      <div className="flex h-full flex-col p-4">
        <EmptyState icon={Clock} message={t('暂无同步历史')} className="flex-1" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('最近 {count} 条记录', { count: history.length })}
        </h2>
        {confirmingClear ? (
          <span className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void clearHistory()}
              className="h-7 text-xs text-status-danger hover:text-status-danger"
            >
              {t('清空')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingClear(false)}
              className="h-7 text-xs text-muted-foreground"
            >
              {t('取消')}
            </Button>
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingClear(true)}
            className="text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1"  strokeWidth={1.6} />
            {t('清空')}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto space-y-3">
        {history.map((item) => {
          const results = item.results || []
          const successCount = results.filter(r => r.success).length
          const failedCount = results.filter(r => !r.success).length

          return (
            <div
              key={item.id}
              className="p-3 rounded-lg border border-border bg-card"
            >
              <div className="flex gap-3">
                {/* 封面图 */}
                {item.cover ? (
                  <img
                    src={item.cover}
                    alt=""
                    className="w-16 h-16 rounded object-cover flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none'
                    }}
                  />
                ) : (
                  <div className="w-16 h-16 rounded bg-muted flex items-center justify-center flex-shrink-0">
                    <ImageIcon className="w-6 h-6 text-muted-foreground" strokeWidth={1.6} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  {/* 标题、时间和逐条删除 */}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-article-serif font-medium text-sm line-clamp-2">{item.title}</h3>
                    {confirmingDeleteId === item.id ? (
                      <span className="flex flex-none items-center gap-1">
                        <button
                          onClick={() => void deleteHistoryItem(item.id)}
                          className="rounded-md px-2 py-0.5 text-xs font-medium text-status-danger hover:bg-status-danger/10"
                        >
                          {t('删除')}
                        </button>
                        <button
                          onClick={() => setConfirmingDeleteId(null)}
                          className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          {t('取消')}
                        </button>
                      </span>
                    ) : (
                      <span className="flex flex-none items-center gap-1">
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTime(item.startTime ?? item.timestamp ?? Date.now())}
                        </span>
                        <button
                          onClick={() => setConfirmingDeleteId(item.id)}
                          aria-label={t('删除')}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:text-destructive hover:bg-muted"
                        >
                          <Trash2 className="w-3.5 h-3.5" strokeWidth={1.6} />
                        </button>
                      </span>
                    )}
                  </div>

                  {/* 统计 */}
                  <div className="flex items-center gap-3 text-xs">
                    {item.status === 'syncing' ? (
                      <div className="flex items-center gap-1 text-status-draft">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.6} />
                        <span>{t('同步中...')}</span>
                      </div>
                    ) : item.status === 'cancelled' ? (
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <XCircle className="w-3.5 h-3.5" strokeWidth={1.6} />
                        <span>{t('已取消')}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1 text-status-published">
                          <CheckCircle className="w-3.5 h-3.5" strokeWidth={1.6} />
                          <span>{t('{count} 成功', { count: successCount })}</span>
                        </div>
                        {failedCount > 0 && (
                          <div className="flex items-center gap-1 text-status-danger">
                            <XCircle className="w-3.5 h-3.5" strokeWidth={1.6} />
                            <span>{t('{count} 失败', { count: failedCount })}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* 平台列表:失败原因行内给全,不做 hover 才能看的诊断 */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {results.map((result) => (
                      <div
                        key={result.platform}
                        className={`
                          inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                          ${result.success
                            ? 'bg-status-published/10 text-status-published'
                            : 'bg-status-danger/10 text-status-danger'
                          }
                        `}
                      >
                        <span className="whitespace-nowrap">{platformDisplayName(result.platform, result.platformName || result.platform)}</span>
                        {!result.success && result.error && (
                          <span className="opacity-80">: {translateAdapterError(result.error)}</span>
                        )}
                        {result.postUrl && (
                          <a
                            href={result.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:opacity-70"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3 h-3" strokeWidth={1.6} />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
