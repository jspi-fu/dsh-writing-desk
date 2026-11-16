// 状态权威迁移的真实操作序列测试(工单 #5):按创作者的真实操作次序,
// 断言四个历史不一致场景消失。与 host.test.js 同一层:直接调用 Store / Producer /
// applyOps 与 src/state.js 的共享谓词,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isDrafted, isScheduled, panelState, STATUSES } from '../src/state.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { Store } from '../src/store.js'
import { Producer } from '../src/produce.js'
import { Settings } from '../src/settings.js'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

const NOW = new Date('2026-10-31T15:00:00+08:00')

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

// add_item 带状态/排期初值,与「先建空灵感再 set_status/schedule_item」必须走同一批
// reducer 事件:同参数下终态完全一致,不许出现「新建时能到达、事后改不到」的状态。
test('真实序列:add_item 带状态初值与先建后改的终态一致', () => {
  const WHEN = '2026-12-01T12:00:00.000Z'
  const newest = (state, title) => state.items.find(row => row.title === title)
  for (const status of STATUSES) {
    const direct = buildSeed(NOW)
    applyOps(direct, [{ op: 'add_item', title: `直接带 ${status}`, body: '素材正文', status }])
    const staged = buildSeed(NOW)
    const { receipts } = applyOps(staged, [{ op: 'add_item', title: `先建后改 ${status}`, body: '素材正文' }])
    applyOps(staged, [{ op: 'set_status', id: receipts[0].target, status }])
    const a = newest(direct, `直接带 ${status}`)
    const b = newest(staged, `先建后改 ${status}`)
    assert.equal(a.status, b.status, `status=${status}:两种路径终态一致`)
    assert.equal(Boolean(a.publishedAt), Boolean(b.publishedAt), `status=${status}:发布时间同进同退`)
    if (status === 'published') assert.ok(a.publishedAt, '发布的记下发布时间')
  }
  // 带排期的初值也一样:与 add_item + schedule_item + set_status 同参数同终态
  const direct = buildSeed(NOW)
  applyOps(direct, [{ op: 'add_item', title: '直接带排期', body: '素材正文', status: 'ready', scheduledAt: WHEN }])
  const staged = buildSeed(NOW)
  const { receipts } = applyOps(staged, [{ op: 'add_item', title: '先建后排期', body: '素材正文' }])
  applyOps(staged, [
    { op: 'schedule_item', id: receipts[0].target, scheduledAt: WHEN },
    { op: 'set_status', id: receipts[0].target, status: 'ready' },
  ])
  const a = newest(direct, '直接带排期')
  const b = newest(staged, '先建后排期')
  assert.equal(a.status, 'ready', '排期里补状态按成稿与排期事实对齐')
  assert.equal(a.status, b.status)
  assert.equal(a.scheduledAt, b.scheduledAt)
  // 没成稿的灵感标待发布,自愈拉回草稿——新建时也不许绕过这条规则
  const bare = buildSeed(NOW)
  applyOps(bare, [{ op: 'add_item', title: '直接标待发布', body: '素材正文', status: 'ready' }])
  assert.equal(newest(bare, '直接标待发布').status, 'draft', '没排期没成稿的待发布自愈回草稿')
})

// 场景③:成稿只有一个口径——手写稿走 update_production 改的是同一份成稿产物,
// 面板谓词与状态推演不再有第二套判断(工单 #7 清掉遗留草稿字段)。
test('场景③ 真实序列:手动改稿与生成稿在谓词与状态推演上口径一致', async () => {
  const callText = async ({ system }) => (isPlan(system) ? { text: PLAN, model: 'd' } : { text: '# 标题\n\n## 第一节\n生成的正文', model: 'd' })
  const { dir, store, producer } = await fixture({ callText, ready: false })
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  const itemOf = async id => (await store.read()).items.find(row => row.id === id)
  try {
    const { receipts } = await runOps([{ op: 'add_item', title: '手改的' }, { op: 'add_item', title: '生成的' }])
    const [manualId, producedId] = receipts.map(row => row.target)
    // 两条都先有一份成稿产物;手改的那条再经 ops 手动改正文(可撤销的唯一手写通道)
    assert.equal(await producer.start(manualId, { withImages: false }), true)
    await waitDone(producer, manualId)
    await runOps([{ op: 'update_production', id: manualId, article: '我自己改写的正文' }])
    assert.equal(await producer.start(producedId, { withImages: false }), true)
    await waitDone(producer, producedId)
    for (const id of [manualId, producedId]) {
      const item = await itemOf(id)
      assert.equal(isDrafted(item), true, `${item.title}:已成稿`)
      assert.equal(panelState(item), 'drafted', `${item.title}:面板口径是已成稿`)
      assert.equal(item.status, 'draft')
    }
    // 排期:两条一起推进待发布,面板口径仍一致
    await runOps([
      { op: 'schedule_item', id: manualId, scheduledAt: '2026-12-01T12:00:00Z' },
      { op: 'schedule_item', id: producedId, scheduledAt: '2026-12-01T12:00:00Z' },
    ])
    for (const id of [manualId, producedId]) {
      const item = await itemOf(id)
      assert.equal(item.status, 'ready')
      assert.equal(isScheduled(item), true)
      assert.equal(panelState(item), 'drafted')
    }
    // 手动改回灵感:两条同样自愈,手改与生成不再出现能标回/不能标回的分叉
    await runOps([{ op: 'set_status', id: manualId, status: 'idea' }, { op: 'set_status', id: producedId, status: 'idea' }])
    for (const id of [manualId, producedId]) {
      const item = await itemOf(id)
      assert.equal(item.status, 'ready', `${item.title}:已排期且已成稿,自愈回待发布`)
    }
    // 排了期还没写稿的条目:先停在大纲,补写正文(手动改稿)后状态按排期与事实对齐回待发布
    const [third] = (await runOps([{ op: 'add_item', title: '排期后手写' }])).receipts
    await runOps([{ op: 'schedule_item', id: third.target, scheduledAt: '2026-12-02T12:00:00Z' }])
    assert.equal((await itemOf(third.target)).status, 'outline')
    assert.equal(await producer.start(third.target, { withImages: false }), true)
    await waitDone(producer, third.target)
    await runOps([{ op: 'update_production', id: third.target, article: '排期后补写的正文' }])
    const thirdItem = await itemOf(third.target)
    assert.equal(thirdItem.status, 'ready', '排期里写完稿就对待发布')
    assert.equal(isDrafted(thirdItem), true)
    assert.equal(panelState(thirdItem), 'drafted')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

// 胶囊集合关系纳入同一套 ops/reducer 不变量:成员的成稿、改状态、排期都不影响胶囊存在性,
// 成员被删自动出列、删光解散。
test('真实序列:胶囊成员的状态迁移与删除不破坏集合关系', async () => {
  const callText = async ({ system }) => (isPlan(system) ? { text: PLAN, model: 'd' } : { text: '# 标题\n\n## 第一节\n正文', model: 'd' })
  const { dir, store, producer } = await fixture({ callText, ready: false })
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  const members = async name => (await store.read()).capsules.find(capsule => capsule.name === name)?.itemIds
  try {
    const { receipts } = await runOps([{ op: 'add_item', title: '成员甲' }, { op: 'add_item', title: '成员乙' }, { op: 'add_item', title: '成员丙' }])
    const [a, b, c] = receipts.map(row => row.target)
    await runOps([{ op: 'add_capsule', name: '选题堆', itemIds: [a, b, c] }])
    // 成员甲生成成稿、成员乙手动改状态来回、成员丙排期又取消——胶囊纹丝不动
    assert.equal(await producer.start(a, { withImages: false }), true)
    await waitDone(producer, a)
    await runOps([{ op: 'set_status', id: b, status: 'draft' }, { op: 'set_status', id: b, status: 'idea' }])
    await runOps([{ op: 'schedule_item', id: c, scheduledAt: '2026-12-03T12:00:00Z' }, { op: 'schedule_item', id: c, scheduledAt: null }])
    assert.deepEqual(await members('选题堆'), [a, b, c], '成员状态变化不影响胶囊存在性')
    // 成员被删自动出列;删光解散
    await runOps([{ op: 'delete_item', id: a }])
    assert.deepEqual(await members('选题堆'), [b, c])
    await runOps([{ op: 'delete_item', id: b }, { op: 'delete_item', id: c }])
    assert.equal((await store.read()).capsules.length, 0, '成员删光,胶囊跟着解散')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
