/**
 * 任务投递管线(ADR 0012):outbox 任务从元数据到回执的整条流水线。
 * 接口 = processPendingTasks(内部串行化)+ runTask;claim、分片拉取重试、
 * 图片内联、markdown→html 降级、进度消息转发、回执映射与失败兜底回执
 * 全部藏在实现内。
 *
 * 依赖全部注入(接受依赖,不要自己创建):NM 短请求走传输结构面,同步执行
 * 来自 sync-service(类型对齐,运行时不 import),呈现走 TaskPresentation
 * 接口——测试沿缝换假件,不戳实现内部。
 */
import { markdownToHtml } from '@wechatsync/core'
import { createLogger } from '../lib/logger'
import { t } from '../lib/i18n'
import {
  assembleShards,
  decodeUtf8,
  inlineImageRefs,
  mapDispatchResults,
  type ContentResponse,
  type DispatchResultRow,
  type TaskMeta,
} from './protocol'
import type { PendingSyncTask } from './task-presentation'

const logger = createLogger('DeliveryPipeline')

const SHARD_RETRIES = 2

/** sync-service 的 performSync 构造面(仅类型,避免运行时依赖)。 */
type PerformSync = typeof import('../background/sync-service').performSync

export interface TaskPresentation {
  /** 任务落 pendingSyncTask 契约并呈现;失败会抛出,由管线记账后继续同步。 */
  stage(task: Omit<PendingSyncTask, 'syncId' | 'at'>, syncId: string): Promise<void>
  /** 只清理自己 syncId 的暂存,避免并发投递时误删新任务。 */
  clear(syncId: string): Promise<void>
}

export interface DeliveryDeps {
  /** NM 短请求面(tasks/claim/content/receipt 都走它)。 */
  transport: {
    request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>
  }
  performSync: PerformSync
  generateSyncId: () => string
  presentation: TaskPresentation
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export class DeliveryPipeline {
  private readonly transport: DeliveryDeps['transport']
  private readonly performSync: PerformSync
  private readonly generateSyncId: () => string
  private readonly presentation: TaskPresentation
  private processing = false

  constructor(deps: DeliveryDeps) {
    this.transport = deps.transport
    this.performSync = deps.performSync
    this.generateSyncId = deps.generateSyncId
    this.presentation = deps.presentation
  }

  /** 拉取并处理待投递任务;alarm/长端口事件/页面打开都会触发,内部串行化。 */
  async processPendingTasks(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      for (;;) {
        const response = await this.transport.request<{ tasks?: unknown }>('tasks')
        const tasks = Array.isArray(response.tasks) ? response.tasks.filter(isRecord) as unknown as TaskMeta[] : []
        if (!tasks.length) break
        for (const meta of tasks) {
          await this.runTask(meta)
        }
      }
    } catch (error) {
      logger.debug('Task pull unavailable:', error)
    } finally {
      this.processing = false
    }
  }

  /** 处理单个任务:claim → 分片拉取 → performSync → 回执;失败写逐平台失败回执。 */
  async runTask(meta: TaskMeta): Promise<void> {
    const operationId = meta.operationId
    try {
      const claimed = await this.transport.request<{ task?: TaskMeta }>('claim', { operationId })
      const task = (isRecord(claimed.task) ? claimed.task : meta) as TaskMeta
      const platforms = Array.isArray(task.platforms) ? task.platforms : []
      if (!platforms.length) throw new Error(t('任务没有可投递的平台'))

      const articleBytes = await this.fetchBlob(operationId, 'article', Math.max(1, task.article?.shards ?? 1))
      const images = new Map<string, { bytes: Uint8Array; mime: string }>()
      for (const image of task.images ?? []) {
        try {
          images.set(image.ref, {
            bytes: await this.fetchBlob(operationId, image.ref, Math.max(1, image.shards)),
            mime: image.mime || 'application/octet-stream',
          })
        } catch (error) {
          logger.warn(`Image shard fetch failed (${image.ref}), keeping raw ref:`, error)
        }
      }
      const markdown = inlineImageRefs(decodeUtf8(articleBytes), images)
      await this.dispatchArticle(task, markdown, platforms)
      logger.debug(`Task dispatched: ${operationId}`)
    } catch (error) {
      const message = ((error as Error).message || String(error)).slice(0, 200)
      logger.warn(`Task failed (${operationId}):`, message)
      // 回执行逐平台失败:宿主 digestReceipts 按静态适配器表 ∪ 快照里的自建站 id
      // 过滤,平台名不在清单里的行会被剥掉,不能用通配符占位。平台名拿不到时不写
      // 回执,留在 .claiming 里交给助手的 stale 认领恢复(它读得到任务文件里的平台清单)。
      const platforms = Array.isArray(meta.platforms) ? meta.platforms.filter(p => typeof p === 'string') : []
      if (!platforms.length) return
      await this.writeDispatchReceipt(operationId, meta.itemId, platforms.map(platform => ({ platform, ok: false, error: message }))).catch(() => {})
    }
  }

  /** 拉一个内容本体,单分片失败重试(SHARD_RETRIES 次),不静默截断。 */
  private async fetchBlob(operationId: string, name: string, shards: number): Promise<Uint8Array> {
    const parts: string[] = []
    for (let shard = 0; shard < shards; shard += 1) {
      let lastError: Error | null = null
      for (let attempt = 0; attempt <= SHARD_RETRIES; attempt += 1) {
        try {
          const response = await this.transport.request<ContentResponse>('content', { operationId, name, shard })
          if (response.ok !== true || typeof response.data !== 'string') throw new Error(t('分片拉取失败'))
          parts.push(response.data)
          lastError = null
          break
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error))
        }
      }
      if (lastError) throw lastError
    }
    return assembleShards(parts)
  }

  /** 任务下发:落 pendingSyncTask 并执行同步;侧栏开着时通知它切到投递页(ADR 0017)。 */
  private async dispatchArticle(
    task: TaskMeta,
    markdown: string,
    platforms: string[],
  ): Promise<void> {
    let htmlContent = ''
    try {
      htmlContent = markdownToHtml(markdown)
    } catch (error) {
      logger.error('Markdown conversion failed:', error)
      htmlContent = markdown.replace(/\n/g, '<br>')
    }

    const article = {
      title: task.title || t('工作台投递'),
      content: htmlContent,
      html: htmlContent,
      markdown,
    }
    const syncId = this.generateSyncId()

    try {
      // operationId/itemId 只在 itemId 存在时成对写入,维持 pendingSyncTask 既有形状
      const staged: Omit<PendingSyncTask, 'syncId' | 'at'> = {
        ...(task.itemId ? { operationId: task.operationId } : {}),
        ...(task.itemId ? { itemId: task.itemId } : {}),
        title: task.title || article.title,
        platforms,
        article: {
          title: article.title,
          markdown,
          content: htmlContent,
        },
      }
      await this.presentation.stage(staged, syncId)
    } catch (error) {
      logger.error('Failed to stage pending sync task:', error)
    }

    try {
      const { results } = await this.performSync(
        article,
        platforms,
        { source: 'bridge', syncId },
        {
          onResult: (result) => {
            chrome.runtime.sendMessage({
              type: 'SYNC_PROGRESS',
              payload: { result },
              syncId,
            }).catch(() => {})
          },
          onImageProgress: (platform, current, total) => {
            chrome.runtime.sendMessage({
              type: 'IMAGE_PROGRESS',
              payload: { platform, current, total },
              syncId,
            }).catch(() => {})
          },
          onDetailProgress: (progress) => {
            chrome.runtime.sendMessage({
              type: 'SYNC_DETAIL_PROGRESS',
              payload: progress,
              syncId,
            }).catch(() => {})
          },
        },
      )
      const rows = mapDispatchResults(platforms, results) as DispatchResultRow[]
      await this.writeDispatchReceipt(task.operationId, task.itemId, rows)
    } finally {
      // 页面已读取时这里只剩 no-op;页面尚未打开时由 activeSyncState 承接终态
      await this.presentation.clear(syncId)
    }
  }

  private async writeDispatchReceipt(operationId: string, itemId: string, results: DispatchResultRow[]): Promise<void> {
    await this.transport.request('receipt', { payload: { operationId, itemId, results } })
  }
}
