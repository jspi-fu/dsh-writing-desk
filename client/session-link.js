// 会话连接单例(ADR 0006):工作台与 DSH 创作会话之间唯一的桥。
// 两头都是宿主注入的能力,插件自己不持有会话——
// - 接驳条(dock.jsx)挂载时经 setComposer 注册 inputActions.setDraft 与草稿镜像;
// - index.jsx 经 ctx.inject(['uiWorkspace']) 软依赖注入 startSession。
// 其余模块(canvas/capsule/editor/style)只调这里的函数,不直接碰宿主对象。
import { resolveProduceInput } from '../src/produce-input.js'
import { workTitle } from '../src/work.js'
import { fetchStyleMaterial, getDesk, linkWorkSession, toast } from './desk.js'
import { t } from './i18n.js'

const PRESET_WRITING = 'writing'

// dock 注册进来的输入面:setDraft 替换整段草稿,getDraft 读最近一次渲染的草稿镜像
let composer = null
// dock 注册的矩形读取器:画布拖拽据此判断松手是否落在接驳条上
let dockRect = null
// index.jsx 注入的 uiWorkspace(拿不到时 openWritingSession 降级为 toast)
let workspace = null

/** dock 挂载时注册输入面;卸载时调 setComposer(null) 归还。 */
export function setComposer(handle) {
  composer = handle && typeof handle.setDraft === 'function' ? handle : null
}


/** dock 挂载时登记自己的矩形;卸载时传 null。 */
export function registerDockRect(getter) {
  dockRect = getter
}

/** 指针落点是否在接驳条上:画布拖拽在松手时用它让位,不做移出胶囊等副作用。 */
export function overDock(x, y) {
  const rect = typeof dockRect === 'function' ? dockRect() : null
  return Boolean(rect) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

/** index.jsx 能力检测:uiWorkspace 可用就记下来。 */
export function setSessionWorkspace(service) {
  workspace = typeof service?.startSession === 'function' ? service : null
}

function dispatchRefEvent(type, ids) {
  try {
    window.dispatchEvent(new CustomEvent(type, { detail: { ids } }))
  } catch { /* 宿主环境没有 window 时静默 */ }
}

/** 画布指针拖拽开始:接驳条据此淡入为落点提示。 */
export function startRefDrag(ids) {
  dispatchRefEvent('wd-ref-dragstart', ids)
}

/** 拖拽结束(落点由 dock 自己判断);dock 未接住时一切回落原状。 */
export function endRefDrag() {
  dispatchRefEvent('wd-ref-dragend')
}

/**
 * 把 itemIds/capsuleIds 归一成引用条目。
 * resolveProduceInput 负责去重、滤掉已删除;胶囊单独成条,成员数现场数。
 * @returns {{ items: Array<{kind:'item', id, title}>, capsules: Array<{kind:'capsule', id, name, count}>, sourceIds: string[] }}
 */
export function referenceEntries(input) {
  const state = getDesk().state ?? { items: [], capsules: [] }
  // 字符串/数组 = 单个或多个灵感 ID(画布拖拽、右键);对象 = { itemIds?, capsuleIds? }
  const normalized = Array.isArray(input) ? { itemIds: input } : typeof input === 'string' ? { itemIds: [input] } : input ?? {}
  let sourceIds = []
  try {
    sourceIds = resolveProduceInput(state, normalized).sourceIds
  } catch {
    sourceIds = []
  }
  const byId = new Map(state.items.map(row => [row.id, row]))
  const capsuleIds = Array.isArray(normalized.capsuleIds) ? normalized.capsuleIds : []
  const capsules = capsuleIds
    .map(id => state.capsules?.find(row => row.id === id))
    .filter(Boolean)
  const covered = new Set(capsules.flatMap(capsule => capsule.itemIds))
  // 胶囊已整体引用的成员不再单列,避免同一素材出现两次
  const items = sourceIds
    .filter(id => !covered.has(id))
    .map(id => byId.get(id))
    .filter(Boolean)
    .map(item => ({ kind: 'item', id: item.id, title: item.title || t('无标题') }))
  return { items, capsules: capsules.map(c => ({ kind: 'capsule', id: c.id, name: c.name, count: c.itemIds.length })), sourceIds }
}

/** 作品引用行:会话据此知道该把正文写回哪篇(ADR 0013),不能只靠素材反查。 */
export function workRefLine(workId) {
  if (!workId) return ''
  const work = (getDesk().state?.works ?? []).find(row => row.id === workId)
  if (!work) return ''
  return `[${t('作品')}] 《${workTitle(work)}》(${workId})`
}

/** 引用块文本:每行一条,引用是指针——只放标题与 ID,正文由会话经 read 工具取。 */
export function referenceText(ids) {
  const { items, capsules } = referenceEntries(ids)
  const workId = Array.isArray(ids) || typeof ids === 'string' ? null : ids?.workId ?? null
  const lines = [
    ...(workRefLine(workId) ? [workRefLine(workId)] : []),
    ...items.map(item => `[${t('灵感')}] 《${item.title}》(${item.id})`),
    ...capsules.map(capsule => `[${t('胶囊')}] 《${capsule.name}》(${capsule.count} ${t('条')})`),
  ]
  return lines.length ? `${t('引用素材')}:\n${lines.join('\n')}` : ''
}

/**
 * 把引用块追加进当前草稿。行为红线:不清空用户已输入的文字——
 * 能读到草稿(dock 的镜像)就追加到末尾;读不到就只写引用块,并在 toast 里说明。
 * @returns 引用条目(落手成功的接驳条用它弹签条),失败返回 null。
 */
export function referenceIntoDraft(ids) {
  const { items, capsules, sourceIds } = referenceEntries(ids)
  if (!sourceIds.length) {
    toast(t('没有可引用的灵感'), { error: true })
    return null
  }
  const block = referenceText(ids)
  if (!block) return null
  const entry = { items, capsules, ids: sourceIds }
  if (!composer) {
    // 没有输入面(旧宿主,接驳条没挂载):引用没地方落,给出路与说明
    toast(t('请先在 DSH 里打开创作模式'))
    return null
  }
  const existing = typeof composer.getDraft === 'function' ? composer.getDraft() : null
  const next = existing?.trim() ? `${existing.replace(/\s+$/, '')}\n\n${block}` : block
  composer.setDraft(next)
  toast(t('已插入引用,补一句意图再回车'))
  return entry
}

/**
 * 开创作会话并预填引用块,不自动 submit。
 * 经 uiWorkspace.startSession(空 workspace = 当前工作区)开会话,prompt 预填、
 * whenDraftExists: 'append' 保证已有草稿原样保留。
 */
/** 把素材条目写成参考项目的上下文骨架:标题、来源/链接/文件、标签,再接正文。 */
export function referenceContext(ids) {
  const state = getDesk().state ?? { items: [], capsules: [] }
  const { items, capsules } = referenceEntries(ids)
  const byId = new Map(state.items.map(row => [row.id, row]))
  const blocks = []
  for (const entry of items) {
    const item = byId.get(entry.id)
    if (!item) continue
    const head = [`## ${item.title || t('无标题')}`]
    if (item.source) head.push(`${t('来源')}: ${item.source}`)
    if (item.url) head.push(`URL: ${item.url}`)
    if (item.media?.src && item.kind !== 'web') head.push(`${t('文件')}: ${item.media.name || item.media.src}`)
    if (item.tags?.length) head.push(`${t('标签')}: ${item.tags.join(', ')}`)
    const body = String(item.body || '').trim()
    blocks.push(`${head.join('\n')}${body ? `\n\n${body.slice(0, 20000)}` : ''}`)
  }
  for (const capsule of capsules) {
    const source = (state.capsules ?? []).find(row => row.id === capsule.id)
    const memberIds = new Set(source?.itemIds ?? [])
    const members = (state.items ?? []).filter(row => memberIds.has(row.id))
    blocks.push(`## ${capsule.name}\n${t('胶囊')} · ${t('{n} 条灵感', { n: members.length })}\n\n${members.map(item => `- ${item.title || t('无标题')}`).join('\n')}`)
  }
  return blocks.length ? `# ${t('图文创作台上下文')}\n\n${blocks.join('\n\n---\n\n')}` : ''
}

/** 复制给 AI:整段上下文进剪贴板,不依赖宿主会话。 */
export async function copyReferenceForAI(ids) {
  const text = referenceContext(ids)
  if (!text) return toast(t('没有可复制的灵感'), { error: true })
  try {
    await navigator.clipboard.writeText(text)
    toast(t('已复制给 AI'))
    return text
  } catch (err) {
    toast(t('复制失败：{reason}', { reason: err?.message || String(err) }), { error: true })
    return null
  }
}

/**
 * 引用签的统一构造:每条素材一个 insertQuote(text, summary)。
 * 「添加到当前会话」与「创作」用同一套签面,输入框里看到的是同一种渲染。
 */
function quotePayload(ids) {
  const { items, capsules } = referenceEntries(ids)
  const state = getDesk().state ?? { items: [], capsules: [] }
  const byId = new Map(state.items.map(row => [row.id, row]))
  const payload = []
  const workId = Array.isArray(ids) || typeof ids === 'string' ? null : ids?.workId ?? null
  if (workId) {
    const work = (state.works ?? []).find(row => row.id === workId)
    if (work) {
      payload.push({
        text: `${t('作品')}:《${workTitle(work)}》(${workId})`,
        summary: { label: t('作品'), title: workTitle(work), detail: t('正文写回这一篇') },
      })
    }
  }
  for (const entry of items) {
    const item = byId.get(entry.id)
    if (!item) continue
    payload.push({
      text: `${t('素材')}:《${item.title || t('无标题')}》(${item.id})`,
      summary: {
        label: t('灵感'),
        title: item.title || t('无标题'),
        detail: item.source || (item.kind === 'web' ? '链接' : undefined),
        body: String(item.body || '').slice(0, 160),
      },
    })
  }
  for (const capsule of capsules) {
    payload.push({
      text: `${t('素材')}:《${capsule.name}》(${capsule.count} ${t('条')})`,
      summary: {
        label: t('胶囊'),
        title: capsule.name,
        detail: t('{n} 条灵感', { n: capsule.count }),
      },
    })
  }
  return payload
}

function pushQuotes(handle, payload) {
  let inserted = 0
  for (const quote of payload) {
    try {
      if (handle.insertQuote(quote.text, quote.summary)) inserted += 1
    } catch { /* 输入面没就绪时下一轮重试 */ }
  }
  return inserted
}

/**
 * 添加到当前会话:有 inputActions.insertQuote 就插引用签(可点开看标题/详情),
 * 旧宿主只有 setDraft 时退回追加文本。
 */
export function addReferenceToCurrentSession(ids) {
  const { items, capsules, sourceIds } = referenceEntries(ids)
  if (!sourceIds.length) return toast(t('没有可引用的灵感'), { error: true })
  if (!composer) return toast(t('请先在 DSH 里打开创作模式'))
  if (typeof composer.insertQuote !== 'function') return referenceIntoDraft(ids)
  const payload = quotePayload(ids)
  const inserted = pushQuotes(composer, payload)
  if (!inserted) return toast(t('没有可引用的灵感'), { error: true })
  toast(t('已添加到当前会话'))
  return { items, capsules, text: referenceContext(ids) }
}

// 「创作」暂存的素材签:startSession 只收纯文本,输入框里的引用签要等新会话的
// 接驳条挂载、拿到那个会话的 inputActions 之后再补——否则插不进新输入框。
let pendingCreate = null
const PENDING_MS = 15000

/** 新会话接驳条挂载后调用:插成功才消费暂存,失败留着重试。 */
export function claimPendingReference(handle) {
  if (!pendingCreate) return 0
  if (Date.now() - pendingCreate.at > PENDING_MS) { pendingCreate = null; return 0 }
  if (typeof handle?.insertQuote !== 'function') return 0
  const inserted = pushQuotes(handle, pendingCreate.payload)
  if (inserted) {
    pendingCreate = null
  }
  return inserted
}

/** 暂存还在(输入面还没接住)时 dock 继续退避重试。 */
export function hasPendingReference() {
  return Boolean(pendingCreate) && Date.now() - pendingCreate.at <= PENDING_MS
}

/**
 * startSession 返回的会话句柄形状随宿主而异,只要能捞出 id 就登记到作品的 sessionIds;
 * 捞不到也不影响创作——作品 id 已经写在 prompt 里,写回仍落到同一篇。
 */
function bindWorkSession(workId, started) {
  if (!workId) return
  Promise.resolve(started).then(result => {
    const sessionId = result?.sessionId ?? result?.id ?? result?.session?.id
    if (sessionId) linkWorkSession(workId, sessionId)
  }).catch(() => { /* 会话登记只是风格学习的线索,失败不打断创作 */ })
}

export function openWritingSession(ids) {
  const workId = Array.isArray(ids) || typeof ids === 'string' ? null : ids?.workId ?? null
  if (!referenceEntries(ids).sourceIds.length && !workId) return toast(t('没有可引用的灵感'), { error: true })
  if (!workspace) return toast(t('请先在 DSH 里打开创作模式'))
  // 当前输入面支持引用签 → 空草稿开新会话,由新会话的 dock 把签补进去;
  // 旧宿主只能传纯文本 prompt,保持原样。
  if (composer && typeof composer.insertQuote === 'function') {
    pendingCreate = { payload: quotePayload(ids), at: Date.now() }
    try {
      bindWorkSession(workId, workspace.startSession(undefined, { agentPreset: PRESET_WRITING }))
    } catch (err) {
      pendingCreate = null
      toast(err?.message || String(err), { error: true })
      return
    }
    toast(t('已打开创作会话,引用放在了输入框'))
    // 兜底:若宿主复用当前会话、dock 不重挂,稍后把签补进仍然有效的输入面
    const before = composer
    setTimeout(() => {
      if (!pendingCreate || composer !== before) return
      claimPendingReference(composer)
    }, 1200)
    return
  }
  const block = referenceText(ids)
  if (!block) return toast(t('没有可引用的灵感'), { error: true })
  try {
    bindWorkSession(workId, workspace.startSession(undefined, { agentPreset: PRESET_WRITING, prompt: block, whenDraftExists: 'append' }))
    toast(t('已打开创作会话,引用放在了输入框'))
  } catch (err) {
    toast(err?.message || String(err), { error: true })
  }
}

/**
 * 从作品学习写法(ADR 0014):Host 读作品登记过的创作会话 + 发布稿,
 * 拼成材料预填到新开的风格会话;只写候选规则/候选风格卡,不自动启用。
 * 返回 { missing } 给对话框提示「哪几篇只读到发布稿」。
 */
export async function openStyleSessionFromWorks(workIds, name = '') {
  if (!workspace) return toast(t('请先在 DSH 里打开创作模式'))
  const data = await fetchStyleMaterial(workIds, name)
  workspace.startSession(undefined, { agentPreset: PRESET_WRITING, prompt: data.prompt, whenDraftExists: 'append' })
  if (data.missing?.length) toast(t('已打开风格会话；{n} 篇只读到发布稿,材料里已标注', { n: data.missing.length }))
  else toast(t('已打开风格会话,材料贴在了输入框'))
  return data
}

/** 风格提炼变体(风格页):材料文字直接放进 prompt,会话经 add_style 工具写回风格卡。 */
export function openStyleSession(text, name) {
  const material = String(text ?? '').trim()
  if (!material) return toast(t('没有可提炼的内容'), { error: true })
  if (!workspace) return toast(t('请先在 DSH 里打开创作模式'))
  const title = name?.trim() ? `\n风格卡名字用「${name.trim()}」。` : ''
  const prompt = `请阅读下面这位作者的内容,提炼成风格卡并写回工作台(经 writing_desk_add_style)。只提炼声纹:语气、句式、常用词、开头与结构;不要复述内容。提炼完把结论告诉我。${title}\n<material>\n${material}\n</material>`
  try {
    workspace.startSession(undefined, { agentPreset: PRESET_WRITING, prompt, whenDraftExists: 'append' })
    toast(t('已打开创作会话,材料贴在了输入框'))
  } catch (err) {
    toast(err?.message || String(err), { error: true })
  }
}
