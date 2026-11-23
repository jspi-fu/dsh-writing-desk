// 标签的纯函数:选题资料架。零依赖,可直接在 node 里测。
// 不能 import i18n.js(它依赖 react),翻译由调用方处理。

/** 选题资料架:灵感上出现过的标签按使用次数排,次数相同按标签名排,稳定可预期。 */
export function tagShelf(items) {
  const counts = new Map()
  for (const item of items) {
    for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
}
