import { beforeEach, describe, expect, it } from 'vitest'
import { useSyncStore } from '../src/popup/stores/sync'

// chrome 全局由 vitest.setup.ts 挂好,这里只取引用
const chromeMock = (global as any).chrome as Record<string, any>

function resetStore() {
  useSyncStore.setState({
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
  })
}

describe('recoverSyncState', () => {
  beforeEach(resetStore)

  it('新 pendingSyncTask 优先于旧 activeSyncState,进度不会被旧 syncId 过滤', async () => {
    const oldState = {
      syncId: 'old',
      status: 'completed',
      article: { title: '上一次' },
      selectedPlatforms: ['zhihu'],
      results: [],
    }
    await chromeMock.storage.local.set({
      pendingSyncTask: {
        operationId: 'op-new',
        itemId: 'w-new',
        title: '新任务',
        platforms: ['juejin'],
        article: { title: '新任务', markdown: '# 正文' },
        syncId: 'new',
        at: 1,
      },
    })
    chromeMock.runtime.sendMessage.mockImplementation(async (message: any) => (
      message?.type === 'GET_SYNC_STATE' ? { syncState: oldState } : {}
    ))

    await useSyncStore.getState().recoverSyncState(true)

    const state = useSyncStore.getState()
    expect(state.status).toBe('syncing')
    expect(state.currentSyncId).toBe('new')
    expect(state.deskTask?.title).toBe('新任务')
    expect(state.selectedPlatforms).toEqual(['juejin'])
    expect((await chromeMock.storage.local.get('pendingSyncTask')).pendingSyncTask).toBeUndefined()
  })

  it('同一 syncId 时用 activeSyncState 的结果,并补上工作台任务来源', async () => {
    const sameState = {
      syncId: 'same',
      status: 'completed',
      article: { title: '同一任务' },
      selectedPlatforms: ['zhihu'],
      results: [{ platform: 'zhihu', success: true }],
    }
    await chromeMock.storage.local.set({
      pendingSyncTask: {
        operationId: 'op-same',
        itemId: 'w-same',
        title: '同一任务',
        platforms: ['zhihu'],
        article: { title: '同一任务' },
        syncId: 'same',
        at: 1,
      },
    })
    chromeMock.runtime.sendMessage.mockImplementation(async (message: any) => (
      message?.type === 'GET_SYNC_STATE' ? { syncState: sameState } : {}
    ))

    await useSyncStore.getState().recoverSyncState(true)

    const state = useSyncStore.getState()
    expect(state.status).toBe('completed')
    expect(state.currentSyncId).toBe('same')
    expect(state.deskTask?.title).toBe('同一任务')
    expect(state.results).toEqual(sameState.results)
  })
})
