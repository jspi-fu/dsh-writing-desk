// 最小 WebSocket 服务端(RFC 6455 子集):桥只需要本机回环上的 JSON 文本帧,
// 所以只实现握手、文本帧、分片重组、ping/pong 与 close,不碰二进制帧与扩展。
// 零依赖是本仓库的纪律;Node 22+ 有原生 WS 客户端但没有服务端,这里手写服务端这一半。
import { createHash } from 'node:crypto'

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** 解析一个帧;返回 null 表示缓冲区不够下一帧。 */
function readFrame(buffer) {
  if (buffer.length < 2) return null
  const fin = (buffer[0] & 0x80) !== 0
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let length = buffer[1] & 0x7f
  let offset = 2
  if (length === 126) {
    if (buffer.length < 4) return null
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    if (buffer.length < 10) return null
    length = Number(buffer.readBigUInt64BE(2))
    offset = 10
  }
  const maskKey = masked ? buffer.subarray(offset, offset + 4) : null
  if (masked) offset += 4
  if (buffer.length < offset + length) return null
  const payload = Buffer.from(buffer.subarray(offset, offset + length))
  if (masked) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= maskKey[i % 4]
  }
  return { fin, opcode, payload, rest: buffer.subarray(offset + length) }
}

function encodeFrame(opcode, payload) {
  const length = payload.length
  let header
  if (length < 126) {
    header = Buffer.from([0x80 | opcode, length])
  } else if (length < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(length, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x80 | opcode
    header[1] = 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  return Buffer.concat([header, payload])
}

/**
 * 一个 WS 连接:挂到 HTTP server 的 upgrade 上,吐出 message/close 事件。
 * @param {import('node:http').IncomingMessage} req - 升级请求。
 * @param {import('node:net').Socket} socket - 已升级的 socket。
 */
export class WsConnection {
  constructor(req, socket) {
    this.socket = socket
    this.buffer = Buffer.alloc(0)
    this.fragments = []
    this.fragmentOpcode = 0
    this.alive = false
    const key = req.headers['sec-websocket-key']
    const accept = createHash('sha1').update(`${key}${GUID}`).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`)
    this.alive = true
    socket.on('data', chunk => this.#feed(chunk))
    socket.on('close', () => { this.alive = false; this.onclose?.() })
    socket.on('error', () => { this.alive = false; this.onclose?.() })
    socket.setNoDelay(true)
  }

  #feed(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk
    for (;;) {
      const frame = readFrame(this.buffer)
      if (!frame) return
      this.buffer = frame.rest
      this.#handle(frame)
    }
  }

  #handle(frame) {
    switch (frame.opcode) {
      case 0x1: // text
      case 0x2: // binary(协议里不会出现,当文本容错)
        if (frame.fin) this.onmessage?.(frame.payload.toString('utf8'))
        else { this.fragments = [frame.payload]; this.fragmentOpcode = frame.opcode }
        return
      case 0x0: // continuation
        this.fragments.push(frame.payload)
        if (frame.fin) {
          const text = Buffer.concat(this.fragments).toString('utf8')
          this.fragments = []
          this.onmessage?.(text)
        }
        return
      case 0x9: // ping
        this.send(0xa, frame.payload)
        return
      case 0xa: // pong
        return
      case 0x8: // close
        this.close()
        return
      default:
        this.close()
    }
  }

  send(opcode, payload) {
    if (!this.alive) return
    const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
    try {
      this.socket.write(encodeFrame(opcode, data))
    } catch {
      this.alive = false
    }
  }

  text(json) {
    this.send(0x1, json)
  }

  close() {
    if (!this.alive) return
    this.alive = false
    try {
      this.socket.write(encodeFrame(0x8, Buffer.alloc(0)))
    } catch { /* socket 已经没了 */ }
    this.socket.end()
    this.onclose?.()
  }
}
