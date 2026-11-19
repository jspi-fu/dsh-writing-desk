// 微博头条文章适配器(ADR 0009 第二批):card.weibo.com 编辑器页刮 uid,先建草稿再保存;
// 图片两条通道——data URI 直传 picupload,远程 URL 走服务端代抓 + 轮询。
import { withHeaderRules } from '../../common/headers.js'
import { processImages } from '../../common/images.js'

const HEADER_RULES = [
  { urlFilter: '*://card.weibo.com/*', headers: { Origin: 'https://card.weibo.com', Referer: 'https://card.weibo.com/article/v5/editor' } },
  { urlFilter: '*://picupload.weibo.com/*', headers: { Origin: 'https://weibo.com', Referer: 'https://weibo.com/' } },
]

function reqId(uid) {
  const base = btoa(`${uid}&${Date.now()}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let out = base
  while (out.length < 43) out += chars[Math.floor(Math.random() * chars.length)]
  return out.slice(0, 43)
}

export const weibo = {
  id: 'weibo',
  label: '微博',
  meta: null,

  async checkAuth() {
    try {
      const html = await (await fetch('https://card.weibo.com/article/v5/editor', { credentials: 'include' })).text()
      const match = /config:\s*JSON\.parse\('(.+?)'\)/.exec(html)
      if (!match) return { authenticated: false }
      const config = JSON.parse(match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'))
      if (!config.uid) return { authenticated: false }
      this.meta = { uid: String(config.uid), nick: config.nick || '', avatar: config.avatar_large || '' }
      return { authenticated: true, user: this.meta.nick }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    if (!this.meta) await this.checkAuth()
    if (!this.meta) throw new Error('微博未登录')
    const rid = reqId(this.meta.uid)
    if (!src.startsWith('data:')) {
      // 远程 URL:服务端代抓 + 轮询结果(最多 30 次 ×1s)
      await fetch(`https://card.weibo.com/article/v5/aj/editor/plugins/asyncuploadimg?uid=${this.meta.uid}&_rid=${rid}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json, text/plain, */*', 'SN-REQID': rid },
        body: new URLSearchParams({ 'urls[0]': src }),
      }).catch(() => {})
      for (let i = 0; i < 30; i += 1) {
        const pollRid = reqId(this.meta.uid)
        const res = await (await fetch(`https://card.weibo.com/article/v5/aj/editor/plugins/asyncimginfo?uid=${this.meta.uid}&_rid=${pollRid}`, {
          method: 'POST', credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json, text/plain, */*', 'SN-REQID': pollRid },
          body: new URLSearchParams({ 'urls[0]': src }),
        })).json()
        const item = res.data?.[0]
        if (item?.task_status_code === 1) return { url: `https://wx3.sinaimg.cn/large/${item.pid}.jpg` }
        if (item?.task_status_code === 2) throw new Error('微博图片代抓失败')
        await new Promise(r => setTimeout(r, 1000))
      }
      throw new Error('微博图片代抓超时')
    }
    // data URI 直传
    const blob = await (await fetch(src)).blob()
    const uploadRid = reqId(this.meta.uid)
    const res = await (await fetch(`https://picupload.weibo.com/interface/pic_upload.php?app=miniblog&s=json&p=1&data=1&url=&markpos=1&logo=0&nick=&file_source=4&_rid=${uploadRid}`, {
      method: 'POST', credentials: 'include', body: blob,
    })).json()
    const pid = res.data?.pics?.pic_1?.pid
    if (!pid) throw new Error('微博图片直传失败')
    return { url: `https://wx3.sinaimg.cn/large/${pid}.jpg` }
  },

  async publish({ title, html }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录微博(weibo.com)')
      const { uid } = this.meta
      const createRid = reqId(uid)
      const create = await (await fetch(`https://card.weibo.com/article/v5/aj/editor/draft/create?uid=${uid}&_rid=${createRid}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json, text/plain, */*', 'SN-REQID': createRid },
        body: new URLSearchParams({}),
      })).json()
      if (create.code !== 100000 || !create.data?.id) throw new Error(create.msg || '微博创建草稿失败')
      const postId = create.data.id
      // 正文里的图片先转存成微博图床地址
      const content = await processImagesHtml(this, html ?? '')
      const saveRid = reqId(uid)
      const save = await (await fetch(`https://card.weibo.com/article/v5/aj/editor/draft/save?uid=${uid}&id=${postId}&_rid=${saveRid}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json, text/plain, */*', 'SN-REQID': saveRid },
        body: new URLSearchParams({
          id: postId, title, subtitle: '', type: '', status: '0', publish_at: '', error_msg: '',
          error_code: '0', collection: '[]', free_content: '', content, cover: '', summary: '',
          writer: '', extra: 'null', is_word: '0', article_recommend: '[]', follow_to_read: '1',
          isreward: '1', pay_setting: '{"ispay":0,"isvclub":0}', source: '0', action: '1',
          content_type: '0', save: '1',
        }),
      })).json()
      if (String(save.code) !== '100000') throw new Error(save.msg || `微博保存失败(${save.code})`)
      return { ok: true, url: `https://card.weibo.com/article/v5/editor#/draft/${postId}` }
    })
  },
}

// 微博正文只认自家图床:把 <img> 换成已上传的 sinaimg 地址,包裹 figure;转存失败的剥掉
async function processImagesHtml(adapter, html) {
  const processed = await processImages(
    html.replace(/>\s+</g, '><'),
    src => adapter.uploadImage(src),
    { skipPatterns: ['sinaimg.cn', 'weibo.com'] },
  )
  return processed.replace(/<img[^>]+src=(?:"([^"]*)"|'([^']*)'|((?:https?:)?\/\/[^\s>"']+|data:[^\s>"']+))[^>]*>/gi, (tag, s1, s2, s3) => {
    const src = s1 || s2 || s3 || ''
    return src.includes('sinaimg.cn') ? `<figure class="image">${tag}</figure>` : ''
  })
}
