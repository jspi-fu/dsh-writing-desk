import { useEffect } from 'react'
import { CheckCircle, XCircle, ExternalLink, Clock, Trash2, ImageIcon, Loader2 } from 'lucide-react'
import { platformDisplayName } from '@/lib/platform-names'
import { translateAdapterError } from '@/lib/i18n'
import { useSyncStore } from '../stores/sync'
import { Button } from '../components/ui/Button'
import { useI18n } from '../LocaleProvider'

export function HistoryPage() {
  const { history, loadHistory } = useSyncStore()
  const { t, lang } = useI18n()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'

  useEffect(() => {
    loadHistory()
  }, [])

  const clearHistory = async () => {
    await chrome.storage.local.remove('syncHistory')
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
        <h1 className="mb-4 text-lg font-semibold tracking-tight">{t('历史')}</h1>
        <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
          <Clock className="w-12 h-12 mb-4 opacity-50" />
          <p>{t('暂无同步历史')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-4">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">{t('历史')}</h1>

      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t('最近 {count} 条记录', { count: history.length })}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearHistory}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" />
          {t('清空')}
        </Button>
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
                    <ImageIcon className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  {/* 标题和时间 */}
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <h3 className="font-medium text-sm line-clamp-2">{item.title}</h3>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(item.startTime ?? item.timestamp ?? Date.now())}
                    </span>
                  </div>

                  {/* 统计 */}
                  <div className="flex items-center gap-3 text-xs">
                    {item.status === 'syncing' ? (
                      <div className="flex items-center gap-1 text-blue-600">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>{t('同步中...')}</span>
                      </div>
                    ) : item.status === 'cancelled' ? (
                      <div className="flex items-center gap-1 text-gray-500">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>{t('已取消')}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>{t('{count} 成功', { count: successCount })}</span>
                        </div>
                        {failedCount > 0 && (
                          <div className="flex items-center gap-1 text-red-600">
                            <XCircle className="w-3.5 h-3.5" />
                            <span>{t('{count} 失败', { count: failedCount })}</span>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* 平台列表 */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {results.map((result) => (
                      <div
                        key={result.platform}
                        className={`
                          inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs
                          ${result.success
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                          }
                        `}
                        title={!result.success && result.error ? translateAdapterError(result.error) : undefined}
                      >
                        <span>{platformDisplayName(result.platform, result.platformName || result.platform)}</span>
                        {!result.success && result.error && (
                          <span className="opacity-60 truncate max-w-[80px]">: {translateAdapterError(result.error)}</span>
                        )}
                        {result.postUrl && (
                          <a
                            href={result.postUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:opacity-70"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="w-3 h-3" />
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
