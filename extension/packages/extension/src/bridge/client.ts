/**
 * 本地服务 WebSocket Client - 连接 dswritesync serve
 */
import {
  checkAllPlatformsAuth,
  checkPlatformAuth,
  getAdapter,
} from '../adapters'
import { markdownToHtml } from '@wechatsync/core'
import { createLogger } from '../lib/logger'
import { t } from '../lib/i18n'
import { generateSyncId, performSync } from '../background/sync-service'

const logger = createLogger('BridgeClient')

// 消息类型
interface ResponseMessage {
  id: string
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

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

/** 工作台回执（desk.capture-result 的 payload）。 */
export interface CaptureResult {
  operationId: string
  ok: boolean
  itemId?: string
  error?: string
  duplicate?: boolean
  replaced?: boolean
}

interface PendingRequest<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// 分片上传会话
interface PendingUpload {
  chunks: Map<number, string>  // chunkIndex -> data
  totalChunks: number
  mimeType: string
  platform: string
  createdAt: number
  timeoutId: ReturnType<typeof setTimeout>
}

const DEFAULT_SERVER_URL = 'ws://127.0.0.1:9527'
const CATALOG_TIMEOUT_MS = 10_000
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
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private serverUrl = DEFAULT_SERVER_URL

  // 安全验证 token
  private token: string | null = null

  // Desk 协议 v1 握手状态
  private authenticated = false
  private lastError: string | null = null

  // 等待工作台回执的请求
  private pendingCatalogRequests = new Map<string, PendingRequest<DeskCatalog>>()
  private pendingCaptureRequests = new Map<string, PendingRequest<CaptureResult>>()

  // 温热/冷却双阶段重连配置
  private reconnectAttempts = 0
  private lastConnectedAt = 0 // 上次成功连接的时间戳
  private activelyWatched = false // 用户正在查看设置页
  private readonly WARM_WINDOW = 5 * 60 * 1000 // 5 分钟内视为温热
  // 温热阶段：刚断开，快速重连
  private readonly warmMinInterval = 500   // 500ms
  private readonly warmMaxInterval = 5000  // 5s 封顶
  // 冷却阶段：长时间未连接，减少资源消耗
  private readonly coldMinInterval = 10000 // 10s
  private readonly coldMaxInterval = 60000 // 60s 封顶
  private readonly maxReconnectAttempts = Infinity // bridgeEnabled=true 时永远重试

  // 分片上传管理
  private pendingUploads = new Map<string, PendingUpload>()
  private readonly UPLOAD_TIMEOUT = 60000  // 60 秒超时
  private readonly MAX_CONCURRENT_UPLOADS = 5  // 最大并发上传数

  /**
   * 设置安全验证 token
   */
  setToken(token: string): void {
    this.token = token.trim() || null
    this.lastError = null
    logger.debug('Token set')
  }

  /**
   * 清除 token
   */
  clearToken(): void {
    this.token = null
    this.authenticated = false
  }

  /**
   * 已完成 hello 握手（认证通过）
   */
  isAuthenticated(): boolean {
    return this.authenticated && this.isConnected()
  }

  /**
   * 最近一次连接/认证错误，供设置页展示
   */
  getLastError(): string | null {
    return this.lastError
  }

  /**
   * 设置服务器地址（支持远程桥接）
   */
  setServerUrl(url: string): void {
    this.serverUrl = url || DEFAULT_SERVER_URL
    logger.debug(`Server URL set to ${this.serverUrl}`)
  }

  /**
   * 获取当前服务器地址
   */
  getServerUrl(): string {
    return this.serverUrl
  }

  /**
   * 连接到本地 DSwritesync 服务（Desk 协议 v1）
   */
  connect(): void {
    if (!this.token) {
      this.lastError = t('未配置桥接 Token')
      return
    }

    // 清理旧连接
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        return
      }
      // 清理非 OPEN/CONNECTING 状态的连接
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      this.ws.onopen = null
      this.ws = null
    }

    this.authenticated = false
    logger.debug(`Connecting to ${this.serverUrl} (attempt ${this.reconnectAttempts + 1})`)

    try {
      this.ws = new WebSocket(this.serverUrl)

      this.ws.onopen = () => {
        logger.debug('Connected to local service, sending hello')
        // Desk 协议：首帧必须是 hello；认证后 token 不再逐条携带
        const hello = {
          kind: 'hello',
          token: this.token,
          version: chrome.runtime.getManifest().version,
          lang: navigator.language,
        }
        try {
          this.ws?.send(JSON.stringify(hello))
        } catch (error) {
          logger.error('Failed to send hello:', error)
        }
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data)
      }

      this.ws.onclose = (event) => {
        const wasAuthenticated = this.authenticated
        this.authenticated = false
        this.ws = null
        this.rejectPendingRequests(t('连接已断开'))

        // 缺 token / token 不匹配：等待用户在设置页更新 token 或地址，避免反复重试刷屏
        if (event.code === 4001 || event.code === 4003) {
          this.lastError = event.code === 4001
            ? t('本地服务未收到桥接 Token')
            : t('桥接 Token 与本地服务不匹配')
          logger.warn(`Desk handshake rejected (${event.code}); reconnect paused until token changes`)
          return
        }

        logger.debug(`Disconnected (code: ${event.code}, authenticated: ${wasAuthenticated}), scheduling reconnect...`)
        this.scheduleReconnect()
      }

      this.ws.onerror = () => {
        // error 事件后通常会触发 close，不需要在这里重连
        logger.debug('Connection error')
      }
    } catch (error) {
      logger.error('Connection failed:', error)
      this.ws = null
      this.scheduleReconnect()
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.reconnectAttempts = this.maxReconnectAttempts // 防止自动重连
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.authenticated = false
    this.rejectPendingRequests(t('连接已断开'))
    if (this.ws) {
      this.ws.onclose = null // 防止触发重连
      this.ws.close()
      this.ws = null
    }
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * 计划重连（指数退避）
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) return

    if (!this.token) {
      this.lastError = t('未配置桥接 Token')
      return
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.debug('Max reconnect attempts reached, stopping')
      return
    }

    // 只在本地服务启用时重连，避免无意义的后台重试消耗资源
    chrome.storage.local.get('bridgeEnabled').then(storage => {
      if (!storage.bridgeEnabled) {
        logger.debug('Bridge disabled, skip reconnect')
        return
      }
      this._doScheduleReconnect()
    }).catch(() => this._doScheduleReconnect())
  }

  private _doScheduleReconnect(): void {
    // 温热/冷却双阶段退避
    const timeSinceLastConnection = Date.now() - this.lastConnectedAt
    const isWarm = this.activelyWatched
      || (this.lastConnectedAt > 0 && timeSinceLastConnection < this.WARM_WINDOW)

    let interval: number
    if (isWarm) {
      // 温热：刚断开，server 可能在重启，快速重连
      // 500ms, 1s, 2s, 4s, 5s, 5s, ...
      interval = Math.min(
        this.warmMinInterval * Math.pow(2, this.reconnectAttempts),
        this.warmMaxInterval
      )
    } else {
      // 冷却：长时间未连接，server 可能没启动，慢速重试
      // 10s, 20s, 40s, 60s, 60s, ...
      interval = Math.min(
        this.coldMinInterval * Math.pow(2, this.reconnectAttempts),
        this.coldMaxInterval
      )
    }

    logger.debug(`Reconnecting in ${interval / 1000}s (${isWarm ? 'warm' : 'cold'})...`)

    this.reconnectAttempts++
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, interval)
  }

  /**
   * 设置用户是否正在关注连接状态（如打开设置页）
   * 关注时使用温热策略快速重连
   */
  setActivelyWatched(active: boolean): void {
    this.activelyWatched = active
    // 开始关注时，如果未连接，立即尝试重连
    if (active && !this.isConnected()) {
      this.reconnectAttempts = 0
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      this.connect()
    }
  }

  /**
   * 重置重连计数（供外部调用）
   */
  resetReconnect(): void {
    this.reconnectAttempts = 0
    if (!this.isConnected()) {
      this.connect()
    }
  }

  /**
   * 处理入站帧：
   * - Desk 协议帧：hello-ok / event / ack
   * - 上游请求帧：{id, method, params}（CLI 转发到扩展的调用）
   */
  private async handleMessage(data: string): Promise<void> {
    let message: any
    try {
      message = JSON.parse(data)
    } catch {
      logger.error('Failed to parse incoming frame')
      return
    }

    if (message?.kind === 'hello-ok') {
      this.authenticated = true
      this.lastError = null
      this.reconnectAttempts = 0
      this.lastConnectedAt = Date.now()
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      logger.debug(`Desk handshake complete (protocol v${message.version ?? '?'})`)
      return
    }

    if (message?.kind === 'event') {
      this.handleEventFrame(message)
      return
    }

    if (message?.kind === 'ack') {
      this.handleAckFrame(message)
      return
    }

    // 其余按上游请求帧处理（握手后不再逐条校验 token；握手前兼容旧协议）
    if (typeof message?.id !== 'string' || typeof message?.method !== 'string') {
      logger.debug('Ignoring unrecognized frame')
      return
    }
    logger.debug('Received request:', message.method)

    let result: unknown
    let error: { code: number; message: string } | undefined

    if (!this.authenticated) {
      if (!this.token) {
        error = {
          code: 401,
          message: 'Bridge token not configured',
        }
      } else if (message.token !== this.token) {
        logger.warn('Invalid token received')
        error = {
          code: 403,
          message: 'Invalid or missing token',
        }
      }
    }

    if (!error) {
      try {
        result = await this.handleMethod(message.method, message.params)
      } catch (e) {
        error = {
          code: -1,
          message: (e as Error).message,
        }
      }
    }

    const response: ResponseMessage = {
      id: message.id,
      result,
      error,
    }

    try {
      this.ws?.send(JSON.stringify(response))
    } catch (sendError) {
      logger.error('Failed to send response:', sendError)
    }
  }

  /**
   * 处理 CLI 推送的 desk.* 事件
   */
  private handleEventFrame(frame: { event?: string; id?: string; payload?: unknown }): void {
    const payload = isRecord(frame.payload) ? frame.payload : {}

    if (frame.event === 'desk.catalog') {
      const id = typeof frame.id === 'string' ? frame.id : ''
      const pending = this.pendingCatalogRequests.get(id)
      if (!pending) {
        logger.debug(`Unexpected desk.catalog event (id: ${id || 'none'})`)
        return
      }
      clearTimeout(pending.timeoutId)
      this.pendingCatalogRequests.delete(id)
      pending.resolve(this.normalizeCatalog(payload))
      return
    }

    if (frame.event === 'desk.capture-result') {
      const operationId = typeof payload.operationId === 'string' ? payload.operationId : ''
      const pending = this.pendingCaptureRequests.get(operationId)
      if (!pending) {
        logger.debug(`Capture result without pending request: ${operationId || 'none'}`)
        return
      }
      clearTimeout(pending.timeoutId)
      this.pendingCaptureRequests.delete(operationId)
      pending.resolve(this.toCaptureResult(operationId, payload))
      return
    }

    if (frame.event === 'desk.log') {
      const text = typeof payload.message === 'string' ? payload.message : ''
      if (!text) return
      const level = typeof payload.level === 'string' ? payload.level : 'info'
      if (level === 'error') logger.error(`[desk] ${text}`)
      else if (level === 'warn' || level === 'warning') logger.warn(`[desk] ${text}`)
      else logger.debug(`[desk] ${text}`)
      return
    }

    logger.debug(`Unhandled desk event: ${frame.event ?? 'unknown'}`)
  }

  /**
   * 处理 desk.capture 的入队 ack：ok:false 立即失败，queued 仍等 capture-result。
   */
  private handleAckFrame(frame: { id?: string; ok?: boolean; operationId?: string; error?: unknown }): void {
    const operationId = typeof frame.operationId === 'string'
      ? frame.operationId
      : (typeof frame.id === 'string' ? frame.id : '')
    const pending = this.pendingCaptureRequests.get(operationId)
    if (!pending) return

    if (frame.ok === false) {
      clearTimeout(pending.timeoutId)
      this.pendingCaptureRequests.delete(operationId)
      pending.resolve({
        operationId,
        ok: false,
        error: typeof frame.error === 'string' && frame.error ? frame.error : t('工作台拒绝了收进请求'),
      })
      return
    }

    logger.debug(`Capture queued: ${operationId}`)
  }

  private normalizeCatalog(payload: Record<string, unknown>): DeskCatalog {
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

  private toCaptureResult(operationId: string, payload: Record<string, unknown>): CaptureResult {
    const result: CaptureResult = { operationId, ok: payload.ok === true }
    if (typeof payload.itemId === 'string') result.itemId = payload.itemId
    if (typeof payload.error === 'string') result.error = payload.error
    if (payload.duplicate === true) result.duplicate = true
    if (payload.replaced === true) result.replaced = true
    return result
  }

  private rejectPendingRequests(reason: string): void {
    for (const pending of this.pendingCatalogRequests.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error(reason))
    }
    this.pendingCatalogRequests.clear()
    for (const pending of this.pendingCaptureRequests.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(new Error(reason))
    }
    this.pendingCaptureRequests.clear()
  }

  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  /**
   * 向工作台推送 desk.* 事件（需已认证）。
   */
  sendEvent(event: string, payload?: unknown, id?: string): boolean {
    if (!this.isAuthenticated()) return false
    const frame: Record<string, unknown> = { kind: 'event', event }
    if (id) frame.id = id
    if (payload !== undefined) frame.payload = payload
    try {
      this.ws!.send(JSON.stringify(frame))
      return true
    } catch (error) {
      logger.error('Failed to send event:', error)
      return false
    }
  }

  /**
   * 请求工作台标签 / URL 目录；按帧 id 匹配 desk.catalog。
   */
  getCatalog(): Promise<DeskCatalog> {
    if (!this.isAuthenticated()) return Promise.reject(new Error(t('未连接到工作台')))

    const id = this.generateId('catalog')
    return new Promise<DeskCatalog>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingCatalogRequests.delete(id)
        reject(new Error(t('请求工作台目录超时')))
      }, CATALOG_TIMEOUT_MS)

      this.pendingCatalogRequests.set(id, { resolve, reject, timeoutId })

      if (!this.sendEvent('desk.catalog-request', undefined, id)) {
        clearTimeout(timeoutId)
        this.pendingCatalogRequests.delete(id)
        reject(new Error(t('未连接到工作台')))
      }
    })
  }

  /**
   * 提交收进请求；ack.queued 只表示入队，最终结果以 capture-result 为准。
   */
  saveCapture(payload: CapturePayload): Promise<CaptureResult> {
    if (!this.isAuthenticated()) return Promise.reject(new Error(t('未连接到工作台')))

    const operationId = typeof payload.operationId === 'string' && payload.operationId.trim()
      ? payload.operationId.trim()
      : this.generateId('capture')
    const framePayload = { ...payload, operationId }

    // 同一 operationId 重发时，旧等待作废，避免两个超时器互删
    const existing = this.pendingCaptureRequests.get(operationId)
    if (existing) {
      clearTimeout(existing.timeoutId)
      this.pendingCaptureRequests.delete(operationId)
      existing.reject(new Error(t('收进请求已重新提交')))
    }

    return new Promise<CaptureResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingCaptureRequests.delete(operationId)
        reject(new Error(t('等待工作台回执超时')))
      }, CAPTURE_TIMEOUT_MS)

      this.pendingCaptureRequests.set(operationId, { resolve, reject, timeoutId })

      if (!this.sendEvent('desk.capture', framePayload, operationId)) {
        clearTimeout(timeoutId)
        this.pendingCaptureRequests.delete(operationId)
        reject(new Error(t('未连接到工作台')))
      }
    })
  }

  /**
   * 处理具体方法调用
   */
  private async handleMethod(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    switch (method) {
      case 'listPlatforms': {
        const forceRefresh = (params?.forceRefresh as boolean) ?? false
        return await checkAllPlatformsAuth(forceRefresh)
      }

      case 'checkAuth': {
        const platform = params?.platform as string
        if (!platform) throw new Error('Missing platform parameter')
        return await checkPlatformAuth(platform)
      }

      case 'syncArticle': {
        const platforms = params?.platforms as string[]
        const articleData = params?.article as {
          title: string
          content?: string
          markdown?: string
          cover?: string
        }

        if (!platforms?.length) throw new Error('Missing platforms parameter')
        if (!articleData?.title) throw new Error('Missing article title')
        if (!articleData?.markdown && !articleData?.content) {
          throw new Error('Missing article content (markdown or content required)')
        }

        // 工作台投递元数据（可选）：operationId / itemId / 标题，用于同步页提示与回执关联
        const desk = isRecord(params?.desk) ? params.desk : null
        const deskOperationId = optionalString(desk?.operationId)
        const deskItemId = optionalString(desk?.itemId)
        const deskTitle = optionalString(desk?.title)

        // 复用调用方给的 syncId，保证进度消息能回到同一个页面
        const syncId = optionalString(params?.syncId) || generateSyncId()

        // 优先使用 markdown，转换为 HTML
        let htmlContent = articleData.content || ''
        const markdown = articleData.markdown || ''

        if (markdown) {
          try {
            htmlContent = markdownToHtml(markdown)
          } catch (e) {
            logger.error('Markdown conversion failed:', e)
            // 如果转换失败，使用简单的换行处理
            htmlContent = markdown.replace(/\n/g, '<br>')
          }
        }

        const article = {
          title: articleData.title,
          content: htmlContent,
          html: htmlContent,
          markdown: markdown,
          cover: articleData.cover,
        }

        // performSync 前把任务写给同步页：侧栏已开则只写 storage（页面自行恢复），
        // 否则打开 396x560 同步窗口。失败不阻断同步。
        try {
          const pendingTask: PendingSyncTask = {
            ...(deskOperationId ? { operationId: deskOperationId } : {}),
            ...(deskItemId ? { itemId: deskItemId } : {}),
            title: deskTitle || articleData.title,
            platforms,
            article: {
              title: articleData.title,
              markdown: markdown || undefined,
              content: htmlContent,
              cover: articleData.cover,
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
          // 使用 sync-service 进行同步（支持 DSL 平台 + CMS 账户、历史记录、状态保存）
          const { results, syncId: completedSyncId } = await performSync(
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
            }
          )

          return { results, syncId: completedSyncId }
        } finally {
          // 页面已读取时这里只剩 no-op；页面尚未打开时由 activeSyncState 承接终态
          await clearPendingSyncTask(syncId)
        }
      }

      case 'extractArticle': {
        // 从当前活动 tab 提取文章（通过 content script 消息通道）
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        if (!tabs[0]?.id) throw new Error('No active tab found')
        const tabId = tabs[0].id

        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_ARTICLE' })
          return response?.article || null
        } catch {
          // content script 未加载，尝试注入后重试
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['reader.js', 'Readability.js'],
          })
          // 注入 extractor content script
          const manifest = chrome.runtime.getManifest()
          const extractorScript = manifest.content_scripts
            ?.flatMap(cs => cs.js || [])
            .find(js => js.includes('extractor'))
          if (extractorScript) {
            await chrome.scripting.executeScript({
              target: { tabId },
              files: [extractorScript],
            })
          }
          const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_ARTICLE' })
          return response?.article || null
        }
      }

      case 'uploadImage': {
        const imageData = params?.imageData as string
        const mimeType = params?.mimeType as string
        const platform = (params?.platform as string) || 'weibo'

        if (!imageData) throw new Error('Missing imageData parameter')
        if (!mimeType) throw new Error('Missing mimeType parameter')

        return await this.performImageUpload(imageData, mimeType, platform)
      }

      // 分片上传：开始会话
      case 'uploadImage:start': {
        const uploadId = params?.uploadId as string
        const totalChunks = params?.totalChunks as number
        const mimeType = params?.mimeType as string
        const platform = (params?.platform as string) || 'weibo'

        if (!uploadId) throw new Error('Missing uploadId')
        if (!totalChunks) throw new Error('Missing totalChunks')
        if (!mimeType) throw new Error('Missing mimeType')

        // 检查并发上传数
        if (this.pendingUploads.size >= this.MAX_CONCURRENT_UPLOADS) {
          throw new Error(`Too many concurrent uploads (max: ${this.MAX_CONCURRENT_UPLOADS})`)
        }

        // 设置超时清理
        const timeoutId = setTimeout(() => {
          this.cleanupUpload(uploadId, 'timeout')
        }, this.UPLOAD_TIMEOUT)

        // 创建上传会话
        this.pendingUploads.set(uploadId, {
          chunks: new Map(),
          totalChunks,
          mimeType,
          platform,
          createdAt: Date.now(),
          timeoutId,
        })

        logger.debug(`Chunked upload started: ${uploadId}, ${totalChunks} chunks`)
        return { success: true }
      }

      // 分片上传：接收分片
      case 'uploadImage:chunk': {
        const uploadId = params?.uploadId as string
        const chunkIndex = params?.chunkIndex as number
        const data = params?.data as string

        if (!uploadId) throw new Error('Missing uploadId')
        if (chunkIndex === undefined) throw new Error('Missing chunkIndex')
        if (!data) throw new Error('Missing chunk data')

        const upload = this.pendingUploads.get(uploadId)
        if (!upload) {
          throw new Error(`Upload session not found: ${uploadId}`)
        }

        // 存储分片
        upload.chunks.set(chunkIndex, data)
        logger.debug(`Chunk received: ${uploadId} [${chunkIndex + 1}/${upload.totalChunks}]`)

        return { success: true, received: upload.chunks.size, total: upload.totalChunks }
      }

      // 分片上传：完成并上传
      case 'uploadImage:complete': {
        const uploadId = params?.uploadId as string

        if (!uploadId) throw new Error('Missing uploadId')

        const upload = this.pendingUploads.get(uploadId)
        if (!upload) {
          throw new Error(`Upload session not found: ${uploadId}`)
        }

        // 检查是否所有分片都已接收
        if (upload.chunks.size !== upload.totalChunks) {
          throw new Error(`Incomplete upload: received ${upload.chunks.size}/${upload.totalChunks} chunks`)
        }

        // 合并分片
        const sortedChunks: string[] = []
        for (let i = 0; i < upload.totalChunks; i++) {
          const chunk = upload.chunks.get(i)
          if (!chunk) {
            throw new Error(`Missing chunk ${i}`)
          }
          sortedChunks.push(chunk)
        }
        const imageData = sortedChunks.join('')

        logger.debug(`Chunks merged: ${uploadId}, total size: ${imageData.length}`)

        // 清理会话
        this.cleanupUpload(uploadId, 'completed')

        // 执行实际上传
        return await this.performImageUpload(imageData, upload.mimeType, upload.platform)
      }

      default:
        throw new Error(`Unknown method: ${method}`)
    }
  }

  /**
   * 执行图片上传
   * 将 base64 转为 Blob，使用统一的 uploadImage 方法
   */
  private async performImageUpload(
    imageData: string,
    mimeType: string,
    platform: string
  ): Promise<{ url: string; platform: string }> {
    // 获取适配器
    const adapter = await getAdapter(platform)
    if (!adapter) {
      throw new Error(`Platform not found: ${platform}`)
    }

    // 检查适配器是否支持图片上传
    if (typeof adapter.uploadImage !== 'function') {
      throw new Error(`Platform ${platform} does not support image upload`)
    }

    // base64 转 Blob
    const binaryStr = atob(imageData)
    const bytes = new Uint8Array(binaryStr.length)
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i)
    }
    const blob = new Blob([bytes], { type: mimeType })

    // 调用统一的 uploadImage 接口
    const url = await adapter.uploadImage(blob)
    return { url, platform }
  }

  /**
   * 清理上传会话
   */
  private cleanupUpload(uploadId: string, reason: 'completed' | 'timeout' | 'error'): void {
    const upload = this.pendingUploads.get(uploadId)
    if (upload) {
      clearTimeout(upload.timeoutId)
      // 清理 chunks 以释放内存
      upload.chunks.clear()
      this.pendingUploads.delete(uploadId)
      logger.debug(`Upload cleanup: ${uploadId} (${reason})`)
    }
  }
}

// 单例
export const bridgeClient = new BridgeClient()

// 启动连接（在 background 中调用）
export function startBridgeClient(): void {
  bridgeClient.resetReconnect()
}

// 停止连接
export function stopBridgeClient(): void {
  bridgeClient.disconnect()
}

// 获取连接状态
export function getBridgeStatus(): { connected: boolean; serverUrl: string; lastError: string | null } {
  return {
    connected: bridgeClient.isAuthenticated(),
    serverUrl: bridgeClient.getServerUrl(),
    lastError: bridgeClient.getLastError(),
  }
}
