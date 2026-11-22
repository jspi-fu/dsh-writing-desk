/**
 * NM 客户端单测(ADR 0012):mock chrome.runtime(sendNativeMessage /
 * connectNative)与 sync-service,覆盖任务分片拉取组装、单分片失败重试、
 * 长端口事件分发、未配对路径。
 *
 * 拆深模块后不再戳单例私有字段(旧 resetClientState 正是"测试面不是接口"的
 * 实证):每个用例通过注入假 NM host 构造全新 BridgeClient 组合——chrome NM
 * 与假件两个适配器构成真缝,状态隔离由新实例天然保证。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
// 静态导入让 vi.mock 在模块图装载前生效
import { BridgeClient } from '../src/bridge/client'
import { performSync } from '../src/background/sync-service'

// chrome 全局由 vitest.setup.ts 挂好,这里只取引用(vitest.setup 不能当模块 import:
// 其顶层 vi.mock 会在测试模块图里重复注册,把 worker 卡死)
const chromeMock = (global as any).chrome as Record<string, any>

// performSync 不在单测里真跑;进度回调与本文件无关
vi.mock('../src/background/sync-service', () => ({
  generateSyncId: () => 'sync-test-1',
  performSync: vi.fn(async () => ({
    results: [
      { platform: 'zhihu', success: true, postUrl: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'juejin', success: false, error: '未登录' },
    ],
    syncId: 'sync-test-1',
  })),
}))

type NativeHandler = (request: any, callback: (response?: any) => void) => void

const sendNativeMessage = vi.fn<NativeHandler>()
let activePort: any = null

function makePort() {
  const port: any = {
    onMessage: { addListener: vi.fn((fn: (message: unknown) => void) => { port.emit = fn }) },
    onDisconnect: { addListener: vi.fn((fn: () => void) => { port.die = fn }) },
    disconnect: vi.fn(),
    postMessage: vi.fn(),
    emit: undefined,
    die: undefined,
  }
  return port
}

// 假 NM host:消息面仍走 chromeMock.runtime(便于按帧断言),lastError 沿用
// chrome"回调存续期"约定就地读取
function makeBridge(): BridgeClient {
  return new BridgeClient({
    host: {
      sendNativeMessage: (hostName, message, callback) =>
        chromeMock.runtime.sendNativeMessage(hostName, message, callback),
      connectNative: (hostName: string) => chromeMock.runtime.connectNative(hostName),
      lastError: () => chromeMock.runtime.lastError?.message,
    },
  })
}

// tasks → claim → content(正文 + 图片)→ receipt 全链路模拟
const TASK_META = {
  operationId: 'pub-1',
  itemId: 'it_1',
  title: '工作台的稿子',
  platforms: ['zhihu', 'juejin'],
  article: { shards: 1 },
  images: [{ ref: 'images/cover.png', mime: 'image/png', shards: 1 }],
}
const ARTICLE_MD = '# 正文标题\n\n![封面](images/cover.png)\n\n正文'
const ARTICLE_B64 = Buffer.from(ARTICLE_MD, 'utf8').toString('base64')
const IMAGE_B64 = Buffer.from('PNGDATA', 'utf8').toString('base64')

let lastReceipt: any = null

/**
 * 有状态的助手 mock:认领过的任务不再出现在 tasks 列表里——processPendingTasks
 * 的 for(;;) 只有在 tasks 为空才退出,无状态 mock 会让它变成纯微任务死循环,
 * 饿死测试超时计时器。
 */
function createResponder(options: { failFirstContent?: boolean } = {}): NativeHandler {
  const claimed = new Set<string>()
  let contentCalls = 0
  let failInjected = false
  const handler: NativeHandler = (request, callback) => {
    const { method, params } = request
    if (method === 'tasks') {
      return callback({ ok: true, tasks: claimed.size === 0 ? [TASK_META] : [] })
    }
    if (method === 'status') return callback({ ok: true, version: 1, dshActive: true })
    if (method === 'claim') {
      claimed.add(params.operationId)
      return callback({ ok: true, task: TASK_META })
    }
    if (method === 'content') {
      if (options.failFirstContent && !failInjected) {
        failInjected = true
        return
      }
      contentCalls += 1
      const b64 = params.name === 'article' ? ARTICLE_B64 : IMAGE_B64
      return callback({ ok: true, name: params.name, shard: params.shard, shards: 1, data: b64 })
    }
    if (method === 'receipt') {
      lastReceipt = request.params.payload
      return callback({ ok: true })
    }
    if (method === 'catalog') return callback({ ok: true, at: '2026-11-20T00:00:00.000Z', tags: ['参考'], urls: { 'https://a': 'it_a' } })
    return callback({ ok: false, error: `unexpected method ${method}` })
  }
  return handler
}

function install(handler: NativeHandler) {
  // chrome.runtime.sendNativeMessage(extensionId, message, callback)——首参是 host 名
  sendNativeMessage.mockImplementation((_extensionId: string, request: any, callback: (response?: any) => void) => {
    handler(request, callback)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  lastReceipt = null
  activePort = null
  sendNativeMessage.mockReset()
  chromeMock.runtime.sendNativeMessage = sendNativeMessage
  chromeMock.runtime.connectNative = vi.fn(() => {
    activePort = makePort()
    return activePort
  })
  chromeMock.runtime.lastError = undefined
  chromeMock.runtime.sendMessage = vi.fn(() => Promise.resolve({}))
  chromeMock.runtime.getContexts = undefined
  chromeMock.windows = {
    getCurrent: vi.fn(async () => ({ left: 0, top: 0, width: 800, height: 600 })),
    create: vi.fn(async () => ({})),
  }
  chromeMock.storage.local.get = vi.fn(async () => ({}))
  chromeMock.storage.local.set = vi.fn(async () => {})
  chromeMock.storage.local.remove = vi.fn(async () => {})
})

describe('NM client:任务下发', () => {
  it('tasks → claim → 分片拉取组装 → performSync → receipt,正文与图片完整还原', async () => {
    install(createResponder())
    await makeBridge().processPendingTasks()

    expect(lastReceipt).not.toBeNull()
    expect(lastReceipt.operationId).toBe('pub-1')
    expect(lastReceipt.itemId).toBe('it_1')
    expect(lastReceipt.results).toEqual([
      { platform: 'zhihu', ok: true, url: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'juejin', ok: false, error: '未登录' },
    ])
    // performSync 收到的是分片拼回的完整正文,封面已替换成 data URI
    const article = (performSync as any).mock.calls[0][0]
    expect(article.markdown).toContain('# 正文标题')
    expect(article.markdown).toContain('data:image/png;base64,UE5HREFUQQ==')
    expect(article.markdown).not.toContain('(images/cover.png)')
    // 投递即弹对话框(ADR 0010 沿用):无已开页面时开 396x560 同步窗口
    expect(chromeMock.windows.create).toHaveBeenCalled()
  })

  it('单分片失败自动重试,重试成功后任务继续', async () => {
    const responder = createResponder()
    let failedOnce = false
    install((request, callback) => {
      if (request.method === 'content' && !failedOnce) {
        failedOnce = true
        chromeMock.runtime.lastError = { message: 'Native host has exited' }
        callback(undefined)
        chromeMock.runtime.lastError = undefined
        return
      }
      responder(request, callback)
    })
    await makeBridge().processPendingTasks()
    expect(failedOnce).toBe(true)
    expect(lastReceipt).not.toBeNull()
  })
})

describe('NM client:长端口', () => {
  it('watch 引用计数:首次打开连接端口并发 connect 握手,归零断开', () => {
    const client = makeBridge()
    client.setActivelyWatched(true)
    expect(chromeMock.runtime.connectNative).toHaveBeenCalledWith('app.dswritesync.plugin')
    // 助手只在 connect 握手后才进入长端口模式(推事件帧)
    expect(activePort.postMessage).toHaveBeenCalledWith({ method: 'connect' })
    client.setActivelyWatched(true)
    expect(chromeMock.runtime.connectNative).toHaveBeenCalledTimes(1)
    client.setActivelyWatched(false)
    client.setActivelyWatched(false)
    expect(activePort.disconnect).toHaveBeenCalledTimes(1)
    expect(client.isConnected()).toBe(false)
  })

  it('task-available 事件触发任务拉取,capture-result 转发为运行时消息', async () => {
    install(createResponder())
    const client = makeBridge()
    client.setActivelyWatched(true)
    expect(typeof activePort.emit).toBe('function')

    activePort.emit({ event: 'task-available' })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(sendNativeMessage.mock.calls.some(call => call[1]?.method === 'tasks')).toBe(true)

    activePort.emit({ event: 'capture-result', payload: { operationId: 'cap-1', ok: true, itemId: 'it_x' } })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(chromeMock.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'BRIDGE_CAPTURE_RESULT',
      payload: { operationId: 'cap-1', ok: true, itemId: 'it_x' },
    })

    // 面板还开着时断连:5 秒后自动重连(这里只断言清理与状态)
    activePort.die()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(client.isConnected()).toBe(false)
    client.setActivelyWatched(false)
  })
})

describe('NM client:未配对路径', () => {
  it('sendNativeMessage 通道错误 → 状态未配对并带可读错误,收进抛错走降级', async () => {
    install((_request, callback) => {
      chromeMock.runtime.lastError = { message: 'Error when communicating with the native messaging host.' }
      callback(undefined)
      chromeMock.runtime.lastError = undefined
    })
    const client = makeBridge()
    const status = await client.getStatus()
    expect(status.paired).toBe(false)
    expect(status.lastError).toContain('未配对')

    await expect(client.saveCapture({
      url: 'https://example.com/a', title: 't', body: 'b',
    })).rejects.toThrow(/未配对/)
  })

  it('助手回错误 JSON(node 缺失)→ 错误原文透出', async () => {
    install((_request, callback) => {
      callback({ ok: false, error: 'Node.js not found in PATH. Install Node.js, then restart DSH and reload the extension.' })
    })
    const status = await makeBridge().getStatus()
    expect(status.paired).toBe(false)
    expect(status.lastError).toContain('Node.js not found')
  })

  it('配对可用但 DSH 没跑:saveCapture 仍成功,dshActive=false', async () => {
    install((request, callback) => {
      if (request.method === 'capture') {
        return callback({ ok: true, operationId: request.params.operationId, queued: true, dshActive: false })
      }
      callback({ ok: false, error: `unexpected method ${request.method}` })
    })
    const result = await makeBridge().saveCapture({ url: 'https://example.com/a', title: 't', body: 'b' })
    expect(result.ok).toBe(true)
    expect(result.queued).toBe(true)
    expect(result.dshActive).toBe(false)
  })
})

describe('NM client:目录', () => {
  it('getCatalog 规范化助手回包', async () => {
    install((request, callback) => {
      if (request.method === 'catalog') {
        return callback({ ok: true, at: '2026-11-20T00:00:00.000Z', tags: ['参考', 42], urls: { 'https://a': 'it_a', bad: 1 } })
      }
      callback({ ok: false, error: 'unexpected' })
    })
    const catalog = await makeBridge().getCatalog()
    expect(catalog.tags).toEqual(['参考'])
    expect(catalog.urls).toEqual({ 'https://a': 'it_a' })
  })
})
