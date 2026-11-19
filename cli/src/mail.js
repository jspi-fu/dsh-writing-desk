// 投递箱(ADR 0009):与宿主 src/bridge.js 同一套目录约定与认领语义。
// 桥是投递箱的另一半:写 inbox(采集)、监听 outbox(发布任务)、写 dispatch 回执、等 import 回执。
// 认领同样是原子 rename——CLI 与两个宿主进程并发时只有一个能拿到文件。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export function mailPaths(env = process.env) {
  const home = env.DSH_HOME || join(homedir(), '.dsh')
  const root = join(home, 'writing-desk', 'bridge')
  return { root, inbox: join(root, 'inbox'), outbox: join(root, 'outbox'), receipts: join(root, 'receipts'), auth: join(root, 'auth.json') }
}

export async function ensureMailDirs() {
  const paths = mailPaths()
  for (const dir of [paths.root, paths.inbox, paths.outbox, paths.receipts]) {
    await mkdir(dir, { recursive: true })
  }
  return paths
}

/** 写 auth.json(0600):host 设置页从这里读连接信息,扩展的 Token 也从这里发。 */
export async function writeAuth(token, wsPort, httpPort) {
  const paths = await ensureMailDirs()
  const payload = { v: 1, token, wsPort, httpPort, pid: process.pid, startedAt: new Date().toISOString() }
  await writeFile(`${paths.auth}.tmp`, JSON.stringify(payload), { mode: 0o600 })
  await rename(`${paths.auth}.tmp`, paths.auth)
  return payload
}

export async function readAuth() {
  try {
    const raw = JSON.parse(await readFile(mailPaths().auth, 'utf8'))
    return raw?.token ? raw : null
  } catch {
    return null
  }
}

async function claim(file) {
  try {
    await rename(file, `${file}.claiming`)
    return true
  } catch {
    return false
  }
}

/**
 * 把一份采集投进 inbox,等宿主写回 import 回执。
 * 宿主消化是异步的(3 秒轮询 + 读 state 前顺手),这里轮询回执最长 waitMs。
 * @returns {Promise<{ok: boolean, itemId?: string, error?: string}>}
 */
export async function deliverCapture(payload, waitMs = 30000) {
  const paths = await ensureMailDirs()
  const file = join(paths.inbox, `import-${payload.operationId}.json`)
  // 已有同编号回执:直接复用,不再落第二份投递(宿主侧回执记忆也是同一语义)
  const existing = await readReceipt(`import-${payload.operationId}.json`)
  if (existing) return existing
  await writeFile(`${file}.tmp`, JSON.stringify(payload))
  await rename(`${file}.tmp`, file)
  const deadline = Date.now() + waitMs
  for (;;) {
    const receipt = await readReceipt(`import-${payload.operationId}.json`)
    if (receipt) return receipt
    if (Date.now() > deadline) return { ok: false, error: '宿主没有在 30 秒内消化这次采集(DSH 没在运行?)' }
    await delay(400)
  }
}

export async function readReceipt(name) {
  try {
    return JSON.parse(await readFile(join(mailPaths().receipts, name), 'utf8'))
  } catch {
    return null
  }
}

/** 写发布回执给宿主消化;同名重写取后到者,宿主回执记忆保证幂等。 */
export async function writeDispatchReceipt(operationId, receipt) {
  const paths = await ensureMailDirs()
  const file = join(paths.receipts, `dispatch-${operationId}.json`)
  await writeFile(`${file}.tmp`, JSON.stringify({ ...receipt, operationId }))
  await rename(`${file}.tmp`, file)
}

/**
 * 认领一份发布任务:rename 成功才算拿到,读出任务内容并删掉认领文件。
 * @returns {Promise<object|null>} 任务载荷。
 */
export async function claimPublishTask(name) {
  const paths = mailPaths()
  const file = join(paths.outbox, name)
  if (!/^publish-[\w-]+\.json$/.test(name)) return null
  if (!await claim(file)) return null
  try {
    const payload = JSON.parse(await readFile(`${file}.claiming`, 'utf8'))
    await rm(`${file}.claiming`, { force: true })
    return payload
  } catch {
    await rename(`${file}.claiming`, `${file}.failed`).catch(() => {})
    return null
  }
}

/**
 * 监听 outbox:fs.watch 为主、1.5s 轮询兜底(Windows 的 watch 事件不可靠)。
 * @param {(name: string) => void} onTask - 回调收到的是 outbox 文件名。
 * @returns {Promise<() => Promise<void>>} 停止函数。
 */
export async function watchOutbox(onTask) {
  const paths = await ensureMailDirs()
  const { watch } = await import('node:fs')
  let stopped = false
  const seen = new Set()
  const sweep = async () => {
    if (stopped) return
    let names = []
    try {
      names = (await readdir(paths.outbox)).filter(name => /^publish-[\w-]+\.json$/.test(name) && !seen.has(name))
    } catch {
      return
    }
    for (const name of names) {
      seen.add(name)
      onTask(name)
    }
  }
  const watcher = watch(paths.outbox, { persistent: false }, () => { sweep() })
  const timer = setInterval(() => { sweep() }, 1500)
  timer.unref?.()
  await sweep()
  return async () => {
    stopped = true
    clearInterval(timer)
    watcher.close()
  }
}

export function newOperationId() {
  return randomUUID()
}

/** 任务里的图片读成 data URI:键保持正文里的相对引用,扩展据此替换。 */
export async function loadTaskImages(task, { maxPerImage = 4 * 1024 * 1024, maxTotal = 8 * 1024 * 1024 } = {}) {
  const images = {}
  let total = 0
  for (const [ref, path] of Object.entries(task.images ?? {})) {
    const buffer = await readFile(path)
    if (buffer.length > maxPerImage) throw new Error(`图片 ${ref} 超过 4MB`)
    total += buffer.length
    if (total > maxTotal) throw new Error('图片总量超过 8MB,先删几张配图再投递')
    const mime = /\.png$/i.test(ref) ? 'image/png' : /\.webp$/i.test(ref) ? 'image/webp' : /\.gif$/i.test(ref) ? 'image/gif' : 'image/jpeg'
    images[ref] = `data:${mime};base64,${buffer.toString('base64')}`
  }
  return images
}

export function sha256(text) {
  return createHash('sha256').update(text).digest('hex')
}
