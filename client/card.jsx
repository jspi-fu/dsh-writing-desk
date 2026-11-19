// 灵感卡片:和参考项目 StashDock 的货架卡同一副骨架——
// 16:9 封面(左上勾选、右上删除,悬停才显形)+ 标题(始终占两行)+ 站点行 + 黑胶囊按钮。
// 与参考的三处刻意不同:点卡是编辑入口(不打开原网页)、卡片没有星标、
// 黑胶囊打开的是创作模式而不是聊天。JSX 走 classic 运行时,React import 必须留。
import React from 'react'
import { dispatchOps, setDesk, toggleSelect } from './desk.js'
import { t } from './i18n.js'
import { Icon, openMenuAt } from './ui.jsx'
import { absoluteUrl, categoryOf, coverOf, displayItem, fileExtOf, fileOf, fileNameOf } from './util.js'
import { addReferenceToCurrentSession, copyReferenceForAI, openWritingSession } from './session-link.js'

const CATEGORY_ICON = { note: 'pen', link: 'link', file: 'folder' }
const CATEGORY_WORD = { note: '笔记', link: '链接', file: '文件' }
// 文件类默认封面按扩展名挑图标:图片/视频用媒体图标,其余一律文件图标
const IMAGE_EXT = /^(PNG|JPG|JPEG|WEBP|GIF|AVIF)$/
const VIDEO_EXT = /^(MP4|WEBM|MOV|MKV|M4V)$/

/** 新建灵感:对话框默认落在笔记页签。 */
export function openCapture(tab = 'note') {
  setDesk({ capture: { mode: 'create', tab } })
}

/** 编辑灵感:和新增用同一个对话框,带出现有字段。 */
export function openEditItem(id) {
  setDesk({ capture: { mode: 'edit', id } })
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** 默认封面的图标与类型字:参考项目没有封面时就是「类型 glyph + 类型名」。 */
function defaultFace(item) {
  const category = categoryOf(item)
  if (category === 'file') {
    const ext = fileExtOf(item)
    if (IMAGE_EXT.test(ext)) return { icon: 'image', caption: ext }
    if (VIDEO_EXT.test(ext)) return { icon: 'film', caption: ext }
    return { icon: 'folder', caption: ext || t('文件') }
  }
  return { icon: CATEGORY_ICON[category], caption: t(CATEGORY_WORD[category]) }
}

/** 没有封面时的类型底图:图标在上、类型名在下,参考项目的默认封面同一套信息。 */
export function DefaultCover({ item, compact = false }) {
  const face = defaultFace(item)
  return (
    <div className={`md-tile-void is-${categoryOf(item)}`} aria-hidden="true">
      <Icon name={face.icon} size={compact ? 20 : 26} />
      <span className="md-tile-voidcap">{face.caption}</span>
    </div>
  )
}

/** 站点的行:链接给域名 + 外链,文件给扩展名/文件名 + 打开文件,笔记只给类型字。 */
function SiteRow({ item, category }) {
  const host = hostOf(item.url)
  const ext = fileExtOf(item)
  const url = category === 'link' && item.url ? item.url : null
  const file = category === 'file' ? fileOf(item) : null
  const label = category === 'link'
    ? (host || item.source || t('链接'))
    : category === 'file'
      ? (fileNameOf(item) || ext || t('文件'))
      : t('笔记')
  const open = (event) => {
    event.preventDefault()
    event.stopPropagation()
    const target = url || (file ? absoluteUrl(file) : null)
    if (target) window.open(target, '_blank', 'noopener,noreferrer')
  }
  return (
    <span className="md-tile-site" title={label}>
      <Icon name={category === 'link' ? 'link' : category === 'file' ? 'folder' : 'pen'} size={12} />
      <span>{label}</span>
      {url || file ? (
        <button type="button" className="md-tile-open" aria-label={t('打开原件')} title={t('打开原件')} onClick={open}>
          <Icon name="upRight" size={12} />
        </button>
      ) : null}
    </span>
  )
}

/**
 * 灵感卡片。点击整卡进编辑对话框;封面左上圆钮是多选,右上垃圾桶删除(可撤销);
 * 底部黑胶囊点击直接进创作会话,右侧小箭头展开「复制给 AI / 添加到当前会话」。
 */
export function Card({ item: raw, selected = false, compact = false, bare = false, onOpen = openEditItem, dragIds }) {
  const item = displayItem(raw)
  const category = categoryOf(raw)
  const cover = coverOf(item)
  const pick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    toggleSelect('item', raw.id)
  }
  const remove = (event) => {
    event.preventDefault()
    event.stopPropagation()
    dispatchOps([{ op: 'delete_item', id: raw.id }], { label: t('删除灵感') })
  }
  const compose = (event) => {
    event.preventDefault()
    event.stopPropagation()
    openWritingSession({ itemIds: [raw.id] })
  }
  const more = (event) => {
    event.preventDefault()
    event.stopPropagation()
    openMenuAt(event, [
      { label: t('复制给 AI'), icon: 'copy', onSelect: () => copyReferenceForAI({ itemIds: [raw.id] }) },
      { label: t('添加到当前会话'), icon: 'link', onSelect: () => addReferenceToCurrentSession({ itemIds: [raw.id] }) },
    ])
  }
  const open = (event) => {
    if (suppressClickOnButton(event)) return
    event?.stopPropagation?.()
    onOpen(raw.id, event)
  }
  // 拖拽入胶囊:拖动一张卡时把它(或已多选的那一组)一起带走
  const dragStart = (event) => {
    const ids = dragIds?.length ? dragIds : [raw.id]
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('application/x-writing-desk-items', JSON.stringify(ids))
    event.currentTarget.classList.add('is-dragging')
  }
  const dragEnd = (event) => {
    event.currentTarget.classList.remove('is-dragging')
  }
  return (
    <article
      className={`md-tile is-${category} ${selected ? 'is-selected' : ''} ${compact ? 'is-compact' : ''} ${bare ? 'is-bare' : ''}`}
      data-card={raw.id}
      tabIndex={0}
      role="button"
      draggable={!!dragIds}
      onDragStart={dragStart}
      onDragEnd={dragEnd}
      aria-label={t('{kind}：{title}', { kind: t(CATEGORY_WORD[category]), title: item.title || String(raw.body || '').trim().slice(0, 24) || t('（无标题）') })}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        open(event)
      }}
    >
      <div className="md-tile-art">
        {cover ? <img className="md-tile-cover" src={absoluteUrl(cover)} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" /> : <DefaultCover item={raw} compact={compact} />}
        {raw.kind === 'video' ? <span className="md-tile-play"><Icon name="play" size={12} fill /></span> : null}
        {bare ? null : (
          <>
            <button type="button" className={`md-tile-check ${selected ? 'is-on' : ''}`} aria-pressed={selected} aria-label={selected ? t('取消选择') : t('选择')} onClick={pick}>
              {selected ? <Icon name="check" size={12} /> : null}
            </button>
            <div className="md-tile-tools">
              <button type="button" aria-label={t('删除灵感')} title={t('删除灵感')} onClick={remove}><Icon name="trash" size={14} /></button>
            </div>
          </>
        )}
      </div>
      <div className="md-tile-body">
        <h3 className="md-tile-title" title={item.title}>{item.title || t('（无标题）')}</h3>
        <div className="md-tile-foot">
          <SiteRow item={raw} category={category} />
          {bare ? null : (
            <div className="md-tile-pill">
              <button type="button" className="md-pill-main" onClick={compose} title={t('进入创作会话')}>{t('创作')}</button>
              <button type="button" className="md-pill-caret" aria-label={t('更多操作')} onClick={more}><Icon name="chevD" size={12} /></button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/** 点在卡内按钮上时不要把事件升级成「打开编辑」。 */
function suppressClickOnButton(event) {
  return Boolean(event?.target?.closest?.('button'))
}