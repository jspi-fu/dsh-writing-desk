// 语雀适配器(ADR 0009 第二批):yuque_ctoken 做 CSRF,常用知识库第一本建文档,
// 服务端把 Markdown 转成 lake 格式再写回。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'

const HEADER_RULES = [
  { urlFilter: '*://www.yuque.com/api/*', headers: { Origin: 'https://www.yuque.com', Referer: 'https://www.yuque.com/' } },
]

async function csrfToken() {
  const cookie = await chrome.cookies.get({ url: 'https://www.yuque.com', name: 'yuque_ctoken' })
  const value = cookie?.value ?? ''
  if (!value) throw new Error('请先登录语雀(yuque.com)')
  return value
}

export const yuque = {
  id: 'yuque',
  label: '语雀',
  meta: null,
  csrf: '',

  async checkAuth() {
    try {
      this.csrf = await csrfToken()
      const res = await (await fetch('https://www.yuque.com/api/mine/common_used', {
        credentials: 'include', headers: { 'x-csrf-token': this.csrf },
      })).json()
      const book = res.data?.books?.[0]
      if (!book?.user) return { authenticated: false }
      this.meta = { user: book.user.name, bookId: book.target_id }
      return { authenticated: true, user: book.user.name }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    if (!this.currentDocId) throw new Error('语雀文档 ID 未就绪')
    if (!this.csrf) this.csrf = await csrfToken()
    const blob = await (src.startsWith('data:') ? dataUriToBlob(src) : (await fetch(src)).blob())
    const form = new FormData()
    form.append('file', blob, 'image.jpg')
    const res = await (await fetch(`https://www.yuque.com/api/upload/attach?attachable_type=Doc&attachable_id=${this.currentDocId}&type=image`, {
      method: 'POST', credentials: 'include', headers: { 'x-csrf-token': this.csrf }, body: form,
    })).json()
    if (!res.data?.url) throw new Error('语雀图片上传失败')
    return { url: res.data.url }
  },

  async publish({ title, markdown }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录语雀(yuque.com)')
      this.csrf = await csrfToken()
      const create = await (await fetch('https://www.yuque.com/api/docs', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf },
        body: JSON.stringify({ title, type: 'Doc', format: 'lake', book_id: this.meta.bookId, status: 0 }),
      })).json()
      if (!create.data?.id) throw new Error(create.message || '语雀创建文档失败')
      this.currentDocId = create.data.id
      const content = await processImages(markdown ?? '', src => this.uploadImage(src), {
        skipPatterns: ['yuque.com', 'cdn.nlark.com'],
      })
      const convert = await (await fetch('https://www.yuque.com/api/docs/convert', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf },
        body: JSON.stringify({ from: 'markdown', to: 'lake', content }),
      })).json()
      if (!convert.data?.content) throw new Error('语雀内容转换失败')
      const lake = convert.data.content
      const wrapper = `<div class="lake-content" typography="traditional">${lake}</div>`
      await fetch(`https://www.yuque.com/api/docs/${this.currentDocId}/content`, {
        method: 'PUT', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': this.csrf },
        body: JSON.stringify({
          format: 'lake', body_asl: lake, body: wrapper, body_html: wrapper,
          draft_version: 0, sync_dynamic_data: false, save_type: 'auto', edit_type: 'Lake',
        }),
      })
      return { ok: true, url: `https://www.yuque.com/go/doc/${this.currentDocId}/edit` }
    })
  },
}
