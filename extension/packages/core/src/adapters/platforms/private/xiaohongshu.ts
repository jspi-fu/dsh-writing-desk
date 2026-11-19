/**
 * 小红书图文笔记适配器（页面自动化，仅存草稿）。
 *
 * 小红书没有公开的笔记发布 API；这里复用用户已登录的创作者中心页面：
 * 上传图片 → 填标题/正文（标签以 #tag# 文本附在正文）→ 点“暂存离开”。
 * 不点“发布”，也不读取或导出 cookie；签名由创作者页面自身完成。
 */
import type { Article, AuthResult, PlatformMeta, SyncResult } from '../../../types'
import type { PlatformAdapter, PublishOptions } from '../../types'
import type { RuntimeInterface } from '../../../runtime/interface'
import { parseMarkdownImages } from '../../../lib/markdown-images'

const PUBLISH_URL = 'https://creator.xiaohongshu.com/publish/publish?target=image'
const TITLE_LIMIT = 20
const BODY_LIMIT = 1000
const MAX_IMAGES = 18
const MAX_TAGS = 10
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 40 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface XhsFillPayload {
  title: string
  body: string
  tags: string[]
  images: string[]
}

export interface XhsFillResult {
  ok: boolean
  error?: string
  imageCount?: number
}

export class XiaohongshuAdapter implements PlatformAdapter {
  readonly meta: PlatformMeta = {
    id: 'xiaohongshu',
    name: '小红书',
    icon: 'https://www.xiaohongshu.com/favicon.ico',
    homepage: 'https://creator.xiaohongshu.com',
    capabilities: ['article', 'draft', 'image_upload', 'tags', 'cover'],
  }

  private runtime!: RuntimeInterface

  async init(runtime: RuntimeInterface): Promise<void> {
    this.runtime = runtime
  }

  async checkAuth(): Promise<AuthResult> {
    try {
      const session = await this.runtime.getCookie?.('xiaohongshu.com', 'web_session')
      if (!session) {
        return { isAuthenticated: false, error: '未登录小红书' }
      }
      return { isAuthenticated: true }
    } catch {
      return { isAuthenticated: false, error: '未登录小红书' }
    }
  }

  async publish(article: Article, options?: PublishOptions): Promise<SyncResult> {
    const tabs = this.runtime.tabs
    if (!tabs) {
      return this.fail('当前环境不支持页面自动化')
    }

    const sources = collectImageSources(article).slice(0, MAX_IMAGES)
    if (sources.length === 0) {
      return this.fail('图片上传失败：小红书图文笔记至少需要 1 张图片（JPG/PNG/WebP）')
    }

    const images: string[] = []
    let totalBytes = 0
    for (const source of sources) {
      const dataUrl = await this.fetchImageDataUrl(source)
      if (!dataUrl) continue
      const bytes = dataUrlBytes(dataUrl)
      if (totalBytes + bytes > MAX_TOTAL_IMAGE_BYTES) break
      totalBytes += bytes
      images.push(dataUrl)
      options?.onImageProgress?.(images.length, sources.length)
    }

    if (images.length === 0) {
      return this.fail('图片上传失败：没有可用的 JPG/PNG/WebP 图片')
    }

    const tags = sanitizeTags(article.tags)
    const tagBudget = tags.reduce((sum, tag) => sum + Array.from(tag).length + 3, 0) + 4
    const title = truncateText(
      (article.title || '未命名笔记').replace(/\s+/g, ' ').trim(),
      TITLE_LIMIT
    )
    const bodySource = article.markdown || htmlToNoteText(article.html || '')
    const body = truncateText(
      stripLeadingTitleLine(markdownToNoteText(bodySource), title),
      Math.max(120, BODY_LIMIT - tagBudget)
    )

    // 产品红线：不自动发布。无论调用方是否要求 draftOnly，都只点“暂存离开”。
    const payload: XhsFillPayload = { title, body, tags, images }

    try {
      const tab = await tabs.create(PUBLISH_URL, true)
      await tabs.waitForLoad(tab.id, 45_000)
      const filled = await tabs.executeScript(tab.id, fillXhsNote, [payload], {
        world: 'MAIN',
      })
      if (!filled?.ok) {
        return this.fail(filled?.error || '草稿保存失败，请在小红书发布页手动完成')
      }

      const saved = await tabs.executeScript(tab.id, saveXhsDraft, [], {
        world: 'ISOLATED',
      })
      if (!saved?.ok) {
        return this.fail(saved?.error || '草稿保存失败，请在小红书发布页手动完成')
      }

      return {
        platform: 'xiaohongshu',
        success: true,
        draftOnly: true,
        postUrl: PUBLISH_URL,
        message: `已保存到小红书草稿箱（${filled.imageCount ?? images.length} 张图片）`,
        timestamp: Date.now(),
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return this.fail(`草稿保存失败：${detail}`)
    }
  }

  private fail(error: string): SyncResult {
    return {
      platform: 'xiaohongshu',
      success: false,
      error,
      timestamp: Date.now(),
    }
  }

  private async fetchImageDataUrl(source: string): Promise<string | null> {
    if (source.startsWith('data:')) {
      const mime = source.slice(5, source.indexOf(';'))
      return SUPPORTED_IMAGE_TYPES.has(mime) ? source : null
    }

    try {
      const response = await this.runtime.fetch(source, { credentials: 'include' })
      if (!response.ok) return null
      const blob = await response.blob()
      if (blob.size > MAX_IMAGE_BYTES) return null
      const mime = blob.type || imageMimeFromUrl(source)
      if (!SUPPORTED_IMAGE_TYPES.has(mime)) return null
      const bytes = new Uint8Array(await blob.arrayBuffer())
      return `data:${mime};base64,${base64FromBytes(bytes)}`
    } catch {
      return null
    }
  }
}

/** 封面优先；正文 Markdown/HTML 里的图片依次跟上，去重后保留。 */
export function collectImageSources(article: Article): string[] {
  const sources: string[] = []
  const cover = resolveImageUrl(article.cover, article.source?.url)
  if (cover) sources.push(cover)

  if (article.markdown) {
    for (const { src } of parseMarkdownImages(article.markdown)) {
      const resolved = resolveImageUrl(src, article.source?.url)
      if (resolved) sources.push(resolved)
    }
  } else if (article.html) {
    for (const match of article.html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
      const resolved = resolveImageUrl(match[1], article.source?.url)
      if (resolved) sources.push(resolved)
    }
  }

  return [...new Set(sources)]
}

export function sanitizeTags(tags: string[] | undefined): string[] {
  if (!tags?.length) return []
  const result: string[] = []
  for (const raw of tags) {
    const tag = raw.replace(/^#+/, '').replace(/#+$/, '').replace(/\s+/g, ' ').trim()
    if (!tag || result.includes(tag)) continue
    result.push(tag)
    if (result.length >= MAX_TAGS) break
  }
  return result
}

export function truncateText(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : text
}

/** 工作台成稿常以 H1 开头；标题已单独填入，正文里同名的首行要剥掉。 */
export function stripLeadingTitleLine(text: string, title: string): string {
  const lines = text.split('\n')
  let index = 0
  while (index < lines.length && !lines[index].trim()) index++
  if (index >= lines.length || lines[index].trim() !== title.trim()) return text
  lines.splice(index, 1)
  return lines.join('\n').replace(/^\s*\n+/, '')
}

/** Markdown → 小红书正文纯文本。图片语法单独抽取，不进入正文。 */
export function markdownToNoteText(markdown: string): string {
  if (!markdown) return ''
  return markdown
    .replace(/!\[[^\]]*\]\([^)*\s]*(?:\([^)]*\)[^)*\s]*)*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^```[a-zA-Z0-9_-]*\s*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function htmlToNoteText(html: string): string {
  if (!html) return ''
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function resolveImageUrl(source: string | undefined, base?: string): string | null {
  const value = source?.trim()
  if (!value) return null
  if (/^(data|https?):/i.test(value)) return value
  if (value.startsWith('//')) return `https:${value}`
  if (!base) return null
  try {
    return new URL(value, base).href
  } catch {
    return null
  }
}

function imageMimeFromUrl(url: string): string {
  const match = url.match(/\.(png|webp|jpe?g)(?:[?#]|$)/i)
  if (!match) return ''
  const ext = match[1].toLowerCase()
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
}

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  if (comma === -1) return 0
  return Math.ceil((dataUrl.length - comma - 1) * 3 / 4)
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * 在创作者发布页的 MAIN world 执行：上传图片、填标题/正文、插入话题。
 * 必须是自包含函数（executeScript 会序列化其源码），不能引用模块级变量。
 * 发布按钮在 closed shadow root，另由 saveXhsDraft 在 isolated world 点击。
 */
async function fillXhsNote(payload: XhsFillPayload): Promise<XhsFillResult> {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const textOf = (element: Element | null) => (element?.textContent || '').trim()

  async function waitFor<T>(
    read: () => T | null | undefined,
    timeout = 30_000,
    interval = 200
  ): Promise<T> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const value = read()
      if (value) return value
      await sleep(interval)
    }
    throw new Error('等待页面元素超时')
  }

  function dismissFeatureGuide(): void {
    const guide = Array.from(document.querySelectorAll('button')).find(
      button => textOf(button) === '我知道了'
    ) || document.querySelector('.feature-guide__close') as HTMLElement | null
    if (guide) guide.click()
  }

  function moveCaretToEnd(editor: HTMLElement): void {
    editor.focus()
    const range = document.createRange()
    range.selectNodeContents(editor)
    range.collapse(false)
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function pasteText(editor: HTMLElement, text: string): void {
    editor.focus()
    // 选中全部后再粘贴：小红书会在标题输入后把标题镜像进编辑器，
    // 直接追加会让正文重复一次标题。
    const range = document.createRange()
    range.selectNodeContents(editor)
    const selection = window.getSelection()
    if (!selection) return
    selection.removeAllRanges()
    selection.addRange(range)
    const transfer = new DataTransfer()
    transfer.setData('text/plain', text)
    editor.dispatchEvent(new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: transfer,
    }))
  }

  async function insertTag(editor: HTMLElement, tag: string): Promise<void> {
    moveCaretToEnd(editor)
    document.execCommand('insertText', false, `\n#${tag}`)

    const item = await waitFor(
      () => {
        const candidates = Array.from(document.querySelectorAll('.tippy-content .items .item'))
        return candidates.find(element => {
          const firstLine = ((element as HTMLElement).innerText || '').trim().split('\n')[0]
          return firstLine === `#${tag}`
        }) as HTMLElement | null
      },
      3000,
      120
    ).catch(() => null)

    if (item) {
      item.click()
      await sleep(250)
    } else {
      // 没有精确话题时保留可见的 #tag# 文本，不阻塞草稿保存。
      document.execCommand('insertText', false, '#')
      await sleep(100)
    }
  }

  try {
    if (location.hostname !== 'creator.xiaohongshu.com') {
      return { ok: false, error: '未登录小红书创作服务平台' }
    }
    if (location.pathname.includes('/login')) {
      return { ok: false, error: '未登录小红书创作服务平台' }
    }

    const uploadInput = await waitFor(
      () => document.querySelector('input[type="file"].upload-input') as HTMLInputElement | null,
      20_000
    ).catch(() => null)

    if (!uploadInput) {
      const loggedOut = document.body.innerText.includes('登录') && !document.body.innerText.includes('发布笔记')
      return {
        ok: false,
        error: loggedOut ? '未登录小红书创作服务平台' : '下载图片失败：未找到图片上传控件',
      }
    }

    const files = await Promise.all(payload.images.map(async (dataUrl, index) => {
      const response = await fetch(dataUrl)
      const blob = await response.blob()
      const extension = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'jpg'
      return new File([blob], `image-${index + 1}.${extension}`, { type: blob.type })
    }))

    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    uploadInput.files = transfer.files
    uploadInput.dispatchEvent(new Event('change', { bubbles: true }))

    const titleInput = await waitFor(
      () => document.querySelector('input[placeholder="填写标题会有更多赞哦"]') as HTMLInputElement | null,
      60_000
    )
    const editor = await waitFor(
      () => document.querySelector('div.tiptap[contenteditable="true"]') as HTMLElement | null,
      60_000
    )

    const expectedCount = `${payload.images.length}/18`
    await waitFor(
      () => document.body.innerText.includes(expectedCount) ? true : null,
      90_000,
      300
    ).catch(() => {
      throw new Error(`图片上传超时：未达到 ${payload.images.length} 张`)
    })

    dismissFeatureGuide()
    await sleep(300)

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    if (descriptor?.set) descriptor.set.call(titleInput, payload.title)
    else titleInput.value = payload.title
    titleInput.dispatchEvent(new Event('input', { bubbles: true }))
    titleInput.dispatchEvent(new Event('change', { bubbles: true }))

    pasteText(editor, payload.body)
    await sleep(500)

    for (const tag of payload.tags) {
      await insertTag(editor, tag)
    }

    return { ok: true, imageCount: payload.images.length }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** 在 isolated world 点击 <xhs-publish-btn> closed shadow root 里的“暂存离开”。 */
async function saveXhsDraft(): Promise<XhsFillResult> {
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  const textOf = (element: Element | null) => (element?.textContent || '').trim()
  type ChromeDom = { dom?: { openOrClosedShadowRoot?: (element: Element) => ShadowRoot | null } }

  function findButton(label: string): HTMLButtonElement | null {
    for (const button of Array.from(document.querySelectorAll('button'))) {
      if (textOf(button) === label) return button
    }
    const host = document.querySelector('xhs-publish-btn')
    if (!host) return null
    let root: ShadowRoot | null = null
    try {
      const chromeApi = (globalThis as { chrome?: ChromeDom }).chrome
      root = chromeApi?.dom?.openOrClosedShadowRoot?.(host) ?? null
    } catch {
      root = null
    }
    if (!root) root = (host as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot ?? null
    if (!root) return null
    for (const button of Array.from(root.querySelectorAll('button'))) {
      if (textOf(button) === label) return button
    }
    return null
  }

  async function waitFor<T>(
    read: () => T | null | undefined,
    timeout = 20_000,
    interval = 250
  ): Promise<T> {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const value = read()
      if (value) return value
      await sleep(interval)
    }
    throw new Error('等待页面元素超时')
  }

  try {
    const saveButton = await waitFor(() => {
      const button = findButton('暂存离开')
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
        ? button
        : null
    })

    const guide = findButton('我知道了') || document.querySelector('.feature-guide__close') as HTMLElement | null
    if (guide) guide.click()
    saveButton.click()

    await waitFor(
      () => document.body.innerText.includes('保存成功') ? true : null,
      20_000
    ).catch(() => {
      throw new Error('草稿保存超时，请检查小红书页面')
    })

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}