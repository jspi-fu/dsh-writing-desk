// 记灵感时顺手找出相关的旧灵感：标题、标签、正文和成稿里提到同一个词的，按相关程度排。
// 不依赖界面，测试里可以直接调用。

const STOP_EN = new Set('a an and are as at be but by can do for from how i if in into is it its me my of on or our so that the this to was we what when why with you your'.split(' '))
const STOP_ZH = new Set(['怎么', '什么', '为什么', '一个', '我们', '你们', '他们', '这个', '那个', '如何', '可以', '就是', '不是', '没有', '自己', '还是', '因为', '所以', '但是', '已经', '现在', '真的', '一下', '一些', '的是', '了一'])

/**
 * 把一句话拆成用来匹配的词：英文按单词，中文整段加上相邻两字。
 * @param {string} text - 用户输入。
 * @returns {{ term: string, weight: number }[]} 去重后的词和权重。
 */
export function terms(text) {
  const out = new Map()
  const add = (term, weight) => { if (!out.has(term) || out.get(term) < weight) out.set(term, weight) }
  for (const word of text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []) {
    const clean = word.replace(/[.-]+$/, '')
    if (clean.length >= 2 && !STOP_EN.has(clean)) add(clean, 1)
  }
  for (const run of text.match(/[一-鿿]+/g) ?? []) {
    if (run.length >= 2 && run.length <= 6) add(run, 1.5)
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const pair = run.slice(i, i + 2)
      if (!STOP_ZH.has(pair)) add(pair, 0.5)
    }
  }
  return [...out].map(([term, weight]) => ({ term, weight }))
}

function has(haystack, term) {
  if (!haystack) return false
  // 英文按词边界找，免得 ai 命中 again
  if (/^[a-z0-9]/.test(term)) return new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(haystack)
  return haystack.includes(term)
}

/**
 * 给每条灵感打分，返回最相关的几条。
 * @param {object[]} items - 候选灵感。
 * @param {string} query - 刚输入的那句话。
 * @param {number} [limit] - 最多返回几条。
 * @returns {string[]} 按相关程度排好的 id。
 */
export function relatedIdeas(items, query, limit = 6) {
  const list = terms(query)
  if (!list.length) return []
  const scored = []
  for (const item of items) {
    const title = `${item.title ?? ''}`.toLowerCase()
    const tags = (item.tags ?? []).join(' ').toLowerCase()
    const body = `${item.body ?? ''} ${item.source ?? ''}`.toLowerCase()
    let score = 0
    let strong = false
    for (const { term, weight } of list) {
      if (has(title, term)) { score += 3 * weight; strong ||= weight >= 1 }
      else if (has(tags, term)) { score += 2 * weight; strong ||= weight >= 1 }
      else if (has(body, term)) { score += weight; strong ||= weight >= 1 }
    }
    // 整个词在哪儿出现都算；只有零散的两字片段撞上，要撞够几次才算
    if (strong || score >= 3) scored.push({ id: item.id, score, at: Date.parse(item.createdAt) || 0 })
  }
  return scored.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit).map(row => row.id)
}
