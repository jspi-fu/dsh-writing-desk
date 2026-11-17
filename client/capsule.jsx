// 胶囊:灵感墙上的异形卡堆(ADR 0004)。成员卡按格子宽度原字号重排,不做等比缩放;
// 关闭态最多露四张,其余折成纸堆边缘;点一下进入两列瀑布流的分页浮层,
// 浮层靠左右两侧翻页、顶部居中的标题改名,右键解散或移出。成员灵感仍独立存在,只是不再单独出现在灵感流里。
import React from 'react'
import { Card } from './card.jsx'
import { closeCapsule, dispatchOps, EMPTY_LIST, getDesk, openItem, openProduce, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon, openMenuAt } from './ui.jsx'
import { capsuleMembers, displayItem } from './util.js'

/** 关闭态最多露出的卡数:超出部分折成纸堆边缘,不再画空槽位。 */
const PILE_SLOTS = 4
/** 浮层一页六张:两列瀑布流,三行放得下。 */
const PER_PAGE = 6

/** 标签/类型筛选对胶囊成员使用同一口径:关闭态只显示命中的成员。 */
export function itemMatchesFilters(item, tag, kind) {
  return (!tag || (item.tags ?? []).includes(tag)) && (kind === 'all' || displayItem(item).kind === kind)
}

/** 右键菜单:解散胶囊,或在成员身上顺手把它移出;整体成稿挪进这里,浮层上就不再摆按钮。 */
export function openCapsuleMenu(event, capsule, { item = null, onProduce } = {}) {
  openMenuAt(event, [
    ...(item ? [{ label: t('移出胶囊'), icon: 'upRight', onSelect: () => removeFromCapsule(capsule, item.id) }] : []),
    { label: t('整体成稿'), icon: 'bolt', onSelect: () => (onProduce ? onProduce() : openProduce({ capsuleIds: [capsule.id] })) },
    { label: t('解散胶囊'), icon: 'trash', danger: true, onSelect: () => dissolveCapsule(capsule) },
  ])
}

function dissolveCapsule(capsule) {
  dispatchOps([{ op: 'delete_capsule', id: capsule.id }], { label: t('解散胶囊') })
}

/** 移出成员：只改胶囊的成员表，成员回到灵感流里。 */
export function removeFromCapsule(capsule, itemId) {
  const remaining = capsule.itemIds.filter(row => row !== itemId)
  return dispatchOps([{ op: 'update_capsule', id: capsule.id, itemIds: remaining }], { label: t('移出胶囊') })
}

/**
 * 关闭态胶囊:两列卡堆。成员卡按列宽重排,最多露四张,其余折成纸堆边缘,不画空槽位。
 * 点卡堆任意位置打开浮层;右键解散;拖卡可以把成员拖出去。
 */
export function CapsuleCard({ capsule, items, onOpen, onItemPointerDown, selected = false, filter = null, hiddenIds = null }) {
  const all = capsuleMembers(capsule, items)
  const unheld = hiddenIds ? all.filter(item => !hiddenIds.has(item.id)) : all
  const visible = filter ? unheld.filter(item => filter(item)) : unheld
  if (!visible.length) return null
  const shown = visible.slice(0, PILE_SLOTS)
  const folded = visible.length - shown.length
  return (
    <article
      className={`md-capsule ${selected ? 'is-selected' : ''}`}
      data-capsule={capsule.id}
      tabIndex={0}
      role="button"
      aria-label={t('胶囊 {name}（{n} 条灵感）', { name: capsule.name, n: all.length })}
      onClick={event => onOpen?.(capsule, event)}
      onContextMenu={event => openCapsuleMenu(event, capsule)}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen?.(capsule, event)
        }
      }}
    >
      <div className="md-pile">
        <div className="md-pile-grid">
          {shown.map(item => (
            <div
              key={item.id}
              className="md-pile-card"
              data-capsule-item={item.id}
              onPointerDown={onItemPointerDown ? event => onItemPointerDown(event, item, capsule) : undefined}
            >
              <Card item={item} tabIndex={-1} />
            </div>
          ))}
        </div>
        {folded > 0 ? <div className="md-pile-fold" aria-hidden="true"><i /><i /></div> : null}
      </div>
      <footer className="md-capsule-foot">
        <strong>{capsule.name}</strong>
      </footer>
    </article>
  )
}

/** 两张卡合成胶囊时,从目标卡位置铺开的卡堆预览:两列四格加一道纸堆边。 */
export function CapsulePreview({ preview, fixed = false }) {
  return (
    <div className={`md-capsule-preview${fixed ? ' is-fixed' : ''}`} style={{ left: preview.x, top: preview.y }} aria-hidden="true">
      <div className="md-capsule-preview-grid"><i /><i /><i /><i /></div>
      <div className="md-pile-fold"><i /><i /></div>
    </div>
  )
}

/**
 * 胶囊浮层:同一个卡堆放大居中,一页六张两列瀑布流。顶部居中改名,两侧翻页,右键解散,
 * 不再摆放其它按钮;关掉浮层用 Esc 或点背景。
 */
export function CapsuleView() {
  const id = useDesk(s => s.capsuleId)
  const capsule = useDesk(s => s.state?.capsules?.find(row => row.id === s.capsuleId))
  const items = useDesk(s => s.state?.items ?? EMPTY_LIST)
  const [name, setName] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [draggingId, setDraggingId] = React.useState(null)
  const [overId, setOverId] = React.useState(null)
  const [dropOut, setDropOut] = React.useState(false)
  const dragRef = React.useRef(null)
  const pageTimer = React.useRef(0)
  const suppressClick = React.useRef(false)
  const viewRef = React.useRef(null)
  const nameRef = React.useRef(null)

  React.useEffect(() => { setName(capsule?.name ?? '') }, [capsule?.name, id])
  // 正看着的胶囊被解散、撤销或自动解散时,退回灵感墙
  React.useEffect(() => { if (id && !capsule) closeCapsule() }, [id, capsule])

  const members = capsule ? capsuleMembers(capsule, items) : EMPTY_LIST
  const pages = Math.max(1, Math.ceil(members.length / PER_PAGE))
  React.useEffect(() => { setPage(current => Math.min(current, pages - 1)) }, [pages])
  React.useEffect(() => { setPage(0) }, [id])
  // 打开后把焦点收进浮层,键盘翻页和 Esc 都从这一层开始
  React.useEffect(() => { if (id) viewRef.current?.focus({ preventScroll: true }) }, [id])

  // 改名在失焦、回车、关闭三个出口都落库:Esc 关掉浮层不会把刚敲的名字丢掉
  const rename = React.useCallback((value) => {
    const current = getDesk().state?.capsules?.find(row => row.id === id)
    const next = String(value ?? '').trim()
    if (!current || !next || next === current.name) return
    dispatchOps([{ op: 'update_capsule', id, name: next }], { label: t('重命名胶囊') })
  }, [id])

  const close = React.useCallback(() => {
    rename(nameRef.current?.value ?? name)
    closeCapsule()
  }, [name, rename])

  React.useEffect(() => {
    if (!id) return undefined
    const onKey = (event) => {
      // 右键菜单开着时,Esc 先关菜单,不吃掉浮层
      if (getDesk().menu) return
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }
      if (event.target.closest?.('input,textarea,select')) return
      if (event.key === 'ArrowLeft') setPage(current => Math.max(0, current - 1))
      if (event.key === 'ArrowRight') setPage(current => Math.min(pages - 1, current + 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, pages, close])

  if (!id || !capsule) return null

  const clearDrag = () => {
    dragRef.current?.ghost?.remove()
    dragRef.current?.tileEl?.classList.remove('is-ghosted')
    dragRef.current = null
    setDraggingId(null)
    setOverId(null)
    setDropOut(false)
    clearTimeout(pageTimer.current)
    pageTimer.current = 0
  }

  // 拖到浮层左右边缘停一下:让目标页先翻出来,跨页也能排序
  const edgePage = (event) => {
    const view = viewRef.current?.getBoundingClientRect()
    if (!view || event.clientY < view.top || event.clientY > view.bottom) return
    const edge = 48
    const step = event.clientX < view.left + edge ? -1 : event.clientX > view.right - edge ? 1 : 0
    const can = step < 0 ? page > 0 : step > 0 ? page < pages - 1 : false
    if (!can) {
      if (pageTimer.current) { clearTimeout(pageTimer.current); pageTimer.current = 0 }
      return
    }
    if (pageTimer.current) return
    pageTimer.current = setTimeout(() => {
      pageTimer.current = 0
      setPage(current => Math.max(0, Math.min(pages - 1, current + step)))
    }, 420)
  }

  // 浮层内的排序用 pointer 事件:从卡片任何位置按住拖动都行,不依赖原生 HTML5 drag。
  const startTileDrag = (event, item) => {
    if (event.button !== 0) return
    const tileEl = event.currentTarget
    const startX = event.clientX
    const startY = event.clientY
    const startRect = tileEl.getBoundingClientRect()
    const grabX = startX - startRect.left
    const grabY = startY - startRect.top
    let moved = false
    let ghost = null
    const onMove = (e) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return
      if (!moved) {
        moved = true
        suppressClick.current = true
        setDraggingId(item.id)
        ghost = tileEl.cloneNode(true)
        ghost.className = `${ghost.className} md-capsule-drag-ghost`
        Object.assign(ghost.style, {
          left: `${e.clientX - grabX}px`, top: `${e.clientY - grabY}px`,
          width: `${startRect.width}px`, height: `${startRect.height}px`,
        })
        document.body.appendChild(ghost)
        tileEl.classList.add('is-ghosted')
        dragRef.current = { id: item.id, tileEl, ghost }
      }
      ghost.style.left = `${e.clientX - grabX}px`
      ghost.style.top = `${e.clientY - grabY}px`
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-capsule-tile]')
      setOverId(over && over.dataset.capsuleTile !== item.id ? over.dataset.capsuleTile : null)
      const view = viewRef.current?.getBoundingClientRect()
      setDropOut(!view || e.clientX < view.left || e.clientX > view.right || e.clientY < view.top || e.clientY > view.bottom)
      edgePage(e)
    }
    const onUp = (e) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-capsule-tile]')
      const view = viewRef.current?.getBoundingClientRect()
      const outside = !view || e.clientX < view.left || e.clientX > view.right || e.clientY < view.top || e.clientY > view.bottom
      const id = item.id
      const overRect = over?.getBoundingClientRect()
      const after = overRect ? e.clientX > overRect.left + overRect.width / 2 : false
      clearDrag()
      if (!moved) return
      setTimeout(() => { suppressClick.current = false }, 0)
      if (over && over.dataset.capsuleTile !== id) reorder(id, over.dataset.capsuleTile, after)
      else if (outside) removeFromCapsule(capsule, id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const reorder = (dragId, targetId, after = false) => {
    const ids = [...capsule.itemIds]
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(from, 1)
    const target = ids.indexOf(targetId)
    ids.splice(target + (after ? 1 : 0), 0, dragId)
    dispatchOps([{ op: 'update_capsule', id: capsule.id, itemIds: ids }], { label: t('调整胶囊顺序') })
  }

  const openMember = (item, event) => {
    if (suppressClick.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    close()
    openItem(item.id, { x: rect.left, y: rect.top, w: rect.width, h: rect.height })
  }

  const openMenuFor = (event, item) => {
    if (getDesk().menu) return
    openCapsuleMenu(event, capsule, { item, onProduce: () => { close(); openProduce({ capsuleIds: [capsule.id] }) } })
  }

  const pageItems = members.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  const go = step => setPage(current => Math.max(0, Math.min(pages - 1, current + step)))
  return (
    <div
      className={`md-capsule-mask ${dropOut ? 'is-drop-out' : ''}`}
      onPointerDown={event => { if (event.target === event.currentTarget) close() }}
      onContextMenu={event => event.preventDefault()}
    >
      {dropOut ? <div className="md-capsule-drop-hint">{t('松手移出胶囊，放到灵感墙上')}</div> : null}
      <section
        className="md-capsule-view"
        ref={viewRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('胶囊 {name}', { name: capsule.name })}
        onContextMenu={event => openMenuFor(event, null)}
      >
        <header className="md-capsule-view-head">
          <input
            ref={nameRef}
            className="md-capsule-name"
            value={name}
            onChange={event => setName(event.target.value)}
            onBlur={() => rename(name)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.target.blur() } }}
            aria-label={t('胶囊名字')}
            placeholder={t('给这堆灵感起个名')}
          />
          {pages > 1 ? <p className="md-capsule-meta">{t('第 {page} / {pages} 页', { page: page + 1, pages })}</p> : null}
        </header>

        <div className="md-pile-grid is-large">
          {pageItems.map(item => (
            <div
              key={item.id}
              className={`md-pile-card ${draggingId === item.id ? 'is-dragging' : ''} ${overId === item.id ? 'is-over' : ''}`}
              data-capsule-tile={item.id}
              role="button"
              tabIndex={0}
              aria-label={item.title}
              onPointerDown={event => startTileDrag(event, item)}
              onContextMenu={event => openMenuFor(event, item)}
              onClick={event => openMember(item, event)}
              onKeyDown={event => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                openMember(item, event)
              }}
            >
              <Card item={item} tabIndex={-1} />
            </div>
          ))}
        </div>

        {pages > 1 ? (
          <>
            <button type="button" className="md-capsule-page-btn is-prev" aria-label={t('上一页')} disabled={page === 0} onClick={() => go(-1)}>
              <Icon name="chevL" size={18} />
            </button>
            <button type="button" className="md-capsule-page-btn is-next" aria-label={t('下一页')} disabled={page >= pages - 1} onClick={() => go(1)}>
              <Icon name="chevR" size={18} />
            </button>
          </>
        ) : null}
      </section>
    </div>
  )
}
