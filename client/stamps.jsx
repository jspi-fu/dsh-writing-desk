// 邮票灵感日历：排期页的日格邮票。首屏已是整面灵感墙,这里只剩日历格子的邮票。
import React from 'react'
import { openCapture } from './card.jsx'
import { setDesk, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'
import { dayKey, hash, posterOf, isIdea } from './util.js'

export function useDayMap() {
  const items = useDesk(s => s.state.items)
  return React.useMemo(() => {
    const map = new Map()
    for (const item of items) {
      if (!isIdea(item)) continue
      const key = dayKey(item.createdAt)
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(item)
    }
    return map
  }, [items])
}

export function Stamp({ list, today, onOpen, label }) {
  if (!list?.length) {
    return (
      <button type="button" className={`md-stamp is-blank ${today ? 'is-today' : ''}`} aria-label={today ? t('今天还没有记录，记一条') : t('{label} 没有记录', { label })} onClick={today ? () => openCapture('note') : undefined} disabled={!today}>
        {today ? <Icon name="plus" size={16} /> : null}
      </button>
    )
  }
  const cover = list.find(item => posterOf(item)) ?? list[0]
  const poster = posterOf(cover)
  return (
    <button type="button" className={`md-stamp ${poster ? '' : `is-type tone-${hash(cover.id) % 6}`}`} aria-label={t('{label}：{title}，共 {n} 条', { label, title: cover.title, n: list.length })} title={cover.title} onClick={onOpen}>
      {poster ? <img src={poster} alt="" loading="lazy" draggable={false} /> : <span>{cover.title.slice(0, 1)}</span>}
      {list.length > 1 ? <i>{list.length}</i> : null}
    </button>
  )
}
