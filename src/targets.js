// 投递目标快照(ADR 0017):扩展经本地助手写 bridge/targets.json,工作台只读。
// 文件里只有「哪些平台已登录、哪些自建站已连接」,没有密码与 cookie;这里仍按
// 不可信输入校验一遍,平台 id 必须落在静态表或快照的自建站清单里。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './store.js'
import { BRIDGE_ADAPTERS } from './platforms.js'

export function targetsPath() {
  return join(dshHome(), 'writing-desk', 'bridge', 'targets.json')
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeId(value) {
  return typeof value === 'string' && /^[\w-]{1,80}$/.test(value) ? value : ''
}

function text(value, cap) {
  return typeof value === 'string' ? value.slice(0, cap) : ''
}

/**
 * 读投递目标快照。文件缺失或损坏返回 null——调用方退回「只认静态表」,
 * 不让一次坏文件把发布菜单清空。
 * @returns {Promise<null|{at: string, platforms: Array, cms: Array, hidden: string[]}>}
 */
export async function readDispatchTargets() {
  let raw
  try {
    raw = JSON.parse(await readFile(targetsPath(), 'utf8'))
  } catch {
    return null
  }
  if (!isRecord(raw)) return null

  const platforms = []
  for (const row of Array.isArray(raw.platforms) ? raw.platforms : []) {
    if (!isRecord(row)) continue
    const id = safeId(row.id)
    if (!id || !Object.hasOwn(BRIDGE_ADAPTERS, id)) continue
    platforms.push({ id, name: text(row.name, 100) || BRIDGE_ADAPTERS[id], authenticated: row.authenticated === true })
  }

  const cms = []
  for (const row of Array.isArray(raw.cms) ? raw.cms : []) {
    if (!isRecord(row) || !['wordpress', 'typecho', 'metaweblog'].includes(row.type)) continue
    const id = safeId(row.id)
    if (!id) continue
    cms.push({
      id,
      type: row.type,
      name: text(row.name, 100) || id,
      url: text(row.url, 500),
      username: text(row.username, 200),
      connected: row.connected === true,
    })
  }

  const hidden = [...new Set((Array.isArray(raw.hidden) ? raw.hidden : []).map(safeId).filter(Boolean))].slice(0, 50)

  return { at: text(raw.at, 40), platforms, cms, hidden }
}

/** 平台 id 是否可投递:静态 DSL 表 ∪ 当前快照里的自建站 id。 */
export function isDispatchTarget(id, targets) {
  if (typeof id !== 'string' || !id) return false
  if (Object.hasOwn(BRIDGE_ADAPTERS, id)) return true
  return Array.isArray(targets?.cms) && targets.cms.some(site => site.id === id)
}

/** 回执/历史里的显示名:自建站用账户名,DSL 用静态表,都没有就退回 id。 */
export function targetLabel(id, targets) {
  if (Object.hasOwn(BRIDGE_ADAPTERS, id)) return BRIDGE_ADAPTERS[id]
  return targets?.cms?.find(site => site.id === id)?.name ?? id
}
