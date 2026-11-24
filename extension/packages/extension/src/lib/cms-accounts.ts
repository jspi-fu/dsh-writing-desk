/**
 * CMS 账户 id 一次性迁移(ADR 0017):旧账户是 `cms_<时间戳>`,重加同一站点会
 * 换 id,历史 dispatches 就指向死 id。启动时按 类型+地址+用户名 重算,密码键
 * `cms_pwd_*` 一起搬家;幂等,跑几次结果一样。
 */
import { cmsAccountId, type CmsProtocol } from './cms-id'

interface StoredCmsAccount {
  id: string
  type: CmsProtocol
  name?: string
  url: string
  username: string
  isConnected?: boolean
  lastError?: string
}

const PROTOCOLS = new Set<CmsProtocol>(['wordpress', 'typecho', 'metaweblog'])

export async function migrateCmsAccountIds(): Promise<boolean> {
  const storage = await chrome.storage.local.get('cmsAccounts')
  const accounts = Array.isArray(storage.cmsAccounts) ? storage.cmsAccounts as StoredCmsAccount[] : []
  if (!accounts.length) return false

  let changed = false
  const seen = new Set<string>()
  const next: StoredCmsAccount[] = []

  for (const account of accounts) {
    if (!account || typeof account !== 'object' || !PROTOCOLS.has(account.type)) continue
    const id = cmsAccountId({ type: account.type, url: account.url, username: account.username })
    if (seen.has(id)) {
      changed = true
      continue
    }
    seen.add(id)
    if (id === account.id) {
      next.push(account)
      continue
    }

    changed = true
    next.push({ ...account, id })
    const oldKey = `cms_pwd_${account.id}`
    const newKey = `cms_pwd_${id}`
    const oldPassword = (await chrome.storage.local.get(oldKey))[oldKey]
    if (oldPassword) {
      const existing = (await chrome.storage.local.get(newKey))[newKey]
      if (!existing) await chrome.storage.local.set({ [newKey]: oldPassword })
      await chrome.storage.local.remove(oldKey)
    }
  }

  if (changed) {
    await chrome.storage.local.set({ cmsAccounts: next })
    // 缓存里还是旧 id,清掉让 CHECK_ALL_AUTH 重建
    await chrome.storage.local.remove('platformListCache')
  }
  return changed
}
