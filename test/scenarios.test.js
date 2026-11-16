// 状态权威迁移的真实操作序列测试(工单 #5):按创作者的真实操作次序,
// 断言四个历史不一致场景消失。与 host.test.js 同一层:直接调用 Store / Producer /
// applyOps 与 src/state.js 的共享谓词,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isDrafted, isScheduled, panelState } from '../src/state.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { Store } from '../src/store.js'
import { Producer } from '../src/produce.js'
import { Settings } from '../src/settings.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

function seed() {
  return buildSeed(NOW)
}

const isPlan = system => system.includes('策划案')
const PLAN = JSON.stringify({ title: '最终标题', cover: 'cover', characters: 'a man', images: [{ anchor: '第一节', caption: '图注', prompt: 'fig' }], shots: [{ shot: '特写', visual: '手', voice: '说', seconds: 4, prompt: 's1' }, { shot: '全景', visual: '街', voice: '说', seconds: 6, prompt: 's2' }] })

async function fixture({ callText, generate = async () => ({ buffer: PNG, ext: '.png' }), ready = true }) {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-seq-'))
  const store = new Store(dir)
  await store.read()
  const settings = new Settings(dir)
  await settings.update({ imageCount: 1, shotCount: 2, ...(ready ? { image: { baseUrl: 'https://i.example/v1', model: 'm', apiKey: 'k' } } : {}) })
  return { dir, store, settings, producer: new Producer({ store, settings, callText, generate }) }
}

async function waitDone(producer, id) {
  for (let i = 0; i < 200 && producer.isRunning(id); i += 1) await new Promise(r => setTimeout(r, 5))
}

async function waitUntil(store, id, predicate) {
  for (let i = 0; i < 400; i += 1) {
    const item = (await store.read()).items.find(row => row.id === id)
    if (item && predicate(item)) return item
    await new Promise(r => setTimeout(r, 5))
  }
  return null
}

/** 新起一条自己的灵感,返回 id。 */
function addItem(state, title) {
  const { receipts } = applyOps(state, [{ op: 'add_item', title, body: '素材正文', contentOrigin: 'user' }])
  return receipts[0].target
}

// 场景②(User Story #29):重新成稿不再清空上一次写好的正文,重试不毁稿。
test('场景② 真实序列:重新成稿不清空上一篇正文,新一轮写完才原子替换', async () => {
  let round = 0
  let release
  const gate = new Promise((r) => { release = r })
  const callText = async ({ system, onText }) => {
    if (isPlan(system)) return { text: PLAN, model: 'd' }
    round += 1
    if (round === 1) {
      onText('# 模型标题\n\n## 第一节\n正文')
      return { text: '# 模型标题\n\n## 第一节\n正文', model: 'd1' }
    }
    await gate
    onText('# 第二轮标题\n\n## 第一节\n第二轮正文')
    return { text: '# 第二轮标题\n\n## 第一节\n第二轮正文', model: 'd2' }
  }
  const { dir, store, producer } = await fixture({ callText, ready: false })
  let id = null
  try {
    id = addItem(await store.read(), '要重写的灵感')
    // 第一轮:写完、完成
    assert.equal(await producer.start(id, { withImages: false }), true)
    await waitDone(producer, id)
    const first = (await store.read()).items.find(row => row.id === id)
    assert.equal(first.production.status, 'done')
    assert.equal(first.production.article, '## 第一节\n正文')
    assert.equal(first.status, 'draft')

    // 第二轮:正文先挂着,此时上一篇正文必须还在
    await producer.start(id, { withImages: false })
    const midRun = await waitUntil(store, id, item => item.production?.status === 'running')
    assert.ok(midRun, '第二轮开跑了')
    assert.equal(midRun.production.article, '## 第一节\n正文', '重新成稿不清空上一篇正文')

    release()
    await waitDone(producer, id)
    const second = (await store.read()).items.find(row => row.id === id)
    assert.equal(second.production.status, 'done')
    assert.equal(second.production.article, '## 第一节\n第二轮正文')
    assert.equal(second.production.engine, 'd2')
  } finally {
    producer.jobs.get(id)?.controller.abort()
    await waitDone(producer, id)
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

// 场景①(User Story #28):成稿被取消时已经写好的正文被保留,面板谓词一致。
test('场景① 真实序列:成稿中途取消,已写好的正文保留,面板谓词一致', async () => {
  const callText = async ({ system }) => {
    if (isPlan(system)) return { text: PLAN, model: 'd' }
    return { text: '# 模型标题\n\n## 第一节\n取消前写完的正文', model: 'd1' }
  }
  // 生图挂着等取消:正文落盘后图片还在画,这时取消
  const generate = (_, __, { signal } = {}) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
  const { dir, store, producer } = await fixture({ callText, generate })
  let id = null
  try {
    id = addItem(await store.read(), '写一半要取消的灵感')
    await producer.start(id)
    const written = await waitUntil(store, id, item => item.production?.article)
    assert.ok(written, '正文已落盘')
    assert.equal(written.status, 'draft', '正文落盘即成稿:灵感推进成草稿')
    await producer.cancel(id)
    await waitDone(producer, id)
    const item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.production.status, 'cancelled')
    assert.equal(item.production.error, null, '用户主动停,不算错误')
    assert.equal(item.production.article, '## 第一节\n取消前写完的正文', '取消不丢已写好的正文')
    assert.equal(item.production.cover.status, 'idle', '没跑完的资产停回待命')
    assert.equal(item.status, 'draft')
    assert.equal(isDrafted(item), true)
    assert.equal(panelState(item), 'drafted')
  } finally {
    producer.jobs.get(id)?.controller.abort()
    await waitDone(producer, id)
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

// 中断自愈也走 reducer:上次没做完的标失败,已落盘的正文保留,状态按事实对齐。
test('真实序列:中断自愈(settle)走 reducer,标失败且正文保留、状态对齐', async () => {
  const { dir, store, producer } = await fixture({ callText: async () => { throw new Error('不该被调用') }, ready: false })
  try {
    const id = addItem(await store.read(), '被中断的灵感')
    await store.mutate('模拟上次中断', (draft) => {
      draft.items.find(row => row.id === id).production = { status: 'running', stage: 'making', article: '上次已写好的正文', cover: { status: 'running' }, images: [], shots: [] }
      return draft
    }, { undoable: false })
    await producer.settle(id)
    const item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.production.status, 'failed')
    assert.equal(item.production.article, '上次已写好的正文', '中断不丢已写好的正文')
    assert.equal(item.production.cover.status, 'idle')
    assert.equal(item.status, 'draft', '有正文就不会被留在灵感档')
    assert.equal(isDrafted(item), true)
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

// 只是单张重画被中断时,成稿状态本身没卡:只把资产停回待命,不改成稿状态。
test('真实序列:只是资产卡住的已完成成稿,settle 只停资产不改状态', async () => {
  const { dir, store, producer } = await fixture({ callText: async () => { throw new Error('不该被调用') }, ready: false })
  try {
    const id = addItem(await store.read(), '补画被中断的灵感')
    await store.mutate('模拟补画中断', (draft) => {
      // done + draft 是完成成稿后的正常状态;这里只把一张重画中的资产卡住
      draft.items.find(row => row.id === id).production = { status: 'done', stage: 'done', article: '已成稿的正文', cover: { status: 'running' }, images: [], shots: [] }
      draft.items.find(row => row.id === id).status = 'draft'
      return draft
    }, { undoable: false })
    await producer.settle(id)
    const item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.production.status, 'done', '卡住的只是资产,成稿状态不动')
    assert.equal(item.production.cover.status, 'idle')
    assert.equal(item.status, 'draft')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

// 场景④(User Story #30):手动改状态后,系统依据成稿产物与排期自动对齐。
test('场景④ 真实序列:已成稿条目手动改回灵感,系统按成稿产物与排期自愈对齐', async () => {
  const callText = async ({ system }) => (isPlan(system) ? { text: PLAN, model: 'd' } : { text: '# 标题\n\n## 第一节\n正文', model: 'd' })
  const { dir, store, producer } = await fixture({ callText, ready: false })
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  try {
    const id = addItem(await store.read(), '手动改状态的灵感')
    assert.equal(await producer.start(id, { withImages: false }), true)
    await waitDone(producer, id)
    // 手动把已成稿条目改回灵感:按成稿产物对齐回草稿,不是真的回灵感
    await runOps([{ op: 'set_status', id, status: 'idea' }])
    let item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.status, 'draft', '已成稿的不能标回灵感')
    assert.equal(isDrafted(item), true)
    // 排上日历再改回灵感:按排期与成稿产物对齐回待发布
    await runOps([{ op: 'schedule_item', id, scheduledAt: '2026-12-01T12:00:00Z' }])
    item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.status, 'ready')
    await runOps([{ op: 'set_status', id, status: 'idea' }])
    item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.status, 'ready', '已排期且已成稿的自愈回待发布')
    assert.equal(isScheduled(item), true)
    // 取消排期退回草稿;update_item 的状态写法同样自愈
    await runOps([{ op: 'schedule_item', id, scheduledAt: null }])
    item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.status, 'draft')
    await runOps([{ op: 'update_item', id, status: 'idea' }])
    item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.status, 'draft', 'update_item 改状态同样自愈')
    // 手动发布再撤回:发布时间跟着进出(旧规则不回退)
    await runOps([{ op: 'update_item', id, status: 'published' }])
    item = (await store.read()).items.find(row => row.id === id)
    assert.ok(item.publishedAt, '发布要记发布时间')
    await runOps([{ op: 'set_status', id, status: 'draft' }])
    item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.publishedAt, undefined, '离开已发布清掉发布时间')
    assert.equal(item.status, 'draft')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
