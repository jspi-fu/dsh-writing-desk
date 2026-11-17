// 会话连接单例(ADR 0006):工作台与 DSH 创作会话之间唯一的桥。
// 两头都是宿主注入的能力,插件自己不持有会话——
// - 接驳条(dock.jsx)挂载时经 setComposer 注册 inputActions.setDraft 与草稿镜像;
// - index.jsx 经 ctx.inject(['uiWorkspace']) 软依赖注入 startSession。
// 其余模块(canvas/capsule/editor/style)只调这里的函数,不直接碰宿主对象。
import { resolveProduceInput } from '../src/produce-input.js'
import { getDesk, setDesk, toast } from './desk.js'
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

export function getComposer() {
  return composer
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

/** index.jsx 能力检测:uiWorkspace 可用就记下来,capabilities.session 同步进 desk store。 */
export function setSessionWorkspace(service) {
  workspace = typeof service?.startSession === 'function' ? service : null
  setDesk({ capabilities: { session: Boolean(workspace) } })
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

/** 引用块文本:每行一条,引用是指针——只放标题与 ID,正文由会话经 read 工具取。 */
export function referenceText(ids) {
  const { items, capsules } = referenceEntries(ids)
  const lines = [
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
export function openWritingSession(ids) {
  const block = referenceText(ids)
  if (!block) return toast(t('没有可引用的灵感'), { error: true })
  if (!workspace) return toast(t('请先在 DSH 里打开创作模式'))
  try {
    workspace.startSession(undefined, { agentPreset: PRESET_WRITING, prompt: block, whenDraftExists: 'append' })
    toast(t('已打开创作会话,引用放在了输入框'))
  } catch (err) {
    toast(err?.message || String(err), { error: true })
  }
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
