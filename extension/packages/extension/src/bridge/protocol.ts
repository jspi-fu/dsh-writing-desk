/**
 * NM 协议事实层(ADR 0012):与本地助手 helper.mjs 的消息面按协议事实对齐,
 * 不拷贝 GPL 上游代码;本文件只含纯函数,chrome 装配在 client.ts,方便单测。
 */

/** NM host 名:与主仓库 native/helper.mjs 的 HOST_NAME 一致。 */
export const HOST_NAME = 'app.dswritesync.plugin'

/** host→Chrome 单消息 ≤1MB:分片按 base64 字符切 80 万,与 helper 的 CHUNK_B64 一致。 */
export const NM_CHUNK_B64 = 800_000

/** 助手响应的通用形状。 */
export interface NmResponse {
  ok: boolean
  error?: string
}

/** outbox 任务的元数据(内容本体走 content 分片拉取)。 */
export interface TaskMeta {
  operationId: string
  itemId: string
  title: string
  platforms: string[]
  article: { shards: number }
  images: Array<{ ref: string; mime: string; shards: number }>
}

/** 拉取一个分片的响应。 */
export interface ContentResponse extends NmResponse {
  name?: string
  shard?: number
  shards?: number
  mime?: string
  data?: string
}

/** 逐平台投递结果(performSync 行)→ 投递箱回执行。 */
export interface DispatchResultRow {
  platform: string
  /** 自建站账户名;工作台历史用它,账户删掉后仍读得懂 */
  platformName?: string
  ok: boolean
  url?: string
  error?: string
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 把分片 base64 顺序拼回字节流;单分片可重复拉取,由调用方做重试。 */
export function assembleShards(parts: string[]): Uint8Array {
  return base64ToBytes(parts.join(''))
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

/**
 * 把任务 images 映射里的本地引用替换成 data URI,复刻 serve 端 inlineTaskImages
 * 的 data-URI 路径:平台适配器自己转存图床。只替换任务映射里列出的 ref,
 * 未拉到的图保留原引用(不静默丢内容,适配器会按失败上报)。
 */
export function inlineImageRefs(markdown: string, images: Map<string, { bytes: Uint8Array; mime: string }>): string {
  let content = markdown
  for (const [ref, image] of images) {
    if (!ref || !content.includes(ref)) continue
    let binary = ''
    const { bytes } = image
    const chunk = 0x8000
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
    }
    const dataUri = `data:${image.mime};base64,${btoa(binary)}`
    content = content.split(ref).join(dataUri)
  }
  return content
}

/**
 * performSync 的逐平台结果行映射成投递回执行:缺行按失败补齐,成功带草稿链接,
 * 失败带错误文本——与原 serve 端 processClaimed 的映射一致。
 */
export function mapDispatchResults(
  platforms: string[],
  rows: unknown,
): DispatchResultRow[] {
  const list = Array.isArray(rows) ? rows : (Array.isArray((rows as { results?: unknown[] })?.results) ? (rows as { results: unknown[] }).results : [])
  return platforms.map((platform) => {
    const row = list.find((candidate: unknown) =>
      typeof candidate === 'object' && candidate !== null && (candidate as { platform?: unknown }).platform === platform)
    const typed = row as { success?: unknown; postUrl?: unknown; error?: unknown; platformName?: unknown } | undefined
    const mapped: DispatchResultRow = { platform, ok: typed?.success === true }
    if (typeof typed?.platformName === 'string' && typed.platformName) mapped.platformName = typed.platformName.slice(0, 100)
    if (typeof typed?.postUrl === 'string' && typed.postUrl) mapped.url = typed.postUrl
    if (typed?.success !== true) {
      mapped.error = typeof typed?.error === 'string' && typed.error ? typed.error : 'no result'
    }
    return mapped
  })
}
