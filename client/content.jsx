// 内容栏目:默认是「我的作品」画廊,可切「流程」看板(ADR 0015)。
// 作品是唯一的内容实体(ADR 0013):素材只提供来源,正文与发布状态都在作品上。
//
// 这一页不是数据表,是作品集:刊名与最近更新的一篇构成卷首,
// 再往下才是按最近更新排的作品目录。搜索与流程切换仍是高效工具。
import React from 'react'
import { PUBLICATION_LABEL, workHasText, workState, workTitle } from '../src/work.js'
import { EMPTY_LIST, openWork, seenRevOf, setDesk, useDesk } from './desk.js'
import { Icon, Segmented } from './ui.jsx'
import { plural, t, useLang } from './i18n.js'
import { relativeDay } from './util.js'

const STATE_ORDER = ['draft', 'submitted', 'published']
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function useWorks() {
  const works = useDesk(s => s.state?.works ?? EMPTY_LIST)
  const query = useDesk(s => s.query).trim().toLowerCase()
  return React.useMemo(() => {
    const all = [...works.filter(work => !work.archivedAt)]
      .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt ?? 0) - Date.parse(a.updatedAt ?? a.createdAt ?? 0))
    const rows = query
      ? all.filter(work => [workTitle(work), ...(work.sourceSnapshot ?? []).map(s => s.title)]
        .some(value => String(value ?? '').toLowerCase().includes(query)))
      : all
    return { all, rows }
  }, [works, query])
}

/** 封面:作品自己的封面优先,没有就落回第一份来源素材的图。 */
function coverOfWork(work) {
  const src = work.current?.cover?.src
  if (src) return src
  for (const source of work.sourceSnapshot ?? []) {
    if (source.poster) return source.poster
  }
  return null
}

function StateBadge({ work }) {
  const state = workState(work)
  return (
    <span className={`md-work-state is-${state}`}>
      <span className={`md-dot status-${state === 'draft' ? 'draft' : state === 'submitted' ? 'ready' : 'published'}`} />
      {t(PUBLICATION_LABEL[state])}
    </span>
  )
}

function WorkCard({ work, index }) {
  const poster = coverOfWork(work)
  const title = workTitle(work) || t('（无标题）')
  const coverText = (work.current?.coverText || '').trim()
  const fresh = (work.current?.rev ?? 0) > seenRevOf(work.id)
  const sources = work.sourceSnapshot ?? []
  const firstSource = sources[0]?.title || t('（无标题）')
  return (
    <button
      type="button"
      className={`md-work-card ${fresh ? 'is-fresh' : ''}`}
      onClick={() => openWork(work.id)}
      title={title}
      aria-label={t('打开作品《{title}》', { title })}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <span className={`md-work-art ${poster ? '' : 'is-type'}`}>
        {poster
          ? <img src={poster} alt="" loading="lazy" draggable={false} />
          : <strong>{coverText || title}</strong>}
        <span className="md-work-no" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      </span>
      <span className="md-work-body">
        <strong className="md-work-title">{title}</strong>
        <span className="md-work-meta">
          <StateBadge work={work} />
          {!workHasText(work) ? <span className="md-work-no-text">{t('还没有正文')}</span> : null}
          <span className="md-work-date">{relativeDay(work.updatedAt ?? work.createdAt)}</span>
        </span>
        {sources.length ? (
          <span className="md-work-source-line" title={sources.map(s => s.title || t('（无标题）')).join(' / ')}>
            {t('来自《{title}》', { title: firstSource })}{sources.length > 1 ? ` +${sources.length - 1}` : ''}
          </span>
        ) : null}
      </span>
    </button>
  )
}

/** 最近更新的一篇占卷首主打位；状态、日期、来源与目录卡保持同一语义。 */
function WorkFeature({ work }) {
  const poster = coverOfWork(work)
  const title = workTitle(work) || t('（无标题）')
  const coverText = (work.current?.coverText || '').trim()
  const fresh = (work.current?.rev ?? 0) > seenRevOf(work.id)
  const sources = work.sourceSnapshot ?? []
  const firstSource = sources[0]?.title || t('（无标题）')
  return (
    <button
      type="button"
      className={`md-work-feature ${fresh ? 'is-fresh' : ''}`}
      onClick={() => openWork(work.id)}
      title={title}
      aria-label={t('打开作品《{title}》', { title })}
    >
      <span className="md-work-feature-copy">
        <strong className="md-work-feature-title">{title}</strong>
        {sources.length ? (
          <span className="md-work-source-line" title={sources.map(s => s.title || t('（无标题）')).join(' / ')}>
            {t('来自《{title}》', { title: firstSource })}{sources.length > 1 ? ` +${sources.length - 1}` : ''}
          </span>
        ) : null}
        <span className="md-work-feature-foot">
          <StateBadge work={work} />
          <span className="md-work-date">{relativeDay(work.updatedAt ?? work.createdAt)}</span>
          <span className="md-work-feature-open" aria-hidden="true"><Icon name="chevR" size={15} /></span>
        </span>
      </span>
      <span className="md-work-feature-art">
        <span className={`md-work-art is-feature ${poster ? '' : 'is-type'}`}>
          {poster
            ? <img src={poster} alt="" loading="eager" draggable={false} />
            : <strong>{coverText || title}</strong>}
        </span>
      </span>
    </button>
  )
}

function Gallery({ works, offset = 0 }) {
  return (
    <div className="md-works">
      {works.map((work, index) => <WorkCard key={work.id} work={work} index={index + offset} />)}
    </div>
  )
}

function CatalogueHead({ count, query }) {
  return (
    <div className="md-works-rubric">
      <span className="md-works-rubric-label">{query ? t('搜索结果') : t('作品目录')}</span>
      <i className="md-works-rubric-rule" aria-hidden="true" />
      <span className="md-works-rubric-count" aria-live="polite">
        {query
          ? t(plural(count, '找到 1 篇', '找到 {n} 篇'), { n: count })
          : t(plural(count, '共 1 篇', '共 {n} 篇'), { n: count })}
      </span>
    </div>
  )
}

function WorksHero({ total, query, mode, onMode }) {
  const now = new Date()
  const date = `${now.getFullYear()} · ${t('{m} 月 {d} 日', { m: now.getMonth() + 1, d: now.getDate(), mon: now.toLocaleString('en-US', { month: 'short' }) })} · ${t(WEEKDAYS[now.getDay()])}`
  return (
    <header className={`md-works-hero ${total ? '' : 'is-empty'}`}>
      <div className="md-works-masthead">
        <h1 className="md-works-title">{t('我的作品')}</h1>
        <p className="md-works-deck">{t('你写下的，会留在这里。')}</p>
        <time className="md-hero-date" dateTime={now.toISOString()}>{date}</time>
      </div>
      {!total ? (
        <div className="md-works-empty">
          <span className="md-works-empty-mark" aria-hidden="true"><em>01</em><i /></span>
          <div className="md-works-empty-copy">
            <h2>{t('第一篇')}</h2>
            <p className="md-works-lede">{t('从灵感墙点「成稿」，第一篇作品就会出现在这里。')}</p>
            <button type="button" className="md-works-go" onClick={() => setDesk({ view: 'home' })}>
              <Icon name="wall" size={14} />
              {t('去灵感墙')}
              <Icon name="chevR" size={12} />
            </button>
          </div>
        </div>
      ) : (
        <div className="md-works-tools">
          <label className="md-search md-works-search">
            <Icon name="search" size={16} />
            <input
              value={query}
              onChange={e => setDesk({ query: e.target.value })}
              placeholder={t('搜索作品标题、来源')}
              aria-label={t('搜索作品')}
            />
            {query ? (
              <button type="button" className="md-search-clear" aria-label={t('清空搜索')} onClick={() => setDesk({ query: '' })}>
                <Icon name="close" size={12} />
              </button>
            ) : null}
          </label>
          <span className="md-works-tools-gap" />
          <Segmented
            label={t('显示方式')}
            value={mode}
            onChange={onMode}
            options={[{ value: 'gallery', label: t('我的作品') }, { value: 'pipeline', label: t('流程') }]}
          />
        </div>
      )}
    </header>
  )
}

function NoResults() {
  return (
    <div className="md-works-nomatch">
      <p>{t('没有找到匹配的作品。')}</p>
      <button type="button" className="md-link-btn" onClick={() => setDesk({ query: '' })}>{t('清空搜索')}</button>
    </div>
  )
}

// 流程看板只按状态列展示,不允许拖拽改状态(ADR 0015):状态是发布结果,不是手动摆位。
function Pipeline({ works }) {
  return (
    <div className="md-pipeline">
      {STATE_ORDER.map((state) => {
        const rows = works.filter(work => workState(work) === state)
        return (
          <section key={state} className="md-pipeline-col" aria-label={t(PUBLICATION_LABEL[state])}>
            <header className="md-pipeline-head">
              <span className={`md-dot status-${state === 'draft' ? 'draft' : state === 'submitted' ? 'ready' : 'published'}`} />
              <h3>{t(PUBLICATION_LABEL[state])}</h3>
              <b>{rows.length}</b>
            </header>
            <div className="md-pipeline-list">
              {rows.map(work => (
                <button type="button" key={work.id} className="md-pipeline-item" onClick={() => openWork(work.id)}>
                  <span>{workTitle(work) || t('（无标题）')}</span>
                  <time>{relativeDay(work.updatedAt ?? work.createdAt)}</time>
                </button>
              ))}
              {!rows.length ? <p className="md-pipeline-empty">{t('这里还是空的。')}</p> : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** 会话写回签收:rev 比上次签收新的作品以题名签宣布,点开作品即签收。 */
function IntakeBar({ works }) {
  const pending = works.filter(work => (work.current?.rev ?? 0) > seenRevOf(work.id))
  if (!pending.length) return null
  return (
    <div className="md-intake" role="region" aria-label={t('写回签收')}>
      <span className="md-intake-label"><Icon name="spark" size={13} />{t('写回签收')}</span>
      <div className="md-intake-chips">
        {pending.map(work => (
          <button key={work.id} type="button" className="md-intake-chip" title={t('会话写回')} onClick={() => openWork(work.id)}>
            {workTitle(work) || t('（无标题）')}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ContentView() {
  useLang()
  const [mode, setMode] = React.useState('gallery')
  const { all, rows } = useWorks()
  const query = useDesk(s => s.query)
  const total = all.length
  return (
    <div className="md-page md-works-page">
      <WorksHero total={total} query={query} mode={mode} onMode={setMode} />
      {total ? (
        <>
          {rows.length ? <IntakeBar works={rows} /> : null}
          {mode === 'gallery' ? (
            <>
              <CatalogueHead count={rows.length} query={Boolean(query.trim())} />
              {rows.length ? (
                <>
                  <WorkFeature work={rows[0]} />
                  {rows.length > 1 ? <Gallery works={rows.slice(1)} offset={1} /> : null}
                </>
              ) : <NoResults />}
            </>
          ) : rows.length ? <Pipeline works={rows} /> : <NoResults />}
        </>
      ) : null}
    </div>
  )
}