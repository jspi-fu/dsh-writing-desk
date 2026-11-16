// 成稿输入解析:单灵感/多灵感/单胶囊/多胶囊归一为同一种输入(GLOSSARY「成稿输入」)。
// 纯函数、零依赖(与 src/state.js 一样可被 client 经 esbuild 打包进浏览器半片)。
// 四种选择都走这一个入口,Host 侧 produce 路由与 Client 侧统一成稿工作面共用这里的裁决。

/**
 * 把一次成稿的输入解析成灵感 ID 集合。
 * @param {object} state - 工作台状态(items 与 capsules 在这里)。
 * @param {{id?: string, itemIds?: string[], capsuleIds?: string[]}} input - 成稿输入:
 *   `id` 是旧入口的单灵感;`itemIds` 是单/多灵感(给了数组时优先于 id);
 *   `capsuleIds` 是单/多胶囊,按给定顺序展开成员。灵感与胶囊可以混着给。
 * @returns {{sourceIds: string[], targetId: string}} sourceIds 是这次成稿依据的灵感
 *   (去重、按给定顺序、滤掉已删除的);targetId 是成稿产物的落点——
 *   单灵感输入时即该灵感(现有行为不变);多来源时取第一个 sourceId:
 *   不新建承载灵感、不引入新的实体与字段形状,全部素材仍进策划案与正文,
 *   产物落在首个灵感上,其余来源保持原样、随时可单独打开。
 * @throws {Error} 没有可用的灵感时抛出(带 status 400,路由层直接回给调用方)。
 */
export function resolveProduceInput(state, input = {}) {
  const direct = Array.isArray(input.itemIds) ? input.itemIds : input.id ? [input.id] : []
  const capsuleIds = Array.isArray(input.capsuleIds) ? input.capsuleIds : []
  const fromCapsules = capsuleIds.flatMap(id => (state.capsules ?? []).find(row => row.id === id)?.itemIds ?? [])
  const known = new Set(state.items.map(row => row.id))
  const sourceIds = [...new Set([...direct, ...fromCapsules])].filter(id => known.has(id))
  if (!sourceIds.length) throw Object.assign(new Error('成稿输入里没有可用的灵感'), { status: 400 })
  return { sourceIds, targetId: sourceIds[0] }
}
