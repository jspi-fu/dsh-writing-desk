// 掘金适配器(ADR 0009):Markdown 优先;secsdk CSRF;图片走火山引擎 ImageX 四步
// (gen_token → ApplyImageUpload(AWS4 签名) → TOS PUT(带 CRC32) → Commit + 换公网 URL)。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'
import { signAWS4, crc32 } from '../../common/crypto.js'

const IMAGEX_AID = '2608'
const IMAGEX_SERVICE_ID = '73owjymdk6'

const HEADER_RULES = [
  { urlFilter: '*://api.juejin.cn/*', headers: { Origin: 'https://juejin.cn', Referer: 'https://juejin.cn/' } },
  { urlFilter: '*://imagex.bytedanceapi.com/*', headers: { Origin: 'https://juejin.cn', Referer: 'https://juejin.cn/' } },
]

const uuid = `${Math.floor(Math.random() * 16 ** 16).toString(16).padStart(16, '0')}${Date.now()}`

export const juejin = {
  id: 'juejin',
  label: '掘金',
  meta: null,
  csrf: null,

  async checkAuth() {
    try {
      const response = await fetch('https://api.juejin.cn/user_api/v1/user/get', { credentials: 'include' })
      const data = await response.json()
      this.meta = data.data?.user_id ? data.data : null
      return this.meta ? { authenticated: true, user: this.meta.user_name } : { authenticated: false }
    } catch {
      return { authenticated: false }
    }
  },

  async csrfToken() {
    if (this.csrf) return this.csrf
    const response = await fetch('https://api.juejin.cn/user_api/v1/sys/token', {
      method: 'HEAD', credentials: 'include',
      headers: { 'x-secsdk-csrf-request': '1', 'x-secsdk-csrf-version': '1.2.10' },
    })
    const wareToken = response.headers.get('x-ware-csrf-token')
    const token = wareToken?.split(',')[1]
    if (!token) throw new Error('掘金 CSRF token 获取失败')
    this.csrf = token
    return token
  },

  /** ImageX 四步;data URI 与远程 URL 都转成 blob 走同一管线。 */
  async uploadImage(src) {
    try {
      const blob = src.startsWith('data:') ? await dataUriToBlob(src) : await (await fetch(src)).blob()
      // 1. 临时凭证
      const tokenResponse = await fetch(`https://api.juejin.cn/imagex/v2/gen_token?aid=${IMAGEX_AID}&uuid=${uuid}&client=web`, { credentials: 'include' })
      const tokenData = await tokenResponse.json()
      const token = tokenData.data?.token
      if (!token?.AccessKeyId) throw new Error(tokenData.err_msg || '掘金图床凭证获取失败')
      // 2. 申请上传(AWS4 签名)
      const applyUrl = `https://imagex.bytedanceapi.com/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${IMAGEX_SERVICE_ID}`
      const signed = await signAWS4({ method: 'GET', url: applyUrl, accessKeyId: token.AccessKeyId, secretAccessKey: token.SecretAccessKey, securityToken: token.SessionToken })
      const apply = await (await fetch(applyUrl, { headers: signed.headers })).json()
      const address = apply.Result?.UploadAddress
      const storeInfo = address?.StoreInfos?.[0]
      const uploadHost = address?.UploadHosts?.[0]
      if (!storeInfo || !uploadHost) throw new Error('掘金图床申请上传失败')
      // 3. 直传 TOS
      const buffer = new Uint8Array(await blob.arrayBuffer())
      const put = await fetch(`https://${uploadHost}/${storeInfo.StoreUri}`, {
        method: 'PUT',
        headers: { authorization: storeInfo.Auth, 'content-type': blob.type || 'application/octet-stream', 'content-crc32': crc32(buffer) },
        body: buffer,
      })
      if (!put.ok) throw new Error(`掘金图片直传失败(${put.status})`)
      // 4. 提交 + 换公网 URL
      const commitUrl = `https://imagex.bytedanceapi.com/?Action=CommitImageUpload&Version=2018-08-01&SessionKey=${encodeURIComponent(address.SessionKey)}&ServiceId=${IMAGEX_SERVICE_ID}`
      const commitSign = await signAWS4({ method: 'POST', url: commitUrl, accessKeyId: token.AccessKeyId, secretAccessKey: token.SecretAccessKey, securityToken: token.SessionToken })
      await fetch(commitUrl, { method: 'POST', headers: { ...commitSign.headers, 'content-length': '0' } })
      const imageUrl = await (await fetch(`https://api.juejin.cn/imagex/v2/get_img_url?aid=${IMAGEX_AID}&uuid=${uuid}&uri=${encodeURIComponent(storeInfo.StoreUri)}&img_type=private`, { credentials: 'include' })).json()
      const url = imageUrl.data?.main_url || imageUrl.data?.backup_url
      if (!url) throw new Error('掘金图片地址获取失败')
      return { url }
    } catch (err) {
      // 单图失败降级保留原引用,不拖垮整篇(掘金容忍外站图,只是转不了图床)
      console.warn('[wdesk] juejin image upload failed', err)
      return { url: src }
    }
  },

  async publish({ title, markdown }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录掘金(juejin.cn)')
      const csrf = await this.csrfToken()
      const content = await processImages(markdown ?? '', src => this.uploadImage(src), { skipPatterns: ['juejin.cn', 'byteimg.com'] })
      const response = await fetch('https://api.juejin.cn/content_api/v1/article_draft/create', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-secsdk-csrf-token': csrf },
        body: JSON.stringify({
          brief_content: '', category_id: '0', cover_image: '', edit_type: 10,
          html_content: 'deprecated', link_url: '', mark_content: content, tag_ids: [], title,
        }),
      })
      const data = await response.json()
      if (data.err_no && data.err_no !== 0) throw new Error(data.err_msg || `掘金草稿失败(错误码 ${data.err_no})`)
      const draftId = data.data?.id
      if (!draftId) throw new Error('掘金草稿失败:无 draft id')
      return { ok: true, url: `https://juejin.cn/editor/drafts/${draftId}` }
    })
  },
}
