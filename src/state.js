// 状态机的唯一权威:统一定义状态迁移事件与共享谓词,面板不再各写一套「已成稿 / 已排期」。
// 纯函数、零依赖:Host(src/)直接 import,Client(client/)经 esbuild 打包进浏览器半片,
// 所以这里不能引 i18n.js(它依赖 node:async_hooks)或任何其他模块。
// 对状态元组(status / scheduledAt / production)做裁决,不碰 Store、不做 IO。

// 成稿迁移到 harness 会话(ADR 0006)后,事件只剩两类:
// - 写回与人工编辑:submit(会话经工具写回,含快照与 rev)/ editProduction(校样浮层就地改)
// - 排期与发布: schedule / unschedule / setStatus / publish
// 内部流水线的 start/articleWritten/done/fail/cancel 随流水线一起退役。
export const EVENTS = ['submit', 'editProduction', 'schedule', 'unschedule', 'setStatus', 'publish']

export const STATUSES = ['idea', 'outline', 'draft', 'ready', 'published']

const hasText = value => typeof value === 'string' && value.trim().length > 0

/** 已成稿:成稿产物里有正文(会话写回或人工改写),按事实算,一个口径。 */
export function isDrafted(item) {
  return hasText(item.production?.article)
}

/** 已排期:排上了日历且还没发布。 */
export function isScheduled(item) {
  return Boolean(item.scheduledAt) && item.status !== 'published'
}

/**
 * 面板状态:把四套字段收敛成一个显示口径,优先级为已发布 > 已成稿 > 已排期 > 灵感。
 * 'idea' 表示这些信息都没有,更细的区分(大纲 / 草稿)由面板自己读 item.status。
 */
export function panelState(item) {
  if (item.status === 'published') return 'published'
  if (isDrafted(item)) return 'drafted'
  if (isScheduled(item)) return 'scheduled'
  return 'idea'
}

/**
 * 待排期:没挂进生产流程、没排期、没发布。待排期托盘用它收条目,胶囊卡也用它判断
 * 「这张胶囊在托盘里还露不露」——成员排掉一张不该把整张胶囊带走(ADR 0011)。
 */
export function awaitingSchedule(item) {
  return !item.parentId && !isScheduled(item) && panelState(item) !== 'published'
}

/**
 * 胶囊成稿:成稿产物只落在它的一个成员上(成稿输入的既有约定:targetId 取第一个来源),
 * 所以任一成员成稿就算整张胶囊成稿——胶囊是一张卡,不按成员各算各的。
 */
export function capsuleDrafted(members) {
  return members.some(isDrafted)
}

/** 写回与编辑共用的字段白名单:只能落回这几样,工具与面板各走各的入口。 */
const WRITE_FIELDS = ['title', 'coverText', 'article']

/** 每次产物变化都落一份内容快照,校样浮层据此做版本列表与回退;留最近 10 份。 */
function pushSnapshot(production, by, at, note) {
  const entry = {
    at, by,
    title: production.title ?? '',
    coverText: production.coverText ?? '',
    article: production.article ?? '',
    ...(note ? { note } : {}),
  }
  production.snapshots = [...(production.snapshots ?? []).slice(-9), entry]
}

/**
 * 自愈对齐:依据成稿产物与排期把状态拉回与事实一致——已成稿的不能标回灵感,
 * 待发布必须真的排了期,已排期的未成稿算大纲(沿用旧的排期推演)。
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

const handlers = {
  // 会话写回(ADR 0006):分阶段粗粒度、按字段落回。没有产物就建一份,有就按字段覆盖;
  // 正文写回时刷新 AI 快照(那是会话刚写的版本,人工改动已在前一份快照里)。
  // 每次写回 rev 前进一格并落快照;素材交会话的登记(sentToSession)随之清掉。
  submit(item, event, now) {
    const previous = item.production ?? {}
    const production = { ...previous }
    production.status = 'done'
    production.stage = 'done'
    production.finishedAt = now
    production.startedAt = previous.startedAt ?? now
    production.engine = event.engine ?? 'harness'
    for (const field of WRITE_FIELDS) {
      if (typeof event[field] === 'string') production[field] = event[field]
    }
    if (typeof event.article === 'string') production.aiArticle = event.aiArticle ?? event.article
    if (event.cover && typeof event.cover.src === 'string') production.cover = { src: event.cover.src, ...(typeof event.cover.caption === 'string' ? { caption: event.cover.caption } : {}), status: 'done' }
    if (Array.isArray(event.images)) {
      production.images = event.images
        .filter(row => row && typeof row.src === 'string')
        .map(row => ({ src: row.src, ...(typeof row.caption === 'string' ? { caption: row.caption } : {}), ...(typeof row.anchor === 'string' ? { anchor: row.anchor } : {}), status: 'done' }))
    }
    if (event.intent && typeof event.intent === 'object') production.intent = { ...event.intent }
    if (event.review && typeof event.review === 'object') production.review = { ...event.review }
    production.rev = (previous.rev ?? 0) + 1
    delete production.pendingWrite
    pushSnapshot(production, 'session', now, event.note)
    item.production = production
    delete item.sentToSession
    heal(item)
  },
  // 人工改稿(校样浮层的就地编辑,ops 的 update_production 走这里):标题/封面文案/正文
  // 直接改在成稿产物上,写完照常自愈——清空正文就不再算已成稿,状态按事实拉回。
  // AI 原稿快照不动:它是会话写回时的版本,改稿对比靠它;rev 前进并落用户快照。
  editProduction(item, event, now) {
    const production = item.production
    if (!production) throw new Error('这条灵感还没有成稿')
    for (const field of WRITE_FIELDS) {
      if (typeof event[field] === 'string') production[field] = event[field]
    }
    production.rev = (production.rev ?? 0) + 1
    pushSnapshot(production, 'user', now)
    heal(item)
  },
  // 排期与取消排期:时间规整成 ISO,状态照常自愈。
  schedule(item, event) {
    if (typeof event.scheduledAt !== 'string' || Number.isNaN(Date.parse(event.scheduledAt))) throw new Error('排期时间无效')
    item.scheduledAt = new Date(event.scheduledAt).toISOString()
    heal(item)
  },
  unschedule(item) {
    item.scheduledAt = null
    // 退回排期前的老规矩(旧的排期推演):没成稿的大纲算没进过排期流程,退回灵感;
    // 其余交给自愈(已成稿留草稿,待发布退草稿)。
    if (item.status === 'outline' && !isDrafted(item)) item.status = 'idea'
    heal(item)
  },
  // 允许手动改状态,但结果必须经过自愈对齐;进出已发布时维护发布时间(沿用旧规则)。
  setStatus(item, event, now) {
    if (!STATUSES.includes(event.status)) throw new Error('状态无效')
    item.status = event.status
    if (event.status === 'published' && !item.publishedAt) item.publishedAt = now
    if (event.status !== 'published') delete item.publishedAt
    heal(item)
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
