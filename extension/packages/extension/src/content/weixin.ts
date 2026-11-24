/**
 * 微信公众号文章页 Content Script(ADR 0017)
 *
 * 只保留提取与预处理:通用提取器明确把公众号页交给这里,所以不能连脚本一起删。
 * 页面上的同步 FAB 与 iframe 对话框已退役,收录入口在侧栏。
 */
import { htmlToMarkdownNative, type PreprocessConfig } from '@wechatsync/core'
import { preprocessContentDOM, preprocessForPlatform, backupAndSimplifyCodeBlocks, restoreCodeBlocks } from '../lib/content-processor'

;(() => {
// Respond to popup's article extraction request and preprocessing
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_ARTICLE') {
    const article = extractWeixinArticle()
    sendResponse({ article })
    return true
  }

  if (message.type === 'PREPROCESS_FOR_PLATFORMS') {
    const { rawHtml, platforms, configs } = message.payload as {
      rawHtml: string
      platforms: string[]
      configs: Record<string, PreprocessConfig>
    }
    const platformContents: Record<string, { html: string; markdown: string }> = {}
    for (const platformId of platforms) {
      const config = configs[platformId]
      if (config) {
        platformContents[platformId] = preprocessForPlatform(rawHtml, config)
      }
    }
    sendResponse({ platformContents })
    return true
  }
})

/**
 * Extract WeChat article from page DOM
 */
function extractWeixinArticle() {
  const title = document.querySelector('#activity-name')?.textContent?.trim()
  const contentEl = document.querySelector('#js_content')
  const cover = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
  const summary = document.querySelector('meta[property="og:description"]')?.getAttribute('content')

  if (!title || !contentEl) return null

  // 保存原始 HTML（微信到微信同步时直接使用，避免代码块格式丢失）
  const rawHtml = contentEl.innerHTML

  const codeBlockBackups = backupAndSimplifyCodeBlocks(contentEl)

  try {
    const clonedContent = contentEl.cloneNode(true) as HTMLElement
    restoreCodeBlocks(codeBlockBackups)
    preprocessContentDOM(clonedContent)

    const htmlContent = clonedContent.innerHTML
    const markdown = htmlToMarkdownNative(htmlContent)

    return {
      title,
      html: htmlContent,
      content: htmlContent,
      rawHtml,
      markdown,
      summary: summary || undefined,
      cover: cover || undefined,
      source: { url: window.location.href, platform: 'weixin' },
    }
  } catch (e) {
    restoreCodeBlocks(codeBlockBackups)
    throw e
  }
}
})()
