// 微信公众号适配器(ADR 0009):端点与凭据形态是公开事实(平台 Web 编辑器同款接口),
// 实现是本仓库原创。只建草稿素材;草稿 URL 带 token,只给用户本人点击用。
import { withHeaderRules } from '../../common/headers.js'
import { processImages } from '../../common/images.js'

const HEADER_RULES = [{
  urlFilter: '*://mp.weixin.qq.com/cgi-bin/*',
  headers: { Origin: 'https://mp.weixin.qq.com', Referer: 'https://mp.weixin.qq.com/' },
}]

const ERROR_MAP = {
  [-6]: '请输入验证码', [-8]: '请输入验证码', [-1]: '系统错误,请注意备份内容后重试',
  [-99]: '内容超出字数', 200003: '登录态超时,请重新登录', 412: '图文中含非法外链',
  64507: '内容不能包含外部链接', 64562: '请勿插入非微信域名的链接', 64702: '标题超出 64 字限制',
  64705: '内容超出字数', 220001: '素材存储数量已达上限', 220002: '图片库已达到存储上限',
}

async function fetchCredentials() {
  const response = await fetch('https://mp.weixin.qq.com/', { method: 'GET', credentials: 'include' })
  const html = await response.text()
  const token = /data:\s*\{[\s\S]*?t:\s*["']([^"']+)["']/.exec(html)?.[1]
  if (!token) return null
  return {
    token,
    userName: /user_name:\s*["']([^"']+)["']/.exec(html)?.[1] ?? '',
    nickName: /nick_name:\s*["']([^"']+)["']/.exec(html)?.[1] ?? '',
    ticket: /ticket:\s*["']([^"']+)["']/.exec(html)?.[1] ?? '',
    svrTime: Number(/time:\s*["'](\d+)["']/.exec(html)?.[1] ?? Math.floor(Date.now() / 1000)),
  }
}

export const weixin = {
  id: 'weixin',
  label: '公众号',
  meta: null,

  async checkAuth() {
    try {
      const credentials = await fetchCredentials()
      if (!credentials) return { authenticated: false }
      this.meta = credentials
      return { authenticated: true, user: credentials.nickName || credentials.userName }
    } catch {
      return { authenticated: false }
    }
  },

  async uploadImage(src) {
    if (!this.meta) await this.checkAuth()
    const meta = this.meta
    if (!meta) throw new Error('公众号未登录')
    const blob = src.startsWith('data:') ? await (await fetch(src)).blob() : await (await fetch(src)).blob()
    const timestamp = Date.now()
    const form = new FormData()
    form.append('type', blob.type || 'image/jpeg')
    form.append('id', String(timestamp))
    form.append('name', `${timestamp}.jpg`)
    form.append('lastModifiedDate', new Date().toString())
    form.append('size', String(blob.size))
    form.append('file', blob, `${timestamp}.jpg`)
    const { token, userName, ticket, svrTime } = meta
    const response = await fetch(
      `https://mp.weixin.qq.com/cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id=${userName}&ticket=${ticket}&svr_time=${svrTime}&token=${token}&lang=zh_CN&seq=${Date.now()}`,
      { method: 'POST', credentials: 'include', body: form },
    )
    const data = await response.json()
    if (!data.cdn_url) throw new Error(`公众号图片上传失败(${data.base_resp?.err_msg ?? 'no cdn_url'})`)
    return { url: data.cdn_url }
  },

  async publish({ title, html }) {
    return withHeaderRules(HEADER_RULES, async () => {
      if (!this.meta) await this.checkAuth()
      const meta = this.meta
      if (!meta) throw new Error('请先登录微信公众号(mp.weixin.qq.com)')

      // 微信正文禁外链:非微信域名的 <a> 降级成纯文字
      let content = html.replace(/<a\s+[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (match, href, text) =>
        /mp\.weixin\.qq\.com|weixin\.qq\.com|^#/.test(href ?? '') ? match : text)

      content = await processImages(content, src => this.uploadImage(src), { skipPatterns: ['mmbiz.qpic.cn', 'mmbiz.qlogo.cn'] })

      const form = new URLSearchParams({
        token: meta.token, lang: 'zh_CN', f: 'json', ajax: '1', random: String(Math.random()),
        AppMsgId: '', count: '1', data_seq: '0', operate_from: 'Chrome', isnew: '0',
        title0: title.slice(0, 64), author0: '', writerid0: '0', fileid0: '', digest0: '',
        auto_gen_digest0: '1', content0: content, sourceurl0: '', need_open_comment0: '1',
        only_fans_can_comment0: '0', cdn_url0: '', cdn_235_1_url0: '', cdn_1_1_url0: '',
        cdn_url_back0: '', crop_list0: '', music_id0: '', video_id0: '', voteid0: '',
        voteismlt0: '', supervoteid0: '', cardid0: '', cardquantity0: '', cardlimit0: '',
        vid_type0: '', show_cover_pic0: '0', shortvideofileid0: '', copyright_type0: '0',
        releasefirst0: '', platform0: '', reprint_permit_type0: '', allow_reprint0: '',
        allow_reprint_modify0: '', original_article_type0: '', ori_white_list0: '',
        free_content0: '', fee0: '0', ad_id0: '', guide_words0: '', is_share_copyright0: '0',
        share_copyright_url0: '', source_article_type0: '', reprint_recommend_title0: '',
        reprint_recommend_content0: '', share_page_type0: '0', share_imageinfo0: '{"list":[]}',
        share_video_id0: '', dot0: '{}', share_voice_id0: '', insert_ad_mode0: '',
        categories_list0: '[]',
        // 这批空字段是公众号表单的固定占位,缺了会被判参数错误
        ad_video_transition0: '', can_reward0: '0', related_video0: '', is_video_recommend0: '-1',
      })
      const response = await fetch(
        `https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token=${meta.token}&lang=zh_CN`,
        { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form },
      )
      const data = await response.json()
      if (!data.appMsgId) {
        const code = data.ret ?? data.base_resp?.ret
        throw new Error(ERROR_MAP[code] ?? `公众号保存失败(错误码 ${code})`)
      }
      return {
        ok: true,
        url: `https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&action=edit&type=77&appmsgid=${data.appMsgId}&token=${meta.token}&lang=zh_CN`,
      }
    })
  },
}
