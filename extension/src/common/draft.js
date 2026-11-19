// 紧凑的 Markdown → Draft.js 转换器(豆瓣新版编辑器用,ADR 0009 第二批)。
// 只覆盖工作台成稿的子集:标题/段落/引用/有序无序列表/图片/围栏代码/粗斜体行内,
// 不追求通用 Markdown 解析——图片块带 IMAGE 实体,数据来自上传后的完整图信。
// Draft.js raw 形状:{blocks:[{key,text,type,depth,inlineStyleRanges,entityRanges,data}],entityMap}

const INLINE_RULES = [
  [/\*\*([^*]+)\*\*/, 'BOLD'],
  [/\*([^*]+)\*/, 'ITALIC'],
  [/`([^`]+)`/, 'CODE'],
]

/** 行内解析:剥掉 **粗**/*斜*/`码` 记号,记下样式区间。 */
function parseInline(text) {
  let ranges = []
  let plain = ''
  let rest = text
  while (rest.length) {
    let best = null
    for (const [re, style] of INLINE_RULES) {
      const m = re.exec(rest)
      if (m && (best === null || m.index < best.index)) best = { index: m.index, inner: m[1], style, len: m[0].length }
    }
    if (!best) {
      plain += rest
      break
    }
    plain += rest.slice(0, best.index)
    const offset = plain.length
    plain += best.inner
    ranges.push({ offset, length: best.inner.length, style: best.style })
    rest = rest.slice(best.index + best.len)
  }
  return { text: plain, ranges }
}

/**
 * @param {string} markdown - 正文。
 * @param {Map<string, object>} imageData - 图片地址 → 豆瓣完整图信(id/url/thumb/width/height)。
 * @returns {string} Draft.js raw JSON 字符串。
 */
export function markdownToDraftJs(markdown, imageData = new Map()) {
  const blocks = []
  const entityMap = {}
  let counter = 0
  const nextKey = () => `k${counter += 1}`
  const addBlock = (text, type, entity) => {
    const block = { key: nextKey(), text, type, depth: 0, inlineStyleRanges: [], entityRanges: [], data: {} }
    if (entity) {
      const entityKey = nextKey()
      entityMap[entityKey] = entity
      block.entityRanges.push({ offset: 0, length: 1, key: entityKey })
    }
    blocks.push(block)
  }

  const lines = markdown.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i += 1
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const { text, ranges } = parseInline(heading[2])
      addBlock(text, `header-${heading[1].length}`, undefined)
      blocks[blocks.length - 1].inlineStyleRanges = ranges
      i += 1
      continue
    }
    if (/^```/.test(line)) {
      const code = []
      i += 1
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++])
      i += 1
      addBlock(code.join('\n'), 'code-block', undefined)
      continue
    }
    const image = /^!\[[^\]]*\]\(([^)\s]+)\)\s*$/.exec(line)
    if (image) {
      const data = imageData.get(image[1])
      addBlock(' ', 'atomic', {
        type: 'IMAGE',
        mutability: 'IMMUTABLE',
        data: data ?? { id: '', src: image[1], thumb: image[1], url: image[1] },
      })
      i += 1
      continue
    }
    if (/^>\s?/.test(line)) {
      const quote = []
      while (i < lines.length && /^>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^>\s?/, ''))
      const { text, ranges } = parseInline(quote.join('\n'))
      addBlock(text, 'blockquote', undefined)
      blocks[blocks.length - 1].inlineStyleRanges = ranges
      continue
    }
    const unordered = /^[-*]\s+(.*)$/.exec(line)
    if (unordered) {
      while (i < lines.length) {
        const m = /^[-*]\s+(.*)$/.exec(lines[i])
        if (!m) break
        const { text, ranges } = parseInline(m[1])
        addBlock(text, 'unordered-list-item', undefined)
        blocks[blocks.length - 1].inlineStyleRanges = ranges
        i += 1
      }
      continue
    }
    const ordered = /^\d+\.\s+(.*)$/.exec(line)
    if (ordered) {
      while (i < lines.length) {
        const m = /^\d+\.\s+(.*)$/.exec(lines[i])
        if (!m) break
        const { text, ranges } = parseInline(m[1])
        addBlock(text, 'ordered-list-item', undefined)
        blocks[blocks.length - 1].inlineStyleRanges = ranges
        i += 1
      }
      continue
    }
    const paragraph = []
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|[-*]\s|\d+\.\s|!\[)/.test(lines[i])) {
      paragraph.push(lines[i++])
    }
    const { text, ranges } = parseInline(paragraph.join('\n'))
    addBlock(text, 'unstyled', undefined)
    blocks[blocks.length - 1].inlineStyleRanges = ranges
  }
  return JSON.stringify({ blocks, entityMap })
}
