// 豆瓣适配器(ADR 0009 第二批):新版编辑器把日记当 topic 发布,正文要 Draft.js 格式;
// 以「私密发布(仅自己可见)」代替草稿,链接直达编辑页由用户确认公开。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'
import { markdownToDraftJs } from '../../common/draft.js'

const EDITOR_URL = 'https://www.douban.com/topic/create?subtype=note'

const HEADER_RULES = [
  { urlFilter: '*://*.douban.com/*', headers: { Origin: 'https://www.douban.com', Referer: 'https://www.douban.com' } },
]

export const douban = {
  id: 'douban',
  label: '豆瓣',
  meta: null,

  async checkAuth() {
    try {
      const html = await (await fetch(EDITOR_URL, { credentials: 'include' })).text()
      const userId = /user:\s*\{\s*"id":\s*"(\d+)"/.exec(html)?.[1]
      if (!userId) return { authenticated: false }
      const cookie = await chrome.cookies.get({ url: 'https://www.douban.com', name: 'ck' })
      if (!cookie?.value) return { authenticated: false }
      const nameMatch = /user:\s*\{[^}]*?"name":\s*"([^"]+)"/.exec(html)?.[1]
      let name = userId
      if (nameMatch) {
        try { name = JSON.parse(`"${nameMatch}"`) } catch { name = nameMatch }
      }
      this.meta = {
        userId,
        name,
        ck: cookie.value,
        uploadToken: /upload_auth_token:\s*['"]([^'"]+)['"]/.exec(html)?.[1] ?? '',
      }
      return { authenticated: true, user: name }
    } catch {
      return { authenticated: false }
    }
  },

  /** 上传并带回完整图信(豆瓣 Draft 实体要 id/thumb/宽高,不只是地址)。 */
  async uploadImage(src) {
    if (!this.meta) await this.checkAuth()
    if (!this.meta?.uploadToken) throw new Error('豆瓣上传凭证未获取,请重新打开豆瓣编辑页')
    const blob = await (src.startsWith('data:') ? dataUriToBlob(src) : (await fetch(src)).blob())
    const form = new FormData()
    form.append('ck', this.meta.ck)
    form.append('image_file', blob, 'image.jpg')
    form.append('primary_color', '')
    form.append('upload_auth_token', this.meta.uploadToken)
    const res = await (await fetch('https://upload.douban.com/j/group/topic/add_photo', {
      method: 'POST', credentials: 'include', body: form,
    })).json()
    const photo = res.photo
    if (!photo?.id) throw new Error('豆瓣图片上传失败')
    return { url: photo.url, full: photo }
  },

  async publish({ title, markdown }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录豆瓣(douban.com)')
      // 转存图片并收集完整图信,转换器用它生成 IMAGE 实体
      const imageData = new Map()
      const collect = async src => {
        const result = await this.uploadImage(src)
        imageData.set(result.url, result.full)
        return result
      }
      const content = await processImages(markdown ?? '', collect, {
        skipPatterns: ['doubanio.com', 'douban.com'],
      })
      const imageIds = [...imageData.values()].map((img, index) => `${index + 1}_${img.id}`).join(',')
      const response = await fetch('https://m.douban.com/rexxar/api/v2/topic/post', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'X-CSRF-TOKEN': this.meta.ck },
        body: JSON.stringify({
          title,
          content: markdownToDraftJs(content, imageData),
          image_ids: imageIds,
          topic_tag_ids: '',
          interest_tags: '',
          is_event: false,
          subtype: 'note',
          accessible: 'private',
          explanation_types: '',
          send_status: true,
          original: false,
          is_activity_rule: false,
          enable_item_tag: false,
        }),
      })
      const res = await response.json()
      if (!response.ok || !res.id) throw new Error(res.localized_message || res.msg || `豆瓣发布失败(${response.status})`)
      return { ok: true, url: `https://www.douban.com/topic/${res.id}/edit` }
    })
  },
}
