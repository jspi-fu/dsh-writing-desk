// wdesk 命令行(ADR 0009)。命令面沿用 Wechatsync CLI 的心智(sync/platforms/extract),
// 实现全部重写:桥即本进程,发布发生在浏览器扩展里、只到草稿箱。
// 手写参数解析,不引 commander——本仓库零依赖纪律。
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Bridge } from './bridge.js'
import { deliverCapture } from './mail.js'
import { ADAPTER_IDS } from './proto.js'

const HELP = `wdesk——图文创作台的本地桥与命令行

用法:
  wdesk serve                       起桥(常驻):扩展采集进灵感墙、成稿投递到平台草稿箱
  wdesk sync <file> [选项]           把一篇 Markdown/HTML 文章投给扩展,发到各平台草稿箱
  wdesk platforms [--auth]          列出各平台与登录状态(经扩展)
  wdesk extract [-o out.md]         让扩展提取浏览器当前页的正文
  wdesk help                        本说明

sync 选项:
  -p, --platforms <列表>   目标平台,逗号分隔:${ADAPTER_IDS.join('/')} (默认全部)
  --title <标题>           覆盖文章标题
  --cover <路径>           封面图片文件
  --dry-run                只检查登录态与图片,不提交
  --timeout <秒>           等扩展完成的上限(默认 600)

环境变量:
  WDESK_WS_PORT / WDESK_HTTP_PORT   桥端口(默认 4527 / 4528)
  WDESK_TOKEN                        复用已生成的桥 Token(缺省从 auth.json 读,没有则生成)`

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '-p' || item === '--platforms') args.platforms = argv[++i]
    else if (item === '--title') args.title = argv[++i]
    else if (item === '--cover') args.cover = argv[++i]
    else if (item === '--dry-run') args.dryRun = true
    else if (item === '--auth') args.auth = true
    else if (item === '-o' || item === '--output') args.output = argv[++i]
    else if (item === '--timeout') args.timeout = Number(argv[++i])
    else if (item === '--help' || item === '-h') args.help = true
    else if (item === '--token') args.token = argv[++i]
    else args._.push(item)
  }
  return args
}

const log = text => console.log(text)

async function resolveToken(explicit) {
  if (explicit) return explicit
  const { readAuth } = await import('./mail.js')
  const auth = await readAuth()
  if (auth?.token) return auth.token
  return randomUUID()
}

/** 起一个临时桥;已有桥在跑时改走它的 HTTP API。返回 {bridge|proxy, stop}。 */
async function createBridge({ token, timeoutHint } = {}) {
  const wsPort = Number(process.env.WDESK_WS_PORT || 4527)
  const httpPort = Number(process.env.WDESK_HTTP_PORT || 4528)
  const bridge = new Bridge({ wsPort, httpPort, token, log })
  try {
    await bridge.start()
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err
    // 已有常驻桥:借它的 HTTP 通道发请求
    log('检测到 wdesk 桥已在运行,直接借用。')
    return {
      proxy: true,
      request: (method, params) => httpProxyRequest(httpPort, token, method, params, timeoutHint),
      stop: async () => {},
    }
  }
  log('等浏览器扩展连接…(第一次使用请先把设置页里的 Token 粘进扩展)')
  const deadline = Date.now() + 60000
  while (!bridge.connected) {
    if (Date.now() > deadline) throw new Error('60 秒内没有等到扩展。请确认浏览器扩展已安装、token 已配对。')
    await new Promise(r => setTimeout(r, 300))
  }
  return { bridge, request: (method, params) => bridge.request(method, params), stop: () => bridge.stop() }
}

async function httpProxyRequest(httpPort, token, method, params, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 600000)
  timer.unref?.()
  try {
    const res = await fetch(`http://127.0.0.1:${httpPort}/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ method, params }),
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `桥返回 ${res.status}`)
    if (!data.ok) throw new Error(data.error || '桥返回错误')
    return data.result
  } finally {
    clearTimeout(timer)
  }
}

/** 找出 Markdown 引用的本地图,读成 data URI;正文原样保留相对引用,
 *  扩展侧按 images 映射(ref → dataUri)替换并上传到目标平台。 */
async function inlineLocalImages(markdown, baseDir) {
  const images = {}
  const pattern = /!\[[^\]]*\]\(([^)\s]+)\)/g
  let total = 0
  for (const match of markdown.matchAll(pattern)) {
    const ref = match[1]
    if (/^(https?:|data:)/.test(ref) || images[ref]) continue
    const path = isAbsolute(ref) ? ref : join(baseDir, decodeURIComponent(ref))
    let buffer
    try {
      buffer = await readFile(path)
    } catch {
      continue // 读不到的引用保留原样,由平台侧决定怎么处理
    }
    if (buffer.length > 4 * 1024 * 1024) throw new Error(`图片 ${ref} 超过 4MB`)
    total += buffer.length
    if (total > 8 * 1024 * 1024) throw new Error('图片总量超过 8MB,先删几张再投递')
    const mime = /\.png$/i.test(ref) ? 'image/png' : /\.webp$/i.test(ref) ? 'image/webp' : /\.gif$/i.test(ref) ? 'image/gif' : 'image/jpeg'
    images[ref] = `data:${mime};base64,${buffer.toString('base64')}`
  }
  return { images }
}

async function parseTitle(markdown, explicit) {
  if (explicit) return explicit
  const heading = /^#\s+(.+)$/m.exec(markdown)
  if (heading) return heading[1].trim()
  return ''
}

async function commandSync(args) {
  const file = args._[1]
  if (!file) throw new Error('sync 需要一个 .md 或 .html 文件路径')
  const path = resolve(file)
  if (!(await stat(path)).isFile()) throw new Error(`找不到文件 ${path}`)
  const raw = await readFile(path, 'utf8')
  const title = await parseTitle(raw, args.title)
  if (!title) throw new Error('标题缺失:文件里放一个 # 一级标题,或用 --title 传入')
  const platforms = args.platforms ? args.platforms.split(/[,\s]+/).filter(Boolean) : [...ADAPTER_IDS]
  for (const platform of platforms) {
    if (!ADAPTER_IDS.includes(platform)) throw new Error(`不支持的平台 ${platform};可选:${ADAPTER_IDS.join('/')}`)
  }
  const { images } = await inlineLocalImages(raw, dirname(path))
  // 上游 CLI 的双策略里我们只取默认那一条:本地图全部内嵌成 data URI,由各平台适配器上传转存
  if (args.cover) {
    const buffer = await readFile(resolve(args.cover))
    images['cover'] = `data:image/${/\.png$/i.test(args.cover) ? 'png' : 'jpeg'};base64,${buffer.toString('base64')}`
  }
  const session = await createBridge({ token: await resolveToken(args.token), timeoutHint: (args.timeout || 600) * 1000 })
  try {
    if (args.dryRun) {
      log(`--dry-run:检查 ${platforms.join(', ')} 的登录态与图片(${Object.keys(images).length} 张),不提交。`)
      const auth = await session.request('platforms', { forceRefresh: true }, 30000)
      for (const row of auth) log(`  ${row.id}: ${row.authenticated ? '已登录' : '未登录'}`)
      const missing = platforms.filter(id => !auth.find(row => row.id === id)?.authenticated)
      if (missing.length) {
        log(`未登录的平台: ${missing.join(', ')}——先在浏览器里登录再同步。`)
        return 2
      }
      log('检查通过。去掉 --dry-run 即提交。')
      return 0
    }
    const result = await session.request('publish', { operationId: newOperationId(), title, markdown: raw, images, platforms }, (args.timeout || 600) * 1000)
    let failed = 0
    for (const row of result.results) {
      if (row.ok) log(`✓ ${row.platform}${row.url ? ` → ${row.url}` : ' → 已到草稿箱'}`)
      else { failed += 1; log(`✗ ${row.platform}: ${row.error || '失败'}`) }
    }
    log('发布只到草稿箱:去平台确认后正式发布。')
    return failed ? 2 : 0
  } finally {
    await session.stop()
  }
}

async function commandPlatforms(args) {
  const session = await createBridge({ token: await resolveToken(args.token) })
  try {
    const rows = await session.request('platforms', { forceRefresh: Boolean(args.auth) }, 30000)
    for (const row of rows) log(`${row.id.padEnd(10)} ${row.authenticated ? '已登录' : '未登录'}${row.user ? ` ${row.user}` : ''}`)
    return 0
  } finally {
    await session.stop()
  }
}

async function commandExtract(args) {
  const session = await createBridge({ token: await resolveToken(args.token) })
  try {
    const article = await session.request('extract', {}, 60000)
    if (!article) {
      log('当前页没有提取到正文。')
      return 2
    }
    const text = `# ${article.title ?? ''}\n\n${article.markdown ?? article.body ?? ''}`
    if (args.output) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(resolve(args.output), text)
      log(`已写入 ${resolve(args.output)}`)
    } else {
      log(text.slice(0, 500))
    }
    return 0
  } finally {
    await session.stop()
  }
}

async function commandServe(args) {
  const token = await resolveToken(args.token)
  const wsPort = Number(process.env.WDESK_WS_PORT || 4527)
  const bridge = new Bridge({ wsPort, httpPort: Number(process.env.WDESK_HTTP_PORT || 4528), token, log })
  try {
    await bridge.start()
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      log('wdesk 桥已经在运行(端口被占),不需要再起一个。')
      return 0
    }
    throw err
  }
  log(`桥在运行。桥接 Token:${token}`)
  log('把工作台设置页显示的 Token 粘进扩展设置即可配对;Ctrl+C 退出。')
  const goodbye = () => { bridge.stop().finally(() => process.exit(0)) }
  process.on('SIGINT', goodbye)
  process.on('SIGTERM', goodbye)
  await new Promise(() => {}) // 常驻
}

export async function main(argv) {
  const args = parseArgs(argv)
  if (args.help || !args._.length || args._[0] === 'help') {
    log(HELP)
    return 0
  }
  switch (args._[0]) {
    case 'serve': return commandServe(args)
    case 'sync': return commandSync(args)
    case 'platforms': case 'ls': return commandPlatforms(args)
    case 'extract': return commandExtract(args)
    case 'capture': {
      // 隐藏命令:把一段 JSON 载荷按采集协议送进投递箱(调试用)
      const payload = JSON.parse(await readFile(args._[1] ?? '-', 'utf8'))
      payload.operationId ??= newOperationId()
      const receipt = await deliverCapture(payload)
      log(JSON.stringify(receipt))
      return receipt.ok ? 0 : 2
    }
    default:
      log(HELP)
      return 1
  }
}
