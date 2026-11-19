// 注入页面的采集器:executeScript 注入后调 window.__wdeskCapture.capture()。
// 产出工作台 add_item 需要的字段;读不出正文时退 metadataOnly,链接可存、正文可后补。
import { Readability } from '@mozilla/readability'
import { prunedDocument, renderedText, safeUrl } from './dom.js'

const BODY_LIMIT = 20000
const TITLE_LIMIT = 300

function metadataTitle() {
  const og = document.querySelector('meta[property="og:title"]')?.content
  const text = (og || document.title || location.hostname).trim()
  return text.slice(0, TITLE_LIMIT)
}

function metaContent(names) {
  for (const name of names) {
    const node = document.querySelector(`meta[property="${name}"], meta[name="${name}"]`)
    const value = node?.content?.trim()
    if (value) return value
  }
  return ''
}

function siteName() {
  return metaContent(['og:site_name']).slice(0, 100)
}

function coverImage() {
  const image = metaContent(['og:image', 'twitter:image', 'sailthru.image'])
  if (/^https?:/.test(image)) return image
  // 文章里第一张像封面的大图兜底
  const first = document.querySelector('article img, .entry-content img, main img')
  const src = first?.currentSrc || first?.src
  return src && /^https?:/.test(src) ? src : null
}

/** 主入口:返回 {url, title, body, siteName, cover, captureMethod, truncated}。 */
function capture() {
  const url = safeUrl()
  if (!url) throw new Error('这个页面不是可以收藏的 http(s) 页面')

  // 用户选区优先:选什么收什么
  const selection = window.getSelection()
  const selected = selection && !selection.isCollapsed ? selection.toString().trim() : ''
  if (selected.length > 80) {
    return {
      url, title: metadataTitle(), body: selected.slice(0, BODY_LIMIT), siteName: siteName(),
      cover: coverImage(), captureMethod: 'selection', truncated: false,
    }
  }

  // Readability:克隆树摘过噪声后再解析
  let body = ''
  let title = metadataTitle()
  let truncated = false
  try {
    const parsed = new Readability(prunedDocument(), { maxElemsToParse: 20000, charThreshold: 80, disableJSONLD: true }).parse()
    if (parsed?.textContent) {
      title = (parsed.title || title).slice(0, TITLE_LIMIT)
      body = parsed.textContent.replace(/\s+/g, ' ').trim()
    }
  } catch { /* 解析失败走兜底 */ }

  if (body.length > BODY_LIMIT) {
    body = body.slice(0, BODY_LIMIT)
    truncated = true
  }

  // 兜底:语义容器或全文可见文本
  if (!body) {
    body = renderedText(document.querySelector('articleBody, [itemprop="articleBody"], .entry-content, article, main') || document.body, { maxChars: BODY_LIMIT })
    truncated = body.length >= BODY_LIMIT
  }

  return {
    url, title, body, siteName: siteName(), cover: coverImage(), captureMethod: 'page',
    truncated: truncated || body.length >= BODY_LIMIT,
  }
}

// IIFE 入口:挂到 window 上,background 经 executeScript(files) 注入后直接调用
window.__wdeskCapture = { capture }
