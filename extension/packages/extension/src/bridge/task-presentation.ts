/**
 * 任务呈现模块:pendingSyncTask storage 契约的唯一守门人。投递管线只说
 * stage/clear;storage 键、是否通知已打开的侧栏、PANEL_NAVIGATE/SYNC_TASK_QUEUED
 * 消息都藏在实现内。
 */
import { createLogger } from '../lib/logger'

const logger = createLogger('TaskPresenter')

const PENDING_SYNC_TASK_KEY = 'pendingSyncTask'

// 工作台投递的任务:performSync 前写入 storage,供投递页恢复
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
 * 侧栏是否开着(ADR 0017:侧栏是唯一首页,不再有同步窗口)。HashRouter 的 hash
 * 不参与 getContexts 的精确 URL 过滤,因此先取上下文再按 documentUrl 判断。
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
      contextTypes: ['SIDE_PANEL'],
    })
    return contexts.some(context =>
      typeof context.documentUrl === 'string'
      && context.documentUrl.includes('src/popup/index.html'))
  } catch {
    return false
  }
}

/**
 * pendingSyncTask 已写入 storage:有已打开的侧栏就通知它重读并切到投递页。
 * 没有页面时不弹窗——工作是工作台发起的,收据在那边,扩展不抢焦点(ADR 0017)。
 */
async function presentSyncTask(): Promise<void> {
  if (!await hasOpenExtensionPage()) return
  // The side panel may be on Capture or another route; navigate it to Dispatch
  // so its mount recovers pendingSyncTask; the queued message covers the case
  // where the Dispatch route is already mounted.
  chrome.runtime.sendMessage({ type: 'PANEL_NAVIGATE', path: '/dispatch' }).catch(() => {})
  chrome.runtime.sendMessage({ type: 'SYNC_TASK_QUEUED' }).catch(() => {})
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
