// 内容管理:收发室(ADR 0006)。看板和表格是同一份数据的两种看法;
// 四列看板,相位(审读中/已写回/人工修改中)是同一列稿子的生命阶段,不加列。
import React from 'react'
import { isDrafted, isScheduled } from '../src/state.js'
import { dispatchOps, openItem, openProof, seenRevOf, setDesk, useDesk } from './desk.js'
import { Empty, Icon, Segmented } from './ui.jsx'
import { plural, t, useLang } from './i18n.js'
import { KIND_LABEL, STATUSES, STATUS_LABEL, displayItem, fmtWhen, hash, posterOf, relativeDay } from './util.js'

function useContentItems() {
  const items = useDesk(s => s.state.items)
  const query = useDesk(s => s.query).trim().toLowerCase()
  return React.useMemo(() => items.filter((item) => {
    if (!query) return true
    return [item.title, item.body, item.source, item.platform, item.platform && t(item.platform), ...(item.tags ?? [])].some(v => String(v ?? '').toLowerCase().includes(query))
  }), [items, query])
}

// 相位(ADR 0006):同一列稿子的生命阶段。审读中 = 已交会话还没写回;
// 已写回 = 有比上次签收更新的 rev;人工修改中 = 用户改过稿(pen 徽章)。
function phaseOf(item, seenRev) {
  const production = item.production
  if (item.sentToSession && !production) return 'reviewing'
  if (production && (production.rev ?? 0) > seenRev) return 'written'
  if (production && (production.snapshots ?? []).some(snapshot => snapshot.by === 'user')) return 'editing'
  return null
}

const PHASE_LABEL = { reviewing: '审读中', written: '已写回', editing: '人工修改中' }

function PhaseBadge({ item, seenRev }) {
  const phase = phaseOf(item, seenRev)
  if (!phase) return null
  return (
    <span className={`md-phase is-${phase}`}>
      <Icon name={phase === 'editing' ? 'pen' : 'spark'} size={11} />
      {t(PHASE_LABEL[phase])}
    </span>
  )
}

/** 审读中占位卡:色纸 tone 轮转,静态,不可拖——写回之前它就是这个样子。 */
function ReviewingCard({ item }) {
  return (
    <div className={`md-pending-card tone-${hash(item.id) % 6}`} data-card={item.id}>
      <strong>{item.title || t('无标题')}</strong>
      <span className="md-pending-meta">{t('已交会话 · 写回后落进这列')}</span>
    </div>
  )
}

function BoardCard({ item: raw, seenRev }) {
  // 有成稿时显示成稿的标题和封面
  const item = displayItem(raw)
  const poster = posterOf(item)
  const phase = phaseOf(raw, seenRev)
  return (
    <button
      type="button"
      className={`md-board-card ${phase === 'written' ? 'is-written-back' : ''}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/writing-desk-item', item.id)
        event.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect()
        // 成稿卡进校样浮层(签收),灵感卡仍走编辑界面
        if (isDrafted(raw)) openProof(item.id)
        else openItem(item.id, { x: rect.left, y: rect.top, w: rect.width, h: rect.height })
      }}
    >
      {poster ? <img src={poster} alt="" loading="lazy" draggable={false} /> : null}
      <strong>{item.title}</strong>
      <span className="md-board-meta">
        {item.platform ? <span>{t(item.platform)}</span> : null}
        {isScheduled(item) ? <span className="is-time">{relativeDay(item.scheduledAt)}</span> : null}
        {/* 已成稿走共享谓词:生成稿与手动改稿改的是同一份成稿产物,同一个口径 */}
        {isDrafted(raw) ? <Icon name="pen" size={12} /> : null}
        <PhaseBadge item={raw} seenRev={seenRev} />
      </span>
    </button>
  )
}

// 看板四列(ADR 0006):灵感/成稿/待发布/已发布。outline 数据宽容归入成稿列,
// 已交会话未写回的也停在成稿列(审读中相位)。
const BOARD_COLUMNS = ['idea', 'draft', 'ready', 'published']

function boardColumnOf(item) {
  if ((item.sentToSession && !item.production) || item.status === 'outline') return 'draft'
  return item.status
}

function Board({ items }) {
  const [over, setOver] = React.useState(null)
  return (
    <div className="md-board">
      {BOARD_COLUMNS.map((status) => {
        // 还停留在灵感状态的分支只是发散草图，不占看板的位置
        const rows = items.filter(item => boardColumnOf(item) === status && !(item.parentId && item.status === 'idea'))
        return (
          <section
            key={status}
            className={`md-board-col ${over === status ? 'is-over' : ''}`}
            aria-label={t(STATUS_LABEL[status])}
            onDragOver={(event) => {
              event.preventDefault()
              setOver(status)
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setOver(null)
            }}
            onDrop={(event) => {
              event.preventDefault()
              setOver(null)
              const id = event.dataTransfer.getData('text/writing-desk-item')
              if (id) dispatchOps([{ op: 'set_status', id, status }], { label: t('修改状态') })
            }}
          >
            <header>
              <span className={`md-dot status-${status}`} />
              <h3>{t(STATUS_LABEL[status])}</h3>
              <span className="md-muted">{rows.length}</span>
            </header>
            <div className="md-board-list">
              {rows.map((item) => {
                const seenRev = seenRevOf(item.id)
                if (item.sentToSession && !item.production) return <ReviewingCard key={item.id} item={item} />
                return <BoardCard key={item.id} item={item} seenRev={seenRev} />
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

// label 是中文原文，显示时再翻译
const COLUMNS = [
  { key: 'title', label: '内容', get: i => i.title },
  { key: 'status', label: '状态', get: i => STATUSES.indexOf(i.status) },
  { key: 'platform', label: '平台', get: i => i.platform ?? '' },
  { key: 'scheduledAt', label: '排期', get: i => i.scheduledAt ?? '' },
  { key: 'createdAt', label: '记录于', get: i => i.createdAt },
]

function Table({ items }) {
  const [sort, setSort] = React.useState({ key: 'createdAt', dir: -1 })
  const sorted = React.useMemo(() => {
    const column = COLUMNS.find(c => c.key === sort.key)
    return [...items].sort((a, b) => {
      const x = column.get(a)
      const y = column.get(b)
      return (x > y ? 1 : x < y ? -1 : 0) * sort.dir
    })
  }, [items, sort])
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {COLUMNS.map(column => (
              <th key={column.key} aria-sort={sort.key === column.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                <button type="button" onClick={() => setSort(s => ({ key: column.key, dir: s.key === column.key ? -s.dir : 1 }))}>
                  {t(column.label)}
                  {sort.key === column.key ? <Icon name={sort.dir > 0 ? 'send' : 'chevD'} size={11} /> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((item) => {
            const poster = posterOf(item)
            const seenRev = seenRevOf(item.id)
            return (
              <tr key={item.id} onClick={() => (isDrafted(item) ? openProof(item.id) : openItem(item.id))} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') (isDrafted(item) ? openProof(item.id) : openItem(item.id)) }}>
                <td className="md-table-title">
                  <span className="md-thumb">{poster ? <img src={poster} alt="" loading="lazy" /> : <span>{item.title.slice(0, 1)}</span>}</span>
                  <span><strong>{item.title}</strong><small>{item.parentId ? `${t('分支')} · ` : ''}{t(KIND_LABEL[item.kind])}{item.source ? ` · ${item.source}` : ''}</small></span>
                </td>
                <td>
                  <span className={`md-status status-${item.status}`}>{t(STATUS_LABEL[item.status])}</span>
                  <PhaseBadge item={item} seenRev={seenRev} />
                </td>
                <td>{item.platform ? t(item.platform) : '—'}</td>
                <td className="md-nowrap">{item.scheduledAt ? fmtWhen(item.scheduledAt) : '—'}</td>
                <td className="md-nowrap">{relativeDay(item.createdAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 写回签收栏(ADR 0006):rev 比上次签收新的成稿以题名签宣布,点开校样即签收;无未签收时高度归零。 */
function IntakeBar({ items }) {
  const pending = items.filter((item) => {
    const production = item.production
    return production && (production.rev ?? 0) > seenRevOf(item.id)
  })
  if (!pending.length) return null
  return (
    <div className="md-intake" role="region" aria-label={t('写回签收')}>
      <span className="md-intake-label"><Icon name="spark" size={13} />{t('写回签收')}</span>
      <div className="md-intake-chips">
        {pending.map(item => (
          <button key={item.id} type="button" className="md-intake-chip" title={t('会话写回')} onClick={() => openProof(item.id)}>
            {displayItem(item).title}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ContentView() {
  useLang()
  const [mode, setMode] = React.useState('board')
  const items = useContentItems()
  const query = useDesk(s => s.query)
  // 看板四列计数:审读中的稿子算进成稿列
  const counts = BOARD_COLUMNS.map(s => items.filter(i => boardColumnOf(i) === s && !(i.parentId && s === 'idea')).length)
  const drafted = items.filter(isDrafted).length
  return (
    <div className="md-page">
      <header className="md-page-head">
        <div>
          <h1>{t('内容')}</h1>
          <p className="md-page-sub">{[
            t(plural(items.length, '共 1 条', '共 {n} 条'), { n: items.length }),
            t(plural(counts[0], '1 个灵感待推进', '{n} 个灵感待推进'), { n: counts[0] }),
            t('{n} 篇已成稿', { n: drafted }),
            t('{n} 篇已发布', { n: counts[3] }),
          ].join(' · ')}</p>
        </div>
        <span style={{ flex: 1 }} />
        <label className="md-search">
          <Icon name="search" size={15} />
          <input value={query} onChange={e => setDesk({ query: e.target.value })} placeholder={t('搜索标题、标签、平台')} aria-label={t('搜索内容')} />
        </label>
        <Segmented label={t('显示方式')} value={mode} onChange={setMode} options={[{ value: 'board', label: t('看板') }, { value: 'table', label: t('表格') }]} />
      </header>
      {items.length === 0 ? <Empty title={query ? t('没有匹配的内容') : t('还没有内容')} hint={query ? t('换个关键词试试。') : t('到灵感页记下第一条。')} /> : (
        <>
          <IntakeBar items={items} />
          {mode === 'board' ? <Board items={items} /> : <Table items={items} />}
        </>
      )}
    </div>
  )
}
