/**
 * 投递页的状态(ADR 0017):侧栏只呈现工作台下发的任务与进度,
 * 不再从当前标签页提取文章,也不再有平台选择、重试与历史。
 * 进度消息由 background 的投递管线发出;activeSyncState 负责刷新/休眠后的恢复。
 */
import { create } from 'zustand'
import { createLogger } from '../../lib/logger'

const logger = createLogger('DispatchStore')

interface Platform {
  id: string
  name: string
  icon: string
  homepage?: string
  isAuthenticated: boolean
  username?: string
}

interface Article {
  title: string
  content: string
  summary?: string
  cover?: string
}

interface SyncResult {
  platform: string
  platformName?: string
  success: boolean
  postUrl?: string
  draftOnly?: boolean
  error?: string
}

// 工作台投递的同步任务（performSync 前写入 storage，供侧栏恢复）
interface PendingSyncTask {
  operationId?: string
  itemId?: string
  title: string
  platforms: string[]
  article: {
    title: string
    markdown?: string
    content?: string
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

type SyncStage = 'starting' | 'uploading_images' | 'saving' | 'completed' | 'failed'

interface PlatformProgress {
  platform: string
  platformName: string
  stage: SyncStage
  imageProgress?: { current: number; total: number }
  error?: string
}

interface ImageProgress {
  platform: string
  current: number
  total: number
}

type DispatchStatus = 'loading' | 'idle' | 'syncing' | 'completed' | 'failed' | 'cancelled'

interface SyncState {
  status: DispatchStatus
  article: Article | null
  platforms: Platform[]
  selectedPlatforms: string[]
  results: SyncResult[]
  error: string | null
  currentSyncId: string | null
  imageProgress: ImageProgress | null
  platformProgress: Map<string, PlatformProgress>
  recovered: boolean
  deskTask: DeskTaskInfo | null

  loadPlatforms: () => Promise<void>
  recoverSyncState: (force?: boolean) => Promise<void>
  reset: () => void
  updateProgress: (result: SyncResult, syncId?: string) => void
  updateImageProgress: (progress: ImageProgress | null) => void
  updateDetailProgress: (progress: PlatformProgress, syncId?: string) => void
  clearSyncState: () => Promise<void>
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
  } catch (error) {
    logger.error('Failed to read pending sync task:', error)
    return null
  }
}

function pendingTaskState(task: PendingSyncTask): Partial<SyncState> {
  return {
    status: 'syncing',
    article: {
      title: task.article.title,
      content: task.article.content || '',
      cover: task.article.cover,
    },
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

function toPlatform(row: any): Platform | null {
  if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id) return null
  return {
    id: row.id,
    name: typeof row.name === 'string' && row.name ? row.name : row.id,
    icon: typeof row.icon === 'string' ? row.icon : '/assets/icon-48.png',
    homepage: typeof row.homepage === 'string' ? row.homepage : undefined,
    isAuthenticated: row.isAuthenticated === true,
    username: typeof row.username === 'string' ? row.username : undefined,
  }
}

export const useSyncStore = create<SyncState>((set, get) => ({
  status: 'loading',
  article: null,
  platforms: [],
  selectedPlatforms: [],
  results: [],
  error: null,
  currentSyncId: null,
  imageProgress: null,
  platformProgress: new Map(),
  recovered: false,
  deskTask: null,

  loadPlatforms: async () => {
    const isSettled = () => ['syncing', 'completed', 'failed', 'cancelled'].includes(get().status)
    if (!isSettled()) set({ status: 'loading' })

    // 先渲染缓存,再刷新登录态;投递页只需要名字/图标,不参与选择。
    try {
      const cached = await chrome.storage.local.get('platformListCache')
      if (Array.isArray(cached.platformListCache) && cached.platformListCache.length) {
        set({ platforms: cached.platformListCache.map(toPlatform).filter(Boolean) as Platform[] })
      }
    } catch { /* 缓存读不到就等接口 */ }

    try {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_ALL_AUTH' })
      const rows = Array.isArray(response?.platforms) ? response.platforms.map(toPlatform).filter(Boolean) as Platform[] : []
      set(isSettled() ? { platforms: rows } : { platforms: rows, status: 'idle' })
    } catch (error) {
      logger.debug('Platform list unavailable:', error)
      if (!isSettled()) set({ status: 'idle' })
    }
  },

  recoverSyncState: async (force = false) => {
    if (get().recovered && !force) return

    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SYNC_STATE' })
      const syncState = response?.syncState
      const pendingTask = await readPendingSyncTask()
      const sameTask = !!(syncState && pendingTask && pendingTask.syncId === syncState.syncId)

      if (syncState) {
        set({
          status: syncState.status,
          article: syncState.article,
          selectedPlatforms: Array.isArray(syncState.selectedPlatforms) ? syncState.selectedPlatforms : [],
          results: syncState.results || [],
          currentSyncId: syncState.syncId || null,
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
        if (sameTask) await chrome.storage.local.remove(PENDING_SYNC_TASK_KEY)
        return
      }

      if (pendingTask) {
        set(pendingTaskState(pendingTask))
        await chrome.storage.local.remove(PENDING_SYNC_TASK_KEY)
        return
      }

      set({ recovered: true, status: 'idle' })
    } catch (error) {
      logger.error('Failed to recover sync state:', error)
      set({ recovered: true, status: 'idle' })
    }
  },

  clearSyncState: async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_SYNC_STATE' })
    } catch (error) {
      logger.error('Failed to clear sync state:', error)
    }
  },

  reset: () => {
    set({
      status: 'idle',
      article: null,
      selectedPlatforms: [],
      results: [],
      error: null,
      imageProgress: null,
      platformProgress: new Map(),
      deskTask: null,
      currentSyncId: null,
    })
    void get().clearSyncState()
  },

  updateProgress: (result, syncId) => {
    set(state => {
      const newResults = [...state.results, result]
      const isComplete = state.status === 'syncing' &&
        state.selectedPlatforms.length > 0 &&
        newResults.length >= state.selectedPlatforms.length
      return {
        currentSyncId: state.currentSyncId || syncId || null,
        results: newResults,
        ...(isComplete ? { status: 'completed' as const, imageProgress: null } : {}),
      }
    })
  },

  updateImageProgress: (progress) => {
    set({ imageProgress: progress })
  },

  updateDetailProgress: (progress, syncId) => {
    set(state => {
      const next = new Map(state.platformProgress)
      next.set(progress.platform, progress)
      return {
        platformProgress: next,
        currentSyncId: state.currentSyncId || syncId || null,
      }
    })
  },
}))

// 监听来自 background 的进度消息;只处理当前任务的那一条。
chrome.runtime.onMessage.addListener((message) => {
  const { currentSyncId } = useSyncStore.getState()
  if (message.syncId && currentSyncId && message.syncId !== currentSyncId) return

  if (message.type === 'SYNC_PROGRESS') {
    const result = message.payload?.result
    if (result) useSyncStore.getState().updateProgress(result, message.syncId)
  }
  if (message.type === 'IMAGE_PROGRESS') {
    if (message.payload) useSyncStore.getState().updateImageProgress(message.payload)
  }
  if (message.type === 'SYNC_DETAIL_PROGRESS') {
    const progress = message.payload
    if (progress?.platform) useSyncStore.getState().updateDetailProgress(progress, message.syncId)
  }
})
