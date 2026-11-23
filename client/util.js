import { EN } from './en/index.js'
import { lang, t } from './i18n.js'
// 共享表只从 src 的纯模块拿唯一定义(经 esbuild 打包进浏览器半片,未用的导出会被摇掉):
// 状态、平台与风格分类都是「加一个要改几处」的清单,不再在 client 各抄一份。
import { PLATFORMS } from '../src/platforms.js'
import { STYLE_CATEGORIES } from '../src/style-presets.js'
import { STATUS_LABEL } from '../src/state.js'

export { PLATFORMS, STATUS_LABEL, STYLE_CATEGORIES }

// 灵感墙的三个分类(参考项目的货架口径):笔记 / 文件 / 链接。原有五种 kind 归到这里,
// 金句已从新建入口撤掉,老数据按笔记显示,不删内容。
export const KIND_CATEGORY = { note: 'note', quote: 'note', image: 'file', video: 'file', web: 'link', file: 'file' }
export function categoryOf(item) {
  return KIND_CATEGORY[item?.kind] ?? 'note'
}

const IMAGE_EXT = /^(PNG|JPG|JPEG|WEBP|GIF|AVIF)$/
const VIDEO_EXT = /^(MP4|WEBM|MOV|MKV|M4V)$/

/** 卡片、缩略图与胶囊成员共用同一套类型图标，普通文件也按扩展名区分图片和视频。 */
export function itemIcon(item) {
  if (item?.kind === 'image') return 'image'
  if (item?.kind === 'video') return 'film'
  const category = categoryOf(item)
  if (category === 'link') return 'link'
  if (category === 'note') return 'pen'
  const ext = fileExtOf(item)
  if (IMAGE_EXT.test(ext)) return 'image'
  if (VIDEO_EXT.test(ext)) return 'film'
  return 'folder'
}

export function styleIcon(style) {
  return style?.icon || '✍️'
}

export function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function dayKey(date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function pad(n) {
  return String(n).padStart(2, '0')
}

export function fmtTime(iso) {
  const d = new Date(iso)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso) {
  const d = new Date(iso)
  if (lang() === 'en') return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function fmtWhen(iso) {
  if (!iso) return t('未排期')
  return `${fmtDate(iso)} ${fmtTime(iso)}`
}

export function relativeDay(iso, { now = new Date(), due = false } = {}) {
  const diff = Math.round((new Date(dayKey(iso)) - new Date(dayKey(now))) / 86400000)
  if (diff === 0 && due) return t('已到点')
  if (diff === 0) return t('今天')
  if (diff === 1) return t('明天')
  if (diff === 2) return t('后天')
  if (diff === -1) return t('昨天')
  if (diff < 0 && diff > -8) return t('{n}天前', { n: -diff })
  return fmtDate(iso)
}

export function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function compact(n) {
  if (n === null || n === undefined) return '—'
  if (lang() === 'en') {
    // 英文用 K / M，去掉多余的 .0
    const short = (value, suffix) => `${value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, '')}${suffix}`
    if (n >= 999500) return short(n / 1000000, 'M')
    if (n >= 10000) return short(n / 1000, 'K')
    return n.toLocaleString('en-US')
  }
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`
  return n.toLocaleString()
}

/** 数量后面的单位。英文在 n 为 1 时用单数，词典里 key 写成「单位|1」。 */
export function unit(n, zh) {
  if (lang() === 'en' && n === 1 && EN[`${zh}|1`] !== undefined) return EN[`${zh}|1`]
  return t(zh)
}

/** 灵感墙、时间轴与内容页只放自己记下的灵感;早期版本的分支与账号导入件不算(旧数据里仍可能带这些字段)。 */
export function isIdea(item) {
  return !item.parentId && !item.imported
}

/** 连续记录天数:今天还没记时,从昨天往回算,不会让今天一早就断掉。 */
export function computeStreak(items, now = new Date()) {
  const days = new Set(items.filter(isIdea).map(i => dayKey(i.createdAt)))
  const cursor = new Date(now)
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export function posterOf(item) {
  if (!item.media) return null
  if (item.kind === 'file') return null
  return item.media.poster || (item.kind === 'video' ? null : item.media.src)
}

/** 卡的封面:自选封面优先,其次媒体首帧/原图。文件类默认没有封面,退回类型底图。 */
export function coverOf(item) {
  return item?.cover?.src || posterOf(item) || item?.media?.poster || null
}

/** 文件类素材的原文件地址(点击外链/打开时用)。 */
export function fileOf(item) {
  return item?.media?.src ?? null
}

/** 扩展名(大写):卡片类型字、文件徽标共用;带查询串的地址也认。 */
export function extOf(name) {
  const match = /\.([a-z0-9]{1,8})(?:\?|$)/i.exec(String(name ?? ''))
  return match ? match[1].toUpperCase() : ''
}

/** 文件扩展名(大写),卡片的默认封面与站点行都拿它当类型字。 */
export function fileExtOf(item) {
  return extOf(item?.media?.src ?? '')
}

/** 文件名去掉扩展名当标题;没有扩展名原样返回。收下与编辑对话框共用。 */
export function fileTitle(name) {
  return String(name || '').replace(/\.[^.]+$/, '') || String(name || '')
}

export function fileNameOf(item) {
  const fromSrc = String(item?.media?.src ?? '').split(/[\\/]/).pop().replace(/\?.*$/, '')
  return item?.media?.name || fromSrc || item?.title || ''
}

/** 相对地址按当前页面解析成绝对地址;外链按钮与 window.open 都走这里。 */
export function absoluteUrl(src) {
  try {
    return new URL(src, window.location.href).href
  } catch {
    return src
  }
}

/** 胶囊成员按 itemIds 顺序取回(成员可能已被删,缺的跳过);胶囊卡、胶囊对话框与画布共用。 */
export function capsuleMembers(capsule, items) {
  const byId = new Map(items.map(item => [item.id, item]))
  return capsule.itemIds.map(id => byId.get(id)).filter(Boolean)
}

/** HTML 转义:renderMarkdown 同一份实现,模型或用户写的 HTML 不会执行。 */
export function escapeHtml(text) {
  return text.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

/** 草稿预览用的极简 Markdown：先转义，再处理结构，模型输出里的 HTML 不会被执行。 */
export function renderMarkdown(source) {
  const lines = source.split('\n')
  const out = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^\s*$/.test(line)) { i += 1; continue }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) { out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`); i += 1; continue }
    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(inline(lines[i].replace(/^>\s?/, ''))); i += 1 }
      out.push(`<blockquote>${quote.join('<br>')}</blockquote>`)
      continue
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()))
      const head = cells(line)
      i += 2
      const body = []
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { body.push(cells(lines[i])); i += 1 }
      out.push(`<table><thead><tr>${head.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
      continue
    }
    if (/^\s*([-*·]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const rows = []
      while (i < lines.length && /^\s*([-*·]|\d+\.)\s+/.test(lines[i])) { rows.push(`<li>${inline(lines[i].replace(/^\s*([-*·]|\d+\.)\s+/, ''))}</li>`); i += 1 }
      out.push(ordered ? `<ol>${rows.join('')}</ol>` : `<ul>${rows.join('')}</ul>`)
      continue
    }
    const para = []
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|>|\|)/.test(lines[i]) && !/^\s*([-*·]|\d+\.)\s+/.test(lines[i])) { para.push(inline(lines[i])); i += 1 }
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`)
    else { out.push(`<p>${inline(line)}</p>`); i += 1 }
  }
  return out.join('')
}

/** 正文长度：中文按字数（不算空白），英文按词数，中文字在英文里各算一个。 */
export function textLength(text) {
  if (lang() !== 'en') return text.replace(/\s/g, '').length
  return (text.match(/[\u4e00-\u9fff]|[A-Za-z0-9][A-Za-z0-9'’-]*/g) || []).length
}

