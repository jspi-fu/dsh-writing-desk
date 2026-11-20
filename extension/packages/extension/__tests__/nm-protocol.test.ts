/**
 * NM 协议事实层单测(缝 3,ADR 0012):分片拼装、图片引用内联、投递结果映射。
 * 纯函数,不起 chrome,不连助手。
 */
import { describe, expect, it } from 'vitest'
import {
  NM_CHUNK_B64,
  assembleShards,
  decodeUtf8,
  inlineImageRefs,
  mapDispatchResults,
} from '../src/bridge/protocol'

describe('NM protocol', () => {
  it('分片 base64 按序拼回原字节,空分片安全', () => {
    const source = new TextEncoder().encode('分片测试 payload-0123456789')
    const b64 = Buffer.from(source).toString('base64')
    const parts = [b64.slice(0, 10), b64.slice(10, 20), b64.slice(20)]
    expect(decodeUtf8(assembleShards(parts))).toBe('分片测试 payload-0123456789')
    expect(decodeUtf8(assembleShards([Buffer.from(new TextEncoder().encode('x')).toString('base64')]))).toBe('x')
  })

  it('分片预算不超过 host→Chrome 的 1MB 消息上限(与 helper CHUNK_B64 对齐)', () => {
    expect(NM_CHUNK_B64).toBeLessThanOrEqual(900_000)
  })

  it('图片引用按任务映射替换成 data URI;未拉到的图保留原引用', () => {
    const bytes = new TextEncoder().encode('PNGDATA')
    const images = new Map([
      ['images/cover.png', { bytes, mime: 'image/png' }],
    ])
    const markdown = '# 标题\n\n![封面](images/cover.png)\n\n![未拉到](images/missing.png)'
    const result = inlineImageRefs(markdown, images)
    expect(result).toContain('data:image/png;base64,UE5HREFUQQ==')
    expect(result).toContain('![未拉到](images/missing.png)')
    expect(result).not.toContain('(images/cover.png)')
  })

  it('图片引用同时替换 HTML 形式(与 serve 端 split/join 同一语义)', () => {
    const bytes = new TextEncoder().encode('zz')
    const images = new Map([['images/a.jpg', { bytes, mime: 'image/jpeg' }]])
    const html = '<img src="images/a.jpg" />'
    expect(inlineImageRefs(html, images)).toBe('<img src="data:image/jpeg;base64,eno=" />')
  })

  it('投递结果映射:成功带草稿链接,缺行按失败补齐,失败带错误', () => {
    const rows = mapDispatchResults(['zhihu', 'juejin'], [
      { platform: 'zhihu', success: true, postUrl: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'other', success: true },
    ])
    expect(rows).toEqual([
      { platform: 'zhihu', ok: true, url: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'juejin', ok: false, error: 'no result' },
    ])
    const failed = mapDispatchResults(['zhihu'], [{ platform: 'zhihu', success: false, error: '未登录' }])
    expect(failed).toEqual([{ platform: 'zhihu', ok: false, error: '未登录' }])
    expect(mapDispatchResults(['zhihu'], undefined)[0].ok).toBe(false)
  })
})
