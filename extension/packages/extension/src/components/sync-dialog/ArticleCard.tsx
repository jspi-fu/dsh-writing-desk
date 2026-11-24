/**
 * 投递任务卡(ADR 0017):只呈现工作台任务的标题与封面。
 * 空态由投递页负责,不再保留「当前页文章」文案。
 */
import type { Article } from './types'

export function ArticleCard({ article }: { article: Article }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="flex gap-3">
        {article.cover && (
          <img
            src={article.cover}
            alt=""
            className="h-14 w-14 flex-shrink-0 rounded object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="font-article-serif line-clamp-2 text-sm font-medium">{article.title}</h2>
        </div>
      </div>
    </div>
  )
}
