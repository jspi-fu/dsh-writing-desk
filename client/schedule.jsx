// 排期：发布排期和灵感日历是同一张日历。每天一张灵感邮票，发布的内容从右边拖上来。
// 待排期托盘里胶囊折叠成一张胶囊卡(与灵感墙「成员不单独出现」同一口径,ADR 0011)：
// 只要还有成员没排期就露这张卡；拖到日历＝整张胶囊（含已排期的成员）一起排到那天,
// 把一张卡压到另一张上＝合成胶囊。
import React from 'react'
import { awaitingSchedule, isScheduled } from '../src/state.js'
import { selectScheduleFocus } from '../src/schedule-focus.js'
import { dispatchOps, EMPTY_LIST, openCapsule, openItem, useDesk } from './desk.js'
import focusCss from './schedule-focus.css'
import { lang, t, useLang } from './i18n.js'
import { Stamp, useDayMap } from './stamps.jsx'
import { takeInFiles } from './take-in.js'
import { Icon, IconButton } from './ui.jsx'
import { STATUS_LABEL, capsuleMembers, categoryOf, computeStreak, coverOf, dayKey, fmtDate, fmtTime, itemIcon, posterOf, relativeDay, unit } from './util.js'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// 中文原文，显示时再翻译
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const TYPE = 'text/writing-desk-item'
const CAPSULE_TYPE = 'text/writing-desk-capsule'

function startDrag(event, id) {
  event.dataTransfer.setData(TYPE, id)
  event.dataTransfer.effectAllowed = 'move'
}

function startCapsuleDrag(event, capsule) {
  event.dataTransfer.setData(CAPSULE_TYPE, capsule.id)
  event.dataTransfer.effectAllowed = 'move'
}

function moveTo(items, id, date) {
  const item = items.find(i => i.id === id)
  if (!item) return
  const target = new Date(date)
  const previous = item.scheduledAt ? new Date(item.scheduledAt) : null
  target.setHours(previous?.getHours() ?? 20, previous?.getMinutes() ?? 0, 0, 0)
  dispatchOps([{ op: 'schedule_item', id, scheduledAt: target.toISOString() }], { label: t('修改排期') })
}

// 拖胶囊卡到日历:整张胶囊一起排到那天的 09:00(胶囊是一张卡,已排期的成员也一起挪,不摊在两处)
function scheduleCapsule(items, capsules, id, date) {
  const capsule = capsules.find(row => row.id === id)
  if (!capsule) return
  const byId = new Map(items.map(item => [item.id, item]))
  const members = capsule.itemIds.map(itemId => byId.get(itemId)).filter(Boolean)
  if (!members.length) return
  const target = new Date(date)
  target.setHours(9, 0, 0, 0)
  const when = target.toISOString()
  dispatchOps(members.map(item => ({ op: 'schedule_item', id: item.id, scheduledAt: when })), { label: t('排到 {date}', { date: fmtDate(date) }) })
}

/**
 * 拖回托盘＝撤排期。这是「拖到日历」的逆动作,和它同一个整体口径:胶囊整张撤,单条只撤自己。
 * 返回是否真的撤了——没排期的卡拖回来仍然是「合成胶囊」,两种落点靠这个判断分开。
 */
function unscheduleInto(items, capsules, event) {
  const id = event.dataTransfer?.getData(TYPE)
  if (id) {
    const item = items.find(row => row.id === id)
    if (!item?.scheduledAt) return false
    dispatchOps([{ op: 'schedule_item', id, scheduledAt: null }], { label: t('取消排期') })
    return true
  }
  const capsuleId = event.dataTransfer?.getData(CAPSULE_TYPE)
  if (!capsuleId) return false
  const capsule = capsules.find(row => row.id === capsuleId)
  const rows = (capsule?.itemIds ?? []).map(itemId => items.find(row => row.id === itemId)).filter(row => row?.scheduledAt)
  if (!rows.length) return false
  dispatchOps(rows.map(row => ({ op: 'schedule_item', id: row.id, scheduledAt: null })), { label: t('取消排期') })
  return true
}

function Thumb({ item }) {
  const poster = posterOf(item)
  return <span className="md-cal-thumb">{poster ? <img src={poster} alt="" draggable={false} loading="lazy" /> : null}</span>
}

function Chip({ item }) {
  return (
    <button type="button" className={`md-cal-chip status-${item.status}`} draggable title={`${fmtTime(item.scheduledAt)} ${item.title}`} onDragStart={event => startDrag(event, item.id)} onClick={() => openItem(item.id)}>
      <Thumb item={item} />
      <span className="md-cal-chip-text"><time>{fmtTime(item.scheduledAt)}</time><span>{item.title}</span></span>
    </button>
  )
}

/**
 * 日历上的胶囊缩略:不是一张封面,而是一个 2×2 相册格。小尺寸下也先看见
 * 「这是一叠」而不是「这是哪一张」,和灵感签的单图拉开轮廓差(排期四项第 1/3 条)。
 */
function CapsuleThumb({ members }) {
  const shown = members.slice(0, 4)
  return (
    <span className="md-cal-thumb md-cal-stack" aria-hidden="true">
      {shown.map(item => {
        const poster = posterOf(item)
        const category = categoryOf(item)
        return poster
          ? <img key={item.id} src={poster} alt="" draggable={false} loading="lazy" />
          : <i key={item.id} className={`is-${category}`}><Icon name={category === 'link' ? 'link' : category === 'file' ? 'folder' : 'pen'} size={8} /></i>
      })}
      {Array.from({ length: 4 - shown.length }, (_, index) => <i className="is-empty" key={`empty-${index}`} />)}
    </span>
  )
}

// 日历上的胶囊：整张胶囊只露一个签，不把成员摊成几条(胶囊整体排期,ADR 0011)。
// 签用相册格缩略 + 纸堆边缘 + 右下角张数，一眼能看出这是一叠而不只是一条。
function CapsuleChip({ capsule, members }) {
  return (
    <button type="button" className="md-cal-chip is-capsule" draggable title={`${fmtTime(members[0].scheduledAt)} ${capsule.name}（${members.length} 张）`} onDragStart={event => startCapsuleDrag(event, capsule)} onClick={() => openCapsule(capsule.id)}>
      <CapsuleThumb members={members} />
      <span className="md-cal-chip-text"><time>{fmtTime(members[0].scheduledAt)}</time><span>{capsule.name}</span></span>
      <em className="md-cal-chip-count">{members.length}</em>
    </button>
  )
}

function Calendar({ items, capsules }) {
  const [cursor, setCursor] = React.useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [over, setOver] = React.useState(null)
  const days = useDayMap()
  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const first = new Date(y, m, 1).getDay()
  const cells = []
  for (let i = 0; i < 42; i += 1) cells.push(new Date(y, m, i - first + 1))
  // 2 月 1 日正好是周日时只需要 4 行，多数月份 5 行，少数 6 行
  const rows = cells[28].getMonth() !== m ? cells.slice(0, 28) : cells[35].getMonth() === m ? cells : cells.slice(0, 35)
  const byDay = React.useMemo(() => {
    const capsuleOf = new Map()
    for (const capsule of capsules) for (const id of capsule.itemIds) capsuleOf.set(id, capsule)
    const raw = new Map()
    for (const item of items) {
      if (!item.scheduledAt || item.parentId) continue
      const key = dayKey(item.scheduledAt)
      if (!raw.has(key)) raw.set(key, [])
      raw.get(key).push(item)
    }
    // 同一天的胶囊成员折成一个签：胶囊跟着整张卡走，日历上不会散成几条
    const map = new Map()
    for (const [key, list] of raw) {
      list.sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
      const seen = new Map()
      const entries = []
      for (const item of list) {
        const capsule = capsuleOf.get(item.id)
        const at = Date.parse(item.scheduledAt)
        if (!capsule) { entries.push({ type: 'item', id: item.id, item, at }); continue }
        const entry = seen.get(capsule.id)
        if (entry) entry.members.push(item)
        else { const fresh = { type: 'capsule', id: capsule.id, capsule, members: [item], at }; seen.set(capsule.id, fresh); entries.push(fresh) }
      }
      entries.sort((a, b) => a.at - b.at)
      map.set(key, entries)
    }
    return map
  }, [items, capsules])
  const today = dayKey(new Date())
  const prefix = `${y}-${String(m + 1).padStart(2, '0')}`
  const monthIdeas = [...days.entries()].filter(([key]) => key.startsWith(prefix)).reduce((sum, [, list]) => sum + list.length, 0)
  const monthPosts = [...byDay.keys()].filter(key => key.startsWith(prefix)).reduce((sum, key) => sum + byDay.get(key).length, 0)
  const streak = computeStreak(items)
  return (
    <section className="md-tile md-cal-tile">
      <header className="md-cal-head">
        <div className="md-cal-num">{String(m + 1).padStart(2, '0')}</div>
        <div className="md-cal-month"><span>{y}</span><em>{MONTHS[m]}</em></div>
        <dl className="md-cal-stats">
          <div><dt>{t('连续记录')}</dt><dd>{streak}<small>{unit(streak, '天')}</small></dd></div>
          <div><dt>{t('本月灵感')}</dt><dd>{monthIdeas}<small>{t('条')}</small></dd></div>
          <div><dt>{t('本月发布')}</dt><dd>{monthPosts}<small>{t('条')}</small></dd></div>
        </dl>
        <span className="md-grow" />
        <IconButton icon="chevL" label={t('上个月')} onClick={() => setCursor(new Date(y, m - 1, 1))} />
        <button type="button" className="md-pill is-small" onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>{t('今天')}</button>
        <IconButton icon="chevR" label={t('下个月')} onClick={() => setCursor(new Date(y, m + 1, 1))} />
      </header>
      <div className="md-cal-weeks">{WEEK.map(w => <span key={w}>{t(w)}</span>)}</div>
      <div className="md-cal-grid" role="grid" style={{ '--rows': rows.length / 7 }}>
        {rows.map((date) => {
          const key = dayKey(date)
          const posts = byDay.get(key) ?? []
          const ideas = days.get(key)
          const isToday = key === today
          return (
            <div
              key={key}
              role="gridcell"
              className={`md-cal-cell ${date.getMonth() !== m ? 'is-outside' : ''} ${isToday ? 'is-today' : ''} ${over === key ? 'is-over' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setOver(key) }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(o => (o === key ? null : o)) }}
              onDrop={(event) => {
                event.preventDefault()
                setOver(null)
                // 落点决定去向：文件拖到哪天就排到哪天(ADR 0011)
                const files = Array.from(event.dataTransfer?.files ?? [])
                if (files.length) {
                  takeInFiles(files, { day: date })
                  return
                }
                const capsuleId = event.dataTransfer.getData(CAPSULE_TYPE)
                if (capsuleId) {
                  scheduleCapsule(items, capsules, capsuleId, date)
                  return
                }
                const id = event.dataTransfer.getData(TYPE)
                if (id) moveTo(items, id, date)
              }}
            >
              <div className="md-cal-cell-top">
                <span className="md-cal-date">{date.getDate()}</span>
                {ideas?.length || isToday ? <div className="md-cal-stamp"><Stamp list={ideas} today={isToday} label={t('{date}的灵感', { date: fmtDate(date) })} onOpen={() => openItem(ideas[0].id)} /></div> : null}
              </div>
              <div className="md-cal-posts">
                {posts.slice(0, 2).map(entry => (entry.type === 'capsule' ? <CapsuleChip key={`cap:${entry.id}`} capsule={entry.capsule} members={entry.members} /> : <Chip key={entry.id} item={entry.item} />))}
                {posts.length > 2 ? <span className="md-cal-more">{t('还有 {n} 条', { n: posts.length - 2 })}</span> : null}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// 托盘里的胶囊：横向的小纸堆——左侧叠起来的成员缩略，右侧名字与张数。
// 它要是和下面「灵感」那一行一条长得一样,用户就分不出「一叠」和「一条」(排期四项的第 1 条)。
// 点开是胶囊浮层；拖到日历＝成员一起排那天。
function TrayCapsule({ capsule, members, pending, merge, drop }) {
  return (
    <button type="button" draggable className={`md-tray-item is-capsule ${merge ? 'is-merge' : ''}`} onDragStart={event => startCapsuleDrag(event, capsule)} onClick={() => openCapsule(capsule.id)} {...drop}>
      <span className="md-capsule-mini" aria-hidden="true">
        {members.slice(0, 3).map((member, index) => {
          const poster = posterOf(member)
          const category = categoryOf(member)
          return (
            <span key={member.id} className={`md-capsule-mini-sheet is-${category}`} style={{ '--i': index }}>
              {poster
                ? <img src={poster} alt="" loading="lazy" draggable={false} />
                : <Icon name={category === 'link' ? 'link' : category === 'file' ? 'folder' : 'pen'} size={13} />}
            </span>
          )
        })}
      </span>
      <span className="md-tray-pile">
        <span className="md-tray-pile-name">{capsule.name}</span>
        <span className="md-tray-pile-meta">
          <em className="md-tray-count">{pending < members.length ? `${pending}/${members.length}` : t('{n} 张', { n: members.length })}</em>
          <span>{t('胶囊')}</span>
        </span>
      </span>
    </button>
  )
}

// 焦点是只读的常驻导航，不参与到点提醒回执，也不会触发成稿或发布。
// 过去和将来都按绝对距离参选；派生条不单独出现，胶囊无论多少成员都只占一个主体。
function focusRelative(focus, now) {
  const days = Math.round((new Date(dayKey(focus.scheduledAt)) - new Date(dayKey(now))) / 86400000)
  if (days === 0 && focus.timestamp <= now.getTime()) return t('已到点')
  if (days === 0) return t('今天')
  if (days === 1) return t('明天')
  if (days === 2) return t('后天')
  if (days === -1) return t('昨天')
  if (days < 0 && days > -8) return t('{n}天前', { n: -days })
  return fmtDate(focus.scheduledAt)
}

function FocusArtwork({ focus }) {
  const isCapsule = focus.type === 'capsule'
  const shown = isCapsule ? focus.members.slice(0, 4) : [focus.item]
  return (
    <span className="md-schedule-focus-media" aria-hidden="true">
      <span className={`md-schedule-focus-art ${isCapsule ? 'is-capsule' : 'is-single'}`}>
        {shown.map(member => {
          const cover = coverOf(member)
          return (
            <span key={member.id} className={`md-schedule-focus-sheet is-${categoryOf(member)}`}>
              {cover ? <img src={cover} alt="" draggable={false} loading="lazy" /> : <Icon name={itemIcon(member)} size={isCapsule ? 20 : 34} />}
            </span>
          )
        })}
        {isCapsule ? Array.from({ length: Math.max(0, 4 - shown.length) }, (_, index) => <span className="md-schedule-focus-sheet is-empty" key={`empty-${index}`} />) : null}
        {isCapsule ? <span className="md-schedule-focus-count">{focus.members.length}</span> : null}
      </span>
    </span>
  )
}

function capsuleSituation(focus) {
  const counts = new Map()
  for (const member of focus.members) {
    const label = STATUS_LABEL[member.status] ?? STATUS_LABEL.idea
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts].map(([label, count]) => `${t(label)} ${count}`).join(' · ')
}

function ScheduleFocus({ items, capsules }) {
  const [now, setNow] = React.useState(() => new Date())
  const focusCardRef = React.useRef(null)
  const [rippleActive, setRippleActive] = React.useState(false)
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const focus = React.useMemo(() => selectScheduleFocus(items, capsules, now), [items, capsules, now])
  // 非必要循环动画只在卡片进入视口且页面可见时运行。
  React.useEffect(() => {
    const node = focusCardRef.current
    if (!node || !focus?.id) {
      setRippleActive(false)
      return undefined
    }
    let inView = true
    const sync = () => setRippleActive(inView && !document.hidden)
    const observer = typeof window.IntersectionObserver === 'function'
      ? new window.IntersectionObserver(([entry]) => {
        inView = entry.isIntersecting
        sync()
      }, { threshold: 0.08 })
      : null
    if (observer) {
      inView = false
      observer.observe(node)
    }
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      observer?.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [focus?.id])
  const isCapsule = focus?.type === 'capsule'
  const title = isCapsule ? focus.capsule.name : focus?.item.title
  const status = focus ? t(STATUS_LABEL[focus.item.status] ?? STATUS_LABEL.idea) : ''
  // 背景日期取自真实排期，只做装饰，不另造刊号或统计信息。
  const dayMark = focus ? String(new Date(focus.timestamp).getDate()).padStart(2, '0') : ''

  return (
    <section className={`md-schedule-focus ${focus ? 'has-focus' : 'is-empty'}`} aria-label={t('排期焦点')}>
      {focus ? (
        <button ref={focusCardRef} type="button" className={`md-schedule-focus-card${rippleActive ? ' is-ripple-active' : ''}`} onClick={() => isCapsule ? openCapsule(focus.id) : openItem(focus.id)}>
          <span className="md-schedule-focus-day" aria-hidden="true">{dayMark}</span>
          <span className="md-schedule-focus-ripple" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <span key={index} style={{ '--ripple-index': index }} />)}
          </span>
          <span className="md-schedule-focus-head">
            <span><Icon name="calendar" size={14} />{t('排期焦点')}<span className="md-schedule-focus-edition" aria-hidden="true">SCHEDULE</span></span>
            <span className={`md-schedule-focus-relative ${focus.timestamp <= now.getTime() ? 'is-due' : ''}`}>{focusRelative(focus, now)}</span>
          </span>
          <FocusArtwork focus={focus} />
          <span className="md-schedule-focus-body">
            <strong>{title || t('未命名')}</strong>
            <span className="md-schedule-focus-time"><Icon name="clock" size={13} /><time dateTime={focus.scheduledAt}>{fmtDate(focus.scheduledAt)} · {fmtTime(focus.scheduledAt)}</time></span>
            <span className="md-schedule-focus-meta">
              <span>{isCapsule ? `${t('胶囊')} · ${t('{n} 张', { n: focus.members.length })}` : (focus.item.platform ? t(focus.item.platform) : t('灵感'))}</span>
              <span>{isCapsule ? `${focus.scheduledCount}/${focus.members.length} ${t('已排期')} · ${capsuleSituation(focus)}` : status}</span>
            </span>
          </span>
        </button>
      ) : (
        <div className="md-schedule-focus-empty">
          <header className="md-schedule-focus-head">
            <span><Icon name="calendar" size={14} />{t('排期焦点')}</span>
          </header>
          <div className="md-schedule-focus-empty-content">
            <Icon name="calendar" size={24} />
            <div>
              <p>{t('还没有有效排期')}</p>
              <span>{t('把灵感或胶囊拖到日历上，最近的一条会留在这里。')}</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function Rail({ state, items, capsules }) {
  const [over, setOver] = React.useState(false)
  const [mergeOver, setMergeOver] = React.useState(null)
  // 待排期区只放「还没被作品用掉的素材」:成稿动作把素材用掉后由作品接管(ADR 0013),
  // 同一批素材想再做一版就回灵感墙再点成稿,托盘不再替它留位置。
  const upcoming = items.filter(i => isScheduled(i) && new Date(i.scheduledAt) >= new Date()).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
  const next = upcoming[0]
  const byId = new Map(items.map(item => [item.id, item]))
  const capsuleById = new Map(capsules.map(row => [row.id, row]))
  // 胶囊成员不在托盘里单条出现(与灵感墙同一口径)
  const memberOf = new Set()
  for (const capsule of capsules) for (const id of capsule.itemIds) memberOf.add(id)
  const waiting = items.filter(item => awaitingSchedule(state, item))
  const loose = waiting.filter(i => !memberOf.has(i.id))
  const ideas = loose
  // 胶囊卡只要还有成员待排期就出现:排掉一张成员不该把整张胶囊从托盘里带走(成员本来就不单条出现)。
  const pendingCapsules = []
  for (const capsule of capsules) {
    const members = capsuleMembers(capsule, items)
    if (members.length < 2) continue
    const queue = members.filter(item => awaitingSchedule(state, item))
    if (!queue.length) continue
    pendingCapsules.push({ capsule, members, pending: queue.length })
  }

  // 卡拖到卡：灵感→灵感新建胶囊、灵感→胶囊加入、胶囊→灵感收进、胶囊→胶囊合并(保留目标名)
  const dragSource = (event) => {
    const itemId = event.dataTransfer?.getData(TYPE)
    if (itemId) return { kind: 'item', id: itemId }
    const capsuleId = event.dataTransfer?.getData(CAPSULE_TYPE)
    if (capsuleId) return { kind: 'capsule', id: capsuleId }
    return null
  }
  const combine = (event, target) => {
    const source = dragSource(event)
    if (!source) return
    event.preventDefault()
    event.stopPropagation()
    setMergeOver(null)
    if (source.kind === target.kind && source.id === target.id) return
    // 已排期的卡拖回来:这一落是「撤排期」,不是合成——以前会被卡片上的合并逻辑截走,
    // 只有托盘空白处能撤,所以用户觉得「拖回去用不了」。
    if (unscheduleInto(items, capsules, event)) return
    if (source.kind === 'item') {
      const sourceItem = byId.get(source.id)
      if (!sourceItem) return
      const targetCapsule = target.kind === 'capsule' ? capsuleById.get(target.id) : null
      if (targetCapsule) {
        if (targetCapsule.itemIds.includes(sourceItem.id)) return
        dispatchOps([{ op: 'update_capsule', id: targetCapsule.id, itemIds: [...targetCapsule.itemIds, sourceItem.id] }], { label: t('并入胶囊') })
        return
      }
      const targetItem = byId.get(target.id)
      if (!targetItem) return
      dispatchOps([{ op: 'add_capsule', itemIds: [targetItem.id, sourceItem.id] }], { label: t('合成胶囊') })
      return
    }
    const sourceCapsule = capsuleById.get(source.id)
    if (!sourceCapsule) return
    if (target.kind === 'item') {
      const targetItem = byId.get(target.id)
      if (!targetItem || sourceCapsule.itemIds.includes(targetItem.id)) return
      dispatchOps([{ op: 'update_capsule', id: sourceCapsule.id, itemIds: [...sourceCapsule.itemIds, targetItem.id] }], { label: t('收进胶囊') })
      return
    }
    const targetCapsule = capsuleById.get(target.id)
    if (!targetCapsule) return
    const merged = [...targetCapsule.itemIds]
    for (const id of sourceCapsule.itemIds) if (!merged.includes(id)) merged.push(id)
    dispatchOps([
      { op: 'update_capsule', id: targetCapsule.id, itemIds: merged },
      { op: 'delete_capsule', id: sourceCapsule.id },
    ], { label: t('合并胶囊') })
  }
  const dropFor = (kind, id) => ({ kind, id, key: `${kind}:${id}` })
  // dragover 阶段浏览器不让读 dataTransfer 的内容,只能看 types
  const hasInternal = (event) => {
    const types = Array.from(event.dataTransfer?.types ?? [])
    return types.includes(TYPE) || types.includes(CAPSULE_TYPE)
  }
  const dropProps = (target) => ({
    onDragOver: (event) => {
      if (!hasInternal(event)) return
      event.preventDefault()
      // 来源是 move(日历签/托盘卡都用 move),这里必须给同一个效果,否则浏览器判定不兼容、根本不派发 drop
      event.dataTransfer.dropEffect = 'move'
      setMergeOver(target.key)
    },
    onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMergeOver(current => current === target.key ? null : current) },
    onDrop: (event) => combine(event, target),
  })

  return (
    <aside className="md-rail-col">
      {next ? (
        <button type="button" className="md-next" onClick={() => openItem(next.id)}>
          <span className="md-next-top"><span>{t('下一条')}</span><span>{relativeDay(next.scheduledAt)}</span></span>
          <b>{fmtTime(next.scheduledAt)}</b>
          <p>{next.title}</p>
          <span className="md-next-foot">{next.platform ? `${t(next.platform)} · ` : ''}{t(STATUS_LABEL[next.status])} · {fmtDate(next.scheduledAt)}</span>
        </button>
      ) : null}
      <section
        className={`md-tile md-tray ${over ? 'is-over' : ''}`}
        aria-label={t('待排期')}
        onDragOver={(event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; setOver(true) }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOver(false) }}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          // 托盘也是落点：文件落这儿就建成普通灵感(ADR 0011)
          const files = Array.from(event.dataTransfer?.files ?? [])
          if (files.length) {
            takeInFiles(files, { origin: 'drop' })
            return
          }
          // 空白处/间隙落回来也照撤:胶囊整张撤,单条撤自己(卡片上那一路见 combine,口径同此)
          unscheduleInto(items, capsules, event)
        }}
      >
        <header className="md-tile-head"><h2>{t('待排期')}</h2><span className="md-tile-meta">{t('拖到日历上')}</span></header>
        <div className="md-tray-scroll">
          <h3>{lang() === 'en' ? t('灵感（导航）') : '灵感'} <span>{ideas.length + pendingCapsules.length}</span></h3>
          {!ideas.length && !pendingCapsules.length ? <p className="md-tray-empty">{t('记下灵感或做好稿子后，从这里拖到日历上。')}</p> : null}
          <div className="md-tray-list">
            {pendingCapsules.map(({ capsule, members, pending }) => {
              const target = dropFor('capsule', capsule.id)
              return <TrayCapsule key={capsule.id} capsule={capsule} members={members} pending={pending} merge={mergeOver === target.key} drop={dropProps(target)} />
            })}
            {ideas.map(item => {
              const target = dropFor('item', item.id)
              return (
                <button type="button" key={item.id} draggable className={`md-tray-item ${mergeOver === target.key ? 'is-merge' : ''}`} onDragStart={event => startDrag(event, item.id)} onClick={() => openItem(item.id)} {...dropProps(target)}>
                  <Thumb item={item} />
                  <span>{item.title}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>
    </aside>
  )
}

export function ScheduleView() {
  useLang()
  const state = useDesk(s => s.state)
  const items = useDesk(s => s.state.items)
  const capsules = useDesk(s => s.state?.capsules ?? EMPTY_LIST)
  return (
    <div className="md-board-page">
      <style>{focusCss}</style>
      <div className="md-schedule">
        <Calendar items={items} capsules={capsules} />
        <ScheduleFocus items={items} capsules={capsules} />
        <Rail state={state} items={items} capsules={capsules} />
      </div>
    </div>
  )
}