// 页面正文提取(ADR 0009):借鉴 StashDock 的采集链路思想,实现是自己的。
// 有 DOM 的一侧(注入页面)负责「读页」:选区 → 元数据 → Readability,降级链完整——
// 任何一步失败都退到「只收链接和标题」,不阻塞收藏。
// Readability(Apache-2.0)是第三方库,构建时打进 bundle,不属参考项目代码。

// 结构性噪声:导航/页脚/表单一类,Readability 判不准的,先摘再喂给它。
const EXCLUDE = 'script,style,noscript,template,nav,aside,footer,form,dialog,iframe,svg,canvas,video,audio,[contenteditable="true"],[aria-hidden="true"]'

/** 只保留可见节点的文本遍历(活树,computed style 可用):上限 10000 节点 / 100000 字。 */
export function renderedText(root, { maxNodes = 10000, maxChars = 100000 } = {}) {
  const walker = document.createTreeWalker(root, window.NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent) return window.NodeFilter.FILTER_REJECT
      const tag = parent.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') return window.NodeFilter.FILTER_REJECT
      if (parent.isContentEditable) return window.NodeFilter.FILTER_REJECT
      if (!isShown(parent)) return window.NodeFilter.FILTER_REJECT
      return window.NodeFilter.FILTER_ACCEPT
    },
  })
  const parts = []
  let nodes = 0
  let chars = 0
  while (walker.nextNode()) {
    nodes += 1
    if (nodes > maxNodes) break
    const text = walker.currentNode.textContent.replace(/\s+/g, ' ')
    if (!text.trim()) continue
    chars += text.length
    if (chars > maxChars) break
    parts.push(text)
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

/** 克隆文档并摘掉结构噪声,交给 Readability。可见性修剪交给它自己的评分,不硬做。 */
export function prunedDocument() {
  const clone = document.documentElement.cloneNode(true)
  clone.querySelectorAll(EXCLUDE).forEach(node => node.remove())
  return clone
}

function isShown(node) {
  const style = window.getComputedStyle(node)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
  const rect = node.getBoundingClientRect?.()
  return !rect || (rect.width > 0 && rect.height > 0)
}

export function safeUrl() {
  const url = location.href
  if (!/^https?:/.test(url)) return null
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) return null
    return url
  } catch {
    return null
  }
}
