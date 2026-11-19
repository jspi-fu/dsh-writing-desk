// 搜狐号适配器(ADR 0009 第二批):多子账号取第一个,JSON v2 草稿接口。
import { withHeaderRules } from '../../common/headers.js'
import { processImages, dataUriToBlob } from '../../common/images.js'

const HEADER_RULES = [
  { urlFilter: '*://mp.sohu.com/*', headers: { Origin: 'https://mp.sohu.com', Referer: 'https://mp.sohu.com/' } },
]

const deviceId = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')

async function spCm() {
  const cookie = await chrome.cookies.get({ url: 'https://mp.sohu.com', name: 'mp-cv' }).catch(() => null)
  return cookie?.value || `100-${Date.now()}-${deviceId}`
}

export const sohu = {
  id: 'sohu',
  label: '搜狐号',
  meta: null,
  cm: '',

  async checkAuth() {
    try {
      const res = await (await fetch(`https://mp.sohu.com/mpbp/bp/account/list?_=${Date.now()}`, { credentials: 'include' })).json()
      const accounts = (res.data?.data ?? []).flatMap(group => group.accounts ?? [])
      if (res.code !== 2000000 || !accounts.length) return { authenticated: false }
      this.meta = { id: String(accounts[0].id), nick: accounts[0].nickName, count: accounts.length }
      this.cm = await spCm()
      return { authenticated: true, user: accounts[0].nickName }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    if (!this.meta) await this.checkAuth()
    if (!this.meta) throw new Error('搜狐号未登录')
    const blob = await (src.startsWith('data:') ? dataUriToBlob(src) : (await fetch(src)).blob())
    const form = new FormData()
    form.append('file', blob, 'image.jpg')
    form.append('accountId', this.meta.id)
    const res = await (await fetch(`https://mp.sohu.com/commons/front/outerUpload/image/file?accountId=${this.meta.id}`, {
      method: 'POST', credentials: 'include', body: form,
    })).json()
    if (!res.url) throw new Error('搜狐号图片上传失败: ' + (res.msg || ''))
    return { url: res.url }
  },

  async publish({ title, html }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      if (!this.meta) throw new Error('请先登录搜狐号(mp.sohu.com)')
      const content = await processImages(html ?? '', src => this.uploadImage(src), { skipPatterns: ['sohu.com'] })
      this.cm = await spCm()
      const response = await fetch(`https://mp.sohu.com/mpbp/bp/news/v4/news/draft/v2?accountId=${this.meta.id}`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'dv-id': deviceId, 'sp-cm': this.cm },
        body: JSON.stringify({
          title, brief: '', content, channelId: 24, categoryId: -1, id: 0, userColumnId: 0,
          columnNewsIds: [], businessCode: 0, declareOriginal: false, cover: '', topicIds: [],
          isAd: 0, userLabels: '[]', reprint: false, customTags: '', infoResource: 0,
          sourceUrl: '', visibleToLoginedUsers: 0, attrIds: [], auto: true,
          accountId: Number(this.meta.id),
        }),
      })
      const res = await response.json()
      if (!res.success) throw new Error(res.msg || '搜狐号保存失败')
      return { ok: true, url: `https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle?contentStatus=2&id=${res.data}` }
    })
  },
}
