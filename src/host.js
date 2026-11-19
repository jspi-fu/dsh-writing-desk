// dsh-writing-desk host 半片：/writing-desk/* 接口、文件服务。
// 成稿在 DSH 创作会话里发生(ADR 0006),这里只剩数据、看板与人工介入的服务面,没有任何模型调用。
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIDGE_ADAPTERS, bridgeStatus, digestInbox, digestReceipts, writeCatalog, writePublishTask } from './bridge.js'
import { defaultExportDir, resolveExportDir, saveProduction } from './export.js'
import { exportForCli } from './publish.js'
import { harvest, harvestText } from './harvest.js'
import { exportSkill } from './learn.js'
import { applyOps, newId } from './ops.js'
import { migrateMediaDesk, summarizeMediaDesk } from './migrate.js'
import { publicSettings, Settings } from './settings.js'
import { dshHome, Store } from './store.js'
import { currentLang, tr, withLang } from './i18n.js'
import { localizeSamples, samplesNeedLocale } from './seed.js'
import { createVersionCheck } from './version.js'

const ASSETS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const MAX_JSON = 4_000_000
const MAX_UPLOAD = 250_000_000
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.pdf': 'application/pdf' }
const UPLOAD_EXT = Object.fromEntries(Object.entries(MIME).filter(([ext]) => ext !== '.jpeg').map(([ext, type]) => [type, ext]))
// 文件页也收文档:上传按文件名取扩展名,落盘后统一用 octet-stream 下载回去。
const FILE_EXT = new Set([
  ...Object.keys(MIME), '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.txt', '.md', '.json',
  '.zip', '.epub', '.rtf', '.pages', '.key', '.numbers', '.mp3', '.aac', '.ogg',
])
const UNSAFE_EXT = new Set(['.html', '.htm', '.svg', '.js', '.mjs', '.cjs', '.exe', '.bat', '.cmd', '.ps1', '.sh', '.msi', '.dll'])

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

async function readBuffer(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error(tr('内容太大')), { status: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req) {
  const raw = await readBuffer(req, MAX_JSON)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw Object.assign(new Error(tr('请求不是有效的 JSON')), { status: 400 })
  }
}

/** 支持 Range，视频才能正常拖动和循环。 */
async function sendFile(req, res, file, { anyType = false } = {}) {
  // 素材文件允许任意已知扩展名:浏览器里当附件下载/打开,不猜 content-type
  const type = MIME[extname(file).toLowerCase()] ?? (anyType ? 'application/octet-stream' : null)
  if (!type) return json(res, 404, { error: tr('不支持的文件类型') })
  let info
  try {
    info = await stat(file)
  } catch {
    return json(res, 404, { error: tr('文件不存在') })
  }
  res.setHeader('content-type', type)
  res.setHeader('accept-ranges', 'bytes')
  res.setHeader('cache-control', 'private, max-age=3600')
  res.setHeader('x-content-type-options', 'nosniff')
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
    if (start >= info.size || start > end) {
      res.statusCode = 416
      res.setHeader('content-range', `bytes */${info.size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`)
    res.setHeader('content-length', end - start + 1)
    return createReadStream(file, { start, end }).pipe(res)
  }
  res.statusCode = 200
  res.setHeader('content-length', info.size)
  if (req.method === 'HEAD') return res.end()
  return createReadStream(file).pipe(res)
}

/**
 * 粘贴链接时的预读:把页面元信息整理成对话框能直接填的形状,不写 Store。
 * 只允许 http(s) 公网地址(harvest 内部已拦内网与跳转)。
 * @param {string} url - 用户粘进来的链接。
 * @param {typeof fetch} [fetchImpl] - 便于测试替换。
 * @returns {Promise<{url: string, title: string, description: string, image: string, siteName: string}>} 预填字段。
 */
export async function previewUrl(url, fetchImpl = fetch) {
  const info = await harvest(url, fetchImpl)
  return {
    url: info.url,
    title: info.title ?? '',
    description: info.description ?? '',
    image: info.image ?? '',
    siteName: info.siteName ?? '',
  }
}

async function addFromUrl(ctx, store, body) {
  const url = String(body.url || '').trim()
  const info = await harvest(url)
  const op = {
    op: 'add_item', kind: 'web', title: body.title || info.title || url, body: body.note || info.description || '', url: info.url,
    source: body.source || info.siteName, tags: Array.isArray(body.tags) ? body.tags : [], contentOrigin: body.contentOrigin,
    media: body.cover || info.image ? { src: body.cover || info.image } : null,
  }
  return store.mutate(tr('收藏《{title}》', { title: op.title.slice(0, 12) }), (draft) => {
    const { receipts, errors } = applyOps(draft, [op])
    return { receipts, errors, id: receipts[0]?.target, state: draft }
  })
}

async function handleUpload(req, store, res) {
  const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  let declared = ''
  try { declared = decodeURIComponent(String(req.headers['x-writing-desk-name'] || '')) } catch { declared = '' }
  const byName = extname(declared).toLowerCase()
  const ext = UNSAFE_EXT.has(byName) ? '' : FILE_EXT.has(byName) ? byName : UPLOAD_EXT[type]
  if (!ext) return json(res, 415, { error: tr('不支持这种文件：{type}', { type: byName || type || tr('未知') }) })
  const buffer = await readBuffer(req, MAX_UPLOAD)
  await store.read()
  const name = `${newId('f')}${ext}`
  await writeFile(join(store.filesDir, name), buffer)
  const kind = MIME[ext]?.startsWith('video/') ? 'video' : MIME[ext]?.startsWith('image/') ? 'image' : 'file'
  return json(res, 200, { src: `writing-desk/files/${name}`, kind, name: declared || name, size: buffer.length })
}

/** 自媒体工作台的数据目录与素材搜索路径:插件资源可能装在任一 profile 下。 */
function mediaDeskPaths() {
  const home = dshHome()
  return {
    home,
    state: join(home, 'media-desk', 'state.json'),
    roots: [join(home, 'media-desk', 'assets'), join(home, 'media-desk', 'files')],
  }
}

async function readMediaDesk() {
  const paths = mediaDeskPaths()
  try {
    const raw = JSON.parse(await readFile(paths.state, 'utf8'))
    if (!Array.isArray(raw.items)) throw Object.assign(new Error(tr('自媒体工作台的数据格式不认识')), { status: 400 })
    return { raw, paths }
  } catch (err) {
    if (err.code === 'ENOENT') throw Object.assign(new Error(tr('没有找到自媒体工作台的数据')), { status: 404 })
    throw err
  }
}

function safeBase(src) {
  const base = String(src || '').split(/[\\/]/).pop() || ''
  return /^[\w.-]+$/.test(base) ? base : ''
}

/** 在已知目录与 profile 插件目录里找一个素材文件。 */
async function findAsset(paths, src) {
  const base = safeBase(src)
  if (!base) return null
  const candidates = [...paths.roots.map(root => join(root, base))]
  try {
    for (const name of await readdir(join(paths.home, 'profiles'))) {
      candidates.push(join(paths.home, 'profiles', name, 'node_modules', 'dsh-media-desk', 'assets', base))
      candidates.push(join(paths.home, 'profiles', name, 'node_modules', 'dsh-media-desk', 'files', base))
    }
  } catch { /* 没有 profiles 目录就只用 media-desk 自己的目录 */ }
  for (const file of candidates) {
    try {
      if ((await stat(file)).isFile()) return file
    } catch { /* 继续找下一个 */ }
  }
  return null
}

async function copyMigrationMedia(raw, paths, filesDir) {
  const map = new Map()
  await mkdir(filesDir, { recursive: true })
  for (const item of raw.items) {
    for (const src of [item?.media?.src, item?.media?.poster]) {
      if (!src || map.has(src)) continue
      const file = await findAsset(paths, src)
      if (!file) continue
      const name = `md-${safeBase(src)}`
      await copyFile(file, join(filesDir, name))
      map.set(src, { src: `writing-desk/files/${name}` })
    }
  }
  return map
}

// 投递箱消化(ADR 0009):浏览器采集进灵感墙、发布回执成 dispatches。
// 桌面与网页两个宿主进程可能同时跑,消化靠桥模块里的原子 rename 认领互斥,重复调度无害。
// 进程内不重入(promise 锁),间隔 3 秒兜底 + 读 state 前顺手消化一次保证即时性。
let digesting = null
function digestBridge(store) {
  if (digesting) return digesting
  digesting = (async () => {
    try {
      await digestInbox(store, store.filesDir)
      await digestReceipts(store)
      // 另一宿主进程改了 state 也不会通知这里,3 秒轮询顺手把 catalog 对齐
      await writeCatalog(store)
    } catch { /* 投递箱损坏不应打断页面路由,下轮再试 */ }
  })().finally(() => { digesting = null })
  return digesting
}

async function route(ctx, store, desk, req, res) {
  const url = new URL(req.url || '/', 'http://local')
  const path = url.pathname.replace(/^\/writing-desk\/?/, '')
  const method = req.method || 'GET'

  if ((method === 'GET' || method === 'HEAD') && path.startsWith('assets/')) {
    const name = path.slice('assets/'.length)
    if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: tr('路径无效') })
    return sendFile(req, res, join(ASSETS_DIR, name))
  }
  if ((method === 'GET' || method === 'HEAD') && path.startsWith('files/')) {
    const name = path.slice('files/'.length)
    if (!/^[\w.-]+$/.test(name)) return json(res, 400, { error: tr('路径无效') })
    await store.read()
    return sendFile(req, res, join(store.filesDir, name), { anyType: true })
  }
  if (method === 'GET') {
    if (path === 'state') {
      await digestBridge(store)
      let state = await store.read()
      // 示例数据跟着界面语言走；用户自己的内容不动
      if (samplesNeedLocale(state, currentLang())) state = await store.mutate('', draft => (localizeSamples(draft, currentLang()), draft), { undoable: false })
      return json(res, 200, { state, canUndo: store.undo.length > 0 })
    }
    if (path === 'settings') return json(res, 200, { ...publicSettings(await desk.settings.read()), defaultExportDir: defaultExportDir() })
    // 设置页的桥接区块(ADR 0009):连接信息由 dswritesync serve 写进 auth.json,这里只读。
    if (path === 'bridge/status') return json(res, 200, await bridgeStatus())
    // 设置页的迁移入口:只读概览,不落库。迁移本身走下面的 POST migrate。
    if (path === 'migrate/preview') {
      try {
        const { raw } = await readMediaDesk()
        const state = await store.read()
        return json(res, 200, { found: true, ...summarizeMediaDesk(raw), migratedAt: state.migrations?.['dsh-media-desk'] ?? null })
      } catch (err) {
        if (err.status === 404) return json(res, 200, { found: false, migratedAt: (await store.read()).migrations?.['dsh-media-desk'] ?? null })
        throw err
      }
    }
    if (path === 'version') return json(res, 200, await desk.versionCheck.read())
    return json(res, 404, { error: tr('接口不存在') })
  }
  if (method !== 'POST') return json(res, 405, { error: tr('不支持的方法') })

  // 所有写操作都拒绝跨站请求
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return json(res, 403, { error: tr('拒绝跨站请求') })

  if (path === 'upload') return handleUpload(req, store, res)
  if (path === 'migrate') {
    const { raw, paths } = await readMediaDesk()
    const media = await copyMigrationMedia(raw, paths, store.filesDir)
    const result = await store.mutate(tr('从自媒体工作台迁移'), (draft) => migrateMediaDesk(draft, raw, { media }))
    return json(res, 200, { ...result, state: await store.read() })
  }
  const body = await readJson(req)
  switch (path) {
    case 'ops': {
      const label = typeof body.label === 'string' ? body.label : tr('操作')
      const result = await store.mutate(label, (draft) => {
        const applied = applyOps(draft, body.ops)
        return { ...applied, state: draft }
      }, { undoable: body.undoable !== false })
      return json(res, 200, result)
    }
    case 'undo': {
      const label = await store.undoLast()
      await writeCatalog(store).catch(() => {})
      return json(res, 200, { label, state: await store.read(), canUndo: store.undo.length > 0 })
    }
    case 'production/save': {
      const settings = await desk.settings.read()
      const state = await store.read()
      const item = state.items.find(row => row.id === body.id)
      if (!item?.production?.article) return json(res, 400, { error: tr('还没有可以保存的成稿') })
      const saved = await saveProduction(item.production, { filesDir: store.filesDir, exportDir: resolveExportDir(settings.exportDir) })
      const next = await store.mutate('保存成稿', (draft) => {
        const target = draft.items.find(row => row.id === body.id)
        if (target?.production) {
          target.production.savedPath = saved.path
          target.production.savedHashes = saved.hashes
          target.production.savedAt = new Date().toISOString()
        }
        return draft
      }, { undoable: false })
      return json(res, 200, { ...saved, state: next })
    }
    case 'production/reveal': {
      // 路径只取自保存记录，不接受请求里传来的路径
      const state = await store.read()
      const path = state.items.find(row => row.id === body.id)?.production?.savedPath
      if (!path) return json(res, 400, { error: tr('还没有保存过') })
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(command, [path], () => {})
      return json(res, 200, { path })
    }
    case 'settings': {
      const updated = await desk.settings.update(body)
      return json(res, 200, { ...publicSettings(updated), defaultExportDir: defaultExportDir() })
    }
    case 'capture-url': return json(res, 200, await addFromUrl(ctx, store, body))
    // 粘贴链接时的预读:只把页面元信息回给对话框(标题/简介/封面/站点名),不落库。
    // 参考项目导入收藏时粘链接 650ms 后自动补字段,这里同一套动作。
    case 'preview-url': return json(res, 200, await previewUrl(String(body.url || '').trim()))
    // 只抓正文不调模型(ADR 0006):风格页把抓到的文字交给创作会话提炼,模型调用在会话侧。
    case 'harvest-text': {
      const urls = (Array.isArray(body.urls) ? body.urls : []).map(row => String(row).trim()).filter(Boolean).slice(0, 5)
      const failures = []
      const parts = []
      for (const url of urls) {
        try {
          const page = await harvestText(url)
          if (page.text.length >= 80) parts.push(`${page.title ?? ''}\n${page.text}`)
          else failures.push(tr('{url}：页面上几乎没有文字，可能需要登录', { url }))
        } catch (err) {
          failures.push(tr('{url}：{error}', { url, error: err.message }))
        }
      }
      return json(res, 200, { text: parts.join('\n\n---\n\n'), failures })
    }
    case 'skills/export': {
      const state = await store.read()
      const result = await exportSkill(state, dshHome())
      const next = await store.mutate('导出 Skill', (draft) => {
        applyOps(draft, draft.skills.filter(s => !s.sample && s.status === 'active').map(s => ({ op: 'update_skill', id: s.id, status: 'exported' })))
        return draft
      }, { undoable: false })
      return json(res, 200, { ...result, state: next })
    }
    // 发布交接(工单 #9):只出文件与命令,绝不写已发布状态——是否已发布由用户确认(publish_item)。
    case 'production/export': {
      const settings = await desk.settings.read()
      const state = await store.read()
      const item = state.items.find(row => row.id === body.id)
      if (!item?.production?.article) return json(res, 400, { error: tr('还没有可以导出的成稿') })
      const exported = await exportForCli(item.production, {
        filesDir: store.filesDir,
        exportDir: resolveExportDir(settings.exportDir),
        platforms: (Array.isArray(body.platforms) ? body.platforms : []).filter(p => Object.hasOwn(BRIDGE_ADAPTERS, p)),
      })
      const next = await store.mutate(tr('导出发布包'), (draft) => {
        const target = draft.items.find(row => row.id === body.id)
        if (target?.production) target.production.cliPath = exported.dir
        return draft
      }, { undoable: false })
      return json(res, 200, { ...exported, state: next })
    }
    // 一键投递(ADR 0009):发布包导出后把任务写进 outbox,dswritesync 桥监听下发给浏览器扩展。
    // 平台只放行桥适配器清单里的;投递本身不改状态,回执经 digestReceipts 落 dispatches。
    case 'production/dispatch': {
      const platforms = (Array.isArray(body.platforms) ? body.platforms : []).filter(p => Object.hasOwn(BRIDGE_ADAPTERS, p))
      if (!platforms.length) return json(res, 400, { error: tr('至少选一个可投递的平台') })
      const settings = await desk.settings.read()
      const state = await store.read()
      const item = state.items.find(row => row.id === body.id)
      if (!item?.production?.article) return json(res, 400, { error: tr('还没有可以发布的成稿') })
      const exported = await exportForCli(item.production, { filesDir: store.filesDir, exportDir: resolveExportDir(settings.exportDir), platforms })
      const articleMd = await readFile(exported.articlePath, 'utf8')
      // 任务里的图片键与正文里的相对引用一致(images/xxx),桥读文件转 data URI 后才下发扩展
      const images = Object.fromEntries(exported.imageFiles.map(ref => [ref, join(exported.dir, ref)]))
      const task = await writePublishTask({ itemId: body.id, title: item.production.title, articleMd, images, platforms })
      const next = await store.mutate(tr('导出发布包'), (draft) => {
        const target = draft.items.find(row => row.id === body.id)
        if (target?.production) target.production.cliPath = exported.dir
        return draft
      }, { undoable: false })
      return json(res, 200, { operationId: task.operationId, dir: exported.dir, state: next })
    }
    default: return json(res, 404, { error: tr('接口不存在') })
  }
}

/**
 * Web 服务不会替插件路由鉴权，所以每个请求都要自己走一遍 Host/Origin 和登录凭证检查。
 * 拿不到鉴权服务时一律拒绝。
 * @param {object} ctx - Cordis 上下文。
 * @param {{headers: object}} req - HTTP 请求。
 * @returns {number|undefined} 拒绝时的状态码；可以继续时为 undefined。
 */
export function requestRejection(ctx, req) {
  const connection = ctx.get('connection')
  if (typeof connection?.requestRejection !== 'function') return 403
  return connection.requestRejection({ headers: req.headers })
}

export const name = 'dsh-writing-desk'

export default {
  inject: ['webServer', 'connection'],
  apply(ctx) {
    const store = new Store()
    const settings = new Settings(store.root)
    const desk = { settings, versionCheck: createVersionCheck(), store }
    // catalog 与 state 同源:每次写状态落盘后刷一次再回响应;结构未变时 writeCatalog 自行跳过。
    const mutateState = store.mutate.bind(store)
    store.mutate = async (...args) => {
      const result = await mutateState(...args)
      await writeCatalog(store).catch(() => {})
      return result
    }
    // 创作模式(ADR 0006):preset-writing 的子插件(工具与 skill)经这个服务拿到
    // 与页面路由同一份 Store 和 Settings,写回同一个 reducer。假 ctx(测试)没有
    // provide,跳过即可;真实宿主的 ctx 一定有。
    ctx.provide?.('writingDesk', desk)
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/writing-desk',
    handler: async (req, res) => {
      try {
        const rejection = requestRejection(ctx, req)
        if (rejection) {
          json(res, rejection, { error: tr('未授权') })
          return
        }
        await withLang(req.headers['x-writing-desk-lang'], () => route(ctx, store, desk, req, res))
      } catch (err) {
        if (res.headersSent) {
          res.end()
          return
        }
        json(res, err.status || 500, { error: err.message })
      }
    },
  }), 'dsh-writing-desk: /writing-desk routes')
  // 投递箱轮询(ADR 0009):桥写进 inbox 的采集件不必等用户刷新页面,3 秒内自动上墙。
  // unref:定时器不挡进程退出,宿主关掉时它不叫住;清理仍走 effect disposer。
  ctx.effect(() => {
    const timer = setInterval(() => digestBridge(store), 3000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'dsh-writing-desk: bridge digest timer')
  },
}
