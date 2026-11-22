/**
 * NM 传输模块接口级测试:只走 request/setWatched/getStatus/事件订阅接口,
 * 通过注入假 NM host 驱动(不打实现内部,不戳私有字段)。
 * 覆盖:15s 超时路径、长端口断线重连与归零清理、事件订阅、状态缓存。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeTransport, type NativeMessagingHost } from '../src/bridge/transport'

const chromeMock = (global as any).chrome as Record<string, any>

type NativeHandler = (request: any, callback: (response?: any) => void) => void

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

// 假 NM host:sendNativeMessage/connectNative 都可断言;lastError 沿用 chrome 约定
function makeHost(handler: NativeHandler = () => {}) {
  return {
    sendNativeMessage: vi.fn((_hostName: string, request: any, callback: (response?: any) => void) => {
      handler(request, callback)
    }),
    connectNative: vi.fn((_hostName: string) => {
      activePort = makePort()
      return activePort
    }),
    lastError: () => chromeMock.runtime.lastError?.message,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('NM transport:短请求', () => {
  it('15s 无回应:按超时拒绝,lastError 可读;迟到的响应不再改写状态', async () => {
    vi.useFakeTimers()
    const callbacks: Array<(response?: any) => void> = []
    const transport = new NativeTransport(makeHost((_request, callback) => {
      callbacks.push(callback)
    }))
    const pending = transport.request('status')
    const assertion = expect(pending).rejects.toThrow('本地助手没有回应(超时)')
    vi.advanceTimersByTime(15_000)
    await assertion
    expect(transport.getLastError()).toContain('超时')
    // 超时后迟到的助手响应被 settled 挡住,不改写错误状态
    callbacks[0]?.({ ok: true })
    expect(transport.getLastError()).toContain('超时')
  })

  it('助手回错误 JSON:error 原文透出并记账', async () => {
    const transport = new NativeTransport(makeHost((_request, callback) => {
      callback({ ok: false, error: 'Node.js not found' })
    }))
    await expect(transport.request('status')).rejects.toThrow('Node.js not found')
    expect(transport.getLastError()).toBe('Node.js not found')
  })

  it('成功响应清空 lastError 并记账 dshActive', async () => {
    const transport = new NativeTransport(makeHost((_request, callback) => {
      callback({ ok: true, dshActive: true })
    }))
    await transport.request('status')
    expect(transport.getLastError()).toBeNull()
    expect((await transport.getStatus()).dshActive).toBe(true)
  })
})

describe('NM transport:长端口', () => {
  it('connect 握手帧 + watch 引用计数归零断开', () => {
    const host = makeHost()
    const transport = new NativeTransport(host)
    transport.setWatched(true)
    expect(host.connectNative).toHaveBeenCalledTimes(1)
    expect(host.connectNative).toHaveBeenCalledWith('app.dswritesync.plugin')
    // 助手只在收到 connect 握手后才进入长端口模式(推事件帧)
    expect(activePort.postMessage).toHaveBeenCalledWith({ method: 'connect' })
    transport.setWatched(true)
    expect(host.connectNative).toHaveBeenCalledTimes(1)
    transport.setWatched(false)
    transport.setWatched(false)
    expect(activePort.disconnect).toHaveBeenCalledTimes(1)
    expect(transport.isConnected()).toBe(false)
  })

  it('watchers 未归零时断线 5s 重连;setWatched(false) 取消重连', () => {
    vi.useFakeTimers()
    const host = makeHost()
    const transport = new NativeTransport(host)
    transport.setWatched(true)
    activePort.die()
    expect(transport.isConnected()).toBe(false)
    // 面板还开着:5 秒重连计时到点拉起新端口
    vi.advanceTimersByTime(5_000)
    expect(host.connectNative).toHaveBeenCalledTimes(2)
    // 归零断开:重连计时器被清理,时间推进也不再拉起
    activePort.die()
    transport.setWatched(false)
    vi.advanceTimersByTime(60_000)
    expect(host.connectNative).toHaveBeenCalledTimes(2)
    expect(transport.isConnected()).toBe(false)
  })

  it('task-available 触发订阅者,capture-result 转发 payload,心跳与坏帧被忽略', () => {
    const host = makeHost()
    const transport = new NativeTransport(host)
    const onTasks = vi.fn()
    const onResult = vi.fn()
    transport.onTaskAvailable(onTasks)
    transport.onCaptureResult(onResult)
    transport.setWatched(true)
    activePort.emit({ event: 'task-available' })
    expect(onTasks).toHaveBeenCalledTimes(1)
    activePort.emit({ event: 'capture-result', payload: { operationId: 'cap-1', ok: true } })
    expect(onResult).toHaveBeenCalledWith({ operationId: 'cap-1', ok: true })
    activePort.emit({ event: 'heartbeat' })
    activePort.emit('garbage')
    expect(onTasks).toHaveBeenCalledTimes(1)
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it('心跳帧携带 dshActive:端口开着也能更新宿主活性,getStatus 不再吃旧值', async () => {
    const host = makeHost()
    const transport = new NativeTransport(host)
    transport.setWatched(true)
    activePort.emit({ event: 'heartbeat', dshActive: true })
    const status = await transport.getStatus()
    expect(status.dshActive).toBe(true)
    activePort.emit({ event: 'heartbeat', dshActive: false })
    expect((await transport.getStatus()).dshActive).toBe(false)
    // 旧助手的心跳帧没有 dshActive 字段:保持原值,不误翻
    activePort.emit({ event: 'heartbeat' })
    expect((await transport.getStatus()).dshActive).toBe(false)
  })
})

describe('NM transport:getStatus', () => {
  it('端口开着:直接已配对,不发短请求', async () => {
    const host = makeHost()
    const transport = new NativeTransport(host)
    transport.setWatched(true)
    const status = await transport.getStatus()
    expect(status).toEqual({ paired: true, connected: true, dshActive: false, lastError: null })
    expect(host.sendNativeMessage).not.toHaveBeenCalled()
  })

  it('端口未开:短请求探测,5s 内缓存复用,过期重探', async () => {
    vi.useFakeTimers()
    const host = makeHost((_request, callback) => {
      callback({ ok: true, dshActive: true })
    })
    const transport = new NativeTransport(host)
    const first = await transport.getStatus()
    expect(first).toEqual({ paired: true, connected: false, dshActive: true, lastError: null })
    await transport.getStatus()
    expect(host.sendNativeMessage).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_000)
    await transport.getStatus()
    expect(host.sendNativeMessage).toHaveBeenCalledTimes(2)
  })
})
