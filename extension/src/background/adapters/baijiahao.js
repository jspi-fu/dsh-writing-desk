// 百家号适配器(ADR 0009 第二批):appinfo 验登录、编辑页刮 __BJH__INIT__AUTH__,
// JSONP 表单保存草稿;图片走 uploadproxy 素材库。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'

const HEADER_RULES = [
  { urlFilter: '*://baijiahao.baidu.com/*', headers: { Origin: 'https://baijiahao.baidu.com', Referer: 'https://baijiahao.baidu.com/' } },
]

async function authToken() {
  const html = await (await fetch('https://baijiahao.baidu.com/builder/rc/edit', { credentials: 'include' })).text()
  const token = /window\.__BJH__INIT__AUTH__\s*=\s*['"]([^'"]+)['"]/.exec(html)?.[1]
  if (!token) throw new Error('百家号登录失效,请重新登录')
  return token
}

export const baijiahao = {
  id: 'baijiahao',
  label: '百家号',
  meta: null,

  async checkAuth() {
    try {
      const res = await (await fetch(`https://baijiahao.baidu.com/builder/app/appinfo?_=${Date.now()}`, { credentials: 'include' })).json()
      if (res.errmsg === 'success' && res.data?.user) {
        this.meta = { userid: res.data.user.userid, name: res.data.user.name }
        return { authenticated: true, user: res.data.user.name }
      }
      return { authenticated: false }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    const blob = await (src.startsWith('data:') ? dataUriToBlob(src) : (await fetch(src)).blob())
    const form = new FormData()
    form.append('media', blob, 'image.jpg')
    form.append('type', 'image')
    form.append('app_id', '1589639493090963')
    form.append('is_waterlog', '1')
    form.append('save_material', '1')
    form.append('no_compress', '0')
    form.append('is_events', '')
    form.append('article_type', 'news')
    const res = await (await fetch('https://baijiahao.baidu.com/pcui/picture/uploadproxy', {
      method: 'POST', credentials: 'include', body: form,
    })).json()
    if (res.errmsg !== 'success' || !res.ret?.https_url) throw new Error(res.errmsg || '百家号图片上传失败')
    return { url: res.ret.https_url }
  },

  async publish({ title, html }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录百家号(baijiahao.baidu.com)')
      const token = await authToken()
      const content = await processImages(html ?? '', src => this.uploadImage(src), {
        skipPatterns: ['baijiahao.baidu.com', 'bdstatic.com', 'bcebos.com'],
      })
      const response = await fetch('https://baijiahao.baidu.com/pcui/article/save?callback=bjhdraft', {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/x-www-form-urlencoded', token },
        body: new URLSearchParams({
          title, content, feed_cat: '1', len: String(content.length),
          activity_list: JSON.stringify([{ id: 408, is_checked: 0 }]),
          source_reprinted_allow: '0', original_status: '0', original_handler_status: '1',
          isBeautify: 'false', subtitle: '', bjhtopic_id: '', bjhtopic_info: '', type: 'news',
        }),
      })
      const text = await response.text()
      let res
      try {
        res = JSON.parse(text.replace(/^bjhdraft\(/, '').replace(/\)$/, ''))
      } catch {
        throw new Error('百家号响应异常: ' + text.slice(0, 120))
      }
      if (res.errmsg !== 'success' || !res.ret?.article_id) throw new Error(res.errmsg || '百家号保存草稿失败')
      return { ok: true, url: `https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=${res.ret.article_id}` }
    })
  },
}
