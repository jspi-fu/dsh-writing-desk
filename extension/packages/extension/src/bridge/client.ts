/**
 * 本地助手 NM Client(ADR 0012)——连接 app.dswritesync.plugin。
 *
 * BridgeClient 是薄装配:三个深模块在这里组合,本文件只保留调用方
 * (background/index.ts)依赖的接口面与收录/目录 API:
 * - transport.ts:NM 传输(短请求/长端口/事件订阅/状态)
 * - delivery.ts:任务投递管线(tasks → claim → 分片 → performSync → 回执)
 * - task-presentation.ts:任务呈现(pendingSyncTask 契约与同步窗口)
 *
 * 通道事实(ADR 0012):
 * - 短请求:sendNativeMessage,按请求起一个助手短进程,失败时 lastError 供设置页展示
 * - 长端口:面板/对话框页打开期间 connectNative,近实时推 task-available 并回推
 *   capture-result;心跳消息顺带保活 MV3 SW
 * - SW 休眠期:chrome.alarms(30s 下限)一次性拉,投递最坏 30 秒到达
 * - 大文章:任务只下元数据,正文与图片按 ≤900KB 分片拉取,单分片失败重试
 */
import { generateSyncId, performSync } from '../background/sync-service'
import {
  chromeNativeMessagingHost,
  NativeTransport,
  type BridgeStatus,
  type NativeMessagingHost,
} from './transport'
import { DeliveryPipeline } from './delivery'
import { TaskPresenter } from './task-presentation'

/** 工作台目录（desk.catalog 的 payload）。 */
export interface DeskCatalog {
  at: string
  tags: string[]
  urls: Record<string, string>
}

/** 收录请求（desk.capture 的 payload）。 */
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

/** 收录结果:queued 表示已原子落 inbox;DSH 关闭时 dshActive=false,启动后出现在灵感墙。 */
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

export type { BridgeStatus }

export interface BridgeClientDeps {
  /** NM host 面;默认 chrome.runtime,测试注入假 host(transport.ts 的缝)。 */
  host?: NativeMessagingHost
  /** 投递管线依赖;默认 sync-service 实现,测试注入假件。 */
  performSync?: typeof performSync
  generateSyncId?: () => string
}

export class BridgeClient {
  private readonly transport: NativeTransport
  private readonly delivery: DeliveryPipeline

  constructor(deps: BridgeClientDeps = {}) {
    this.transport = new NativeTransport(deps.host ?? chromeNativeMessagingHost)
    this.delivery = new DeliveryPipeline({
      transport: this.transport,
      performSync: deps.performSync ?? performSync,
      generateSyncId: deps.generateSyncId ?? generateSyncId,
      presentation: new TaskPresenter(),
    })
    // 长端口事件 → 业务:任务事件踢投递管线,收录结果转发给页面
    this.transport.onTaskAvailable(() => {
      void this.delivery.processPendingTasks()
    })
    this.transport.onCaptureResult(payload => {
      chrome.runtime.sendMessage({ type: 'BRIDGE_CAPTURE_RESULT', payload }).catch(() => {})
    })
  }

  /** 最近一次错误,供设置页展示。 */
  getLastError(): string | null {
    return this.transport.getLastError()
  }

  /** 长端口是否开着(面板/对话框打开期间为真)。 */
  isConnected(): boolean {
    return this.transport.isConnected()
  }

  /** 连接状态(paired/connected/dshActive/lastError)。 */
  getStatus(): Promise<BridgeStatus> {
    return this.transport.getStatus()
  }

  /** 页面要近实时推送时调用(设置页/AppShell 挂载);引用计数,归零断开端口。 */
  setActivelyWatched(active: boolean): void {
    this.transport.setWatched(active)
  }

  /** 拉取并处理待投递任务;alarm/长端口事件/页面打开都会触发,内部串行化。 */
  processPendingTasks(): Promise<void> {
    return this.delivery.processPendingTasks()
  }

  normalizeCatalog(payload: Record<string, unknown>): DeskCatalog {
    const tags = Array.isArray(payload.tags)
      ? payload.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    const rawUrls = payload.urls
    const urls: Record<string, string> = {}
    if (rawUrls !== null && typeof rawUrls === 'object' && !Array.isArray(rawUrls)) {
      for (const [url, itemId] of Object.entries(rawUrls)) {
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
    const response = await this.transport.request<Record<string, unknown>>('catalog')
    return this.normalizeCatalog(response)
  }

  /**
   * 提交收录:助手原子写 inbox 即刻持久化,ack(queued) 即成功。DSH 关闭时
   * dshActive=false,由页面提示「DSH 启动后出现在灵感墙」;最终消化结果经
   * capture-result 事件回推。NM 不可用时直接抛错,调用方降级为复制 Markdown。
   */
  async saveCapture(payload: CapturePayload): Promise<CaptureResult> {
    const operationId = typeof payload.operationId === 'string' && payload.operationId.trim()
      ? payload.operationId.trim()
      : generateId('capture')
    const response = await this.transport.request<Record<string, unknown>>('capture', { ...(payload as unknown as Record<string, unknown>), operationId })
    return {
      operationId: typeof response.operationId === 'string' ? response.operationId : operationId,
      ok: true,
      queued: true,
      dshActive: response.dshActive === true,
    }
  }
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// 单例
export const bridgeClient = new BridgeClient()

/** SW 启动时踢一次任务拉取(alarm 之外的第一拍)。 */
export function startBridgeClient(): void {
  void bridgeClient.processPendingTasks()
}

export async function getBridgeStatus(): Promise<BridgeStatus> {
  return bridgeClient.getStatus()
}
