// 设置页(ADR 0009):Token 配对 + 桥地址。保存即触发重连。
import { h } from '../common/h.js'
import { icon } from '../common/icons.js'
import { t } from '../common/i18n.js'

const state = { token: '', url: 'ws://127.0.0.1:4527', status: 'never', saved: false }
const app = document.getElementById('app')

chrome.runtime.sendMessage({ type: 'bridge-status-poll' }).then(res => { state.status = res?.status ?? 'never'; render() }).catch(() => {})
chrome.storage.local.get(['bridgeToken', 'bridgeUrl']).then(({ bridgeToken, bridgeUrl }) => {
  state.token = bridgeToken ?? ''
  if (bridgeUrl) state.url = bridgeUrl
  render()
})

chrome.runtime.onMessage.addListener(message => {
  if (message.type === 'bridge-status') { state.status = message.status; render() }
})

async function save() {
  await chrome.storage.local.set({ bridgeToken: state.token.trim(), bridgeUrl: state.url.trim() || 'ws://127.0.0.1:4527' })
  state.saved = true
  render()
  setTimeout(render, 2500)
}

const STATUS_TEXT = { never: t('桥未连接'), connecting: t('正在连接桥…'), connected: t('桥已连接'), refused: t('桥拒绝连接(token 不对?)') }

function render() {
  app.replaceChildren(
    h('div', { class: 'wd-card rise' },
      h('h1', {}, icon('desk', 18), t('网页收发'), t('扩展设置')),
      h('div', { class: 'field' },
        h('label', { for: 'wd-token' }, t('桥接 Token')),
        h('input', { class: 'input', id: 'wd-token', type: 'password', placeholder: t('把工作台设置页显示的 Token 粘在这里'), value: state.token, oninput: e => { state.token = e.target.value } }),
      ),
      h('div', { class: 'field' },
        h('label', { for: 'wd-url' }, t('桥地址')),
        h('input', { class: 'input', id: 'wd-url', value: state.url, oninput: e => { state.url = e.target.value } }),
      ),
      h('p', { class: 'wd-hint' },
        '图文创作台设置页会显示 Token;终端跑 ', h('code', {}, 'wdesk serve'), ' 起桥后扩展会自动连上。网页点扩展图标即可收进灵感墙;成稿在工作台校样浮层一键投递到平台草稿箱。',
      ),
      h('div', { class: 'wd-status' },
        h('span', { class: `dot ${state.status === 'connected' ? 'is-ok' : state.status === 'refused' ? 'is-fail' : state.status === 'connecting' ? 'is-work' : ''}` }),
        STATUS_TEXT[state.status] ?? state.status,
      ),
      h('div', { class: 'wd-foot' },
        h('span', { class: 'wd-note' }, state.saved ? t('设置已保存,正在连接…') : ''),
        h('button', { class: 'btn is-primary', onclick: save }, t('保存设置')),
      ),
    ),
  )
}

render()
