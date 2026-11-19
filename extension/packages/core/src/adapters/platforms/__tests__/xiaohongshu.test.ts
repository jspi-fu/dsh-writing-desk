import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  XiaohongshuAdapter,
  collectImageSources,
  markdownToNoteText,
  sanitizeTags,
  stripLeadingTitleLine,
  truncateText,
} from '../private/xiaohongshu'
import type { RuntimeInterface } from '../../../runtime/interface'
import type { Article } from '../../../types'

const pngBytes = new Uint8Array([137, 80, 78, 71])

function imageResponse(): Response {
  return new Response(pngBytes, { headers: { 'Content-Type': 'image/png' } })
}

function createRuntime(executeScript = vi.fn(async () => ({ ok: true, imageCount: 2, draftText: '草稿箱(1)' }))) {
  const runtime = {
    type: 'extension',
    fetch: vi.fn(async (url: string) => {
      if (url.includes('cover') || url.includes('a.png')) return imageResponse()
      throw new Error(`Unexpected image request: ${url}`)
    }),
    getCookie: vi.fn(async () => 'web-session'),
    tabs: {
      query: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: 7 })),
      waitForLoad: vi.fn(async () => {}),
      executeScript,
    },
  } as unknown as RuntimeInterface
  return { runtime, executeScript }
}

const article: Article = {
  title: '一个很长很长的小红书笔记标题需要被截断并且继续加长',
  markdown: '# 标题\n\n正文 **加粗** [链接](https://example.com)\n\n![图](https://example.com/a.png)',
  cover: 'https://example.com/cover.png',
  tags: ['#AI#', '科技', 'AI'],
  source: { url: 'https://example.com/post', platform: 'test' },
}

describe('XiaohongshuAdapter', () => {
  let adapter: XiaohongshuAdapter
  let port: ReturnType<typeof createRuntime>

  beforeEach(async () => {
    adapter = new XiaohongshuAdapter()
    port = createRuntime()
    await adapter.init(port.runtime)
  })

  it('登录态读 web_session cookie', async () => {
    await expect(adapter.checkAuth()).resolves.toEqual({ isAuthenticated: true })
  })

  it('只保存草稿，并把截断后的内容传给页面脚本', async () => {
    const result = await adapter.publish(article, { draftOnly: false })

    expect(result.success).toBe(true)
    expect(result.draftOnly).toBe(true)
    expect(result.platform).toBe('xiaohongshu')
    expect(port.executeScript).toHaveBeenCalledWith(
      7,
      expect.any(Function),
      expect.any(Array),
      { world: 'ISOLATED' },
    )

    const payload = (port.executeScript.mock.calls[0][2] as unknown[])[0] as {
      title: string
      body: string
      tags: string[]
      images: string[]
    }
    expect(Array.from(payload.title).length).toBeLessThanOrEqual(20)
    expect(payload.title).toBe('一个很长很长的小红书笔记标题需要被截断并')
    expect(payload.body).toContain('正文 加粗 链接')
    expect(payload.body).not.toContain('![')
    expect(payload.tags).toEqual(['AI', '科技'])
    expect(payload.images).toHaveLength(2)
    expect(payload.images.every(image => image.startsWith('data:image/png;base64,'))).toBe(true)
  })

  it('没有图片时明确失败', async () => {
    const result = await adapter.publish({ ...article, markdown: '只有文字', cover: undefined })
    expect(result.success).toBe(false)
    expect(result.error).toContain('图片上传失败')
    expect(port.executeScript).not.toHaveBeenCalled()
  })

  it('正文不重复标题首行', async () => {
    await adapter.publish({
      ...article,
      title: '同名标题',
      markdown: '# 同名标题\n\n正文第一段',
    })
    const payload = (port.executeScript.mock.calls[0][2] as unknown[])[0] as { body: string }
    expect(payload.body).toBe('正文第一段')
  })
})

describe('Xiaohongshu helpers', () => {
  it('Markdown 图片/链接/强调语法不进入正文', () => {
    const text = markdownToNoteText(
      '# 标题\n\n![封面](https://example.com/a.png)\n\n正文 **加粗** [链接](https://example.com)\n\n```js\nconst a = 1\n```'
    )
    expect(text).toContain('标题')
    expect(text).toContain('正文 加粗 链接')
    expect(text).toContain('const a = 1')
    expect(text).not.toContain('![')
    expect(text).not.toContain('https://example.com')
  })

  it('封面优先并解析相对图片地址', () => {
    const sources = collectImageSources({
      ...article,
      markdown: '![a](https://cdn.example.com/a.png)\n![b](images/b.webp)',
      source: { url: 'https://example.com/post/', platform: 'test' },
    })
    expect(sources).toEqual([
      'https://example.com/cover.png',
      'https://cdn.example.com/a.png',
      'https://example.com/post/images/b.webp',
    ])
  })

  it('标签去重、去井号、最多 10 个', () => {
    expect(sanitizeTags(['#AI#', 'AI', ' 科技 ', '#AI'])).toEqual(['AI', '科技'])
    expect(sanitizeTags(Array.from({ length: 12 }, (_, i) => `tag-${i}`))).toHaveLength(10)
  })

  it('按字符截断，不拆 emoji', () => {
    expect(truncateText('😀😀😀', 2)).toBe('😀😀')
    expect(truncateText('短', 20)).toBe('短')
  })

  it('只剥掉与标题同名的首个非空行', () => {
    expect(stripLeadingTitleLine('\n同名标题\n\n正文', '同名标题')).toBe('正文')
    expect(stripLeadingTitleLine('正文\n同名标题', '同名标题')).toBe('正文\n同名标题')
  })
})