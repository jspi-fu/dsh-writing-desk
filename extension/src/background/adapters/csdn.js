// CSDN 适配器(ADR 0009 第二批):网关签名(x-ca-key/nonce/HMAC-SHA256)+ MD 编辑器草稿,
// 图片走签名直传华为云 OBS,失败保留原引用降级。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'
import { hmacSha256Base64 } from '../../common/crypto.js'

const API_KEY = '203803574'
const API_SECRET = '9znpamsyl2c7cdrr9sas0le9vbc3r6ba'

const HEADER_RULES = [
  { urlFilter: '*://bizapi.csdn.net/*', headers: { Origin: 'https://editor.csdn.net', Referer: 'https://editor.csdn.net/' } },
  { urlFilter: '*://csdn-img-blog.obs.cn-north-4.myhuaweicloud.com/*', headers: { Origin: 'https://editor.csdn.net', Referer: 'https://editor.csdn.net/' } },
]

function nonce() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

async function signedHeaders(path, method) {
  const n = nonce()
  const sign = method === 'GET'
    ? `GET\n*/*\n\n\n\nx-ca-key:${API_KEY}\nx-ca-nonce:${n}\n${path}`
    : `POST\n*/*\n\napplication/json\n\nx-ca-key:${API_KEY}\nx-ca-nonce:${n}\n${path}`
  const headers = {
    accept: '*/*',
    'x-ca-key': API_KEY,
    'x-ca-nonce': n,
    'x-ca-signature': await hmacSha256Base64(API_SECRET, sign),
    'x-ca-signature-headers': 'x-ca-key,x-ca-nonce',
  }
  if (method === 'POST') headers['content-type'] = 'application/json'
  return headers
}

export const csdn = {
  id: 'csdn',
  label: 'CSDN',
  meta: null,

  async checkAuth() {
    try {
      const path = '/blog-console-api/v3/editor/getBaseInfo'
      const response = await fetch(`https://bizapi.csdn.net${path}`, {
        credentials: 'include',
        headers: await signedHeaders(path, 'GET'),
      })
      const data = await response.json()
      if (data.code === 200 && data.data?.name) {
        this.meta = { name: data.data.name, nick: data.data.nickname || data.data.name }
        return { authenticated: true, user: this.meta.nick }
      }
      return { authenticated: false }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    try {
      if (!this.meta) await this.checkAuth()
      const blob = await (src.startsWith('data:') ? dataUriToBlob(src) : (await fetch(src)).blob())
      const ext = /\/(png|webp|gif)\b/.test(blob.type) ? blob.type.split('/')[1] : 'jpg'
      const path = '/resource-api/v1/image/direct/upload/signature'
      const signRes = await (await fetch(`https://bizapi.csdn.net${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: await signedHeaders(path, 'POST'),
        body: JSON.stringify({ imageTemplate: '', appName: 'direct_blog_markdown', imageSuffix: ext }),
      })).json()
      if (signRes.code !== 200 || !signRes.data) throw new Error('CSDN 上传签名失败')
      const up = signRes.data
      const form = new FormData()
      for (const [k, v] of [['key', up.filePath], ['policy', up.policy], ['signature', up.signature], ['callbackBody', up.callbackBody], ['callbackBodyType', up.callbackBodyType], ['callbackUrl', up.callbackUrl], ['AccessKeyId', up.accessId]]) form.append(k, v)
      for (const [k, v] of Object.entries(up.customParam ?? {})) form.append(`x:${k}`, String(v))
      form.append('file', blob, `image.${ext}`)
      const obs = await (await fetch(up.host, { method: 'POST', body: form })).json()
      if (obs.code !== 200 || !obs.data?.imageUrl) throw new Error('CSDN 图片直传失败')
      return { url: obs.data.imageUrl }
    } catch (err) {
      console.warn('[wdesk] csdn image upload failed', err)
      return { url: src }
    }
  },

  async publish({ title, markdown, html }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录 CSDN')
      const content = await processImages(markdown ?? '', src => this.uploadImage(src), { skipPatterns: ['csdnimg.cn', 'csdn.net'] })
      const path = '/blog-console-api/v3/mdeditor/saveArticle'
      const response = await fetch(`https://bizapi.csdn.net${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: await signedHeaders(path, 'POST'),
        body: JSON.stringify({
          title,
          markdowncontent: content,
          content: html ?? '',
          readType: 'public', level: 0, tags: '', status: 2, categories: '',
          type: 'original', original_link: '', authorized_status: false,
          not_auto_saved: '1', source: 'pc_mdeditor', cover_images: [], cover_type: 1,
          is_new: 1, vote_id: 0, resource_id: '', pubStatus: 'draft', creator_activity_id: '',
        }),
      })
      const data = await response.json()
      if (data.code !== 200 || !data.data?.id) throw new Error(data.msg || data.message || 'CSDN 保存草稿失败')
      return { ok: true, url: `https://editor.csdn.net/md?articleId=${data.data.id}` }
    })
  },
}
