// 桥接投递箱(ADR 0009,接入面见 ADR 0012):浏览器扩展经本地助手(NM host)
// 与 ~/.dsh/writing-desk/bridge/ 的文件和工作台交换数据——
//   inbox/import-*.json    助手写,host 消化成灵感(add_item)
//   outbox/publish-*.json  host 写,助手分片下发给扩展发布
//   receipts/import-*.json host 写给助手的导入回执
//   receipts/dispatch-*.json 助手写给 host 的发布回执,消化成 item.dispatches
//   catalog.json           host 原子写的标签 / URL 索引,扩展收进前读取判断冲突
// 写路径唯一入口仍是 applyOps(红线);文件认领用原子 rename,桌面与网页两个宿主进程
// 并发消化同一批文件不重不漏;operationId 让桥侧重试也能拿到同一份回执。
// 扩展采集的网页内容回传后,这里仍按不可信输入对待:URL 只放行 http(s)、字段限长、
// data URI 封面落成 files/ 素材后才能进 media。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { applyOps } from './ops.js'
import { readPairing } from './pairing.js'
import { dshHome } from './store.js'
import { tr } from './i18n.js'

// 平台与适配器 id 的映射:与 extension/packages/core/src/adapters/platforms 的
// 内容适配器一致(20 个内容平台,排除 zip-download;xiaohongshu 为页面自动化草稿)。
export const BRIDGE_ADAPTERS = {
  weixin: '公众号',
  zhihu: '知乎',
  juejin: '掘金',
  weibo: '微博',
  bilibili: 'B站',
  douban: '豆瓣',
  baijiahao: '百家号',
  sohu: '搜狐号',
  csdn: 'CSDN',
  segmentfault: '思否',
  yuque: '语雀',
  xueqiu: '雪球',
  woshipm: '人人都是产品经理',
  '51cto': '51CTO',
  imooc: '慕课手记',
  oschina: '开源中国',
  cnblogs: '博客园',
  eastmoney: '东方财富',
  aliyun: '阿里云开发者社区',
  xiaohongshu: '小红书',
}

export function bridgePaths() {
  const root = join(dshHome(), 'writing-desk', 'bridge')
  return {
    root,
    inbox: join(root, 'inbox'),
    outbox: join(root, 'outbox'),
    receipts: join(root, 'receipts'),
    catalog: join(root, 'catalog.json'),
    heartbeat: join(root, 'heartbeat'),
  }
}

export async function ensureBridgeDirs() {
  const paths = bridgePaths()
  for (const dir of [paths.root, paths.inbox, paths.outbox, paths.receipts]) {
    await mkdir(dir, { recursive: true })
  }
  return paths
}

/**
 * 宿主心跳:helper 的 dshActive 靠它判断宿主是否在跑。catalog.json 只在标签/URL
 * 结构变化时才写(writeCatalog 的省盘策略),安静的书桌会让 mtime 停在最后一次
 * 变化,在跑的宿主被误报成「没在运行」;心跳只承担活性,低频 touch 即可。
 */
export async function touchHeartbeat() {
  const paths = await ensureBridgeDirs()
  const now = new Date()
  try {
    await utimes(paths.heartbeat, now, now)
  } catch {
    await writeFile(paths.heartbeat, '')
  }
  return paths
}

/**
 * 原子认领一个投递文件:rename 成功的进程才处理它,失败说明同伴已认领。
 * @param {string} file - 投递文件路径。
 * @returns {Promise<boolean>} 认领成功返回 true。
 */
async function claim(file) {
  try {
    await rename(file, `${file}.claiming`)
    return true
  } catch {
    return false
  }
}

async function readClaimed(file) {
  try {
    return JSON.parse(await readFile(`${file}.claiming`, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 写一份回执给桥;桥对同一 operationId 重试时拿到的永远是同一份结果。
 * @param {string} name - 回执文件名(带 import-/dispatch- 前缀)。
 * @param {object} body - 回执内容。
 */
async function writeReceipt(name, body) {
  const paths = await ensureBridgeDirs()
  const file = join(paths.receipts, name)
  await writeFile(`${file}.tmp`, JSON.stringify({ ...body, at: new Date().toISOString() }))
  await rename(`${file}.tmp`, file)
}

function text(value, cap) {
  return typeof value === 'string' ? value.slice(0, cap) : undefined
}

/** 封面白名单:data URI(落成 files/ 素材)或 http(s) 地址,其余拒绝。 */
async function normalizeCover(cover, filesDir) {
  if (typeof cover !== 'string' || !cover) return null
  const match = /^data:image\/(png|jpeg|webp);base64,([\w+/=]+)$/.exec(cover)
  if (match) {
    // StashDock 同款上限:750KB 解码体积(base64 约 100 万字符),防投递文件过大
    if (match[2].length > 1_000_000) throw new Error(tr('封面图片太大'))
    const buffer = Buffer.from(match[2], 'base64')
    const name = `${newImageName()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`
    await writeFile(join(filesDir, name), buffer)
    return `writing-desk/files/${name}`
  }
  try {
    const { protocol } = new URL(cover)
    if (protocol === 'http:' || protocol === 'https:') return cover
  } catch { /* 不是合法地址 */ }
  throw new Error(tr('封面地址不受支持'))
}

let imageCounter = 0
function newImageName() {
  imageCounter += 1
  return `b${Date.now().toString(36)}${imageCounter.toString(36)}`
}

/**
 * 收进 URL 的规范化:去 fragment、尾斜杠与 utm_*、fbclid、gclid 噪声,查询参数
 * 排序保证同页不同参数顺序得到同一个键(清单思想引自 StashDock,实现自研)。
 * 离线重复收进靠它判重;不合法 URL 返回 null,不做去重。
 * @param {string} url - 原始 URL。
 * @returns {string|null} 规范化后的 URL。
 */
export function normalizeCaptureUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  parsed.hash = ''
  // URLSearchParams.delete/sort 保留百分号编码,值里含 &/= 的参数不会拼坏
  for (const key of [...parsed.searchParams.keys()]) {
    if (/^(utm_\w+|fbclid|gclid)$/i.test(key)) parsed.searchParams.delete(key)
  }
  parsed.searchParams.sort()
  parsed.search = parsed.searchParams.toString()
  const cleanPath = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '') : parsed.pathname
  return `${parsed.origin}${cleanPath}${parsed.search}`
}

/** 校验并折算成 add_item / update_item op;任何字段不合规都抛错,由调用方把错误写进回执。 */
async function importOp(payload, filesDir, draft) {
  const url = typeof payload.url === 'string' ? payload.url.trim() : ''
  try {
    const { protocol } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') throw new Error()
  } catch {
    throw new Error(tr('链接必须是 http(s) 地址'))
  }
  const tags = Array.isArray(payload.tags)
    ? payload.tags.filter(tag => typeof tag === 'string' && tag.trim()).map(tag => tag.trim().slice(0, 48)).slice(0, 12)
    : []
  const cover = await normalizeCover(payload.cover, filesDir)
  const fields = {
    kind: 'web',
    title: text(payload.title?.trim(), 300) || url,
    body: text(payload.body, 20000) ?? '',
    url,
    source: text(payload.siteName, 100),
    tags,
    media: cover ? { src: cover } : null,
    via: 'capture',
  }
  // 替换只在扩展从 catalog 命中冲突并带上 replaceItemId 时发生;目标不存在就退回新增,
  // duplicate 本身由扩展的 catalog 决定,宿主不猜。
  const replaceItemId = typeof payload.replaceItemId === 'string' ? payload.replaceItemId : ''
  if (replaceItemId && draft.items.some(row => row.id === replaceItemId)) {
    return { op: 'update_item', id: replaceItemId, ...fields }
  }
  // 离线去重(工单 #11 用户故事 7):同一条 URL(含 utm 噪声)只落一张卡。
  // 只对收进来源(via=capture)的既有卡片判重,手动建的卡不受影响。
  const key = normalizeCaptureUrl(url)
  if (key) {
    const hit = draft.items.find(row => row.via === 'capture' && normalizeCaptureUrl(row.url) === key)
    if (hit) return { duplicateOf: hit.id }
  }
  return { op: 'add_item', ...fields }
}

// operationId 回执记忆(借鉴 StashDock 的 capture 回执协议,ADR 0009):
// 桥对同一 operationId 重试时,只要内容没变就直接复用上次结果,不重复落库;
// 内容变了则拒绝处理。状态里留最近 256 条,足够覆盖桥侧的重试窗口。
const SEEN_CAP = 256

function rememberSeen(draft, operationId, digest, result) {
  const seen = draft.bridgeSeen ?? (draft.bridgeSeen = {})
  seen[operationId] = { digest, result, at: new Date().toISOString() }
  const keys = Object.keys(seen)
  for (const key of keys.slice(0, Math.max(0, keys.length - SEEN_CAP))) delete seen[key]
}

/** 语义摘要:按使用字段固定顺序拼串,投递文件被重新序列化也不变。 */
function importDigest(payload) {
  return JSON.stringify([
    payload.url, payload.title, payload.body, payload.siteName,
    Array.isArray(payload.tags) ? payload.tags : [], payload.cover ?? null,
    payload.replaceItemId ?? null,
  ])
}

function dispatchDigest(payload) {
  return JSON.stringify([payload.itemId, payload.results ?? []])
}

/**
 * 消化采集投递:逐个认领 inbox 里的文件,经 add_item / update_item 落灵感墙,写回执。
 * 双宿主并发安全(认领互斥);同一 operationId 重投靠回执记忆幂等;
 * 失败写错误回执并把文件留档(.failed),不重试。
 * @param {object} store - 工作台 Store。
 * @param {string} filesDir - 素材目录(封面 data URI 落盘用)。
 * @returns {Promise<{imported: number, failed: number}>} 消化统计。
 */
export async function digestInbox(store, filesDir) {
  const paths = await ensureBridgeDirs()
  await mkdir(filesDir, { recursive: true })
  let names = []
  try {
    names = (await readdir(paths.inbox)).filter(name => /^import-[\w-]+\.json$/.test(name))
  } catch {
    return { imported: 0, failed: 0 }
  }
  let imported = 0
  let failed = 0
  for (const name of names) {
    const file = join(paths.inbox, name)
    if (!await claim(file)) continue
    const payload = await readClaimed(file)
    const operationId = name.slice('import-'.length, -'.json'.length)
    try {
      if (!payload || typeof payload.operationId !== 'string') throw new Error(tr('投递格式无效'))
      const label = text(payload.title?.trim(), 12) || text(payload.url, 12) || ''
      const result = await store.mutate(tr('从浏览器收下《{title}》', { title: label }), async (draft) => {
        const digest = importDigest(payload)
        const seen = draft.bridgeSeen?.[operationId]
        if (seen) {
          if (seen.digest !== digest) throw new Error(tr('同一编号的投递内容与上次不同,拒绝处理'))
          return { id: seen.result?.id, ...(seen.result?.duplicate ? { duplicate: true } : {}), replaced: seen.result?.replaced, replay: true }
        }
        const op = await importOp(payload, filesDir, draft)
        // 去重命中:不落库,直接把已存在的卡片写进回执,扩展端显示「已收过」
        if (op.duplicateOf) {
          const out = { id: op.duplicateOf, duplicate: true }
          rememberSeen(draft, operationId, digest, out)
          return out
        }
        const { receipts, errors } = applyOps(draft, [op])
        if (errors.length) throw new Error(errors[0])
        const out = { id: receipts[0]?.target, replaced: op.op === 'update_item' }
        rememberSeen(draft, operationId, digest, out)
        return out
      }, { undoable: false })
      await writeReceipt(`import-${operationId}.json`, {
        ok: true,
        itemId: result.id,
        operationId,
        ...(result.duplicate ? { duplicate: true } : {}),
        ...(result.replaced ? { replaced: true } : {}),
        ...(result.replay ? { replay: true } : {}),
      })
      imported += 1
      await rm(`${file}.claiming`, { force: true })
    } catch (err) {
      failed += 1
      await writeReceipt(`import-${operationId}.json`, { ok: false, error: String(err.message || err), operationId })
      await rename(`${file}.claiming`, `${file}.failed`).catch(() => {})
    }
  }
  return { imported, failed }
}

/**
 * 消化发布回执:dispatch-*.json 里的逐平台结果落成作品的 publication.dispatches(ADR 0013)。
 * 回执里的 itemId 字段沿用桥协议旧名,值是作品 id;dispatches 只记录「投递到了哪、草稿链接是什么」,
 * 成功回执最多把状态推到「已投递」,绝不写已发布(已发布仍由用户确认)。
 * @param {object} store - 工作台 Store。
 */
export async function digestReceipts(store) {
  const paths = await ensureBridgeDirs()
  let names = []
  try {
    names = (await readdir(paths.receipts)).filter(name => /^dispatch-[\w-]+\.json$/.test(name))
  } catch {
    return
  }
  for (const name of names) {
    const file = join(paths.receipts, name)
    if (!await claim(file)) continue
    const payload = await readClaimed(file)
    try {
      if (!payload || typeof payload.operationId !== 'string' || typeof payload.itemId !== 'string') {
        throw new Error(tr('回执格式无效'))
      }
      const results = Array.isArray(payload.results) ? payload.results.slice(0, 10) : []
      const ops = []
      for (const row of results) {
        if (!row || typeof row.platform !== 'string' || !Object.hasOwn(BRIDGE_ADAPTERS, row.platform)) continue
        const url = typeof row.url === 'string' && row.url ? row.url : null
        let safeUrl = null
        if (url) {
          try {
            const { protocol } = new URL(url)
            if (protocol !== 'http:' && protocol !== 'https:') throw new Error()
            safeUrl = url
          } catch { safeUrl = null }
        }
        ops.push({
          op: 'record_work_dispatch',
          id: payload.itemId,
          dispatch: {
            platform: row.platform,
            ok: row.ok === true,
            ...(safeUrl ? { url: safeUrl } : {}),
            ...(row.ok !== true && typeof row.error === 'string' ? { error: row.error.slice(0, 200) } : {}),
          },
        })
      }
      if (ops.length) {
        await store.mutate(tr('记下发布投递'), (draft) => {
          const digest = dispatchDigest({ itemId: payload.itemId, results: ops.map(op => op.dispatch) })
          const seen = draft.bridgeSeen?.[payload.operationId]
          if (seen) {
            if (seen.digest !== digest) throw new Error(tr('同一编号的回执内容与上次不同,拒绝处理'))
            return { state: draft }
          }
          applyOps(draft, ops)
          rememberSeen(draft, payload.operationId, digest, { ok: true })
          return { state: draft }
        }, { undoable: false })
      }
      await rm(`${file}.claiming`, { force: true })
    } catch {
      // 回执坏了不重试:留档等人工检查
      await rename(`${file}.claiming`, `${file}.failed`).catch(() => {})
    }
  }
}

/**
 * 写一份发布任务到 outbox,给桥监听下发。itemId 沿用桥协议旧名,值是作品 id(扩展侧不用改)。
 * @param {object} task - {itemId(作品 id), title, articleMd, images, platforms}。
 * @returns {Promise<{operationId: string, file: string}>}
 */
export async function writePublishTask(task) {
  const paths = await ensureBridgeDirs()
  const operationId = randomUUID()
  const payload = {
    kind: 'publish',
    operationId,
    itemId: String(task.itemId),
    title: text(task.title, 200) ?? '',
    articleMd: text(task.articleMd, 200000) ?? '',
    images: task.images ?? {},
    platforms: (Array.isArray(task.platforms) ? task.platforms : []).filter(p => Object.hasOwn(BRIDGE_ADAPTERS, p)),
  }
  if (!payload.platforms.length) throw new Error(tr('没有可投递的平台'))
  const file = join(paths.outbox, `publish-${operationId}.json`)
  await writeFile(`${file}.tmp`, JSON.stringify(payload))
  await rename(`${file}.tmp`, file)
  return { operationId, file }
}

/**
 * 原子写 bridge/catalog.json:扩展收进前用它判断 URL 冲突并给标签建议。
 * tags 取所有灵感的标签去重,urls 是 url → itemId;at 每次变化,结构(tags/urls)
 * 没变就跳过写,避免 3 秒轮询把磁盘刷出无意义的时间戳。
 * @param {object} store - 工作台 Store。
 * @returns {Promise<boolean>} 实际写了文件返回 true,结构未变跳过返回 false。
 */
export async function writeCatalog(store) {
  const paths = await ensureBridgeDirs()
  const state = await store.read()
  const tags = []
  const seenTags = new Set()
  const urlPairs = []
  for (const item of state.items ?? []) {
    for (const tag of Array.isArray(item.tags) ? item.tags : []) {
      if (typeof tag !== 'string' || !tag || seenTags.has(tag)) continue
      seenTags.add(tag)
      tags.push(tag)
    }
    if (typeof item.url === 'string' && item.url) urlPairs.push([item.url, item.id])
  }
  // 键排序让不同 items 顺序下的同一张映射得到同一个结构,跳过判断才稳定
  const sortedUrls = Object.fromEntries(urlPairs.sort(([a], [b]) => a.localeCompare(b)))
  try {
    const previous = JSON.parse(await readFile(paths.catalog, 'utf8'))
    if (JSON.stringify([previous.tags, previous.urls]) === JSON.stringify([tags, sortedUrls])) return false
  } catch { /* 没有旧表或旧表坏了,照常重写 */ }
  const body = { at: new Date().toISOString(), tags, urls: sortedUrls }
  const tmp = `${paths.catalog}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(body))
  await rename(tmp, paths.catalog)
  return true
}

/**
 * 设置页要的桥状态:NM 配对结果(注册器每次启动写 bridge/native.json)+ 投递箱
 * 里各队列的待处理数。token/auth.json 已随 CLI 退役(ADR 0012)。
 */
export async function bridgeStatus() {
  const paths = bridgePaths()
  const count = async dir => {
    try {
      return (await readdir(dir)).filter(name => name.endsWith('.json')).length
    } catch {
      return 0
    }
  }
  const pairing = await readPairing()
  return {
    paired: pairing?.paired ?? false,
    extensionId: pairing?.extensionId ?? null,
    registeredAt: pairing?.registeredAt ?? null,
    browsers: pairing?.browsers ?? [],
    pending: {
      inbox: await count(paths.inbox),
      outbox: await count(paths.outbox),
      receipts: await count(paths.receipts),
    },
  }
}
