// 桥协议(ADR 0009):扩展 ↔ wdesk 桥的报文形状与校验。
// 方法集:publish / platforms / extract(桥→扩展,请求-响应);capture(扩展→桥,送采集进投递箱)。
// 与宿主 src/bridge.js 的投递校验是两道独立防线:这里管协议形状,宿主管安全白名单。
export const PROTOCOL_VERSION = 1

export const ADAPTER_IDS = ['weixin', 'zhihu', 'juejin']

// 一次性握手:扩展连上后必须先发 hello,token 对不上直接断开。
// 想改上游「逐条消息带 token」的明文缺陷:token 只出现在握手帧里。
export function helloMessage(token) {
  return { type: 'hello', v: PROTOCOL_VERSION, client: 'extension', token }
}

export function isRequest(msg) {
  return msg?.type === 'request' && typeof msg.id === 'string' && typeof msg.method === 'string'
}

export function isResult(msg) {
  return msg?.type === 'result' && typeof msg.id === 'string'
}

export function validateHello(msg, expectedToken) {
  return msg?.type === 'hello' && msg.v === PROTOCOL_VERSION && typeof msg.token === 'string' && msg.token === expectedToken
}

/** 采集投递的协议校验:形状不对直接拒,内容白名单由宿主消化时再过一遍。 */
export function validateCapture(params) {
  if (!params || typeof params !== 'object') return '参数缺失'
  if (typeof params.operationId !== 'string' || !/^[\w-]{8,64}$/.test(params.operationId)) return 'operationId 无效'
  if (typeof params.url !== 'string' || !/^https?:\/\//.test(params.url)) return 'url 必须是 http(s)'
  if (params.title !== undefined && typeof params.title !== 'string') return 'title 必须是字符串'
  if (params.body !== undefined && typeof params.body !== 'string') return 'body 必须是字符串'
  if (params.cover !== undefined && params.cover !== null && typeof params.cover !== 'string') return 'cover 必须是字符串或 null'
  if (params.tags !== undefined && !Array.isArray(params.tags)) return 'tags 必须是数组'
  if (typeof params.body === 'string' && params.body.length > 20000) return '正文超过 20000 字上限'
  if (typeof params.cover === 'string' && params.cover.length > 1_100_000) return '封面超过 1MB 上限'
  return null
}

/** 发布请求的构造:桥把投递箱任务折算成扩展能直接跑的形状。 */
export function publishRequest(id, task, images) {
  return { type: 'request', id, method: 'publish', params: {
    operationId: task.operationId,
    itemId: task.itemId,
    title: task.title,
    markdown: task.articleMd,
    images,
    platforms: task.platforms,
  } }
}

/** 发布结果校验:逐平台一行,链接必须是 http(s) 或省略。 */
export function validatePublishResult(params) {
  if (!params || !Array.isArray(params.results)) return '缺少 results 数组'
  if (params.results.length > 10) return 'results 超过 10 条'
  for (const row of params.results) {
    if (!row || typeof row.platform !== 'string' || !ADAPTER_IDS.includes(row.platform)) return `未知平台 ${row?.platform}`
    if (typeof row.ok !== 'boolean') return `${row.platform} 缺少 ok`
    if (row.url !== undefined && row.url !== null && typeof row.url !== 'string') return `${row.platform} 的 url 必须是字符串`
    if (typeof row.url === 'string' && row.url && !/^https?:\/\//.test(row.url)) return `${row.platform} 的 url 必须是 http(s)`
  }
  return null
}
