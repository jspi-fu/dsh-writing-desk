// wdesk 桥(ADR 0009):Node 侧的本地桥进程。
//   WS(默认 127.0.0.1:4527)——扩展主动外连,握手 token 后互发 JSON 帧;
//   HTTP(默认 127.0.0.1:4528)——本机命令(status/request)与未来 MCP 的挂载点。
//   投递箱——inbox 收扩展采集,outbox 下发发布任务,dispatch 回执写给宿主消化。
// 端口职责分离(上游把桥 HTTP 与 MCP HTTP 挤在同一端口会 EADDRINUSE,这里从布局上避开)。
import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { claimPublishTask, deliverCapture, loadTaskImages, newOperationId, watchOutbox, writeDispatchReceipt, writeAuth } from './mail.js'
import { isRequest, isResult, validateCapture, validateHello, validatePublishResult } from './proto.js'
import { WsConnection } from './ws.js'

const REQUEST_TIMEOUT = 10 * 60 * 1000 // 发布含图片上传,对齐上游 10 分钟
const CAPTURE_TIMEOUT = 45 * 1000

/** 常量时间比较,token 校验不走捷径。 */
function tokenEquals(a, b) {
  const bufA = Buffer.from(String(a))
  const bufB = Buffer.from(String(b))
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB)
}

export class Bridge {
  constructor({ wsPort = 4527, httpPort = 4528, token, log = () => {} } = {}) {
    this.wsPort = wsPort
    this.httpPort = httpPort
    this.token = token
    this.log = log
    this.connections = new Set()
    this.pending = new Map() // id → {resolve, reject, timer, direction}
    this.stopWatch = null
    this.httpServer = null
    this.lastSeen = 0
  }

  get connected() {
    return [...this.connections].some(conn => conn.ready)
  }

  async start() {
    // 抢 WS 端口:被占说明另一个桥(primary)在跑,调用方决定走 HTTP 代理还是退出
    await new Promise((resolve, reject) => {
      this.wsServer = createServer((req, res) => res.writeHead(426).end())
      this.wsServer.on('upgrade', (req, socket) => this.#onUpgrade(req, socket))
      this.wsServer.once('error', reject)
      this.wsServer.listen(this.wsPort, '127.0.0.1', resolve)
    })
    this.httpServer = createServer((req, res) => this.#onHttp(req, res))
    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject)
      this.httpServer.listen(this.httpPort, '127.0.0.1', resolve)
    })
    await writeAuth(this.token, this.wsPort, this.httpPort)
    this.stopWatch = await watchOutbox(name => this.#onOutbox(name))
    this.log(`桥已起:ws://127.0.0.1:${this.wsPort} · http://127.0.0.1:${this.httpPort}`)
  }

  async stop() {
    await this.stopWatch?.()
    for (const conn of this.connections) conn.close()
    await new Promise(resolve => this.wsServer?.close(resolve))
    await new Promise(resolve => this.httpServer?.close(resolve))
  }

  #onUpgrade(req, socket) {
    if (String(req.headers.origin || '').startsWith('http')) {
      // 浏览器页面(而非扩展)不该升级到桥:扩展的 Origin 是 chrome-extension://
      socket.destroy()
      return
    }
    const conn = new WsConnection(req, socket)
    conn.onclose = () => {
      this.connections.delete(conn)
      if (!this.connected) this.log('扩展断开,等它重连…')
    }
    conn.onmessage = raw => this.#onMessage(conn, raw)
    this.connections.add(conn)
  }

  #onMessage(conn, raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      conn.close()
      return
    }
    if (!conn.ready) {
      if (!validateHello(msg, this.token)) {
        this.log('有连接握手失败,已断开(token 不对或版本不符)')
        conn.close()
        return
      }
      conn.ready = true
      conn.text(JSON.stringify({ type: 'welcome', v: 1 }))
      this.log('浏览器扩展已连接')
      return
    }
    if (isResult(msg)) {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.ok) entry.resolve(msg.result)
      else entry.reject(new Error(msg.error || '扩展返回错误'))
      return
    }
    if (isRequest(msg)) {
      this.#onExtensionRequest(conn, msg)
    }
  }

  /** 扩展 → 桥:目前只有 capture(采集进投递箱)。 */
  async #onExtensionRequest(conn, msg) {
    if (msg.method === 'capture') {
      const problem = validateCapture(msg.params)
      if (problem) {
        conn.text(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: problem }))
        return
      }
      try {
        const receipt = await deliverCapture(msg.params)
        conn.text(JSON.stringify({ type: 'result', id: msg.id, ok: receipt.ok, result: receipt.ok ? { itemId: receipt.itemId } : null, error: receipt.error }))
      } catch (err) {
        conn.text(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: String(err.message || err) }))
      }
      return
    }
    conn.text(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: `未知方法 ${msg.method}` }))
  }

  /** 桥 → 扩展:请求-响应,带超时。 */
  request(method, params, timeout = REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('浏览器扩展没有连接:装好扩展、token 配对后它自己会连上来'))
        return
      }
      const id = newOperationId()
      const conn = [...this.connections].find(item => item.ready)
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`扩展 ${Math.round(timeout / 1000)} 秒内没有回应 ${method}`))
      }, timeout)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      conn.text(JSON.stringify({ type: 'request', id, method, params }))
    })
  }

  /** outbox 里的发布任务:认领 → 读图 → 下发扩展 → 回执落盘。 */
  async #onOutbox(name) {
    const task = await claimPublishTask(name)
    if (!task) return
    this.log(`收到发布任务 ${task.operationId.slice(0, 8)} → ${task.platforms.join(', ')}`)
    let results = []
    try {
      const images = await loadTaskImages(task)
      const outcome = await this.request('publish', {
        operationId: task.operationId,
        title: task.title,
        markdown: task.articleMd,
        images,
        platforms: task.platforms,
      })
      const problem = validatePublishResult(outcome)
      if (problem) throw new Error(problem)
      results = outcome.results
    } catch (err) {
      // 整体失败也要回执:让工作台的对话框亮出失败原因,而不是永远转圈
      results = task.platforms.map(platform => ({ platform, ok: false, error: String(err.message || err) }))
    }
    await writeDispatchReceipt(task.operationId, { itemId: task.itemId, ok: results.some(row => row.ok), results })
    this.log(`任务 ${task.operationId.slice(0, 8)} 完成: ${results.map(row => `${row.platform}:${row.ok ? '✓' : '✗'}`).join(' ')}`)
  }

  #onHttp(req, res) {
    const sendJson = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token || !tokenEquals(token, this.token)) {
      sendJson(401, { error: '未授权' })
      return
    }
    const url = new URL(req.url || '/', 'http://local')
    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(200, { ok: true, extension: this.connected ? 'connected' : 'waiting', connections: this.connections.size, wsPort: this.wsPort, httpPort: this.httpPort })
      return
    }
    if (req.method === 'POST' && url.pathname === '/request') {
      const chunks = []
      let size = 0
      req.on('data', chunk => {
        size += chunk.length
        if (size > 32 * 1024 * 1024) {
          sendJson(413, { error: '请求体太大' })
          req.destroy()
        } else chunks.push(chunk)
      })
      req.on('end', () => {
        let body
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          sendJson(400, { error: '不是有效 JSON' })
          return
        }
        if (!body || typeof body.method !== 'string') {
          sendJson(400, { error: '缺少 method' })
          return
        }
        const timeout = typeof body.timeoutMs === 'number' ? body.timeoutMs : REQUEST_TIMEOUT
        this.request(body.method, body.params ?? {}, timeout)
          .then(result => sendJson(200, { ok: true, result }))
          .catch(err => sendJson(502, { ok: false, error: String(err.message || err) }))
      })
      return
    }
    sendJson(404, { error: '接口不存在' })
  }
}

/** 起一个桥;端口被占时返回 null(说明已有桥在跑)。 */
export async function startBridge({ wsPort, httpPort, token, log }) {
  const bridge = new Bridge({ wsPort, httpPort, token, log })
  try {
    await bridge.start()
    return bridge
  } catch (err) {
    if (err.code === 'EADDRINUSE') return null
    throw err
  }
}
