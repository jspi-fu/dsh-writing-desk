// B 站专栏适配器(ADR 0009 第二批):nav API 验登录、bili_jct 做 CSRF,专栏草稿表单提交。
// B 站要求图片全部在自家 CDN——转存失败的图直接剥掉,不留外站地址。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'

const HEADER_RULES = [
  { urlFilter: '*://api.bilibili.com/*', headers: { Origin: 'https://member.bilibili.com', Referer: 'https://member.bilibili.com/' } },
]

async function csrfToken() {
  const cookie = await chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'bili_jct' })
  return cookie?.value ?? ''
}

export const bilibili = {
  id: 'bilibili',
  label: 'B站',
  meta: null,
  csrf: '',

  async checkAuth() {
    try {
      const res = await (await fetch('https://api.bilibili.com/x/web-interface/nav?build=0&mobi_app=web', { credentials: 'include' })).json()
      if (res.code === 0 && res.data?.isLogin) {
        this.meta = { mid: res.data.mid, uname: res.data.uname }
        this.csrf = await csrfToken()
        return { authenticated: true, user: res.data.uname }
      }
      return { authenticated: false }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    if (!this.csrf) {
      if (!this.meta) await this.checkAuth()
      this.csrf = await csrfToken()
      if (!this.csrf) throw new Error('B 站 CSRF 获取失败,请刷新 bilibili.com 后重试')
    }
    const blob = await (src.startsWith('data:') ? dataUriToBlob(src) : (await fetch(src)).blob())
    const form = new FormData()
    form.append('binary', blob, 'image.jpg')
    form.append('csrf', this.csrf)
    const res = await (await fetch('https://api.bilibili.com/x/article/creative/article/upcover', {
      method: 'POST', credentials: 'include', body: form,
    })).json()
    if (res.code !== 0 || !res.data?.url) throw new Error(`B 站图片上传失败(code=${res.code})`)
    return { url: res.data.url }
  },

  async publish({ title, html }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录 B 站(bilibili.com)')
      this.csrf = await csrfToken()
      if (!this.csrf) throw new Error('B 站 CSRF 获取失败,请刷新 bilibili.com 后重试')
      let content = await processImages(html ?? '', src => this.uploadImage(src), { skipPatterns: ['hdslb.com', 'biliimg.com'] })
      // B 站要求所有图片在自家 CDN:转存失败的剥掉
      content = content.replace(/<img[^>]+src=(?:"([^"]*)"|'([^']*)'|((?:https?:)?\/\/[^\s>"']+|data:[^\s>"']+))[^>]*>/gi, (tag, s1, s2, s3) => {
        const src = s1 || s2 || s3 || ''
        return src.includes('hdslb.com') || src.includes('biliimg.com') ? tag : ''
      })
      const body = new URLSearchParams({ tid: '4', title, content, csrf: this.csrf, save: '0', pgc_id: '0' })
      const res = await (await fetch('https://api.bilibili.com/x/article/creative/draft/addupdate', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      })).json()
      if (res.code !== 0 || !res.data?.aid) throw new Error(res.message || `B 站保存草稿失败(code=${res.code})`)
      return { ok: true, url: `https://member.bilibili.com/platform/upload/text/edit?aid=${res.data.aid}` }
    })
  },
}
