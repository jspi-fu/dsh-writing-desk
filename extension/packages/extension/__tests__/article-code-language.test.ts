import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { extractArticle } from '../src/lib/reader'
import { preprocessContentDOM, preprocessForPlatform } from '../src/lib/content-processor'

vi.unmock('@wechatsync/core')
// Readability 会清理 class；保留这一真实边界行为，验证语言信息能穿过提取链。
vi.mock('defuddle', () => ({
  default: class {
    parse() {
      return { content: '' }
    }
  },
}))
vi.mock('../src/lib/logger', () => ({
  createLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
}))

const requireCore = createRequire(resolve(__dirname, '../../core/package.json'))
const workerEntry = resolve(requireCore.resolve('linkedom/package.json'), '../worker.js')
// 中文路径经 Vite 的 URL 编码后会找不到文件；用 data URL 绕开 Vite 的模块解析。
const workerSource = await readFile(workerEntry, 'utf8')
const { parseHTML } = await import(
  `data:text/javascript;base64,${Buffer.from(workerSource).toString('base64')}`
)

describe('文章提取到平台预处理的代码语言保真', () => {
  beforeEach(() => {
    const { document } = parseHTML('<html><head><title>测试文章</title></head><body></body></html>')
    vi.stubGlobal('document', document)
    vi.stubGlobal('window', { location: { href: 'https://example.test/article' } })
    vi.stubGlobal('NodeFilter', { SHOW_COMMENT: 128 })
    vi.stubGlobal(
      'Readability',
      class {
        parse() {
          return null
        }
      }
    )
    vi.stubGlobal(
      'ReaderArticleFinder',
      class {
        leadingImage = null
        pageNumber = 1
        isReaderModeAvailable() {
          return true
        }
        adoptableArticle() {
          const article = document.querySelector('article')?.cloneNode(true) as HTMLElement
          article
            ?.querySelectorAll('[class]')
            .forEach((element) => element.removeAttribute('class'))
          return article
        }
        articleTitle() {
          return '测试文章'
        }
        articleTextContent() {
          return document.querySelector('article')?.textContent
        }
        pageDescription() {
          return undefined
        }
        mainImageNode() {
          return null
        }
        articleIsLTR() {
          return true
        }
        nextPageURL() {
          return null
        }
      }
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['class="language-java"', 'java'],
    ['class="language-markdown"', 'markdown'],
    ['class="lang-python"', 'python'],
    ['data-lang="go"', 'go'],
  ])('保留 code 的 %s，并恢复原始页面', (attributes, language) => {
    document.body.innerHTML = `<article><h1>测试文章</h1><pre><code ${attributes}>code value</code></pre></article>`
    const original = document.body.innerHTML
    const article = extractArticle()
    expect(article).not.toBeNull()
    expect(article!.extractor).toBe('safari-reader')
    const container = document.createElement('div')
    container.innerHTML = article!.content
    preprocessContentDOM(container)
    const result = preprocessForPlatform(container.innerHTML, { outputFormat: 'markdown' })
    expect(result.markdown).toContain('```' + language + '\ncode value\n```')
    expect(document.body.innerHTML).toBe(original)
  })
})
