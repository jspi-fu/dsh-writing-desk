/**
 * NM 传输模块(ADR 0012):chrome Native Messaging 的机制细节收拢在一个深模块里。
 * 接口 = 短请求 request / 长端口开闭 setWatched + isConnected / 事件订阅
 * (task-available、capture-result)/ getStatus / lastError;超时兜底、错误翻译、
 * 断线重连计时、connect 握手帧、心跳忽略全部藏在实现内。
 *
 * 缝:NM host 面(sendNativeMessage/connectNative/lastError)由构造注入——
 * 生产适配器读 chrome.runtime,测试注入假 host(NativeHandler 形状),两个
 * 适配器构成真缝,传输行为全部走接口可测,不必戳私有字段。
 */
import { createLogger } from '../lib/logger'
import { t } from '../lib/i18n'
import { HOST_NAME } from './protocol'

const logger = createLogger('NMTransport')

const REQUEST_TIMEOUT_MS = 15_000
const STATUS_CACHE_MS = 5_000
const PORT_RETRY_MS = 5_000

/** 连接状态:paired = NM 通路可用;connected = 长端口已开;lastError 供排障。 */
export interface BridgeStatus {
  paired: boolean
  connected: boolean
  dshActive: boolean
  lastError: string | null
}

/**
 * NM host 面:chrome.runtime 上与 NM 有关的三个触点。lastError 只在回调
 * 存续期有效(chrome 约定),所以是函数而不是值,由传输层在回调里就地读取。
 */
export interface NativeMessagingHost {
  sendNativeMessage(
    hostName: string,
    message: Record<string, unknown>,
    callback: (response?: unknown) => void,
  ): void
  connectNative(hostName: string): chrome.runtime.Port
  lastError(): string | undefined
}

/** 生产适配器:每次调用都现读 chrome.runtime,测试替换 chrome mock 即生效。 */
export const chromeNativeMessagingHost: NativeMessagingHost = {
  sendNativeMessage(hostName, message, callback) {
    chrome.runtime.sendNativeMessage(hostName, message, callback)
  },
  connectNative(hostName) {
    return chrome.runtime.connectNative(hostName)
  },
  lastError() {
    return chrome.runtime.lastError?.message
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Chrome 的 NM 通道错误统一翻成可读文案,设置页与收录降级都靠它。 */
function nativeErrorText(message: string): string {
  if (/Error when communicating with the native messaging host/i.test(message)) {
    return t('未配对：本地助手未注册或 Node.js 缺失，重启一次 DeepSeek Harness')
  }
  if (/Native host has exited/i.test(message)) {
    return t('本地助手中途退出，请查看投递箱目录里的 helper.log')
  }
  return message
}

export class NativeTransport {
  private readonly host: NativeMessagingHost
  private port: chrome.runtime.Port | null = null
  private portRetryTimer: ReturnType<typeof setTimeout> | null = null
  private watchers = 0
  private lastError: string | null = null
  private lastDshActive = false
  private statusCache: { at: number; status: BridgeStatus } | null = null
  private taskAvailableHandler: (() => void) | null = null
  private captureResultHandler: ((payload: Record<string, unknown>) => void) | null = null

  constructor(host: NativeMessagingHost = chromeNativeMessagingHost) {
    this.host = host
  }

  // ============ 事件订阅(长端口帧) ============

  /** task-available:助手 outbox 有新任务(投递管线订阅)。 */
  onTaskAvailable(handler: () => void): void {
    this.taskAvailableHandler = handler
  }

  /** capture-result:收录的最终消化结果,payload 原样交给订阅者转发给页面。 */
  onCaptureResult(handler: (payload: Record<string, unknown>) => void): void {
    this.captureResultHandler = handler
  }

  /**
   * 短请求:按请求起一个助手进程。sendNativeMessage 没有内建超时,这里自己兜,
   * 超时按未配对处理,避免设置页状态永远转圈。
   */
  request<T>(method: string, params?: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        this.lastError = t('本地助手没有回应(超时)')
        reject(new Error(this.lastError))
      }, timeoutMs)
      try {
        this.host.sendNativeMessage(HOST_NAME, { method, ...(params ? { params } : {}) }, response => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          const error = this.host.lastError()
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
  setWatched(active: boolean): void {
    this.watchers = Math.max(0, this.watchers + (active ? 1 : -1))
    if (active && this.watchers === 1) this.connectPort()
    if (!active && this.watchers === 0) this.disconnectPort()
  }

  private connectPort(): void {
    if (this.port || this.portRetryTimer) return
    try {
      const port = this.host.connectNative(HOST_NAME)
      port.onMessage.addListener(message => this.handlePortMessage(message))
      port.onDisconnect.addListener(() => {
        this.port = null
        const error = this.host.lastError()
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
      // 助手只在收到 connect 握手后才进入长端口模式(推事件帧);短请求
      // (sendNativeMessage)永远只回响应,首帧即答案
      port.postMessage({ method: 'connect' })
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
      this.taskAvailableHandler?.()
      return
    }
    if (message.event === 'capture-result') {
      const payload = isRecord(message.payload) ? message.payload : {}
      this.captureResultHandler?.(payload)
      return
    }
    if (message.event === 'heartbeat') {
      // 心跳帧顺带携带 dshActive(协议向后兼容,旧助手无此字段):端口打开期间
      // getStatus 走短路,不更新它 dshActive 就永远停在端口打开前的旧值
      if (message.dshActive === true || message.dshActive === false) {
        this.lastDshActive = message.dshActive as boolean
      }
      return
    }
    logger.debug('NM port frame:', String(message.event ?? 'unknown'))
  }
}
