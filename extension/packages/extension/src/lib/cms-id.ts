/**
 * CMS 自建站的稳定 id(ADR 0017):账户 id 不再用时间戳,改由
 * 类型 + 规范化地址 + 用户名派生,重新添加同一站点得到同一个 id,
 * 工作台的历史 dispatches 才不会被一次删除/重加指成死 id。
 */

export const CMS_PROTOCOLS = ['wordpress', 'typecho', 'metaweblog'] as const
export type CmsProtocol = (typeof CMS_PROTOCOLS)[number]

/** 站点地址归一:去 fragment/query/尾斜杠,host 小写;非法 URL 退回小写去尾斜杠。 */
export function normalizeCmsUrl(raw: string): string {
  const trimmed = String(raw ?? '').trim()
  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.search = ''
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const port = url.port ? `:${url.port}` : ''
    return `${url.protocol}//${url.hostname.toLowerCase()}${port}${pathname}`
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase()
  }
}

/** FNV-1a 32 位,足够区分自建站账户,不引依赖。 */
function hash32(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function cmsAccountId(account: { type: CmsProtocol; url: string; username: string }): string {
  const protocol = /^[a-z]+$/.test(account.type) ? account.type : 'site'
  const key = [protocol, normalizeCmsUrl(account.url), String(account.username ?? '').trim()].join('\n')
  return `cms_${protocol}_${hash32(key)}`
}
