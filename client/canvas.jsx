// 首页：一句话记一个灵感。灵感按时间排成信息流，可以归到胶囊里。
// 几张卡片拖到一起就收成一个胶囊，标签在底部 dockbar 当选题资料架取用。
// 成稿迁移到创作会话(ADR 0006):卡片拖到接驳条/右键引用,没有本地成稿入口。
import React from 'react'
import { Card, openCapture } from './card.jsx'
import { CapsuleCard, CapsulePreview, itemMatchesFilters } from './capsule.jsx'
import { captureFiles, captureUrl, clearSelection, dispatchOps, EMPTY_LIST, getDesk, openCapsule, openItem, openRetag, setDesk, toggleSelect, useDesk } from './desk.js'
import { endRefDrag, openWritingSession, overDock, referenceIntoDraft, startRefDrag } from './session-link.js'
import { plural, t } from './i18n.js'
import { Icon, IconButton, openMenuAt } from './ui.jsx'
import { MiniStamps } from './stamps.jsx'
import { isScheduled, panelState } from '../src/state.js'
import { relatedIdeas } from './related.js'
import { tagShelf } from './tags.js'
import { capsuleMembers, computeStreak, displayItem, posterOf, isIdea } from './util.js'

// 标签过滤的同一个口径:灵感流、胶囊和底部 dockbar 共用
const matchesTag = (item, tag) => !tag || (item.tags ?? []).includes(tag)

function Inline({ src }) {
  if (!src) return <span className="md-inline-pic is-empty" />
  return <img className="md-inline-pic" src={src} alt="" draggable={false} />
}

/** 首屏那句话：有图、有字、有数字，下面是一句话记灵感和最近的邮票。 */
function Hero() {
  const items = useDesk(s => s.state.items)
  const roots = items.filter(isIdea)
  // 首屏计数走共享谓词(工单 #5):「等你成稿」= 面板口径里的灵感,写了一半或排了期的不算
  const pending = roots.filter(i => panelState(i) === 'idea')
  const week = new Date()
  week.setDate(week.getDate() + 7)
  const upcoming = items.filter(i => isScheduled(i) && new Date(i.scheduledAt) >= new Date() && new Date(i.scheduledAt) <= week)
  const streak = computeStreak(items)
  const pic = list => list.map(posterOf).find(Boolean)
  const related = useDesk(s => s.related)
  const [text, setText] = React.useState('')
  const submit = async (event) => {
    event.preventDefault()
    const value = text.trim()
    if (!value) return
    setText('')
    if (/^https?:\/\//i.test(value)) return captureUrl(value)
    // 记下的同时，把提到同一件事的旧灵感拉到眼前
    const ids = relatedIdeas(roots, value)
    setDesk({ related: ids.length ? { query: value, ids, newId: null } : null })
    await dispatchOps([{ op: 'add_item', kind: 'note', title: value.split(/[。！？\n]|[.!?](?=\s|$)/)[0].slice(0, 60), body: value.length > 60 ? value : '', contentOrigin: 'user' }], { label: t('记下灵感') })
  }
  const now = new Date()
  return (
    <section className="md-hero" onPointerDown={e => e.stopPropagation()}>
      <p className="md-hero-date">{now.getFullYear()} · {t('{m} 月 {d} 日', { m: now.getMonth() + 1, d: now.getDate(), mon: now.toLocaleString('en-US', { month: 'short' }) })} · {t(WEEKDAYS[now.getDay()])}</p>
      <h1 className="md-hero-line">
        {t('还有')} <Inline src={pic(pending)} /> <b>{t('{n} 个灵感', { n: pending.length, s: plural(pending.length, '', 's') })}</b> {t('等你成稿，')}
        <br />
        <Inline src={pic(upcoming)} /> <b>{t('{n} 条内容', { n: upcoming.length, s: plural(upcoming.length, '', 's') })}</b> {t('排在本周，')}
        <br />
        {t('你已经连续记录')} <b className="md-hero-streak">{t('{n} 天', { n: streak, s: plural(streak, '', 's') })}</b>{t('。')}
      </h1>
      <form className="md-hero-input" onSubmit={submit}>
        <Icon name="spark" size={16} />
        <input value={text} onChange={e => setText(e.target.value)} placeholder={t('记下一个灵感，或贴一个链接')} aria-label={t('记下灵感')} />
        <button type="submit" className="md-send" aria-label={t('记下')} disabled={!text.trim()}><Icon name="send" size={15} /></button>
      </form>
      {related ? (
        <p className="md-hero-related">
          <span>{t('找到 {n} 条相关的灵感，放在了旁边', { n: related.ids.length, s: plural(related.ids.length, '', 's') })}</span>
          <button type="button" className="md-inline-link" onClick={() => setDesk({ related: null })}>{t('放回去')}</button>
        </p>
      ) : null}
      {roots.length === 0 ? <p className="md-hero-hint">{t('写一句话、贴一个链接，或者把图片和视频拖进来。')}</p> : null}
      <MiniStamps />
    </section>
  )
}

// 点胶囊:普通点击开对话框;Shift/Ctrl+点选进多选,凑一批直接成稿
function openCapsuleCard(capsule, event) {
  if (event?.shiftKey || event?.ctrlKey || event?.metaKey) return toggleSelect('capsule', capsule.id)
  openCapsule(capsule.id)
}

function originOf(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
}

function Feed() {
  const items = useDesk(s => s.state.items)
  const capsules = useDesk(s => s.state.capsules ?? EMPTY_LIST)
  const kind = useDesk(s => s.kindFilter)
  const tag = useDesk(s => s.tagFilter)
  const related = useDesk(s => s.related)
  const selection = useDesk(s => s.selection)
  const pickedItems = React.useMemo(() => new Set(selection?.items ?? []), [selection])
  const pickedCapsules = React.useMemo(() => new Set(selection?.capsules ?? []), [selection])
  const suppressClick = React.useRef(false)
  const [preview, setPreview] = React.useState(null)
  const openCard = (item, event) => {
    if (suppressClick.current) return
    if (event?.shiftKey || event?.ctrlKey || event?.metaKey) return toggleSelect('item', item.id)
    openItem(item.id, originOf(event))
  }
  const openCapsuleCardLocal = (capsule, event) => {
    if (suppressClick.current) return
    openCapsuleCard(capsule, event)
  }
  const capsuleOf = React.useMemo(() => {
    const map = new Map()
    for (const capsule of capsules) for (const id of capsule.itemIds) map.set(id, capsule.id)
    return map
  }, [capsules])
  const filtering = Boolean(tag) || kind !== 'all'
  const liftedIds = React.useMemo(() => {
    if (!related) return new Set()
    return new Set(related.ids.filter(id => capsuleOf.has(id)))
  }, [related, capsuleOf])
  const visibleCapsules = capsules.filter(capsule => {
    const members = capsuleMembers(capsule, items).filter(item => !liftedIds.has(item.id))
    return members.length && (!filtering || members.some(item => itemMatchesFilters(item, tag, kind)))
  })
  const rank = id => (related ? related.ids.indexOf(id) : -1)
  const sorted = React.useMemo(() => items
    .filter(i => isIdea(i) && (!capsuleOf.has(i.id) || liftedIds.has(i.id)) && matchesTag(i, tag) && (kind === 'all' || displayItem(i).kind === kind))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    // 有相关的灵感时排在最前面，按相关程度
    .sort((a, b) => {
      const ra = rank(a.id)
      const rb = rank(b.id)
      return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [items, kind, tag, related, capsuleOf, liftedIds])

  // 拖到另一张卡上合成胶囊，拖到胶囊上收进去,拖到接驳条上引用进对话。
  const startFeedCardDrag = (event, cellEl, item) => {
    if (event.button !== 0 || event.target.closest('input,textarea,button')) return
    const startX = event.clientX
    const startY = event.clientY
    const startRect = cellEl.getBoundingClientRect()
    const grabX = startX - startRect.left
    const grabY = startY - startRect.top
    let moved = false
    let ghost = null
    let overCapsuleEl = null
    let overCellEl = null
    const clearTargets = () => {
      overCapsuleEl?.classList.remove('is-drop')
      overCapsuleEl = null
      overCellEl?.classList.remove('is-capsule-target')
      overCellEl = null
      setPreview(null)
    }
    const onMove = (e) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return
      if (!moved) {
        moved = true
        suppressClick.current = true
        // 拖起即通知接驳条显形;落点由 dock 自己判断
        startRefDrag([item.id])
        cellEl.classList.add('is-feed-dragging')
        const cardEl = cellEl.querySelector('.md-card')
        ghost = cardEl?.cloneNode(true) ?? cellEl.cloneNode(true)
        ghost.className = `${ghost.className} md-feed-drag-ghost`
        Object.assign(ghost.style, { left: `${e.clientX - grabX}px`, top: `${e.clientY - grabY}px`, width: `${startRect.width}px`, height: `${startRect.height}px` })
        document.body.appendChild(ghost)
      }
      if (ghost) {
        ghost.style.left = `${e.clientX - grabX}px`
        ghost.style.top = `${e.clientY - grabY}px`
      }
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const capsuleEl = el?.closest('[data-capsule]')
      const cellTarget = el?.closest('[data-feed-card]')
      if (capsuleEl !== overCapsuleEl) {
        overCapsuleEl?.classList.remove('is-drop')
        overCapsuleEl = capsuleEl
        overCapsuleEl?.classList.add('is-drop')
      }
      const nextCell = cellTarget && cellTarget.dataset.feedCard !== item.id ? cellTarget : null
      if (nextCell !== overCellEl) {
        overCellEl?.classList.remove('is-capsule-target')
        overCellEl = nextCell
        overCellEl?.classList.add('is-capsule-target')
        if (overCellEl) {
          const rect = overCellEl.getBoundingClientRect()
          setPreview({ x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) })
        } else {
          setPreview(null)
        }
      }
    }
    const onUp = async (e) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      ghost?.remove()
      cellEl.classList.remove('is-feed-dragging')
      endRefDrag()
      const made = overCellEl
      const toCapsule = overCapsuleEl
      clearTargets()
      if (!moved) return
      // 松手落在接驳条上:引用已由 dock 落进草稿,画布收手
      if (overDock(e.clientX, e.clientY)) return
      setTimeout(() => { suppressClick.current = false }, 0)
      if (made) {
        await dispatchOps([{ op: 'add_capsule', itemIds: [item.id, made.dataset.feedCard] }], { label: t('聚合胶囊') })
        return
      }
      if (toCapsule) {
        const capsule = getDesk().state.capsules.find(row => row.id === toCapsule.dataset.capsule)
        if (capsule && !capsule.itemIds.includes(item.id)) {
          await dispatchOps([{ op: 'update_capsule', id: capsule.id, itemIds: [...capsule.itemIds, item.id] }], { label: t('收进胶囊') })
        }
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const startFeedThumbDrag = (event, item, capsule) => {
    if (event.button !== 0 || event.target.closest('button')) return
    const thumbEl = event.currentTarget
    const startX = event.clientX
    const startY = event.clientY
    const rect = thumbEl.getBoundingClientRect()
    const grabX = startX - rect.left
    const grabY = startY - rect.top
    let moved = false
    let ghost = null
    const onMove = (e) => {
      if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return
      if (!moved) {
        moved = true
        suppressClick.current = true
        // 拖起即通知接驳条显形;落点由 dock 自己判断
        startRefDrag([item.id])
        ghost = thumbEl.cloneNode(true)
        ghost.className = `${ghost.className} md-capsule-drag-ghost`
        Object.assign(ghost.style, { left: `${e.clientX - grabX}px`, top: `${e.clientY - grabY}px`, width: `${rect.width}px`, height: `${rect.height}px` })
        document.body.appendChild(ghost)
        thumbEl.classList.add('is-ghosted')
      }
      ghost.style.left = `${e.clientX - grabX}px`
      ghost.style.top = `${e.clientY - grabY}px`
    }
    const onUp = async (e) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      ghost?.remove()
      thumbEl.classList.remove('is-ghosted')
      endRefDrag()
      if (!moved) return
      // 松手落在接驳条上:引用已由 dock 落进草稿,不移出胶囊
      if (overDock(e.clientX, e.clientY)) return
      setTimeout(() => { suppressClick.current = false }, 0)
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-capsule]')
      if (target?.dataset.capsule === capsule.id) return
      const remaining = capsule.itemIds.filter(id => id !== item.id)
      const ops = []
      if (target) {
        const targetCapsule = getDesk().state.capsules.find(row => row.id === target.dataset.capsule)
        if (targetCapsule) ops.push({ op: 'update_capsule', id: targetCapsule.id, itemIds: [...targetCapsule.itemIds, item.id] })
      }
      ops.push({ op: 'update_capsule', id: capsule.id, itemIds: remaining })
      await dispatchOps(ops, { label: t('移出胶囊') })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // 卡片右键:引用进对话或直接去创作会话(成稿入口的右键辅路)
  const openCardMenu = (item, event) => {
    openMenuAt(event, [
      { label: t('引用到对话'), icon: 'link', onSelect: () => referenceIntoDraft([item.id]) },
      { label: t('去创作会话'), icon: 'bolt', onSelect: () => openWritingSession([item.id]) },
    ])
  }
  return (
    <div className="md-wall-scroll">
      <div className="md-feed-hero"><Hero /></div>
      {preview ? <CapsulePreview preview={preview} fixed /> : null}
      {visibleCapsules.length ? (
        <div className="md-capsule-strip">
          {visibleCapsules.map(capsule => (
            <CapsuleCard
              key={capsule.id}
              capsule={capsule}
              items={items}
              selected={pickedCapsules.has(capsule.id)}
              onOpen={openCapsuleCardLocal}
              onItemPointerDown={startFeedThumbDrag}
              filter={filtering ? item => itemMatchesFilters(item, tag, kind) : null}
              hiddenIds={liftedIds.size ? liftedIds : null}
            />
          ))}
        </div>
      ) : null}
      <div className="md-wall">
        {sorted.map((item, index) => (
          <div
            key={item.id}
            className={`md-wall-cell${rank(item.id) >= 0 ? ' is-related' : ''}`}
            data-feed-card={item.id}
            style={{ animationDelay: `${Math.min(index * 22, 400)}ms` }}
            onPointerDown={event => startFeedCardDrag(event, event.currentTarget, item)}
          >
            <Card item={item} onOpen={openCard} onContextMenu={openCardMenu} selected={pickedItems.has(item.id)} />
          </div>
        ))}
      </div>
    </div>
  )
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

const KIND_OPTIONS = [{ value: 'all', label: '全部' }, { value: 'image', label: '图片' }, { value: 'video', label: '视频' }, { value: 'web', label: '网页' }, { value: 'quote', label: '金句' }, { value: 'note', label: '笔记' }]

export function HomeView() {
  const kind = useDesk(s => s.kindFilter)
  const tag = useDesk(s => s.tagFilter)
  const items = useDesk(s => s.state.items)
  const selection = useDesk(s => s.selection)
  const picked = (selection?.items.length ?? 0) + (selection?.capsules.length ?? 0)
  // 标签就是选题资料架:挑一个标签,灵感流里只留这批灵感,还能顺手给它们批量改标签、一起成稿
  const shelf = React.useMemo(() => tagShelf(items).slice(0, 9), [items])
  const tagged = React.useMemo(() => items.filter(i => tag && matchesTag(i, tag)).map(i => i.id), [items, tag])
  return (
    <div className="md-home">
      <Feed />
      {picked ? (
        // 多选后的浮动工具条:把选中的一批引用进对话,或直接带去创作会话
        <div className="md-selectbar" role="toolbar" aria-label={t('已选灵感')}>
          <span>{t('已选 {n} 项', { n: picked })}</span>
          <button type="button" className="md-btn" onClick={() => referenceIntoDraft({ itemIds: selection.items, capsuleIds: selection.capsules })}><Icon name="link" size={14} />{t('引用到对话')}</button>
          <button type="button" className="md-btn is-primary" onClick={() => openWritingSession({ itemIds: selection.items, capsuleIds: selection.capsules })}><Icon name="bolt" size={14} />{t('去创作会话')}</button>
          <IconButton icon="close" label={t('清除')} onClick={clearSelection} />
        </div>
      ) : null}
      <div className="md-dockbar" role="toolbar" aria-label={t('灵感视图')}>
        <div className="md-chips">
          {KIND_OPTIONS.map(option => (
            <button type="button" key={option.value} className={kind === option.value ? 'is-on' : ''} onClick={() => setDesk({ kindFilter: option.value })}>{t(option.label)}</button>
          ))}
        </div>
        {shelf.length ? (
          <>
            <span className="md-dockbar-sep" />
            <div className="md-chips">
              {shelf.map(option => (
                <button type="button" key={option.tag} title={t('{n} 条灵感', { n: option.count, s: plural(option.count, '', 's') })} className={tag === option.tag ? 'is-on' : ''} onClick={() => setDesk({ tagFilter: tag === option.tag ? null : option.tag })}>{`#${option.tag}`}</button>
              ))}
            </div>
          </>
        ) : null}
        {tag ? (
          <>
            <IconButton icon="pen" label={t('给这批灵感改标签')} onClick={() => openRetag(tagged)} />
            <IconButton icon="link" label={t('引用到对话')} onClick={() => referenceIntoDraft({ itemIds: tagged })} />
            <IconButton icon="bolt" label={t('去创作会话')} onClick={() => openWritingSession({ itemIds: tagged })} />
            <IconButton icon="close" label={t('不看这个标签了')} onClick={() => setDesk({ tagFilter: null })} />
          </>
        ) : null}
        <span className="md-dockbar-sep" />
        <button type="button" className="md-round is-primary" aria-label={t('记下灵感')} title={t('记下灵感')} onClick={() => openCapture('text')}><Icon name="plus" size={18} /></button>
      </div>
    </div>
  )
}
