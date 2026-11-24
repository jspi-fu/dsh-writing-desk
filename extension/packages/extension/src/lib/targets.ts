/**
 * 投递目标快照(ADR 0017):扩展把「哪些平台已登录、哪些自建站已连接」
 * 经本地助手上报给工作台,发布对话框据此渲染菜单。只含目标元数据,
 * 密码与 cookie 永远不出扩展。
 */

import { CMS_PROTOCOLS } from './cms-id'

export interface DispatchTargetPlatform {
  id: string
  name: string
  authenticated: boolean
}

export interface DispatchTargetSite {
  id: string
  type: string
  name: string
  url: string
  username: string
  connected: boolean
}

export interface DispatchTargetSnapshot {
  at: string
  platforms: DispatchTargetPlatform[]
  cms: DispatchTargetSite[]
  hidden: string[]
}

const MAX_PLATFORMS = 50
const MAX_SITES = 50
const MAX_HIDDEN = 50
const SAFE_ID = /^[\w-]{1,80}$/
const CMS_TYPES = new Set<string>(CMS_PROTOCOLS)

function str(value: unknown, cap: number): string {
  return typeof value === 'string' ? value.trim().slice(0, cap) : ''
}

function safeId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  return SAFE_ID.test(id) ? id : ''
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(safeId).filter(Boolean))].slice(0, MAX_HIDDEN)
}

export function buildTargetSnapshot(input: {
  platforms?: unknown
  cmsAccounts?: unknown
  hidden?: unknown
  at?: string
}): DispatchTargetSnapshot {
  const platforms: DispatchTargetPlatform[] = []
  const seenPlatforms = new Set<string>()
  for (const row of Array.isArray(input.platforms) ? input.platforms : []) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    // CHECK_ALL_AUTH 会把 CMS 账户混进平台列表;自建站单独上报。
    if (record.sourceType === 'cms') continue
    const id = safeId(record.id)
    if (!id || seenPlatforms.has(id)) continue
    seenPlatforms.add(id)
    platforms.push({
      id,
      name: str(record.name, 100) || id,
      authenticated: record.isAuthenticated === true,
    })
    if (platforms.length >= MAX_PLATFORMS) break
  }

  const cms: DispatchTargetSite[] = []
  const seenSites = new Set<string>()
  for (const row of Array.isArray(input.cmsAccounts) ? input.cmsAccounts : []) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const id = safeId(record.id)
    const type = typeof record.type === 'string' && CMS_TYPES.has(record.type) ? record.type : ''
    if (!id || !type || seenSites.has(id)) continue
    seenSites.add(id)
    // 只挑白名单字段:密码在 cms_pwd_* 独立键里,不会被带进来。
    cms.push({
      id,
      type,
      name: str(record.name, 100) || id,
      url: str(record.url, 500),
      username: str(record.username, 200),
      connected: record.isConnected === true,
    })
    if (cms.length >= MAX_SITES) break
  }

  return {
    at: typeof input.at === 'string' && input.at ? input.at : new Date().toISOString(),
    platforms,
    cms,
    hidden: idList(input.hidden),
  }
}
