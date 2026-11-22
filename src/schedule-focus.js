// 排期焦点只读选择：过去与将来都按绝对时间差参与，胶囊始终折叠成一个主体。
// 零依赖、零写回；浏览器与 node:test 共用同一份口径。

function timeOf(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (typeof value === 'string' && !value.trim()) return null
  const at = new Date(value).getTime()
  return Number.isFinite(at) ? at : null
}

function listOf(value) {
  return Array.isArray(value) ? value : []
}

function hasId(value) {
  return value?.id !== undefined && value?.id !== null
}

function membersOf(capsule, byId) {
  const members = []
  const seen = new Set()
  for (const id of listOf(capsule?.itemIds)) {
    if (seen.has(id)) continue
    seen.add(id)
    const item = byId.get(id)
    if (item) members.push(item)
  }
  return members
}

/**
 * 返回从近到远的全部焦点候选。同距离保留 items 中首次出现的顺序。
 * parentId 派生条不独立参选，也不替所属胶囊决定时间；胶囊成员列表仍保留它，
 * 这样张数与整体状态不会被焦点选择截断。胶囊时间取最靠近 now 的有效成员排期。
 */
export function scheduleFocusCandidates(items = [], capsules = [], now) {
  const nowAt = timeOf(now)
  if (nowAt === null) return []

  const rows = listOf(items)
  const byId = new Map()
  for (const item of rows) {
    if (hasId(item) && !byId.has(item.id)) byId.set(item.id, item)
  }

  // 同一成员若被异常旧数据放进多个胶囊，沿用第一个胶囊；重复 capsule.id 也只取第一个。
  const membership = new Map()
  const capsuleByItem = new Map()
  for (const capsule of listOf(capsules)) {
    if (!hasId(capsule) || membership.has(capsule.id)) continue
    const members = membersOf(capsule, byId)
    if (!members.length) continue
    membership.set(capsule.id, {
      capsule,
      members,
      scheduledCount: members.reduce((count, member) => count + (timeOf(member.scheduledAt) === null ? 0 : 1), 0),
    })
    for (const member of members) {
      if (!capsuleByItem.has(member.id)) capsuleByItem.set(member.id, capsule)
    }
  }

  const candidates = []
  const capsuleCandidates = new Map()
  const standaloneSeen = new Set()
  let order = 0

  for (const item of rows) {
    if (!hasId(item)) continue
    const capsule = capsuleByItem.get(item.id)
    if (capsule) {
      if (item.parentId) continue
      const timestamp = timeOf(item.scheduledAt)
      if (timestamp === null) continue
      const distance = Math.abs(timestamp - nowAt)
      const existing = capsuleCandidates.get(capsule.id)
      if (existing) {
        // 严格小于才替换：胶囊内部同距离也保持 items 中首次参选顺序。
        if (distance < existing.distance) {
          existing.item = item
          existing.scheduledAt = item.scheduledAt
          existing.timestamp = timestamp
          existing.distance = distance
        }
        continue
      }
      const group = membership.get(capsule.id)
      const candidate = {
        type: 'capsule',
        id: capsule.id,
        capsule,
        item,
        members: group.members,
        scheduledCount: group.scheduledCount,
        scheduledAt: item.scheduledAt,
        timestamp,
        distance,
        order: order++,
      }
      capsuleCandidates.set(capsule.id, candidate)
      candidates.push(candidate)
      continue
    }

    if (standaloneSeen.has(item.id)) continue
    standaloneSeen.add(item.id)
    if (item.parentId) continue
    const timestamp = timeOf(item.scheduledAt)
    if (timestamp === null) continue
    candidates.push({
      type: 'item',
      id: item.id,
      capsule: null,
      item,
      members: [item],
      scheduledCount: 1,
      scheduledAt: item.scheduledAt,
      timestamp,
      distance: Math.abs(timestamp - nowAt),
      order: order++,
    })
  }

  return candidates
    .sort((a, b) => a.distance - b.distance || a.order - b.order)
    .map(({ order: ignored, ...candidate }) => candidate)
}

export function selectScheduleFocus(items = [], capsules = [], now) {
  return scheduleFocusCandidates(items, capsules, now)[0] ?? null
}
