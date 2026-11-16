// 胶囊:持久化的命名灵感集合。卡片收成员的封面和名字,对话框里改名、看成员、解散;
// 成员灵感仍然独立存在,点成员照常进编辑界面。
import React from 'react'
import { closeCapsule, dispatchOps, openItem, useDesk } from './desk.js'
import { plural, t } from './i18n.js'
import { Dialog } from './ui.jsx'
import { posterOf } from './util.js'

/** 散落画布和信息流复用同一张胶囊卡:封面叠一摞,名字加成员数。 */
export function CapsuleCard({ capsule, items, onOpen }) {
  const members = capsule.itemIds.map(id => items.find(item => item.id === id)).filter(Boolean)
  const covers = members.map(posterOf).filter(Boolean).slice(0, 3)
  return (
    <article
      className="md-capsule"
      data-capsule={capsule.id}
      tabIndex={0}
      role="button"
      aria-label={t('胶囊 {name}（{n} 条灵感）', { name: capsule.name, n: members.length })}
      onClick={event => onOpen?.(capsule, event)}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen?.(capsule, event) } }}
    >
      <div className="md-capsule-covers">
        {covers.length
          ? covers.map((src, index) => <img key={index} src={src} alt="" loading="lazy" draggable={false} />)
          : <span className="md-capsule-fallback"><span>{capsule.name.slice(0, 1)}</span></span>}
      </div>
      <footer className="md-capsule-foot">
        <strong>{capsule.name}</strong>
        <span>{t('{n} 条灵感', { n: members.length, s: plural(members.length, '', 's') })}</span>
      </footer>
    </article>
  )
}

/** 胶囊对话框:改名即保存,成员点了进编辑界面,解散只拆集合关系。 */
export function CapsuleDialog() {
  const id = useDesk(s => s.capsuleId)
  const capsule = useDesk(s => s.state?.capsules?.find(row => row.id === s.capsuleId))
  const items = useDesk(s => s.state?.items ?? [])
  const [name, setName] = React.useState('')
  React.useEffect(() => { setName(capsule?.name ?? '') }, [capsule?.name, id])
  // 正看着的胶囊被解散或撤销掉时,退回灵感墙
  React.useEffect(() => { if (id && !capsule) closeCapsule() }, [id, capsule])
  if (!id || !capsule) return null
  const members = capsule.itemIds.map(itemId => items.find(item => item.id === itemId)).filter(Boolean)
  const rename = () => {
    const next = name.trim()
    if (next && next !== capsule.name) dispatchOps([{ op: 'update_capsule', id: capsule.id, name: next }], { label: t('重命名胶囊') })
  }
  const dissolve = () => {
    dispatchOps([{ op: 'delete_capsule', id: capsule.id }], { label: t('解散胶囊') })
    closeCapsule()
  }
  return (
    <Dialog title={t('胶囊')} onClose={closeCapsule} width={440}>
      <div className="md-capsule-dialog">
        <label className="md-field">
          <span>{t('名字')}</span>
          <input value={name} onChange={e => setName(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur() } }} placeholder={t('给这堆灵感起个名')} />
        </label>
        <p className="md-muted">{t('成员灵感仍独立存在，点一条就能单独打开；想往里加，把卡片拖到胶囊上。')}</p>
        <div className="md-capsule-members">
          {members.map(item => (
            <button key={item.id} type="button" className="md-capsule-member" onClick={() => { closeCapsule(); openItem(item.id) }}>
              {posterOf(item) ? <img src={posterOf(item)} alt="" loading="lazy" draggable={false} /> : null}
              <span>{item.title}</span>
            </button>
          ))}
        </div>
        <div className="md-form-foot">
          <button type="button" className="md-btn is-danger" onClick={dissolve}>{t('解散胶囊')}</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={closeCapsule}>{t('完成')}</button>
        </div>
      </div>
    </Dialog>
  )
}
