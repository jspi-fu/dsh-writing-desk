// 工作台的唯一写入口：界面操作都走这里，统一校验字段并产出回执。
// 模型输出也是不可信输入，所以这里只放行白名单字段。
import { currentLang, platformName, tr } from './i18n.js'
// 状态枚举与词条以 state.js 为唯一来源;平台清单以 platforms.js 为唯一来源
import { KINDS, reduce, STATUS_LABEL, STATUSES } from './state.js'
import { PLATFORMS } from './platforms.js'
import { isHttpUrl } from './url.js'
import { resolveProduceInput } from './produce-input.js'
// 作品是第一位实体(ADR 0013):正文与发布状态都落在 state.works 上
import { CURRENT_FIELDS, makeWork, workHasText, workOfId, workTitle } from './work.js'

/** 状态在当前语言下的名字。 */
function statusLabel(status) {
  return tr(STATUS_LABEL[status] ?? String(status))
}

const ITEM_FIELDS = {
  title: 'text', body: 'text', kind: 'kind', url: 'url', source: 'text', tags: 'list', status: 'status', angleId: 'id',
  personaIds: 'list', parentId: 'id', rel: 'text', scheduledAt: 'date', platform: 'platform', pinned: 'bool', media: 'media', cover: 'media', score: 'num',
  contentOrigin: 'origin',
  // 排期设置与 scheduledAt 同处一条灵感(阶段一过渡形态,见 ADR 0013)。
  // reminder 默认 true,只有用户手动关掉才是 false;remindedAt 是「知道了」的回执,到点判断靠它。
  // 排期只负责到点提醒,不再有自动成稿/自动投递(ADR 0013 修订)。
  reminder: 'bool', remindedAt: 'date',
  // 收进来源标记:离线去重只对浏览器收进(via=capture)的卡片判重,手动建的卡不受影响
  via: 'text',
}
const CAPSULE_FIELDS = { name: 'text', itemIds: 'ids' }
const PERSON_FIELDS = { name: 'text', role: 'text', note: 'text', traits: 'list', tone: 'num' }
const ANGLE_FIELDS = { name: 'text', hook: 'text', prompt: 'text' }
const STYLE_FIELDS = { name: 'text', icon: 'text', summary: 'text', tone: 'text', sentences: 'text', opening: 'text', structure: 'text', logic: 'text', story: 'text', flow: 'text', words: 'list', avoid: 'list', samples: 'list' }
const SKILL_FIELDS = { name: 'text', rule: 'text', source: 'text', status: 'text', confidence: 'num', evidence: 'text' }

let counter = 0
export function newId(prefix = 'x') {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

function coerce(type, value) {
  switch (type) {
    case 'text': return typeof value === 'string' ? value.slice(0, 40000) : undefined
    case 'id': return value === null || typeof value === 'string' ? value : undefined
    case 'kind': return KINDS.includes(value) ? value : undefined
    case 'status': return STATUSES.includes(value) ? value : undefined
    // 来源类型：null 表示清掉标注；「我写的 / AI 生成的」沿用 stashdock 的 contentOrigin 命名
    case 'origin': return value === null || value === 'user' || value === 'ai' ? value : undefined
    case 'platform': return value === null || PLATFORMS.includes(value) ? value : undefined
    case 'list': return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 24) : undefined
    // 胶囊成员 ID:卡片墙一口气拖不了太多,上限给得比标签宽,存在性由 handler 对着 items 校验
    case 'ids': return Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 200) : undefined
    case 'bool': return typeof value === 'boolean' ? value : undefined
    case 'num': return Number.isFinite(value) ? value : undefined
    case 'url': return value === null || value === '' ? null : isHttpUrl(value) ? value : undefined
    case 'date': return value === null ? null : typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined
    case 'media': {
      if (value === null) return null
      if (!value || typeof value.src !== 'string') return undefined
      // 媒体只允许插件自己的相对路径或 http(s) 地址
      const local = /^writing-desk\/(assets|files)\/[\w.-]+$/.test(value.src)
      if (!local && !isHttpUrl(value.src)) return undefined
      const poster = typeof value.poster === 'string' && (/^writing-desk\/(assets|files)\/[\w.-]+$/.test(value.poster) || isHttpUrl(value.poster)) ? value.poster : undefined
      return { src: value.src, ...(poster ? { poster } : {}), ...(Number.isFinite(value.w) ? { w: value.w } : {}), ...(Number.isFinite(value.h) ? { h: value.h } : {}), ...(typeof value.name === 'string' ? { name: value.name.slice(0, 160) } : {}) }
    }
    default: return undefined
  }
}

function pick(fields, input) {
  const out = {}
  for (const [key, type] of Object.entries(fields)) {
    if (input?.[key] === undefined) continue
    const value = coerce(type, input[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

function findById(list, id) {
  const entry = list.find(row => row.id === id)
  if (!entry) throw new Error(tr('找不到对象：{id}', { id }))
  return entry
}

function short(text, n = 22) {
  const s = String(text || '').trim()
  return s.length > n ? `${s.slice(0, n)}…` : s
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtWhen(iso) {
  if (!iso) return tr('未排期')
  const d = new Date(iso)
  const pad = v => String(v).padStart(2, '0')
  return `${fmtShort(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtShort(iso) {
  const d = new Date(iso)
  return currentLang() === 'en' ? `${MONTHS_EN[d.getMonth()]} ${d.getDate()}` : `${d.getMonth() + 1}月${d.getDate()}日`
}

// 状态元组(item.status / scheduledAt)的迁移一律经 reducer(工单 #5):
// 推演与自愈(已成稿不回灵感、待发布必须真排了期)由 state.js 统一裁决,
// 这里只保留 ops 自己的校验、回执与白名单。各 handler 里显式构造事件,
// 时间戳统一取 applyOps 传进来的 now。

/** 胶囊成员:去重后逐个对着 items 校验,不存在的 ID 拒收,避免胶囊挂上空引用。 */
function capsuleIds(state, rawIds) {
  const ids = [...new Set(coerce('ids', rawIds) ?? [])]
  const known = new Set(state.items.map(row => row.id))
  const missing = ids.filter(id => !known.has(id))
  if (missing.length) throw new Error(tr('灵感 {ids} 不存在，收不进胶囊', { ids: missing.join('、') }))
  return ids
}

/** 默认名字:用第一条成员的标题,没标题就用正文开头;都没有才退回「新胶囊」。
 *  标题先取第一句,名字短一点更像文件夹上的标签,而不是整条灵感的回显。 */
function defaultCapsuleName(state, itemIds) {
  const first = state.items.find(row => row.id === itemIds[0])
  const raw = String(first?.title || first?.body || '').trim()
  const clause = raw.split(/[。！？!?，,、：:；;\n]/)[0].trim()
  return short(clause || raw, 18) || tr('新胶囊')
}

/** 解散只删集合关系：成员灵感原样留在灵感流里，不再需要坐标。 */
/** 成员所属的胶囊;不在胶囊里返回 null(单张灵感照旧只改自己)。 */
function capsuleOf(state, itemId) {
  return (state.capsules ?? []).find(capsule => capsule.itemIds.includes(itemId)) ?? null
}

/**
 * 胶囊是一张卡:排期、状态、发布都按整体走,成员不许被拆散。
 * 返回这次动作要一起改的灵感——不在胶囊里就只有它自己。
 */
function capsuleRows(state, item) {
  const capsule = capsuleOf(state, item.id)
  return { capsule, rows: capsule ? state.items.filter(row => capsule.itemIds.includes(row.id)) : [item] }
}

/** 会话写回只落在胶囊的一个成员上;其余成员的状态跟着对齐,免得一张卡里几种状态。 */
function syncCapsuleStatus(state, item) {
  const capsule = capsuleOf(state, item.id)
  if (!capsule) return
  for (const row of state.items) if (row.id !== item.id && capsule.itemIds.includes(row.id)) row.status = item.status
}

function releaseCapsule(state, capsule) {
  state.capsules = (state.capsules ?? []).filter(row => row.id !== capsule.id)
}

/** 灵感唯一归属:把要收进胶囊的灵感从别的胶囊摘掉,原胶囊不足两个就自动解散。 */
function detachFromOtherCapsules(state, itemIds, keepId) {
  const moving = new Set(itemIds)
  for (const capsule of [...(state.capsules ?? [])]) {
    if (capsule.id === keepId || !capsule.itemIds.some(id => moving.has(id))) continue
    const remaining = capsule.itemIds.filter(id => !moving.has(id))
    if (remaining.length < 2) {
      capsule.itemIds = remaining
      releaseCapsule(state, capsule)
    } else {
      capsule.itemIds = remaining
    }
  }
}

/** 作品按 id 取;找不到就是固定中文错误,调用方不用各写一套。 */
function findWork(state, id) {
  const work = workOfId(state, id)
  if (!work) throw new Error(tr('找不到这篇作品：{id}', { id }))
  return work
}

/** 当前稿可写字段的清洗:长度上限与旧校样浮层一致,模型输出同样不可信。 */
function workCurrentFields(op) {
  const fields = {}
  if (typeof op.title === 'string') fields.title = op.title.slice(0, 200)
  if (typeof op.coverText === 'string') fields.coverText = op.coverText.slice(0, 40)
  if (typeof op.article === 'string') fields.article = op.article.slice(0, 200000)
  if (op.cover !== undefined) {
    const cover = coerce('media', op.cover)
    if (cover !== undefined) fields.cover = cover
  }
  if (op.images !== undefined) {
    fields.images = (Array.isArray(op.images) ? op.images : []).map(row => {
      const media = coerce('media', row)
      if (!media) return null
      return {
        ...media,
        ...(typeof row?.caption === 'string' ? { caption: row.caption.slice(0, 60) } : {}),
        ...(typeof row?.anchor === 'string' ? { anchor: row.anchor.slice(0, 60) } : {}),
        status: 'done',
      }
    }).filter(Boolean)
  }
  if (op.intent && typeof op.intent === 'object') fields.intent = { ...op.intent }
  if (op.review && typeof op.review === 'object') fields.review = { ...op.review }
  for (const key of Object.keys(fields)) if (!CURRENT_FIELDS.includes(key)) delete fields[key]
  return fields
}

/** 自动保存的乐观锁:带 baseRev 且对不上就 409,由界面选「用最新的」还是「覆盖」。 */
function assertWorkRev(work, op) {
  const rev = work.current?.rev ?? 0
  const base = typeof op.rev === 'number' ? op.rev : rev
  if (base !== rev && op.force !== true) {
    throw Object.assign(new Error(tr('这篇作品在别处更新过（你手上是第 {base} 版，现在是第 {rev} 版）', { base, rev })), { status: 409, rev })
  }
}

/** 写当前稿并前进 rev;更新 updatedAt 供作品页排序。 */
function stampCurrent(work, fields, now) {
  work.current = { ...(work.current ?? {}), ...fields, rev: (work.current?.rev ?? 0) + 1 }
  work.updatedAt = now
}

/** update_work 与 write_work 的公共体:同一套字段清洗与乐观锁,只差回执与空字段行为。 */
function writeCurrent(state, op, now, receipt, { throwOnEmpty = false } = {}) {
  const work = findWork(state, op.id ?? op.workId)
  const fields = workCurrentFields(op)
  if (!Object.keys(fields).length) {
    if (throwOnEmpty) throw new Error(tr('这次写回没有可写的内容'))
    return null
  }
  assertWorkRev(work, op)
  stampCurrent(work, fields, now)
  return { text: receipt(short(workTitle(work))), target: work.id, kind: 'work' }
}

/**
 * 成稿即消费排期(ADR 0013):素材的一次排期只用来触发一次成稿,
 * 无论手动点成稿还是别处写回,落库后就把主体(含整张胶囊)的排期清掉,免得反复提醒。
 */
function consumeSchedule(state, sourceIds, capsuleIds, now) {
  const ids = new Set(sourceIds)
  for (const capsuleId of capsuleIds ?? []) {
    const capsule = (state.capsules ?? []).find(row => row.id === capsuleId)
    for (const id of capsule?.itemIds ?? []) ids.add(id)
  }
  for (const id of ids) {
    const row = state.items.find(item => item.id === id)
    if (row?.scheduledAt) reduce(state, { type: 'unschedule', id, at: now })
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

const handlers = {
  add_capsule(state, op, now) {
    const itemIds = capsuleIds(state, op.itemIds)
    if (itemIds.length < 2) throw new Error(tr('胶囊至少要收进两条灵感'))
    detachFromOtherCapsules(state, itemIds, null)
    const fields = pick(CAPSULE_FIELDS, op)
    const name = typeof fields.name === 'string' && fields.name.trim() ? fields.name.trim().slice(0, 60) : defaultCapsuleName(state, itemIds)
    const capsule = { id: newId('cap'), name, itemIds, createdAt: now }
    state.capsules.unshift(capsule)
    return { text: tr('把 {n} 条灵感收进胶囊《{name}》', { n: itemIds.length, name }), target: capsule.id, kind: 'capsule' }
  },
  update_capsule(state, op) {
    const capsule = findById(state.capsules ?? [], op.id)
    const fields = pick(CAPSULE_FIELDS, op)
    if (op.itemIds !== undefined) {
      const next = capsuleIds(state, op.itemIds)
      detachFromOtherCapsules(state, next.filter(id => !capsule.itemIds.includes(id)), capsule.id)
      capsule.itemIds = next
      if (next.length < 2) {
        const name = capsule.name
        releaseCapsule(state, capsule)
        return { text: tr('胶囊《{name}》成员不足两个，已自动解散', { name }), kind: 'capsule', target: op.id }
      }
    }
    if (typeof fields.name === 'string' && fields.name.trim()) capsule.name = fields.name.trim().slice(0, 60)
    return { text: tr('更新胶囊《{name}》', { name: capsule.name }), target: capsule.id, kind: 'capsule' }
  },
  // 解散只删集合关系:成员灵感原样保留,还能单独打开
  delete_capsule(state, op) {
    const capsule = findById(state.capsules ?? [], op.id)
    releaseCapsule(state, capsule)
    return { text: tr('解散胶囊《{name}》，{n} 条灵感仍在', { name: capsule.name, n: capsule.itemIds.length }), kind: 'capsule' }
  },
  add_item(state, op, now) {
    const fields = pick(ITEM_FIELDS, op)
    const item = {
      id: newId('it'), kind: 'note', title: '', body: '', tags: [], status: 'idea', personaIds: [], createdAt: now, ...fields,
    }
    if (!item.title && !item.body && !item.media) throw new Error(tr('灵感内容为空'))
    // 只贴了图或视频也要有个名字，卡片和回执才有东西可显示
    if (!item.title) item.title = short(item.body, 28) || (item.media ? tr(item.kind === 'video' ? '{date}的视频' : '{date}的图片', { date: fmtShort(now) }) : '')
    // 先落库再经 reducer 迁移状态元组(工单 #5):一律先落成灵感,再按参数走与
    // schedule_item / set_status 完全同一批事件——同参数下先建后改的终态一致,自愈照常跑。
    const { status, scheduledAt } = item
    item.status = 'idea'
    state.items.unshift(item)
    if (scheduledAt) reduce(state, { type: 'schedule', id: item.id, scheduledAt, at: now })
    if (status && status !== 'idea') reduce(state, { type: 'setStatus', id: item.id, status, at: now })
    // 收下时直接落进胶囊(拖进胶囊浮层):胶囊不在就当普通灵感,整批收下仍是一条撤销记录
    const capsule = op.capsuleId ? (state.capsules ?? []).find(row => row.id === op.capsuleId) : null
    if (capsule) {
      detachFromOtherCapsules(state, [item.id], capsule.id)
      capsule.itemIds = [...capsule.itemIds, item.id]
    }
    return capsule
      ? { text: tr('把《{title}》收进胶囊《{name}》', { title: short(item.title), name: capsule.name }), target: item.id, kind: 'item' }
      : { text: tr('记下灵感《{title}》', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  update_item(state, op, now) {
    const item = findById(state.items, op.id)
    const { status, scheduledAt, reminder, ...fields } = pick(ITEM_FIELDS, op)
    Object.assign(item, fields)
    // 标签是手动分类:每写一次就前进一版,批量改标签的乐观锁靠它发现"预览之后又手动改过"
    if (fields.tags !== undefined) item.revision = (item.revision ?? 0) + 1
    // 胶囊成员的状态与排期跟着整体走,单独改一张会把一张卡拆成两种状态
    const { capsule, rows } = capsuleRows(state, item)
    // 提醒开关同理:一张胶囊只有一个排期设置,改哪一行都整张一起改
    const prefs = { reminder }
    const prefKeys = Object.keys(prefs).filter(key => prefs[key] !== undefined)
    for (const row of rows) for (const key of prefKeys) row[key] = prefs[key]
    if (scheduledAt !== undefined) {
      for (const row of rows) reduce(state, scheduledAt ? { type: 'schedule', id: row.id, scheduledAt, at: now } : { type: 'unschedule', id: row.id, at: now })
    }
    if (status !== undefined) {
      for (const row of rows) reduce(state, { type: 'setStatus', id: row.id, status, at: now })
    }
    const names = [...Object.keys(fields), ...prefKeys, ...(status !== undefined ? ['status'] : []), ...(scheduledAt !== undefined ? ['scheduledAt'] : [])]
    if (!names.length) return null
    return capsule
      ? { text: tr('更新胶囊《{name}》', { name: capsule.name }), target: capsule.id, kind: 'capsule' }
      : { text: tr('更新《{title}》', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  delete_item(state, op) {
    const item = findById(state.items, op.id)
    state.items = state.items.filter(row => row.id !== op.id)
    for (const child of state.items) if (child.parentId === op.id) child.parentId = item.parentId ?? null
    // 成员灵感删了就从胶囊里摘掉;剩一个的胶囊没有存在意义,自动解散(与收进胶囊共用同一套不变量)
    detachFromOtherCapsules(state, [op.id], null)
    return { text: tr('删除《{title}》', { title: short(item.title) }) }
  },
  schedule_item(state, op, now) {
    const item = findById(state.items, op.id)
    const when = coerce('date', op.scheduledAt)
    if (when === undefined) throw new Error(tr('排期时间无效'))
    const platform = coerce('platform', op.platform)
    const reminder = coerce('bool', op.reminder)
    // 胶囊排期 = 整张卡一起排;已经排过的成员也挪到这一天,否则一张胶囊摊在两处
    const { capsule, rows } = capsuleRows(state, item)
    for (const row of rows) {
      if (platform !== undefined) row.platform = platform
      if (reminder !== undefined) row.reminder = reminder
      // 排期即默认绑定系统提示;用户手动关过(reminder === false)就保持关着
      if (when && row.reminder === undefined) row.reminder = true
      reduce(state, when ? { type: 'schedule', id: row.id, scheduledAt: when, at: now } : { type: 'unschedule', id: row.id, at: now })
    }
    if (capsule) {
      const text = when
        ? tr('把胶囊《{name}》排到 {when}', { name: capsule.name, when: fmtWhen(when) }) + (platform ? ` · ${platformName(platform)}` : '')
        : tr('取消胶囊《{name}》的排期', { name: capsule.name })
      return { text, target: capsule.id, kind: 'capsule' }
    }
    return { text: when ? tr('把《{title}》排到 {when}', { title: short(item.title), when: fmtWhen(when) }) + (item.platform ? ` · ${platformName(item.platform)}` : '') : tr('取消《{title}》的排期', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  // 排期提醒的「知道了」:只写回执时间,不弹回执、不进撤销栈——它记录的是一次已读事实。
  // 胶囊按整张去重,所以一次确认写齐所有成员,横幅才不会为同一张卡再响一遍。
  ack_reminder(state, op, now) {
    const item = findById(state.items, op.id)
    const { rows } = capsuleRows(state, item)
    for (const row of rows) row.remindedAt = now
    return null
  },
  set_status(state, op, now) {
    const item = findById(state.items, op.id)
    const status = coerce('status', op.status)
    if (!status) throw new Error(tr('状态无效'))
    const { capsule, rows } = capsuleRows(state, item)
    for (const row of rows) reduce(state, { type: 'setStatus', id: row.id, status, at: now })
    return capsule
      ? { text: tr('胶囊《{name}》状态改为「{status}」', { name: capsule.name, status: statusLabel(status) }), target: capsule.id, kind: 'capsule' }
      : { text: tr('《{title}》状态改为「{status}」', { title: short(item.title), status: statusLabel(status) }), target: item.id, kind: 'item' }
  },
// 发布由用户确认(ADR 0009/0013 的红线:投递只到草稿箱,发布必须人工确认)。
  // 发布动作把当前稿深拷贝冻结成只读的 published;之后改 current 就只算「有未发布改动」。
  publish_work(state, op, now) {
    const work = findWork(state, op.id ?? op.workId)
    if (!workHasText(work)) throw new Error(tr('这份作品还没有正文，先写点内容再发布'))
    const frozen = {}
    for (const field of CURRENT_FIELDS) if (work.current?.[field] !== undefined) frozen[field] = clone(work.current[field])
    work.published = { ...frozen, publishedAt: now }
    work.publication = { ...(work.publication ?? { status: 'draft' }), status: 'published', publishedAt: now }
    work.updatedAt = now
    return { text: tr('《{title}》已发布', { title: short(workTitle(work)) }), target: work.id, kind: 'work' }
  },
  // 投递回执(ADR 0009):扩展把作品送进了平台草稿箱,这里只记「投到哪、草稿在哪」,
  // 成功回执最多把状态推到「已投递」,绝不写 published——是否已发布仍只由用户确认。
  record_work_dispatch(state, op, now) {
    const work = findWork(state, op.id ?? op.workId)
    const dispatch = op.dispatch ?? {}
    const platform = typeof dispatch.platform === 'string' ? dispatch.platform : ''
    if (!platform) throw new Error(tr('投递缺少平台'))
    const entry = {
      platform,
      ok: dispatch.ok === true,
      at: now,
      ...(typeof dispatch.url === 'string' && dispatch.url ? { url: dispatch.url } : {}),
      ...(dispatch.ok !== true && typeof dispatch.error === 'string' ? { error: dispatch.error.slice(0, 200) } : {}),
    }
    const publication = { ...(work.publication ?? { status: 'draft' }) }
    publication.dispatches = [...(publication.dispatches ?? []).slice(-19), entry]
    if (entry.ok) {
      if (publication.status !== 'published') publication.status = 'submitted'
      publication.submittedAt = publication.submittedAt ?? now
    }
    work.publication = publication
    work.updatedAt = now
    return null
  },
  // 作品编辑器的保存(自动保存)与创作会话写回(ADR 0006)走同一套字段、乐观锁与 rev 前进,
  // 只差回执措辞与空字段行为:自动保存没内容就安静跳过,写回没内容要告诉会话。
  update_work(state, op, now) {
    return writeCurrent(state, op, now, title => tr('修改《{title}》', { title }))
  },
  write_work(state, op, now) {
    return writeCurrent(state, op, now, title => tr('会话写回了《{title}》', { title }), { throwOnEmpty: true })
  },
  // 作品记录自己的创作会话指针(ADR 0014:只存 ID,风格学习时按它读转录)。
  link_work_session(state, op) {
    const work = findWork(state, op.id ?? op.workId)
    const sessionId = typeof op.sessionId === 'string' ? op.sessionId : ''
    if (!sessionId) return null
    work.sessionIds = [...new Set([...(work.sessionIds ?? []), sessionId])]
    return null
  },
  // 删除作品只删作品:来源素材不动,删完自然回到未用(ADR 0013)。
  delete_work(state, op) {
    const work = findWork(state, op.id ?? op.workId)
    state.works = (state.works ?? []).filter(row => row.id !== work.id)
    return { text: tr('删除作品《{title}》', { title: short(workTitle(work)) }) }
  },
  // 点成稿立即建一篇空作品(ADR 0013):标题取第一个来源的标题,正文留白等写;
  // 同一素材再点一次就再建一篇,旧作品保留。胶囊一次成稿只建一篇,成员不各建。
  create_work(state, op, now) {
    const { sourceIds } = resolveProduceInput(state, op)
    if (!sourceIds.length) throw new Error(tr('成稿需要至少一条灵感'))
    const capsuleIds = [...new Set(Array.isArray(op.capsuleIds) ? op.capsuleIds.filter(id => typeof id === 'string') : [])]
      .filter(id => (state.capsules ?? []).some(row => row.id === id))
    const first = state.items.find(row => row.id === sourceIds[0])
    const work = makeWork({
      id: newId('w'),
      sourceItemIds: sourceIds,
      sourceCapsuleIds: capsuleIds,
      sourceSnapshot: sourceIds.map(id => {
        const item = state.items.find(row => row.id === id)
        return { itemId: id, title: item?.title ?? '', kind: item?.kind ?? 'note' }
      }),
      current: { title: first?.title ?? '', coverText: '', article: '' },
      createdAt: now,
    })
    state.works = [work, ...(state.works ?? [])]
    // 成稿即消费排期,免得同一张卡反复提醒
    consumeSchedule(state, sourceIds, capsuleIds, now)
    return { text: tr('开始成稿《{title}》', { title: short(workTitle(work) || tr('新作品')) }), target: work.id, kind: 'work' }
  },
  // 批量改标签的 retag_items 已随不可达的批量改标签 UI 一起退役:标签改名/删除走
  // rename_tag / delete_tag(标签筛选面板),单条灵感改标签走 update_item。
  // 标签改名/删除:标签是挂在灵感上的字符串,遍历改写。没有标签表,所以也不存在孤儿。
  rename_tag(state, op) {
    const from = String(op.from ?? '').trim()
    const to = String(op.to ?? '').trim()
    if (!from || !to) throw new Error(tr('标签名不能为空'))
    if (from === to) return null
    let changed = 0
    for (const item of state.items) {
      if (!(item.tags ?? []).includes(from)) continue
      item.tags = [...new Set(item.tags.map(tag => (tag === from ? to : tag)))]
      item.revision = (item.revision ?? 0) + 1
      changed += 1
    }
    return changed ? { text: tr('标签 #{from} 改名为 #{to}（{n} 条）', { from, to, n: changed }), kind: 'tag' } : null
  },
  delete_tag(state, op) {
    const tag = String(op.tag ?? '').trim()
    if (!tag) throw new Error(tr('标签名不能为空'))
    let changed = 0
    for (const item of state.items) {
      if (!(item.tags ?? []).includes(tag)) continue
      item.tags = item.tags.filter(row => row !== tag)
      item.revision = (item.revision ?? 0) + 1
      changed += 1
    }
    return { text: tr('删除了标签 #{tag}（{n} 条）', { tag, n: changed }), kind: 'tag' }
  },
  add_person(state, op, now) {
    const person = { id: newId('p'), name: '', role: tr('目标读者'), note: '', traits: [], tone: Math.floor(Math.random() * 6), createdAt: now, ...pick(PERSON_FIELDS, op) }
    if (!person.name) throw new Error(tr('人物需要名字'))
    state.people.push(person)
    return { text: tr('添加人物「{name}」', { name: person.name }), target: person.id, kind: 'person' }
  },
  update_person(state, op) {
    const person = findById(state.people, op.id)
    Object.assign(person, pick(PERSON_FIELDS, op))
    return { text: tr('更新人物「{name}」', { name: person.name }), target: person.id, kind: 'person' }
  },
  delete_person(state, op) {
    const person = findById(state.people, op.id)
    state.people = state.people.filter(row => row.id !== op.id)
    for (const item of state.items) item.personaIds = (item.personaIds || []).filter(id => id !== op.id)
    return { text: tr('删除人物「{name}」', { name: person.name }) }
  },
  add_angle(state, op, now) {
    const angle = { id: newId('a'), name: '', hook: '', prompt: '', createdAt: now, ...pick(ANGLE_FIELDS, op) }
    if (!angle.name) throw new Error(tr('角度需要名字'))
    state.angles.push(angle)
    return { text: tr('添加创作角度「{name}」', { name: angle.name }), target: angle.id, kind: 'angle' }
  },
  update_angle(state, op) {
    const angle = findById(state.angles, op.id)
    Object.assign(angle, pick(ANGLE_FIELDS, op))
    return { text: tr('更新创作角度「{name}」', { name: angle.name }), target: angle.id, kind: 'angle' }
  },
  delete_angle(state, op) {
    const angle = findById(state.angles, op.id)
    state.angles = state.angles.filter(row => row.id !== op.id)
    for (const item of state.items) if (item.angleId === op.id) item.angleId = null
    return { text: tr('删除创作角度「{name}」', { name: angle.name }) }
  },
  add_style(state, op, now) {
    const style = { id: newId('st'), source: tr('手动'), createdAt: now, words: [], avoid: [], samples: [], ...pick(STYLE_FIELDS, op) }
    if (!style.name) throw new Error(tr('风格需要名字'))
    state.styles = [style, ...(state.styles ?? [])]
    return { text: tr('添加风格「{name}」', { name: style.name }), target: style.id, kind: 'style' }
  },
  update_style(state, op) {
    const style = findById(state.styles ?? [], op.id)
    Object.assign(style, pick(STYLE_FIELDS, op))
    return { text: tr('更新风格「{name}」', { name: style.name }) }
  },
  delete_style(state, op) {
    const style = findById(state.styles ?? [], op.id)
    state.styles = state.styles.filter(row => row.id !== op.id)
    if (state.activeStyleId === op.id) state.activeStyleId = null
    return { text: tr('删除风格「{name}」', { name: style.name }) }
  },
  set_style(state, op) {
    if (op.id === null) {
      state.activeStyleId = null
      return { text: tr('不再使用特定风格') }
    }
    const style = findById(state.styles ?? [], op.id)
    state.activeStyleId = style.id
    return { text: tr('之后按「{name}」的风格写', { name: style.name }) }
  },
  add_skill(state, op, now) {
    const skill = { id: newId('s'), name: '', rule: '', source: tr('手动'), status: 'proposed', confidence: 0.5, createdAt: now, ...pick(SKILL_FIELDS, op) }
    if (!skill.name || !skill.rule) throw new Error(tr('Skill 需要名字和规则'))
    state.skills.unshift(skill)
    return { text: tr('沉淀规则「{name}」', { name: skill.name }), target: skill.id, kind: 'skill' }
  },
  update_skill(state, op) {
    const skill = findById(state.skills, op.id)
    Object.assign(skill, pick(SKILL_FIELDS, op))
    return { text: tr('更新规则「{name}」', { name: skill.name }), target: skill.id, kind: 'skill' }
  },
  delete_skill(state, op) {
    const skill = findById(state.skills, op.id)
    state.skills = state.skills.filter(row => row.id !== op.id)
    return { text: tr('删除规则「{name}」', { name: skill.name }) }
  },
  clear_samples(state) {
    const removedItemIds = new Set(state.items.filter(row => row.sample).map(row => row.id))
    // 用户胶囊不能因清空示例被自动解散；无法保留时整批拒绝，给用户先调整的机会。
    const blockedCapsule = (state.capsules ?? []).find(capsule => !capsule.sample
      && capsule.itemIds.some(id => removedItemIds.has(id))
      && capsule.itemIds.filter(id => !removedItemIds.has(id)).length < 2)
    if (blockedCapsule) {
      throw new Error(tr('移除示例成员后，你的胶囊「{name}」将不足两名成员。请先调整或解散该胶囊；本次未改动任何数据。', { name: blockedCapsule.name }))
    }
    // 原始灵感示例和完整 demo 都按 sample 标记统一清理，用户实体原样保留。
    state.items = state.items.filter(row => !row.sample)
    state.people = state.people.filter(row => !row.sample)
    state.angles = state.angles.filter(row => !row.sample)
    state.skills = state.skills.filter(row => !row.sample)
    state.styles = (state.styles ?? []).filter(row => !row.sample)
    state.works = (state.works ?? []).filter(row => !row.sample)
    if (!state.styles.some(row => row.id === state.activeStyleId)) state.activeStyleId = null
    // 自己的数据可能挂在示例内容下面：父条目没了就断开。
    const ids = new Set(state.items.map(row => row.id))
    for (const row of state.items) if (row.parentId && !ids.has(row.parentId)) row.parentId = null
    const capsules = []
    for (const capsule of state.capsules ?? []) {
      if (capsule.sample) continue
      const itemIds = capsule.itemIds.filter(id => !removedItemIds.has(id))
      if (itemIds.length !== capsule.itemIds.length) capsule.itemIds = itemIds
      capsules.push(capsule)
    }
    state.capsules = capsules
    state.sampleCleared = true
    return { text: tr('已清空全部示例数据') }
  },
}

/**
 * 依次执行一批操作。任何一条失败都不影响已成功的操作，失败写进回执。
 * @param {object} state - 会被就地修改的状态。
 * @param {Array<object>} ops - 操作列表。
 * @returns {{receipts: Array<object>, errors: string[]}} 面向用户的回执。
 */
export function applyOps(state, ops) {
  const receipts = []
  const errors = []
  // 版本冲突(409)单独留一份,别的错误只有一句话:自动保存要凭 rev 弹「用最新的/覆盖」
  const conflicts = []
  const now = new Date().toISOString()
  for (const op of Array.isArray(ops) ? ops : []) {
    const handler = Object.hasOwn(handlers, op?.op) ? handlers[op.op] : undefined
    if (!handler) {
      errors.push(tr('不支持的操作：{op}', { op: String(op?.op) }))
      continue
    }
    try {
      const receipt = handler(state, op, now)
      if (receipt) receipts.push(receipt)
    } catch (err) {
      errors.push(err.message)
      if (err.status === 409) conflicts.push({ rev: err.rev ?? null, message: err.message })
    }
  }
  return { receipts, errors, conflicts }
}
