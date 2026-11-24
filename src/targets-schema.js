// 投递目标快照的协议形状(ADR 0017):扩展写、本地助手落盘、宿主读。
// 两侧共用这一份 id 白名单、长度上限与 CMS 协议清单,避免各写一遍再漂移。
// 零依赖:helper.mjs 与 src/targets.js 都直接 import,不牵进任何一侧的模块图。

export const CMS_PROTOCOLS = ['wordpress', 'typecho', 'metaweblog']

const MAX_PLATFORMS = 50
const MAX_SITES = 50
const MAX_HIDDEN = 50
const SAFE_ID = /^[\w-]{1,80}$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value, cap) {
  return typeof value === 'string' ? value.slice(0, cap) : ''
}

function safeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : ''
}

/**
 * 把任意输入折算成只含白名单字段的快照。密码、cookie 与快照外的字段一律丢弃;
 * 不是对象时返回 null。
 * @returns {null|{at: string, platforms: Array, cms: Array, hidden: string[]}}
 */
export function sanitizeTargetSnapshot(body) {
  if (!isRecord(body)) return null

  const platforms = []
  for (const row of Array.isArray(body.platforms) ? body.platforms : []) {
    if (!isRecord(row)) continue
    const id = safeId(row.id)
    if (!id) continue
    platforms.push({ id, name: text(row.name, 100), authenticated: row.authenticated === true })
    if (platforms.length >= MAX_PLATFORMS) break
  }

  const cms = []
  for (const row of Array.isArray(body.cms) ? body.cms : []) {
    if (!isRecord(row) || !CMS_PROTOCOLS.includes(row.type)) continue
    const id = safeId(row.id)
    if (!id) continue
    cms.push({
      id,
      type: row.type,
      name: text(row.name, 100),
      url: text(row.url, 500),
      username: text(row.username, 200),
      connected: row.connected === true,
    })
    if (cms.length >= MAX_SITES) break
  }

  const hidden = [...new Set((Array.isArray(body.hidden) ? body.hidden : []).map(safeId).filter(Boolean))]
    .slice(0, MAX_HIDDEN)

  return {
    at: typeof body.at === 'string' ? body.at.slice(0, 40) : new Date().toISOString(),
    platforms,
    cms,
    hidden,
  }
}
