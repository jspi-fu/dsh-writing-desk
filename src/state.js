// 状态机的唯一权威:统一定义素材状态的迁移事件与共享谓词,面板不再各写一套「已排期」。
// 纯函数、零依赖:Host(src/)直接 import,Client(client/)经 esbuild 打包进浏览器半片,
// 所以这里不能引 i18n.js(它依赖 node:async_hooks)或任何其他模块。
// 只裁决素材自己的状态元组(status / scheduledAt / 排期提醒),不碰作品与 Store。
// 作品是第一位实体(ADR 0013):「有没有成稿」不再问素材,问 state.works(见 src/work.js)。

// 作品接管了成稿正文与发布状态后,素材只剩三类迁移:
// - 排期与取消排期:schedule / unschedule
// - 素材自身所处的流程阶段(灵感 / 大纲 / 草稿):setStatus
// 写回、人工改稿、发布都迁到了 Work(ADR 0013/0014)。
export const EVENTS = ['schedule', 'unschedule', 'setStatus']

export const STATUSES = ['idea', 'outline', 'draft', 'ready', 'published']

// 状态与素材种类的中文名:数据里存的始终是枚举值,这里只提供 t() 用的词条 key。
// 与 STATUSES 一样放在这个 Host/Client 共用的纯模块里,别处不许再抄一份。
export const STATUS_LABEL = { idea: '灵感', outline: '大纲', draft: '草稿', ready: '待发布', published: '已发布' }

export const KINDS = ['image', 'video', 'web', 'quote', 'note', 'file']

/** 已排期:挂进了日历。是否已发布由作品的发布记录回答,不再压在这个字段上。 */
export function isScheduled(item) {
  return Boolean(item.scheduledAt)
}

/**
 * 到点该提醒:排期时间已过、没关掉系统提示、这一次还没确认过。
 * 「知道了」写 remindedAt;改了排期时间,旧回执作废(见下面的 schedule 迁移)。
 */
export function reminderDue(item, now = new Date()) {
  if (!isScheduled(item)) return false
  if (item.reminder === false) return false
  const at = Date.parse(item.scheduledAt)
  if (Number.isNaN(at) || at > now.getTime()) return false
  const ack = item.remindedAt ? Date.parse(item.remindedAt) : Number.NaN
  return !(ack >= at)
}

/**
 * 待排期:没有父条目、没排期、也还没被任何作品引用。
 * 已用素材默认从托盘收起(ADR 0013),所以这里要把 works 一起看。
 */
export function awaitingSchedule(state, item) {
  if (item.parentId || isScheduled(item)) return false
  return !(state?.works ?? []).some(work => !work.archivedAt && (work.sourceItemIds ?? []).includes(item.id))
}

/**
 * 自愈对齐:依据排期把素材状态拉回与事实一致——待发布必须真的排了期,
 * 已排期的未成稿算大纲。素材不再承载「已成稿 / 已发布」,那两件事由作品回答。
 */
function heal(item) {
  if (item.scheduledAt) {
    if (['draft', 'ready'].includes(item.status)) item.status = 'ready'
    else item.status = 'outline'
  } else if (item.status === 'ready' || item.status === 'published') {
    // 素材不再承载发布状态(ADR 0013):旧数据里的 published 一并拉回草稿
    item.status = 'draft'
  }
}

const handlers = {
  // 排期与取消排期:时间规整成 ISO,状态照常自愈。
  schedule(item, event) {
    if (typeof event.scheduledAt !== 'string' || Number.isNaN(Date.parse(event.scheduledAt))) throw new Error('排期时间无效')
    const next = new Date(event.scheduledAt).toISOString()
    // 时间变了就是一次新排期:旧的「知道了」不再作数,否则改到明天还会被当成已读
    if (next !== item.scheduledAt) delete item.remindedAt
    item.scheduledAt = next
    heal(item)
  },
  unschedule(item) {
    item.scheduledAt = null
    delete item.remindedAt
    // 退回排期前的老规矩(旧的排期推演):没进过排期流程的大纲退回灵感;
    // 其余交给自愈。
    if (item.status === 'outline') item.status = 'idea'
    heal(item)
  },
  // 允许手动改素材阶段。已发布不再是素材状态(它在作品上),这里只保留流程阶段。
  setStatus(item, event) {
    if (!STATUSES.includes(event.status)) throw new Error('状态无效')
    item.status = event.status
    heal(item)
  },
}

/**
 * 对一条素材应用一个状态事件,返回这条素材(状态元组被原子迁移)。
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