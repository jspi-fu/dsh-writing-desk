// 作品编辑器(ADR 0014/0015):全屏,左编辑右 Markdown 实时预览。
// 保存是自动的(停笔约 700ms 落一次),带 rev 乐观锁;冲突时摆两条路:
// 「用最新的」丢掉本地改动,或「覆盖」显式 force。没有版本快照、没有人工改动徽标。
import React from 'react'
import { BRIDGE_ADAPTERS } from '../src/platforms.js'
import { PUBLICATION_LABEL, workHasText, workState, workTitle } from '../src/work.js'
import { closeWork, deleteWork, dispatchPublish, EMPTY_LIST, exportForPublish, getDesk, openWork, publishWork, revealWorkFiles, saveWorkFiles, toast, useDesk } from './desk.js'
import { plural, t, useLang } from './i18n.js'
import { Dialog, Icon, IconButton } from './ui.jsx'
import { LearnFromWorksDialog } from './learn-from-works.jsx'
import { fmtWhen, renderMarkdown, textLength } from './util.js'
import { openWritingSession } from './session-link.js'

// 三平台预览宽度(ADR 0015):小红书窄栏 / 公众号中栏 / 知乎宽栏
const FORMS = [
  { id: 'xhs', label: '小红书', width: 375 },
  { id: 'gzh', label: '公众号', width: 578 },
  { id: 'zhihu', label: '知乎', width: 700 },
]

// 投递平台从 src/platforms.js 的 BRIDGE_ADAPTERS 派生(唯一来源),不再手工镜像。
const DISPATCH_TARGETS = Object.entries(BRIDGE_ADAPTERS).map(([id, label]) => ({ id, label }))

/** 投递状态行:publication.dispatches 里的逐平台结果。 */
function DispatchList({ dispatches }) {
  return (
    <ul className="md-dispatch-list">
      {(dispatches ?? []).map((row, index) => (
        <li key={`${row.platform}-${index}`}>
          <span className={`md-dot ${row.ok ? 'is-ok' : 'is-fail'}`} aria-hidden="true" />
          <span className="md-dispatch-platform">{t(DISPATCH_TARGETS.find(target => target.id === row.platform)?.label ?? row.platform)}</span>
          {row.ok
            ? (row.url ? <a href={row.url} target="_blank" rel="noreferrer">{t('打开草稿')}</a> : <span className="md-muted">{t('已到草稿箱')}</span>)
            : <span className="md-dispatch-error">{row.error ?? t('投递失败')}</span>}
          <time>{fmtWhen(row.at)}</time>
        </li>
      ))}
    </ul>
  )
}

/** 发布:先「投递到草稿箱」,再由用户点「标记已发布」——机器不代劳(ADR 0009/0013)。 */
function PublishDialog({ work, onClose }) {
  const [picks, setPicks] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const dispatches = work.publication?.dispatches ?? []
  const toggle = (id) => setPicks(current => current.includes(id) ? current.filter(row => row !== id) : [...current, id])
  const send = async () => {
    if (!picks.length) return
    setBusy(true)
    const data = await dispatchPublish(work.id, picks)
    setBusy(false)
    if (data) toast(t('已投递给浏览器扩展,完成后这里会亮起草稿链接'))
  }
  const mark = async () => {
    onClose()
    await publishWork(work.id)
  }
  return (
    <Dialog title={t('发布')} onClose={onClose}>
      <div className="md-form">
        <div className="md-field">
          <span>{t('投递到浏览器扩展(只到草稿箱)')}</span>
          <div className="md-dispatch-picks" role="group" aria-label={t('选择平台')}>
            {DISPATCH_TARGETS.map(target => (
              <button type="button" key={target.id} className={`md-chip ${picks.includes(target.id) ? 'is-active' : ''}`}
                aria-pressed={picks.includes(target.id)} onClick={() => toggle(target.id)}>{t(target.label)}</button>
            ))}
            <button type="button" className="md-btn is-small is-primary" onClick={send}
              disabled={busy || !picks.length}>{busy ? t('投递中…') : t('投递')}</button>
          </div>
          {dispatches.length ? <DispatchList dispatches={dispatches} /> : null}
        </div>
        <p className="md-muted">{t('投递只把草稿送进平台草稿箱;真的发了才点「标记已发布」。')}</p>
        <div className="md-form-foot">
          <span className="md-grow" />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <button type="button" className="md-btn is-primary" onClick={mark} disabled={!workHasText(work)}>{t('标记已发布')}</button>
        </div>
      </div>
    </Dialog>
  )
}

const EMPTY = { title: '', coverText: '', article: '' }

function fieldsOf(work) {
  const current = work?.current ?? {}
  return {
    title: current.title ?? workTitle(work) ?? '',
    coverText: current.coverText ?? '',
    article: current.article ?? '',
  }
}

function sameFields(a, b) {
  return a.title === b.title && a.coverText === b.coverText && a.article === b.article
}

function WorkPane({ work }) {
  useLang()
  const [draft, setDraft] = React.useState(() => fieldsOf(work))
  const [rev, setRev] = React.useState(work.current?.rev ?? 0)
  const [dirty, setDirty] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [conflict, setConflict] = React.useState(null)
  const [mode, setMode] = React.useState('split')
  const [form, setForm] = React.useState('gzh')
  const [publish, setPublish] = React.useState(null)
  const [learn, setLearn] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const revRef = React.useRef(rev)
  revRef.current = rev
  const draftRef = React.useRef(draft)
  draftRef.current = draft
  const formMeta = FORMS.find(row => row.id === form) ?? FORMS[1]

  // 别处写回(创作会话)时,本地没改动就跟着更新;有未保存的改动则保留本地并亮冲突提示
  React.useEffect(() => {
    const serverRev = work.current?.rev ?? 0
    if (serverRev === revRef.current) return
    if (!dirty) {
      setDraft(fieldsOf(work))
      setRev(serverRev)
      return
    }
    if (serverRev > revRef.current) {
      setConflict(current => current ?? { rev: serverRev, message: t('这篇作品在别处更新过（你手上是第 {base} 版，现在是第 {rev} 版）', { base: revRef.current, rev: serverRev }) })
    }
  }, [work.current?.rev, dirty])

  const save = React.useCallback(async (extra = {}) => {
    setSaving(true)
    const result = await saveWorkFields(work.id, { ...draftRef.current, rev: revRef.current, ...extra })
    setSaving(false)
    if (result.ok) {
      setDirty(false)
      setConflict(null)
      if (typeof result.rev === 'number') setRev(result.rev)
      return
    }
    if (result.conflict) {
      setConflict({ rev: result.rev ?? null, message: result.message ?? t('这篇作品在别处更新过') })
      return
    }
    if (result.message) toast(result.message, { error: true })
  }, [work.id])

  // 自动保存:停笔 700ms 落一次(ADR 0014),冲突未解决时不覆盖
  React.useEffect(() => {
    if (!dirty || conflict) return undefined
    const timer = setTimeout(() => { save() }, 700)
    return () => clearTimeout(timer)
  }, [draft, dirty, conflict, save])

  const update = (key, value) => {
    setDraft(current => ({ ...current, [key]: value }))
    setDirty(true)
  }

  const close = async () => {
    if (dirty && !conflict) await save()
    closeWork()
  }

  // Esc 关闭的闭包走 ref:监听器只挂一次,不随每次渲染拆装
  const escapeRef = React.useRef({ publish, close })
  escapeRef.current = { publish, close }
  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (escapeRef.current.publish) return
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      event.preventDefault()
      escapeRef.current.close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  // 作品被删或被撤销掉时收起编辑器,不留空壳
  React.useEffect(() => { if (!getDesk().state?.works?.some(row => row.id === work.id)) closeWork() })

  const words = textLength(draft.article)
  const state = workState(work)
  const saveLabel = conflict ? t('有冲突') : saving ? t('保存中…') : dirty ? t('未保存') : t('已保存')
  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(`# ${draft.title}\n\n${draft.article}`)
      toast(t('正文已复制'))
    } catch (err) {
      toast(err.message, { error: true })
    }
  }
  const saveFiles = async () => {
    if (dirty) await save()
    setBusy(true)
    // 第一次保存先弹系统文件夹选择器；之后直接写回同一处
    await saveWorkFiles(work.id, { pick: !work.savedPath })
    setBusy(false)
  }
  const exportPackage = async () => {
    if (dirty) await save()
    setBusy(true)
    const result = await exportForPublish(work.id)
    setBusy(false)
    if (result) setPublish({ result })
  }

  return (
    <div className="md-work-editor" role="dialog" aria-modal="true" aria-label={t('作品编辑器')}>
      <header className="md-work-editor-head">
        <IconButton icon="chevR" label={t('收起')} onClick={close} className="is-back" />
        <input className="md-work-editor-title" value={draft.title} aria-label={t('标题')} placeholder={t('（无标题）')}
          onChange={event => update('title', event.target.value)} />
        <span className={`md-work-editor-state is-${state}`}>{t(PUBLICATION_LABEL[state])}</span>
        <span className={`md-work-save is-${conflict ? 'conflict' : saving ? 'saving' : dirty ? 'dirty' : 'saved'}`}>{saveLabel}</span>
        <div className="md-seg md-work-editor-forms" role="radiogroup" aria-label={t('平台形态')}>
          {FORMS.map(option => (
            <button type="button" key={option.id} role="radio" aria-checked={form === option.id} className={form === option.id ? 'is-on' : ''} onClick={() => setForm(option.id)}>{t(option.label)}</button>
          ))}
        </div>
        <div className="md-seg md-work-editor-modes" role="radiogroup" aria-label={t('显示方式')}>
          {[{ id: 'edit', label: '编辑' }, { id: 'split', label: '分栏' }, { id: 'preview', label: '预览' }].map(option => (
            <button type="button" key={option.id} role="radio" aria-checked={mode === option.id} className={mode === option.id ? 'is-on' : ''} onClick={() => setMode(option.id)}>{t(option.label)}</button>
          ))}
        </div>
        <button type="button" className="md-btn is-small" onClick={() => openWritingSession({ itemIds: work.sourceItemIds ?? [], capsuleIds: work.sourceCapsuleIds ?? [], workId: work.id })}>
          <Icon name="spark" size={13} />{t('让 AI 写')}
        </button>
        <button type="button" className="md-btn is-small is-primary" onClick={() => setPublish({ dialog: true })} disabled={!workHasText(work)}>
          <Icon name="send" size={13} />{t('发布')}
        </button>
      </header>
      {conflict ? (
        <div className="md-work-conflict" role="alert">
          <Icon name="spark" size={13} />
          <span>{conflict.message ?? t('这篇作品在别处更新过')}</span>
          <span className="md-grow" />
          <button type="button" className="md-btn is-small" onClick={() => {
            const latest = (getDesk().state?.works ?? []).find(row => row.id === work.id)
            setDraft(fieldsOf(latest ?? work))
            setRev(latest?.current?.rev ?? rev)
            setDirty(false)
            setConflict(null)
          }}>{t('用最新的')}</button>
          <button type="button" className="md-btn is-small is-primary" onClick={() => { setConflict(null); save({ force: true }) }}>{t('用我的覆盖')}</button>
        </div>
      ) : null}
      <div className={`md-work-editor-body mode-${mode}`}>
        {mode !== 'preview' ? (
          <div className="md-work-editor-pane">
            <label className="md-field">
              <span>{t('封面文案')}</span>
              <input value={draft.coverText} maxLength={40} aria-label={t('封面文案')} placeholder={t('一句话顶在封面上')} onChange={event => update('coverText', event.target.value)} />
            </label>
            <textarea className="md-work-editor-article" value={draft.article} aria-label={t('正文')} placeholder={t('正文从这儿开始……也可以先让 AI 起草')}
              onChange={event => update('article', event.target.value)} />
            <div className="md-work-editor-stats">
              <span><b>{words}</b>{t('字', { s: plural(words, '', 's') })}</span>
              <span className="md-grow" />
              <span className="md-muted">{t('停笔约 0.7 秒自动保存')}</span>
            </div>
          </div>
        ) : null}
        {mode !== 'edit' ? (
          <div className="md-work-editor-preview">
            <article className="md-work-paper" style={{ '--paper-w': `${formMeta.width}px` }}>
              <span className={`md-proof-cover ${work.current?.cover?.src ? '' : 'is-type'}`}>
                {work.current?.cover?.src
                  ? <img src={work.current.cover.src} alt={draft.coverText || draft.title} draggable={false} />
                  : <b>{draft.coverText || draft.title || t('（无标题）')}</b>}
              </span>
              <h1 className="md-proof-title">{draft.title || t('（无标题）')}</h1>
              {draft.article
                ? <div className="md-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(draft.article) }} />
                : <p className="md-muted md-proof-empty">{t('这篇还没有正文。')}</p>}
              <span className="md-proof-approx" title={t('近似预览')}>{t('近似预览')}</span>
            </article>
          </div>
        ) : null}
      </div>
      <footer className="md-work-editor-foot">
        <button type="button" className="md-pill" onClick={copyBody}><Icon name="copy" size={14} />{t('复制正文')}</button>
        <button type="button" className="md-pill" onClick={saveFiles} disabled={busy}><Icon name="save" size={14} />{busy ? t('处理中…') : t('保存文件夹')}</button>
        {work.savedPath ? <IconButton icon="folder" label={t('打开保存的文件夹')} onClick={() => revealWorkFiles(work.id)} /> : null}
        <button type="button" className="md-pill" onClick={exportPackage} disabled={busy}><Icon name="save" size={14} />{t('导出发布包')}</button>
        <button type="button" className="md-pill" onClick={() => setLearn(true)}><Icon name="branch" size={14} />{t('学习写法')}</button>
        <span className="md-work-sources">
          {(work.sourceSnapshot ?? []).map(source => (
            <span key={source.itemId} className="md-work-source">{source.title || t('（无标题）')}</span>
          ))}
        </span>
        <span className="md-grow" />
        <button type="button" className="md-pill is-danger" onClick={async () => {
          if (!window.confirm(t('删除这篇作品？来源素材会留着，还能再成稿。'))) return
          closeWork()
          await deleteWork(work.id)
        }}>{t('删除作品')}</button>
      </footer>
      {publish?.dialog ? <PublishDialog work={work} onClose={() => setPublish(null)} /> : null}
      {publish?.result ? <PublishResult result={publish.result} onClose={() => setPublish(null)} /> : null}
      {learn ? <LearnFromWorksDialog initialIds={[work.id]} onClose={() => setLearn(false)} /> : null}
    </div>
  )
}

function PublishResult({ result, onClose }) {
  return (
    <Dialog title={t('发布包已导出')} onClose={onClose}>
      <div className="md-form">
        <p className="md-muted">{t('发布包(article.md + images/):{dir}', { dir: result.dir })}</p>
        <div className="md-form-foot">
          <span className="md-grow" />
          <button type="button" className="md-btn" onClick={onClose}>{t('关闭')}</button>
        </div>
      </div>
    </Dialog>
  )
}

export function WorkEditor() {
  const open = useDesk(s => Boolean(s.workId))
  const work = useDesk(s => (s.state?.works ?? EMPTY_LIST).find(row => row.id === s.workId))
  if (!open || !work) return null
  return <WorkPane key={work.id} work={work} />
}

// 内容页/灵感墙点「成稿」后直接打开编辑器,这里给外部一个短名字
export { openWork }