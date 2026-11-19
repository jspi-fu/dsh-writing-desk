// 发布任务执行器(ADR 0009):桥下发 publish 请求 → 逐平台跑适配器 → 进度推给对话框页。
// 只到草稿箱;单平台失败不拖垮其他平台;逐平台串行,图片上传大头在适配器内部。
import { marked } from 'marked'
import { resolveLocalImages } from '../common/images.js'
import { weixin } from './adapters/weixin.js'
import { zhihu } from './adapters/zhihu.js'
import { juejin } from './adapters/juejin.js'

export const ADAPTERS = { weixin, zhihu, juejin }

marked.setOptions({ gfm: true, breaks: false })

/** 平台登录态清单(桥的 platforms 方法)。 */
export async function listPlatforms({ forceRefresh = false } = {}) {
  return Promise.all(Object.values(ADAPTERS).map(async adapter => {
    if (forceRefresh) adapter.meta = null
    const auth = await adapter.checkAuth()
    return { id: adapter.id, label: adapter.label, authenticated: auth.authenticated, user: auth.user ?? '' }
  }))
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => { /* 对话框没开着就算了 */ })
}

/**
 * 跑一个发布任务:返回 [{platform, ok, url?, error?}]。
 * @param {{operationId: string, title: string, markdown: string, images: Record<string,string>, platforms: string[]}} task
 */
export async function runPublishTask(task) {
  const state = {}
  broadcast({ type: 'publish-start', operationId: task.operationId, platforms: task.platforms })
  // 先把相对引用换成 data URI(markdown 与 html 两条管线共用)
  const markdown = resolveLocalImages(task.markdown ?? '', task.images ?? {})
  const html = marked.parse(markdown)
  const results = []
  for (const platform of task.platforms) {
    const adapter = ADAPTERS[platform]
    if (!adapter) {
      results.push({ platform, ok: false, error: `未知平台 ${platform}` })
      continue
    }
    state[platform] = 'working'
    broadcast({ type: 'publish-progress', operationId: task.operationId, platform, state: 'working' })
    try {
      const result = await adapter.publish({ title: task.title, markdown, html })
      state[platform] = result.ok ? 'ok' : 'fail'
      results.push({ platform, ok: Boolean(result.ok), url: result.url })
    } catch (err) {
      state[platform] = 'fail'
      results.push({ platform, ok: false, error: String(err.message || err) })
    }
    broadcast({ type: 'publish-progress', operationId: task.operationId, platform, state: state[platform], url: results.at(-1).url, error: results.at(-1).error })
  }
  broadcast({ type: 'publish-done', operationId: task.operationId, results })
  await chrome.storage.session.set({ [`publish-${task.operationId}`]: { operationId: task.operationId, title: task.title, platforms: task.platforms, results } })
  return { results }
}
