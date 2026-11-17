// 浏览器侧的状态：Host 状态的本地镜像，加上只属于界面的选中、视图等。
// 成稿发生在 DSH 创作会话(ADR 0006),这里只剩数据镜像、路由调用与界面状态。
import React from 'react'
import { lang, setLanguagePreference, t } from './i18n.js'

const BASE = 'writing-desk/'

let snapshot = {
  state: null, canUndo: false, error: null,
  view: 'home', focusId: null, sheetOrigin: null, proofId: null, query: '', kindFilter: 'all', related: null,
  capsuleId: null, retag: null, tagFilter: null, selection: null, menu: null,
  settings: null, settingsOpen: false, toast: null, capture: null, dialog: null,
  capabilities: { session: false },
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

// 校样浮层(ADR 0006):内容页成稿卡与签收栏的人工介入载体;灵感卡仍走 Editor。
export function openProof(id) {
  setDesk(s => {
    markIntake(id, s.state?.items.find(row => row.id === id)?.production?.rev ?? 0)
    return { proofId: id, focusId: null, sheetOrigin: null }
  })
}

export function closeProof() {
  setDesk({ proofId: null })
}

// 已读签收记录:itemId → 已看过的 rev,内容页据此宣布「已写回」
function readIntake() {
  try {
    const raw = JSON.parse(localStorage.getItem('writing-desk-intake') ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

export function seenRevOf(id) {
  return readIntake()[id] ?? 0
}

function markIntake(id, rev) {
  if (!id || typeof rev !== 'number') return
  const intake = readIntake()
  if ((intake[id] ?? 0) >= rev) return
  intake[id] = rev
  try { localStorage.setItem('writing-desk-intake', JSON.stringify(intake)) } catch { /* 隐私模式等存不进就当作没签收 */ }
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

// 画布多选:Shift+点选灵感或胶囊,凑一批引用到对话;清除后收回
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

// 交接三件套:保存文件夹 / 打开文件夹 / 导出发布包,都落在 Host 的 production/* 路由上
export async function saveProduced(id) {
  try {
    const data = await request('production/save', { id })
    setDesk({ state: data.state })
    const where = data.backups?.length
      ? t('已保存到 {path}。你在文件夹里改过的稿子另存成了 {names}', { path: data.path, names: data.backups.join(lang() === 'en' ? ', ' : '、') })
      : t('已保存到 {path}', { path: data.path })
    toast(where)
  } catch (err) {
    report(err)
  }
}

export async function revealSaved(id) {
  try {
    await request('production/reveal', { id })
  } catch (err) {
    report(err)
  }
}

// 发布交接(工单 #9):导出 CLI 原生发布包。只出文件与命令,是否已发布由用户在确认框里决定。
export async function exportForPublish(id) {
  try {
    const data = await request('production/export', { id })
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

// 只抓正文不调模型(ADR 0006):风格提炼的文字由这里取,之后投给创作会话。
export async function harvestText(urls) {
  return request('harvest-text', { urls })
}

export async function exportSkills() {
  try {
    const data = await request('skills/export', {})
    setDesk({ state: data.state })
    toast(t('已导出 Skill：{name}（{n} 条规则）', { name: data.name, n: data.rules }))
  } catch (err) {
    report(err)
  }
}
