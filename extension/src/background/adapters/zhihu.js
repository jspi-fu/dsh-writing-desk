// 知乎专栏适配器(ADR 0009):两步草稿(创建空稿 → PATCH 正文),从不碰发布接口。
// 图片双通道:远程 URL 走服务端代抓;data URI 走 md5 + STS + OSS V1 手签(Web Crypto)。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'
import { md5 } from '../../common/crypto.js'

const HEADER_RULES = [
  { urlFilter: '*://www.zhihu.com/api/*', headers: { 'x-requested-with': 'fetch' } },
  { urlFilter: '*://zhuanlan.zhihu.com/api/*', headers: { 'x-requested-with': 'fetch' } },
  { urlFilter: '*://api.zhihu.com/*', headers: { 'x-requested-with': 'fetch' } },
]
const OSS_RULE = {
  urlFilter: '*://zhihu-pics-upload.zhimg.com/*',
  headers: { Origin: 'https://zhuanlan.zhihu.com', Referer: 'https://zhuanlan.zhihu.com/' },
}

async function hmacSha1Base64(key, message) {
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
}

export const zhihu = {
  id: 'zhihu',
  label: '知乎',
  meta: null,

  async checkAuth() {
    try {
      const response = await fetch('https://www.zhihu.com/api/v4/me', { credentials: 'include', headers: { 'x-requested-with': 'fetch' } })
      const data = await response.json()
      this.meta = data.id ? data : null
      return data.id ? { authenticated: true, user: data.name } : { authenticated: false }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    // data URI:二进制通道(md5 + STS + OSS);远程 URL:知乎服务端代抓
    if (src.startsWith('data:')) {
      const blob = await dataUriToBlob(src)
      const buffer = await blob.arrayBuffer()
      const imageHash = md5(buffer)
      const tokenResponse = await fetch('https://api.zhihu.com/images', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image_hash: imageHash, source: 'article' }),
      })
      const data = await tokenResponse.json()
      const uploadFile = data.upload_file
      if (!uploadFile) throw new Error('知乎图片凭据获取失败')
      // 已存在:轮询处理结果
      if (uploadFile.state === 1) {
        for (let i = 0; i < 10; i += 1) {
          const detail = await (await fetch(`https://api.zhihu.com/images/${uploadFile.image_id}`, { credentials: 'include' })).json()
          if (detail.original_hash) return { url: `https://pic4.zhimg.com/${detail.original_hash}` }
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
        throw new Error('知乎图片处理超时')
      }
      const token = data.upload_token
      const objectKey = uploadFile.object_key
      const contentType = blob.type || 'application/octet-stream'
      const ossDate = new Date().toUTCString()
      // OSS V1 签名:VERB\nMD5\nType\nDate\nCanonicalizedHeaders\nCanonicalizedResource
      const canonicalHeaders = ['x-oss-date', 'x-oss-security-token', 'x-oss-user-agent']
        .sort()
        .map(key => `${key}:${key === 'x-oss-date' ? ossDate : key === 'x-oss-security-token' ? token.access_token : 'aliyun-sdk-js/6.8.0'}`)
        .join('\n') + '\n'
      const stringToSign = ['PUT', '', contentType, ossDate, canonicalHeaders, `/zhihu-pics/${objectKey}`].join('\n')
      const signature = await hmacSha1Base64(token.access_key, stringToSign)
      return withHeaderRules([OSS_RULE], async () => {
        const response = await fetch(`https://zhihu-pics-upload.zhimg.com/${objectKey}`, {
          method: 'PUT',
          headers: {
            'content-type': contentType,
            authorization: `OSS ${token.access_id}:${signature}`,
            'x-oss-date': ossDate,
            'x-oss-security-token': token.access_token,
            'x-oss-user-agent': 'aliyun-sdk-js/6.8.0',
          },
          body: blob,
        })
        if (!response.ok) throw new Error(`知乎图片上传失败(${response.status})`)
      }).then(() => ({ url: `https://pic4.zhimg.com/${objectKey}${blob.type === 'image/gif' ? '.gif' : ''}` }))
    }

    const response = await fetch('https://zhuanlan.zhihu.com/api/uploaded_images', {
      method: 'POST', credentials: 'include',
      headers: { 'x-requested-with': 'fetch', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ url: src, source: 'article' }),
    })
    const data = await response.json()
    if (!data.src) throw new Error('知乎图片转存失败')
    return { url: data.src }
  },

  async publish({ title, html }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录知乎(zhihu.com)')

      const create = await fetch('https://zhuanlan.zhihu.com/api/articles/drafts', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ title, content: '', delta_time: 0 }),
      })
      if (!create.ok) throw new Error(`知乎创建草稿失败(${create.status})`)
      const draftId = (await create.json())?.id
      if (!draftId) throw new Error('知乎创建草稿失败:无 draft id')

      // 图片先转存,再套 Draft.js 特化格式:img 包 figure、代码块 lang 属性、剥 style
      let content = await processImages(html, src => this.uploadImage(src), { skipPatterns: ['zhimg.com'] })
      content = content
        .replace(/<img([^>]+)src="([^"]+)"([^>]*)>/gi, '<figure><img$1src="$2"$3></figure>')
        .replace(/<pre><code class="language-(\w+)">/gi, '<pre lang="$1"><code>')
        .replace(/\s*data-(?!draft)[a-z-]+="[^"]*"/gi, '')
        .replace(/\s*style="[^"]*"/gi, '')

      const update = await fetch(`https://zhuanlan.zhihu.com/api/articles/${draftId}/draft`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ title, content }),
      })
      if (!update.ok) throw new Error(`知乎写入正文失败(${update.status})`)
      return { ok: true, url: `https://zhuanlan.zhihu.com/p/${draftId}/edit` }
    })
  },
}
