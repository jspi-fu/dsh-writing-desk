import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 统一空态:同样的情形同样的画法——20px 单色图标 + 一句话,页面级或卡片内垂直居中。
 * 不放大图标、不加副句,空态一句话说完;需要动作时由调用方在下方补一个操作行。
 */
export function EmptyState({
  icon: Icon,
  message,
  className,
}: {
  icon: LucideIcon
  message: string
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-muted-foreground', className)}>
      <Icon className="h-5 w-5 opacity-60" strokeWidth={1.6} />
      <p className="text-xs">{message}</p>
    </div>
  )
}
