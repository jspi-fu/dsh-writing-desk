// http(s) 地址白名单:ops 的字段清洗、桥的采集/回执校验、迁移的内容过滤共用这一份。
// 纯函数、零依赖,与 state.js 一样可被 Client 半片直接打包。
export function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
