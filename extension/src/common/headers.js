// 请求头规则(ADR 0009):平台 Web API 会校验 Origin/Referer,扩展自己的 fetch 没有页面来源,
// 用 declarativeNetRequest 动态规则补上。initiatorDomains 只允许本扩展——这条红线不能放宽。
const sessionRules = chrome.declarativeNetRequest.updateSessionRules

let nextRuleId = 1000

/**
 * 在一组头规则的保护下执行动作,结束自动清理。
 * @param {Array<{urlFilter: string, headers: Record<string,string>, resourceTypes?: string[]}>} rules
 * @param {() => Promise<T>} fn
 */
export async function withHeaderRules(rules, fn) {
  const ids = []
  const extensionId = chrome.runtime.id
  try {
    for (const rule of rules) {
      ids.push(await addRule(rule, extensionId))
    }
    return await fn()
  } finally {
    if (ids.length) await sessionRules({ removeRuleIds: ids }).catch(() => {})
  }
}

async function addRule(rule, extensionId) {
  const id = nextRuleId += 1
  await sessionRules({
    addRules: [{
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: Object.entries(rule.headers).map(([header, value]) => ({ header, operation: 'set', value })),
      },
      condition: {
        urlFilter: rule.urlFilter,
        resourceTypes: rule.resourceTypes ?? ['xmlhttprequest'],
        initiatorDomains: [extensionId],
      },
    }],
  })
  return id
}
