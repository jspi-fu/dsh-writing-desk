// 批量改标签:先写标签看「改前 → 改后」的 diff,确认后带着每条灵感的当前版本提交;
// 预览之后有人又手动改过标签的话,Host 会整批拒绝,不覆盖手动分类。
import React from 'react'
import { closeRetag, dispatchOps, useDesk } from './desk.js'
import { t } from './i18n.js'
import { Dialog } from './ui.jsx'
import { retagPreview } from './tags.js'

export function RetagDialog() {
  const retag = useDesk(s => s.retag)
  const items = useDesk(s => s.state?.items ?? [])
  const [tags, setTags] = React.useState('')
  const [rows, setRows] = React.useState(null)
  React.useEffect(() => { setTags(''); setRows(null) }, [retag])
  if (!retag) return null
  const close = () => closeRetag()
  // 预览之后可能有灵感被删掉:只提交还存在的,免得整批被找不到对象卡住
  const present = retag.ids.filter(id => items.some(item => item.id === id))
  const tagList = tags.split(/[,，、\s]+/).filter(Boolean)
  const preview = () => setRows(retagPreview(items, present, tagList))
  const apply = () => {
    const revisions = Object.fromEntries(rows.map(row => [row.id, row.revision]))
    dispatchOps([{ op: 'retag_items', itemIds: rows.map(row => row.id), tags: tagList, revisions }], { label: t('批量改标签') })
    close()
  }
  const changed = rows?.filter(row => row.changed).length ?? 0
  return (
    <Dialog title={t('批量改标签')} onClose={close} width={480}>
      <div className="md-retag">
        <label className="md-field">
          <span>{t('新标签（替换原有的）')}</span>
          <input value={tags} onChange={e => { setTags(e.target.value); setRows(null) }} placeholder={t('用逗号分开')} />
        </label>
        <p className="md-muted">{t('给 {n} 条灵感统一改标签。先看一遍改前改后，确认了再应用。', { n: present.length })}</p>
        {rows ? (
          <div className="md-retag-diff">
            {rows.map(row => (
              <div key={row.id} className={`md-retag-row${row.changed ? '' : ' is-same'}`}>
                <span className="md-retag-title">{row.title}</span>
                <span className="md-retag-tags">
                  {row.before.map(tag => <i key={tag} className="is-before">{tag}</i>)}
                  {row.changed ? <b className="md-retag-arrow">→</b> : <b className="md-retag-arrow">{t('不变')}</b>}
                  {row.changed && row.after.map(tag => <i key={tag} className="is-after">{tag}</i>)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="md-form-foot">
          {rows ? <button type="button" className="md-btn" onClick={() => setRows(null)}>{t('回去改标签')}</button> : null}
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
          {rows
            ? <button type="button" className="md-btn is-primary" disabled={!changed} onClick={apply}>{t('应用改动（共 {n} 条）', { n: changed })}</button>
            : <button type="button" className="md-btn is-primary" onClick={preview} disabled={!present.length}>{t('预览改动')}</button>}
        </div>
      </div>
    </Dialog>
  )
}
