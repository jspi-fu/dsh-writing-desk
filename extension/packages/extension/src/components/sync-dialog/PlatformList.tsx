import { Check, X, Loader2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translateAdapterError } from '@/lib/i18n'
import { platformDisplayName } from '@/lib/platform-names'
import { useI18n } from '@/popup/LocaleProvider'
import type { Platform, SyncResult, PlatformProgress, DialogStatus } from './types'

interface PlatformListProps {
  platforms: Platform[]
  status: DialogStatus
  results: SyncResult[]
  platformProgress: Map<string, PlatformProgress>
  selectedPlatforms: string[]
}

/**
 * 投递进度列表(ADR 0017):只呈现工作台任务选中的平台,不再有勾选/全选。
 * 进度与结果仍按 PlatformList 的既有分层渲染。
 */
export function PlatformList({
  platforms,
  status,
  results,
  platformProgress,
  selectedPlatforms,
}: PlatformListProps) {
  const { t } = useI18n()
  const isSyncing = status === 'syncing'
  // 完成/失败/取消都是终态，共用完成态的汇总头部和结果行渲染
  const isFinished = status === 'completed' || status === 'failed' || status === 'cancelled'

  const successCount = results.filter(r => r.success).length
  const failedCount = results.filter(r => !r.success).length

  // 按阶段加权计算进度：只同步一个平台时，完成前也能看到在推进，而不是一直停在 0%
  const stageWeight = (id: string) => {
    if (results.some(r => r.platform === id)) return 1
    const p = platformProgress.get(id)
    if (!p) return 0
    if (p.stage === 'uploading_images') {
      const { current = 0, total = 0 } = p.imageProgress || {}
      return 0.1 + (total > 0 ? 0.6 * (current / total) : 0)
    }
    return { starting: 0.1, saving: 0.85, completed: 1, failed: 1 }[p.stage]
  }
  const progressPercent = selectedPlatforms.length > 0
    ? (selectedPlatforms.reduce((sum, id) => sum + stageWeight(id), 0) / selectedPlatforms.length) * 100
    : 0

  const visiblePlatforms = selectedPlatforms
    .map(id => platforms.find(p => p.id === id))
    .filter(Boolean) as Platform[]

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        {isSyncing && (
          <>
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" strokeWidth={1.6} />
              <span className="text-sm font-medium">{t('投递中')}</span>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">
              {results.length}/{selectedPlatforms.length}
            </span>
          </>
        )}
        {isFinished && (
          <>
            <span className="text-sm font-medium">
              {status === 'completed' ? t('投递完成') : status === 'failed' ? t('投递失败') : t('已取消')}
            </span>
            <div className="flex items-center gap-2">
              {successCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs text-status-published">
                  <Check className="w-3 h-3" strokeWidth={1.6} />{successCount}
                </span>
              )}
              {failedCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-xs text-status-danger">
                  <X className="w-3 h-3" strokeWidth={1.6} />{failedCount}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Progress bar (syncing only) */}
      {isSyncing && selectedPlatforms.length > 0 && (
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* Platform rows */}
      <div className="space-y-0.5">
        {visiblePlatforms.map(platform => {
          const result = results.find(r => r.platform === platform.id)
          const progress = platformProgress.get(platform.id)

          return (
            <PlatformRow
              key={platform.id}
              platform={platform}
              isWaiting={isSyncing && !result && !progress}
              isInProgress={isSyncing && !result && !!progress}
              isSkipped={isFinished && !result}
              result={result || null}
              progress={progress || null}
            />
          )
        })}
      </div>
    </div>
  )
}

// ── Single platform row ──

function PlatformRow({
  platform,
  isWaiting,
  isInProgress,
  isSkipped,
  result,
  progress,
}: {
  platform: Platform
  isWaiting: boolean
  isInProgress: boolean
  isSkipped: boolean
  result: SyncResult | null
  progress: PlatformProgress | null
}) {
  const isDone = !!result
  const displayName = platformDisplayName(platform.id, platform.name)

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-200',
        isDone && result?.success && 'bg-status-published/10',
        isDone && result && !result.success && 'bg-status-danger/10',
      )}
    >
      <RowIndicator
        isWaiting={isWaiting || isSkipped}
        isInProgress={isInProgress}
        result={result}
      />

      <img
        src={platform.icon}
        alt={displayName}
        className="w-5 h-5 rounded flex-shrink-0"
        onError={(e) => {
          (e.target as HTMLImageElement).src = '/assets/icon-48.png'
        }}
      />

      <span className="text-sm flex-1 truncate">{displayName}</span>

      <RowInfo
        isWaiting={isWaiting}
        isInProgress={isInProgress}
        isSkipped={isSkipped}
        result={result}
        progress={progress}
      />
    </div>
  )
}

// ── Left indicator (spinner / check / x) ──

function RowIndicator({
  isWaiting,
  isInProgress,
  result,
}: {
  isWaiting: boolean
  isInProgress: boolean
  result: SyncResult | null
}) {
  if (result) {
    return result.success ? (
      <div className="w-5 h-5 rounded-full bg-status-published/15 flex items-center justify-center flex-shrink-0">
        <Check className="w-3 h-3 text-status-published" strokeWidth={1.6} />
      </div>
    ) : (
      <div className="w-5 h-5 rounded-full bg-status-danger/15 flex items-center justify-center flex-shrink-0">
        <X className="w-3 h-3 text-status-danger" strokeWidth={1.6} />
      </div>
    )
  }
  if (isInProgress) {
    return <Loader2 className="w-4 h-4 animate-spin text-primary flex-shrink-0" strokeWidth={1.6} />
  }
  if (isWaiting) {
    // 等待中的呼吸环:与终态的结果图标靠动效区分
    return <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/50 animate-pulse flex-shrink-0" />
  }
  return <div className="w-4 h-4 rounded-full border-2 border-border flex-shrink-0" />
}

// ── Right side info (stage / link / error) ──

function RowInfo({
  isWaiting,
  isInProgress,
  isSkipped,
  result,
  progress,
}: {
  isWaiting: boolean
  isInProgress: boolean
  isSkipped: boolean
  result: SyncResult | null
  progress: PlatformProgress | null
}) {
  const { t } = useI18n()

  // Done
  if (result) {
    if (result.success && result.postUrl) {
      return (
        <span className="flex items-center gap-1 flex-shrink-0">
          {result.message && (
            <span className="text-[10px] text-muted-foreground truncate block max-w-[140px]" title={result.message}>
              {result.message}
            </span>
          )}
          <a
            href={result.postUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline flex items-center gap-0.5 whitespace-nowrap"
          >
            {result.draftOnly ? t('草稿') : t('查看')}
            <ExternalLink className="w-3 h-3" strokeWidth={1.6} />
          </a>
        </span>
      )
    }
    if (!result.success) {
      return (
        // 失败原因是关键诊断,行内完整给出,不藏进 hover
        <span className="text-xs text-status-danger text-right flex-shrink-0 min-w-0">
          {translateAdapterError(result.error) || t('失败')}
        </span>
      )
    }
    return <span className="text-xs text-status-published flex-shrink-0">{t('完成')}</span>
  }

  // In progress
  if (isInProgress && progress) {
    const stageText = {
      starting: t('准备中'),
      uploading_images: progress.imageProgress
        ? t('图片 {current}/{total}', {
            current: progress.imageProgress.current,
            total: progress.imageProgress.total,
          })
        : t('上传图片'),
      saving: t('保存中'),
      completed: t('完成'),
      failed: t('失败'),
    }[progress.stage]

    return (
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-xs text-primary">{stageText}</span>
        {progress.stage === 'uploading_images' && progress.imageProgress && (
          <div className="w-10 h-1 bg-primary/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${(progress.imageProgress.current / progress.imageProgress.total) * 100}%` }}
            />
          </div>
        )}
      </div>
    )
  }

  // 终态但未执行（取消/失败时未跑到的平台）
  if (isSkipped) {
    return <span className="text-xs text-muted-foreground flex-shrink-0">{t('未执行')}</span>
  }

  // Waiting
  if (isWaiting) {
    return <span className="text-xs text-muted-foreground flex-shrink-0">{t('等待中')}</span>
  }

  return null
}
