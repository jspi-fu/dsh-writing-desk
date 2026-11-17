// dsh-writing-desk 浏览器半片：侧栏入口 + main 全局面板。
// 成稿主战场在 DSH 创作会话(ADR 0006):这里注册看板、校样浮层与素材接驳条。
import React from 'react'
import { HomeView } from './canvas.jsx'
import { CapsuleView } from './capsule.jsx'
import { ContentView } from './content.jsx'
import { captureFiles, captureUrl, dispatchOps, loadDesk, setDesk, undo, useDesk } from './desk.js'
import { DockRail } from './dock.jsx'
import { Editor } from './editor.jsx'
import { ProofOverlay } from './proof.jsx'
import { RetagDialog } from './retag.jsx'
import { StyleView } from './style.jsx'
import { ScheduleView } from './schedule.jsx'
import { SettingsDialog } from './settings.jsx'
import { setSessionWorkspace } from './session-link.js'
import css from './styles.css'
import { lang, t, useLang } from './i18n.js'
import { updateUrl, useVersionInfo } from './version.js'
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

function CaptureDialog() {
  const capture = useDesk(s => s.capture)
  const [tab, setTab] = React.useState('text')
  const [title, setTitle] = React.useState('')
  const [text, setText] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [source, setSource] = React.useState('')
  const [tags, setTags] = React.useState('')
  const [origin, setOrigin] = React.useState('user')
  const [busy, setBusy] = React.useState(false)
  const fileInput = React.useRef(null)
  React.useEffect(() => {
    if (!capture) return
    setTab(capture.tab ?? 'text')
    setTitle('')
    setText('')
    setUrl('')
    setSource('')
    setTags('')
    setOrigin('user')
  }, [capture])
  if (!capture) return null
  const close = () => setDesk({ capture: null })
  const tagList = tags.split(/[,，、\s]+/).filter(Boolean)
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    if (tab === 'link' && url.trim()) {
      const id = await captureUrl(url.trim(), { title: title.trim() || undefined, source: source.trim() || undefined, tags: tagList, contentOrigin: origin })
      if (id) close()
    } else if (tab === 'quote' || tab === 'text') {
      const value = text.trim()
      if (value) {
        // 标题留空就沿用老规则自动取名；金句没有单独标题时正文照旧放在标题里显示
        const autoTitle = tab === 'quote' ? value : value.split(/[。！？\n]|[.!?](?=\s|$)/)[0].slice(0, 40)
        await dispatchOps([{ op: 'add_item', kind: tab === 'quote' ? 'quote' : 'note', title: title.trim() || autoTitle, body: tab === 'quote' && !title.trim() ? '' : value, source: source.trim() || undefined, tags: tagList, contentOrigin: origin }], { label: t('记下灵感') })
        close()
      }
    }
    setBusy(false)
  }
  const tabs = [['text', t('笔记')], ['quote', t('金句')], ['link', t('链接')], ['file', t('图片/视频')]]
  return (
    <Dialog title={t('记下一个灵感')} onClose={close} width={480}>
      <div className="md-capture-tabs" role="tablist">
        {tabs.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <form className="md-form" onSubmit={save}>
        {tab === 'link' ? (
          <>
            <label className="md-field">
              <span>{t('链接')}</span>
              <input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" />
              <small>{t('会自动读取页面的标题、简介和封面。')}</small>
            </label>
            <label className="md-field">
              <span>{t('标题')}</span>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('留空就自动取名')} />
            </label>
          </>
        ) : tab === 'file' ? (
          <button type="button" className="md-dropzone" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={22} />
            <span>{t('选择图片或视频')}</span>
            <small>{t('也可以直接把文件拖到灵感墙上')}</small>
            <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={async (e) => { const files = [...e.target.files]; close(); await captureFiles(files) }} />
          </button>
        ) : (
          <>
            <label className="md-field">
              <span>{tab === 'quote' ? t('这句话') : t('想法')}</span>
              <textarea rows={4} required value={text} onChange={e => setText(e.target.value)} placeholder={tab === 'quote' ? t('好的选题不是想出来的……') : t('想到什么就写什么。')} />
            </label>
            <label className="md-field">
              <span>{t('标题')}</span>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('留空就自动取名')} />
            </label>
          </>
        )}
        {tab === 'file' ? null : (
          <>
            <div className="md-field-row">
              <label className="md-field">
                <span>{t('来源')}</span>
                <input value={source} onChange={e => setSource(e.target.value)} placeholder={t('哪里看到的？')} />
              </label>
              <label className="md-field">
                <span>{t('标签')}</span>
                <input value={tags} onChange={e => setTags(e.target.value)} placeholder={t('用逗号分开')} />
              </label>
            </div>
            <div className="md-field" role="radiogroup" aria-label={t('来源类型')}>
              <span>{t('来源类型')}</span>
              <div className="md-seg">
                {[['user', t('我写的')], ['ai', t('AI 生成的')]].map(([value, label]) => (
                  <button type="button" key={value} role="radio" aria-checked={origin === value} className={origin === value ? 'is-on' : ''} onClick={() => setOrigin(value)}>{label}</button>
                ))}
              </div>
            </div>
            <div className="md-form-foot">
              <span style={{ flex: 1 }} />
              <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
              <button type="submit" className="md-btn is-primary" disabled={busy}>{busy ? t('保存中…') : t('放到灵感墙')}</button>
            </div>
          </>
        )}
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
  const hasSample = useDesk(s => s.state.items.some(i => i.sample))
  if (!hasSample) return null
  return (
    <button type="button" className="md-sample" title={t('现在看到的内容都是示例，可以一键清空')} onClick={() => setDesk({
      dialog: {
        title: t('清空示例数据'),
        submitLabel: t('清空'),
        fields: [],
        onSubmit: () => dispatchOps([{ op: 'clear_samples' }], { label: t('清空示例数据') }),
      },
    })}>{t('示例数据 · 清空')}</button>
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
              <button type="button" key={entry.id} className={view === entry.id ? 'is-on' : ''} aria-current={view === entry.id ? 'page' : undefined} onClick={() => setDesk({ view: entry.id, focusId: null, proofId: null, selection: null })}>
                {entry.navKey && lang() === 'en' ? t(entry.navKey) : t(entry.label)}
              </button>
            ))}
          </nav>
          <span style={{ flex: 1 }} />
          {ready ? <SampleBadge /> : null}
          {canUndo ? <IconButton icon="undo" label={t('撤销上一步')} onClick={undo} /> : null}
          {ready ? <UpdateBadge /> : null}
          <IconButton icon="gear" label={t('设置')} onClick={() => setDesk({ settingsOpen: true })} />
        </header>
        <main className="md-content" key={view}>
          {error ? (
            <div className="md-page"><p className="md-muted">{t('工作台加载失败：{error}', { error })}</p><button type="button" className="md-btn" onClick={loadDesk}>{t('重试')}</button></div>
          ) : ready ? <Active /> : <div className="md-loading"><span className="md-shimmer">{t('正在铺开灵感…')}</span></div>}
        </main>
        {ready ? <Editor /> : null}
      </div>
      {ready ? <CaptureDialog /> : null}
      <FormDialog />
      {ready ? <CapsuleView /> : null}
      {ready ? <RetagDialog /> : null}
      {ready ? <SettingsDialog /> : null}
      {/* 校样浮层由 desk store 的 proofId 门控,常挂载——内容页成稿卡与签收栏都点开它 */}
      <ProofOverlay />
      <Menu />
      <Toast />
    </div>
  )
}

function PanelIcon({ size }) {
  return <Icon name="scatter" size={size} />
}

export const inject = ['slots']

export function apply(ctx) {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Desk))
  mountComposerDock(ctx)
  mountWorkspace(ctx)
  mountBetterSidebar(ctx)
}

/**
 * 素材接驳条挂进宿主对话输入区下方的 conversation.composer.dock 槽位。
 * 旧宿主没有这个槽位(或 slots.inject 不存在)时整段静默跳过——降级为纯看板。
 */
function mountComposerDock(ctx) {
  try {
    if (typeof ctx.slots?.inject !== 'function') return
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
      name: 'conversation.composer.dock', id: 'writing-desk-dock',
    }, DockRail))
  } catch (error) {
    console.warn('[dsh-writing-desk] composer dock skipped:', error)
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
