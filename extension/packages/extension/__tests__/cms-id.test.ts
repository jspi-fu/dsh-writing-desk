import { describe, expect, it } from 'vitest'
import { cmsAccountId, normalizeCmsUrl } from '../src/lib/cms-id'

describe('normalizeCmsUrl', () => {
  it('treats host case, trailing slash, query and hash as the same site', () => {
    expect(normalizeCmsUrl('HTTPS://Blog.Example.com/')).toBe('https://blog.example.com/')
    expect(normalizeCmsUrl('https://blog.example.com/wp/?utm_source=x#top')).toBe('https://blog.example.com/wp')
  })

  it('keeps scheme and port distinct', () => {
    expect(normalizeCmsUrl('http://blog.example.com')).not.toBe(normalizeCmsUrl('https://blog.example.com'))
    expect(normalizeCmsUrl('https://blog.example.com:8443')).toBe('https://blog.example.com:8443/')
  })

  it('falls back to a lowercase string for invalid URLs', () => {
    expect(normalizeCmsUrl('  My-Blog.Example.COM/  ')).toBe('my-blog.example.com')
  })
})

describe('cmsAccountId', () => {
  const id = (type: 'wordpress' | 'typecho' | 'metaweblog', url: string, username: string) =>
    cmsAccountId({ type, url, username })

  it('is stable across cosmetic URL changes', () => {
    expect(id('wordpress', 'https://blog.example.com', 'me'))
      .toBe(id('wordpress', 'HTTPS://Blog.Example.com/', 'me'))
  })

  it('separates protocol, site and username', () => {
    const base = id('wordpress', 'https://blog.example.com', 'me')
    expect(id('typecho', 'https://blog.example.com', 'me')).not.toBe(base)
    expect(id('wordpress', 'https://other.example.com', 'me')).not.toBe(base)
    expect(id('wordpress', 'https://blog.example.com', 'you')).not.toBe(base)
  })

  it('never starts with the legacy timestamp shape', () => {
    const value = id('metaweblog', 'https://blog.example.com', 'me')
    expect(value).toMatch(/^cms_metaweblog_[0-9a-f]{8}$/)
  })
})
