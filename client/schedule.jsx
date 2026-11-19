// 排期：发布排期和灵感日历是同一张日历。每天一张灵感邮票，发布的内容从右边拖上来。
// 待排期托盘里胶囊折叠成一张胶囊卡(与灵感墙「成员不单独出现」同一口径,ADR 0011)：
// 只要还有成员没排期就露这张卡；拖到日历＝整张胶囊（含已排期的成员）一起排到那天,
// 把一张卡压到另一张上＝合成胶囊。
import React from 'react'
import { awaitingSchedule, capsuleDrafted, isDrafted, isScheduled } from '../src/state.js'
import { dispatchOps, EMPTY_LIST, openCapsule, openItem, useDesk } from './desk.js'
import { lang, t, useLang } from './i18n.js'
import { Stamp, useDayMap } from './stamps.jsx'
import { takeInFiles } from './take-in.js'
import { IconButton } from './ui.jsx'
import { STATUS_LABEL, capsuleMembers, computeStreak, dayKey, displayItem, fmtDate, fmtTime, posterOf, relativeDay, unit } from './util.js'

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

function Thumb({ item }) {
  const shown = displayItem(item)
  const poster = posterOf(shown)
  return <span className="md-cal-thumb">{poster ? <img src={poster} alt="" draggable={false} loading="lazy" /> : null}</span>
}

function Chip({ item }) {
  const shown = displayItem(item)
  return (
    <button type="button" className={`md-cal-chip status-${item.status}`} draggable title={`${fmtTime(item.scheduledAt)} ${shown.title}`} onDragStart={event => startDrag(event, item.id)} onClick={() => openItem(item.id)}>
      <Thumb item={item} />
      <span className="md-cal-chip-text"><time>{fmtTime(item.scheduledAt)}</time><span>{shown.title}</span></span>
    </button>
  )
}

// 日历上的胶囊：整张胶囊只露一个签，不把成员摊成几条(胶囊整体排期,ADR 0011)
function CapsuleChip({ capsule, members }) {
  return (
    <button type="button" className="md-cal-chip is-capsule" draggable title={`${fmtTime(members[0].scheduledAt)} ${capsule.name}`} onDragStart={event => startCapsuleDrag(event, capsule)} onClick={() => openCapsule(capsule.id)}>
      <Thumb item={members[0]} />
      <span className="md-cal-chip-text"><time>{fmtTime(members[0].scheduledAt)}</time><span>{capsule.name}</span></span>
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

function TrayCard({ item, merge, drop }) {
  const shown = displayItem(item)
  const poster = posterOf(shown)
  return (
    <button type="button" draggable className={`md-tray-card ${merge ? 'is-merge' : ''}`} onDragStart={event => startDrag(event, item.id)} onClick={() => openItem(item.id)} {...drop}>
      <span className={`md-tray-cover ${poster ? '' : 'is-type'}`}>
        {poster ? <img src={poster} alt="" loading="lazy" draggable={false} /> : <b>{item.production?.coverText ?? shown.title}</b>}
      </span>
      <span className="md-tray-title">{shown.title}</span>
    </button>
  )
}

// 托盘里的胶囊：只露名字与张数，点开是胶囊浮层；拖到日历＝成员一起排那天
function TrayCapsule({ capsule, members, pending, merge, drop }) {
  return (
    <button type="button" draggable className={`md-tray-item is-capsule ${merge ? 'is-merge' : ''}`} onDragStart={event => startCapsuleDrag(event, capsule)} onClick={() => openCapsule(capsule.id)} {...drop}>
      <Thumb item={members[0]} />
      <span>{capsule.name}</span>
      <em className="md-tray-count">{pending < members.length ? `${pending}/${members.length}` : t('{n} 张', { n: members.length })}</em>
    </button>
  )
}

function Rail({ items, capsules }) {
  const [over, setOver] = React.useState(false)
  const [mergeOver, setMergeOver] = React.useState(null)
  // 待排期区的分组走共享谓词(工单 #5):已成稿组按 isDrafted,手动稿与生成稿都算,不再出现
  // 「内容页算成了、排期页算灵感」;已发布的自动让位。
  const upcoming = items.filter(i => isScheduled(i) && new Date(i.scheduledAt) >= new Date()).sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
  const next = upcoming[0]
  const byId = new Map(items.map(item => [item.id, item]))
  const capsuleById = new Map(capsules.map(row => [row.id, row]))
  // 胶囊成员不在托盘里单条出现(与灵感墙同一口径)
  const memberOf = new Set()
  for (const capsule of capsules) for (const id of capsule.itemIds) memberOf.add(id)
  const waiting = items.filter(awaitingSchedule)
  const loose = waiting.filter(i => !memberOf.has(i.id))
  const ready = loose.filter(isDrafted).sort((a, b) => Date.parse(b.production.finishedAt ?? b.createdAt) - Date.parse(a.production.finishedAt ?? a.createdAt))
  const ideas = loose.filter(i => !isDrafted(i))
  // 胶囊卡只要还有成员待排期就出现:排掉一张成员不该把整张胶囊从托盘里带走(成员本来就不单条出现)。
  // 成稿按整张卡算:只要有成员写成了稿就进「已成稿」组,否则进「灵感」组(ADR 0011)
  const pendingCapsules = []
  for (const capsule of capsules) {
    const members = capsuleMembers(capsule, items)
    if (members.length < 2) continue
    const queue = members.filter(awaitingSchedule)
    if (!queue.length) continue
    pendingCapsules.push({ capsule, members, pending: queue.length, drafted: capsuleDrafted(members) })
  }
  const readyCapsules = pendingCapsules.filter(row => row.drafted)
  const ideaCapsules = pendingCapsules.filter(row => !row.drafted)

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
      event.dataTransfer.dropEffect = 'link'
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
          <p>{displayItem(next).title}</p>
          <span className="md-next-foot">{next.platform ? `${t(next.platform)} · ` : ''}{t(STATUS_LABEL[next.status])} · {fmtDate(next.scheduledAt)}</span>
        </button>
      ) : null}
      <section
        className={`md-tile md-tray ${over ? 'is-over' : ''}`}
        aria-label={t('待排期')}
        onDragOver={(event) => { event.preventDefault(); setOver(true) }}
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
          const id = event.dataTransfer.getData(TYPE)
          if (id && items.find(i => i.id === id)?.scheduledAt) dispatchOps([{ op: 'schedule_item', id, scheduledAt: null }], { label: t('取消排期') })
          // 胶囊拖回托盘＝整张胶囊撤排期，与拖到日历是同一个整体口径(ADR 0011)
          const capsuleId = event.dataTransfer.getData(CAPSULE_TYPE)
          if (capsuleId) {
            const capsule = capsules.find(row => row.id === capsuleId)
            const rows = (capsule?.itemIds ?? []).map(itemId => byId.get(itemId)).filter(row => row?.scheduledAt)
            if (rows.length) dispatchOps(rows.map(row => ({ op: 'schedule_item', id: row.id, scheduledAt: null })), { label: t('取消排期') })
          }
        }}
      >
        <header className="md-tile-head"><h2>{t('待排期')}</h2><span className="md-tile-meta">{t('拖到日历上')}</span></header>
        <div className="md-tray-scroll">
          {ready.length || readyCapsules.length ? (
            <>
              <h3>{t('已成稿')} <span>{ready.length + readyCapsules.length}</span></h3>
              {ready.length ? (
                <div className="md-tray-grid">
                  {ready.map(item => {
                    const target = dropFor('item', item.id)
                    return <TrayCard key={item.id} item={item} merge={mergeOver === target.key} drop={dropProps(target)} />
                  })}
                </div>
              ) : null}
              {readyCapsules.length ? (
                <div className="md-tray-list">
                  {readyCapsules.map(({ capsule, members, pending }) => {
                    const target = dropFor('capsule', capsule.id)
                    return <TrayCapsule key={capsule.id} capsule={capsule} members={members} pending={pending} merge={mergeOver === target.key} drop={dropProps(target)} />
                  })}
                </div>
              ) : null}
            </>
          ) : null}
          <h3>{lang() === 'en' ? t('灵感（导航）') : '灵感'} <span>{ideas.length + ideaCapsules.length}</span></h3>
          {!ready.length && !ideas.length && !pendingCapsules.length ? <p className="md-tray-empty">{t('记下灵感或做好稿子后，从这里拖到日历上。')}</p> : null}
          <div className="md-tray-list">
            {ideaCapsules.map(({ capsule, members, pending }) => {
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
  const items = useDesk(s => s.state.items)
  const capsules = useDesk(s => s.state?.capsules ?? EMPTY_LIST)
  return (
    <div className="md-board-page">
      <div className="md-schedule">
        <Calendar items={items} capsules={capsules} />
        <Rail items={items} capsules={capsules} />
      </div>
    </div>
  )
}