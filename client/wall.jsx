// 灵感墙:按参考项目 StashDock 的货架重做(C 路线:参考骨架 + 稿面衬线 + 四色状态点)。
// 从上到下:搜索 + 排序 / 缩略图那排(按排期先后,未排期的接在后面) / 卡片货架 / 类型切换 + 标签抽屉 + 新建。
// 卡片点击是编辑,黑胶囊是创作入口;多选走封面左上圆钮,不再依赖右键。
import React from 'react'
import { Card, openCapture } from './card.jsx'
import { CapsuleCard } from './capsule.jsx'
import { clearSelection, createWork, dispatchOps, EMPTY_LIST, openCapsule, openItem, openWork, setDesk, useDesk } from './desk.js'
import { addReferenceToCurrentSession, copyReferenceForAI } from './session-link.js'
import { t } from './i18n.js'
import { Icon, IconButton, openMenuAt } from './ui.jsx'
import { tagShelf } from './tags.js'
import { railOrder } from './rail-order.js'
import { capsuleMembers, categoryOf, isIdea, itemIcon, posterOf } from './util.js'

const CATEGORY_OPTIONS = [{ value: 'all', label: '全部' }, { value: 'note', label: '笔记' }, { value: 'file', label: '文件' }, { value: 'link', label: '链接' }]
const SORT_OPTIONS = [{ value: 'new', label: '最近添加' }, { value: 'old', label: '最早添加' }, { value: 'title', label: '按标题' }]

/** 一面墙共用的筛选口径:分类、标签、搜索词三者叠加(AND)。 */
function makeFilter({ category, tag, query }) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return (item) => {
    if (category !== 'all' && categoryOf(item) !== category) return false
    if (tag && !(item.tags ?? []).includes(tag)) return false
    if (!words.length) return true
    const haystack = [item.title, item.body, item.source, ...(item.tags ?? [])].join(' ').toLowerCase()
    return words.every(word => haystack.includes(word))
  }
}

/** 缩略图:胶囊画四格底片,灵感画封面或类型图标。 */
function Thumb({ entry }) {
  if (entry.type === 'capsule') {
    return (
      <span className="md-rail-stack" aria-hidden="true">
        {entry.members.slice(0, 4).map(member => {
          const poster = posterOf(member)
          return poster
            ? <img key={member.id} src={poster} alt="" loading="lazy" draggable={false} />
            : <i key={member.id} className={`is-${categoryOf(member)}`} />
        })}
      </span>
    )
  }
  const poster = posterOf(entry.item)
  if (poster) return <img className="md-rail-pic" src={poster} alt="" loading="lazy" draggable={false} referrerPolicy="no-referrer" />
  return <span className={`md-rail-glyph is-${categoryOf(entry.item)}`} aria-hidden="true"><Icon name={itemIcon(entry.item)} size={15} /></span>
}

/** 第二行:邮票风格的缩略图。跟排期界面一个口径——上日历的按日期先后排在前面,
 * 没排期的接在后面,中间一条黑短竖杠:杠左竖排「本周」,杠右竖排「未排期」。
 * 左右可滑,两侧渐隐提示到头;悬停出箭头,键盘切到哪张就把它滚到正中。 */
function ThumbRail({ entries, cut, onOpen, total }) {
  const scroll = React.useRef(null)
  const split = cut > 0 && cut < entries.length
  const parts = split ? [entries.slice(0, cut), entries.slice(cut)] : [entries]
  const [edges, setEdges] = React.useState({ left: false, right: false })
  const [hover, setHover] = React.useState('')

  const measure = React.useCallback(() => {
    const el = scroll.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges({ left: el.scrollLeft > 2, right: max > 2 && el.scrollLeft < max - 2 })
  }, [])

  React.useEffect(() => {
    measure()
    const el = scroll.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, entries.length])

  const nudge = (direction) => {
    const el = scroll.current
    if (!el) return
    el.scrollBy({ left: direction * Math.max(200, Math.round(el.clientWidth * 0.8)), behavior: 'smooth' })
  }

  // 键盘切换时把当前缩略图完整滚出来并居中,两侧自然留出箭头的位置
  const reveal = (node) => {
    const el = scroll.current
    if (!el || !node) return
    const a = node.getBoundingClientRect()
    const b = el.getBoundingClientRect()
    el.scrollBy({ left: a.left - b.left - (b.width - a.width) / 2, behavior: 'smooth' })
  }
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    const all = Array.from(scroll.current?.querySelectorAll('.md-rail') ?? [])
    const index = all.indexOf(document.activeElement)
    if (index < 0) return
    event.preventDefault()
    const next = all[index + (event.key === 'ArrowRight' ? 1 : -1)]
    if (!next) return
    next.focus({ preventScroll: true })
    reveal(next)
  }
  const onFocus = (event) => {
    if (event.target.classList?.contains('md-rail')) reveal(event.target)
  }

  // 箭头只在悬停时露面;鼠标还停在箭头上时先变灰禁用,移开再一起消失
  const arrow = (side) => {
    const disabled = side === 'left' ? !edges.left : !edges.right
    const shown = hover === side || (side === 'left' ? edges.left : edges.right)
    return (
      <button
        type="button"
        className={`md-rail-arrow is-${side}${shown ? ' is-shown' : ''}${disabled ? ' is-off' : ''}`}
        tabIndex={-1}
        aria-disabled={disabled}
        aria-label={t(side === 'left' ? '向前滚动' : '向后滚动')}
        onPointerEnter={() => setHover(side)}
        onPointerLeave={() => setHover('')}
        onClick={() => { if (!disabled) nudge(side === 'left' ? -1 : 1) }}
      >
        <Icon name={side === 'left' ? 'chevL' : 'chevR'} size={14} />
      </button>
    )
  }

  return (
    <div className="md-railbar">
      <div className="md-railstage" onPointerLeave={() => setHover('')}>
        <div className="md-railscroll" ref={scroll} onScroll={measure} onKeyDown={onKeyDown} onFocus={onFocus}>
          {parts.map((part, index) => (
            <React.Fragment key={index}>
              {index === 1 ? (
                <span className="md-railsplit" aria-hidden="true">
                  <em className="md-railsplit-label is-left">{t('本周')}</em>
                  <i className="md-railsplit-bar" />
                  <em className="md-railsplit-label is-right">{t('未排期')}</em>
                </span>
              ) : null}
              <div className="md-railgroup">
                {part.map(entry => (
                  <div className="md-rail-cell" key={`${entry.type}-${entry.id}`}>
                    <button type="button" className="md-rail" title={entry.title} aria-label={entry.title} onClick={() => onOpen(entry)}>
                      <Thumb entry={entry} />
                      {entry.type === 'capsule' && entry.members.length > 1 ? <b className="md-rail-badge">{entry.members.length}</b> : null}
                    </button>
                    <button
                      type="button"
                      className="md-rail-plus"
                      aria-label={t('用《{title}》进入创作', { title: entry.title })}
                      title={t('进入创作会话')}
                      onClick={async () => {
                        const workId = await createWork(entry.type === 'capsule' ? { capsuleIds: [entry.id] } : { itemIds: [entry.id] })
                        if (workId) openWork(workId)
                      }}
                    >
                      <Icon name="plus" size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>
        <span className={`md-railfade is-left${edges.left ? '' : ' is-off'}`} aria-hidden="true" />
        <span className={`md-railfade is-right${edges.right ? '' : ' is-off'}`} aria-hidden="true" />
        {arrow('left')}
        {arrow('right')}
      </div>
      {total ? <span className="md-railcount">{total}</span> : null}
    </div>
  )
}

/** 标签筛选:锚在底栏按钮上的小面板,单选、带计数;行尾「⋯」可重命名/删除标签。
 * 与参考项目 StashDock 的 ShelfTagFilter 同一套信息(All tags + 每项计数 + 勾),
 * 但这里从按钮上方展开,不覆盖下半屏。 */
function TagFilter() {
  const open = useDesk(s => s.wallTagsOpen)
  const tag = useDesk(s => s.tagFilter)
  const items = useDesk(s => s.state?.items ?? EMPTY_LIST)
  const shelf = React.useMemo(() => tagShelf(items), [items])
  const panelRef = React.useRef(null)
  React.useEffect(() => {
    if (!open) return undefined
    const onPointerDown = event => { if (!panelRef.current?.contains(event.target)) setDesk({ wallTagsOpen: false }) }
    const onKey = event => { if (event.key === 'Escape') setDesk({ wallTagsOpen: false }) }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
  const pick = (value) => setDesk({ tagFilter: value, wallTagsOpen: false })
  const rename = (name) => setDesk({
    wallTagsOpen: false,
    dialog: {
      title: t('重命名标签'),
      submitLabel: t('改名'),
      initial: { name },
      fields: [{ name: 'name', label: t('标签名'), required: true }],
      onSubmit: values => {
        const next = String(values.name ?? '').trim()
        if (next && next !== name) dispatchOps([{ op: 'rename_tag', from: name, to: next }], { label: t('重命名标签') })
      },
    },
  })
  const drop = (name) => {
    setDesk({ wallTagsOpen: false })
    dispatchOps([{ op: 'delete_tag', tag: name }], { label: t('删除标签') })
  }
  const moreFor = (event, name) => openMenuAt(event, [
    { label: t('重命名标签'), icon: 'pen', onSelect: () => rename(name) },
    { label: t('删除标签'), icon: 'trash', danger: true, onSelect: () => drop(name) },
  ])
  return (
    <span className="md-taganchor" ref={panelRef}>
      <button type="button" className={`md-dockbar-tags ${tag ? 'is-on' : ''}`} aria-expanded={open} onClick={() => setDesk({ wallTagsOpen: !open })} title={t('按标签筛选')}>
        <Icon name="filter" size={14} />
        <span>{tag ? `#${tag}` : t('标签')}</span>
        <Icon name="chevD" size={11} />
      </button>
      {open ? (
        <section className="md-tagpanel" role="dialog" aria-label={t('按标签筛选')}>
          <div className="md-tagpanel-list" role="radiogroup" aria-label={t('按标签筛选')}>
            <div className="md-tagrow">
              <button type="button" role="radio" aria-checked={!tag} className={tag ? 'md-tagrow-main' : 'md-tagrow-main is-on'} onClick={() => pick(null)}>
                <span className="md-tagrow-label">{t('全部标签')}</span>
                <b>{items.filter(isIdea).length}</b>
                {tag ? null : <Icon name="check" size={12} />}
              </button>
            </div>
            {shelf.map(option => (
              <div className="md-tagrow" key={option.tag}>
                <button type="button" role="radio" aria-checked={tag === option.tag} className={tag === option.tag ? 'md-tagrow-main is-on' : 'md-tagrow-main'} onClick={() => pick(tag === option.tag ? null : option.tag)}>
                  <span className="md-tagrow-label">#{option.tag}</span>
                  <b>{option.count}</b>
                  {tag === option.tag ? <Icon name="check" size={12} /> : null}
                </button>
                <button type="button" className="md-tagrow-more" aria-label={t('标签操作')} onClick={event => moreFor(event, option.tag)}><Icon name="more" size={13} /></button>
              </div>
            ))}
          </div>
          {shelf.length ? null : <p className="md-tagpanel-empty">{t('还没有标签。编辑灵感时写一个，它就会出现在这里。')}</p>}
        </section>
      ) : null}
    </span>
  )
}

/** 多选条:挂在底栏上方,和参考项目的选择条同一组动作。 */
function SelectionBar({ selection, allItems, allCapsules }) {
  const pickedItems = selection.items
  const pickedCapsules = selection.capsules
  const count = pickedItems.length + pickedCapsules.length
  const selectAll = () => setDesk({ selection: { items: allItems, capsules: allCapsules } })
  const toChat = () => addReferenceToCurrentSession({ itemIds: pickedItems, capsuleIds: pickedCapsules })
  const toCopy = () => copyReferenceForAI({ itemIds: pickedItems, capsuleIds: pickedCapsules })
  const toCreate = async () => {
    // 多选成稿:选中素材合成一篇作品的来源,再打开作品编辑器(ADR 0013)
    const workId = await createWork({ itemIds: pickedItems, capsuleIds: pickedCapsules })
    if (workId) { clearSelection(); openWork(workId) }
  }
  const merge = () => dispatchOps([{ op: 'add_capsule', itemIds: pickedItems }], { label: t('合成胶囊') }).then(() => clearSelection())
  const remove = async () => {
    const ops = [
      ...pickedItems.map(id => ({ op: 'delete_item', id })),
      ...pickedCapsules.map(id => ({ op: 'delete_capsule', id })),
    ]
    if (ops.length) await dispatchOps(ops, { label: pickedCapsules.length ? t('解散胶囊') : t('删除灵感') })
    clearSelection()
  }
  if (!count) return null
  return (
    <div className="md-selectbar" role="toolbar" aria-label={t('已选灵感')}>
      <span className="md-selectbar-count">{t('已选 {n} 项', { n: count })}</span>
      <button type="button" className="md-selectbar-btn" onClick={selectAll} aria-label={t('全选')}><Icon name="check" size={13} /><span className="md-selectbar-label">{t('全选')}</span></button>
      <span className="md-selectbar-sep" />
      <button type="button" className="md-selectbar-btn" onClick={toChat} aria-label={t('添加到当前会话')}><Icon name="link" size={13} /><span className="md-selectbar-label">{t('添加到当前会话')}</span></button>
      <button type="button" className="md-selectbar-btn" onClick={toCopy} aria-label={t('复制给 AI')}><Icon name="copy" size={13} /><span className="md-selectbar-label">{t('复制给 AI')}</span></button>
      <button type="button" className="md-selectbar-btn is-primary" onClick={toCreate} aria-label={t('进入创作')}><Icon name="bolt" size={13} /><span className="md-selectbar-label">{t('进入创作')}</span></button>
      {pickedItems.length > 1 && !pickedCapsules.length ? <button type="button" className="md-selectbar-btn" onClick={merge} aria-label={t('合成胶囊')}><Icon name="scatter" size={13} /><span className="md-selectbar-label">{t('合成胶囊')}</span></button> : null}
      <button type="button" className="md-selectbar-btn is-danger" onClick={remove} aria-label={pickedCapsules.length && !pickedItems.length ? t('解散') : t('删除')}><Icon name="trash" size={13} /><span className="md-selectbar-label">{pickedCapsules.length && !pickedItems.length ? t('解散') : t('删除')}</span></button>
      <button type="button" className="md-selectbar-btn" onClick={clearSelection} aria-label={t('取消')}><Icon name="close" size={13} /><span className="md-selectbar-label">{t('取消')}</span></button>
    </div>
  )
}

export function Wall() {
  const items = useDesk(s => s.state.items)
  const capsules = useDesk(s => s.state.capsules ?? EMPTY_LIST)
  const category = useDesk(s => s.kindFilter)
  const tag = useDesk(s => s.tagFilter)
  const query = useDesk(s => s.wallQuery)
  const sort = useDesk(s => s.wallSort)
  const selection = useDesk(s => s.selection)
  const pickedItems = React.useMemo(() => new Set(selection?.items ?? []), [selection])
  const pickedCapsules = React.useMemo(() => new Set(selection?.capsules ?? []), [selection])

  const inCapsule = React.useMemo(() => {
    const set = new Set()
    for (const capsule of capsules) for (const id of capsule.itemIds) set.add(id)
    return set
  }, [capsules])

  const matches = React.useMemo(() => makeFilter({ category, tag, query }), [category, tag, query])

  // 墙面上的两种卡:灵感与胶囊(成员不再单独出现,被并入胶囊的灵感不重复计数)
  const entries = React.useMemo(() => {
    const list = []
    for (const item of items) {
      if (!isIdea(item) || inCapsule.has(item.id) || !matches(item)) continue
      list.push({ type: 'item', id: item.id, at: item.createdAt, title: item.title, item })
    }
    for (const capsule of capsules) {
      const members = capsuleMembers(capsule, items)
      if (!members.length) continue
      if (tag || query || category !== 'all') {
        if (!members.some(member => matches(member))) continue
      }
      list.push({ type: 'capsule', id: capsule.id, at: capsule.createdAt, title: capsule.name, capsule, members })
    }
    const byNew = (a, b) => Date.parse(b.at) - Date.parse(a.at)
    if (sort === 'old') return list.sort((a, b) => -byNew(a, b))
    if (sort === 'title') return list.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-Hans-CN'))
    return list.sort(byNew)
  }, [items, capsules, inCapsule, matches, tag, query, category, sort])

  const allItemsIds = entries.filter(entry => entry.type === 'item').map(entry => entry.id)
  const allCapsuleIds = entries.filter(entry => entry.type === 'capsule').map(entry => entry.id)
  // 缩略图那排固定按排期先后走,不跟墙上的排序
  const rail = React.useMemo(() => railOrder(entries), [entries])
  const openEntry = (entry) => { if (entry.type === 'capsule') openCapsule(entry.id); else openItem(entry.id) }

  // 卡到卡:把一张灵感拖到另一张上就合成胶囊,和「多选后点合成胶囊」是同一个 op
  const [mergeOver, setMergeOver] = React.useState(null)
  const hasItemDrag = (event) => Array.from(event.dataTransfer?.types ?? []).includes('application/x-writing-desk-items')
  const mergeProps = (entry) => {
    if (entry.type !== 'item') return null
    return {
      onDragOver: (event) => {
        if (!hasItemDrag(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setMergeOver(entry.id)
      },
      onDragLeave: (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        setMergeOver(current => (current === entry.id ? null : current))
      },
      onDrop: (event) => {
        if (!hasItemDrag(event)) return
        event.preventDefault()
        setMergeOver(null)
        let ids = []
        try {
          const parsed = JSON.parse(event.dataTransfer.getData('application/x-writing-desk-items'))
          if (Array.isArray(parsed)) ids = parsed.filter(id => typeof id === 'string')
        } catch { /* 来源没按约定写数据,就当没拖 */ }
        const fresh = ids.filter(id => id !== entry.item.id)
        if (!fresh.length) return
        dispatchOps([{ op: 'add_capsule', itemIds: [entry.item.id, ...fresh] }], { label: t('合成胶囊') }).then(clearSelection)
      },
    }
  }

  // 框选:从墙面的空白处按下拖动,碰到哪张卡就选哪张(按住 Shift 追加)。
  const wallRef = React.useRef(null)
  const bandCleanup = React.useRef(null)
  React.useEffect(() => () => bandCleanup.current?.(), [])
  const [band, setBand] = React.useState(null)
  const onWallPointerDown = (event) => {
    if (event.button !== 0 || !wallRef.current) return
    if (event.target.closest?.('.md-tile, .md-rail-cell, .md-wallhead, button, a, input, textarea')) return
    const x0 = event.clientX
    const y0 = event.clientY
    const baseItems = event.shiftKey ? [...(selection?.items ?? [])] : []
    const baseCapsules = event.shiftKey ? [...(selection?.capsules ?? [])] : []
    let active = false
    const onMove = (moveEvent) => {
      if (!active && Math.hypot(moveEvent.clientX - x0, moveEvent.clientY - y0) < 6) return
      active = true
      const left = Math.min(x0, moveEvent.clientX)
      const right = Math.max(x0, moveEvent.clientX)
      const top = Math.min(y0, moveEvent.clientY)
      const bottom = Math.max(y0, moveEvent.clientY)
      setBand({ left, top, width: right - left, height: bottom - top })
      const itemsHit = new Set(baseItems)
      const capsulesHit = new Set(baseCapsules)
      for (const node of wallRef.current?.querySelectorAll('[data-entry-id]') ?? []) {
        const rect = node.getBoundingClientRect()
        if (rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom) continue
        if (node.dataset.entryType === 'capsule') capsulesHit.add(node.dataset.entryId)
        else itemsHit.add(node.dataset.entryId)
      }
      setDesk({ selection: { items: [...itemsHit], capsules: [...capsulesHit] } })
    }
    const detach = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      bandCleanup.current = null
    }
    const onUp = () => {
      detach()
      setBand(null)
      if (!active) setDesk({ selection: null })
    }
    bandCleanup.current = detach
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const sortMenu = (event) => openMenuAt(event, SORT_OPTIONS.map(option => ({
    label: t(option.label),
    icon: sort === option.value ? 'check' : 'sort',
    onSelect: () => setDesk({ wallSort: option.value }),
  })))

  return (
    <div className="md-wallwrap">
      <div className="md-wallscroll" ref={wallRef} onPointerDown={onWallPointerDown}>
        <div className="md-wallhead">
          <label className="md-search">
            <Icon name="search" size={15} />
            <input value={query} onChange={event => setDesk({ wallQuery: event.target.value })} placeholder={t('搜索灵感')} aria-label={t('搜索灵感')} />
            {query ? <button type="button" className="md-search-clear" aria-label={t('清空搜索')} onClick={() => setDesk({ wallQuery: '' })}><Icon name="close" size={12} /></button> : null}
          </label>
          <IconButton icon="sort" label={t('排序：{name}', { name: t(SORT_OPTIONS.find(option => option.value === sort)?.label ?? '最近添加') })} onClick={sortMenu} className="md-wall-sort" />
        </div>

        <ThumbRail entries={rail.list} cut={rail.cut} onOpen={openEntry} total={entries.length} />

        {entries.length ? (
          <div className="md-wall">
            {entries.map(entry => (
              <div className={`md-wall-cell ${mergeOver === entry.id ? 'is-merge' : ''}`} key={`${entry.type}-${entry.id}`} data-entry-id={entry.id} data-entry-type={entry.type} {...mergeProps(entry)}>
                {entry.type === 'capsule' ? (
                  <CapsuleCard
                    capsule={entry.capsule}
                    members={entry.members}
                    selected={pickedCapsules.has(entry.id)}
                  />
                ) : (
                  <Card
                    item={entry.item}
                    selected={pickedItems.has(entry.id)}
                    dragIds={pickedItems.has(entry.id) && pickedItems.size > 1 ? [...pickedItems] : [entry.id]}
                  />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="md-wall-empty">
            <p>{query || tag || category !== 'all' ? t('没有找到符合条件的灵感。') : t('墙上还空着。写一句话、贴一个链接，或者把图片拖进来。')}</p>
            <button type="button" className="md-btn" onClick={() => openCapture('note')}><Icon name="plus" size={14} />{t('记一个灵感')}</button>
          </div>
        )}
      </div>

      {band ? <div className="md-marquee" style={{ left: band.left, top: band.top, width: band.width, height: band.height }} aria-hidden="true" /> : null}

      <SelectionBar selection={selection ?? { items: [], capsules: [] }} allItems={allItemsIds} allCapsules={allCapsuleIds} />

      <div className="md-dockbar" role="toolbar" aria-label={t('灵感视图')}>
        <div className="md-chips">
          {CATEGORY_OPTIONS.map(option => (
            <button type="button" key={option.value} className={category === option.value ? 'is-on' : ''} onClick={() => setDesk({ kindFilter: option.value })}>{t(option.label)}</button>
          ))}
        </div>
        <span className="md-dockbar-sep" />
        <TagFilter />
        <span className="md-dockbar-sep" />
        <button type="button" className="md-round is-primary" aria-label={t('记下灵感')} title={t('记下灵感')} onClick={() => openCapture('note')}><Icon name="plus" size={18} /></button>
      </div>
    </div>
  )
}
