// 从作品学习写法(ADR 0014):选 1–6 篇有正文的作品,读创作对话 + 发布稿,
// 新开一个风格会话;应用不改动原作品,也不自动启用候选规则/风格卡。
import React from 'react'
import { PUBLICATION_LABEL, workHasText, workState, workTitle } from '../src/work.js'
import { EMPTY_LIST, toast, useDesk } from './desk.js'
import { t } from './i18n.js'
import { openStyleSessionFromWorks } from './session-link.js'
import { Dialog } from './ui.jsx'

const MAX_WORKS = 6

export function LearnFromWorksDialog({ initialIds = [], onClose }) {
  const works = useDesk(s => s.state?.works ?? EMPTY_LIST)
  const candidates = works.filter(work => !work.archivedAt && workHasText(work))
  const initial = initialIds.filter(id => candidates.some(work => work.id === id)).slice(0, MAX_WORKS)
  const [ids, setIds] = React.useState(initial)
  const [name, setName] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const sorted = [...candidates].sort((a, b) => {
    const published = (workState(b) === 'published') - (workState(a) === 'published')
    return published || String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
  })
  const toggle = (id) => setIds((current) => {
    if (current.includes(id)) return current.filter(row => row !== id)
    if (current.length >= MAX_WORKS) {
      toast(t('一次最多选 {n} 篇', { n: MAX_WORKS }))
      return current
    }
    return [...current, id]
  })
  const submit = async (event) => {
    event.preventDefault()
    if (!ids.length || busy) return
    setBusy(true)
    try {
      const data = await openStyleSessionFromWorks(ids, name)
      if (data) onClose()
    } catch (err) {
      toast(err?.message || String(err), { error: true })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog title={t('从作品学习写法')} onClose={onClose} width={560}>
      <form className="md-form" onSubmit={submit}>
        <p className="md-muted">{t('勾选 1–6 篇有正文的作品。会读它们的创作对话与发布稿，新开一个风格会话；发布后有未发布改动时也带上当前稿。')}</p>
        {candidates.length ? (
          <div className="md-learn-list" role="group" aria-label={t('选择作品')}>
            {sorted.map(work => {
              const state = workState(work)
              const checked = ids.includes(work.id)
              const sessions = (work.sessionIds ?? []).filter(id => typeof id === 'string' && id).length
              return (
                <label key={work.id} className={`md-learn-row ${checked ? 'is-on' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggle(work.id)} />
                  <span className="md-learn-main">
                    <strong>{workTitle(work)}</strong>
                    <small>
                      {t(PUBLICATION_LABEL[state])}
                      {' · '}
                      {sessions ? t('{n} 段创作会话', { n: sessions }) : t('没有登记创作会话')}
                    </small>
                  </span>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="md-muted">{t('还没有可以学习的作品。先成稿，再写一点正文。')}</p>
        )}
        <label className="md-field">
          <span>{t('风格卡名字（可选）')}</span>
          <input value={name} maxLength={40} onChange={event => setName(event.target.value)} placeholder={t('例如：我的短句风格')} />
        </label>
        <p className="md-muted">{t('只会写候选规则和候选风格卡，不会自动切换当前风格。创作会话不会被改动。')}</p>
        <div className="md-form-foot">
          <span className="md-muted">{t('已选 {n} 篇', { n: ids.length })}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary" disabled={!ids.length || busy}>
            {busy ? t('正在读对话…') : t('学习写法')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}