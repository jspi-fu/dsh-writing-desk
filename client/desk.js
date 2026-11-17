// 浏览器侧的状态：Host 状态的本地镜像，加上只属于界面的选中、视图等。
import React from 'react'
import { resolveProduceInput } from '../src/produce-input.js'
import { coverDataUrl } from './cover.js'
import { lang, plural, setLanguagePreference, t } from './i18n.js'

const BASE = 'writing-desk/'

let snapshot = {
  state: null, canUndo: false, error: null,
  view: 'home', focusId: null, sheetOrigin: null, produceId: null, produceSources: null, query: '', kindFilter: 'all', related: null,
  capsuleId: null, retag: null, tagFilter: null, selection: null, menu: null,
  live: {}, settings: null, settingsOpen: false, toast: null, capture: null, dialog: null,
}
// getSnapshot 稳定性:useDesk 选择器缺字段时回落到这同一个数组引用,
// 每次返回新 [] 会让 useSyncExternalStore 认为快照一直在变,触发 React #185 无限渲染
export const EMPTY_LIST = []
const listeners = new Set()

export function getDesk() {
  return snapshot
}

export function setDesk(patch) {
  snapshot = { ...snapshot, ...(typeof patch === 'function' ? patch(snapshot) : patch) }
  listeners.forEach(fn => fn())
}

function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useDesk(selector) {
  return React.useSyncExternalStore(subscribe, () => selector(snapshot))
}

async function request(path, body) {
  const res = await fetch(BASE + path, body === undefined ? { headers: { 'x-writing-desk-lang': lang() } } : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-writing-desk-lang': lang() }, body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || t('请求失败（{status}）', { status: res.status }))
  return data
}

let toastTimer = null
export function toast(text, { undo = false, error = false } = {}) {
  clearTimeout(toastTimer)
  setDesk({ toast: { text, undo, error, key: Date.now() } })
  toastTimer = setTimeout(() => setDesk({ toast: null }), undo || text.length > 24 ? 6000 : 3200)
}

export function report(err) {
  toast(err.message || String(err), { error: true })
}

export async function loadDesk() {
  try {
    // 先读设置拿到语言偏好，示例数据按这个语言返回
    const settings = await request('settings')
    setLanguagePreference(settings.language)
    const data = await request('state')
    setDesk({ settings, state: data.state, canUndo: data.canUndo, error: null })
  } catch (err) {
    setDesk({ error: err.message })
  }
}

export async function dispatchOps(ops, { label = t('操作'), undoable = true, silent = false } = {}) {
  try {
    const data = await request('ops', { ops, label, undoable })
    setDesk({ state: data.state, canUndo: undoable || snapshot.canUndo })
    if (data.errors?.length) toast(data.errors[0], { error: true })
    else if (!silent && data.receipts?.[0]) toast(data.receipts[0].text, { undo: undoable })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

export async function undo() {
  try {
    const data = await request('undo', {})
    setDesk({ state: data.state, canUndo: data.canUndo, toast: null })
    if (data.label) toast(t('已撤销：{label}', { label: data.label }))
  } catch (err) {
    report(err)
  }
}

export function openItem(id, origin = null) {
  setDesk({ focusId: id, sheetOrigin: origin })
}

export function closeItem() {
  setDesk({ focusId: null, sheetOrigin: null })
}

// 胶囊对话框:重命名、看成员、解散
export function openCapsule(id) {
  setDesk({ capsuleId: id })
}

export function closeCapsule() {
  setDesk({ capsuleId: null })
}

// 右键菜单:一个全局实例,坐标相对 .md-root,避免被画布/浮层的容器裁掉
export function openMenu(at, items) {
  setDesk({ menu: { x: at.x, y: at.y, items } })
}

export function closeMenu() {
  setDesk({ menu: null })
}

// 批量改标签:先 diff 预览再应用,版本冲突时 Host 拒绝
export function openRetag(ids) {
  setDesk({ retag: { ids } })
}

export function closeRetag() {
  setDesk({ retag: null })
}

// 画布多选:Shift+点选灵感或胶囊,凑一批直接成稿;成稿或清除后收回
export function toggleSelect(kind, id) {
  setDesk(s => {
    const key = kind === 'capsule' ? 'capsules' : 'items'
    const current = s.selection ?? { items: [], capsules: [] }
    const list = current[key].includes(id) ? current[key].filter(row => row !== id) : [...current[key], id]
    return { selection: { ...current, [key]: list } }
  })
}

export function clearSelection() {
  setDesk({ selection: null })
}

// 统一成稿入口(GLOSSARY「成稿输入」):单灵感/多灵感/单胶囊/多胶囊都进这一个工作面。
// 字符串 = 单灵感(编辑界面「去成稿」);对象 = { itemIds } / { capsuleIds }(画布多选、胶囊、标签资料架)。
// 解析与 Host 用同一个模块:去重、滤掉已删除;产物落在第一个来源上。
export function openProduce(input) {
  const state = getDesk().state
  const resolved = typeof input === 'string' ? { itemIds: [input] } : input ?? {}
  let sourceIds = []
  try {
    sourceIds = resolveProduceInput(state ?? { items: [], capsules: [] }, resolved).sourceIds
  } catch {
    sourceIds = []
  }
  if (!sourceIds.length) return toast(t('没有可成稿的灵感'), { error: true })
  setDesk({
    focusId: null, sheetOrigin: null, selection: null,
    produceId: sourceIds[0],
    produceSources: sourceIds.length > 1 ? sourceIds : null,
  })
}

export function closeProduce() {
  setDesk({ produceId: null, produceSources: null })
}

/** 一键成稿。任务在 Host 里跑，这里只负责启动和看进度；多来源时把来源一并交给 Host 解析。 */
export async function runProduce(id, { withImages, itemIds } = {}) {
  try {
    const data = await request('produce', {
      id,
      ...(Array.isArray(itemIds) && itemIds.length > 1 ? { itemIds } : {}),
      ...(typeof withImages === 'boolean' ? { withImages } : {}),
    })
    setDesk({ state: data.state })
  } catch (err) {
    report(err)
  }
}

export async function cancelProduce(id) {
  try {
    await request('produce/cancel', { id })
  } catch (err) {
    report(err)
  }
}

export async function regenAsset(id, target) {
  try {
    const data = await request('produce/regen', { id, target })
    setDesk({ state: data.state })
  } catch (err) {
    report(err)
  }
}

function mergeProduction(id, production, status) {
  setDesk(s => ({ state: { ...s.state, items: s.state.items.map(item => (item.id === id ? { ...item, production, ...(status ? { status } : {}) } : item)) } }))
}

/** 轮询进度，返回停止函数。 */
export function watchProduction(id) {
  let stopped = false
  const tick = async () => {
    while (!stopped) {
      try {
        const data = await request(`production?id=${encodeURIComponent(id)}`)
        if (stopped) return
        setDesk(s => ({ live: { ...s.live, [id]: data.live } }))
        if (data.production) mergeProduction(id, data.production, data.status)
      } catch {
        // 连接抖动时下一轮再试
      }
      await new Promise(r => setTimeout(r, 700))
    }
  }
  tick()
  return () => { stopped = true }
}

export async function saveSettings(payload) {
  try {
    const settings = await request('settings', payload)
    setLanguagePreference(settings.language)
    setDesk({ settings })
    toast(t('设置已保存'))
    return true
  } catch (err) {
    report(err)
    return false
  }
}

export async function testImage(payload) {
  try {
    const settings = await request('settings', payload)
    setLanguagePreference(settings.language)
    setDesk({ settings })
    const { src } = await request('settings/test', {})
    return src
  } catch (err) {
    report(err)
    return null
  }
}

export async function saveProduced(id) {
  try {
    const production = snapshot.state.items.find(row => row.id === id)?.production
    // 视频封面在浏览器里合成，一起存进文件夹
    const videoCover = await coverDataUrl({ src: production.cover?.src, text: production.coverText || production.title }).catch(() => undefined)
    const data = await request('produce/save', { id, videoCover })
    setDesk({ state: data.state })
    const where = data.backups?.length
      ? t('已保存到 {path}。你在文件夹里改过的稿子另存成了 {names}', { path: data.path, names: data.backups.join(lang() === 'en' ? ', ' : '、') })
      : t('已保存到 {path}', { path: data.path })
    // 导出成稿也沉淀规则(工单 #10):Host 保存后顺手提炼,这里把结果说清楚
    toast(data.learned ? t('{where}，并把你的修改沉淀成了规则', { where }) : where)
  } catch (err) {
    report(err)
  }
}

export async function revealSaved(id) {
  try {
    await request('produce/reveal', { id })
  } catch (err) {
    report(err)
  }
}

// 发布交接(工单 #9):导出 CLI 原生发布包。只出文件与命令,是否已发布由用户在确认框里决定。
export async function exportForPublish(id) {
  try {
    const data = await request('produce/export', { id })
    setDesk({ state: data.state })
    return data
  } catch (err) {
    report(err)
    return null
  }
}

export async function captureUrl(url, extra = {}) {
  try {
    const data = await request('capture-url', { url, ...extra })
    setDesk({ state: data.state, canUndo: true })
    toast(t('已收藏到灵感墙'), { undo: true })
    return data.id
  } catch (err) {
    report(err)
    return null
  }
}

export async function uploadFile(file) {
  const res = await fetch(`${BASE}upload`, { method: 'POST', headers: { 'content-type': file.type, 'x-writing-desk-lang': lang() }, body: file })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || t('上传失败'))
  return data
}

export async function captureFiles(files) {
  for (const file of files) {
    try {
      const { src, kind } = await uploadFile(file)
      const title = file.name.replace(/\.[^.]+$/, '')
      await dispatchOps([{ op: 'add_item', kind, title, media: { src } }], { label: t('收藏 {title}', { title }), silent: true })
      toast(t('已放到灵感墙'), { undo: true })
    } catch (err) {
      report(err)
    }
  }
}

export async function extractStyle(payload) {
  try {
    const data = await request('style/extract', payload)
    setDesk({ state: data.state, canUndo: true })
    const missed = data.failures?.length ?? 0
    toast(missed ? t(plural(missed, '风格提炼好了，有 1 个链接没抓到', '风格提炼好了，有 {n} 个链接没抓到'), { n: missed }) : t('风格提炼好了，之后就按它写'), { undo: true })
    return true
  } catch (err) {
    report(err)
    return false
  }
}

export async function exportSkills() {
  try {
    const data = await request('skills/export', {})
    setDesk({ state: data.state })
    toast(t(plural(data.rules, '已导出 Skill：{name}（1 条规则）', '已导出 Skill：{name}（{n} 条规则）'), { name: data.name, n: data.rules }))
  } catch (err) {
    report(err)
  }
}

