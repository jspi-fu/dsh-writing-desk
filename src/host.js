// dsh-writing-desk host 半片：/writing-desk/* 接口、文件服务。
// 成稿在 DSH 创作会话里发生(ADR 0006),这里只剩数据、看板与人工介入的服务面,没有任何模型调用。
import { createReadStream, existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BRIDGE_ADAPTERS } from './platforms.js'
import { bridgeStatus, digestInbox, digestReceipts, touchHeartbeat, writeCatalog, writePublishTask } from './bridge.js'
import { defaultExportDir, resolveExportDir, saveProduction } from './export.js'
import { exportPublishPackage } from './publish.js'
import { harvest, harvestText } from './harvest.js'
import { exportSkill } from './learn.js'
import { applyOps, newId } from './ops.js'
import { migrateMediaDesk, summarizeMediaDesk } from './migrate.js'
import { applyPairing } from './pairing.js'
import { Settings, publicSettings } from './settings.js'
import { buildStylePrompt, messagesFromEvents } from './style-material.js'
import { dshHome, Store } from './store.js'
import { currentLang, tr, withLang } from './i18n.js'
import { localizeSamples, samplesNeedLocale } from './seed.js'
import { createVersionCheck } from './version.js'
import { workDoc, workHasText, workOfId, workTitle } from './work.js'

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

// 让用户在系统原生的文件夹选择器里挑成稿目录。
// 三个平台各用系统自带的对话框，不引入依赖；用户取消时返回 null。
function runExec(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        // 取消在几个平台上都表现为非零退出；这里只把明确的取消当取消。
        if (/cancel/i.test(String(stderr || error.message || ''))) return resolve('')
        if (file === 'zenity' && error.code === 1) return resolve('')
        return reject(Object.assign(new Error(tr('无法打开文件夹选择器')), { status: 500, cause: error }))
      }
      resolve(String(stdout ?? ''))
    })
  })
}

async function pickFolder(initial = '') {
  const chosen = value => {
    const path = String(value ?? '').trim()
    if (!path) return null
    if (!existsSync(path)) throw Object.assign(new Error(tr('文件夹不存在')), { status: 400 })
    return path
  }
  const start = typeof initial === 'string' ? initial : ''
  if (process.platform === 'win32') {
    const title = tr('选择成稿保存文件夹')
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      `$d.Description = '${title.replace(/'/g, "''")}'`,
      '$d.UseDescriptionForTitle = $true',
      '$d.ShowNewFolderButton = $true',
      `$start = '${start.replace(/'/g, "''")}'`,
      'if ($start -and (Test-Path -LiteralPath $start)) { $d.SelectedPath = $start }',
      '$r = $d.ShowDialog()',
      'if ($r -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
    ].join('\n')
    const encoded = Buffer.from(script, 'utf16le').toString('base64')
    return chosen(await runExec('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded]))
  }
  if (process.platform === 'darwin') {
    const apple = start
      ? `POSIX path of (choose folder with prompt "${tr('选择成稿保存文件夹')}" default location POSIX file "${start.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`
      : `POSIX path of (choose folder with prompt "${tr('选择成稿保存文件夹')}")`
    return chosen(await runExec('osascript', ['-e', apple]))
  }
  const args = ['--file-selection', '--directory', `--title=${tr('选择成稿保存文件夹')}`]
  if (start) args.push(`--filename=${start}/`)
  return chosen(await runExec('zenity', args))
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
  // 与全仓其他写路径一样走 tmp + rename:同名请求不至于读到半截文件
  const tmp = join(store.filesDir, `${name}.${process.pid}.tmp`)
  await writeFile(tmp, buffer)
  await rename(tmp, join(store.filesDir, name))
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

/** work/export 与 work/dispatch 的公共体:导出发布包并把落盘记录写回作品。 */
async function exportWorkPackage(store, desk, workId) {
  const settings = await desk.settings.read()
  const state = await store.read()
  const work = workOfId(state, workId)
  if (!workHasText(work)) throw Object.assign(new Error(tr('这份作品还没有正文')), { status: 400 })
  const exported = await exportPublishPackage(workDoc(work), {
    filesDir: store.filesDir,
    exportDir: resolveExportDir(settings.exportDir),
  })
  const next = await store.mutate(tr('导出发布包'), (draft) => {
    const target = workOfId(draft, workId)
    if (target) target.cliPath = exported.dir
    return draft
  }, { undoable: false })
  return { exported, next, work }
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
    // 设置页的桥接区块(ADR 0012):NM 配对状态由注册器写进 bridge/native.json,这里只读。
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
    // 先读勾选再读旧工作台:请求体只能读一次。
    const body = await readJson(req)
    const { raw, paths } = await readMediaDesk()
    const media = await copyMigrationMedia(raw, paths, store.filesDir)
    const result = await store.mutate(tr('从自媒体工作台迁移'), (draft) => migrateMediaDesk(draft, raw, { media, selection: body.selection }))
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
case 'pick-folder': {
      // 只负责弹系统选择器,不写状态;选完由调用方自己决定用它做什么。
      const path = await pickFolder(typeof body.initial === 'string' ? body.initial : '')
      return json(res, 200, path ? { path } : { canceled: true })
    }
    // 作品的保存(ADR 0015):落盘记录(savedPath/savedHashes/savedAt)挂在 Work 根上,
    // current 只放内容。路由参数 body.id 的语义是作品 id——素材不再有自己的稿。
    case 'work/save': {
      const settings = await desk.settings.read()
      const state = await store.read()
      const work = workOfId(state, body.id)
      if (!workHasText(work)) return json(res, 400, { error: tr('这份作品还没有正文') })
      // 首次保存先让用户选文件夹;取消就什么都不写。
      let target
      if (body.pick) {
        const picked = await pickFolder(work.savedPath || resolveExportDir(settings.exportDir))
        if (!picked) return json(res, 200, { canceled: true })
        target = picked
      }
      const saved = await saveProduction(workDoc(work), { filesDir: store.filesDir, exportDir: resolveExportDir(settings.exportDir), target })
      const next = await store.mutate(tr('保存作品'), (draft) => {
        const target = workOfId(draft, body.id)
        if (target) {
          target.savedPath = saved.path
          target.savedHashes = saved.hashes
          target.savedAt = new Date().toISOString()
        }
        return draft
      }, { undoable: false })
      return json(res, 200, { ...saved, state: next })
    }
    case 'work/reveal': {
      // 路径只取自保存记录，不接受请求里传来的路径
      const state = await store.read()
      const path = workOfId(state, body.id)?.savedPath
      if (!path) return json(res, 400, { error: tr('还没有保存过') })
      const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
      execFile(command, [path], () => {})
      return json(res, 200, { path })
    }
    // 发布交接(ADR 0009/0015):只出文件,绝不写已发布——发布仍是用户确认(publish_work)。
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
      const next = await store.mutate(tr('导出 Skill'), (draft) => {
        applyOps(draft, draft.skills.filter(s => !s.sample && s.status === 'active').map(s => ({ op: 'update_skill', id: s.id, status: 'exported' })))
        return draft
      }, { undoable: false })
      return json(res, 200, { ...result, state: next })
    }
    case 'work/export': {
      const { exported, next } = await exportWorkPackage(store, desk, body.id)
      return json(res, 200, { ...exported, state: next })
    }
    // 一键投递(ADR 0009/0012):发布包导出后把任务写进 outbox,本地助手分片下发浏览器扩展。
    // 平台只放行桥适配器清单里的;投递本身不改状态,回执经 digestReceipts 落 publication.dispatches。
    case 'work/dispatch': {
      const platforms = (Array.isArray(body.platforms) ? body.platforms : []).filter(p => Object.hasOwn(BRIDGE_ADAPTERS, p))
      if (!platforms.length) return json(res, 400, { error: tr('至少选一个可投递的平台') })
      const { exported, next, work } = await exportWorkPackage(store, desk, body.id)
      const articleMd = await readFile(exported.articlePath, 'utf8')
      // 任务里的图片键与正文里的相对引用一致(images/xxx),桥读文件转 data URI 后才下发扩展
      const images = Object.fromEntries(exported.imageFiles.map(ref => [ref, join(exported.dir, ref)]))
      // 桥协议的 itemId 字段沿用旧名,值是作品 id(扩展侧读的是同一字段,不用跟着改)
      const task = await writePublishTask({ itemId: work.id, title: workTitle(work), articleMd, images, platforms })
      return json(res, 200, { operationId: task.operationId, dir: exported.dir, state: next })
    }
    // 风格学习(ADR 0014):把选中作品的创作会话转录 + 发布稿拼成一段材料,
    // 返回给客户端预填到新开的风格会话里。这里不写 Store,也不调模型。
    case 'style/learn': {
      const workIds = Array.isArray(body.workIds)
        ? [...new Set(body.workIds.filter(id => typeof id === 'string' && id))]
        : []
      if (!workIds.length) return json(res, 400, { error: tr('没有选作品') })
      if (workIds.length > 6) return json(res, 400, { error: tr('一次最多学习 6 篇作品') })
      const state = await store.read()
      const works = workIds.map(id => workOfId(state, id)).filter(Boolean)
      if (works.length !== workIds.length) return json(res, 404, { error: tr('作品不存在') })
      if (works.some(work => !workHasText(work))) return json(res, 400, { error: tr('所选作品还没有正文') })
      // sessionQuery 是宿主注入的可选能力:拿不到就只用发布稿,并在 missing 里告诉用户。
      const sessionQuery = typeof ctx.get === 'function' ? ctx.get('sessionQuery') : undefined
      const readings = {}
      for (const work of works) {
        const sessionIds = [...new Set((Array.isArray(work.sessionIds) ? work.sessionIds : []).filter(id => typeof id === 'string' && id))].slice(0, 8)
        if (!sessionIds.length) {
          readings[work.id] = { error: tr('没有登记创作会话') }
          continue
        }
        if (typeof sessionQuery?.readSession !== 'function') {
          readings[work.id] = { error: tr('宿主没有提供会话读取能力') }
          continue
        }
        const messages = []
        for (const sessionId of sessionIds) {
          try {
            const snapshot = await sessionQuery.readSession(sessionId)
            messages.push(...messagesFromEvents(snapshot?.events))
          } catch {
            // 单个会话读不到不致命:其余会话继续读,最后按有无文字记 missing。
          }
        }
        readings[work.id] = { messages, error: messages.length ? '' : tr('创作会话里没有可读的文字') }
      }
      return json(res, 200, buildStylePrompt(state, works, readings, { name: typeof body.name === 'string' ? body.name : '' }))
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
    let lastBeat = 0
    const timer = setInterval(() => {
      digestBridge(store)
      // 心跳(ADR 0012):helper 靠它判活,10s 一拍足够,不必跟 3s 消化节奏走
      if (Date.now() - lastBeat >= 10_000) {
        lastBeat = Date.now()
        touchHeartbeat().catch(() => {})
      }
    }, 3000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'dsh-writing-desk: bridge digest timer')
  // NM 自动配对(ADR 0012):每次启动幂等重写 host manifest 与各浏览器 vendor 键,
  // 换安装路径后扩展无需重装即自愈;失败不打断插件加载,设置页可见未配对状态。
  ctx.effect(() => {
    applyPairing().catch(error => console.error('[writing-desk] NM 配对失败:', error?.message ?? error))
  }, 'dsh-writing-desk: nm pairing')
  },
}
