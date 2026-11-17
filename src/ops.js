// 工作台的唯一写入口：界面操作都走这里，统一校验字段并产出回执。
// 模型输出也是不可信输入，所以这里只放行白名单字段。
import { currentLang, platformName, tr } from './i18n.js'
// 状态枚举以 state.js 为唯一来源;这里 re-export 保持既有引用不破
import { reduce, STATUSES } from './state.js'
import { draftFormat } from './style.js'

export { STATUSES }
export const STATUS_LABEL = { idea: '灵感', outline: '大纲', draft: '草稿', ready: '待发布', published: '已发布' }
export const KINDS = ['image', 'video', 'web', 'quote', 'note']
export const PLATFORMS = ['公众号', '小红书', '抖音', 'B站', '视频号', 'TikTok', 'Instagram', 'YouTube', 'X']

/** 状态在当前语言下的名字。 */
export function statusLabel(status) {
  return tr(STATUS_LABEL[status] ?? String(status))
}

const ITEM_FIELDS = {
  title: 'text', body: 'text', kind: 'kind', url: 'url', source: 'text', tags: 'list', status: 'status', angleId: 'id',
  personaIds: 'list', parentId: 'id', rel: 'text', scheduledAt: 'date', platform: 'platform', pinned: 'bool', media: 'media', score: 'num',
  contentOrigin: 'origin',
}
const CAPSULE_FIELDS = { name: 'text', itemIds: 'ids' }
const PERSON_FIELDS = { name: 'text', role: 'text', note: 'text', traits: 'list', tone: 'num' }
const ANGLE_FIELDS = { name: 'text', hook: 'text', prompt: 'text' }
const STYLE_FIELDS = { name: 'text', icon: 'text', summary: 'text', tone: 'text', sentences: 'text', opening: 'text', structure: 'text', logic: 'text', story: 'text', flow: 'text', words: 'list', avoid: 'list', samples: 'list' }
const SKILL_FIELDS = { name: 'text', rule: 'text', source: 'text', status: 'text', confidence: 'num', evidence: 'text' }
const METRIC_FIELDS = { itemId: 'id', platform: 'platform', date: 'date', views: 'num', likes: 'num', comments: 'num', shares: 'num', saves: 'num' }
const ACCOUNT_FIELDS = { platform: 'text', handle: 'text', url: 'url', followers: 'num', note: 'text', title: 'text', description: 'text', avatar: 'url', fetchedAt: 'date', fetchError: 'text' }

let counter = 0
export function newId(prefix = 'x') {
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
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
      return { src: value.src, ...(poster ? { poster } : {}), ...(Number.isFinite(value.w) ? { w: value.w } : {}), ...(Number.isFinite(value.h) ? { h: value.h } : {}) }
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

export function fmtWhen(iso) {
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
    return { text: tr('记下灵感《{title}》', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  update_item(state, op, now) {
    const item = findById(state.items, op.id)
    const { status, scheduledAt, ...fields } = pick(ITEM_FIELDS, op)
    Object.assign(item, fields)
    // 标签是手动分类:每写一次就前进一版,批量改标签的乐观锁靠它发现"预览之后又手动改过"
    if (fields.tags !== undefined) item.revision = (item.revision ?? 0) + 1
    if (scheduledAt !== undefined) reduce(state, scheduledAt ? { type: 'schedule', id: item.id, scheduledAt, at: now } : { type: 'unschedule', id: item.id, at: now })
    if (status !== undefined) reduce(state, { type: 'setStatus', id: item.id, status, at: now })
    const names = [...Object.keys(fields), ...(status !== undefined ? ['status'] : []), ...(scheduledAt !== undefined ? ['scheduledAt'] : [])]
    return names.length ? { text: tr('更新《{title}》', { title: short(item.title) }), target: item.id, kind: 'item' } : null
  },
  delete_item(state, op) {
    const item = findById(state.items, op.id)
    state.items = state.items.filter(row => row.id !== op.id)
    for (const child of state.items) if (child.parentId === op.id) child.parentId = item.parentId ?? null
    state.metrics = state.metrics.filter(row => row.itemId !== op.id)
    // 成员灵感删了就从胶囊里摘掉;剩一个的胶囊没有存在意义,自动解散
    for (const capsule of [...(state.capsules ?? [])]) {
      if (!capsule.itemIds.includes(op.id)) continue
      const remaining = capsule.itemIds.filter(id => id !== op.id)
      if (remaining.length < 2) {
        capsule.itemIds = remaining
        releaseCapsule(state, capsule)
      } else {
        capsule.itemIds = remaining
      }
    }
    return { text: tr('删除《{title}》', { title: short(item.title) }) }
  },
  schedule_item(state, op, now) {
    const item = findById(state.items, op.id)
    const when = coerce('date', op.scheduledAt)
    if (when === undefined) throw new Error(tr('排期时间无效'))
    const platform = coerce('platform', op.platform)
    if (platform !== undefined) item.platform = platform
    reduce(state, when ? { type: 'schedule', id: item.id, scheduledAt: when, at: now } : { type: 'unschedule', id: item.id, at: now })
    return { text: when ? tr('把《{title}》排到 {when}', { title: short(item.title), when: fmtWhen(when) }) + (item.platform ? ` · ${platformName(item.platform)}` : '') : tr('取消《{title}》的排期', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  set_status(state, op, now) {
    const item = findById(state.items, op.id)
    const status = coerce('status', op.status)
    if (!status) throw new Error(tr('状态无效'))
    reduce(state, { type: 'setStatus', id: item.id, status, at: now })
    return { text: tr('《{title}》状态改为「{status}」', { title: short(item.title), status: statusLabel(status) }), target: item.id, kind: 'item' }
  },
  // 发布由用户确认(发布交接:CLI 只到草稿箱、无可靠成功信号,系统不瞎猜)。
  // 这是唯一经 reducer publish 事件写已发布状态的入口,导出与同步绝不自动调用它。
  publish_item(state, op, now) {
    const item = findById(state.items, op.id)
    reduce(state, { type: 'publish', id: item.id, at: now })
    return { text: tr('《{title}》已发布', { title: short(item.title) }), target: item.id, kind: 'item' }
  },
  // 手写稿的唯一通道:成稿产物里改正文,不再有第二套草稿字段(工单 #7 清掉遗留口径)。
  // 字段白名单与截断留在这里,落库经 reducer 的 editProduction 事件——清空正文等改动
  // 照常自愈,状态元组始终只有 state.js 一个裁决者;AI 原稿快照留给 learn 对比修改方向。
  update_production(state, op, now) {
    const item = findById(state.items, op.id)
    if (!item.production) throw new Error(tr('这条灵感还没有成稿'))
    const fields = {}
    if (typeof op.title === 'string') fields.title = op.title.slice(0, 200)
    if (typeof op.coverText === 'string') fields.coverText = op.coverText.slice(0, 40)
    if (typeof op.article === 'string') fields.article = op.article.slice(0, 200000)
    reduce(state, { type: 'editProduction', id: item.id, at: now, ...fields })
    return { text: tr('修改《{title}》', { title: short(item.production.title) }), target: item.id, kind: 'item' }
  },
  // 批量改标签:先整批校验期望版本,有一个对不上就整批拒绝——
  // Agent 的自动整理不许冲掉用户预览之后又手动改过的分类。
  retag_items(state, op) {
    const ids = [...new Set(coerce('ids', op.itemIds) ?? [])]
    if (!ids.length) throw new Error(tr('没有要改标签的灵感'))
    const tags = coerce('list', op.tags) ?? []
    const targets = ids.map(id => findById(state.items, id))
    for (const item of targets) {
      const expected = op.revisions?.[item.id]
      const current = item.revision ?? 0
      if (typeof expected !== 'number') throw new Error(tr('《{title}》没带期望版本，先看一遍改前改后再应用', { title: short(item.title) }))
      if (expected !== current) throw new Error(tr('《{title}》的标签刚被改过（期望第 {expected} 版，现在是第 {current} 版），重新预览后再应用', { title: short(item.title), expected, current }))
    }
    for (const item of targets) {
      item.tags = tags
      item.revision = (item.revision ?? 0) + 1
    }
    return { text: tr('给 {n} 条灵感改了标签', { n: targets.length }), kind: 'item' }
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
  set_format(state, op) {
    state.draftFormat = draftFormat(op.format)
    return { text: state.draftFormat === 'article' ? tr('之后写成文章') : tr('之后写成口播脚本') }
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
  add_metric(state, op) {
    const metric = { id: newId('m'), date: new Date().toISOString(), views: 0, likes: 0, comments: 0, shares: 0, saves: 0, ...pick(METRIC_FIELDS, op) }
    if (!metric.platform) throw new Error(tr('数据需要平台'))
    state.metrics.push(metric)
    return { text: tr('记录 {platform} 数据 {views} 阅读', { platform: platformName(metric.platform), views: metric.views }) }
  },
  add_account(state, op, now) {
    const account = { id: newId('ac'), platform: '', handle: '', url: null, followers: null, createdAt: now, ...pick(ACCOUNT_FIELDS, op) }
    if (!account.platform && !account.handle && !account.url) throw new Error(tr('账号信息为空'))
    state.accounts.push(account)
    return { text: tr('添加账号档案「{name}」', { name: account.handle || account.title || platformName(account.platform) }), target: account.id, kind: 'account' }
  },
  update_account(state, op) {
    const account = findById(state.accounts, op.id)
    Object.assign(account, pick(ACCOUNT_FIELDS, op))
    return { text: tr('更新账号档案「{name}」', { name: account.handle || account.title || platformName(account.platform) }) }
  },
  delete_account(state, op) {
    findById(state.accounts, op.id)
    state.accounts = state.accounts.filter(row => row.id !== op.id)
    return { text: tr('删除账号档案') }
  },
  clear_samples(state) {
    state.items = state.items.filter(row => !row.sample)
    state.people = state.people.filter(row => !row.sample)
    state.angles = state.angles.filter(row => !row.sample)
    state.metrics = state.metrics.filter(row => !row.sample)
    state.accounts = state.accounts.filter(row => !row.sample)
    state.skills = state.skills.filter(row => !row.sample)
    state.styles = (state.styles ?? []).filter(row => !row.sample)
    if (!state.styles.some(row => row.id === state.activeStyleId)) state.activeStyleId = null
    // 自己的数据可能挂在示例内容下面：父条目没了就断开，指标没了对应内容就删掉
    const ids = new Set(state.items.map(row => row.id))
    for (const row of state.items) if (row.parentId && !ids.has(row.parentId)) row.parentId = null
    state.metrics = state.metrics.filter(row => !row.itemId || ids.has(row.itemId))
    // 胶囊里挂着的示例成员摘掉;不足两个成员的胶囊按自动解散处理
    for (const capsule of [...(state.capsules ?? [])]) {
      const remaining = capsule.itemIds.filter(id => ids.has(id))
      if (remaining.length < 2) {
        capsule.itemIds = remaining
        releaseCapsule(state, capsule)
      } else {
        capsule.itemIds = remaining
      }
    }
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
    }
  }
  return { receipts, errors }
}
