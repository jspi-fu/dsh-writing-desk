// 真实序列回归:ops/reducer/store 走完整链路,不启 HTTP、不渲染 UI。
// 成稿与发布都已迁到作品(ADR 0013):素材只剩阶段与排期,作品承载正文与发布状态。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isScheduled, STATUSES } from '../src/state.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { isUsed, workHasText } from '../src/work.js'
import { Store } from '../src/store.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-seq-'))
  const store = new Store(dir)
  await store.read()
  return { dir, store }
}

/** 新起一条自己的灵感,返回 id。 */
function addItem(state, title) {
  const { receipts } = applyOps(state, [{ op: 'add_item', title, body: '素材正文', contentOrigin: 'user' }])
  return receipts[0].target
}

// 场景④:素材只剩阶段——排期在,状态自愈到大纲/待发布;撤了排期才真的回灵感。
test('场景④ 真实序列:手动改阶段按排期事实自愈,撤排期才真的回灵感', async () => {
  const { dir, store } = await fixture()
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  const itemOf = async id => (await store.read()).items.find(row => row.id === id)
  try {
    const id = addItem(await store.read(), '手动改状态的灵感')
    // 没排期:阶段完全听用户的,标灵感就是灵感
    await runOps([{ op: 'set_status', id, status: 'draft' }])
    assert.equal((await itemOf(id)).status, 'draft')
    await runOps([{ op: 'set_status', id, status: 'idea' }])
    assert.equal((await itemOf(id)).status, 'idea')
    // 排上日历:没正文就是大纲
    await runOps([{ op: 'schedule_item', id, scheduledAt: '2026-12-01T12:00:00Z' }])
    assert.equal((await itemOf(id)).status, 'outline')
    // 排期还在时手动改回灵感:自愈回大纲,不是真的回灵感
    await runOps([{ op: 'set_status', id, status: 'idea' }])
    assert.equal((await itemOf(id)).status, 'outline')
    // 撤掉排期后改回灵感:这次真的回灵感
    await runOps([{ op: 'schedule_item', id, scheduledAt: null }, { op: 'set_status', id, status: 'idea' }])
    const after = await itemOf(id)
    assert.equal(after.status, 'idea')
    assert.equal(isScheduled(after), false)
    // 「已发布」不再是素材阶段:写进去也会被拉回草稿
    await runOps([{ op: 'set_status', id, status: 'published' }])
    assert.equal((await itemOf(id)).status, 'draft')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

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
    // 没有排期也没有正文时,待发布/已发布都会被自愈压回草稿
    if (status === 'ready' || status === 'published') assert.equal(a.status, 'draft')
    assert.equal(Boolean(a.publishedAt), Boolean(b.publishedAt), `status=${status}:发布时间同进同退`)
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
  assert.equal(a.status, 'ready', '排期里显式标待发布:保持待发布')
  assert.equal(a.status, b.status)
  assert.equal(a.scheduledAt, b.scheduledAt)
})

// 场景③:成稿只有作品一条链路——从素材开作品、写当前稿、发布、撤下,与素材集合互不污染。
test('场景③ 真实序列:作品承载正文与发布,素材只被引用不被改写', async () => {
  const { dir, store } = await fixture()
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  const read = async () => store.read()
  try {
    const ids = await runOps([{ op: 'add_item', title: '第一篇' }, { op: 'add_item', title: '第二篇' }]).then(row => row.receipts.map(r => r.target))
    const { receipts } = await runOps([{ op: 'create_work', itemIds: ids }])
    const workId = receipts[0].target
    let state = await read()
    let work = state.works.find(row => row.id === workId)
    assert.equal(work.current.rev, 0)
    assert.equal(work.publication.status, 'draft')
    assert.deepEqual(work.sourceItemIds, ids)
    // 素材被引用 = 已用,但素材本身没有正文
    assert.equal(isUsed(state, ids[0]), true)
    assert.equal(state.items.find(row => row.id === ids[0]).article, undefined)
    // 写当前稿:rev 前进,其他素材状态不动
    await runOps([{ op: 'update_work', id: workId, rev: 0, title: '第一篇', article: '# 第一篇\n\n正文' }])
    state = await read()
    work = state.works.find(row => row.id === workId)
    assert.equal(work.current.rev, 1)
    assert.equal(workHasText(work), true)
    // 发布:冻结发布稿,当前稿继续可改
    await runOps([{ op: 'publish_work', id: workId }])
    state = await read()
    work = state.works.find(row => row.id === workId)
    assert.equal(work.publication.status, 'published')
    assert.ok(work.published.publishedAt)
    await runOps([{ op: 'update_work', id: workId, rev: work.current.rev, article: '改过的正文' }])
    state = await read()
    work = state.works.find(row => row.id === workId)
    assert.equal(work.current.article, '改过的正文')
    assert.equal(work.published.article, '# 第一篇\n\n正文', '发布稿不动')
    // 同一批素材可以再开一篇:成稿历史保留
    const again = await runOps([{ op: 'create_work', itemIds: ids }])
    state = await read()
    assert.equal(state.works.filter(row => !row.demo).length, 2)
    assert.notEqual(again.receipts[0].target, workId)
    // 删素材不删作品(作品有独立副本)
    await runOps([{ op: 'delete_item', id: ids[1] }])
    state = await read()
    assert.equal(state.items.some(row => row.id === ids[1]), false)
    assert.ok(state.works.some(row => row.id === workId))
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

// 胶囊集合关系纳入同一套 ops/reducer 不变量:成员开作品、改阶段、排期都不影响胶囊存在性,
// 成员被删自动出列、删光解散。
test('真实序列:胶囊成员的成稿与状态迁移不破坏集合关系', async () => {
  const { dir, store } = await fixture()
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  const members = async name => (await store.read()).capsules.find(capsule => capsule.name === name)?.itemIds
  try {
    const { receipts } = await runOps([{ op: 'add_item', title: '成员甲' }, { op: 'add_item', title: '成员乙' }, { op: 'add_item', title: '成员丙' }])
    const [a, b, c] = receipts.map(row => row.target)
    await runOps([{ op: 'add_capsule', name: '选题堆', itemIds: [a, b, c] }])
    // 整堆开作品、成员乙改阶段来回、成员丙排期又取消——胶囊纹丝不动
    const work = (await runOps([{ op: 'create_work', capsuleIds: [(await store.read()).capsules[0].id] }])).receipts[0].target
    await runOps([{ op: 'set_status', id: b, status: 'draft' }, { op: 'set_status', id: b, status: 'idea' }])
    await runOps([{ op: 'schedule_item', id: c, scheduledAt: '2026-12-03T12:00:00Z' }, { op: 'schedule_item', id: c, scheduledAt: null }])
    assert.deepEqual(await members('选题堆'), [a, b, c], '成员状态变化不影响胶囊存在性')
    const state = await store.read()
    // 整堆成稿把三个成员都记进作品
    assert.deepEqual(state.works[0].sourceItemIds, [a, b, c])
    assert.equal(state.works[0].id, work)
    // 成员被删自动出列;删光解散,作品里的来源快照不受影响
    await runOps([{ op: 'delete_item', id: a }])
    assert.deepEqual(await members('选题堆'), [b, c])
    await runOps([{ op: 'delete_item', id: b }, { op: 'delete_item', id: c }])
    const end = await store.read()
    assert.equal(end.capsules.filter(row => !row.demo).length, 0, '成员删光,用户胶囊跟着解散；首次演示胶囊不受影响')
    assert.deepEqual(end.works[0].sourceItemIds, [a, b, c], '作品保留来源记录')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
