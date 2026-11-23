// 收下：把剪贴板里的文件、从系统拖进来的文件或一段文字直接变成灵感，不弹编辑界面。
// 落点决定去向：拖到日历某天即排那天，拖进胶囊浮层即成成员，落到别处即新建在灵感墙。
import { dispatchOps, getDesk, previewUrl, report, toast, uploadFile } from './desk.js'
import { t } from './i18n.js'
import { fileTitle, fmtDate } from './util.js'

// 去重键：文件名 + 字节数 + 修改时间三项全对才算同一份文件。
// 墙面数据不存后两项，所以登记表留在浏览器里；超出条数就丢最早的。
const TAKEN_KEY = 'writing-desk-taken'
const TAKEN_MAX = 500
// 剪贴板里的位图没有真文件名（浏览器给 image.png 这种），也就没法用它判重
const SCREENSHOT_NAME = /^image\.(png|jpe?g|webp|gif)$/i


function fileKey(file) {
  return [file.name ?? '', file.size ?? 0, file.lastModified ?? 0].join('\u0000')
}

function readTaken() {
  try {
    const raw = JSON.parse(localStorage.getItem(TAKEN_KEY) ?? '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function writeTaken(map) {
  const keys = Object.keys(map)
  const trimmed = keys.length > TAKEN_MAX ? keys.slice(keys.length - TAKEN_MAX) : keys
  const next = {}
  for (const key of trimmed) next[key] = map[key]
  try { localStorage.setItem(TAKEN_KEY, JSON.stringify(next)) } catch { /* 隐私模式等存不进就少一层去重 */ }
}

function atNine(day) {
  const target = new Date(day)
  target.setHours(9, 0, 0, 0)
  return target.toISOString()
}

// 截图没有文件名，用「粘贴的截图 HH:MM」当标题；同一分钟多张加序号
function screenshotTitle(offset) {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const base = t('粘贴的截图 {time}', { time })
  const items = getDesk().state?.items ?? []
  const same = items.filter(row => row.title === base || String(row.title).startsWith(`${base} (`)).length + offset
  return same ? `${base} (${same + 1})` : base
}

/**
 * 收下一批文件。origin 只影响标题（paste 的位图叫截图），
 * day 把新灵感直接排到那天 09:00，capsuleId 让新灵感直接成为胶囊成员。
 */
export async function takeInFiles(files, { origin = 'drop', day = null, capsuleId = null } = {}) {
  const list = [...(files ?? [])].filter(Boolean)
  if (!list.length) return []
  const taken = readTaken()
  const batch = new Set()
  const fresh = []
  let dupes = 0
  for (const file of list) {
    const key = fileKey(file)
    const unjudgeable = origin === 'paste' && SCREENSHOT_NAME.test(file.name || '')
    if (!unjudgeable && (taken[key] || batch.has(key))) { dupes += 1; continue }
    batch.add(key)
    fresh.push(file)
  }
  if (!fresh.length) {
    if (dupes) toast(t('这个已经在灵感里了'))
    return []
  }

  const ops = []
  const keys = []
  let failed = 0
  let shots = 0
  for (const file of fresh) {
    try {
      const info = await uploadFile(file)
      const shot = origin === 'paste' && SCREENSHOT_NAME.test(file.name || '')
      ops.push({
        op: 'add_item',
        kind: info.kind,
        title: shot ? screenshotTitle(shots) : fileTitle(file.name),
        media: { src: info.src, name: file.name },
        ...(day ? { scheduledAt: atNine(day) } : {}),
        ...(capsuleId ? { capsuleId } : {}),
      })
      if (shot) shots += 1
      keys.push(fileKey(file))
    } catch (err) {
      failed += 1
      report(err)
    }
  }
  if (!ops.length) return []

  const label = capsuleId ? t('收进胶囊') : day ? t('排到 {date}', { date: fmtDate(day) }) : t('收下灵感')
  const data = await dispatchOps(ops, { label, silent: true })
  const ids = (data?.receipts ?? []).slice(0, keys.length).map(row => row.target).filter(Boolean)
  if (ids.length) {
    const map = readTaken()
    ids.forEach((id, index) => { map[keys[index]] = { id, at: Date.now() } })
    writeTaken(map)
  }

  const text = failed
    ? t('收下 {n} 个，{failed} 个没收下', { n: ids.length, failed })
    : capsuleId
      ? t('收进胶囊 {n} 张', { n: ids.length })
      : day
        ? t('收下 {n} 个灵感，排到 {date}', { n: ids.length, date: fmtDate(day) })
        : t('收下 {n} 个灵感', { n: ids.length })
  toast(text, { undo: ids.length > 0 })
  return ids
}

/** 收下一段文字：单个 URL 收成链接卡，其余收成笔记。 */
export async function takeInText(text) {
  const value = String(text ?? '').trim()
  if (!value) return null
  if (/^https?:\/\/\S+$/i.test(value)) {
    const info = await previewUrl(value)
    return dispatchOps([{
      op: 'add_item',
      kind: 'web',
      url: value,
      title: info?.title || value,
      body: info?.description || undefined,
      media: info?.image ? { src: info.image } : undefined,
    }], { label: t('收下链接') })
  }
  return dispatchOps([{ op: 'add_item', kind: 'note', body: value, contentOrigin: 'user' }], { label: t('收下') })
}

/**
 * 在工作台根节点上接窗口级的粘贴与拖入。
 * 焦点在输入框且有文字时让给输入框；日历、胶囊浮层、托盘自己处理过的落点（preventDefault）不再接。
 */
export function attachTakeIn(root) {
  if (!root) return () => {}
  const typing = () => {
    const el = document.activeElement
    return Boolean(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable))
  }
  const hasFiles = (dataTransfer) => Array.from(dataTransfer?.types ?? []).includes('Files')
  // 舞台不一定填满页面：没聚焦时粘贴事件的 target 是 body，不能因此当成「在舞台外」
  const inside = (node) => !node || node === document || node === document.body || node === document.documentElement || root.contains(node)
  const clearDrop = () => root.classList.remove('is-dropping')

  const onPaste = (event) => {
    if (!inside(event.target)) return
    const data = event.clipboardData
    if (!data) return
    const files = [...data.items].filter(item => item.kind === 'file').map(item => item.getAsFile()).filter(Boolean)
    const text = data.getData('text/plain')
    if (typing() && text.trim()) return
    if (files.length) {
      event.preventDefault()
      takeInFiles(files, { origin: 'paste' })
      return
    }
    if (text.trim()) {
      event.preventDefault()
      takeInText(text)
    }
  }

  const onDragOver = (event) => {
    if (!hasFiles(event.dataTransfer)) return
    event.preventDefault()
    if (root.contains(event.target)) root.classList.add('is-dropping')
  }

  const onDragLeave = (event) => {
    if (!event.relatedTarget || !root.contains(event.relatedTarget)) clearDrop()
  }

  const onDrop = (event) => {
    clearDrop()
    if (event.defaultPrevented || !root.contains(event.target)) return
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length) {
      event.preventDefault()
      takeInFiles(files, { origin: 'drop' })
      return
    }
    const types = Array.from(event.dataTransfer?.types ?? [])
    if (types.includes('application/x-writing-desk-items') || types.includes('text/writing-desk-item') || types.includes('text/writing-desk-capsule')) return
    const text = event.dataTransfer?.getData('text/plain') ?? ''
    if (text.trim() && !typing()) {
      event.preventDefault()
      takeInText(text)
    }
  }

  window.addEventListener('paste', onPaste)
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('dragend', clearDrop)
  window.addEventListener('drop', onDrop)
  return () => {
    clearDrop()
    window.removeEventListener('paste', onPaste)
    window.removeEventListener('dragover', onDragOver)
    window.removeEventListener('dragleave', onDragLeave)
    window.removeEventListener('dragend', clearDrop)
    window.removeEventListener('drop', onDrop)
  }
}