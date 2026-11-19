// Service Worker(ADR 0009):采集编排 + 发布任务 + 桥接客户端的总线。
// 点击工具栏 = 同一手势里完成「要权限、开侧栏、读页面」三件事(StashDock 验证过的时序)。
import { BridgeClient } from '../common/bridge.js'
import { listPlatforms, runPublishTask } from './publish.js'

const bridge = new BridgeClient({
  onStatus: status => {
    chrome.action.setBadgeBackgroundColor({ color: status === 'connected' ? '#2fa36c' : '#a9b0b8' })
    chrome.action.setBadgeText({ text: status === 'connected' ? '' : '?' })
    broadcast({ type: 'bridge-status', status })
  },
  onRequest: handleBridgeRequest,
})

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {})
}

async function hasAllUrls() {
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] })
  return granted
}

/** 读当前活动标签页:校验身份(截到别的页就废了),注入采集器,拿页面数据。 */
async function captureTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab?.id || !/^https?:/.test(tab.url ?? '')) throw new Error('当前标签页不是可采集的网页')
  if (tab.status === 'loading') await waitForTab(tab.id)
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['page-capture.js'] })
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.__wdeskCapture.capture(),
  })
  if (!result?.result) throw new Error(result?.error?.message || '页面读取失败')
  const payload = result.result
  // 封面兜底:没有 og:image 时截一屏(压缩到 720px,失败就当没有)
  if (!payload.cover) {
    payload.cover = await captureScreenshot(tab.id, tab.width).catch(() => null)
  }
  payload.tabTitle = tab.title
  return payload
}

function waitForTab(tabId) {
  return new Promise(resolve => {
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve() }, 8000)
  })
}

const MAX_SHOT_WIDTH = 720

async function captureScreenshot(tabId, tabWidth) {
  const dataUrl = await chrome.tabs.captureVisibleTab(tabId, { format: 'jpeg', quality: 72 })
  // OffscreenCanvas 压到 ≤720px 宽,保 0.625 比例裁高
  const image = await createImageBitmap(await (await fetch(dataUrl)).blob())
  const width = Math.min(image.width, tabWidth ?? image.width, MAX_SHOT_WIDTH)
  const height = Math.round(width * 0.625)
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d').drawImage(image, 0, 0, width, height)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.68 })
  const buffer = await blob.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return `data:image/jpeg;base64,${btoa(binary)}`
}

/** 打开采集界面:优先 side panel;浏览器不支持(如部分 Chromium 分支)或打开失败时
 *  退回整页打开——保证工具栏点击永远有可见响应,绝不静默。 */
async function openCaptureUI(windowId) {
  try {
    await chrome.sidePanel.open({ windowId })
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL('panel/panel.html') })
  }
}

/** 采集会话:每窗口一份,侧栏经 storage.onChanged 订阅(面板开着也要能刷新)。
 *  先直接读页(activeTab / Edge 站点开关通常已覆盖当前站),读不动才申请 <all_urls>;
 *  同窗口 3 秒内已在跑的任务不重入(点击与面板初始化都会调它)。 */
async function startCapture() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) return
  const key = `capture-${tab.windowId}`
  const existing = (await chrome.storage.session.get(key))[key]
  if (existing?.loading && Date.now() - existing.at < 3000) return
  try {
    await openCaptureUI(tab.windowId)
    await chrome.storage.session.set({ [key]: { loading: true, at: Date.now() } })
    let payload
    try {
      payload = await captureTab()
    } catch (err) {
      // 只有权限类错误才借手势申请 <all_urls> 重试;chrome:// 页等「不该读」的错误原样上报
      if (!/Cannot access contents|permission/i.test(String(err.message)) || await hasAllUrls()) throw err
      await chrome.permissions.request({ origins: ['<all_urls>'] })
      payload = await captureTab()
    }
    await chrome.storage.session.set({ [key]: { ...payload, loading: false, at: Date.now() } })
    chrome.action.setBadgeText({ text: '' })
  } catch (err) {
    // 采集失败要让人看见:角标叹号 + 会话错误(面板渲染成可操作的错误态)
    chrome.action.setBadgeBackgroundColor({ color: '#d13c35' })
    chrome.action.setBadgeText({ text: '!' })
    await chrome.storage.session.set({ [key]: { error: String(err.message || err), loading: false, at: Date.now() } })
  }
}

chrome.action.onClicked.addListener(() => { startCapture() })

chrome.runtime.onInstalled.addListener(async () => {
  try { await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false }) } catch { /* 引擎不支持 side panel */ }
  // 新手引导:装完还没配过 Token 就直接打开设置页,给三步指引,不让用户对着空点击发呆
  const { bridgeToken } = await chrome.storage.local.get('bridgeToken')
  if (!bridgeToken) chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html') })
})

// 侧栏 → SW 的动作:保存采集、重读页面
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'bridge-status-poll') {
    sendResponse({ status: bridge.status })
    return
  }
  if (message?.type === 'capture-save') {
    deliverCapture(message.payload).then(sendResponse)
    return true
  }
  if (message?.type === 'capture-retry') {
    startCapture()
    sendResponse({ ok: true })
    return
  }
  if (message?.type === 'capture-copy') {
    navigator.clipboard.writeText(message.text).catch(() => {})
    sendResponse({ ok: true })
    return
  }
})

/** 采集送桥:桥不在/宿主不在都会在这里得到明确错误,由侧栏展示。 */
async function deliverCapture(payload) {
  const operationId = `cap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  try {
    const result = await bridge.request('capture', {
      operationId,
      url: payload.url,
      title: payload.title ?? '',
      body: payload.body ?? '',
      siteName: payload.siteName ?? '',
      tags: payload.tags ?? [],
      cover: payload.cover ?? null,
    }, 45000)
    return { ok: true, itemId: result?.itemId, duplicate: result?.duplicate }
  } catch (err) {
    return { ok: false, error: String(err.message || err), markdown: buildMarkdown(payload) }
  }
}

function buildMarkdown(payload) {
  return `# ${payload.title ?? ''}\n\n> ${payload.url}\n\n${payload.body ?? ''}`
}

/** 桥 → 扩展 的三个请求。 */
async function handleBridgeRequest(method, params) {
  switch (method) {
    case 'publish': {
      // 任务到达先拉起对话框页(用户刚在工作台点了投递,几秒内的期待),再跑任务
      await chrome.storage.session.set({ [`publish-${params.operationId}`]: { operationId: params.operationId, title: params.title, platforms: params.platforms, results: null } })
      chrome.tabs.create({ url: chrome.runtime.getURL(`dialog/dialog.html?op=${params.operationId}`) })
      return runPublishTask(params)
    }
    case 'platforms': return listPlatforms(params)
    case 'extract': {
      const payload = await captureTab()
      return { title: payload.title, markdown: buildMarkdown(payload) }
    }
    default:
      throw new Error(`扩展不支持方法 ${method}`)
  }
}

bridge.loadConfig().then(() => bridge.start())
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.bridgeToken || changes.bridgeUrl)) {
    bridge.loadConfig().then(() => bridge.start())
  }
})

// 调试挂钩(仅测试用,E2E 经 CDP 在 SW 里驱动真实数据流;不承载任何产品逻辑)
self.__wdeskDebug = {
  bridge: () => ({ status: bridge.status, connected: bridge.connected }),
  capture: () => captureTab(),
  deliver: payload => deliverCapture(payload),
  publish: params => runPublishTask(params),
}
