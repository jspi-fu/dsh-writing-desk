// 素材接驳条(ADR 0006/0007):conversation.input.dock 槽位里的落点。
// 平时近无(4px 占位);素材拖起时淡入虚线行;拖近转实线内衬;落手走「添加到当前会话」同一条路,
// 引用签由宿主草稿插进去,接驳条自己不再画签条,整个浮层唯一的「作者时刻」。
import React from 'react'
import { addReferenceToCurrentSession, claimPendingReference, endRefDrag, hasPendingReference, registerDockRect, setComposer } from './session-link.js'
import { t, useLang } from './i18n.js'
import css from './dock.css'

// 三态:dormant(近无) → listening(虚线行) → armed(实线内衬) → 落手回到 dormant。
// 落手的表现交给「添加到当前会话」同一条路(引用签插进草稿),接驳条自己不再画签条。

/**
 * 落点的真实范围:接驳条 + 它所在的那块输入卡。
 * 用户拖素材的自然目标是输入框本身,只认下面 36px 的虚线行等于让人对着空气松手;
 * 往上找到第一层「包含输入卡」的祖先。碰到整列(超过视口 60%)就退回接驳条,
 * 别把整片对话区都变成落点。
 */
function zoneRectOf(dock) {
  if (!dock) return null
  const own = dock.getBoundingClientRect()
  let node = dock.parentElement
  while (node && node !== document.body) {
    const rect = node.getBoundingClientRect()
    if (rect.height > window.innerHeight * 0.6) break
    if (rect.height >= own.height + 24) return unionRect(own, rect)
    node = node.parentElement
  }
  // 认不出输入卡的大小时,至少把接驳条上方一段算作落点,别让用户去瞄 4px 的虚线
  const reach = Math.min(Math.max(240, (own.height || 4) * 8), window.innerHeight * 0.4, Math.max(own.top, 0))
  return { left: own.left, right: own.right, top: own.top - reach, bottom: own.bottom }
}

function unionRect(a, b) {
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
  }
}

function pointIn(rect, event) {
  return Boolean(rect) && event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom
}

export function DockRail(props) {
  // 接驳条与提醒横幅一样挂在主树之外可达,切换语言自己跟
  useLang()
  const inputActions = props?.inputActions
  const useInput = props?.useInput
  // 草稿镜像:setDraft 是整段替换,追加前必须能读到现有文字。
  // useInput 是 hook,只能在渲染期调用;镜像存进 ref,sessionLink 落手时读。
  const draft = typeof useInput === 'function' ? useInput(s => s.draft) : null
  const draftRef = React.useRef(null)
  draftRef.current = draft
  const [phase, setPhase] = React.useState('dormant')
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
    registerDockRect(() => zoneRectOf(elRef.current))
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

  // 落手与「添加到当前会话」按钮同一条路:引用签逐条插进草稿,不必先合成一段文字再整段替换草稿。
  const land = React.useCallback((entries) => {
    return Boolean(addReferenceToCurrentSession(entries))
  }, [])

  React.useEffect(() => {
    // 落点判定用放大后的范围:接驳条 + 输入卡
    const inside = (event) => pointIn(zoneRectOf(elRef.current), event)
    const takeLanding = (ids) => {
      if (!ids) return
      refRef.current = null
      land(ids)
      setPhase('dormant')
    }
    const onDragStart = (event) => { refRef.current = event.detail?.ids ?? null; setPhase('listening') }
    const onDragEnd = () => {
      refRef.current = null
      setPhase('dormant')
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
    // HTML5 拖拽没落在输入卡上时收回落点提示(源元素上的 dragend / 别处的 drop)
    const resetHtml5 = () => setPhase(p => (p === 'armed' || p === 'listening' ? 'dormant' : p))
    // 跨面板的 HTML5 拖入(如内容页看板卡):整个窗口里认到我们的类型就把接驳条亮起来;
    // 指针已经压到输入卡上时直接点亮为落点——并 preventDefault,否则输入框里根本收不到 drop
    const onWindowDragOver = (event) => {
      if (!collectDataTransfer(event.dataTransfer, true)) return
      if (pointIn(zoneRectOf(elRef.current), event)) {
        event.preventDefault()
        setPhase('armed')
        return
      }
      setPhase(p => (p === 'dormant' ? 'listening' : p))
    }
    // 捕捉阶段接管落手:落点可能是输入框、编辑器里的任意节点,不能只靠接驳条自己的 onDrop
    const onWindowDrop = (event) => {
      const refs = collectDataTransfer(event.dataTransfer)
      if (!refs) return
      if (!pointIn(zoneRectOf(elRef.current), event)) return
      event.preventDefault()
      event.stopPropagation()
      takeLanding(refRef.current ?? refs)
    }
    window.addEventListener('wd-ref-dragstart', onDragStart)
    window.addEventListener('wd-ref-dragend', onDragEnd)
    window.addEventListener('dragend', resetHtml5)
    window.addEventListener('drop', onWindowDrop, true)
    window.addEventListener('drop', resetHtml5, true)
    window.addEventListener('dragover', onWindowDragOver, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointermove', onPointerMove, true)
    return () => {
      window.removeEventListener('wd-ref-dragstart', onDragStart)
      window.removeEventListener('wd-ref-dragend', onDragEnd)
      window.removeEventListener('dragend', resetHtml5)
      window.removeEventListener('drop', onWindowDrop, true)
      window.removeEventListener('drop', resetHtml5, true)
      window.removeEventListener('dragover', onWindowDragOver, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointermove', onPointerMove, true)
    }
  }, [phase, land])

  return (
    <>
      {/* 样式随组件注入：dock 在会话输入槽的独立渲染树里，main 槽的 <style>{css}</style> 够不着。 */}
      <style>{css}</style>
      <div
        ref={elRef}
        className={`md-dock is-${phase}`}
        data-input-dock-entry="writing-desk"
        onDragOver={(event) => {
          if (!collectDataTransfer(event.dataTransfer, true) && !refRef.current) return
          event.preventDefault()
          setPhase('armed')
        }}
        onDragLeave={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return
          setPhase(p => (p === 'armed' ? 'listening' : p))
        }}
      >
        {phase === 'dormant' ? null : <span className="md-dock-hint">{t('拖到这里，把素材写进对话')}</span>}
      </div>
    </>
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
  let itemIds = []
  if (hasRefs) {
    try {
      const parsed = JSON.parse(dt.getData('application/x-writing-desk-items'))
      if (Array.isArray(parsed)) itemIds = parsed.filter(row => typeof row === 'string')
    } catch { /* 旧格式兜底 */ }
  }
  const rows = (value) => String(value || '').split('\n').map(row => row.trim()).filter(Boolean)
  itemIds = itemIds.concat(rows(dt.getData('text/writing-desk-item')))
  // 胶囊单独成条:并进 itemIds 会被当成灵感 ID 去查,查不到整批就作废
  const capsuleIds = rows(dt.getData('text/writing-desk-capsule'))
  return itemIds.length || capsuleIds.length ? { itemIds, capsuleIds } : null
}
