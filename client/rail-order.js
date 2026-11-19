// 缩略图那排的先后：跟排期界面一个口径，上日历的按日期从早到晚，没排期的接在后面。
// 零依赖，跟 tags.js 一样可以直接在 node 里测；entries 是灵感墙攒出来的那种行。
export function railOrder(entries) {
  const whenOf = (entry) => {
    if (entry.type === 'capsule') {
      // 胶囊自己不上日历，按它最早的那个成员算
      const times = (entry.members ?? []).map(member => Date.parse(member.scheduledAt ?? '')).filter(Number.isFinite)
      return times.length ? Math.min(...times) : Number.POSITIVE_INFINITY
    }
    const at = Date.parse(entry.item?.scheduledAt ?? '')
    return Number.isFinite(at) ? at : Number.POSITIVE_INFINITY
  }
  const madeOf = (entry) => {
    const at = Date.parse(entry.at ?? '')
    return Number.isFinite(at) ? at : 0
  }
  const rows = entries.map(entry => ({ entry, when: whenOf(entry), made: madeOf(entry) }))
  const scheduled = rows.filter(row => row.when !== Number.POSITIVE_INFINITY).sort((a, b) => a.when - b.when || b.made - a.made)
  const later = rows.filter(row => row.when === Number.POSITIVE_INFINITY).sort((a, b) => b.made - a.made)
  // cut 是「排期 / 未排期」的分界，不为 0 也不到头时才画中间那条竖杠
  return { list: [...scheduled, ...later].map(row => row.entry), cut: scheduled.length }
}