// 采集侧栏(ADR 0009):读页 → 预览/编辑 → 收进书桌。
// dirty 守卫:后台 SPA 渐进刷新不覆盖用户已编辑的字段;
// 断连是可操作的警告条;保存成功按钮原地变「已收进」,面板保持打开。
import { h } from '../common/h.js'
import { icon } from '../common/icons.js'
import { t } from '../common/i18n.js'

const state = { entry: null, bridge: 'never', saving: false, saved: false, error: null, dirty: {}, conflict: null, tags: [] }

const app = document.getElementById('app')

function watchStorage() {
  chrome.storage.session.onChanged.addListener(changes => {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (!key.startsWith('capture-')) continue
      // 多窗口:只关心本窗口的条目
      chrome.windows.getCurrent({ populate: false }).then(window => {
        if (key !== `capture-${window.id}`) return
        applyEntry(newValue)
      })
    }
  })
  chrome.runtime.sendMessage({ type: 'bridge-status-poll' }).then(res => { state.bridge = res?.status ?? 'never'; render() }).catch(() => {})
  setInterval(() => {
    chrome.runtime.sendMessage({ type: 'bridge-status-poll' }).then(res => { state.bridge = res?.status ?? 'never'; render() }).catch(() => {})
  }, 3000)
}

function applyEntry(entry) {
  if (!entry) return
  state.entry = entry
  state.saved = false
  state.error = entry.error ?? null
  if (!state.dirty.title) state.title = entry.title ?? ''
  if (!state.dirty.body) state.body = entry.body ?? ''
  if (!state.dirty.tags) state.tags = entry.tags ?? state.tags ?? []
  render()
}

function currentWindowEntryKey() {
  return chrome.windows.getCurrent({ populate: false }).then(window => `capture-${window.id}`)
}

async function retry() {
  const key = await currentWindowEntryKey()
  state.error = null
  await chrome.storage.session.set({ [key]: { loading: true, at: Date.now() } })
  render()
  chrome.runtime.sendMessage({ type: 'capture-retry' })
}

async function copyMarkdown() {
  const payload = state.entry
  const text = `# ${state.title || payload.title}\n\n> ${payload.url}\n\n${state.body ?? payload.body ?? ''}`
  await navigator.clipboard.writeText(text).catch(() => {})
  state.copied = true
  render()
  setTimeout(render, 2000)
}

async function save() {
  if (state.saving || state.saved) return
  state.saving = true
  state.error = null
  render()
  const payload = state.entry
  const result = await chrome.runtime.sendMessage({
    type: 'capture-save',
    payload: { url: payload.url, title: state.title || payload.title, body: state.body ?? payload.body ?? '', siteName: payload.siteName, tags: state.tags, cover: payload.cover },
  }).catch(err => ({ ok: false, error: String(err.message || err) }))
  state.saving = false
  if (result.ok) {
    state.saved = true
  } else if (result.duplicate) {
    state.conflict = { title: state.title || payload.title }
  } else {
    state.error = result.error ?? '保存失败'
    state.offlineMarkdown = result.markdown
  }
  render()
}

function render() {
  const entry = state.entry
  app.replaceChildren()

  // 三态先行:没读到页/读页失败/正常表单
  if (!entry || entry.loading) {
    app.append(renderSkeleton())
    return
  }
  app.append(renderHeader(), renderBody(entry), renderFooter(entry))
  if (state.conflict) app.append(renderConflict())
}

function renderSkeleton() {
  return h('main', { class: 'wd-skeleton', style: 'padding:16px' },
    h('div', { class: 'skeleton', style: 'width:60%;height:18px' }),
    h('div', { class: 'skeleton', style: 'aspect-ratio:16/9;border-radius:16px' }),
    h('div', { class: 'skeleton', style: 'height:36px' }),
    h('div', { class: 'skeleton', style: 'height:120px' }),
    h('div', { class: 'skeleton', style: 'height:24px;width:40%' }),
  )
}

function renderHeader() {
  const connected = state.bridge === 'connected'
  return h('header', { class: 'wd-head rise' },
    h('h1', {}, t('网页收发')),
    h('span', { style: 'flex:1' }),
    h('span', { class: 'wd-bridge', title: connected ? t('桥已连接') : t('桥未连接') },
      h('span', { class: `dot ${connected ? 'is-ok' : ''}` }),
      connected ? t('桥已连接') : t('桥未连接'),
    ),
    h('button', { class: 'icon-btn', title: t('扩展设置'), onclick: () => chrome.runtime.openOptionsPage() }, icon('settings', 15)),
  )
}

function renderBody(entry) {
  const body = h('main', { class: 'wd-body' })
  if (state.error) {
    body.append(h('div', { class: 'wd-note is-error rise', role: 'alert' },
      icon('alert', 14),
      h('span', { style: 'flex:1' }, state.error),
      h('button', { class: 'btn is-small is-primary', onclick: retry }, t('重新读取页面')),
    ))
    if (state.offlineMarkdown) {
      body.append(h('button', { class: 'btn is-block', onclick: copyMarkdown }, state.copied ? t('已复制 Markdown') : t('复制 Markdown')))
    }
    return body
  }

  body.append(h('div', { class: 'wd-cover rise' },
    entry.cover ? h('img', { src: entry.cover, alt: '' }) : h('div', { class: 'is-empty' }, t('没有封面')),
  ))
  const host = new URL(entry.url).hostname
  body.append(h('div', { class: 'wd-meta rise' },
    h('span', { class: 'wd-site' }, entry.siteName && entry.siteName !== host ? `${entry.siteName} · ${host}` : host),
    h('a', { href: entry.url, target: '_blank', rel: 'noreferrer' }, t('打开原页')),
    entry.captureMethod === 'selection' ? h('span', {}, '选区') : null,
  ))
  body.append(h('div', { class: 'field rise' },
    h('label', { for: 'wd-title' }, t('标题')),
    h('input', {
      class: 'input', id: 'wd-title', value: state.title ?? entry.title ?? '',
      oninput: event => { state.title = event.target.value; state.dirty.title = true },
    }),
  ))
  body.append(h('div', { class: 'field rise' },
    h('label', { for: 'wd-body' }, t('正文')),
    h('textarea', {
      class: 'input', id: 'wd-body',
      oninput: event => { state.body = event.target.value; state.dirty.body = true },
    }, state.body ?? entry.body ?? ''),
    entry.truncated ? h('span', { class: 'wd-note' }, icon('alert', 13), t('正文太长,截到了 20000 字')) : null,
    entry.captureMethod === 'page' && !entry.body ? h('span', { class: 'wd-note' }, icon('alert', 13), t('只有可见文字被收进来')) : null,
  ))
  body.append(renderTags())
  return body
}

function renderTags() {
  const wrap = h('div', { class: 'field rise' },
    h('label', {}, t('标签')),
    h('div', { class: 'wd-tags' },
      state.tags.map((tag, index) => h('span', { class: 'wd-tag' }, tag,
        h('button', { title: t('删除'), onclick: () => { state.tags.splice(index, 1); state.dirty.tags = true; render() } }, icon('close', 11)),
      )),
      h('input', {
        placeholder: t('回车加一个'),
        onkeydown: event => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          const value = event.target.value.trim().slice(0, 48)
          if (value && state.tags.length < 12 && !state.tags.includes(value)) {
            state.tags.push(value)
            state.dirty.tags = true
            render()
          }
        },
      }),
    ),
  )
  return wrap
}

function renderFooter(entry) {
  return h('footer', { class: 'wd-foot' },
    h('div', { class: 'wd-foot-row' },
      h('button', {
        class: `btn is-primary is-block ${state.saved ? 'is-saved' : ''}`,
        disabled: state.saving || state.saved,
        onclick: save,
      },
        state.saved ? icon('check', 15) : icon('desk', 15),
        state.saved ? t('已收进') : state.saving ? t('收进中…') : t('收进书桌'),
      ),
    ),
  )
}

function renderConflict() {
  return h('div', { class: 'wd-mask', onclick: event => { if (event.target === event.currentTarget) { state.conflict = null; render() } } },
    h('div', { class: 'wd-dialog', role: 'alertdialog', 'aria-label': t('这条页面已经收过了') },
      h('h2', {}, t('这条页面已经收过了')),
      h('p', {}, state.conflict.title ?? ''),
      h('div', { class: 'wd-foot-row' },
        h('button', { class: 'btn', onclick: () => { state.conflict = null; render() } }, t('保留原有的')),
        h('button', { class: 'btn is-primary', onclick: () => { state.conflict = null; render() } }, t('替换为新内容')),
      ),
    ),
  )
}

watchStorage()
// 面板打开时工具栏点击多半已经写好会话:有现成条目就直接铺表单,没有才触发一次采集
setTimeout(async () => {
  const key = await currentWindowEntryKey()
  const existing = (await chrome.storage.session.get(key))[key]
  if (existing) applyEntry(existing)
  else retry()
}, 200)
