import { create } from 'zustand'
import { checkSyncFrequency } from '../../lib/rate-limit'
import { createLogger } from '../../lib/logger'
import { t } from '../../lib/i18n'

const logger = createLogger('SyncStore')

interface Platform {
  id: string
  name: string
  icon: string
  homepage: string
  isAuthenticated: boolean
  username?: string
  avatar?: string
  // 区分平台类型：dsl 为 DSL 定义的平台，cms 为自建站点
  sourceType: 'dsl' | 'cms'
  // CMS 类型（仅 cms 类型有效）
  cmsType?: 'wordpress' | 'typecho' | 'metaweblog'
}

interface Article {
  title: string
  content: string
  summary?: string
  cover?: string
  // 工作台投递时保留 Markdown 原文，供 background 的 performSync 使用
  markdown?: string
}

// 工作台经本地服务 syncArticle 投递的同步任务（client.ts 在 performSync 前写入）
interface PendingSyncTask {
  operationId?: string
  itemId?: string
  title: string
  platforms: string[]
  article: {
    title: string
    content?: string
    markdown?: string
    cover?: string
  }
  syncId: string
  at: number
}

interface DeskTaskInfo {
  operationId?: string
  itemId?: string
  title: string
  syncId: string
}

interface SyncResult {
  platform: string
  platformName?: string
  success: boolean
  postUrl?: string
  draftOnly?: boolean
  error?: string
}

interface ImageProgress {
  platform: string
  current: number
  total: number
}

// 同步阶段类型
type SyncStage = 'starting' | 'uploading_images' | 'saving' | 'completed' | 'failed'

// 平台同步详细进度
interface PlatformProgress {
  platform: string
  platformName: string
  stage: SyncStage
  imageProgress?: { current: number; total: number }
  error?: string
}

type SyncHistoryStatus = 'syncing' | 'completed' | 'failed' | 'cancelled'

interface SyncHistoryItem {
  id: string  // syncId
  status: SyncHistoryStatus
  title: string
  cover?: string
  platforms: string[]  // 选中的平台ID列表
  results: SyncResult[]
  startTime: number
  endTime?: number
  // 兼容旧格式
  timestamp?: number
}

interface SyncState {
  // 状态
  status: 'loading' | 'idle' | 'syncing' | 'completed' | 'failed' | 'cancelled'
  article: Article | null
  platforms: Platform[]
  selectedPlatforms: string[]
  hiddenPlatforms: string[]
  results: SyncResult[]
  error: string | null

  // 当前同步任务ID（用于过滤消息）
  currentSyncId: string | null

  // 图片上传进度
  imageProgress: ImageProgress | null

  // 平台详细同步进度
  platformProgress: Map<string, PlatformProgress>

  // 同步历史
  history: SyncHistoryItem[]

  // 是否已恢复状态
  recovered: boolean

  // 当前同步是否来自工作台投递（仅用于页面提示）
  deskTask: DeskTaskInfo | null

  // 频率限制警告
  rateLimitWarning: string | null

  // Actions
  loadPlatforms: () => Promise<void>
  loadArticle: (force?: boolean) => Promise<void>
  reloadArticle: (force?: boolean) => Promise<void>
  loadHistory: () => Promise<void>
  recoverSyncState: (force?: boolean) => Promise<void>
  togglePlatform: (platformId: string) => void
  setHiddenPlatforms: (ids: string[]) => void
  selectAll: () => void
  deselectAll: () => void
  checkRateLimit: () => Promise<string | null>
  startSync: () => Promise<void>
  retryFailed: () => Promise<void>
  reset: () => void
  updateProgress: (result: SyncResult, syncId?: string) => void
  updateImageProgress: (progress: ImageProgress | null) => void
  updateDetailProgress: (progress: PlatformProgress, syncId?: string) => void
  clearSyncState: () => Promise<void>
  updateArticle: (updates: Partial<Article>) => void
  clearRateLimitWarning: () => void
}

// 最大历史记录数
const MAX_HISTORY_ITEMS = 25

// Storage key for selected platforms
const SELECTED_PLATFORMS_KEY = 'selectedPlatforms'

// 保存选中的平台到 storage
async function saveSelectedPlatforms(platformIds: string[]) {
  try {
    await chrome.storage.local.set({ [SELECTED_PLATFORMS_KEY]: platformIds })
  } catch (e) {
    logger.error('Failed to save selected platforms:', e)
  }
}

// 从 storage 加载选中的平台
async function loadSelectedPlatforms(): Promise<string[] | null> {
  try {
    const result = await chrome.storage.local.get(SELECTED_PLATFORMS_KEY)
    return result[SELECTED_PLATFORMS_KEY] || null
  } catch (e) {
    logger.error('Failed to load selected platforms:', e)
    return null
  }
}

const PENDING_SYNC_TASK_KEY = 'pendingSyncTask'

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function normalizePendingSyncTask(value: unknown): PendingSyncTask | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const syncId = optionalString(raw.syncId)
  if (!syncId) return null

  const rawArticle = raw.article && typeof raw.article === 'object'
    ? raw.article as Record<string, unknown>
    : {}
  const title = optionalString(rawArticle.title) || optionalString(raw.title)
  if (!title) return null

  return {
    operationId: optionalString(raw.operationId),
    itemId: optionalString(raw.itemId),
    title,
    platforms: Array.isArray(raw.platforms)
      ? raw.platforms.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [],
    article: {
      title,
      content: optionalString(rawArticle.content),
      markdown: optionalString(rawArticle.markdown),
      cover: optionalString(rawArticle.cover),
    },
    syncId,
    at: typeof raw.at === 'number' ? raw.at : Date.now(),
  }
}

async function readPendingSyncTask(): Promise<PendingSyncTask | null> {
  try {
    const storage = await chrome.storage.local.get(PENDING_SYNC_TASK_KEY)
    return normalizePendingSyncTask(storage[PENDING_SYNC_TASK_KEY])
  } catch (e) {
    logger.error('Failed to read pending sync task:', e)
    return null
  }
}

// 页面读取即清理：任务只负责把页面带入同步中状态，后续由 activeSyncState / 进度消息接管
async function consumePendingSyncTask(): Promise<PendingSyncTask | null> {
  try {
    const storage = await chrome.storage.local.get(PENDING_SYNC_TASK_KEY)
    if (!storage[PENDING_SYNC_TASK_KEY]) return null
    const task = normalizePendingSyncTask(storage[PENDING_SYNC_TASK_KEY])
    await chrome.storage.local.remove(PENDING_SYNC_TASK_KEY)
    return task
  } catch (e) {
    logger.error('Failed to consume pending sync task:', e)
    return null
  }
}

function pendingTaskToArticle(task: PendingSyncTask): Article {
  return {
    title: task.article.title,
    content: task.article.content || '',
    markdown: task.article.markdown,
    cover: task.article.cover,
  }
}

function pendingTaskState(task: PendingSyncTask): Partial<SyncState> {
  return {
    status: 'syncing',
    article: pendingTaskToArticle(task),
    selectedPlatforms: task.platforms,
    results: [],
    error: null,
    imageProgress: null,
    platformProgress: new Map<string, PlatformProgress>(),
    currentSyncId: task.syncId,
    deskTask: {
      operationId: task.operationId,
      itemId: task.itemId,
      title: task.title,
      syncId: task.syncId,
    },
    recovered: true,
  }
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: 'loading',
  article: null,
  platforms: [],
  selectedPlatforms: [],
  hiddenPlatforms: [],
  results: [],
  error: null,
  currentSyncId: null,
  imageProgress: null,
  platformProgress: new Map(),
  history: [],
  recovered: false,
  deskTask: null,
  rateLimitWarning: null,

  recoverSyncState: async (force = false) => {
    // 避免重复恢复
    if (get().recovered && !force) return

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATE' })
      const syncState = response?.syncState
      const pendingTask = await readPendingSyncTask()
      const sameTask = !!(syncState && pendingTask && pendingTask.syncId === syncState.syncId)

      if (syncState && (!pendingTask || sameTask)) {
        logger.debug('Recovering sync state:', syncState.status, syncState.syncId)

        set({
          status: syncState.status,
          article: syncState.article,
          selectedPlatforms: Array.isArray(syncState.selectedPlatforms) ? syncState.selectedPlatforms : [],
          results: syncState.results || [],
          currentSyncId: syncState.syncId || null,
          // 同一 syncId 的 pending 任务只补充投递来源提示，状态以 activeSyncState 为准
          deskTask: sameTask && pendingTask
            ? {
                operationId: pendingTask.operationId,
                itemId: pendingTask.itemId,
                title: pendingTask.title,
                syncId: pendingTask.syncId,
              }
            : null,
          recovered: true,
        })

        if (sameTask) {
          await chrome.storage.local.remove(PENDING_SYNC_TASK_KEY)
        }

        // 如果是同步中状态，继续监听进度
        if (syncState.status === 'syncing') {
          logger.debug('Sync in progress, listening for updates...')
        }
        return
      }

      // 没有 activeSyncState（或它属于另一次同步）时，用工作台投递的任务初始化
      if (pendingTask) {
        logger.debug('Recovering pending sync task:', pendingTask.syncId)
        set(pendingTaskState(pendingTask))
        await chrome.storage.local.remove(PENDING_SYNC_TASK_KEY)
        return
      }

      set({ recovered: true })
    } catch (error) {
      logger.error('Failed to recover sync state:', error)
      set({ recovered: true })
    }
  },

  clearSyncState: async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_SYNC_STATE' })
    } catch (error) {
      logger.error('Failed to clear sync state:', error)
    }
  },

  updateArticle: (updates) => {
    const currentArticle = get().article
    if (currentArticle) {
      set({
        article: {
          ...currentArticle,
          ...updates,
        },
      })
    }
  },

  loadPlatforms: async () => {
    // 同步中或已到终态时，不覆盖状态
    const currentStatus = get().status
    const preserveStatus = currentStatus === 'syncing' || currentStatus === 'completed'
      || currentStatus === 'failed' || currentStatus === 'cancelled'

    if (!preserveStatus) {
      set({ status: 'loading' })
    }

    try {
      // CHECK_ALL_AUTH 现在返回 DSL 和 CMS 合并的列表
      const platformResponse = await chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH' })

      // 只保留已认证的平台
      const allPlatforms: Platform[] = (platformResponse.platforms || [])
        .filter((p: any) => p.isAuthenticated)

      // 加载保存的平台选择和隐藏配置
      const savedSelections = await loadSelectedPlatforms()
      const hiddenResult = await chrome.storage.local.get('hiddenPlatforms')
      const hiddenPlatforms: string[] = hiddenResult.hiddenPlatforms || []
      const authenticatedIds = allPlatforms.map(p => p.id)

      // 过滤出仍然有效的已选平台（已登录且未被隐藏）
      let selectedPlatforms: string[] = []
      if (savedSelections && savedSelections.length > 0) {
        selectedPlatforms = savedSelections.filter(
          id => authenticatedIds.includes(id) && !hiddenPlatforms.includes(id)
        )
      }

      // 同步中或终态时，只更新平台列表，不改变状态和选择
      if (preserveStatus) {
        set({ platforms: allPlatforms, hiddenPlatforms })
      } else {
        set({ platforms: allPlatforms, status: 'idle', selectedPlatforms, hiddenPlatforms })
      }
    } catch (error) {
      logger.error('Failed to load platforms:', error)
      if (!preserveStatus) {
        set({ status: 'idle', error: (error as Error).message })
      }
    }
  },

  loadArticle: async (force = false) => {
    // 如果已有恢复的文章（同步中/终态），不覆盖；force 仅用于工作台新任务投递
    const { article: existingArticle, status } = get()
    const settled = status === 'syncing' || status === 'completed'
      || status === 'failed' || status === 'cancelled'
    if (existingArticle && settled && !force) {
      logger.debug('loadArticle - skipped, using recovered article')
      return
    }

    try {
      // 工作台投递优先：任务自带 syncId / 平台，先于页面按钮的 pendingArticle
      const task = await consumePendingSyncTask()
      if (task) {
        logger.debug('loadArticle - applying pending sync task:', task.title)
        set(pendingTaskState(task))
        return
      }

      // 同步进行中时文章归同步任务持有，不能让标签页提取覆盖
      if (status === 'syncing') return

      // 显式刷新终态页面时，先退出旧结果展示
      if (force && settled) {
        set({
          status: 'idle',
          results: [],
          error: null,
          imageProgress: null,
          platformProgress: new Map(),
          deskTask: null,
        })
      }

      // 其次检查是否有从页面按钮点击传来的待同步文章
      const storage = await chrome.storage.local.get('pendingArticle')
      if (storage.pendingArticle) {
        logger.debug('loadArticle - found pending article:', storage.pendingArticle.title)
        set({ article: storage.pendingArticle })
        // 清除已读取的文章
        await chrome.storage.local.remove('pendingArticle')
        return
      }

      // 如果没有待同步文章，尝试从当前标签页提取
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      logger.debug('loadArticle - current tab:', tab?.url)
      if (!tab?.id) return

      // 扩展页 / 浏览器内置页没有正文可提取（同步窗口自身也会走到这里），保留已有文章
      if (!tab.url || !/^https?:\/\//.test(tab.url)) return

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_ARTICLE' })
      logger.debug('loadArticle - response:', response)
      if (response?.article) {
        set({ article: response.article })
      } else if (response && response.article === null) {
        // 内容脚本明确表示当前页没有文章，清掉上一页的残留
        set({ article: null })
      }
    } catch (error) {
      // 当前标签页没有注入提取脚本（扩展页、内置页、加载中）是预期情况，
      // 与 background 的同类调用保持一致，不把它当错误上报。
      logger.debug('loadArticle - article extraction unavailable:', error)
    }
  },

  // 当前页刷新：标签切换 / 页面加载完成时重读文章；同步中或终态不打断
  reloadArticle: async (force = false) => {
    const { status } = get()
    const settled = status === 'syncing' || status === 'completed'
      || status === 'failed' || status === 'cancelled'
    if (settled && (!force || status === 'syncing')) return
    await get().loadArticle(force)
  },

  loadHistory: async () => {
    try {
      const storage = await chrome.storage.local.get('syncHistory')
      set({ history: storage.syncHistory || [] })
    } catch (error) {
      logger.error('Failed to load history:', error)
    }
  },

  togglePlatform: (platformId: string) => {
    const { selectedPlatforms } = get()
    const isSelected = selectedPlatforms.includes(platformId)
    const newSelected = isSelected
      ? selectedPlatforms.filter(id => id !== platformId)
      : [...selectedPlatforms, platformId]

    set({ selectedPlatforms: newSelected })

    // 保存到 storage
    saveSelectedPlatforms(newSelected)
  },

  setHiddenPlatforms: (ids) => {
    // 更新隐藏集合，并把已被隐藏的平台从当前选择中裁掉（不写回 storage，
    // 取消隐藏后下次加载仍可恢复选中）
    const { selectedPlatforms } = get()
    set({
      hiddenPlatforms: ids,
      selectedPlatforms: selectedPlatforms.filter(id => !ids.includes(id)),
    })
  },

  selectAll: () => {
    const { platforms, hiddenPlatforms } = get()
    const allIds = platforms
      .filter(p => p.isAuthenticated && !hiddenPlatforms.includes(p.id))
      .map(p => p.id)
    set({ selectedPlatforms: allIds })
    // 保存到 storage
    saveSelectedPlatforms(allIds)
  },

  deselectAll: () => {
    set({ selectedPlatforms: [] })
    // 保存到 storage
    saveSelectedPlatforms([])
  },

  checkRateLimit: async () => {
    const { selectedPlatforms } = get()
    return checkSyncFrequency(selectedPlatforms)
  },

  startSync: async () => {
    const { article, selectedPlatforms, platforms } = get()
    logger.debug('startSync called', { article, selectedPlatforms })

    if (!article) {
      set({ error: t('未检测到文章内容') })
      return
    }

    if (selectedPlatforms.length === 0) {
      set({ error: t('请选择要同步的平台') })
      return
    }

    // 生成 syncId（在发送消息前设置，以便立即过滤消息）
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    set({ status: 'syncing', results: [], error: null, imageProgress: null, platformProgress: new Map(), currentSyncId: syncId })

    try {
      // SYNC_ARTICLE 现在同时处理 DSL 和 CMS 平台
      // 传递 syncId 给 background，background 会用这个 ID
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_ARTICLE',
        payload: { article, platforms: selectedPlatforms, syncId },
      })

      const allResults: SyncResult[] = response.results || []
      const rateLimitWarning: string | null = response.rateLimitWarning || null

      // 为结果添加平台名称（如果 background 没有添加）
      const resultsWithNames = allResults.map((r: SyncResult) => ({
        ...r,
        platformName: r.platformName || platforms.find(p => p.id === r.platform)?.name || r.platform,
      }))

      // 历史记录由 background 保存，这里只刷新显示
      const storage = await chrome.storage.local.get('syncHistory')
      const newHistory: SyncHistoryItem[] = storage.syncHistory || []

      set({
        status: 'completed',
        results: resultsWithNames,
        history: newHistory,
        imageProgress: null,
        rateLimitWarning,
      })

    } catch (error) {
      set({
        error: (error as Error).message,
        status: 'idle',
        imageProgress: null,
      })
    }
  },

  retryFailed: async () => {
    const { article, results, platforms } = get()

    if (!article) {
      set({ error: t('未检测到文章内容') })
      return
    }

    // 获取失败的平台
    const failedPlatformIds = results.filter(r => !r.success).map(r => r.platform)

    if (failedPlatformIds.length === 0) {
      return
    }

    // 保留成功的结果
    const successResults = results.filter(r => r.success)

    // 生成新的 syncId
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    set({ status: 'syncing', results: successResults, error: null, imageProgress: null, platformProgress: new Map(), currentSyncId: syncId })

    try {
      // SYNC_ARTICLE 现在同时处理 DSL 和 CMS 平台
      const response = await chrome.runtime.sendMessage({
        type: 'SYNC_ARTICLE',
        payload: { article, platforms: failedPlatformIds, skipHistory: true, syncId },
      })

      const retryResults: SyncResult[] = response.results || []

      // 为结果添加平台名称（如果 background 没有添加）
      const retryResultsWithNames = retryResults.map((r: SyncResult) => ({
        ...r,
        platformName: r.platformName || platforms.find(p => p.id === r.platform)?.name || r.platform,
      }))

      const allResults = [...successResults, ...retryResultsWithNames]

      // 更新历史记录中最新的条目 - 从 storage 读取
      const storage = await chrome.storage.local.get('syncHistory')
      const existingHistory: SyncHistoryItem[] = storage.syncHistory || []
      if (existingHistory.length > 0) {
        const updatedHistory = [...existingHistory]
        updatedHistory[0] = {
          ...updatedHistory[0],
          results: allResults,
        }
        await chrome.storage.local.set({ syncHistory: updatedHistory })
        set({ history: updatedHistory })
      }

      set({
        status: 'completed',
        results: allResults,
        imageProgress: null,
      })
    } catch (error) {
      set({
        error: (error as Error).message,
        status: 'completed',
        imageProgress: null,
      })
    }
  },

  reset: () => {
    set({
      status: 'idle',
      results: [],
      error: null,
      imageProgress: null,
      platformProgress: new Map(),
      deskTask: null,
    })
    // 清除持久化的同步状态
    chrome.runtime.sendMessage({ type: 'CLEAR_SYNC_STATE' }).catch(() => {})
  },

  updateProgress: (result, syncId) => {
    set(state => {
      const newResults = [...state.results, result]
      // Auto-transition to completed when all platforms are done.
      // This handles the case where popup was closed during sync and
      // reopened — the startSync response handler won't fire, so we
      // detect completion here from individual SYNC_PROGRESS messages.
      const isComplete = state.status === 'syncing' &&
        newResults.length >= state.selectedPlatforms.length
      return {
        // 工作台投递的页面可能还没恢复 syncId，用第一条进度消息补上
        currentSyncId: state.currentSyncId || syncId || null,
        results: newResults,
        ...(isComplete ? { status: 'completed' as const, imageProgress: null } : {}),
      }
    })
  },

  updateImageProgress: (progress: ImageProgress | null) => {
    set({ imageProgress: progress })
  },

  updateDetailProgress: (progress, syncId) => {
    set(state => {
      const newMap = new Map(state.platformProgress)
      newMap.set(progress.platform, progress)
      return {
        platformProgress: newMap,
        currentSyncId: state.currentSyncId || syncId || null,
      }
    })
  },

  // 清除频率限制警告
  clearRateLimitWarning: () => {
    set({ rateLimitWarning: null })
  },
}))

// 监听来自 background 的进度消息
chrome.runtime.onMessage.addListener((message) => {
  // 获取当前 syncId，只处理匹配的消息
  const { currentSyncId } = useSyncStore.getState()

  // 如果消息带有 syncId，需要匹配当前的 syncId
  if (message.syncId && currentSyncId && message.syncId !== currentSyncId) {
    logger.debug('Ignoring message with different syncId:', message.syncId, 'current:', currentSyncId)
    return
  }

  if (message.type === 'SYNC_PROGRESS') {
    const result = message.payload?.result
    if (result) {
      useSyncStore.getState().updateProgress(result, message.syncId)
    }
  }
  if (message.type === 'IMAGE_PROGRESS') {
    if (message.payload) {
      useSyncStore.getState().updateImageProgress(message.payload)
    }
  }
  if (message.type === 'SYNC_DETAIL_PROGRESS') {
    const progress = message.payload
    if (progress?.platform) {
      useSyncStore.getState().updateDetailProgress(progress, message.syncId)
    }
  }
})
