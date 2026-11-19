/**
 * `dswritesync serve` — 本地常驻服务（Desk 协议 v1，ADR 0010）。
 *
 * 职责：
 * - WS 9527 接收扩展 hello / desk.* 事件；HTTP 9528 只绑回环，供 secondary 转发。
 * - 生成/复用 auth.json（0700 / 0600，best-effort）；token 不完整打印。
 * - 监听 outbox/publish-*.json：原子认领 → 图片管线 → syncArticle → 写 dispatch 回执。
 * - 监听 receipts/import-*.json：把宿主消化结果推回扩展 desk.capture-result。
 * - 保持进程存活；SIGINT/SIGTERM 优雅退出。不读写 state.json。
 */
import { randomUUID } from 'crypto'
import { chmod, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import chalk from 'chalk'
import { ExtensionBridge } from './bridge/index.js'
import { inlineTaskImages } from './media.js'
import { t } from './i18n.js'

export interface ServeOptions {
  token?: string
  host?: string
  wsPort?: number
  httpPort?: number
}

export interface DeskPaths {
  root: string
  inbox: string
  outbox: string
  receipts: string
  auth: string
  catalog: string
}

/** 与宿主 src/bridge.js 同一布局；DSH_HOME 覆盖用于测试与多环境。 */
export function deskPaths(env: NodeJS.ProcessEnv = process.env): DeskPaths {
  const root = join(env.DSH_HOME || join(homedir(), '.dsh'), 'writing-desk', 'bridge')
  return {
    root,
    inbox: join(root, 'inbox'),
    outbox: join(root, 'outbox'),
    receipts: join(root, 'receipts'),
    auth: join(root, 'auth.json'),
    catalog: join(root, 'catalog.json'),
  }
}

function toPort(value: unknown): number | null {
  const port = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

async function readJson(file: string): Promise<any | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await stat(file)
    return true
  } catch {
    return false
  }
}

/** 原子写 JSON；Windows 上 rename 覆盖可能报 EPERM/EEXIST，退化为先删再改名。 */
async function writeJsonAtomic(file: string, value: unknown, mode?: number): Promise<void> {
  const tmp = `${file}.tmp`
  await writeFile(tmp, JSON.stringify(value), mode === undefined ? undefined : { mode })
  if (mode !== undefined) {
    await chmod(tmp, mode).catch(() => {})
  }
  try {
    await rename(tmp, file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
    await rm(file, { force: true })
    await rename(tmp, file)
  }
}

async function ensureDirs(paths: DeskPaths): Promise<void> {
  for (const dir of [paths.root, paths.inbox, paths.outbox, paths.receipts]) {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700).catch(() => {})
  }
}

function maskToken(token: string): string {
  return token.length > 8 ? `…${token.slice(-4)}` : '••••'
}

/** 只允许安全字符进文件名，防止把 operationId 拼出目录穿越。 */
function safeOperationId(value: unknown): string | null {
  return typeof value === 'string' && /^[\w-]{1,200}$/.test(value) ? value : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function imageLog(message: string): void {
  const parts = message.split('|')
  if (parts[0] === 'inline') {
    console.log(chalk.gray(`  ${t('serve.imageConverted', { ref: parts[1] ?? '' })}`))
  } else if (parts[0] === 'upload') {
    console.log(chalk.gray(`  ${t('serve.imageUploaded', { ref: parts[1] ?? '', url: parts.slice(2).join('|') })}`))
  } else if (parts[0] === 'skip') {
    console.log(chalk.yellow(`  ${t('serve.imageSkipped', { ref: parts[1] ?? '' })}`))
  }
}

/**
 * 启动 serve 并常驻，直到 SIGINT/SIGTERM。
 */
export async function runServe(options: ServeOptions = {}): Promise<void> {
  const paths = deskPaths()

  const envWs = toPort(process.env.SYNC_WS_PORT)
  const envHttp = toPort(process.env.SYNC_HTTP_PORT)
  const wsPort = options.wsPort ?? envWs ?? 9527
  const httpPort = options.httpPort ?? envHttp ?? (wsPort + 1)

  if (!toPort(wsPort)) {
    console.error(chalk.red(t('serve.portInvalid', { port: wsPort })))
    process.exitCode = 1
    return
  }
  if (!toPort(httpPort)) {
    console.error(chalk.red(t('serve.portInvalid', { port: httpPort })))
    process.exitCode = 1
    return
  }
  if (wsPort === httpPort) {
    console.error(chalk.red(t('serve.portSame')))
    process.exitCode = 1
    return
  }

  await ensureDirs(paths)

  const existing = await readJson(paths.auth)
  const tokenFromExisting = typeof existing?.token === 'string' ? existing.token : ''
  const token = [options.token, process.env.WECHATSYNC_TOKEN, tokenFromExisting]
    .map(value => typeof value === 'string' ? value.trim() : '')
    .find(Boolean) || randomUUID()

  const host = options.host || '127.0.0.1'
  console.log(chalk.bold(t('serve.starting')))

  const bridge = new ExtensionBridge({
    host,
    port: wsPort,
    httpPort,
    token,
    authFile: paths.auth,
    silent: true,
    requirePrimary: true,
  })

  const startedAt = new Date()
  const startedAtMs = startedAt.getTime()
  let stopped = false

  bridge.onConnect((info) => {
    console.log(chalk.green(t('serve.extensionConnected', {
      version: info.version ?? '?',
      lang: info.lang ?? '?',
    })))
  })
  bridge.onDisconnect(() => {
    console.log(chalk.yellow(t('serve.extensionDisconnected')))
  })

  bridge.onEvent(async (event, payload, id) => {
    if (event === 'desk.capture') {
      await handleCapture(event, payload, id)
      return
    }
    if (event === 'desk.catalog-request') {
      const catalog = await readCatalog()
      if (!catalog) console.log(chalk.gray(t('serve.catalogMissing')))
      bridge.sendEvent('desk.catalog', catalog ?? { at: new Date().toISOString(), tags: [], urls: {} }, id)
      return
    }
    if (event === 'desk.log') {
      const data = isPlainObject(payload) ? payload : {}
      console.log(chalk.gray(t('serve.log', {
        level: String(data.level ?? 'info'),
        message: String(data.message ?? ''),
      })))
      return
    }
    console.log(chalk.gray(t('serve.ignoredEvent', { event })))
  })

  async function readCatalog(): Promise<{ at: string; tags: string[]; urls: Record<string, string> } | null> {
    const raw = await readJson(paths.catalog)
    if (!isPlainObject(raw)) return null
    const tags = Array.isArray(raw.tags)
      ? raw.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
      : []
    const urls: Record<string, string> = {}
    if (isPlainObject(raw.urls)) {
      for (const [url, itemId] of Object.entries(raw.urls)) {
        if (typeof itemId === 'string') urls[url] = itemId
      }
    }
    return {
      at: typeof raw.at === 'string' ? raw.at : new Date().toISOString(),
      tags,
      urls,
    }
  }

  async function handleCapture(_event: string, payload: unknown, id?: string): Promise<void> {
    if (!isPlainObject(payload)) {
      bridge.sendAck(id, { ok: false, error: t('serve.captureRejected', { error: t('serve.payloadRequired') }) })
      return
    }
    const operationId = safeOperationId(payload.operationId)
    if (!operationId) {
      bridge.sendAck(id, { ok: false, error: t('serve.captureRejected', { error: t('serve.operationIdRequired') }) })
      return
    }
    try {
      await writeJsonAtomic(join(paths.inbox, `import-${operationId}.json`), { ...payload, operationId })
      bridge.sendAck(id, { ok: true, operationId, queued: true })
      console.log(chalk.green(t('serve.captureQueued', { operationId })))
    } catch (error) {
      const message = (error as Error).message || String(error)
      bridge.sendAck(id, { ok: false, operationId, error: message })
      console.log(chalk.red(t('serve.captureWriteFailed', { error: message })))
    }
  }

  try {
    await bridge.start()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') {
      console.error(chalk.red(t('serve.portBusy', { port: `${wsPort}/${httpPort}` })))
    } else {
      console.error(chalk.red(t('serve.startFailed', { error: (error as Error).message || String(error) })))
    }
    process.exitCode = 1
    return
  }

  if (bridge.getMode() !== 'primary') {
    bridge.stop()
    console.error(chalk.red(t('serve.secondary')))
    process.exitCode = 1
    return
  }

  const auth = {
    v: 1,
    token,
    wsPort,
    httpPort,
    pid: process.pid,
    startedAt: startedAt.toISOString(),
  }
  try {
    await writeJsonAtomic(paths.auth, auth, 0o600)
    await chmod(paths.auth, 0o600).catch(() => {})
  } catch (error) {
    bridge.stop()
    console.error(chalk.red(t('serve.startFailed', { error: (error as Error).message || String(error) })))
    process.exitCode = 1
    return
  }

  console.log(chalk.green(t('serve.running', { host, wsPort, httpPort })))
  console.log(chalk.gray(t('serve.authWritten', { file: paths.auth })))
  console.log(chalk.gray(t('serve.tokenTail', { tail: maskToken(token) })))
  console.log(chalk.gray(t('serve.tokenHint')))

  // ============ outbox：工作台下发的发布任务 ============

  const MAX_TASK_RETRIES = 3
  const RETRY_DELAY_MS = 5000
  const taskAttempts = new Map<string, { count: number; nextAt: number }>()

  async function claim(file: string): Promise<boolean> {
    try {
      await rename(file, `${file}.claiming`)
      return true
    } catch {
      return false
    }
  }

  async function processClaimed(file: string): Promise<void> {
    const claiming = `${file}.claiming`
    try {
      const task = JSON.parse(await readFile(claiming, 'utf8'))
      const operationId = safeOperationId(task?.operationId)
      if (!operationId) throw new Error(t('serve.operationIdRequired'))

      const receiptFile = join(paths.receipts, `dispatch-${operationId}.json`)
      if (await fileExists(receiptFile)) {
        console.log(chalk.gray(t('serve.taskSkipped', { operationId })))
        await rm(claiming, { force: true })
        return
      }

      const platforms = Array.isArray(task.platforms)
        ? task.platforms.filter((platform: unknown): platform is string => typeof platform === 'string' && platform.length > 0)
        : []
      if (!platforms.length) throw new Error(t('serve.platformsRequired'))

      const itemId = String(task.itemId ?? '')
      const title = typeof task.title === 'string' ? task.title : ''
      const articleMd = typeof task.articleMd === 'string' ? task.articleMd : ''
      console.log(chalk.cyan(t('serve.taskReceived', { operationId, platforms: platforms.join(', ') })))

      const images = await inlineTaskImages(articleMd, task.images, bridge, platforms[0], imageLog)

      let results: Array<{ platform: string; ok: boolean; url?: string; error?: string }>
      try {
        const response = await bridge.request<any>('syncArticle', {
          platforms,
          article: { title, markdown: images.content },
        })
        const rows = Array.isArray(response) ? response : (Array.isArray(response?.results) ? response.results : [])
        results = platforms.map((platform: string) => {
          const row = rows.find((candidate: any) => candidate && candidate.platform === platform)
          if (!row) return { platform, ok: false, error: t('serve.resultMissing') }
          const mapped: { platform: string; ok: boolean; url?: string; error?: string } = {
            platform,
            ok: row.success === true,
          }
          if (typeof row.postUrl === 'string' && row.postUrl) mapped.url = row.postUrl
          if (row.success !== true) {
            mapped.error = typeof row.error === 'string' && row.error ? row.error : t('serve.resultMissing')
          }
          return mapped
        })
      } catch (error) {
        const message = ((error as Error).message || String(error)).slice(0, 200)
        console.log(chalk.red(t('serve.taskFailed', { operationId, error: message })))
        results = platforms.map((platform: string) => ({ platform, ok: false, error: message }))
      }

      await writeJsonAtomic(receiptFile, {
        operationId,
        itemId,
        ok: results.some(row => row.ok),
        results,
        at: new Date().toISOString(),
      })
      await rm(claiming, { force: true })

      const summary = results.map(row => `${row.platform}:${row.ok ? '✓' : '✗'}`).join(' ')
      console.log(chalk.green(t('serve.taskDone', { operationId, summary })))
    } catch (error) {
      const message = (error as Error).message || String(error)
      console.log(chalk.red(t('serve.taskInvalid', { error: message })))
      await rename(claiming, `${file}.failed`).catch(() => {})
    }
  }

  let scanningOutbox = false
  async function scanOutbox(): Promise<void> {
    if (scanningOutbox || stopped) return
    scanningOutbox = true
    try {
      let names: string[] = []
      try {
        names = await readdir(paths.outbox)
      } catch {
        return
      }
      for (const name of names) {
        if (!/^publish-[\w-]+\.json$/.test(name)) continue
        const file = join(paths.outbox, name)
        const attempt = taskAttempts.get(name) ?? { count: 0, nextAt: 0 }
        if (Date.now() < attempt.nextAt) continue

        if (!bridge.hasClient()) {
          attempt.count += 1
          if (attempt.count <= MAX_TASK_RETRIES) {
            attempt.nextAt = Date.now() + RETRY_DELAY_MS
            taskAttempts.set(name, attempt)
            console.log(chalk.gray(t('serve.taskWaiting', {
              operationId: name.slice('publish-'.length, -'.json'.length),
              count: attempt.count,
              max: MAX_TASK_RETRIES,
            })))
            continue
          }
        }

        taskAttempts.delete(name)
        if (!await claim(file)) continue
        await processClaimed(file)
      }
    } finally {
      scanningOutbox = false
    }
  }

  // ============ receipts：宿主消化 import 后推回扩展 ============

  const seenImportReceipts = new Set<string>()
  let scanningReceipts = false
  async function pushCaptureResults(): Promise<void> {
    if (scanningReceipts || stopped) return
    scanningReceipts = true
    try {
      let names: string[] = []
      try {
        names = await readdir(paths.receipts)
      } catch {
        return
      }
      for (const name of names) {
        if (!/^import-[\w-]+\.json$/.test(name) || seenImportReceipts.has(name)) continue
        const file = join(paths.receipts, name)
        let info
        try {
          info = await stat(file)
        } catch {
          continue
        }
        // serve 启动前留下的旧回执直接标记，避免重启后重复推送。
        if (info.mtimeMs < startedAtMs - 2000) {
          seenImportReceipts.add(name)
          continue
        }
        if (!bridge.hasClient()) continue

        const body = await readJson(file)
        if (!body || typeof body !== 'object') {
          seenImportReceipts.add(name)
          continue
        }
        seenImportReceipts.add(name)

        const operationId = typeof body.operationId === 'string'
          ? body.operationId
          : name.slice('import-'.length, -'.json'.length)
        const payload: Record<string, unknown> = {
          operationId,
          ok: body.ok === true,
        }
        if (typeof body.itemId === 'string') payload.itemId = body.itemId
        if (typeof body.error === 'string') payload.error = body.error
        if (body.replay === true) payload.duplicate = true
        if (body.replaced === true) payload.replaced = true

        bridge.sendEvent('desk.capture-result', payload)
        console.log(chalk.green(t('serve.captureResult', { operationId })))
      }
    } finally {
      scanningReceipts = false
    }
  }

  const outboxTimer = setInterval(() => { void scanOutbox() }, 1000)
  const receiptsTimer = setInterval(() => { void pushCaptureResults() }, 1000)
  void scanOutbox()
  void pushCaptureResults()

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      if (stopped) return
      stopped = true
      clearInterval(outboxTimer)
      clearInterval(receiptsTimer)
      bridge.stop()
      console.log(chalk.gray(t('serve.stopped')))
      resolve()
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
  })
}