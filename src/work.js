// 作品(Work)的领域函数:ADR 0013/0014 定案的第一个实体。素材只存原始输入,
// 正文、封面、配图、意图、审读都活在 Work.current 上;发布时把 current 冻结成 published。
// 纯函数、零依赖(与 state.js 一样被 Host 与 Client 共用),不碰 Store、不做 IO。

const hasText = value => typeof value === 'string' && value.trim().length > 0

/** 发布记录的三态(ADR 0013):草稿 → 已投递(机器回执)→ 已发布(用户确认)。 */
export const PUBLICATION_STATES = ['draft', 'submitted', 'published']
export const PUBLICATION_LABEL = { draft: '草稿', submitted: '已投递', published: '已发布' }

/** current 里允许写、允许冻结的字段;rev 与时间戳由写入口维护。 */
export const CURRENT_FIELDS = ['title', 'coverText', 'article', 'cover', 'images', 'intent', 'review']

/** 一篇作品是否已有正文(空草稿可以在作品页直接删,不算写过)。 */
export function workHasText(work) {
  return hasText(work?.current?.article)
}

/** 作品状态:发布记录说了算,缺省是草稿。 */
export function workState(work) {
  const status = work?.publication?.status
  return PUBLICATION_STATES.includes(status) ? status : 'draft'
}

/** 作品标题:当前稿标题;新作品还没写标题时退回来源标题。 */
export function workTitle(work) {
  const own = work?.current?.title
  return hasText(own) ? own : sourceTitle(work)
}

/** 来源标题:第一条来源素材的标题;素材删了也还在(sourceSnapshot 留了快照)。 */
export function sourceTitle(work) {
  const first = (work?.sourceSnapshot ?? [])[0]
  return hasText(first?.title) ? first.title : ''
}

/** 一个素材被哪些作品引用(只算没归档的)。蓝点与成稿历史都按它派生。 */
export function worksOfItem(state, itemId) {
  return (state?.works ?? []).filter(work => !work.archivedAt && (work.sourceItemIds ?? []).includes(itemId))
}

/** 素材是否已用:只要任一作品引用它,就派生为已用(ADR 0013,不存布尔值)。 */
export function isUsed(state, itemId) {
  return worksOfItem(state, itemId).length > 0
}

/** 胶囊是否已用:整张卡只要有成员被引用就算——胶囊是一张卡(ADR 0011/0013)。 */
export function isCapsuleUsed(state, capsule) {
  return (capsule?.itemIds ?? []).some(id => isUsed(state, id))
}

/** 当前稿与冻结的发布稿是否已经不一致——作品页据此标「有未发布改动」。 */
export function hasUnpublishedChange(work) {
  const published = work?.published
  if (!published) return false
  const current = work.current ?? {}
  const view = fields => JSON.stringify(CURRENT_FIELDS.map(field => fields[field] ?? null))
  return view(current) !== view(published)
}

/** 按 id 取作品,找不到返回 null(调用方自己决定报什么错)。 */
export function workOfId(state, workId) {
  return (state?.works ?? []).find(work => work.id === workId) ?? null
}

/** 作品引用的一组素材(含被删的:只剩 sourceSnapshot 里的快照)。 */
export function sourceEntries(work) {
  return work?.sourceSnapshot ?? []
}

/**
 * 交给保存/导出模块的扁平「稿视图」:export.js 与 publish.js 的签名只读这几个字段。
 * 作品的落盘记录(savedPath/savedHashes/savedAt/cliPath)挂在 Work 根上,不污染 current。
 */
export function workDoc(work) {
  return {
    ...(work?.current ?? {}),
    title: workTitle(work),
    savedPath: work?.savedPath,
    savedHashes: work?.savedHashes,
    savedAt: work?.savedAt,
    cliPath: work?.cliPath,
  }
}