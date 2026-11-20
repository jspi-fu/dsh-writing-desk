// 校样浮层(ADR 0006):成稿的人工介入载体,取代原 produce 操作页。
// 三层信息架构:状态层(head + 冲突横幅)/内容层(校样纸)/交接层(foot)。
// 就地编辑经 update_production 落库可撤销;写回冲突经 pendingWrite 横幅裁决。
import React from 'react'
import { closeProof, dispatchOps, dispatchPublish, exportForPublish, getDesk, revealSaved, saveProduced, toast, useDesk, EMPTY_LIST } from './desk.js'
import { plural, t, useLang } from './i18n.js'
import { Dialog, Icon, IconButton } from './ui.jsx'
import { SPRING_SNAP, PLATFORMS, fmtWhen, reducedMotion, renderMarkdown, textLength, toLocalInput } from './util.js'

// 三平台形态重排(近似预览,不做像素承诺):小红书窄栏 / 公众号中栏 / 知乎宽栏
const FORMS = [
  { id: 'xhs', label: '小红书', width: 375 },
  { id: 'gzh', label: '公众号', width: 578 },
  { id: 'zhihu', label: '知乎', width: 700 },
]

function InPlaceText({ value, onCommit, className, label, editing }) {
  const [draft, setDraft] = React.useState(value ?? '')
  const ref = React.useRef(null)
  React.useEffect(() => setDraft(value ?? ''), [value])
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft, editing])
  if (!editing) return null
  return (
    <textarea ref={ref} rows={1} aria-label={label} className={className} value={draft}
      onChange={e => setDraft(e.target.value)} onBlur={() => { if (draft !== (value ?? '')) onCommit(draft) }} />
  )
}

// 桥适配器清单:与 src/bridge.js 的 BRIDGE_ADAPTERS 一致(上游公开的 19 个内容平台)。
const DISPATCH_TARGETS = [
  { id: 'weixin', label: '公众号' },
  { id: 'zhihu', label: '知乎' },
  { id: 'juejin', label: '掘金' },
  { id: 'weibo', label: '微博' },
  { id: 'bilibili', label: 'B站' },
  { id: 'douban', label: '豆瓣' },
  { id: 'baijiahao', label: '百家号' },
  { id: 'sohu', label: '搜狐号' },
  { id: 'csdn', label: 'CSDN' },
  { id: 'segmentfault', label: '思否' },
  { id: 'yuque', label: '语雀' },
  { id: 'xueqiu', label: '雪球' },
  { id: 'woshipm', label: '人人都是产品经理' },
  { id: '51cto', label: '51CTO' },
  { id: 'imooc', label: '慕课手记' },
  { id: 'oschina', label: '开源中国' },
  { id: 'cnblogs', label: '博客园' },
  { id: 'eastmoney', label: '东方财富' },
  { id: 'aliyun', label: '阿里云开发者社区' },
  { id: 'xiaohongshu', label: '小红书' },
]

/** 投递状态行:dispatches 里的逐平台结果,状态点 + 平台 + 草稿链接或错误。 */
function DispatchList({ dispatches }) {
  return (
    <ul className="md-dispatch-list">
      {dispatches.map((row, index) => (
        <li key={`${row.platform}-${index}`}>
          <span className={`md-dot ${row.ok ? 'is-ok' : 'is-fail'}`} aria-hidden="true" />
          <span className="md-dispatch-platform">{t(DISPATCH_TARGETS.find(target => target.id === row.platform)?.label ?? row.platform)}</span>
          {row.ok
            ? (row.url
              ? <a href={row.url} target="_blank" rel="noreferrer">{t('打开草稿')}</a>
              : <span className="md-muted">{t('已到草稿箱')}</span>)
            : <span className="md-dispatch-error">{row.error ?? t('投递失败')}</span>}
          <time>{fmtWhen(row.at)}</time>
        </li>
      ))}
    </ul>
  )
}

/** 发布确认(工单 #9、ADR 0009/0012):一键投递给浏览器扩展(经本地助手下发);
 *  之后问一句「是否视为已发布?」——投递只到草稿箱,发布与否始终由用户确认。 */
function PublishDialog({ item, result, onClose }) {
  const [marked, setMarked] = React.useState(true)
  const [picks, setPicks] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const dispatches = item.dispatches ?? []
  const confirm = () => {
    onClose()
    if (marked) dispatchOps([{ op: 'publish_item', id: item.id }], { label: t('确认发布') })
    else toast(t('已导出发布包,还没标记发布;之后可在内容页手动改状态'))
  }
  const send = async () => {
    if (!picks.length) return
    setBusy(true)
    const data = await dispatchPublish(item.id, picks)
    setBusy(false)
    if (data) toast(t('已投递给浏览器扩展,完成后这里会亮起草稿链接'))
  }
  const toggle = (id) => {
    setPicks(current => current.includes(id) ? current.filter(row => row !== id) : [...current, id])
  }
  return (
    <Dialog title={t('发布')} onClose={onClose}>
      <div className="md-form">
        <p className="md-muted">{t('发布包(article.md + images/):{dir}', { dir: result.dir })}</p>
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
        <label className="md-check">
          <input type="checkbox" checked={marked} onChange={e => setMarked(e.target.checked)} />
          <span>{t('视为已发布(上传后只进草稿箱,状态由你确认)')}</span>
        </label>
        <div className="md-form-foot">
          <span style={{ flex: 1 }} />
          <button type="button" className="md-btn" onClick={onClose}>{t('取消')}</button>
          <button type="button" className="md-btn is-primary" onClick={confirm}>{t('完成')}</button>
        </div>
      </div>
    </Dialog>
  )
}

/** 版本列表:快照倒序,可回退(回退 = update_production 三字段,可撤销)。 */
function VersionPanel({ item, onClose }) {
  const snapshots = (item.production?.snapshots ?? []).slice().reverse()
  return (
    <div className="md-proof-versions" role="dialog" aria-label={t('版本')}>
      <header className="md-proof-versions-head">
        <h3>{t('版本')}</h3>
        <span className="md-proof-versions-meta">{t('{n} 份快照', { n: snapshots.length })}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="close" label={t('关闭')} onClick={onClose} />
      </header>
      <ul className="md-proof-version-list">
        {snapshots.map((snapshot, index) => (
          <li key={`${snapshot.at}-${index}`}>
            <span className={`md-proof-version-by ${snapshot.by === 'user' ? 'is-user' : ''}`}>
              <Icon name={snapshot.by === 'user' ? 'pen' : 'spark'} size={12} />
              {snapshot.by === 'user' ? t('人工修改中') : t('会话写回')}
            </span>
            <div className="md-proof-version-info">
              <time>{fmtWhen(snapshot.at)}</time>
              {snapshot.note ? <p>{snapshot.note}</p> : null}
              <small>{t('{n} 字', { n: textLength(snapshot.article) })}</small>
            </div>
            <button type="button" className="md-btn is-small" onClick={() => {
              dispatchOps([{ op: 'update_production', id: item.id, title: snapshot.title, coverText: snapshot.coverText, article: snapshot.article }], { label: t('回退到此版') })
              onClose()
            }}>{t('回退到此版')}</button>
          </li>
        ))}
        {!snapshots.length ? <li className="md-muted">{t('还没有快照')}</li> : null}
      </ul>
    </div>
  )
}

/** 冲突横幅:pendingWrite 存在时,在浮层顶部给出裁决三键与简版 diff。 */
function ConflictBanner({ item }) {
  const pending = item.production?.pendingWrite
  const [diff, setDiff] = React.useState(false)
  if (!pending) return null
  const sessionWords = textLength(pending.article ?? '')
  const mineWords = textLength(item.production?.article ?? '')
  const delta = sessionWords - mineWords
  return (
    <div className="md-proof-conflict" role="alert">
      <div className="md-proof-conflict-row">
        <Icon name="spark" size={14} />
        <span>{t('会话写回了新版本,与你的修改冲突')}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className={`md-btn is-small ${diff ? 'is-open' : ''}`} onClick={() => setDiff(value => !value)}>{diff ? t('收起') : t('看会话版本')}</button>
        <button type="button" className="md-btn is-small is-primary" onClick={() => { setDiff(false); dispatchOps([{ op: 'apply_write', targetId: item.id }], { label: t('接受会话版本') }) }}>{t('接受会话版本')}</button>
        <button type="button" className="md-btn is-small" onClick={() => { setDiff(false); dispatchOps([{ op: 'discard_write', targetId: item.id }], { label: t('保留我的') }) }}>{t('保留我的')}</button>
      </div>
      {diff ? (
        <div className="md-proof-diff">
          <p className="md-proof-diff-counts">
            {t('会话 {n} 字', { n: sessionWords })} · {t('当前 {n} 字', { n: mineWords })}
            {delta ? <b className={delta > 0 ? 'is-more' : 'is-less'}>{delta > 0 ? '+' : ''}{delta}</b> : null}
          </p>
          <div className="md-proof-diff-panes">
            <div className="md-proof-diff-pane">
              <header>{t('会话版本')}</header>
              <div className="md-proof-diff-scroll md-prose is-article" dangerouslySetInnerHTML={{ __html: renderMarkdown(pending.article ?? '') }} />
            </div>
            <div className="md-proof-diff-pane">
              <header>{t('当前稿件')}</header>
              <div className="md-proof-diff-scroll md-prose is-article" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.production?.article ?? '') }} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** 素材来源条:落点灵感 + 父灵感/胶囊线索,可展开。 */
function SourcesBar({ item }) {
  const state = getDesk().state
  const [open, setOpen] = React.useState(false)
  const parent = item.parentId ? state.items.find(row => row.id === item.parentId) : null
  const capsules = (state.capsules ?? EMPTY_LIST).filter(capsule => capsule.itemIds.includes(item.id))
  const clues = [
    ...(parent ? [{ label: t('分支'), text: parent.title }] : []),
    ...capsules.map(capsule => ({ label: t('胶囊'), text: capsule.name })),
  ]
  if (!parent && !capsules.length) return null
  return (
    <div className={`md-proof-sources ${open ? 'is-open' : ''}`}>
      <button type="button" className="md-proof-sources-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        <span>{t('素材来源')}</span>
        <em>{clues.length}</em>
      </button>
      {open ? (
        <ul>
          {clues.map((clue, i) => (
            <li key={i}><b>{clue.label}</b><span>{clue.text}</span></li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** 把配图插回正文流:优先放到对应小标题那一节的末尾(同原 produce 页的 ArticleBody)。 */
function ArticleFlow({ production, text, proseClass = 'md-prose' }) {
  const sections = React.useMemo(() => text.split(/\n(?=##\s)/).map(part => ({ text: part, heading: /^##\s+(.+)/.exec(part)?.[1]?.trim() ?? '' })), [text])
  const images = production?.images ?? []
  const placed = React.useMemo(() => {
    const map = new Map()
    images.forEach((image, i) => {
      if (!image.src) return
      let at = sections.findIndex(s => image.anchor && s.heading === image.anchor)
      if (at < 0) at = Math.min(sections.length - 1, Math.round(((i + 1) * sections.length) / (images.length + 1)))
      if (!map.has(at)) map.set(at, [])
      map.get(at).push({ image, i })
    })
    return map
  }, [images, sections])
  return (
    <div className="md-article">
      {sections.map((section, index) => (
        <React.Fragment key={index}>
          {/* renderMarkdown 会先转义，模型输出里的 HTML 不会执行 */}
          <div className={proseClass} dangerouslySetInnerHTML={{ __html: renderMarkdown(section.text) }} />
          {(placed.get(index) ?? []).map(({ image, i }) => (
            <figure key={i} className="md-article-figure">
              <span className="md-plate"><img src={image.src} alt={image.caption ?? ''} draggable={false} loading="lazy" /></span>
              {image.caption ? <figcaption>{image.caption}</figcaption> : null}
            </figure>
          ))}
        </React.Fragment>
      ))}
    </div>
  )
}

function Proof({ item }) {
  useLang()
  const production = item.production ?? {}
  const pendingWrite = production.pendingWrite
  const panelRef = React.useRef(null)
  const [form, setForm] = React.useState('gzh')
  const [editing, setEditing] = React.useState(false)
  const [versions, setVersions] = React.useState(false)
  const [publish, setPublish] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  // 入场:浮层从下方轻浮起来,尊重 reduced-motion(校样纸宽度切换走 CSS transition)
  React.useLayoutEffect(() => {
    if (reducedMotion()) return
    panelRef.current?.animate([{ opacity: 0, transform: 'translateY(14px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: SPRING_SNAP.duration, easing: SPRING_SNAP.easing })
  }, [])

  const article = production.article ?? ''
  const title = production.title || item.title
  const words = textLength(article)
  const pictures = [production.cover, ...(production.images ?? [])].filter(row => row?.src).length
  const userEdited = (production.snapshots ?? []).some(snapshot => snapshot.by === 'user')
  const phase = pendingWrite ? t('会话写回') : userEdited ? t('人工修改中') : t('已写回')

  const commit = (fields, label) => {
    dispatchOps([{ op: 'update_production', id: item.id, ...fields }], { label, silent: true })
  }
  const stopEditing = () => {
    setEditing(false)
  }
  const copyBody = async () => {
    try {
      await navigator.clipboard.writeText(`# ${title}\n\n${article}`)
      toast(t('正文已复制'))
    } catch (err) {
      toast(err.message, { error: true })
    }
  }
  const save = async () => {
    setSaving(true)
    await saveProduced(item.id)
    setSaving(false)
  }
  const publishExport = async () => {
    setBusy(true)
    const result = await exportForPublish(item.id)
    setBusy(false)
    if (result) setPublish(result)
  }
  const close = () => { stopEditing(); closeProof() }

  React.useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (versions || publish) return
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }) // 每次渲染重挂:闭包里拿到最新的 editing/versions/publish
  // 落点灵感被删掉或撤销掉时,收起浮层,不留空壳
  React.useEffect(() => { if (!getDesk().state?.items.some(row => row.id === item.id)) closeProof() })

  const formMeta = FORMS.find(row => row.id === form) ?? FORMS[1]
  return (
    <div className="md-proof" role="dialog" aria-modal="true" aria-label={t('校样')} onPointerDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section className="md-proof-panel" ref={panelRef}>
        <header className="md-proof-head">
          <span className={`md-phase ${pendingWrite ? 'is-conflict' : userEdited ? 'is-editing' : 'is-written'}`}>
            <Icon name={userEdited && !pendingWrite ? 'pen' : 'spark'} size={12} />
            {phase}
          </span>
          {production.finishedAt ? <time className="md-proof-when">{t('会话写回')} · {fmtWhen(production.finishedAt)}</time> : null}
          <span style={{ flex: 1 }} />
          <div className="md-seg md-proof-forms" role="radiogroup" aria-label={t('平台形态')}>
            {FORMS.map(option => (
              <button type="button" key={option.id} role="radio" aria-checked={form === option.id} className={form === option.id ? 'is-on' : ''} onClick={() => setForm(option.id)}>{t(option.label)}</button>
            ))}
          </div>
          {editing
            ? <IconButton icon="check" label={t('完成')} onClick={stopEditing} />
            : <IconButton icon="edit" label={t('直接修改')} onClick={() => setEditing(true)} />}
          <IconButton icon="close" label={t('关闭')} onClick={close} />
        </header>
        <ConflictBanner item={item} />
        <SourcesBar item={item} />
        <div className="md-proof-body">
          <article className="md-proof-paper" data-form={form} style={{ '--paper-w': `${formMeta.width}px` }}>
            <span className={`md-proof-cover ${production.cover?.src ? '' : 'is-type'}`}>
              {production.cover?.src
                ? <img src={production.cover.src} alt={production.coverText ?? title} draggable={false} />
                : <b>{production.coverText || title}</b>}
            </span>
            {editing ? (
              <InPlaceText className="md-proof-title-edit" label={t('标题')} editing value={title}
                onCommit={next => commit({ title: next }, t('修改标题'))} />
            ) : <h1 className="md-proof-title">{title}</h1>}
            <div className="md-proof-meta">
              {words ? <span><b>{words}</b>{t('字', { s: plural(words, '', 's') })}</span> : null}
              {pictures ? <span><Icon name="image" size={12} /><b>{pictures}</b>{t('张图', { s: plural(pictures, '', 's') })}</span> : null}
              {production.savedAt ? <span><Icon name="folder" size={12} />{fmtWhen(production.savedAt)}</span> : null}
              <span style={{ flex: 1 }} />
              <span className="md-proof-approx" title={t('近似预览')}>{t('近似预览')}</span>
            </div>
            {editing ? (
              <label className="md-proof-covertext">
                <span>{t('封面文案')}</span>
                <input defaultValue={production.coverText ?? ''} maxLength={40} aria-label={t('封面文案')}
                  onBlur={event => { if (event.target.value !== (production.coverText ?? '')) commit({ coverText: event.target.value }, t('修改封面文案')) }} />
              </label>
            ) : null}
            {editing ? (
              <textarea className="md-proof-article-edit" aria-label={t('修改文章')} defaultValue={article} data-form={form}
                onBlur={event => { if (event.target.value !== article) commit({ article: event.target.value }, t('修改文章')) }} />
            ) : article ? (
              <ArticleFlow production={production} text={article} />
            ) : (
              <p className="md-muted md-proof-empty">{t('这篇还没有正文。')}</p>
            )}
          </article>
        </div>
        <footer className="md-proof-foot">
          <button type="button" className="md-pill" onClick={copyBody}><Icon name="copy" size={14} />{t('复制正文')}</button>
          <button type="button" className="md-pill" onClick={save} disabled={saving}><Icon name="save" size={14} />{saving ? t('保存中…') : t('保存文件夹')}</button>
          {production.savedPath ? <IconButton icon="folder" label={t('打开保存的文件夹')} onClick={() => revealSaved(item.id)} /> : null}
          <button type="button" className="md-pill" onClick={publishExport} disabled={busy}><Icon name="upRight" size={14} />{busy ? t('导出中…') : t('发布')}</button>
          <label className="md-pill md-date-pill">
            <Icon name="calendar" size={14} />{item.scheduledAt ? fmtWhen(item.scheduledAt) : t('排期')}
            <input type="datetime-local" aria-label={t('排期')} value={toLocalInput(item.scheduledAt)} onClick={(event) => { try { event.currentTarget.showPicker() } catch { /* 不支持时用原生交互 */ } }} onChange={(event) => {
              const when = event.target.value ? new Date(event.target.value).toISOString() : null
              dispatchOps([{ op: 'schedule_item', id: item.id, scheduledAt: when }], { label: t('修改排期'), silent: true })
            }} />
          </label>
          <label className="md-pill md-proof-platform">
            <Icon name="target" size={14} />
            <select aria-label={t('去向')} value={item.platform ?? ''} onChange={event => {
              dispatchOps([{ op: 'update_item', id: item.id, platform: event.target.value || null }], { label: t('修改去向'), silent: true })
            }}>
              <option value="">{t('去向')}</option>
              {PLATFORMS.map(platform => <option key={platform} value={platform}>{t(platform)}</option>)}
            </select>
          </label>
          <span style={{ flex: 1 }} />
          <button type="button" className="md-pill" onClick={() => setVersions(value => !value)}><Icon name="clock" size={14} />{t('版本')}</button>
        </footer>
        {versions ? <VersionPanel item={item} onClose={() => setVersions(false)} /> : null}
        {publish ? <PublishDialog item={item} result={publish} onClose={() => setPublish(null)} /> : null}
      </section>
    </div>
  )
}

export function ProofOverlay() {
  const open = useDesk(s => Boolean(s.proofId))
  const item = useDesk(s => s.state?.items.find(row => row.id === s.proofId))
  if (!open || !item?.production) return null
  return <Proof key={item.id} item={item} />
}
