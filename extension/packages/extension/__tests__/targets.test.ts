import { describe, expect, it } from 'vitest'
import { buildTargetSnapshot } from '../src/lib/targets'

describe('buildTargetSnapshot', () => {
  it('keeps DSL platforms and drops CMS rows from the platform list', () => {
    const snapshot = buildTargetSnapshot({
      platforms: [
        { id: 'zhihu', name: '知乎', isAuthenticated: true },
        { id: 'cms_wordpress_12345678', name: '我的博客', sourceType: 'cms', isAuthenticated: true },
      ],
      at: '2026-11-24T00:00:00.000Z',
    })
    expect(snapshot.platforms).toEqual([{ id: 'zhihu', name: '知乎', authenticated: true }])
    expect(snapshot.at).toBe('2026-11-24T00:00:00.000Z')
  })

  it('reports only whitelisted CMS metadata, never the password', () => {
    const snapshot = buildTargetSnapshot({
      cmsAccounts: [{
        id: 'cms_wordpress_12345678',
        type: 'wordpress',
        name: '我的博客',
        url: 'https://blog.example.com',
        username: 'me',
        isConnected: true,
        password: 'secret',
      }],
    })
    expect(snapshot.cms).toEqual([{
      id: 'cms_wordpress_12345678',
      type: 'wordpress',
      name: '我的博客',
      url: 'https://blog.example.com',
      username: 'me',
      connected: true,
    }])
    expect(JSON.stringify(snapshot)).not.toContain('secret')
  })

  it('drops unsafe ids and unknown CMS protocols', () => {
    const snapshot = buildTargetSnapshot({
      platforms: [{ id: '../etc/passwd', name: 'bad' }, { id: 'zhihu', name: '知乎' }],
      cmsAccounts: [{ id: 'cms_bad', type: 'ghost', name: 'bad' }],
    })
    expect(snapshot.platforms.map(p => p.id)).toEqual(['zhihu'])
    expect(snapshot.cms).toEqual([])
  })

  it('dedupes ids and caps the hidden list', () => {
    const snapshot = buildTargetSnapshot({
      platforms: [{ id: 'zhihu', name: 'a' }, { id: 'zhihu', name: 'b' }],
      hidden: ['zhihu', 'zhihu', 'weixin'],
    })
    expect(snapshot.platforms).toHaveLength(1)
    expect(snapshot.platforms[0].name).toBe('a')
    expect(snapshot.hidden).toEqual(['zhihu', 'weixin'])
  })
})
