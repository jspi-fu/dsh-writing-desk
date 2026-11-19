// 图片管线(ADR 0009):同一引擎处理 HTML 与 Markdown 两格式——抽图、同 URL 去重、
// 逐张上传(300ms 节流)、单张失败保留原图降级继续(上游验证过的策略,实现原创)。
const HTML_IMG = /<img[^>]+src=(?:"([^"]*)"|'([^']*)'|((?:https?:)?\/\/[^\s>"']+|data:[^\s>"']+))[^>]*>/gi
const MD_IMG = /!\[([^\]]*)\]\(([^)\s]+)\)/g

/**
 * 把 content 里的图片经 uploadFn 换成平台图床地址。
 * @param {string} content - HTML 或 Markdown。
 * @param {(src: string) => Promise<{url: string}>} uploadFn
 * @param {{skipPatterns?: string[], onProgress?: (done: number, total: number) => void}} [options]
 * @returns {Promise<string>}
 */
export async function processImages(content, uploadFn, options = {}) {
  const { skipPatterns = [], onProgress } = options
  const matches = []
  for (const match of content.matchAll(HTML_IMG)) {
    const src = match[1] ?? match[2] ?? match[3]
    if (src) matches.push({ full: match[0], src, alt: '', kind: 'html' })
  }
  for (const match of content.matchAll(MD_IMG)) {
    matches.push({ full: match[0], src: match[2], alt: match[1], kind: 'markdown' })
  }
  if (!matches.length) return content

  let result = content
  const uploaded = new Map()
  let done = 0
  for (const { full, src, alt, kind } of matches) {
    if (!src) continue
    if (!src.startsWith('data:') && skipPatterns.some(pattern => src.includes(pattern))) continue
    done += 1
    onProgress?.(done, matches.length)
    try {
      let url
      if (uploaded.has(src)) url = uploaded.get(src)
      else {
        url = (await uploadFn(src)).url
        uploaded.set(src, url)
      }
      result = result.replace(full, kind === 'html' ? `<img src="${url}" />` : `![${alt}](${url})`)
    } catch { /* 单图失败保留原图,不拖垮整篇 */ }
    await delay(300)
  }
  return result
}

export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 任务附带的 images 映射(相对引用 → data URI)先把正文里的引用换掉。 */
export function resolveLocalImages(markdown, images) {
  let output = markdown
  for (const [ref, dataUri] of Object.entries(images ?? {})) {
    if (ref === 'cover') continue
    output = output.split(`(${ref})`).join(`(${dataUri})`)
  }
  return output
}

export async function dataUriToBlob(dataUri) {
  return (await fetch(dataUri)).blob()
}
