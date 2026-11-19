// 素材接驳条(ADR 0006):conversation.composer.dock 槽位里的落点。
// 平时近无(4px 占位);素材拖起时淡入虚线行;拖近转实线内衬;落手后弹素材签,
// 整个浮层唯一的「作者时刻」。落点就是接驳条——宿主红线决定做不了全对话区高亮。
import React from 'react'
import { claimPendingReference, endRefDrag, hasPendingReference, referenceIntoDraft, registerDockRect, setComposer } from './session-link.js'
import { t } from './i18n.js'

// 四态:dormant(近无) → listening(虚线行) → armed(实线内衬) → landed(签条) → 3s 后回落
const LANDED_MS = 3000
const CHIP_SLOTS = 4

export function DockRail(props) {
  const inputActions = props?.inputActions
  const useInput = props?.useInput
  // 草稿镜像:setDraft 是整段替换,追加前必须能读到现有文字。
  // useInput 是 hook,只能在渲染期调用;镜像存进 ref,sessionLink 落手时读。
  const draft = typeof useInput === 'function' ? useInput(s => s.draft) : null
  const draftRef = React.useRef(null)
  draftRef.current = draft
  const [phase, setPhase] = React.useState('dormant')
  const [chips, setChips] = React.useState([])
  const timerRef = React.useRef(0)
  const refRef = React.useRef(null)
  const elRef = React.useRef(null)

  React.useEffect(() => {
    const handle = {
      setDraft: text => inputActions?.setDraft?.(String(text ?? '')),
      // 引用签:宿主 inputActions.insertQuote(text, summary) 把素材插进输入框,
      // summary 可在 composer 里悬浮展开标题/详情;旧宿主没有它,退回 setDraft。
      insertQuote: typeof inputActions?.insertQuote === 'function'
        ? (text, summary) => inputActions.insertQuote(String(text ?? ''), summary)
        : null,
      submitAvailable: typeof inputActions?.submit === 'function',
      getDraft: () => draftRef.current,
    }
    setComposer(handle)
    // 画布拖拽在松手时问 overDock:登记矩形读取器,卸载时归还
    registerDockRect(() => elRef.current?.getBoundingClientRect() ?? null)
    // 「创作」打开的会话:startSession 只能带纯文本,prompt 里的引用块要等这个
    // 会话的输入面挂载后换成引用签。编辑器可能晚一拍,短暂退避重试。
    let claimTimer = 0
    let claimTries = 0
    const claim = () => {
      if (claimPendingReference(handle)) return
      if (!hasPendingReference()) return
      claimTries += 1
      if (claimTries < 5) claimTimer = setTimeout(claim, claimTries * 120)
    }
    claim()
    return () => {
      clearTimeout(claimTimer)
      setComposer(null)
      registerDockRect(null)
    }
  }, [inputActions])

  const land = React.useCallback((entries) => {
    const entry = referenceIntoDraft(entries)
    if (!entry) return false
    const all = [
      ...entry.items.map(item => item.title),
      ...entry.capsules.map(capsule => `${capsule.name} · ${capsule.count}`),
    ]
    setChips([...all.slice(0, CHIP_SLOTS), ...(all.length > CHIP_SLOTS ? [`+${all.length - CHIP_SLOTS}`] : [])].map(label => ({ label, rest: /^\+/.test(label) && all.length > CHIP_SLOTS })))
    setPhase('landed')
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { setPhase('dormant'); setChips([]) }, LANDED_MS)
    return true
  }, [])

  React.useEffect(() => {
    const inside = (event) => {
      const rect = elRef.current?.getBoundingClientRect()
      return Boolean(rect) && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom
    }
    const takeLanding = (ids) => {
      if (!ids) return
      refRef.current = null
      land(ids)
    }
    const onDragStart = (event) => { refRef.current = event.detail?.ids ?? null; setPhase('listening') }
    const onDragEnd = () => {
      refRef.current = null
      setPhase(p => (p === 'landed' ? p : 'dormant'))
    }
    // 指针拖拽(画布建胶囊同一路)没有原生 drop:捕获阶段先于画布的 pointerup 判定落点
    const onPointerUp = (event) => {
      if (phase !== 'listening' && phase !== 'armed') return
      if (!inside(event)) return
      const ids = refRef.current
      endRefDrag()
      takeLanding(ids)
    }
    const onPointerMove = (event) => {
      if (phase !== 'listening' && phase !== 'armed') return
      setPhase(inside(event) ? 'armed' : 'listening')
    }
    // HTML5 拖拽没落在接驳条上时收回落点提示(源元素上的 dragend / 别处的 drop)
    const resetHtml5 = () => setPhase(p => (p === 'landed' ? p : p === 'armed' || p === 'listening' ? 'dormant' : p))
    // 跨面板的 HTML5 拖入(如内容页看板卡):整个窗口里认到我们的类型就把接驳条亮起来
    const onWindowDragOver = (event) => {
      if (phase === 'landed') return
      if (collectDataTransfer(event.dataTransfer, true)) setPhase(p => (p === 'dormant' ? 'listening' : p))
    }
    window.addEventListener('wd-ref-dragstart', onDragStart)
    window.addEventListener('wd-ref-dragend', onDragEnd)
    window.addEventListener('dragend', resetHtml5)
    window.addEventListener('drop', resetHtml5, true)
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointermove', onPointerMove, true)
    return () => {
      clearTimeout(timerRef.current)
      window.removeEventListener('wd-ref-dragstart', onDragStart)
      window.removeEventListener('wd-ref-dragend', onDragEnd)
      window.removeEventListener('dragend', resetHtml5)
      window.removeEventListener('drop', resetHtml5, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointermove', onPointerMove, true)
    }
  }, [phase, land])

  return (
    <div
      ref={elRef}
      className={`md-dock is-${phase}`}
      data-composer-dock-entry="writing-desk"
      onDragOver={(event) => {
        if (!collectDataTransfer(event.dataTransfer, true) && !refRef.current) return
        event.preventDefault()
        setPhase('armed')
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        setPhase(p => (p === 'armed' ? 'listening' : p))
      }}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        const ids = refRef.current ?? collectDataTransfer(event.dataTransfer)
        endRefDrag()
        takeLanding(ids)
      }}
    >
      {phase === 'landed' ? (
        <div className="md-dock-chips">
          {chips.map((chip, i) => <span key={i} className={`md-ref-chip ${chip.rest ? 'is-rest' : ''}`}>{chip.label}</span>)}
        </div>
      ) : phase !== 'dormant' ? <span className="md-dock-hint">{t('拖到这里，把素材写进对话')}</span> : null}
    </div>
  )
}

/** HTML5 拖入:从 dataTransfer 里认灵感/胶囊 ID;types 检查只问有没有,不提前读值。 */
function collectDataTransfer(dt, typesOnly = false) {
  if (!dt) return null
  const types = [...(dt.types ?? [])]
  const hasRefs = types.includes('application/x-writing-desk-items')
  const hasItem = types.includes('text/writing-desk-item')
  const hasCapsule = types.includes('text/writing-desk-capsule')
  if (!hasRefs && !hasItem && !hasCapsule) return null
  if (typesOnly) return {}
  let ids = []
  if (hasRefs) {
    try {
      const parsed = JSON.parse(dt.getData('application/x-writing-desk-items'))
      if (Array.isArray(parsed)) ids = parsed
    } catch { /* 旧格式兜底 */ }
  }
  ids = ids.concat(
    ...(dt.getData('text/writing-desk-item') || '').split('\n'),
    ...(dt.getData('text/writing-desk-capsule') || '').split('\n'),
  )
  ids = ids.map(row => String(row || '').trim()).filter(Boolean)
  return ids.length ? { itemIds: ids } : null
}
