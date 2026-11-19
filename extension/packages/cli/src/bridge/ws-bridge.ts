/**
 * WebSocket Bridge - 与 Chrome Extension 通讯
 *
 * 支持多实例模式：
 * - 第一个实例启动 WebSocket 服务器 + HTTP API（PRIMARY）
 * - 后续实例通过 HTTP API 转发请求（SECONDARY）
 *
 * Desk 协议 v1（ADR 0010）：
 * - 扩展连上后首帧发 `{kind:'hello', token, version, lang}`，bridge 校验后回
 *   `{kind:'hello-ok', version}`；失败 close 4001（缺 token）/ 4003（不匹配）。
 * - 握手成功后请求/响应沿用上游 `{id, method, params?}` / `{id, result?, error?}`，
 *   token 不再逐条携带；入站帧里仍带 token 时忽略（兼容旧 per-request token）。
 * - 扩展主动事件 `{kind:'event', event:'desk.*', id?, payload?}` 交给 onEvent。
 * - HTTP `/request` 必须带 `Authorization: Bearer <token>`（或 body.token），否则 401。
 */
import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'
import { readFile } from 'fs/promises'
import { timingSafeEqual } from 'crypto'
import { homedir } from 'os'
import { join } from 'path'
import type { RequestMessage, ResponseMessage } from './types.js'

// WebSocket 状态常量 (readyState: 1 = OPEN)
const WS_OPEN = WebSocket.OPEN

/** Desk 协议版本（hello-ok.version） */
export const PROTOCOL_VERSION = 1

export interface BridgeOptions {
  /** 静默模式（CLI 使用时不输出日志） */
  silent?: boolean
  /** WebSocket 端口，默认 9527 */
  port?: number
  /** WebSocket 绑定地址，默认 127.0.0.1 */
  host?: string
  /** HTTP API 绑定地址，默认 127.0.0.1（只绑回环） */
  httpHost?: string
  /** HTTP API 端口，默认 port + 1 */
  httpPort?: number
  /** 期望 token；缺省时依次读 WECHATSYNC_TOKEN / auth.json */
  token?: string
  /** auth.json 路径，默认 ~/.dsh/writing-desk/bridge/auth.json */
  authFile?: string
  /** true 时端口被占用直接抛错（serve 用），不会降级为 secondary */
  requirePrimary?: boolean
}

export interface BridgeHelloInfo {
  version?: number | string
  lang?: string
}

export type DeskEventHandler = (event: string, payload: unknown, id?: string) => void | Promise<void>

/**
 * 默认 auth.json 路径（与宿主 src/bridge.js 的 bridgePaths 保持一致）。
 * @param env - 环境变量（测试可注入）。
 */
export function defaultAuthFile(env = process.env): string {
  return join(env.DSH_HOME || join(homedir(), '.dsh'), 'writing-desk', 'bridge', 'auth.json')
}

/** 常量时间比较 token。 */
function tokenEquals(a: string, b: string): boolean {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  return left.length === right.length && timingSafeEqual(left, right)
}

export class ExtensionBridge {
  private wss: WebSocketServer | null = null
  private httpServer: http.Server | null = null
  private client: WebSocket | null = null
  private clientInfo: BridgeHelloInfo | null = null
  private isServerMode = false
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()
  private requestTimeout = 360000 // 6 minutes (图片多时需要更长时间)
  private connectionResolvers: Array<() => void> = []

  private readonly host: string
  private readonly httpHost: string
  private readonly port: number
  private readonly httpPort: number
  private readonly requirePrimary: boolean
  private readonly authFile: string

  // 安全验证 token（构造参数 > 环境变量 > auth.json）
  private token: string
  private silent: boolean

  // Desk 事件回调
  private eventHandler: DeskEventHandler | null = null
  private connectHandler: ((info: BridgeHelloInfo) => void) | null = null
  private disconnectHandler: (() => void) | null = null

  constructor(portOrOptions: number | BridgeOptions = 9527, options: BridgeOptions = {}) {
    const opts: BridgeOptions = typeof portOrOptions === 'number'
      ? { ...options, port: portOrOptions }
      : portOrOptions
    this.port = opts.port ?? 9527
    this.host = opts.host ?? '127.0.0.1'
    // HTTP 只绑回环；即使 WS 允许其他地址，本机转发口也不外露。
    this.httpHost = opts.httpHost ?? '127.0.0.1'
    this.httpPort = opts.httpPort ?? this.port + 1
    this.token = opts.token ?? process.env.WECHATSYNC_TOKEN ?? ''
    this.authFile = opts.authFile ?? defaultAuthFile()
    this.requirePrimary = opts.requirePrimary ?? false
    this.silent = opts.silent ?? false
    if (!this.silent) {
      if (this.token) {
        console.error('[Bridge] Token authentication enabled')
      } else {
        console.error('[Bridge] Warning: no token configured; waiting for auth.json or env')
      }
    }
  }

  /** 注册扩展事件回调（desk.capture / desk.catalog-request / desk.log 等）。 */
  onEvent(handler: DeskEventHandler): void {
    this.eventHandler = handler
  }

  /** 注册握手成功回调。 */
  onConnect(handler: (info: BridgeHelloInfo) => void): void {
    this.connectHandler = handler
  }

  /** 注册已认证扩展断开回调。 */
  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler
  }

  /**
   * 启动服务 - 自动选择服务器模式或客户端模式
   */
  async start(): Promise<void> {
    this.token = await this.resolveToken()
    try {
      await this.startServer()
      this.isServerMode = true
      if (!this.silent) console.error(`[Bridge] Running as PRIMARY (WebSocket: ${this.host}:${this.port}, HTTP: ${this.httpHost}:${this.httpPort})`)
    } catch (error: unknown) {
      if (!this.requirePrimary && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        this.isServerMode = false
        this.stop()
        if (!this.silent) console.error(`[Bridge] Running as SECONDARY (forwarding to ${this.httpHost}:${this.httpPort})`)
      } else {
        this.stop()
        throw error
      }
    }
  }

  /** 构造参数没给 token 时，依次回退到环境变量与 auth.json。 */
  private async resolveToken(): Promise<string> {
    if (this.token) return this.token
    const envToken = process.env.WECHATSYNC_TOKEN
    if (envToken) return envToken
    try {
      const raw = JSON.parse(await readFile(this.authFile, 'utf8'))
      if (typeof raw?.token === 'string') return raw.token
    } catch { /* auth.json 尚未生成 */ }
    return ''
  }

  /**
   * 启动 WebSocket 服务器 + HTTP API
   */
  private startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        this.stop()
        reject(error)
      }
      try {
        this.wss = new WebSocketServer({ host: this.host, port: this.port })

        this.wss.once('error', fail)

        this.wss.on('listening', () => {
          if (settled) return
          if (!this.silent) console.error(`[Bridge] WebSocket server listening on ${this.host}:${this.port}`)
          // WebSocket 启动成功后，启动 HTTP API
          this.startHttpApi()
            .then(() => {
              if (settled) return
              settled = true
              const wss = this.wss
              if (wss) {
                wss.off('error', fail)
                wss.on('error', (error: Error) => {
                  if (!this.silent) console.error('[Bridge] WebSocket server error:', error.message)
                })
              }
              resolve()
            })
            .catch(fail)
        })

        this.wss.on('connection', (ws: WebSocket) => this.handleConnection(ws))
      } catch (error) {
        fail(error)
      }
    })
  }

  /**
   * 启动 HTTP API 服务器（供其他 CLI 实例 secondary 调用）
   */
  private startHttpApi(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

        if (req.method === 'OPTIONS') {
          res.writeHead(200)
          res.end()
          return
        }

        const sendJson = (status: number, body: Record<string, unknown>) => {
          res.writeHead(status, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(body))
        }

        if (req.method === 'GET' && req.url === '/status') {
          sendJson(200, {
            ok: true,
            connected: this.hasClient(),
            mode: 'primary',
            wsPort: this.port,
            httpPort: this.httpPort,
          })
          return
        }

        if (req.method === 'POST' && req.url === '/request') {
          const chunks: Buffer[] = []
          let size = 0
          let aborted = false
          req.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > 32 * 1024 * 1024) {
              aborted = true
              sendJson(413, { error: 'request body too large' })
              req.destroy()
              return
            }
            chunks.push(Buffer.from(chunk))
          })
          req.on('end', async () => {
            if (aborted) return
            const header = req.headers.authorization || ''
            const headerToken = header.startsWith('Bearer ') ? header.slice(7) : ''
            if (headerToken && !this.token) {
              sendJson(401, { error: 'unauthorized' })
              return
            }
            let body: { method?: unknown; params?: unknown; token?: unknown }
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              // 无有效 Bearer 时，坏 body 也按未授权处理，不泄露解析细节。
              const authorized = Boolean(headerToken && this.token && tokenEquals(headerToken, this.token))
              sendJson(authorized ? 400 : 401, { error: authorized ? 'invalid JSON body' : 'unauthorized' })
              return
            }
            const bodyToken = typeof body?.token === 'string' ? body.token : ''
            const supplied = headerToken || bodyToken
            if (!this.token || !supplied || !tokenEquals(supplied, this.token)) {
              sendJson(401, { error: 'unauthorized' })
              return
            }
            if (typeof body?.method !== 'string') {
              sendJson(400, { error: 'missing method' })
              return
            }
            try {
              const result = await this.requestInternal(body.method, body.params as Record<string, unknown> | undefined)
              sendJson(200, { ok: true, result })
            } catch (error) {
              sendJson(500, { ok: false, error: (error as Error).message })
            }
          })
          return
        }

        sendJson(404, { error: 'not found' })
      })

      const fail = (error: unknown) => {
        const server = this.httpServer
        this.httpServer = null
        if (server) {
          try { server.close() } catch { /* already closed */ }
        }
        reject(error)
      }
      this.httpServer.once('error', fail)
      this.httpServer.listen(this.httpPort, this.httpHost, () => {
        const server = this.httpServer
        if (!server) return
        server.off('error', fail)
        server.on('error', (error: Error) => {
          if (!this.silent) console.error('[Bridge] HTTP server error:', error.message)
        })
        if (!this.silent) console.error(`[Bridge] HTTP API listening on ${this.httpHost}:${this.httpPort}`)
        resolve()
      })
    })
  }

  /**
   * 停止服务器
   */
  stop(): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Bridge stopped'))
    }
    this.pendingRequests.clear()

    const client = this.client
    this.client = null
    this.clientInfo = null
    if (client) {
      try { client.close() } catch { /* already closed */ }
    }

    const wss = this.wss
    this.wss = null
    if (wss) {
      try { wss.close() } catch { /* already closed */ }
    }

    const httpServer = this.httpServer
    this.httpServer = null
    if (httpServer) {
      try { httpServer.close() } catch { /* already closed */ }
    }
  }

  /**
   * 获取当前运行模式
   */
  getMode(): 'primary' | 'secondary' {
    return this.isServerMode ? 'primary' : 'secondary'
  }

  /** 当前是否有已通过 hello 握手且连接打开的扩展。 */
  hasClient(): boolean {
    return this.client !== null && this.client.readyState === WS_OPEN
  }

  /**
   * 检查 Extension 是否已连接。
   * PRIMARY 直接看本进程连接；SECONDARY 异步查询 primary /status。
   */
  async isConnected(): Promise<boolean> {
    if (this.isServerMode) return this.hasClient()
    const health = await this.checkPrimaryHealth()
    return health.connected
  }

  /**
   * 等待 Extension 连接
   */
  waitForConnection(timeoutMs: number = 60000): Promise<void> {
    if (this.isServerMode) {
      // PRIMARY 模式：等待扩展 WebSocket 连接
      if (this.hasClient()) {
        return Promise.resolve()
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('timeout'))
        }, timeoutMs)

        this.connectionResolvers.push(() => {
          clearTimeout(timeout)
          resolve()
        })
      })
    } else {
      // SECONDARY 模式：轮询 PRIMARY 健康状态，PRIMARY 消失则尝试接管
      return new Promise((resolve, reject) => {
        const startTime = Date.now()
        const pollInterval = 2000
        let primaryReachable = false
        let promoting = false

        const poll = async () => {
          if (Date.now() - startTime > timeoutMs) {
            if (!primaryReachable) {
              reject(new Error('timeout:unreachable'))
            } else {
              reject(new Error('timeout:no_extension'))
            }
            return
          }

          const health = await this.checkPrimaryHealth()
          if (health.connected) {
            resolve()
            return
          }

          if (health.error?.includes('not reachable') && !promoting) {
            // PRIMARY 不可达 — 尝试接管端口
            promoting = true
            const promoted = await this.tryPromote()
            if (promoted) {
              // 成功接管，等待 Extension 直连
              const remaining = timeoutMs - (Date.now() - startTime)
              if (remaining <= 0) {
                reject(new Error('timeout:no_extension'))
                return
              }

              if (this.hasClient()) {
                resolve()
                return
              }

              const promoteTimeout = setTimeout(() => {
                reject(new Error('timeout:no_extension'))
              }, remaining)

              this.connectionResolvers.push(() => {
                clearTimeout(promoteTimeout)
                resolve()
              })
              return
            }
            // 接管失败，继续轮询
            promoting = false
          } else if (!health.error?.includes('not reachable')) {
            primaryReachable = true
          }

          setTimeout(poll, pollInterval)
        }

        poll()
      })
    }
  }

  /**
   * 检查 Primary 实例健康状态（Secondary 模式用）
   */
  private async checkPrimaryHealth(): Promise<{ connected: boolean; error?: string }> {
    return new Promise((resolve) => {
      const options: http.RequestOptions = {
        hostname: this.httpHost,
        port: this.httpPort,
        path: '/status',
        method: 'GET',
        timeout: 3000,
        headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      }

      const req = http.request(options, (res) => {
        let body = ''
        res.on('data', chunk => body += chunk)
        res.on('end', () => {
          try {
            const status = JSON.parse(body)
            resolve({ connected: status.connected === true })
          } catch {
            resolve({ connected: false, error: 'Invalid response from primary' })
          }
        })
      })

      req.on('error', (error) => {
        resolve({ connected: false, error: `Primary not reachable: ${error.message}` })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({ connected: false, error: 'Primary health check timeout' })
      })

      req.end()
    })
  }

  /**
   * 发送请求到 Extension 并等待响应
   */
  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.isServerMode) {
      return this.requestInternal<T>(method, params)
    } else {
      return this.requestViaSecondary<T>(method, params)
    }
  }

  /**
   * SECONDARY 模式请求（带重试 + 自动接管）
   */
  private async requestViaSecondary<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // 如果已经升级为 PRIMARY，直接走 internal
      if (this.isServerMode) {
        return this.requestInternal<T>(method, params)
      }

      // 重试前等待（首次不等）
      if (attempt > 0) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000)
        if (!this.silent) console.error(`[Bridge] SECONDARY retry ${attempt}/${maxRetries} in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      // 检查 PRIMARY 健康状态
      const health = await this.checkPrimaryHealth()
      if (!health.connected) {
        if (health.error?.includes('not reachable')) {
          // PRIMARY 已退出，尝试接管
          if (!this.silent) console.error('[Bridge] PRIMARY gone during request, attempting takeover...')
          const promoted = await this.tryPromote()
          if (promoted) {
            // 等 Extension 重新连接（温热重连应该很快）
            if (!this.hasClient()) {
              if (!this.silent) console.error('[Bridge] Waiting for Extension to reconnect...')
              await this.waitForConnection(30000)
            }
            return this.requestInternal<T>(method, params)
          }
        }
        lastError = new Error(health.error || 'Primary instance not available.')
        continue
      }

      // 转发请求
      try {
        return await this.requestViaHttp<T>(method, params)
      } catch (error) {
        lastError = error as Error
      }
    }

    throw lastError!
  }

  /**
   * 尝试接管端口，升级为 PRIMARY
   */
  private async tryPromote(): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      try {
        await this.startServer()
        this.isServerMode = true
        if (!this.silent) console.error(`[Bridge] Promoted to PRIMARY (WebSocket: ${this.host}:${this.port}, HTTP: ${this.httpHost}:${this.httpPort})`)
        return true
      } catch {
        await new Promise(r => setTimeout(r, 1000))
      }
    }
    return false
  }

  /**
   * 直接通过 WebSocket 发送请求（服务器模式）
   */
  private async requestInternal<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (!this.hasClient()) {
      throw new Error('Extension not connected. Please ensure the Chrome extension is running.')
    }

    const id = this.generateId()
    // 连接级 hello 已完成鉴权；token 不再逐条携带。
    const message: RequestMessage = { id, method, params }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, this.requestTimeout)

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout })

      try {
        this.client!.send(JSON.stringify(message))
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
        reject(error as Error)
      }
    })
  }

  /**
   * 通过 HTTP API 转发请求（客户端模式）；主实例要求 Bearer token。
   */
  private requestViaHttp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({ method, params, ...(this.token ? { token: this.token } : {}) })
      const options: http.RequestOptions = {
        hostname: this.httpHost,
        port: this.httpPort,
        path: '/request',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
      }

      const req = http.request(options, (res) => {
        let body = ''
        res.on('data', chunk => body += chunk)
        res.on('end', () => {
          try {
            const response = JSON.parse(body)
            if (response.error) {
              reject(new Error(typeof response.error === 'string' ? response.error : response.error.message || 'Failed to forward request'))
            } else {
              resolve(response.result)
            }
          } catch {
            reject(new Error(`Failed to parse response (HTTP ${res.statusCode})`))
          }
        })
      })

      req.on('error', (error) => {
        const hint = error.message.includes('ECONNREFUSED')
          ? ' (Is the primary server running?)'
          : ''
        reject(new Error(`Failed to connect to primary instance: ${error.message}${hint}`))
      })

      req.setTimeout(this.requestTimeout, () => {
        req.destroy()
        reject(new Error(`Request timeout: ${method}`))
      })

      req.write(data)
      req.end()
    })
  }

  /**
   * 连接建立：先完成 hello 握手，之后才处理请求/事件。
   */
  private handleConnection(ws: WebSocket): void {
    let authed = false
    const helloTimeout = setTimeout(() => {
      if (!authed && ws.readyState === WS_OPEN) {
        try { ws.close(4001, 'hello required') } catch { /* already closed */ }
      }
    }, 10000)
    helloTimeout.unref?.()

    ws.on('message', (data: unknown) => {
      let message: any
      try {
        message = JSON.parse(String(data))
      } catch {
        console.error('[Bridge] Failed to parse message')
        try { ws.close(4002, 'invalid frame') } catch { /* already closed */ }
        return
      }

      if (!authed) {
        authed = this.handleHello(ws, message)
        if (authed) clearTimeout(helloTimeout)
        return
      }

      this.handleMessage(message)
    })

    ws.on('close', () => {
      clearTimeout(helloTimeout)
      if (this.client === ws) {
        this.client = null
        this.clientInfo = null
        if (!this.silent) console.error('[Bridge] Extension disconnected')
        this.disconnectHandler?.()
      }
    })

    ws.on('error', (error: Error) => {
      if (!this.silent) console.error('[Bridge] WebSocket error:', error.message)
    })
  }

  /**
   * 校验首帧 hello。返回 true 表示连接已认证。
   */
  private handleHello(ws: WebSocket, message: any): boolean {
    // 只接受新协议的 kind:'hello'；兼容旧实现的 type:'hello'。
    if (!message || (message.kind !== 'hello' && message.type !== 'hello')) {
      try { ws.close(4001, 'hello required') } catch { /* already closed */ }
      return false
    }
    if (typeof message.token !== 'string' || !message.token) {
      try { ws.close(4001, 'token required') } catch { /* already closed */ }
      return false
    }
    if (!this.token) {
      try { ws.close(4001, 'bridge token not configured') } catch { /* already closed */ }
      return false
    }
    if (!tokenEquals(message.token, this.token)) {
      if (!this.silent) console.error('[Bridge] hello rejected: invalid token')
      try { ws.close(4003, 'invalid token') } catch { /* already closed */ }
      return false
    }

    const info: BridgeHelloInfo = {
      ...(message.version !== undefined ? { version: message.version } : {}),
      ...(typeof message.lang === 'string' ? { lang: message.lang } : {}),
    }

    if (this.client && this.client !== ws) {
      const previous = this.client
      this.client = null
      this.clientInfo = null
      try { previous.close(4000, 'replaced') } catch { /* already closed */ }
    }

    this.client = ws
    this.clientInfo = info
    try {
      ws.send(JSON.stringify({ kind: 'hello-ok', version: PROTOCOL_VERSION }))
    } catch (error) {
      this.client = null
      this.clientInfo = null
      console.error('[Bridge] Failed to send hello-ok:', (error as Error).message)
      try { ws.close(4002, 'hello-ok failed') } catch { /* already closed */ }
      return false
    }

    if (!this.silent) console.error('[Bridge] Extension connected (hello-ok)')
    const resolvers = this.connectionResolvers
    this.connectionResolvers = []
    for (const resolver of resolvers) resolver()
    this.connectHandler?.(info)
    return true
  }

  /**
   * 处理来自 Extension 的消息（hello 之后）。
   * - `{kind:'event', event:'desk.*'}` 且 id 无对应 pending → onEvent。
   * - 其余按上游响应 `{id, result?, error?}` 解析；帧里的 token 字段被忽略。
   */
  private handleMessage(message: any): void {
    if (
      message?.kind === 'event'
      && typeof message.event === 'string'
      && message.event.startsWith('desk.')
      && !(typeof message.id === 'string' && this.pendingRequests.has(message.id))
    ) {
      if (!this.eventHandler) {
        console.error(`[Bridge] No desk event handler; dropped ${message.event}`)
        return
      }
      try {
        const result = this.eventHandler(message.event, message.payload, message.id)
        if (result && typeof (result as Promise<void>).catch === 'function') {
          ;(result as Promise<void>).catch((error: Error) => {
            console.error(`[Bridge] Event handler failed for ${message.event}:`, error.message)
          })
        }
      } catch (error) {
        console.error(`[Bridge] Event handler failed for ${message.event}:`, (error as Error).message)
      }
      return
    }

    if (typeof message?.id !== 'string') {
      console.error('[Bridge] Message without id:', message?.kind || message?.event || 'unknown')
      return
    }

    const pending = this.pendingRequests.get(message.id)
    if (!pending) {
      console.error('[Bridge] Unknown response id:', message.id)
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(message.id)

    if (message.error) {
      const reason = typeof message.error === 'string'
        ? message.error
        : message.error.message || 'Extension returned an error'
      pending.reject(new Error(reason))
    } else {
      pending.resolve(message.result)
    }
  }

  /**
   * 向扩展推送 desk 事件帧。
   * @returns 是否发送成功（无连接时 false）。
   */
  sendEvent(event: string, payload?: unknown, id?: string): boolean {
    if (!this.hasClient()) return false
    const frame: Record<string, unknown> = { kind: 'event', event }
    if (id) frame.id = id
    if (payload !== undefined) frame.payload = payload
    try {
      this.client!.send(JSON.stringify(frame))
      return true
    } catch (error) {
      if (!this.silent) console.error('[Bridge] Failed to send event:', (error as Error).message)
      return false
    }
  }

  /** 回 ack（desk.capture 的入队确认等）。 */
  sendAck(id: string | undefined, payload: Record<string, unknown> = {}): boolean {
    if (!this.hasClient()) return false
    const frame: Record<string, unknown> = { kind: 'ack', ...payload }
    if (id) frame.id = id
    try {
      this.client!.send(JSON.stringify(frame))
      return true
    } catch (error) {
      if (!this.silent) console.error('[Bridge] Failed to send ack:', (error as Error).message)
      return false
    }
  }

  /**
   * 生成唯一 ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
  }

  // 分片上传配置
  private readonly CHUNK_SIZE = 512 * 1024  // 512KB per chunk
  private readonly CHUNK_THRESHOLD = 1024 * 1024  // 1MB threshold for chunking

  /**
   * 分片上传图片
   * 大于 1MB 的图片会自动分片上传
   */
  async uploadImageChunked(
    imageData: string,
    mimeType: string,
    platform: string = 'weibo'
  ): Promise<{ url: string; platform: string }> {
    // 小于阈值，直接上传
    if (imageData.length < this.CHUNK_THRESHOLD) {
      return this.request('uploadImage', { imageData, mimeType, platform })
    }

    // 大图片，分片上传
    const uploadId = this.generateId()
    const chunks: string[] = []

    // 分割 base64 数据
    for (let i = 0; i < imageData.length; i += this.CHUNK_SIZE) {
      chunks.push(imageData.slice(i, i + this.CHUNK_SIZE))
    }

    console.error(`[Bridge] Chunked upload: ${chunks.length} chunks, total size: ${imageData.length}`)

    // 1. 发送开始消息
    await this.request('uploadImage:start', {
      uploadId,
      totalChunks: chunks.length,
      mimeType,
      platform,
    })

    // 2. 逐个发送分片
    for (let i = 0; i < chunks.length; i++) {
      await this.request('uploadImage:chunk', {
        uploadId,
        chunkIndex: i,
        data: chunks[i],
      })
    }

    // 3. 发送完成消息并获取结果
    const result = await this.request<{ url: string; platform: string }>('uploadImage:complete', {
      uploadId,
    })

    return result
  }
}