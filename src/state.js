// 状态机的唯一权威:统一定义状态迁移事件与共享谓词,面板不再各写一套「已成稿 / 已排期」。
// 纯函数、零依赖:Host(src/)直接 import,Client(client/)经 esbuild 打包进浏览器半片,
// 所以这里不能引 i18n.js(它依赖 node:async_hooks)或任何其他模块。
// 对四套字段(status / scheduledAt / production / drafts)做裁决,不碰 Store、不做 IO。

export const EVENTS = ['start', 'articleWritten', 'done', 'fail', 'cancel', 'schedule', 'unschedule', 'setStatus', 'publish']

export const STATUSES = ['idea', 'outline', 'draft', 'ready', 'published']

const hasText = value => typeof value === 'string' && value.trim().length > 0

/** 已成稿:成稿产物里有正文(AI 生成,含成稿中被取消/中断的),或遗留草稿里有手动写的稿,都算同一个口径。 */
export function isDrafted(item) {
  if (item.production?.status === 'done' || hasText(item.production?.article)) return true
  return hasText(item.drafts?.article?.text) || hasText(item.drafts?.script?.text)
}

/** 已排期:排上了日历且还没发布。 */
export function isScheduled(item) {
  return Boolean(item.scheduledAt) && item.status !== 'published'
}

/**
 * 面板状态:把四套字段收敛成一个显示口径,优先级为成稿中 > 已发布 > 已成稿 > 已排期 > 灵感。
 * 'idea' 表示这些信息都没有,更细的区分(大纲 / 草稿)由面板自己读 item.status。
 */
export function panelState(item) {
  if (item.production?.status === 'running') return 'producing'
  if (item.status === 'published') return 'published'
  if (isDrafted(item)) return 'drafted'
  if (isScheduled(item)) return 'scheduled'
  return 'idea'
}

/**
 * 自愈对齐:依据成稿产物与排期把状态拉回与事实一致——已成稿的不能标回灵感,
 * 待发布必须真的排了期,已排期的未成稿算大纲(沿用旧 applySchedule 的推演)。
 * 已发布不动:发布与否由用户确认,自愈不得擅改。
 */
function heal(item) {
  if (item.status === 'published') return
  if (item.scheduledAt) {
    if (isDrafted(item) || ['draft', 'ready'].includes(item.status)) item.status = 'ready'
    else item.status = 'outline'
  } else if (isDrafted(item)) {
    item.status = 'draft'
  } else if (item.status === 'ready') {
    item.status = 'draft'
  }
}

// 取消 / 失败都只是把这一轮停掉:已落盘的正文与已生成的图原样保留(白等一场不丢稿),
// 没跑完的资产停回待命,然后照常自愈(有正文的灵感不会被留在灵感档)。
function finishAs(item, status, error) {
  const production = item.production
  if (!production) throw new Error('这条灵感还没有成稿')
  production.status = status
  production.stage = 'done'
  production.error = error
  for (const asset of [production.cover, ...(production.images ?? []), ...(production.shots ?? [])]) {
    if (asset && ['pending', 'running'].includes(asset.status)) asset.status = 'idle'
  }
  heal(item)
}

const handlers = {
  // 开始成稿:开新的一轮,画面清零等这一轮重画,但保留上一轮写好的正文与其来历
  // (重新成稿不清空,重试不毁稿),导出仍存回原来的文件夹。
  start(item, event, now) {
    const previous = item.production ?? {}
    item.production = {
      status: 'running', stage: 'brief',
      withImages: event.withImages ?? true,
      startedAt: now,
      format: event.format ?? previous.format ?? 'script',
      title: item.title,
      article: previous.article ?? '',
      ...(previous.aiArticle ? { aiArticle: previous.aiArticle } : {}),
      ...(previous.engine ? { engine: previous.engine } : {}),
      ...(previous.savedPath ? { savedPath: previous.savedPath, savedHashes: previous.savedHashes } : {}),
      cover: null, images: [], shots: [],
    }
    heal(item)
  },
  // 正文落盘:AI 原稿快照与引擎一起记下,然后照常自愈——有正文就算草稿,灵感档留不住它。
  articleWritten(item, event) {
    const production = item.production
    if (!production) throw new Error('这条灵感还没有成稿')
    if (typeof event.article !== 'string') throw new Error('正文无效')
    production.article = event.article
    production.aiArticle = event.aiArticle ?? event.article
    production.engine = event.engine ?? 'local'
    production.notice = event.notice ?? null
    heal(item)
  },
  // 完成:产物定稿,状态照常自愈(已排期的直接待发布)。
  done(item, event, now) {
    const production = item.production
    if (!production) throw new Error('这条灵感还没有成稿')
    production.status = 'done'
    production.stage = 'done'
    production.finishedAt = now
    heal(item)
  },
  // 排期与取消排期:时间规整成 ISO(与旧 coerce('date') 一致),状态照常自愈。
  schedule(item, event) {
    if (typeof event.scheduledAt !== 'string' || Number.isNaN(Date.parse(event.scheduledAt))) throw new Error('排期时间无效')
    item.scheduledAt = new Date(event.scheduledAt).toISOString()
    heal(item)
  },
  unschedule(item) {
    item.scheduledAt = null
    heal(item)
  },
  // 允许手动改状态,但结果必须经过自愈对齐;进出已发布时维护发布时间(与旧 applyStatus 一致)。
  setStatus(item, event, now) {
    if (!STATUSES.includes(event.status)) throw new Error('状态无效')
    item.status = event.status
    if (event.status === 'published' && !item.publishedAt) item.publishedAt = now
    if (event.status !== 'published') delete item.publishedAt
    heal(item)
  },
  // 用户主动停,不算错误。
  cancel(item) {
    finishAs(item, 'cancelled', null)
  },
  fail(item, event) {
    finishAs(item, 'failed', event.error ?? null)
  },
  // 发布由用户确认(发布交接默认问一句、可手动改),记下发布时间;排期谓词随即让位。
  publish(item, event, now) {
    item.status = 'published'
    if (!item.publishedAt) item.publishedAt = now
    heal(item)
  },
}

/**
 * 对一条灵感应用一个状态事件,返回这条灵感(状态元组被原子迁移)。
 * 事件用 { type, id, ...参数, at? } 描述,at 缺省取当前时间;报错为固定中文,由调用方本地化。
 */
export function reduce(state, event) {
  const item = state.items.find(row => row.id === event?.id)
  if (!item) throw new Error(`找不到这条灵感:${event?.id}`)
  const handler = Object.hasOwn(handlers, event?.type) ? handlers[event.type] : undefined
  if (!handler) throw new Error(`不支持的状态事件:${event?.type}`)
  handler(item, event, event.at ?? new Date().toISOString())
  return item
}
