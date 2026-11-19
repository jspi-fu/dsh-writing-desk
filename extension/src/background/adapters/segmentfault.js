// 思否适配器(ADR 0009 第二批):编辑器页刮 session token,Markdown 交 /gateway/draft。
import { withHeaderRules } from '../../common/headers.js'
import { processImages } from '../../common/images.js'

const HEADER_RULES = [
  { urlFilter: '*://segmentfault.com/gateway/*', headers: { Origin: 'https://segmentfault.com', Referer: 'https://segmentfault.com/' } },
]

async function sessionToken() {
  const html = await (await fetch('https://segmentfault.com/write', { credentials: 'include' })).text()
  return /serverData":\s*\{\s*"Token"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? null
}

export const segmentfault = {
  id: 'segmentfault',
  label: '思否',
  meta: null,

  async checkAuth() {
    try {
      const html = await (await fetch('https://segmentfault.com/user/settings', { credentials: 'include' })).text()
      const uid = /href="\/u\/([^"]+)"/.exec(html)?.[1]
      if (!uid) return { authenticated: false }
      this.meta = { uid }
      return { authenticated: true, user: uid }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    if (!this.meta) await this.checkAuth()
    const token = await sessionToken()
    if (!token) throw new Error('思否 session token 获取失败')
    const blob = await (src.startsWith('data:') ? (await fetch(src)).blob() : (await fetch(src)).blob())
    const form = new FormData()
    form.append('image', blob)
    const response = await fetch('https://segmentfault.com/gateway/image', {
      method: 'POST', credentials: 'include', headers: { token }, body: form,
    })
    const text = await response.text()
    if (text === 'Unauthorized') throw new Error('思否未授权')
    let res
    try {
      res = JSON.parse(text)
    } catch {
      throw new Error('思否图片上传失败: ' + text.slice(0, 120))
    }
    // 新版 {url,result} / 旧版 [0, url, id] / [1, error]
    const url = res.result ?? res.url ?? (Array.isArray(res) ? (res[0] === 1 ? null : `https://image-static.segmentfault.com/${res[2]}`) : null)
    if (!url) throw new Error(Array.isArray(res) && res[1] ? res[1] : '思否图片上传失败')
    return { url }
  },

  async publish({ title, markdown }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录思否(segmentfault.com)')
      const token = await sessionToken()
      if (!token) throw new Error('思否 session token 获取失败')
      const content = await processImages(markdown ?? '', src => this.uploadImage(src))
      const response = await fetch('https://segmentfault.com/gateway/draft', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', token, accept: '*/*' },
        body: JSON.stringify({ title, tags: [], text: content, object_id: '', type: 'article' }),
      })
      const text = await response.text()
      if (text === 'Unauthorized') throw new Error('思否未授权')
      let res
      try {
        res = JSON.parse(text)
      } catch {
        throw new Error('思否发布失败: ' + text.slice(0, 120))
      }
      if (Array.isArray(res)) {
        if (res[0] === 1) throw new Error(res[1] || '思否发布失败')
        res = res[1] ?? {}
      }
      if (!res.id) throw new Error(res.message || res.msg || res.error || '思否发布失败')
      return { ok: true, url: `https://segmentfault.com/write?draftId=${res.id}` }
    })
  },
}
