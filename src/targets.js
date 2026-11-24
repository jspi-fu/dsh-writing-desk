// 投递目标快照(ADR 0017):扩展经本地助手写 bridge/targets.json,工作台只读。
// 文件里只有「哪些平台已登录、哪些自建站已连接」,没有密码与 cookie;形状校验
// 与本地助手共用 targets-schema.js,这里只补宿主侧的白名单与显示名。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './store.js'
import { BRIDGE_ADAPTERS } from './platforms.js'
import { sanitizeTargetSnapshot } from './targets-schema.js'

export function targetsPath() {
  return join(dshHome(), 'writing-desk', 'bridge', 'targets.json')
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
  const snapshot = sanitizeTargetSnapshot(raw)
  if (!snapshot) return null

  const platforms = snapshot.platforms
    .filter(row => Object.hasOwn(BRIDGE_ADAPTERS, row.id))
    .map(row => ({
      id: row.id,
      name: row.name || BRIDGE_ADAPTERS[row.id],
      authenticated: row.authenticated,
    }))

  return { at: snapshot.at, platforms, cms: snapshot.cms, hidden: snapshot.hidden }
}

/** 静态 DSL 平台的 id:显示名由 platforms.js 提供,不需要写进历史。 */
export function isStaticDispatchTarget(id) {
  return typeof id === 'string' && Object.hasOwn(BRIDGE_ADAPTERS, id)
}

/** 平台 id 是否可投递:静态 DSL 表 ∪ 当前快照里的自建站 id。 */
export function isDispatchTarget(id, targets) {
  if (isStaticDispatchTarget(id)) return true
  return Array.isArray(targets?.cms) && targets.cms.some(site => site.id === id)
}

/** 回执/历史里的显示名:自建站用账户名,DSL 用静态表,都没有就退回 id。 */
export function targetLabel(id, targets) {
  if (Object.hasOwn(BRIDGE_ADAPTERS, id)) return BRIDGE_ADAPTERS[id]
  return targets?.cms?.find(site => site.id === id)?.name || id
}
