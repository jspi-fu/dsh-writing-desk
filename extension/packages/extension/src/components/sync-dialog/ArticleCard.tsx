import { Check, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/popup/LocaleProvider'
import { EmptyState } from '@/popup/components/EmptyState'
import type { Article } from './types'

interface ArticleCardProps {
  article: Article | null
  /** 文章提取是异步的:loading 时渲染骨架,而不是把「未检测到」的假空态说出去 */
  loading?: boolean
  compact?: boolean
}

export function ArticleCard({ article, loading, compact }: ArticleCardProps) {
  const { t } = useI18n()

  if (loading) {
    return (
      <div className="rounded-lg p-3 bg-muted/50 border border-border/60" aria-busy="true">
        <div className="flex gap-3 animate-pulse">
          <div className="w-16 h-16 rounded bg-muted flex-shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3.5 w-3/4 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted" />
          </div>
        </div>
      </div>
    )
  }

  if (!article) {
    return (
      <div className="rounded-lg p-4 bg-muted/50">
        <EmptyState icon={FileText} message={t('当前页面未检测到文章,请在文章页面使用')} className="py-2" />
      </div>
    )
  }

  if (compact) {
    return (
      <div className="rounded-lg p-3 bg-muted/40 border">
        <div className="flex gap-3">
          {article.cover && (
            <img
              src={article.cover}
              alt=""
              className="w-14 h-14 rounded object-cover flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-article-serif font-medium text-sm line-clamp-2">{article.title}</h2>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg p-3 bg-status-published/10 border border-status-published/30">
      <div className="flex items-center gap-1.5 mb-2">
        <Check className="w-3.5 h-3.5 text-status-published" strokeWidth={1.6} />
        <span className="text-xs font-medium text-status-published">
          {t('已识别文章，选择平台后同步')}
        </span>
      </div>
      <div className="flex gap-3">
        {article.cover && (
          <img
            src={article.cover}
            alt=""
            className="w-16 h-16 rounded object-cover flex-shrink-0"
          />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="font-article-serif font-medium text-sm line-clamp-2">{article.title}</h2>
          {article.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
              {article.summary}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
