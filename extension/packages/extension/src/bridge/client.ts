/**
 * 本地助手 NM Client(ADR 0012)——连接 app.dswritesync.plugin。
 *
 * 通道是 Native Messaging,不再有 WS/token/端口:
 * - 短请求:`sendNativeMessage`,按请求起一个助手短进程(capture/catalog/tasks/claim/
 *   content/receipt/status),失败时 lastError 供设置页展示。
 * - 长端口:面板/对话框页打开期间 `connectNative`,助手 fs.watch outbox(1s 轮询兜底)
 *   近实时推 task-available,并回推 capture-result;心跳消息顺带保活 MV3 SW。
 * - SW 休眠期:chrome.alarms(30s 下限)一次性拉,投递最坏 30 秒到达。
 * - 大文章:任务只下元数据,正文与图片按 ≤900KB 分片拉取,单分片失败重试。
 */
import { markdownToHtml } from '@wechatsync/core'
import { createLogger } from '../lib/logger'
import { t } from '../lib/i18n'
import { generateSyncId, performSync } from '../background/sync-service'
import {
  HOST_NAME,
  assembleShards,
  decodeUtf8,
  inlineImageRefs,
  mapDispatchResults,
  type ContentResponse,
  type DispatchResultRow,
  type TaskMeta,
} from './protocol'

const logger = createLogger('BridgeClient')

/** 工作台目录（desk.catalog 的 payload）。 */
export interface DeskCatalog {
  at: string
  tags: string[]
  urls: Record<string, string>
}

/** 收进请求（desk.capture 的 payload）。 */
export interface CapturePayload {
  operationId?: string
  url: string
  title: string
  body: string
  siteName?: string
  tags?: string[]
  cover?: string
  captureMethod?: string
  truncated?: boolean
  replaceItemId?: string
}

/** 收进结果:queued 表示已原子落 inbox;DSH 关闭时 dshActive=false,启动后出现在灵感墙。 */
export interface CaptureResult {
  operationId: string
  ok: boolean
  queued?: boolean
  itemId?: string
  error?: string
  duplicate?: boolean
  replaced?: boolean
  dshActive?: boolean
}

/** 连接状态:paired = NM 通路可用;connected = 长端口已开;lastError 供排障。 */
export interface BridgeStatus {
  paired: boolean
  connected: boolean
  dshActive: boolean
  lastError: string | null
}

const REQUEST_TIMEOUT_MS = 15_000
const STATUS_CACHE_MS = 5_000
const PORT_RETRY_MS = 5_000
const SHARD_RETRIES = 2
const CAPTURE_TIMEOUT_MS = 90_000

const PENDING_SYNC_TASK_KEY = 'pendingSyncTask'
const SYNC_TASK_WINDOW_WIDTH = 396
const SYNC_TASK_WINDOW_HEIGHT = 560

// 工作台投递的同步任务：performSync 前写入 storage，供同步页恢复
interface PendingSyncTask {
  operationId?: string
  itemId?: string
  title: string
  platforms: string[]
  article: {
    title: string
    markdown?: string
    content?: string
    cover?: string
  }
  syncId: string
  at: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

type ExtensionContextInfo = { contextType: string; documentUrl?: string }

/**
 * 是否已有扩展页面（侧栏或同步窗口）打开。HashRouter 的 hash 不参与
 * getContexts 的精确 URL 过滤，因此先取上下文再按 documentUrl 判断，
 * 避免侧栏开在 /capture 时误判为“没有页面”而重复开窗。
 */
async function hasOpenExtensionPage(): Promise<boolean> {
  const runtime = chrome.runtime as unknown as {
    getContexts?: (filter: {
      contextTypes?: string[]
    }) => Promise<ExtensionContextInfo[]>
  }
  if (typeof runtime.getContexts !== 'function') return false
  try {
    const contexts = await runtime.getContexts({
      contextTypes: ['SIDE_PANEL', 'TAB', 'POPUP'],
    })
    return contexts.some(context =>
      typeof context.documentUrl === 'string'
      && context.documentUrl.includes('src/popup/index.html'))
  } catch {
    return false
  }
}

/**
 * pendingSyncTask 已写入 storage：有已打开的同步页就通知它重读，
 * 否则开一个 396x560 的同步任务窗口。打开失败不影响同步本身。
 */
async function presentSyncTask(): Promise<void> {
  if (await hasOpenExtensionPage()) {
    // The side panel/tab may be on Capture or another route. Navigate it to
    // Sync so its mount recovers pendingSyncTask; the queued message covers the
    // case where the Sync route is already mounted.
    chrome.runtime.sendMessage({ type: 'PANEL_NAVIGATE', path: '/sync' }).catch(() => {})
    chrome.runtime.sendMessage({ type: 'SYNC_TASK_QUEUED' }).catch(() => {})
    return
  }

  const width = SYNC_TASK_WINDOW_WIDTH
  const height = SYNC_TASK_WINDOW_HEIGHT
  let left: number | undefined
  let top: number | undefined
  try {
    const currentWindow = await chrome.windows.getCurrent()
    if (typeof currentWindow.left === 'number' && typeof currentWindow.width === 'number') {
      left = Math.round(currentWindow.left + (currentWindow.width - width) / 2)
    }
    if (typeof currentWindow.top === 'number' && typeof currentWindow.height === 'number') {
      top = Math.round(currentWindow.top + (currentWindow.height - height) / 2)
    }
  } catch {
    // 拿不到窗口位置时交给浏览器决定
  }

  try {
    await chrome.windows.create({
      url: `${chrome.runtime.getURL('src/popup/index.html')}#/sync`,
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true,
    })
  } catch (error) {
    logger.warn('Failed to open sync task window:', error)
  }
}

// 只清理自己这个 syncId 的任务，避免并发投递时误删新任务
async function clearPendingSyncTask(syncId: string): Promise<void> {
  try {
    const storage = await chrome.storage.local.get(PENDING_SYNC_TASK_KEY)
    const current = storage[PENDING_SYNC_TASK_KEY] as { syncId?: unknown } | undefined
    if (current?.syncId === syncId) {
      await chrome.storage.local.remove(PENDING_SYNC_TASK_KEY)
    }
  } catch (error) {
    logger.debug('Failed to clear pending sync task:', error)
  }
}

class BridgeClient {
  private port: chrome.runtime.Port | null = null
  private portRetryTimer: ReturnType<typeof setTimeout> | null = null
  private watchers = 0
  private processing = false
  private lastError: string | null = null
  private lastDshActive = false
  private statusCache: { at: number; status: BridgeStatus } | null = null

  /**
   * 短请求:按请求起一个助手进程。sendNativeMessage 没有内建超时,这里自己兜,
   * 超时按未配对处理,避免设置页状态永远转圈。
   */
  private request<T>(method: string, params?: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.lastError = t('本地助手没有回应(超时)')
        reject(new Error(this.lastError))
      }, timeoutMs)
      try {
        chrome.runtime.sendNativeMessage(HOST_NAME, { method, ...(params ? { params } : {}) }, response => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const error = chrome.runtime.lastError?.message
          if (error) {
            this.lastError = nativeErrorText(error)
            reject(new Error(this.lastError))
            return
          }
          if (!isRecord(response)) {
            this.lastError = t('本地助手没有回应')
            reject(new Error(this.lastError))
            return
          }
          if (typeof response.error === 'string' && response.error) {
            this.lastError = response.error
            reject(new Error(response.error))
            return
          }
          this.lastError = null
          if (response.dshActive === true || response.dshActive === false) {
            this.lastDshActive = response.dshActive as boolean
          }
          resolve(response as T)
        })
      } catch (error) {
        settled = true
        clearTimeout(timer)
        this.lastError = (error as Error).message || String(error)
        reject(error instanceof Error ? error : new Error(this.lastError))
      }
    })
  }

  /** 最近一次错误,供设置页展示。 */
  getLastError(): string | null {
    return this.lastError
  }

  /** 长端口是否开着(面板/对话框打开期间为真)。 */
  isConnected(): boolean {
    return this.port !== null
  }

  /**
   * 连接状态(paired/connected/dshActive/lastError)。端口开着就是已配对;
   * 否则用短请求探一次(5s 缓存,避免设置页每 3 秒轮询都拉起短进程)。
   */
  async getStatus(): Promise<BridgeStatus> {
    if (this.port) {
      return { paired: true, connected: true, dshActive: this.lastDshActive, lastError: null }
    }
    const cached = this.statusCache
    if (cached && Date.now() - cached.at < STATUS_CACHE_MS) return cached.status
    let status: BridgeStatus
    try {
      const response = await this.request<{ dshActive?: boolean }>('status')
      status = { paired: true, connected: false, dshActive: response.dshActive === true, lastError: null }
    } catch (error) {
      status = { paired: false, connected: false, dshActive: false, lastError: (error as Error).message }
    }
    this.statusCache = { at: Date.now(), status }
    return status
  }

  // ============ 长端口(面板/对话框打开期间) ============

  /** 页面要近实时推送时调用(设置页/AppShell 挂载);引用计数,归零断开端口。 */
  setActivelyWatched(active: boolean): void {
    this.watchers = Math.max(0, this.watchers + (active ? 1 : -1))
    if (active && this.watchers === 1) this.connectPort()
    if (!active && this.watchers === 0) this.disconnectPort()
  }

  private connectPort(): void {
    if (this.port || this.portRetryTimer) return
    try {
      const port = chrome.runtime.connectNative(HOST_NAME)
      port.onMessage.addListener(message => this.handlePortMessage(message))
      port.onDisconnect.addListener(() => {
        this.port = null
        const error = chrome.runtime.lastError?.message
        if (error) this.lastError = nativeErrorText(error)
        logger.debug('NM port disconnected')
        // 面板还开着就重连(注册漂移自愈窗口里保持可用)
        if (this.watchers > 0) {
          this.portRetryTimer = setTimeout(() => {
            this.portRetryTimer = null
            this.connectPort()
          }, PORT_RETRY_MS)
        }
      })
      this.port = port
      this.lastError = null
      logger.debug('NM port connected')
    } catch (error) {
      this.lastError = (error as Error).message || String(error)
      logger.warn('NM port connect failed:', error)
    }
  }

  private disconnectPort(): void {
    if (this.portRetryTimer) {
      clearTimeout(this.portRetryTimer)
      this.portRetryTimer = null
    }
    if (!this.port) return
    const port = this.port
    this.port = null
    try {
      port.disconnect()
    } catch { /* 已经断开 */ }
  }

  private handlePortMessage(message: unknown): void {
    if (!isRecord(message)) return
    if (message.event === 'task-available') {
      void this.processPendingTasks()
      return
    }
    if (message.event === 'capture-result') {
      const payload = isRecord(message.payload) ? message.payload : {}
      chrome.runtime.sendMessage({ type: 'BRIDGE_CAPTURE_RESULT', payload }).catch(() => {})
      return
    }
    // heartbeat:保活 MV3 SW,业务上忽略
    logger.debug('NM port frame:', String(message.event ?? 'unknown'))
  }

  // ============ 收进 / 目录 ============

  normalizeCatalog(payload: Record<string, unknown>): DeskCatalog {
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    const urls: Record<string, string> = {}
    if (isRecord(payload.urls)) {
      for (const [url, itemId] of Object.entries(payload.urls)) {
        if (typeof itemId === 'string') urls[url] = itemId
      }
    }
    return {
      at: typeof payload.at === 'string' ? payload.at : new Date().toISOString(),
      tags,
      urls,
    }
  }

  /** 请求工作台标签 / URL 目录(助手读 catalog.json,缺失给空表)。 */
  async getCatalog(): Promise<DeskCatalog> {
    const response = await this.request<Record<string, unknown>>('catalog')
    return this.normalizeCatalog(response)
  }

  /**
   * 提交收进:助手原子写 inbox 即刻持久化,ack(queued) 即成功。DSH 关闭时
   * dshActive=false,由页面提示「DSH 启动后出现在灵感墙」;最终消化结果经
   * capture-result 事件回推。NM 不可用时直接抛错,调用方降级为复制 Markdown。
   */
  async saveCapture(payload: CapturePayload): Promise<CaptureResult> {
    const operationId = typeof payload.operationId === 'string' && payload.operationId.trim()
      ? payload.operationId.trim()
      : generateId('capture')
    const response = await this.request<Record<string, unknown>>('capture', { ...(payload as unknown as Record<string, unknown>), operationId })
    return {
      operationId: typeof response.operationId === 'string' ? response.operationId : operationId,
      ok: true,
      queued: true,
      dshActive: response.dshActive === true,
    }
  }

  // ============ outbox 任务:元数据 → 分片拉取 → performSync → 回执 ============

  /** 拉取并处理待投递任务;alarm/长端口事件/页面打开都会触发,内部串行化。 */
  async processPendingTasks(): Promise<void> {
    if (this.processing) return
    this.processing = true
    try {
      for (;;) {
        const response = await this.request<{ tasks?: unknown }>('tasks')
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

  /** 拉一个内容本体,单分片失败重试(SHARD_RETRIES 次),不静默截断。 */
  private async fetchBlob(operationId: string, name: string, shards: number): Promise<Uint8Array> {
    const parts: string[] = []
    for (let shard = 0; shard < shards; shard += 1) {
      let lastError: Error | null = null
      for (let attempt = 0; attempt <= SHARD_RETRIES; attempt += 1) {
        try {
          const response = await this.request<ContentResponse>('content', { operationId, name, shard })
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

  private async runTask(meta: TaskMeta): Promise<void> {
    const operationId = meta.operationId
    try {
      const claimed = await this.request<{ task?: TaskMeta }>('claim', { operationId })
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
      await this.writeDispatchReceipt(operationId, meta.itemId, [{ platform: '*', ok: false, error: message }]).catch(() => {})
    }
  }

  /** 任务下发:沿用 ADR 0010 的投递即弹对话框行为,落 pendingSyncTask 并执行同步。 */
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
    const syncId = generateSyncId()

    try {
      const pendingTask: PendingSyncTask = {
        ...(task.itemId ? { operationId: task.operationId } : {}),
        ...(task.itemId ? { itemId: task.itemId } : {}),
        title: task.title || article.title,
        platforms,
        article: {
          title: article.title,
          markdown,
          content: htmlContent,
        },
        syncId,
        at: Date.now(),
      }
      await chrome.storage.local.set({ [PENDING_SYNC_TASK_KEY]: pendingTask })
      await presentSyncTask()
    } catch (error) {
      logger.error('Failed to stage pending sync task:', error)
    }

    try {
      const { results } = await performSync(
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
      await clearPendingSyncTask(syncId)
    }
  }

  private async writeDispatchReceipt(operationId: string, itemId: string, results: DispatchResultRow[]): Promise<void> {
    await this.request('receipt', { payload: { operationId, itemId, results } })
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** Chrome 的 NM 通道错误统一翻成可读文案,设置页与收进降级都靠它。 */
function nativeErrorText(message: string): string {
  if (/Error when communicating with the native messaging host/i.test(message)) {
    return t('未配对:本地助手未注册或 Node.js 缺失,重启一次 DeepSeek Harness')
  }
  if (/Native host has exited/i.test(message)) {
    return t('本地助手中途退出,请查看投递箱目录里的 helper.log')
  }
  return message
}

// 单例
export const bridgeClient = new BridgeClient()

/** SW 启动时踢一次任务拉取(alarm 之外的第一拍)。 */
export function startBridgeClient(): void {
  void bridgeClient.processPendingTasks()
}

/** 页面全部关闭后由引用计数接管;保留导出兼容旧调用面。 */
export function stopBridgeClient(): void {
  bridgeClient.setActivelyWatched(false)
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  return bridgeClient.getStatus()
}

export const CAPTURE_WAIT_MS = CAPTURE_TIMEOUT_MS
