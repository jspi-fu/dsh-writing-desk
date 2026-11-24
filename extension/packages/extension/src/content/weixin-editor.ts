/**
 * 微信公众号后台编辑器页面 Content Script(ADR 0017)
 *
 * 只保留提取:通用提取器把公众号后台页交给这里。页面上的「同步助手」FAB 与
 * iframe 对话框已退役,收录入口在侧栏。
 */
import { createLogger } from '../lib/logger'
import { htmlToMarkdownNative } from '@wechatsync/core'
import { preprocessContentString, backupAndSimplifyCodeBlocks, restoreCodeBlocks } from '../lib/content-processor'

const logger = createLogger('WeixinEditor')

;(() => {

function isEditorPage(): boolean {
  const url = window.location.href
  return url.includes('mp.weixin.qq.com/cgi-bin/appmsg') &&
         (url.includes('action=edit') || url.includes('appmsg_edit'))
}

// Respond to popup's article extraction request
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_ARTICLE' && isEditorPage()) {
    ;(async () => {
      try {
        sendResponse({ article: await extractArticle() })
      } catch {
        sendResponse({ article: null })
      }
    })()
    return true
  }
})

// ── Article extraction (unchanged) ──

async function extractArticle(): Promise<any | null> {
  try {
    logger.debug('Extracting article...')

    const titleSelectors = [
      '#js_title_place', '#title', 'input[name="title"]',
      '.weui-desktop-form__input', '.title_input input', '.js_title',
      '[data-id="title"]', '.appmsg_title input', '.appmsg-edit-title input',
    ]
    let title = ''
    for (const sel of titleSelectors) {
      const el = document.querySelector(sel) as HTMLInputElement
      const value = el?.value?.trim() || el?.textContent?.trim()
      if (value) { title = value; break }
    }

    let content = ''

    // Try iframe editor (UEditor)
    const frameSelectors = [
      '#ueditor_0', 'iframe[id^="ueditor"]',
      '.edui-editor iframe', 'iframe.edui-body-container',
    ]
    for (const sel of frameSelectors) {
      try {
        const frame = document.querySelector(sel) as HTMLIFrameElement
        if (frame?.contentDocument?.body) {
          const body = frame.contentDocument.body
          const testHtml = body.innerHTML
          if (testHtml && testHtml.trim() && testHtml.trim() !== '<p><br></p>' && testHtml.length > 10) {
            const codeBlockBackups = backupAndSimplifyCodeBlocks(body)
            content = body.innerHTML
            restoreCodeBlocks(codeBlockBackups)
            break
          }
        }
      } catch { /* cross-origin */ }
    }

    // Try page containers
    if (!content) {
      const containerSelectors = ['.edui-body-container', '.rich_media_content', '#js_content', '.appmsg-edit-content']
      for (const sel of containerSelectors) {
        const el = document.querySelector(sel)
        if (el?.innerHTML && el.innerHTML.trim().length > 10) {
          const codeBlockBackups = backupAndSimplifyCodeBlocks(el)
          content = el.innerHTML
          restoreCodeBlocks(codeBlockBackups)
          break
        }
      }
    }

    // Try API fetch
    const appmsgid = new URLSearchParams(window.location.search).get('appmsgid')
    if (appmsgid && (!content || !title)) {
      const article = await fetchArticleByApi(appmsgid)
      if (article) return article
    }

    if (!title || !content) return null

    // Cover
    const coverSelectors = ['.appmsg_thumb img', '.js_cover img', '.cover-img img', '.appmsg_thumb_wrap img']
    let cover = ''
    for (const sel of coverSelectors) {
      const img = document.querySelector(sel) as HTMLImageElement
      if (img?.src && !img.src.includes('data:')) { cover = img.src; break }
    }

    // Summary
    const digestSelectors = ['[name="digest"]', '#digest', 'textarea.digest', '.appmsg_desc textarea']
    let summary = ''
    for (const sel of digestSelectors) {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement
      if (el?.value) { summary = el.value; break }
    }

    const processedContent = preprocessContentString(content)
    const markdown = htmlToMarkdownNative(processedContent)
    return { title, html: processedContent, content: processedContent, markdown, summary, cover, source: { url: window.location.href, platform: 'weixin-editor' } }
  } catch (error) {
    logger.error('Extract failed:', error)
    return null
  }
}

async function fetchArticleByApi(appmsgid: string): Promise<any | null> {
  try {
    const tokenMatch = window.location.search.match(/token=(\d+)/)
    if (!tokenMatch) return null

    const token = tokenMatch[1]
    const tempRes = await fetch(
      `https://mp.weixin.qq.com/cgi-bin/appmsg?action=get_temp_url&appmsgid=${appmsgid}&itemidx=1&token=${token}&lang=zh_CN&f=json&ajax=1`,
      { credentials: 'include' }
    )
    const tempData = await tempRes.json()
    if (!tempData.temp_url) return null

    const htmlRes = await fetch(tempData.temp_url)
    const html = await htmlRes.text()

    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')

    const title = doc.querySelector('#activity-name')?.textContent?.trim()
    const contentEl = doc.querySelector('#js_content')
    const cover = doc.querySelector('meta[property="og:image"]')?.getAttribute('content')
    const summary = doc.querySelector('meta[property="og:description"]')?.getAttribute('content')

    if (!title || !contentEl) return null

    const processedContent = preprocessContentString(contentEl.innerHTML)
    const markdown = htmlToMarkdownNative(processedContent)
    return { title, html: processedContent, content: processedContent, markdown, summary, cover, source: { url: tempData.temp_url, platform: 'weixin' } }
  } catch (error) {
    logger.error('API fetch failed:', error)
    return null
  }
}
})()
