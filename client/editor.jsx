// 编辑界面：点开一条灵感进到这里改标题和正文。成稿入口不绑在这里，改完存盘就走工作台的操作历史。
// Markdown 编辑器是自带的：高亮、行号、查找替换、实时预览都在下面这两个组件里，不依赖第三方编辑器。
import React from 'react'
import { closeItem, dispatchOps, openProduce, setDesk, undo, useDesk } from './desk.js'
import { plural, t } from './i18n.js'
import { Icon, IconButton } from './ui.jsx'
import { SPRING_SOFT, escapeHtml, fmtDate, reducedMotion, renderMarkdown, textLength } from './util.js'

// 行内记号：先转义再包 span，跟 renderMarkdown 同一套顺序，模型或用户写的 HTML 不会执行
function inlineHtml(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, '<span class="md-ed-h-link">[$1]</span><span class="md-ed-h-url">($2)</span>')
    .replace(/`([^`]+)`/g, '<span class="md-ed-h-code">`$1`</span>')
    .replace(/\*\*([^*]+)\*\*/g, '<span class="md-ed-h-strong">**$1**</span>')
    .replace(/\*([^*]+)\*/g, '<span class="md-ed-h-em">*$1*</span>')
}

// 一行的高亮：结构记号（标题、引用、列表）整行着色，行内记号嵌在里面
function lineHtml(raw) {
  const heading = /^(#{1,4})\s+(.*)$/.exec(raw)
  if (heading) return `<span class="md-ed-h-heading"><span class="md-ed-h-mark">${escapeHtml(heading[1])}</span>${inlineHtml(heading[2])}</span>`
  if (/^>\s?/.test(raw)) return `<span class="md-ed-h-quote"><span class="md-ed-h-mark">${escapeHtml(/^>\s?/.exec(raw)[0])}</span>${inlineHtml(raw.replace(/^>\s?/, ''))}</span>`
  const list = /^(\s*(?:[-*·]|\d+\.)\s+)(.*)$/.exec(raw)
  if (list) return `<span class="md-ed-h-mark">${escapeHtml(list[1])}</span>${inlineHtml(list[2])}`
  return inlineHtml(raw) || '&nbsp;'
}

function FindBar({ value, onChange, textareaRef, scrollRef, findRef, onClose }) {
  const [find, setFind] = React.useState('')
  const [replace, setReplace] = React.useState('')
  const [index, setIndex] = React.useState(0)
  const needle = find.toLowerCase()
  const matches = React.useMemo(() => {
    if (!needle) return []
    const hay = value.toLowerCase()
    const out = []
    let at = hay.indexOf(needle)
    while (at >= 0) {
      out.push(at)
      at = hay.indexOf(needle, at + needle.length)
    }
    return out
  }, [value, needle])
  // 把第 i 个命中选中并滚到看得见的位置；高亮层每行带 data-line，软换行的行号也对得上
  const goto = (i, focus) => {
    const at = matches[i]
    if (at === undefined) return
    const el = textareaRef.current
    if (!el) return
    if (focus) el.focus({ preventScroll: true })
    el.setSelectionRange(at, at + find.length)
    const sc = scrollRef.current
    const line = sc?.querySelector(`[data-line="${value.slice(0, at).split('\n').length - 1}"]`)
    if (line && sc) {
      const top = line.offsetTop
      if (top < sc.scrollTop + 24 || top > sc.scrollTop + sc.clientHeight - 64) sc.scrollTop = Math.max(0, top - sc.clientHeight / 3)
    }
  }
  // 查找词或正文变了就停在最近的命中上，替换完光标原地不动
  React.useEffect(() => {
    if (matches.length) goto(Math.min(index, matches.length - 1), false)
    else setIndex(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches])
  const step = (delta) => {
    if (!matches.length) return
    const next = (index + delta + matches.length) % matches.length
    setIndex(next)
    goto(next, true)
  }
  const replaceCurrent = () => {
    const at = matches[index]
    if (at === undefined) return
    onChange(value.slice(0, at) + replace + value.slice(at + find.length))
  }
  const replaceAll = () => {
    if (!find) return
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    onChange(value.replace(new RegExp(escaped, 'gi'), () => replace))
  }
  const onKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      step(event.shiftKey ? -1 : 1)
    }
    if (event.key === 'Escape') {
      // 只收查找条，别把整个编辑界面关掉
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
  }
  return (
    <div className="md-ed-find" role="search" aria-label={t('查找')}>
      <Icon name="search" size={14} />
      <input ref={findRef} value={find} autoFocus onChange={e => setFind(e.target.value)} onKeyDown={onKey} placeholder={t('查找')} aria-label={t('查找')} />
      <span className="md-ed-find-count">{matches.length ? `${index + 1}/${matches.length}` : find ? '0' : ''}</span>
      <IconButton icon="chevL" label={t('上一个')} disabled={!matches.length} onClick={() => step(-1)} />
      <IconButton icon="chevR" label={t('下一个')} disabled={!matches.length} onClick={() => step(1)} />
      <input className="md-ed-find-replace" value={replace} onChange={e => setReplace(e.target.value)} onKeyDown={onKey} placeholder={t('替换')} aria-label={t('替换')} />
      <button type="button" className="md-link-btn" disabled={!matches.length} onClick={replaceCurrent}>{t('替换')}</button>
      <button type="button" className="md-link-btn" disabled={!matches.length} onClick={replaceAll}>{t('全部替换')}</button>
      <span style={{ flex: 1 }} />
      <IconButton icon="close" label={t('关闭')} onClick={onClose} />
    </div>
  )
}

/**
 * 统一的 Markdown 编辑器：标题与正文在同一块面板里改。
 * 高亮层按同样的字体排版垫在下面，正文 textarea 透明叠在上面——层高由高亮层撑开，行号用 CSS 计数器跟行走。
 */
export function MarkdownEditor({ title, onTitle, value, onChange, label, placeholder }) {
  const [findOpen, setFindOpen] = React.useState(false)
  const [preview, setPreview] = React.useState(false)
  const scrollRef = React.useRef(null)
  const textareaRef = React.useRef(null)
  const findRef = React.useRef(null)
  React.useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        setFindOpen(true)
        requestAnimationFrame(() => findRef.current?.focus())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const words = textLength(value)
  return (
    <div className="md-ed">
      <div className="md-ed-bar">
        <input className="md-ed-title" value={title} onChange={e => onTitle(e.target.value)} placeholder={t('标题')} aria-label={t('标题')} />
        <span className="md-ed-count" title={t('字数')}>{words}{t('字', { s: plural(words, '', 's') })}</span>
        <IconButton icon="search" label={t('查找')} active={findOpen} onClick={() => setFindOpen(v => !v)} />
        <IconButton icon="eye" label={t('预览')} active={preview} onClick={() => setPreview(v => !v)} />
      </div>
      {findOpen ? <FindBar value={value} onChange={onChange} textareaRef={textareaRef} scrollRef={scrollRef} findRef={findRef} onClose={() => setFindOpen(false)} /> : null}
      <div className={`md-ed-body ${preview ? 'is-preview' : ''}`}>
        <div className="md-ed-scroll" ref={scrollRef}>
          <div className="md-ed-code">
            <div className="md-ed-text md-ed-hl" aria-hidden="true">
              {value.split('\n').map((line, i) => (
                <div key={i} className="md-ed-line" data-line={i} dangerouslySetInnerHTML={{ __html: lineHtml(line) }} />
              ))}
            </div>
            <textarea ref={textareaRef} className="md-ed-text md-ed-input" value={value} onChange={e => onChange(e.target.value)} aria-label={label} placeholder={placeholder} spellCheck={false} />
          </div>
        </div>
        {preview ? <div className="md-ed-preview" aria-label={t('预览')}><div className="md-prose is-article" dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} /></div> : null}
      </div>
    </div>
  )
}

/** 编辑界面本体：保存走 ops 白名单（可撤销），Esc 关闭前自动存一次。 */
export function Editor() {
  const id = useDesk(s => s.focusId)
  const item = useDesk(s => s.state?.items.find(i => i.id === s.focusId))
  const origin = useDesk(s => s.sheetOrigin)
  const canUndo = useDesk(s => s.canUndo)
  const [title, setTitle] = React.useState('')
  const [body, setBody] = React.useState('')
  const ref = React.useRef(null)
  React.useEffect(() => {
    // 草稿跟着已保存的字段走：自己存盘后两边相等，重置是无操作；撤销或外部改动才把草稿拉回去，
    // 这样撤销不会在关闭时被未保存的旧草稿盖掉。只依赖值本身，成稿轮询重建 item 不打断输入。
    setTitle(item?.title ?? '')
    setBody(item?.body ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.title, item?.body])
  const dirty = Boolean(item) && (title !== (item.title ?? '') || body !== (item.body ?? ''))
  const save = React.useCallback(async () => {
    if (!item) return true
    const fields = {}
    // 空标题不提交：卡片总要有个名字，跟卡片上直接改标题的行为一致
    if (title !== (item.title ?? '') && title.trim()) fields.title = title
    if (body !== (item.body ?? '')) fields.body = body
    if (!Object.keys(fields).length) return true
    const data = await dispatchOps([{ op: 'update_item', id: item.id, ...fields }], { label: t('保存编辑') })
    return Boolean(data)
  }, [item, title, body])
  const close = React.useCallback(async () => {
    // 没存上就留在编辑界面，不让改动凭空消失
    if (dirty && !(await save())) return
    closeItem()
  }, [dirty, save])
  React.useEffect(() => {
    if (!id) return undefined
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        save()
        return
      }
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [id, save, close])
  // 从卡片的位置展开成整个编辑界面，和原来的浮层同一个入场
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!id || !el || reducedMotion()) return
    if (origin) {
      const box = el.getBoundingClientRect()
      const inset = `inset(${origin.y - box.top}px ${box.right - origin.x - origin.w}px ${box.bottom - origin.y - origin.h}px ${origin.x - box.left}px round 20px)`
      el.animate([{ clipPath: inset }, { clipPath: 'inset(0px 0px 0px 0px round 0px)' }], { duration: SPRING_SOFT.duration, easing: SPRING_SOFT.easing })
    } else {
      el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' })
    }
    // 只在切换灵感时播放
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  // 打开的这条被删掉或撤销掉时，退回灵感墙，不留空白页
  React.useEffect(() => { if (id && !item) closeItem() }, [id, item])
  if (!item) return null
  const remove = () => setDesk({
    dialog: {
      title: t('删除这条灵感'),
      submitLabel: t('删除'),
      fields: [],
      onSubmit: () => {
        dispatchOps([{ op: 'delete_item', id: item.id }], { label: t('删除《{title}》', { title: item.title.slice(0, 10) }) })
        closeItem()
      },
    },
  })
  return (
    <div className="md-studio md-editor" ref={ref} role="dialog" aria-label={t('编辑灵感')}>
      <header className="md-studio-head" data-window-drag="">
        <IconButton icon="chevL" label={t('返回灵感')} onClick={close} />
        <h2>{t('编辑灵感')}</h2>
        <span className="md-ed-meta">{t('灵感')} · {fmtDate(item.createdAt)}</span>
        <span style={{ flex: 1 }} />
        {canUndo ? <IconButton icon="undo" label={t('撤销上一步')} onClick={undo} /> : null}
        <IconButton icon="trash" label={t('删除这条灵感')} onClick={remove} />
        <button type="button" className="md-btn" onClick={() => openProduce(item.id)}><Icon name="bolt" size={14} />{t('去成稿')}</button>
        {dirty ? <button type="button" className="md-btn is-primary" onClick={save}>{t('保存')}</button> : null}
      </header>
      <MarkdownEditor title={title} onTitle={setTitle} value={body} onChange={setBody} label={t('灵感正文')} placeholder={t('想到什么就写什么。')} />
    </div>
  )
}
