/**
 * 任务呈现模块:pendingSyncTask storage 契约的唯一守门人。投递管线只说
 * stage/clear;storage 键、是否通知已开页面、PANEL_NAVIGATE/SYNC_TASK_QUEUED
 * 消息、396x560 窗口几何全部藏在实现内。
 */
import { createLogger } from '../lib/logger'

const logger = createLogger('TaskPresenter')

const PENDING_SYNC_TASK_KEY = 'pendingSyncTask'
const SYNC_TASK_WINDOW_WIDTH = 396
const SYNC_TASK_WINDOW_HEIGHT = 560

// 工作台投递的同步任务：performSync 前写入 storage，供同步页恢复
export interface PendingSyncTask {
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

type ExtensionContextInfo = { contextType: string; documentUrl?: string }

/**
 * 是否已有扩展页面（侧栏或同步窗口）打开。HashRouter 的 hash 不参与
 * getContexts 的精确 URL 过滤，因此先取上下文再按 documentUrl 判断，
 * 避免侧栏开在 /capture 时误判为“没有页面”而重复开窗。
 */
async function hasOpenExtensionPage(): Promise<boolean> {
  const runtime = chrome.runtime as unknown as {
    getContexts?: (filter: {
      contextTypes?: string[]
    }) => Promise<ExtensionContextInfo[]>
  }
  if (typeof runtime.getContexts !== 'function') return false
  try {
    const contexts = await runtime.getContexts({
      contextTypes: ['SIDE_PANEL', 'TAB', 'POPUP'],
    })
    return contexts.some(context =>
      typeof context.documentUrl === 'string'
      && context.documentUrl.includes('src/popup/index.html'))
  } catch {
    return false
  }
}

/**
 * pendingSyncTask 已写入 storage：有已打开的同步页就通知它重读，
 * 否则开一个 396x560 的同步任务窗口。打开失败不影响同步本身。
 */
async function presentSyncTask(): Promise<void> {
  if (await hasOpenExtensionPage()) {
    // The side panel/tab may be on Capture or another route. Navigate it to
    // Sync so its mount recovers pendingSyncTask; the queued message covers the
    // case where the Sync route is already mounted.
    chrome.runtime.sendMessage({ type: 'PANEL_NAVIGATE', path: '/sync' }).catch(() => {})
    chrome.runtime.sendMessage({ type: 'SYNC_TASK_QUEUED' }).catch(() => {})
    return
  }

  const width = SYNC_TASK_WINDOW_WIDTH
  const height = SYNC_TASK_WINDOW_HEIGHT
  let left: number | undefined
  let top: number | undefined
  try {
    const currentWindow = await chrome.windows.getCurrent()
    if (typeof currentWindow.left === 'number' && typeof currentWindow.width === 'number') {
      left = Math.round(currentWindow.left + (currentWindow.width - width) / 2)
    }
    if (typeof currentWindow.top === 'number' && typeof currentWindow.height === 'number') {
      top = Math.round(currentWindow.top + (currentWindow.height - height) / 2)
    }
  } catch {
    // 拿不到窗口位置时交给浏览器决定
  }

  try {
    await chrome.windows.create({
      url: `${chrome.runtime.getURL('src/popup/index.html')}#/sync`,
      type: 'popup',
      width,
      height,
      left,
      top,
      focused: true,
    })
  } catch (error) {
    logger.warn('Failed to open sync task window:', error)
  }
}

export class TaskPresenter {
  /**
   * 写 pendingSyncTask 并呈现。stage 失败(storage 写不进)会抛出,由投递
   * 管线记账后继续同步;窗口打开失败在实现内吞掉,不影响同步。
   */
  async stage(task: Omit<PendingSyncTask, 'syncId' | 'at'>, syncId: string): Promise<void> {
    const record: PendingSyncTask = { ...task, syncId, at: Date.now() }
    await chrome.storage.local.set({ [PENDING_SYNC_TASK_KEY]: record })
    await presentSyncTask()
  }

  // 只清理自己这个 syncId 的任务，避免并发投递时误删新任务
  async clear(syncId: string): Promise<void> {
    try {
      const storage = await chrome.storage.local.get(PENDING_SYNC_TASK_KEY)
      const current = storage[PENDING_SYNC_TASK_KEY] as { syncId?: unknown } | undefined
      if (current?.syncId === syncId) {
        await chrome.storage.local.remove(PENDING_SYNC_TASK_KEY)
      }
    } catch (error) {
      logger.debug('Failed to clear pending sync task:', error)
    }
  }
}
