// 胶囊:一组灵感卡片的集合(ADR 0004)。它和灵感卡长得同一种,但没有「编辑」——
// 点开是集合的浮层,右上角是「解散」;多选、解散、添加成员都和多选条走同一套动作。
// 成员灵感仍独立存在,只是不再单独出现在墙面上。
import React from 'react'
import { Card } from './card.jsx'
import { closeCapsule, createWork, dispatchOps, EMPTY_LIST, openCapsule, openItem, openWork, setDesk, toggleSelect, useDesk } from './desk.js'
import { addReferenceToCurrentSession, copyReferenceForAI, endRefDrag, overDock, startRefDrag } from './session-link.js'
import { t } from './i18n.js'
import { Dialog, Icon, openMenuAt } from './ui.jsx'
import { takeInFiles } from './take-in.js'
import { capsuleMembers, categoryOf, isIdea, itemIcon, posterOf } from './util.js'

function dragHasFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

/** 浮层一页六张:两列瀑布流,三行放得下。 */
const PER_PAGE = 6
/** 卡面拼贴最多四格;再多只报张数,和微信相册一样靠「有几张图」一眼分辨。 */
const MOSAIC_SLOTS = 4

/**
 * 关闭态胶囊的封面位:和灵感卡同一个 16:9 骨架,里面拼成员自己的图。
 * 一张铺满、两张并排、三张左大右两小、四张两行两列;没有图的成员用类型色块 + 图标。
 * 胶囊是「一篇稿子的全部素材」,所以读成员自己的封面,不读成稿产物上的标题。
 */
function CapsuleMosaic({ members }) {
  const shown = members.slice(0, MOSAIC_SLOTS)
  return (
    <span className={`md-capsule-mosaic is-${shown.length}`} aria-hidden="true">
      {shown.map(item => {
        const poster = posterOf(item)
        const category = categoryOf(item)
        return (
          <span className={`md-capsule-cell is-${category}`} key={item.id}>
            {poster
              ? <img src={poster} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" />
              : <Icon name={itemIcon(item)} size={18} />}
          </span>
        )
      })}
    </span>
  )
}

function dissolveCapsule(capsule) {
  dispatchOps([{ op: 'delete_capsule', id: capsule.id }], { label: t('解散胶囊') })
}

/** 移出成员:只改胶囊的成员表,成员回到灵感流里。 */
export function removeFromCapsule(capsule, itemId) {
  const remaining = capsule.itemIds.filter(row => row !== itemId)
  return dispatchOps([{ op: 'update_capsule', id: capsule.id, itemIds: remaining }], { label: t('移出胶囊') })
}

/**
 * 关闭态胶囊:不是「另换一种尺寸的卡」,而是和灵感卡共用同一个 md-tile 骨架。
 * 封面位里放 1–4 张相册拼贴,右下角只报张数;卡片大小、标题、站点行、黑胶囊按钮
 * 都和单张灵感卡一致,扫一眼靠「里面有几张图」区分(排期四项的第 1 条)。
 * 点卡打开浮层;左上圆钮多选,右上解散(仅悬停或选中时显形);
 * 底部黑胶囊进创作会话,右侧小箭头是「添加到对话 / 添加灵感 / 解散」。
 */
export function CapsuleCard({ capsule, members, selected = false, compact = false }) {
  const [drop, setDrop] = React.useState(false)
  const all = members ?? []
  if (!all.length) return null
  const pick = (event) => {
    event.preventDefault()
    event.stopPropagation()
    toggleSelect('capsule', capsule.id)
  }
  const remove = (event) => {
    event.preventDefault()
    event.stopPropagation()
    dissolveCapsule(capsule)
  }
  const compose = async (event) => {
    event.preventDefault()
    event.stopPropagation()
    // 一个胶囊是一篇完整稿件的全部素材(ADR 0013):点创作=用整堆素材立一篇作品再进编辑器
    const workId = await createWork({ capsuleIds: [capsule.id] })
    if (workId) openWork(workId)
  }
  // 从灵感墙上拖一张(或多选的一组)卡压到胶囊上:松手即并入;拖文件进来直接收进这堆
  const carries = (event) => Array.from(event.dataTransfer?.types ?? []).includes('application/x-writing-desk-items') || dragHasFiles(event)
  const dragOver = (event) => {
    if (!carries(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDrop(true)
  }
  const dragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return
    setDrop(false)
  }
  const dropIn = async (event) => {
    if (!carries(event)) return
    event.preventDefault()
    event.stopPropagation()
    setDrop(false)
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length) {
      takeInFiles(files, { capsuleId: capsule.id })
      return
    }
    let ids = []
    try { ids = JSON.parse(event.dataTransfer.getData('application/x-writing-desk-items')) } catch { ids = [] }
    const fresh = (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string' && !capsule.itemIds.includes(id))
    if (!fresh.length) return
    await dispatchOps([{ op: 'update_capsule', id: capsule.id, itemIds: [...capsule.itemIds, ...fresh] }], { label: t('并入胶囊') })
    setDesk({ selection: null })
  }
  // 拖胶囊卡到接驳条 = 整堆添加到当前会话;dataTransfer 用胶囊专用类型,别混进灵感 ID
  const dragStart = (event) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/writing-desk-capsule', capsule.id)
    event.currentTarget.classList.add('is-dragging')
    startRefDrag({ capsuleIds: [capsule.id] })
  }
  const dragEnd = (event) => {
    event.currentTarget.classList.remove('is-dragging')
    endRefDrag()
  }
  const more = (event) => {
    event.preventDefault()
    event.stopPropagation()
    openMenuAt(event, [
      { label: t('复制给 AI'), icon: 'copy', onSelect: () => copyReferenceForAI({ capsuleIds: [capsule.id] }) },
      { label: t('添加到当前会话'), icon: 'link', onSelect: () => addReferenceToCurrentSession({ capsuleIds: [capsule.id] }) },
      { label: t('添加灵感'), icon: 'plus', onSelect: () => setDesk({ capsuleAdd: capsule.id }) },
      { label: t('解散胶囊'), icon: 'trash', danger: true, onSelect: () => dissolveCapsule(capsule) },
    ])
  }
  return (
    <article
      className={`md-tile is-capsule ${selected ? 'is-selected' : ''} ${compact ? 'is-compact' : ''} ${drop ? 'is-drop' : ''}`}
      data-capsule={capsule.id}
      tabIndex={0}
      role="button"
      draggable
      onDragStart={dragStart}
      onDragEnd={dragEnd}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={dropIn}
      aria-label={t('胶囊 {name}（{n} 条灵感）', { name: capsule.name, n: all.length })}
      onClick={() => openCapsule(capsule.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        openCapsule(capsule.id)
      }}
    >
      <div className="md-tile-art md-capsule-art">
        <CapsuleMosaic members={all} />
        <span className="md-capsule-count" title={t('{n} 张灵感', { n: all.length })}>{t('{n} 张', { n: all.length })}</span>
        <button type="button" className={`md-tile-check ${selected ? 'is-on' : ''}`} aria-pressed={selected} aria-label={selected ? t('取消选择') : t('选择')} onClick={pick}>
          {selected ? <Icon name="check" size={12} /> : null}
        </button>
        <div className="md-tile-tools">
          <button type="button" aria-label={t('解散胶囊')} title={t('解散胶囊')} onClick={remove}><Icon name="trash" size={14} /></button>
        </div>
      </div>
      <div className="md-tile-body">
        <h3 className="md-tile-title" title={capsule.name}>{capsule.name}</h3>
        <div className="md-tile-foot">
          <span className="md-tile-site" title={t('{n} 张灵感', { n: all.length })}>
            <Icon name="scatter" size={12} />
            <span>{t('胶囊')} · {t('{n} 张', { n: all.length })}</span>
          </span>
          <div className="md-tile-pill">
            <button type="button" className="md-pill-main" onClick={compose} title={t('进入创作会话')}>{t('创作')}</button>
            <button type="button" className="md-pill-caret" aria-label={t('更多操作')} onClick={more}><Icon name="chevD" size={12} /></button>
          </div>
        </div>
      </div>
    </article>
  )
}

/**
 * 胶囊名就地改:点标题变成输入框,回车或点到别处即存,Esc 还原。
 * Host 的 update_capsule 收 name(空名忽略、截 60 字),这里只管交互,所以没有保存按钮。
 */
function CapsuleName({ capsule }) {
  const [draft, setDraft] = React.useState(null)
  const commit = () => {
    const name = (draft ?? '').trim()
    setDraft(null)
    if (name && name !== capsule.name) dispatchOps([{ op: 'update_capsule', id: capsule.id, name }], { label: t('重命名胶囊') })
  }
  if (draft !== null) {
    return (
      <input
        className="md-capsule-name-input"
        value={draft}
        autoFocus
        maxLength={60}
        aria-label={t('胶囊名字')}
        onFocus={event => event.currentTarget.select()}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(null)
          }
        }}
      />
    )
  }
  return (
    <h3 className="md-capsule-view-name">
      <button type="button" className="md-capsule-name-btn" title={t('点击重命名')} onClick={() => setDraft(capsule.name)}>{capsule.name}</button>
    </h3>
  )
}

/**
 * 胶囊浮层:卡堆放大居中,一页六张两列瀑布流,两侧翻页,成员可拖拽排序、拖出去即移出。
 * 头部是名字 + 张数 + 解散按钮——名字点一下就地改,合成时先给一个默认名。
 */
export function CapsuleView() {
  const id = useDesk(s => s.capsuleId)
  const capsule = useDesk(s => s.state?.capsules?.find(row => row.id === s.capsuleId))
  const items = useDesk(s => s.state?.items ?? EMPTY_LIST)
  const [page, setPage] = React.useState(0)
  const [draggingId, setDraggingId] = React.useState(null)
  const [overId, setOverId] = React.useState(null)
  const [dropOut, setDropOut] = React.useState(false)
  const [taking, setTaking] = React.useState(false)
  const dragRef = React.useRef(null)
  const pageTimer = React.useRef(0)
  const suppressClick = React.useRef(false)
  const viewRef = React.useRef(null)

  // 正看着的胶囊被解散、撤销或自动解散时,退回灵感墙
  React.useEffect(() => { if (id && !capsule) closeCapsule() }, [id, capsule])

  const members = capsule ? capsuleMembers(capsule, items) : EMPTY_LIST
  const pages = Math.max(1, Math.ceil(members.length / PER_PAGE))
  React.useEffect(() => { setPage(current => Math.min(current, pages - 1)) }, [pages])
  React.useEffect(() => { setPage(0) }, [id])
  // 打开后把焦点收进浮层,键盘翻页和 Esc 都从这一层开始
  React.useEffect(() => { if (id) viewRef.current?.focus({ preventScroll: true }) }, [id])

  React.useEffect(() => {
    if (!id) return undefined
    const onKey = (event) => {
      const typing = event.target.closest?.('input,textarea,select')
      if (event.key === 'Escape') {
        if (typing) return // 正在改名:交给输入框自己还原,别把浮层关掉
        event.stopPropagation()
        closeCapsule()
        return
      }
      if (typing) return
      if (event.key === 'ArrowLeft') setPage(current => Math.max(0, current - 1))
      if (event.key === 'ArrowRight') setPage(current => Math.min(pages - 1, current + 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [id, pages])

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
        startRefDrag([item.id])
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
      endRefDrag()
      const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-capsule-tile]')
      const view = viewRef.current?.getBoundingClientRect()
      const outside = !view || e.clientX < view.left || e.clientX > view.right || e.clientY < view.top || e.clientY > view.bottom
      const id = item.id
      const overRect = over?.getBoundingClientRect()
      const after = overRect ? e.clientX > overRect.left + overRect.width / 2 : false
      clearDrag()
      if (!moved) return
      // 松手落在接驳条上:引用已由 dock 落进草稿,不移出胶囊
      if (overDock(e.clientX, e.clientY)) return
      setTimeout(() => { suppressClick.current = false }, 0)
      if (over && over.dataset.capsuleTile !== id) reorder(id, over.dataset.capsuleTile, after)
      else if (outside) removeFromCapsule(capsule, id)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // 拖拽中途浮层被远端解散/撤销而卸载时,ghost 与纸堆样式一并收尾
  React.useEffect(() => () => clearDrag(), [])

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

  const openMember = (item) => {
    if (suppressClick.current) return
    closeCapsule()
    openItem(item.id)
  }

  const pageItems = members.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE)
  const go = step => setPage(current => Math.max(0, Math.min(pages - 1, current + step)))
  return (
    <div
      className={`md-capsule-mask ${dropOut ? 'is-drop-out' : ''}`}
      onPointerDown={event => { if (event.target === event.currentTarget) closeCapsule() }}
      // 浮层也是落点：拖文件到浮层任何位置松手，就收进这堆(ADR 0011)
      onDragOver={(event) => {
        if (!dragHasFiles(event)) return
        event.preventDefault()
        setTaking(true)
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setTaking(false) }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (!files.length) return
        event.preventDefault()
        event.stopPropagation()
        setTaking(false)
        takeInFiles(files, { capsuleId: capsule.id })
      }}
    >
      {dropOut ? <div className="md-capsule-drop-hint">{t('松手移出胶囊，放到灵感墙上')}</div> : taking ? <div className="md-capsule-drop-hint">{t('松手就收进这堆')}</div> : null}
      <section
        className="md-capsule-view"
        ref={viewRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('胶囊 {name}', { name: capsule.name })}
      >
        <header className="md-capsule-view-head">
          <CapsuleName capsule={capsule} />
          <span className="md-capsule-view-meta">
            {t('{n} 张灵感', { n: members.length })}
            {pages > 1 ? ` · ${t('第 {page} / {pages} 页', { page: page + 1, pages })}` : ''}
          </span>
          <button type="button" className="md-btn md-capsule-action" aria-label={t('添加灵感')} title={t('添加灵感')} onClick={() => setDesk({ capsuleAdd: capsule.id })}><Icon name="plus" size={22} /><span className="md-capsule-action-label">{t('添加灵感')}</span></button>
          <button type="button" className="md-btn is-danger md-capsule-action" aria-label={t('解散')} title={t('解散')} onClick={() => dissolveCapsule(capsule)}><Icon name="trash" size={22} /><span className="md-capsule-action-label">{t('解散')}</span></button>
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
              onClick={() => openMember(item)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                openMember(item)
              }}
            >
              <Card item={item} bare tabIndex={-1} onOpen={() => openMember(item)} />
            </div>
          ))}
        </div>

        {pages > 1 ? (
          <div className="md-capsule-pager">
            <button type="button" className="md-capsule-page-btn is-prev" aria-label={t('上一页')} disabled={page === 0} onClick={() => go(-1)}>
              <Icon name="chevL" size={20} />
            </button>
            <button type="button" className="md-capsule-page-btn is-next" aria-label={t('下一页')} disabled={page >= pages - 1} onClick={() => go(1)}>
              <Icon name="chevR" size={20} />
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}

/** 往胶囊里添加成员:列出还没进这堆的灵感,勾选后追加到成员表末尾。 */
export function CapsuleAdd() {
  const id = useDesk(s => s.capsuleAdd)
  const capsule = useDesk(s => s.state?.capsules?.find(row => row.id === s.capsuleAdd))
  const items = useDesk(s => s.state?.items ?? EMPTY_LIST)
  const [picked, setPicked] = React.useState([])
  React.useEffect(() => { setPicked([]) }, [id])
  if (!id || !capsule) return null
  const inside = new Set(capsule.itemIds)
  const candidates = items.filter(item => isIdea(item) && !inside.has(item.id))
  const close = () => setDesk({ capsuleAdd: null })
  const toggle = (itemId) => setPicked(current => current.includes(itemId) ? current.filter(row => row !== itemId) : [...current, itemId])
  const save = () => {
    if (!picked.length) return close()
    // 失败(dispatchOps 返回 null)就不关:勾选还在,用户改完再试
    dispatchOps([{ op: 'update_capsule', id, itemIds: [...capsule.itemIds, ...picked] }], { label: t('添加灵感') })
      .then(data => { if (data) close() })
  }
  return (
    <Dialog title={t('往「{name}」里添加灵感', { name: capsule.name })} onClose={close} width={460}>
      {candidates.length ? (
        <div className="md-picker">
          {candidates.map(item => (
            <button type="button" key={item.id} className={`md-picker-row ${picked.includes(item.id) ? 'is-on' : ''}`} onClick={() => toggle(item.id)} aria-pressed={picked.includes(item.id)}>
              <span className="md-picker-thumb">
                {posterOf(item) ? <img src={posterOf(item)} alt="" loading="lazy" draggable={false} /> : <i className={`is-${categoryOf(item)}`} />}
              </span>
              <span className="md-picker-text">
                <b>{item.title || t('（无标题）')}</b>
                <em>{item.source || t('{n} 字', { n: (item.body ?? '').length })}</em>
              </span>
              <span className="md-picker-mark">{picked.includes(item.id) ? <Icon name="check" size={12} /> : null}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="md-muted">{t('墙上的灵感都已经在这堆里了。')}</p>
      )}
      <footer className="md-form-foot">
        <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
        <button type="button" className="md-btn is-primary" disabled={!picked.length} onClick={save}>{t('添加 {n} 张', { n: picked.length })}</button>
      </footer>
    </Dialog>
  )
}