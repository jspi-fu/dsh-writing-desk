// 桥接客户端(ADR 0009):扩展是 WS client,主动外连本机桥。
// 温热/冷却双阶段退避(上游验证过的形态):扩展设置页打开时强制温热重连;
// token 只出现在握手帧里,对不上就等下一次轮询,不逐条明文携带。
import { helloMessage, PROTOCOL_VERSION } from './proto.js'

const WARM_INTERVALS = [500, 1000, 2000, 5000] // 温热:设置页开着时,最多 5 秒重试
const COOL_INTERVALS = [10000, 20000, 40000, 60000] // 冷却:平时,最多 1 分钟

export class BridgeClient {
  constructor({ onStatus, onRequest } = {}) {
    this.url = 'ws://127.0.0.1:4527'
    this.onStatus = onStatus
    this.onRequest = onRequest // (method, params) => Promise<result>
    this.ws = null
    this.ready = false
    this.attempt = 0
    this.timer = null
    this.cooling = true
    this.status = 'never' // never | connecting | connected | refused
    this.pending = new Map()
  }

  async loadConfig() {
    const { bridgeUrl } = await chrome.storage.local.get('bridgeUrl')
    if (bridgeUrl) this.url = bridgeUrl
  }

  start() {
    this.stop()
    this.stopped = false
    this.#connect()
  }

  setWarm(warm) {
    const wasCooling = this.cooling
    this.cooling = !warm
    if (wasCooling && warm) {
      this.attempt = 0
      clearTimeout(this.timer)
      this.#connect()
    }
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
    this.#setStatus('never')
  }

  #setStatus(status) {
    if (this.status === status) return
    this.status = status
    this.onStatus?.(status)
  }

  async #connect() {
    if (this.stopped || this.ws) return
    const token = (await chrome.storage.local.get('bridgeToken')).bridgeToken
    this.#setStatus('connecting')
    try {
      const ws = new WebSocket(this.url)
      this.ws = ws
      ws.onopen = () => {
        if (!token) {
          // 没配过 token:握手必然失败,直接进入等待,提示用户去配对
          ws.close()
          this.#setStatus('refused')
          this.#scheduleNext()
          return
        }
        ws.send(JSON.stringify(helloMessage(token)))
      }
      ws.onmessage = event => this.#onMessage(ws, event.data)
      ws.onclose = () => {
        if (this.ws !== ws) return
        this.ws = null
        this.ready = false
        for (const entry of this.pending.values()) {
          clearTimeout(entry.timer)
          entry.reject(new Error('桥连接断开'))
        }
        this.pending.clear()
        this.#scheduleNext()
      }
      ws.onerror = () => { /* onclose 会跟着来 */ }
    } catch {
      this.#scheduleNext()
    }
  }

  #scheduleNext() {
    if (this.stopped) return
    const intervals = this.cooling ? COOL_INTERVALS : WARM_INTERVALS
    const delay = intervals[Math.min(this.attempt, intervals.length - 1)]
    this.attempt += 1
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.#connect(), delay)
    this.timer.unref?.()
  }

  #onMessage(ws, raw) {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg.type === 'welcome') {
      this.ready = true
      this.attempt = 0
      this.#setStatus('connected')
      return
    }
    if (msg.type === 'request' && this.onRequest) {
      // 桥 → 扩展:publish/platforms/extract
      Promise.resolve(this.onRequest(msg.method, msg.params ?? {}))
        .then(result => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, result }))
        })
        .catch(err => {
          if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: false, error: String(err.message || err) }))
        })
      return
    }
    if (msg.type === 'result') {
      const entry = this.pending.get(msg.id)
      if (!entry) return
      this.pending.delete(msg.id)
      clearTimeout(entry.timer)
      if (msg.ok) entry.resolve(msg.result)
      else entry.reject(new Error(msg.error || '桥返回错误'))
    }
  }

  /** 扩展 → 桥的请求(capture 等)。 */
  request(method, params, timeout = 45000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1 || !this.ready) {
        reject(new Error('没有连接到 wdesk 桥:先在工作台设置页复制 Token,粘进扩展设置,再启动 wdesk serve'))
        return
      }
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`桥 ${Math.round(timeout / 1000)} 秒内没有回应 ${method}`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ type: 'request', id, method, params }))
    })
  }
}
