// dsh-writing-desk 浏览器半片：侧栏入口 + main 全局面板。
// 成稿主战场在 DSH 创作会话(ADR 0006):这里注册看板、校样浮层与素材接驳条。
import React from 'react'
import { Wall as HomeView } from './wall.jsx'
import { CapsuleAdd, CapsuleView } from './capsule.jsx'
import { ContentView } from './content.jsx'
import { captureUrl, dispatchOps, EMPTY_LIST, loadDesk, previewUrl, report, setDesk, toast, undo, uploadFile, useDesk } from './desk.js'
import { DockRail } from './dock.jsx'
import { WorkEditor } from './work-editor.jsx'
import { StyleView } from './style.jsx'
import { ScheduleView } from './schedule.jsx'
import { ScheduleBox } from './schedule-form.jsx'
import { mountScheduleReminder } from './reminder.jsx'
import { SettingsDialog } from './settings.jsx'
import { setSessionWorkspace } from './session-link.js'
import { attachTakeIn } from './take-in.js'
import css from './styles.css'
import { lang, t, useLang } from './i18n.js'
import { updateUrl, useVersionInfo } from './version.js'
import { absoluteUrl, categoryOf, coverOf, extOf, fileTitle } from './util.js'
import { tagShelf } from './tags.js'
import { Dialog, FormDialog, Icon, IconButton, Menu, Toast } from './ui.jsx'

const PANEL_ID = 'writing-desk'

// navKey：同一个中文在别处意思不同（单数的“灵感”“风格”），英文导航另查一条
const NAV = [
  { id: 'home', label: '灵感', navKey: '灵感（导航）' },
  { id: 'content', label: '内容' },
  { id: 'schedule', label: '排期' },
  { id: 'style', label: '风格', navKey: '风格（导航）' },
]

const VIEWS = { home: HomeView, content: ContentView, schedule: ScheduleView, style: StyleView }

/**
 * 新增与编辑共用同一个对话框:页签只决定「从哪儿开始」,字段完全一致。
 * 版式照参考项目 StashDock 的 DesktopImportDialog:链接 / 笔记 / 文件三页签,
 * 封面可换可恢复自动,标签是带建议的 chip,重复链接先问保留还是替换。
 * 编辑态没有页签,按这条灵感自己的类型铺同一组字段;没有星标、没有「去创作」。
 */
const TAG_LIMIT = 12

/** 标签 chip 输入:回车/逗号入队,退格删最后一个,已有标签按使用次数给建议。 */
function TagField({ value, onChange, suggestions }) {
  const [draft, setDraft] = React.useState('')
  const add = (raw) => {
    const next = [...value]
    for (const part of String(raw).split(/[,，、\s]+/)) {
      const tag = part.trim().replace(/^#/, '')
      if (!tag || next.includes(tag) || next.length >= TAG_LIMIT) continue
      next.push(tag)
    }
    if (next.length !== value.length) onChange(next)
    setDraft('')
  }
  const tips = React.useMemo(() => {
    const q = draft.trim().toLowerCase()
    return suggestions
      .filter(row => !value.includes(row.tag) && (!q || row.tag.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [draft, suggestions, value])
  return (
    <div className="md-field md-tags-field">
      <span>{t('标签')}</span>
      <div className="md-tagchips">
        {value.map(tag => (
          <button type="button" key={tag} className="md-tagchip" onClick={() => onChange(value.filter(row => row !== tag))} title={t('移除标签')}>
            #{tag}<Icon name="close" size={10} />
          </button>
        ))}
        <input
          value={draft}
          placeholder={value.length >= TAG_LIMIT ? t('标签够了，{n} 个上限', { n: TAG_LIMIT }) : t('写一个，回车；或用逗号分开')}
          disabled={value.length >= TAG_LIMIT}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); add(draft) }
            if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => { if (draft.trim()) add(draft) }}
        />
      </div>
      {tips.length ? (
        <div className="md-tagtips">
          {tips.map(row => <button type="button" key={row.tag} onClick={() => add(row.tag)}>#{row.tag}</button>)}
        </div>
      ) : null}
    </div>
  )
}

/** 封面字段:和参考项目一样,先显示当前/自动抓到的封面,再给「更换」「恢复自动」。 */
function CoverField({ src, autoSrc, busy, onPick, onAuto }) {
  const shown = src || autoSrc
  return (
    <div className="md-cover-field">
      <span className={shown ? 'md-cover-box' : 'md-cover-box is-void'}>
        {shown ? <img src={absoluteUrl(shown)} alt="" referrerPolicy="no-referrer" /> : <><Icon name="image" size={20} /><small>{t('类型底图')}</small></>}
      </span>
      <div className="md-cover-meta">
        <strong>{t('封面')}</strong>
        <small>{src ? t('自己换的封面') : autoSrc ? (busy ? t('正在读页面…') : t('从页面自动抓到')) : t('没有封面时用类型底图')}</small>
        <div className="md-cover-actions">
          <button type="button" className="md-btn is-mini" disabled={busy} onClick={onPick}>{shown ? t('更换封面') : t('选一张封面')}</button>
          {src ? <button type="button" className="md-btn is-mini" onClick={onAuto}>{t('恢复自动')}</button> : null}
        </div>
      </div>
    </div>
  )
}


function CaptureDialog() {
  const capture = useDesk(s => s.capture)
  const items = useDesk(s => s.state?.items ?? EMPTY_LIST)
  const editing = capture?.mode === 'edit' ? items.find(row => row.id === capture.id) : null
  const [tab, setTab] = React.useState('note')
  const [title, setTitle] = React.useState('')
  const [text, setText] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [cover, setCover] = React.useState(null)
  const [tags, setTags] = React.useState([])
  const [rows, setRows] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [fileOver, setFileOver] = React.useState(false)
  const [peek, setPeek] = React.useState(null)
  const [peeking, setPeeking] = React.useState(false)
  const [conflict, setConflict] = React.useState(null)
  const autoTitle = React.useRef('')
  const coverInput = React.useRef(null)
  const fileInput = React.useRef(null)
  const shelf = React.useMemo(() => tagShelf(items), [items])

  // 打开时把现有内容铺进字段:编辑页签不再切换,新增总是落在笔记。
  // 只在「打开另一条 / 新开一次」时播种:items 每次写操作都会换新数组,
  // 无条件跟着 items 重跑会把用户正在输入的标题冲掉(先在排期面板里点保存就会出现)。
  const seeded = React.useRef(null)
  React.useEffect(() => {
    if (!capture) {
      seeded.current = null
      return
    }
    const key = `${capture.mode}:${capture.id ?? ''}`
    if (seeded.current === key) return
    const row = capture.mode === 'edit' ? items.find(item => item.id === capture.id) : null
    if (capture.mode === 'edit' && !row) return
    seeded.current = key
    setTab(capture.tab ?? 'note')
    setTitle(row?.title ?? '')
    setText(row?.body ?? '')
    setUrl(row?.url ?? '')
    setCover(row?.cover?.src ?? null)
    setTags([...(row?.tags ?? [])])
    setRows([])
    setPeek(null)
    setConflict(null)
    autoTitle.current = ''
  }, [capture, items])

  // 粘链接 650ms 后预读页面:标题/简介/站点名只补空着的字段,封面单独预览。
  const titleRef = React.useRef('')
  titleRef.current = title
  React.useEffect(() => {
    if (!capture || capture.mode === 'edit' || tab !== 'link') return undefined
    const value = url.trim()
    if (!/^https?:\/\/\S+\.\S+/.test(value)) {
      setPeek(null)
      setPeeking(false)
      return undefined
    }
    let alive = true
    setPeeking(true)
    const timer = setTimeout(async () => {
      const info = await previewUrl(value)
      if (!alive) return
      setPeeking(false)
      if (!info) return
      setPeek({ image: info.image, url: info.url })
      if (!titleRef.current.trim() || titleRef.current === autoTitle.current) {
        autoTitle.current = info.title || ''
        setTitle(info.title || '')
      }
      setText(current => current.trim() ? current : (info.description || ''))
    }, 650)
    return () => { alive = false; clearTimeout(timer) }
  }, [capture, tab, url])

  if (!capture) return null
  if (capture.mode === 'edit' && !editing) return null
  const category = editing ? categoryOf(editing) : null
  const close = () => setDesk({ capture: null })
  const editingCategory = category ?? tab
  const autoCover = editing ? coverOf(editing) : peek?.image ?? null

  const pickCover = () => coverInput.current?.click()
  const takeCover = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const info = await uploadFile(file)
      setCover(info.src)
    } catch (err) {
      report(err)
    }
  }
  // 文件页签不限个数与合计体积(单个上限由宿主给)；选择器和拖进来走同一条路
  const pushFiles = (picked) => {
    if (!picked.length) return
    setRows(list => [...list, ...picked.map((file, index) => ({ key: `${file.name}:${file.size}:${list.length + index}`, file, title: fileTitle(file.name), body: '' }))])
  }
  const takeFiles = (event) => {
    const picked = [...(event.target.files ?? [])]
    event.target.value = ''
    pushFiles(picked)
  }
  const takeFileDrop = (event) => {
    event.preventDefault()
    setFileOver(false)
    pushFiles([...(event.dataTransfer?.files ?? [])])
  }
  const patchRow = (key, patch) => setRows(list => list.map(row => row.key === key ? { ...row, ...patch } : row))

  const save = async (event) => {
    event?.preventDefault?.()
    if (busy || conflict) return
    if (editing) {
      setBusy(true)
      const fields = { title: title.trim(), body: text.trim(), tags, cover: cover ? { src: cover } : (editing.cover ? null : undefined) }
      if (category === 'link') fields.url = url.trim() || undefined
      await dispatchOps([{ op: 'update_item', id: editing.id, ...fields }], { label: t('改好灵感') })
      setBusy(false)
      close()
      return
    }
    if (tab === 'link') {
      if (!url.trim()) return
      const target = url.trim().replace(/\/+$/, '')
      const dup = items.find(row => (row.url || '').replace(/\/+$/, '') === target)
      // 同一个链接再收一次:先问保留原有还是替换(参考项目的重复链接选择)
      if (dup) { setConflict(dup); return }
      setBusy(true)
      const id = await captureUrl(url.trim(), {
        title: title.trim() || undefined,
        note: text.trim() || undefined,
        tags,
        contentOrigin: 'user',
      })
      if (id && cover) await dispatchOps([{ op: 'update_item', id, cover: { src: cover } }], { label: t('换封面') })
      setBusy(false)
      if (id) close()
      return
    }
    if (tab === 'file') {
      if (!rows.length) return
      setBusy(true)
      let failed = 0
      for (const row of rows) {
        try {
          const info = await uploadFile(row.file)
          await dispatchOps([{
            op: 'add_item', kind: info.kind,
            title: row.title.trim() || fileTitle(row.file.name),
            body: row.body.trim() || undefined,
            tags,
            media: { src: info.src, name: row.file.name },
          }], { label: t('收藏 {title}', { title: row.title.trim() || row.file.name }), silent: true })
        } catch (err) {
          failed += 1
          report(err)
        }
      }
      setBusy(false)
      if (failed) toast(t('{n} 个文件没传上去', { n: failed }), { error: true })
      else { toast(t('已放到灵感墙'), { undo: true }); close() }
      return
    }
    const value = text.trim()
    if (!value) return
    setBusy(true)
    // 标题留空就沿用老规则:取第一句当名字
    const auto = value.split(/[。！？\n]|[.!?](?=\s|$)/)[0].slice(0, 40)
    await dispatchOps([{ op: 'add_item', kind: 'note', title: title.trim() || auto, body: value, tags, cover: cover ? { src: cover } : undefined, contentOrigin: 'user' }], { label: t('记下灵感') })
    setBusy(false)
    close()
  }

  const remove = async () => {
    if (!editing) return
    await dispatchOps([{ op: 'delete_item', id: editing.id }], { label: t('删除灵感') })
    close()
  }

  // 替换已收过的链接:改原来那条,不新增卡片
  const replace = async (dup) => {
    if (busy) return
    setBusy(true)
    await dispatchOps([{
      op: 'update_item',
      id: dup.id,
      title: title.trim() || dup.title,
      body: text.trim() || dup.body,
      url: url.trim(),
      tags,
      cover: cover ? { src: cover } : undefined,
    }], { label: t('替换链接') })
    setBusy(false)
    close()
  }

  const tabs = [['note', t('笔记')], ['link', t('链接')], ['file', t('文件')]]
  const wide = 600
  return (
    <Dialog title={editing ? t('编辑灵感') : t('记下一个灵感')} onClose={close} width={wide} className="is-capture">
      {editing ? null : (
        <div className="md-capture-tabs" role="tablist">
          {tabs.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
        </div>
      )}
      <form className="md-form md-capture-form" onSubmit={save}>
        {tab === 'file' && !editing ? (
          <>
            <button
              type="button"
              className={`md-dropzone ${fileOver ? 'is-over' : ''}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => { event.preventDefault(); setFileOver(true) }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFileOver(false) }}
              onDrop={takeFileDrop}
            >
              <Icon name="upload" size={22} />
              <span>{t('选择文件，或把文件拖进来')}</span>
              <small>{t('图片、视频、文档都行；个数不限，单个上限 250MB')}</small>
            </button>
            <input ref={fileInput} type="file" hidden multiple onChange={takeFiles} />
            {rows.length ? (
              <div className="md-file-list">
                {rows.map(row => (
                  <div className="md-file-row" key={row.key}>
                    <span className="md-file-badge">{extOf(row.file.name) || <Icon name="folder" size={16} />}</span>
                    <div className="md-file-fields">
                      <input value={row.title} aria-label={t('标题')} onChange={e => patchRow(row.key, { title: e.target.value })} placeholder={t('标题')} />
                      <textarea rows={2} value={row.body} aria-label={t('说明')} onChange={e => patchRow(row.key, { body: e.target.value })} placeholder={t('这条素材用在哪里、为什么值得留（可留空）')} />
                    </div>
                    <IconButton icon="close" label={t('移除')} size={13} onClick={() => setRows(list => list.filter(entry => entry.key !== row.key))} />
                  </div>
                ))}
              </div>
            ) : null}
            <TagField value={tags} onChange={setTags} suggestions={shelf} />
          </>
        ) : (
          <>
            <input ref={coverInput} type="file" hidden accept="image/*" onChange={takeCover} />
            {editingCategory !== 'file' || cover || autoCover ? (
              <CoverField src={cover} autoSrc={autoCover} busy={peeking} onPick={pickCover} onAuto={() => setCover(null)} />
            ) : null}
            {editingCategory === 'link' ? (
              <label className="md-field">
                <span>{t('链接')}</span>
                <input type="url" required value={url} onChange={e => { setUrl(e.target.value); setConflict(null) }} placeholder="https://" />
                {editing ? null : <small>{peeking ? t('正在读页面…') : t('会自动读取页面的标题、简介和封面。')}</small>}
              </label>
            ) : null}
            {conflict ? (
              <div className="md-conflict" role="alert">
                <div>
                  <strong>{t('这个链接已经收过。')}</strong>
                  <small>{conflict.title || conflict.url}</small>
                </div>
                <div className="md-conflict-actions">
                  <button type="button" className="md-btn" onClick={() => setConflict(null)}>{t('保留原有')}</button>
                  <button type="button" className="md-btn is-primary" disabled={busy} onClick={() => replace(conflict)}>{t('替换链接')}</button>
                </div>
              </div>
            ) : null}
            <div className="md-field md-title-field">
              <label htmlFor="md-item-title">{t('标题')}</label>
              <div className="md-title-line">
                <input id="md-item-title" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('留空就自动取名')} />
                {editing ? <ScheduleBox item={editing} /> : null}
              </div>
            </div>
            {editingCategory === 'link' ? (
              <label className="md-field">
                <span>{t('简介')}</span>
                <textarea rows={4} value={text} onChange={e => setText(e.target.value)} placeholder={t('页面说了什么，为什么值得留。')} />
              </label>
            ) : (
              <label className="md-field">
                <span>{editingCategory === 'file' ? t('说明') : t('想法')}</span>
                <textarea rows={6} required={!editing && tab === 'note'} value={text} onChange={e => setText(e.target.value)} placeholder={editingCategory === 'file' ? t('这条素材用在哪里、为什么值得留。') : t('想到什么就写什么。')} />
              </label>
            )}
            <TagField value={tags} onChange={setTags} suggestions={shelf} />
          </>
        )}
        <div className="md-form-foot">
          {editing ? <button type="button" className="md-btn is-danger" onClick={remove}><Icon name="trash" size={13} />{t('删除这条灵感')}</button> : null}
          <span className="md-grow" />
          <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
          <button type="submit" className="md-btn is-primary" disabled={busy || !!conflict || (tab === 'file' && !editing && !rows.length)}>
            {busy ? t('保存中…') : editing ? t('保存') : t('放到灵感墙')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}


function UpdateBadge() {
  const info = useVersionInfo()
  const href = updateUrl(info)
  if (!href) return null
  return (
    <a className="md-update" href={href} target="_blank" rel="noreferrer" title={t('新版本 {version} 已发布，点击查看更新说明', { version: info.latest })}>
      ↑ v{info.latest}
    </a>
  )
}

function SampleBadge() {
  const hasSample = useDesk(s => ['items', 'capsules', 'works', 'people', 'angles', 'skills', 'styles']
    .some(key => s.state[key]?.some(row => row.sample)))
  if (!hasSample) return null
  return (
    <button type="button" className="md-sample" aria-label={t('清空示例数据')} title={t('清空全部示例数据，保留你的内容')} onClick={() => setDesk({
      dialog: {
        title: t('清空示例数据'),
        submitLabel: t('清空'),
        fields: [{ name: 'confirmation', type: 'hidden', label: t('将删除全部示例灵感、胶囊和作品；你的内容会保留。') }],
        onSubmit: () => dispatchOps([{ op: 'clear_samples' }], { label: t('清空示例数据') }),
      },
    })}><Icon name="trash" size={14} /><span>{t('清空示例数据')}</span></button>
  )
}

function Desk() {
  // 切换语言时整棵树重新渲染
  useLang()
  const ready = useDesk(s => Boolean(s.state))
  const error = useDesk(s => s.error)
  const view = useDesk(s => s.view)
  const canUndo = useDesk(s => s.canUndo)
  const rootRef = React.useRef(null)
  const [width, setWidth] = React.useState(1600)
  const narrow = width < 1020

  React.useEffect(() => { loadDesk() }, [])
  // 工作台内任意处：粘贴或拖进文件即收下；日历日格与胶囊浮层会先一步接管自己的落点
  React.useEffect(() => {
    if (!rootRef.current) return undefined
    return attachTakeIn(rootRef.current)
  }, [])
  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  React.useEffect(() => {
    const onKey = (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey && !typing && canUndo) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canUndo])

  const Active = VIEWS[view] ?? HomeView
  return (
    <div className={`md-root ${narrow ? 'is-narrow' : ''} ${width < 780 ? 'is-compact' : ''}`} ref={rootRef}>
      <style>{css}</style>
      <div className="md-ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="md-main">
        <header className="md-topbar" data-window-drag="">
          <nav className="md-nav" aria-label={t('工作台导航')}>
            {NAV.map(entry => (
              <button type="button" key={entry.id} className={view === entry.id ? 'is-on' : ''} aria-current={view === entry.id ? 'page' : undefined} onClick={() => setDesk({ view: entry.id, workId: null, selection: null })}>
                {entry.navKey && lang() === 'en' ? t(entry.navKey) : t(entry.label)}
              </button>
            ))}
          </nav>
          <span className="md-grow" />
          {ready ? <UpdateBadge /> : null}
          {ready ? <SampleBadge /> : null}
          <IconButton icon="gear" label={t('设置')} onClick={() => setDesk({ settingsOpen: true })} />
        </header>
        <main className="md-content" key={view}>
          {error ? (
            <div className="md-page"><p className="md-muted">{t('工作台加载失败：{error}', { error })}</p><button type="button" className="md-btn" onClick={loadDesk}>{t('重试')}</button></div>
          ) : ready ? <Active /> : <div className="md-loading"><span className="md-shimmer">{t('正在铺开灵感…')}</span></div>}
        </main>
      </div>
      {ready ? <CaptureDialog /> : null}
      <FormDialog />
      {ready ? <CapsuleView /> : null}
      {ready ? <CapsuleAdd /> : null}
      {ready ? <SettingsDialog /> : null}
      {/* 作品编辑器由 desk store 的 workId 门控,常挂载——内容页作品卡与签收栏都点开它 */}
      <WorkEditor />
      <Menu />
      <Toast />
    </div>
  )
}

function PanelIcon({ size }) {
  return <Icon name="scatter" size={size} />
}

export const inject = ['slots', 'layout']

export function apply(ctx) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Desk))
  mountComposerDock(ctx)
  mountWorkspace(ctx)
  mountBetterSidebar(ctx)
  mountScheduleReminder(ctx, PANEL_ID)
}

/**
 * 素材接驳条挂进宿主对话输入区下方的 dock 槽位。宿主当前叫
 * conversation.input.dock，旧版本叫 conversation.composer.dock；
 * 两个名字都尝试注入，不存在的槽位会抛错或永不回调，各自 try/catch。
 * 宿主一个都没有(或 slots.inject 不存在)时静默跳过——降级为纯看板。
 */
function mountComposerDock(ctx) {
  if (typeof ctx.slots?.inject !== 'function') return
  const slots = ['conversation.input.dock', 'conversation.composer.dock']
  for (const name of slots) {
    try {
      ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'writing-desk-dock' }, DockRail))
    } catch (error) {
      console.warn('[dsh-writing-desk] composer dock skipped:', name, error)
    }
  }
}

/**
 * 能力检测(ADR 0006 宿主版本):uiWorkspace 是软依赖,拿不到时
 * 「去创作会话」降级为 toast,看板与校样浮层照常可用。
 */
function mountWorkspace(ctx) {
  const register = (inner) => {
    const workspace = inner.uiWorkspace ?? inner.get?.('uiWorkspace')
    setSessionWorkspace(workspace)
  }
  try {
    if (typeof ctx.inject === 'function') ctx.inject(['uiWorkspace'], register)
    else register(ctx)
  } catch (error) {
    console.warn('[dsh-writing-desk] uiWorkspace unavailable:', error)
    setSessionWorkspace(null)
  }
}

/**
 * 入口只挂在右侧栏（dsh-better-sidebar 的页面槽位）：左侧栏不再注册，避免同一个工作台
 * 在两处重复出现。没装 better-sidebar 就什么都不做——它是软依赖，不进顶层的 inject。
 */
function mountBetterSidebar(ctx) {
  const register = inner => {
    const sidebar = inner.betterSidebar ?? inner.get?.('betterSidebar')
    if (typeof sidebar?.registerTab !== 'function') return
    inner.effect(() => sidebar.registerTab({
      id: `${PANEL_ID}:workbench`,
      title: () => t('图文创作台'),
      description: () => t('灵感、内容、排期、风格'),
      icon: size => <PanelIcon size={size} />,
      order: 60,
      single: true,
      component: Desk,
    }), 'dsh-writing-desk: better-sidebar tab')
  }
  try {
    // 服务晚于我们就绪、或者中途被卸掉再装回，子作用域都会跟着重来
    if (typeof ctx.inject === 'function') ctx.inject(['betterSidebar'], register)
    else register(ctx)
  } catch (error) {
    console.warn('[dsh-writing-desk] better-sidebar tab skipped:', error)
  }
}
