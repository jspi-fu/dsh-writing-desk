// 标签的纯函数:选题资料架与批量改标签的 diff 预览。零依赖,与 related.js 一样可直接在 node 里测。
// 不能 import i18n.js(它依赖 react),翻译由调用方处理。

/** 批量改标签的改前→改后预览:每行带上当前版本,提交时原样回传做乐观锁。 */
export function retagPreview(items, ids, tags) {
  const byId = new Map(items.map(item => [item.id, item]))
  return ids.map(id => {
    const item = byId.get(id)
    const before = [...(item?.tags ?? [])]
    const same = before.length === tags.length && tags.every((tag, i) => tag === before[i])
    return { id, title: item?.title ?? '', before, after: [...tags], changed: !same, revision: item?.revision ?? 0 }
  })
}

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
