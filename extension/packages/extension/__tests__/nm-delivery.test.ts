/**
 * 投递管线接口级测试:只走 processPendingTasks/runTask,依赖全部注入——
 * 假 NM host(经真实 NativeTransport 驱动)、类型对齐的假 performSync、
 * 记录型假呈现,不打实现内部。
 * 覆盖:分片反复失败整任务失败并写失败回执、任务空列表退出循环、
 * 并发调用串行化、stage→performSync→receipt→clear 时序与进度转发。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeliveryPipeline, type TaskPresentation } from '../src/bridge/delivery'
import { NativeTransport, type NativeMessagingHost } from '../src/bridge/transport'
import type { PendingSyncTask } from '../src/bridge/task-presentation'

// 仅类型:依赖注入的构造面,运行时不 import sync-service
type PerformSync = typeof import('../src/background/sync-service').performSync

const chromeMock = (global as any).chrome as Record<string, any>

type NativeHandler = (request: any, callback: (response?: any) => void) => void

const TASK_META = {
  operationId: 'pub-1',
  itemId: 'it_1',
  title: '工作台的稿子',
  platforms: ['zhihu', 'juejin'],
  article: { shards: 1 },
  images: [],
}
const ARTICLE_MD = '# 正文标题'
const ARTICLE_B64 = Buffer.from(ARTICLE_MD, 'utf8').toString('base64')

// 管线只走短请求,长端口在这里不应被触碰
function makeHost(handler: NativeHandler): NativeMessagingHost {
  return {
    sendNativeMessage: (_hostName, request, callback) => handler(request, callback),
    connectNative: hostName => {
      throw new Error(`unexpected connectNative ${hostName}`)
    },
    lastError: () => chromeMock.runtime.lastError?.message,
  }
}

function makePipeline(handler: NativeHandler, performSyncImpl?: PerformSync) {
  const staged: Array<{ task: Omit<PendingSyncTask, 'syncId' | 'at'>; syncId: string }> = []
  const cleared: string[] = []
  const presentation: TaskPresentation = {
    stage: async (task, syncId) => { staged.push({ task, syncId }) },
    clear: async syncId => { cleared.push(syncId) },
  }
  const performSync = performSyncImpl
    ? vi.fn(performSyncImpl)
    : vi.fn<PerformSync>(async () => ({
        results: [{ platform: 'zhihu', success: true, postUrl: 'https://x/p/1' }],
        syncId: 'sync-x',
      }))
  const pipeline = new DeliveryPipeline({
    transport: new NativeTransport(makeHost(handler)),
    performSync,
    generateSyncId: () => 'sync-x',
    presentation,
  })
  return { pipeline, staged, cleared, performSync }
}

beforeEach(() => {
  // 进度转发走 chrome.runtime.sendMessage(返回 Promise 才能挂 .catch)
  chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve({}))
})

describe('Delivery pipeline:失败路径', () => {
  it('分片反复失败:SHARD_RETRIES 用尽后整任务失败,写逐平台失败回执,不碰 performSync', async () => {
    const receipts: any[] = []
    let contentCalls = 0
    const { pipeline, staged, performSync } = makePipeline((request, callback) => {
      const { method, params } = request
      if (method === 'claim') return callback({ ok: true, task: TASK_META })
      if (method === 'content') {
        contentCalls += 1
        return callback({ ok: false })
      }
      if (method === 'receipt') {
        receipts.push(params.payload)
        return callback({ ok: true })
      }
      return callback({ ok: false, error: `unexpected ${method}` })
    })
    await pipeline.runTask(TASK_META)

    // 单分片 1+SHARD_RETRIES 次尝试全部失败,任务中止
    expect(contentCalls).toBe(3)
    expect(performSync).not.toHaveBeenCalled()
    expect(staged).toHaveLength(0)
    expect(receipts).toEqual([{
      operationId: 'pub-1',
      itemId: 'it_1',
      results: [
        { platform: 'zhihu', ok: false, error: '分片拉取失败' },
        { platform: 'juejin', ok: false, error: '分片拉取失败' },
      ],
    }])
  })

  it('平台名拿不到时不写回执,任务留在 .claiming 交给助手 stale 恢复', async () => {
    const receipts: any[] = []
    const meta = { ...TASK_META, platforms: 'not-an-array' } as unknown as typeof TASK_META
    const { pipeline } = makePipeline((request, callback) => {
      const { method, params } = request
      if (method === 'claim') return callback({ ok: true, task: meta })
      if (method === 'content') return callback({ ok: false })
      if (method === 'receipt') {
        receipts.push(params.payload)
        return callback({ ok: true })
      }
      return callback({ ok: false, error: `unexpected ${method}` })
    })
    await pipeline.runTask(meta)
    expect(receipts).toHaveLength(0)
  })
})

describe('Delivery pipeline:任务循环', () => {
  it('任务空列表:退出循环,除 tasks 外不发任何请求', async () => {
    const methods: string[] = []
    const { pipeline } = makePipeline((request, callback) => {
      methods.push(request.method)
      if (request.method === 'tasks') return callback({ ok: true, tasks: [] })
      return callback({ ok: false, error: `unexpected ${request.method}` })
    })
    await pipeline.processPendingTasks()
    expect(methods).toEqual(['tasks'])
  })

  it('tasks 列表消化完即退出循环;stage → performSync → receipt → clear 同一 syncId', async () => {
    let pulls = 0
    const receipts: any[] = []
    const { pipeline, staged, cleared, performSync } = makePipeline((request, callback) => {
      const { method, params } = request
      if (method === 'tasks') {
        pulls += 1
        return callback({ ok: true, tasks: pulls === 1 ? [TASK_META] : [] })
      }
      if (method === 'claim') return callback({ ok: true, task: TASK_META })
      if (method === 'content') {
        return callback({ ok: true, name: params.name, shard: params.shard, shards: 1, data: ARTICLE_B64 })
      }
      if (method === 'receipt') {
        receipts.push(params.payload)
        return callback({ ok: true })
      }
      return callback({ ok: false, error: `unexpected ${method}` })
    })
    await pipeline.processPendingTasks()

    expect(pulls).toBe(2)
    expect(receipts).toEqual([{
      operationId: 'pub-1',
      itemId: 'it_1',
      results: [
        { platform: 'zhihu', ok: true, url: 'https://x/p/1' },
        { platform: 'juejin', ok: false, error: 'no result' },
      ],
    }])
    // 投递即弹对话框:performSync 前先落暂存并呈现,终了清理自己的 syncId
    expect(staged).toHaveLength(1)
    expect(staged[0].syncId).toBe('sync-x')
    expect(staged[0].task.title).toBe('工作台的稿子')
    expect(cleared).toEqual(['sync-x'])
    expect(performSync.mock.calls[0][2]).toEqual({ source: 'bridge', syncId: 'sync-x' })
    expect(performSync.mock.calls[0][0].markdown).toBe(ARTICLE_MD)
  })

  it('并发调用 processPendingTasks 内部串行化:后到的是 no-op', async () => {
    let pulls = 0
    const { pipeline } = makePipeline((request, callback) => {
      const { method } = request
      if (method === 'tasks') {
        pulls += 1
        return callback({ ok: true, tasks: pulls === 1 ? [TASK_META] : [] })
      }
      if (method === 'claim') return callback({ ok: true, task: TASK_META })
      if (method === 'content') {
        return callback({ ok: true, data: ARTICLE_B64 })
      }
      if (method === 'receipt') return callback({ ok: true })
      return callback({ ok: false, error: `unexpected ${method}` })
    })
    await Promise.all([pipeline.processPendingTasks(), pipeline.processPendingTasks()])
    expect(pulls).toBe(2)
  })
})

describe('Delivery pipeline:进度转发', () => {
  it('performSync 进度回调转发为带 syncId 的运行时消息', async () => {
    const { pipeline } = makePipeline((request, callback) => {
      const { method } = request
      if (method === 'claim') return callback({ ok: true, task: TASK_META })
      if (method === 'content') return callback({ ok: true, data: ARTICLE_B64 })
      if (method === 'receipt') return callback({ ok: true })
      return callback({ ok: false, error: `unexpected ${method}` })
    }, async (_article, _platforms, _options, callbacks) => {
      callbacks?.onResult?.({ platform: 'zhihu', success: true })
      callbacks?.onImageProgress?.('zhihu', 1, 2)
      callbacks?.onDetailProgress?.({ platform: 'zhihu', platformName: '知乎', stage: 'starting' })
      return { results: [], syncId: 'sync-x' }
    })
    await pipeline.runTask(TASK_META)

    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SYNC_PROGRESS',
      payload: { result: { platform: 'zhihu', success: true } },
      syncId: 'sync-x',
    })
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'IMAGE_PROGRESS',
      payload: { platform: 'zhihu', current: 1, total: 2 },
      syncId: 'sync-x',
    })
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'SYNC_DETAIL_PROGRESS',
      payload: { platform: 'zhihu', platformName: '知乎', stage: 'starting' },
      syncId: 'sync-x',
    })
  })
})
