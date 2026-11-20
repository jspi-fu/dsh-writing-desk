// DSwritesync 本地助手(ADR 0012):浏览器扩展经 Native Messaging 拉起的 NM host,
// 取代 dswritesync serve(WS/token 已退役)。零依赖,node 内置模块。
// 职责:投递箱三向读写(inbox/outbox/receipts)、argv origin 白名单复核(浏览器
// 校验之外的第二道)、outbox 任务分片下发(host→Chrome 单消息 ≤1MB)、环形日志。
// 消息面与扩展侧 GPL 代码按协议事实对齐,不拷贝;许可 MIT(主仓库)。
// 生命周期:短进程按请求(sendNativeMessage,处理完即退)+ 面板/对话框打开期间的
// 长端口(connectNative,fs.watch outbox/receipts 近实时推 + 1s 轮询兜底)。
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'

/** NM host 名:注册表与扩展 connectNative/sendNativeMessage 共用的锚点。 */
export const HOST_NAME = 'app.dswritesync.plugin'
/** 固定扩展 ID(manifest key 派生);origin 白名单与 allowed_origins 同源。 */
export const EXTENSION_ID = 'hhkhkekbflmcnpbiiihpmgecpaicblbd'
export const PROTOCOL_VERSION = 1

// host→Chrome 单消息 ≤1MB:分片按 base64 字符切 80 万(≈600KB 原始字节),
// 加上 JSON 信封远在 1MB 之下;Chrome→host 上限 4GB,收进负载无需分片。
export const CHUNK_B64 = 800_000
// 收进请求体上限:正文 2 万字 + 封面,4MB 已远超实际需要,只挡异常投递。
const CAPTURE_BODY_LIMIT = 4_000_000
// 已认领任务超过这个时长且没有回执,视为扩展中途死掉,写失败回执并放行清理。
const STALE_CLAIM_MS = 30 * 60 * 1000
// DSH 活跃判定:宿主每 3 秒刷 catalog.json,mtime 在这个窗口内即视为在运行。
const DSH_FRESH_MS = 15_000
const LOG_MAX = 256_000

const MIME_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
}

/** 投递箱目录:与宿主 src/bridge.js 的 bridgePaths 同一布局。 */
export function mailboxPaths(env = process.env) {
  const root = path.join(env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'writing-desk', 'bridge')
  return {
    root,
    inbox: path.join(root, 'inbox'),
    outbox: path.join(root, 'outbox'),
    receipts: path.join(root, 'receipts'),
    catalog: path.join(root, 'catalog.json'),
    log: path.join(root, 'helper.log'),
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 原子写 JSON(临时文件 + rename;Windows 覆盖报 EPERM/EEXIST 时先删再改)。 */
export async function writeJsonAtomic(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(value))
  try {
    await fsp.rename(tmp, file)
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EEXIST') throw error
    await fsp.rm(file, { force: true })
    await fsp.rename(tmp, file)
  }
}

/** 只允许安全字符进文件名,防止把 operationId 拼出目录穿越。 */
export function safeOperationId(value) {
  return typeof value === 'string' && /^[\w-]{1,200}$/.test(value) ? value : null
}

/** argv 里扫 origin(Windows 上 --parent-window 在前,顺序不作假设)。 */
export function originFromArgv(argv) {
  const marker = `chrome-extension://${EXTENSION_ID}/`
  return argv.find(arg => arg === marker) || null
}

/** NM 帧:4 字节小端长度 + UTF-8 JSON;管道可能部分写,循环写满。 */
export function writeMessage(value, fd = 1) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  const frame = Buffer.concat([Buffer.from(new Uint32Array([body.length]).buffer), body])
  let offset = 0
  while (offset < frame.length) {
    offset += fs.writeSync(fd, frame, offset)
  }
}

/**
 * 核心处理器:全部副作用落在注入的投递箱目录里,测试直接函数调用
 * {path, body},断言响应与文件副作用,不起真进程(缝 2)。
 */
export function createCore({ paths = mailboxPaths(), now = Date.now, startedAt = Date.now(), log = () => {} } = {}) {
  const blobCache = new Map() // operationId → {article, images: Map(ref → {mime, b64})}

  async function ensureDirs() {
    for (const dir of [paths.root, paths.inbox, paths.outbox, paths.receipts]) {
      await fsp.mkdir(dir, { recursive: true })
    }
  }

  async function readJson(file) {
    try {
      return JSON.parse(await fsp.readFile(file, 'utf8'))
    } catch {
      return null
    }
  }

  async function fileExists(file) {
    try {
      await fsp.stat(file)
      return true
    } catch {
      return false
    }
  }

  /** DSH 是否在跑:宿主活着就会周期刷 catalog.json。 */
  async function dshActive() {
    try {
      const info = await fsp.stat(paths.catalog)
      return now() - info.mtimeMs < DSH_FRESH_MS
    } catch {
      return false
    }
  }

  /** 环形日志:追加一行;超过上限就轮成 helper.log.1(只留一代)。 */
  async function ringLog(entry) {
    try {
      await ensureDirs()
      try {
        const info = await fsp.stat(paths.log)
        if (info.size > LOG_MAX) {
          await fsp.rm(`${paths.log}.1`, { force: true })
          await fsp.rename(paths.log, `${paths.log}.1`)
        }
      } catch { /* 还没有日志文件 */ }
      await fsp.appendFile(paths.log, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
    } catch { /* 日志失败不碰协议 */ }
  }

  function base64Shards(b64) {
    const shards = Math.max(1, Math.ceil(b64.length / CHUNK_B64))
    return { shards }
  }

  async function loadTask(operationId) {
    const claimed = path.join(paths.outbox, `publish-${operationId}.json.claiming`)
    const task = await readJson(claimed)
    return task ? { claimed, task } : {}
  }

  /** 任务内容缓存:articleMd 串 + 各图片文件的 base64,回执后清掉。 */
  async function blobsFor(operationId) {
    const cached = blobCache.get(operationId)
    if (cached) return cached
    const { task } = await loadTask(operationId)
    if (!task) throw new Error('task not found')
    const article = Buffer.from(String(task.articleMd ?? ''), 'utf8').toString('base64')
    const images = new Map()
    if (isPlainObject(task.images)) {
      for (const [ref, file] of Object.entries(task.images)) {
        if (!ref || typeof file !== 'string') continue
        try {
          const bytes = await fsp.readFile(file)
          const mime = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
          images.set(ref, { mime, b64: bytes.toString('base64') })
        } catch (error) {
          log({ dir: 'note', message: `image unreadable: ${ref}: ${error.message}` })
        }
      }
    }
    const blobs = { task, article, images }
    blobCache.set(operationId, blobs)
    return blobs
  }

  /** outbox 里未认领任务的元数据列表;内容本体走 content 分片拉取。 */
  async function listTasks() {
    let names = []
    try {
      names = await fsp.readdir(paths.outbox)
    } catch {
      return []
    }
    const tasks = []
    for (const name of names) {
      if (!/^publish-[\w-]+\.json$/.test(name)) continue
      const operationId = name.slice('publish-'.length, -'.json'.length)
      const task = await readJson(path.join(paths.outbox, name))
      if (!task) continue
      tasks.push(await taskMeta(operationId, task))
    }
    return tasks
  }

  async function taskMeta(operationId, task) {
    const article = base64Shards(Buffer.from(String(task.articleMd ?? ''), 'utf8').toString('base64'))
    const images = []
    if (isPlainObject(task.images)) {
      for (const [ref, file] of Object.entries(task.images)) {
        if (!ref || typeof file !== 'string') continue
        try {
          const info = await fsp.stat(file)
          const b64len = 4 * Math.ceil(info.size / 3)
          images.push({ ref, mime: MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', ...base64Shards('x'.repeat(b64len)) })
        } catch {
          log({ dir: 'note', message: `image unreadable: ${ref}` })
        }
      }
    }
    return {
      operationId,
      itemId: String(task.itemId ?? ''),
      title: String(task.title ?? ''),
      platforms: Array.isArray(task.platforms) ? task.platforms.filter(row => typeof row === 'string') : [],
      article: { shards: article.shards },
      images,
    }
  }

  const handlers = {
    async status() {
      return { ok: true, version: PROTOCOL_VERSION, dshActive: await dshActive() }
    },

    async catalog() {
      const raw = await readJson(paths.catalog)
      if (!isPlainObject(raw)) return { ok: true, at: new Date().toISOString(), tags: [], urls: {} }
      const tags = Array.isArray(raw.tags) ? raw.tags.filter(tag => typeof tag === 'string') : []
      const urls = {}
      if (isPlainObject(raw.urls)) {
        for (const [url, itemId] of Object.entries(raw.urls)) {
          if (typeof itemId === 'string') urls[url] = itemId
        }
      }
      return { ok: true, at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(), tags, urls }
    },

    /** 收进:原子写 inbox,即刻持久化;DSH 关着也成功,宿主下次启动消化。 */
    async capture(body) {
      if (!isPlainObject(body)) return { ok: false, error: 'payload required' }
      const operationId = safeOperationId(body.operationId)
      if (!operationId) return { ok: false, error: 'operationId required' }
      const serialized = JSON.stringify(body)
      if (serialized.length > CAPTURE_BODY_LIMIT) return { ok: false, error: 'payload too large' }
      await ensureDirs()
      await writeJsonAtomic(path.join(paths.inbox, `import-${operationId}.json`), { ...body, operationId })
      log({ dir: 'note', message: `captured ${operationId}` })
      return { ok: true, operationId, queued: true, dshActive: await dshActive() }
    },

    async tasks() {
      return { ok: true, tasks: await listTasks() }
    },

    /** 原子 rename 认领;已在处理中的任务原样返回元数据(重连续传)。 */
    async claim(body) {
      const operationId = safeOperationId(body?.operationId)
      if (!operationId) return { ok: false, error: 'operationId required' }
      const file = path.join(paths.outbox, `publish-${operationId}.json`)
      const claimed = path.join(paths.outbox, `publish-${operationId}.json.claiming`)
      await ensureDirs()
      try {
        await fsp.rename(file, claimed)
        log({ dir: 'note', message: `claimed ${operationId}` })
      } catch (error) {
        if (error.code !== 'ENOENT') log({ dir: 'note', message: `claim ${operationId}: ${error.message}` })
      }
      const { task } = await loadTask(operationId)
      if (!task) return { ok: false, error: 'task not found' }
      return { ok: true, task: await taskMeta(operationId, task) }
    },

    /** 分片拉取:name 是 article 或 images/<ref>(只放行任务 images 映射里列出的文件)。 */
    async content(body) {
      const operationId = safeOperationId(body?.operationId)
      if (!operationId) return { ok: false, error: 'operationId required' }
      const shard = Number(body?.shard)
      if (!Number.isInteger(shard) || shard < 0) return { ok: false, error: 'shard required' }
      let blobs
      try {
        blobs = await blobsFor(operationId)
      } catch {
        return { ok: false, error: 'task not found' }
      }
      let b64 = ''
      let mime = 'text/plain'
      if (body?.name === 'article') {
        b64 = blobs.article
      } else if (typeof body?.name === 'string' && body.name.startsWith('images/')) {
        const image = blobs.images.get(body.name)
        if (!image) return { ok: false, error: 'unknown content name' }
        b64 = image.b64
        mime = image.mime
      } else {
        return { ok: false, error: 'unknown content name' }
      }
      const { shards } = base64Shards(b64)
      if (shard >= shards) return { ok: false, error: 'shard out of range' }
      return { ok: true, name: body.name, shard, shards, mime, data: b64.slice(shard * CHUNK_B64, (shard + 1) * CHUNK_B64) }
    },

    /** 投递回执:落 receipts,清掉已认领任务;同一 operationId 不写不同结果。 */
    async receipt(body) {
      const payload = isPlainObject(body?.payload) ? body.payload : null
      const operationId = safeOperationId(payload?.operationId)
      if (!operationId) return { ok: false, error: 'operationId required' }
      await ensureDirs()
      const file = path.join(paths.receipts, `dispatch-${operationId}.json`)
      const next = { ...payload, operationId, at: new Date().toISOString() }
      const existing = await readJson(file)
      if (existing) {
        const same = JSON.stringify({ ...existing, at: null }) === JSON.stringify({ ...next, at: null })
        if (!same) return { ok: false, error: 'receipt conflict for same operationId' }
      } else {
        await writeJsonAtomic(file, next)
        log({ dir: 'note', message: `receipt ${operationId}` })
      }
      blobCache.delete(operationId)
      const claimed = path.join(paths.outbox, `publish-${operationId}.json.claiming`)
      await fsp.rm(claimed, { force: true }).catch(() => {})
      return { ok: true }
    },
  }

  /** 已认领任务的超时清理:写失败回执(宿主记进 dispatches),不再重试。 */
  async function recoverStaleClaims() {
    let names = []
    try {
      names = await fsp.readdir(paths.outbox)
    } catch {
      return
    }
    for (const name of names) {
      if (!/^publish-[\w-]+\.json\.claiming$/.test(name)) continue
      const operationId = name.slice('publish-'.length, -'.json.claiming'.length)
      const file = path.join(paths.outbox, name)
      const receiptFile = path.join(paths.receipts, `dispatch-${operationId}.json`)
      if (await fileExists(receiptFile)) {
        await fsp.rm(file, { force: true }).catch(() => {})
        continue
      }
      let info
      try {
        info = await fsp.stat(file)
      } catch {
        continue
      }
      if (now() - info.mtimeMs < STALE_CLAIM_MS) continue
      const task = await readJson(file)
      const platforms = Array.isArray(task?.platforms) ? task.platforms.filter(row => typeof row === 'string') : []
      await writeJsonAtomic(receiptFile, {
        operationId,
        itemId: String(task?.itemId ?? ''),
        ok: false,
        results: platforms.map(platform => ({ platform, ok: false, error: '投递中断:扩展处理超时,请重新投递' })),
        at: new Date().toISOString(),
      })
      await fsp.rm(file, { force: true }).catch(() => {})
      log({ dir: 'note', message: `stale claim recovered: ${operationId}` })
    }
  }

  /** 新 import 回执 → capture-result 事件(长端口期间近实时回给扩展)。 */
  async function pollCaptureResults(seen, send) {
    let names = []
    try {
      names = await fsp.readdir(paths.receipts)
    } catch {
      return
    }
    for (const name of names) {
      if (!/^import-[\w-]+\.json$/.test(name) || seen.has(name)) continue
      const file = path.join(paths.receipts, name)
      let info
      try {
        info = await fsp.stat(file)
      } catch {
        continue
      }
      seen.add(name)
      // 助手启动前留下的旧回执不补推,避免扩展重启后收到一串过期通知
      if (info.mtimeMs < startedAt - 2000) continue
      const body = await readJson(file)
      if (!isPlainObject(body)) continue
      const operationId = typeof body.operationId === 'string'
        ? body.operationId
        : name.slice('import-'.length, -'.json'.length)
      send({ event: 'capture-result', payload: {
        operationId,
        ok: body.ok === true,
        ...(typeof body.itemId === 'string' ? { itemId: body.itemId } : {}),
        ...(typeof body.error === 'string' ? { error: body.error } : {}),
        ...(body.duplicate === true || body.replay === true ? { duplicate: true } : {}),
        ...(body.replaced === true ? { replaced: true } : {}),
      } })
    }
  }

  return { handlers, ensureDirs, readJson, dshActive, ringLog, listTasks, taskMeta, recoverStaleClaims, pollCaptureResults, blobsFor, loadTask }
}

/**
 * 主入口:短请求模式(sendNativeMessage)只回响应,绝不推事件帧——Chrome 把
 * 首帧当响应,事件混进来会把收进误判成别的结果。长端口(connectNative)必须
 * 先发 {method:'connect'} 握手,之后才挂 outbox/receipts 监听与心跳。
 */
export async function main({ argv = process.argv, env = process.env, input = process.stdin, write = writeMessage } = {}) {
  const origin = originFromArgv(argv)
  if (!origin) {
    write({ ok: false, error: 'origin not allowed' })
    return
  }
  const paths = mailboxPaths(env)
  const core = createCore({ paths, startedAt: Date.now() })
  const log = entry => core.ringLog({ dir: 'in', ...entry }).catch(() => {})

  // 环形日志要等投递箱目录就绪;目录建不起来时协议照常工作
  await core.ensureDirs().catch(() => {})
  log({ message: `helper started (origin ok, pid ${process.pid})` })

  let outboxSeen = null
  const receiptsSeen = new Set()
  const send = value => write(value)
  const scan = async () => {
    try {
      const names = await fsp.readdir(paths.outbox).catch(() => [])
      const fingerprint = names.filter(name => name.endsWith('.json')).sort().join(',')
      if (outboxSeen !== null && fingerprint !== outboxSeen) send({ event: 'task-available' })
      outboxSeen = fingerprint
      await core.recoverStaleClaims()
      await core.pollCaptureResults(receiptsSeen, send)
    } catch { /* 扫描失败不影响下一轮 */ }
  }

  let stopLongMode = null
  const startLongMode = () => {
    if (stopLongMode) return
    let watcher = null
    try {
      watcher = fs.watch(paths.outbox, () => { void scan() })
    } catch { /* 目录不存在时靠轮询兜底 */ }
    const pollTimer = setInterval(() => { void scan() }, 1000)
    // 心跳顺带保活 MV3 SW(端口消息重置 SW 空闲计时)
    const heartbeatTimer = setInterval(() => send({ event: 'heartbeat' }), 20_000)
    stopLongMode = () => {
      clearInterval(pollTimer)
      clearInterval(heartbeatTimer)
      if (watcher) watcher.close()
    }
    void scan()
  }

  try {
    let buffer = Buffer.alloc(0)
    const readFrame = () => {
      if (buffer.length < 4) return null
      const length = buffer.readUInt32LE(0)
      if (buffer.length < 4 + length) return null
      const body = buffer.subarray(4, 4 + length)
      buffer = buffer.subarray(4 + length)
      return body
    }
    for await (const chunk of input) {
      buffer = Buffer.concat([buffer, chunk])
      let frame
      while ((frame = readFrame())) {
        let message
        try {
          message = JSON.parse(frame.toString('utf8'))
        } catch {
          write({ ok: false, error: 'invalid json' })
          continue
        }
        if (isPlainObject(message) && message.method === 'connect') {
          startLongMode()
          write({ ok: true, connected: true })
          continue
        }
        const handler = isPlainObject(message) && typeof message.method === 'string'
          ? core.handlers[message.method]
          : null
        let response
        if (!handler) {
          response = { ok: false, error: `unknown method: ${isPlainObject(message) ? String(message.method) : '?'}` }
        } else {
          try {
            response = await handler(message.params ?? message.body ?? {})
          } catch (error) {
            response = { ok: false, error: error.message || String(error) }
            log({ level: 'error', message: `${message.method}: ${response.error}` }).catch(() => {})
          }
        }
        write(response)
      }
    }
  } finally {
    stopLongMode?.()
  }
}

// 直接执行才进主循环;被测试 import 时只取导出的纯函数
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main()
}
