import {
  initAdapters,
  checkAllPlatformsAuth,
  checkPlatformAuth,
  getAllPlatformMetas,
  cancelSync,
  getPlatformPreprocessConfigs,
} from '../adapters'
import * as wordpressAdapter from '../adapters/cms/wordpress'
import * as metaweblogAdapter from '../adapters/cms/metaweblog'
import { startBridgeClient, bridgeClient, getBridgeStatus, type CapturePayload } from '../bridge/client'
import { createLogger } from '../lib/logger'
import { initI18n, t } from '../lib/i18n'
import { checkSyncFrequency, recordSync } from '../lib/rate-limit'
import {
  performSync,
  generateSyncId,
  saveSyncState,
  clearSyncState,
  SYNC_STATE_KEY,
  type ActiveSyncState,
} from './sync-service'

const logger = createLogger('Background')

initI18n()

type CMSType = 'wordpress' | 'typecho' | 'metaweblog'

// 消息类型
type MessageAction =
  | { type: 'GET_PLATFORMS' }
  | { type: 'CHECK_ALL_AUTH'; payload?: { forceRefresh?: boolean } }
  | { type: 'CHECK_AUTH'; payload: { platformId: string } }
  | { type: 'SYNC_ARTICLE'; payload: { article: any; platforms: string[]; allSelectedPlatforms?: string[]; skipHistory?: boolean; source?: string; syncId?: string } }
  | { type: 'OPEN_SYNC_PAGE'; path?: string }
  | { type: 'TEST_CMS_CONNECTION'; payload: { type: CMSType; url: string; username: string; password: string } }
  | { type: 'SYNC_TO_CMS'; payload: { accountId: string; article: any } }
  | { type: 'BRIDGE_STATUS' }
  | { type: 'BRIDGE_WATCH_START' }
  | { type: 'BRIDGE_WATCH_STOP' }
  | { type: 'STASH_EXTRACT'; payload?: { tabId?: number } }
  | { type: 'STASH_CATALOG' }
  | { type: 'STASH_SAVE'; payload: CapturePayload }
  | { type: 'GET_SYNC_STATE' }
  | { type: 'CLEAR_SYNC_STATE' }
  | { type: 'UPDATE_SYNC_STATUS'; payload: { status: 'syncing' | 'completed' } }
  | { type: 'CANCEL_SYNC' }
  | { type: 'GET_PREPROCESS_CONFIGS'; platforms: string[] }
  | { type: 'TRIGGER_SYNC' }

/**
 * 消息处理
 */
chrome.runtime.onMessage.addListener((message: MessageAction, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(error => sendResponse({ error: error.message }))

  return true // 异步响应
})

async function handleMessage(message: MessageAction, sender?: chrome.runtime.MessageSender) {
  switch (message.type) {
    case 'GET_PLATFORMS': {
      await initAdapters()
      const platforms = getAllPlatformMetas()
      return { platforms }
    }

    case 'CHECK_ALL_AUTH': {
      const forceRefresh = message.payload?.forceRefresh ?? false
      const dslPlatforms = await checkAllPlatformsAuth(forceRefresh)

      // 为 DSL 平台添加 sourceType
      const dslWithType = dslPlatforms.map((p: any) => ({
        ...p,
        sourceType: 'dsl' as const,
      }))

      // 同时加载 CMS 账户
      const cmsStorage = await chrome.storage.local.get('cmsAccounts')
      const cmsAccounts = cmsStorage.cmsAccounts || []
      const cmsPlatforms = cmsAccounts
        .filter((a: any) => a.isConnected)
        .map((a: any) => ({
          id: a.id,
          name: a.name,
          icon: getCmsIcon(a.type),
          homepage: a.url,
          isAuthenticated: true,
          username: a.username,
          sourceType: 'cms' as const,
          cmsType: a.type,
        }))

      const allPlatforms = [...dslWithType, ...cmsPlatforms]
      // 缓存完整平台列表，供 popup 启动时立即渲染
      chrome.storage.local.set({ platformListCache: allPlatforms }).catch(() => {})
      return { platforms: allPlatforms }
    }

    case 'CHECK_AUTH': {
      const { platformId } = message.payload
      const auth = await checkPlatformAuth(platformId)
      return { auth }
    }

    case 'SYNC_ARTICLE': {
      const { article, platforms, allSelectedPlatforms, skipHistory, source = 'popup', syncId: passedSyncId } = message.payload
      const senderTabId = sender?.tab?.id

      const rateLimitWarning = await checkSyncFrequency(platforms)

      const syncId = passedSyncId || generateSyncId()

      const sendProgress = (msg: Record<string, unknown>) => {
        const msgWithSyncId = { ...msg, syncId }
        chrome.runtime.sendMessage(msgWithSyncId).catch(() => {})
        if (senderTabId) {
          chrome.tabs.sendMessage(senderTabId, msgWithSyncId).catch(() => {})
        }
      }

      const { results: allResults } = await performSync(
        article,
        platforms,
        {
          skipHistory,
          source,
          syncId,
          allSelectedPlatforms,
          // 预处理统一走 performSync 内部的 sendPreprocessMessage
          // （活动标签页 → 全部标签页 → 临时标签页三级 fallback）
        },
        {
          onResult: (result) => {
            sendProgress({ type: 'SYNC_PROGRESS', payload: { result } })
          },
          onImageProgress: (platform, current, total) => {
            sendProgress({ type: 'IMAGE_PROGRESS', payload: { platform, current, total } })
          },
          onDetailProgress: (progress) => {
            sendProgress({ type: 'SYNC_DETAIL_PROGRESS', payload: progress })
          },
        }
      )

      const successfulPlatforms = allResults
        .filter(r => r.success)
        .map(r => r.platform)
      if (successfulPlatforms.length > 0) {
        recordSync(successfulPlatforms).catch(() => {})
      }

      return { results: allResults, rateLimitWarning, syncId }
    }

    case 'OPEN_SYNC_PAGE': {
      await openSyncWindow(message.path || '')
      return { success: true }
    }

    case 'TEST_CMS_CONNECTION': {
      const { type, url, username, password } = message.payload
      const credentials = { url, username, password }

      try {
        let result
        switch (type) {
          case 'wordpress':
            result = await wordpressAdapter.testConnection(credentials)
            break
          case 'typecho':
            result = await metaweblogAdapter.testTypechoConnection(credentials)
            break
          case 'metaweblog':
            result = await metaweblogAdapter.testConnection(credentials)
            break
          default:
            return { success: false, error: t('不支持的 CMS 类型') }
        }
        return result
      } catch (error) {
        return { success: false, error: (error as Error).message }
      }
    }

    case 'SYNC_TO_CMS': {
      const { accountId, article } = message.payload

      try {
        // 获取账户信息
        const storage = await chrome.storage.local.get(['cmsAccounts', `cms_pwd_${accountId}`])
        const accounts = storage.cmsAccounts || []
        const account = accounts.find((a: any) => a.id === accountId)

        if (!account) {
          return { success: false, error: t('账户不存在') }
        }

        const password = storage[`cms_pwd_${accountId}`]
        if (!password) {
          return { success: false, error: t('密码未找到，请重新添加账户') }
        }

        const credentials = {
          url: account.url,
          username: account.username,
          password,
        }

        let result
        switch (account.type) {
          case 'wordpress':
            result = await wordpressAdapter.publish(credentials, article, { draftOnly: true })
            break
          case 'typecho':
            result = await metaweblogAdapter.publishToTypecho(credentials, article, { draftOnly: true })
            break
          case 'metaweblog':
            result = await metaweblogAdapter.publish(credentials, article, { draftOnly: true })
            break
          default:
            return { success: false, error: t('不支持的 CMS 类型') }
        }

        // 更新同步状态（用于 popup 恢复）
        const currentState = await chrome.storage.local.get(SYNC_STATE_KEY)
        const syncState = currentState[SYNC_STATE_KEY] as ActiveSyncState | undefined
        if (syncState) {
          const cmsResult = {
            platform: accountId,
            platformName: account.name,
            success: result.success,
            postUrl: result.postUrl,
            draftOnly: true,
            error: result.error,
          }
          syncState.results.push(cmsResult)
          await saveSyncState(syncState)
        }

        // 记录同步频率
        if (result.success) {
          recordSync([accountId]).catch(() => {})
        }

        return {
          platform: account.name,
          success: result.success,
          postUrl: result.postUrl,
          postId: result.postId,
          error: result.error,
          draftOnly: true,
          timestamp: Date.now(),
        }
      } catch (error) {
        // 更新同步状态（记录失败）
        const currentState = await chrome.storage.local.get(SYNC_STATE_KEY)
        const syncState = currentState[SYNC_STATE_KEY] as ActiveSyncState | undefined
        if (syncState) {
          const cmsResult = {
            platform: accountId,
            platformName: accountId,
            success: false,
            error: (error as Error).message,
          }
          syncState.results.push(cmsResult)
          await saveSyncState(syncState)
        }
        return { success: false, error: (error as Error).message }
      }
    }

    case 'BRIDGE_WATCH_START': {
      // 面板/设置页打开期间开长端口,投递与收进回执近实时
      bridgeClient.setActivelyWatched(true)
      return { success: true }
    }

    case 'BRIDGE_WATCH_STOP': {
      bridgeClient.setActivelyWatched(false)
      return { success: true }
    }

    case 'BRIDGE_STATUS': {
      // 配对状态(ADR 0012):paired = NM 通路可用;lastError 供排障
      return await getBridgeStatus()
    }

    case 'STASH_EXTRACT': {
      return extractStashEntry(message.payload?.tabId)
    }

    case 'STASH_CATALOG': {
      try {
        return await bridgeClient.getCatalog()
      } catch (error) {
        logger.debug('Catalog unavailable, using empty table:', error)
        return { at: new Date().toISOString(), tags: [], urls: {} }
      }
    }

    case 'STASH_SAVE': {
      const payload = message.payload
      const markdown = buildCaptureMarkdown(payload)
      try {
        const result = await bridgeClient.saveCapture(payload)
        if (!result.ok) {
          return { ok: false, error: result.error || t('工作台未能收进该网页'), markdown }
        }
        return {
          ok: true,
          operationId: result.operationId,
          itemId: result.itemId,
          duplicate: result.duplicate ?? false,
          replaced: result.replaced ?? false,
        }
      } catch (error) {
        return { ok: false, error: errorMessage(error, t('收进失败')), markdown }
      }
    }

    case 'GET_SYNC_STATE': {
      const storage = await chrome.storage.local.get(SYNC_STATE_KEY)
      return { syncState: storage[SYNC_STATE_KEY] || null }
    }

    case 'CLEAR_SYNC_STATE': {
      await clearSyncState()
      return { success: true }
    }

    case 'UPDATE_SYNC_STATUS': {
      const { status } = message.payload
      const currentState = await chrome.storage.local.get(SYNC_STATE_KEY)
      const syncState = currentState[SYNC_STATE_KEY] as ActiveSyncState | undefined
      if (syncState) {
        syncState.status = status
        await saveSyncState(syncState)
      }
      return { success: true }
    }

    case 'CANCEL_SYNC': {
      const cancelled = cancelSync()
      logger.info('Sync cancelled:', cancelled)
      return { success: cancelled }
    }

    case 'GET_PREPROCESS_CONFIGS': {
      // 获取平台预处理配置（供 content script 使用）
      await initAdapters()
      const configs = getPlatformPreprocessConfigs(message.platforms)
      // 用户的深度格式清理设置在此注入，同步路径预计算 platformContents 时才能生效
      const { deepCleanEnabled = false } = await chrome.storage.local.get('deepCleanEnabled')
      for (const key of Object.keys(configs)) {
        configs[key] = { ...configs[key], normalizeViaMarkdown: deepCleanEnabled }
      }
      return { configs }
    }

    case 'TRIGGER_SYNC': {
      // FAB on regular article pages: open the side panel on /sync. The side
      // panel API only opens on a user gesture, so a failed call falls back to
      // a small popup window on the same route.
      const tabId = sender?.tab?.id
      // 不 await：sidePanel.open 需要尽量贴着用户手势调用
      const routeReady = chrome.storage.local.set({ panelRoute: '/sync' }).catch(() => {})

      if (tabId !== undefined) {
        try {
          await chrome.sidePanel.open({ tabId })
          await routeReady
          chrome.runtime.sendMessage({ type: 'PANEL_NAVIGATE', path: '/sync' }).catch(() => {})
          return { success: true, mode: 'sidepanel' }
        } catch (error) {
          logger.debug('Side panel open failed, falling back to sync window:', error)
          await routeReady
          await chrome.storage.local.remove('panelRoute')
        }
      }

      // The fallback window's active tab is the panel itself, so carry the
      // article over through storage before opening it.
      if (tabId !== undefined) {
        try {
          const response = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_ARTICLE' })
          if (response?.article) {
            await chrome.storage.local.set({ pendingArticle: response.article })
          }
        } catch {
          // Page not extractable; the sync page shows its empty state.
        }
      }

      await openSyncWindow('/sync')
      return { success: true, mode: 'window' }
    }

    default:
      return { error: 'Unknown message type' }
  }
}

/**
 * Open the popup page as a compact 396x560 window (fallback when the side
 * panel cannot be opened programmatically).
 */
async function openSyncWindow(path = '') {
  const url = chrome.runtime.getURL('src/popup/index.html') + (path ? `#${path}` : '')
  const width = 396
  const height = 560

  const currentWindow = await chrome.windows.getCurrent()
  const left = currentWindow.left !== undefined && currentWindow.width !== undefined
    ? Math.round(currentWindow.left + (currentWindow.width - width) / 2)
    : undefined
  const top = currentWindow.top !== undefined && currentWindow.height !== undefined
    ? Math.round(currentWindow.top + (currentWindow.height - height) / 2)
    : undefined

  await chrome.windows.create({
    url,
    type: 'popup',
    width,
    height,
    left,
    top,
    focused: true,
  })
}

// CMS 图标
function getCmsIcon(type: string): string {
  switch (type) {
    case 'wordpress':
      return 'https://s.w.org/style/images/about/WordPress-logotype-simplified.png'
    case 'typecho':
      return chrome.runtime.getURL('assets/typecho.ico')
    case 'metaweblog':
      return 'https://www.cnblogs.com/favicon.ico'
    default:
      return chrome.runtime.getURL('assets/icon-48.png')
  }
}

// ============ 收进（Stash capture）============

const STASH_BODY_LIMIT = 20000

interface StashEntry {
  url: string
  title: string
  body: string
  siteName: string
  cover?: string
  captureMethod: 'selection' | 'page'
  truncated: boolean
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

function siteNameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function buildStashEntry(input: Omit<StashEntry, 'truncated'>): StashEntry {
  const truncated = input.body.length > STASH_BODY_LIMIT
  return {
    ...input,
    body: truncated ? input.body.slice(0, STASH_BODY_LIMIT) : input.body,
    truncated,
  }
}

/** Markdown 提取通常把标题也带成 H1；标题字段已有它时，正文不再重复一遍。 */
function stripLeadingHeading(body: string, title: string): string {
  if (!title) return body
  const normalized = body.replace(/\r\n/g, '\n').trimStart()
  const heading = `# ${title.trim()}`
  if (!normalized.startsWith(heading)) return body
  const rest = normalized.slice(heading.length)
  return rest.startsWith('\n') ? rest.slice(1) : rest
}

function buildCaptureMarkdown(payload: CapturePayload): string {
  const title = typeof payload?.title === 'string' ? payload.title : ''
  const url = typeof payload?.url === 'string' ? payload.url : ''
  const body = typeof payload?.body === 'string' ? payload.body : ''
  return `# ${title}\n\n> ${url}\n\n${body}`
}

/**
 * 收进提取：选区优先；选区为空或内容脚本不支持时回退整页文章提取。
 */
async function extractStashEntry(tabId?: number): Promise<{ ok: true; entry: StashEntry } | { ok: false; error: string }> {
  try {
    // 侧栏正常读活动标签；从 fallback 窗口或测试入口进来时可显式指定原页面。
    const explicitTab = Number.isInteger(tabId) ? await chrome.tabs.get(tabId!).catch(() => null) : null
    const [activeTab] = explicitTab ? [explicitTab] : await chrome.tabs.query({ active: true, currentWindow: true })
    const tab = activeTab
    if (!tab?.id) return { ok: false, error: t('没有活动标签页') }

    const pageUrl = tab.url || ''
    if (!/^https?:\/\//.test(pageUrl)) {
      return { ok: false, error: t('当前页不支持提取') }
    }

    // 选区提取由内容脚本实现；返回体做宽松归一，未实现时 message 会直接失败
    let selection: any = null
    try {
      const response: any = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_SELECTION' })
      selection = response?.selection ?? response?.article ?? response ?? null
    } catch {
      // 忽略，回退整页提取
    }

    const selectionBody = typeof selection === 'string'
      ? selection
      : firstString(selection?.markdown, selection?.text, selection?.body, selection?.content)
    if (selectionBody.trim()) {
      return {
        ok: true,
        entry: buildStashEntry({
          url: firstString(selection?.url, pageUrl),
          title: firstString(selection?.title, tab.title),
          body: stripLeadingHeading(selectionBody, firstString(selection?.title, tab.title) || ''),
          siteName: firstString(selection?.siteName, siteNameFromUrl(pageUrl)),
          cover: firstString(selection?.cover) || undefined,
          captureMethod: 'selection',
        }),
      }
    }

    let article: any = null
    try {
      const response: any = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' })
      article = response?.article ?? null
    } catch (error) {
      return { ok: false, error: errorMessage(error, t('无法连接当前页提取脚本')) }
    }

    if (!article) return { ok: false, error: t('未能提取当前页正文') }

    const body = firstString(article.markdown, article.content, article.text, article.html)
    if (!body.trim()) return { ok: false, error: t('当前页没有可收进的正文') }

    return {
      ok: true,
      entry: buildStashEntry({
        url: firstString(article.source?.url, pageUrl),
        title: firstString(article.title, tab.title),
        body: stripLeadingHeading(body, firstString(article.title, tab.title) || ''),
        siteName: firstString(article.siteName, siteNameFromUrl(pageUrl)),
        cover: firstString(article.cover) || undefined,
        captureMethod: 'page',
      }),
    }
  } catch (error) {
    return { ok: false, error: errorMessage(error, t('提取失败')) }
  }
}

/**
 * 扩展安装/更新
 */
chrome.runtime.onInstalled.addListener(async details => {
  logger.info(' Installed:', details.reason, details.previousVersion)

  // 预加载适配器
  await initAdapters()
})

// WS 桥时代的存储全部退役(ADR 0012):token/开关/地址不再有任何意义,一次性清掉。
const LEGACY_BRIDGE_KEYS = ['mcpEnabled', 'mcpToken', 'mcpServerUrl', 'bridgeEnabled', 'bridgeToken', 'bridgeServerUrl'] as const

async function migrateLegacyBridgeSettings(): Promise<void> {
  await chrome.storage.local.remove([...LEGACY_BRIDGE_KEYS]).catch(() => {})
}

// 启动:清旧键,踢一次任务拉取(alarm 未注册前的第一拍)
migrateLegacyBridgeSettings().finally(() => startBridgeClient())

// SW 休眠期的投递兜底:30 秒一次一次性拉(alarm 下限 0.5 分钟)
const BRIDGE_POLL_ALARM = 'bridge-poll'
chrome.alarms.create(BRIDGE_POLL_ALARM, { periodInMinutes: 0.5, delayInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== BRIDGE_POLL_ALARM) return
  void bridgeClient.processPendingTasks()
})

/**
 * 预检查平台认证状态（后台静默执行）
 * 在扩展启动/安装时预热缓存，提升 popup 打开速度
 */
async function preCheckPlatformsAuth() {
  logger.info(' Pre-checking platform auth...')
  try {
    await checkAllPlatformsAuth(false) // 使用缓存，不强制刷新
    logger.info(' Pre-check completed')
  } catch (error) {
    logger.error(' Pre-check failed:', error)
  }
}

// 浏览器启动时预检查
chrome.runtime.onStartup.addListener(() => {
  logger.info(' Browser started, pre-checking auth...')
  preCheckPlatformsAuth()
})

// Service Worker 激活时也预检查（首次加载或唤醒）
preCheckPlatformsAuth()

/**
 * 清理遗留的动态规则（防止扩展崩溃后规则残留影响其他网站）
 */
async function clearOrphanedRules() {
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules()
    if (rules.length > 0) {
      logger.info(`Clearing ${rules.length} orphaned dynamic rules...`)
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rules.map(r => r.id),
      })
      logger.info('Orphaned rules cleared')
    }
  } catch (error) {
    logger.error('Failed to clear orphaned rules:', error)
  }
}

// 启动时清理遗留规则
clearOrphanedRules()

// 工具栏图标点击直接打开侧栏（popup 已退役；此设置与 default_popup 互斥）
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => {
  logger.error('Failed to enable side panel on action click:', error)
})

logger.info('Service Worker started')
