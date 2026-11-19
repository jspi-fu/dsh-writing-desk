// 发布对话框(ADR 0009):工作台投递过来后由 SW 拉起,实时展示逐平台草稿进度。
// 数据源:chrome.runtime.onMessage 的 publish-* 广播 + storage.session 里的任务状态。
import { h } from '../common/h.js'
import { icon } from '../common/icons.js'
import { t } from '../common/i18n.js'

const LABELS = {
  weixin: '公众号', zhihu: '知乎', juejin: '掘金',
  weibo: '微博', bilibili: 'B站', douban: '豆瓣', baijiahao: '百家号',
  sohu: '搜狐号', csdn: 'CSDN', segmentfault: '思否', yuque: '语雀',
}
const state = {
  operationId: new URLSearchParams(location.search).get('op'),
  title: '',
  platforms: [],
  rows: new Map(), // platform → {state, url?, error?}
  done: false,
}
const app = document.getElementById('app')

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'publish-start' && message.operationId === state.operationId) {
    state.platforms = message.platforms
    for (const platform of state.platforms) if (!state.rows.has(platform)) state.rows.set(platform, { state: 'working' })
    render()
  }
  if (message.type === 'publish-progress' && message.operationId === state.operationId) {
    state.rows.set(message.platform, { state: message.state, url: message.url, error: message.error })
    render()
  }
  if (message.type === 'publish-done' && message.operationId === state.operationId) {
    state.done = true
    render()
  }
})

async function init() {
  const key = `publish-${state.operationId}`
  const task = (await chrome.storage.session.get(key))[key]
  if (task) {
    state.title = task.title ?? ''
    state.platforms = task.platforms ?? []
    for (const platform of state.platforms) {
      const existing = (task.results ?? []).find(row => row.platform === platform)
      state.rows.set(platform, existing
        ? { state: existing.ok ? 'ok' : 'fail', url: existing.url, error: existing.error }
        : { state: 'working' })
    }
    if (task.results) state.done = true
  }
  render()
}

const STATE_TEXT = { working: t('上传中…'), ok: '✓ ' + t('已到草稿箱'), fail: '✗ ' + t('失败'), queued: t('排队中') }

function render() {
  const rows = [...state.rows.entries()]
  app.replaceChildren(
    h('div', { class: 'wd-task rise' },
      h('h1', {}, state.title || t('发布任务')),
      h('div', { class: 'wd-sub' },
        icon('send', 13),
        t('发布只到草稿箱,正式发布由你在平台确认'),
      ),
      rows.length ? h('ul', { class: 'wd-rows' }, rows.map(([platform, row]) => h('li', { class: row.state === 'ok' ? 'is-ok' : row.state === 'fail' ? 'is-fail' : 'rise' },
        h('span', { class: `dot ${row.state === 'working' ? 'is-work' : row.state === 'ok' ? 'is-ok' : row.state === 'fail' ? 'is-fail' : ''}` }),
        h('span', { class: 'wd-name' }, t(LABELS[platform] ?? platform)),
        h('span', { class: `wd-detail ${row.state === 'fail' ? 'is-fail' : ''}` },
          row.state === 'ok' && row.url ? h('a', { href: row.url, target: '_blank', rel: 'noreferrer' }, row.url) :
            row.state === 'fail' ? row.error ?? t('失败') : '',
        ),
        h('span', { class: 'wd-state' }, STATE_TEXT[row.state] ?? ''),
      ))) : h('div', { class: 'wd-note', style: 'margin-top:14px' }, t('排队中')),
      h('div', { class: 'wd-done' },
        h('span', { style: 'flex:1' }),
        h('span', { class: 'wd-note' }, state.done ? undefined : t('上传中…')),
        h('button', { class: 'btn', onclick: () => window.close() }, t('完成')),
      ),
    ),
  )
}

init()
