// 真实序列回归:ops/reducer/store 走完整链路,不启 HTTP、不渲染 UI。
// 成稿迁移到会话侧(ADR 0006)后,「写一篇稿」的起点是 write_production(会话写回),
// 取代原内置流水线的 Producer 用例;其余自愈与集合关系不变量原样保留。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isDrafted, isScheduled, panelState, STATUSES } from '../src/state.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
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

// 场景④:已成稿条目手动改回灵感,系统按成稿产物与排期自愈对齐,不是真的回灵感。
test('场景④ 真实序列:已成稿条目手动改回灵感,系统按成稿产物与排期自愈对齐', async () => {
  const { dir, store } = await fixture()
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  try {
    const id = addItem(await store.read(), '手动改状态的灵感')
    await runOps([{ op: 'write_production', targetId: id, title: '标题', article: '# 标题\n\n正文' }])
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
    // 清掉正文后改回灵感:按未成稿的事实自愈
    await runOps([{ op: 'schedule_item', id, scheduledAt: null }, { op: 'update_production', id, article: '' }])
    await runOps([{ op: 'set_status', id, status: 'idea' }])
    item = (await store.read()).items.find(row => row.id === id)
    assert.equal(item.status, 'idea', '正文清空后真的能回灵感')
    assert.equal(isDrafted(item), false)
    assert.equal(panelState(item), 'idea')
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

// 场景③:成稿只有一个口径——会话写回(write_production)与人工改稿(update_production)
// 改的是同一份成稿产物,面板谓词与状态推演不再有第二套判断。
test('场景③ 真实序列:会话写回与人工改稿在谓词与状态推演上口径一致', async () => {
  const { dir, store } = await fixture()
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  const itemOf = async id => (await store.read()).items.find(row => row.id === id)
  try {
    const { receipts } = await runOps([{ op: 'add_item', title: '手改的' }, { op: 'add_item', title: '写回的' }])
    const [manualId, producedId] = receipts.map(row => row.target)
    // 两条都先有一份成稿产物:一条由会话写回、一条由会话写回后再人工改(可撤销的唯一手写通道)
    await runOps([
      { op: 'write_production', targetId: manualId, title: '手改的', article: '# 手改的\n\n会话初稿' },
      { op: 'write_production', targetId: producedId, title: '写回的', article: '# 写回的\n\n会话正文' },
    ])
    await runOps([{ op: 'update_production', id: manualId, article: '我自己改写的正文' }])
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
    // 手动改回灵感:两条同样自愈,手改与写回不再出现能标回/不能标回的分叉
    await runOps([{ op: 'set_status', id: manualId, status: 'idea' }, { op: 'set_status', id: producedId, status: 'idea' }])
    for (const id of [manualId, producedId]) {
      const item = await itemOf(id)
      assert.equal(item.status, 'ready', `${item.title}:已排期且已成稿,自愈回待发布`)
    }
    // 排了期还没写稿的条目:先停在大纲,会话写回后状态按排期与事实对齐回待发布
    const [third] = (await runOps([{ op: 'add_item', title: '排期后写回' }])).receipts
    await runOps([{ op: 'schedule_item', id: third.target, scheduledAt: '2026-12-02T12:00:00Z' }])
    assert.equal((await itemOf(third.target)).status, 'outline')
    await runOps([{ op: 'write_production', targetId: third.target, article: '排期里写回的正文' }])
    const thirdItem = await itemOf(third.target)
    assert.equal(thirdItem.status, 'ready', '排期里写完稿就对待发布')
    assert.equal(isDrafted(thirdItem), true)
    assert.equal(panelState(thirdItem), 'drafted')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

// 胶囊集合关系纳入同一套 ops/reducer 不变量:成员的写回、改状态、排期都不影响胶囊存在性,
// 成员被删自动出列、删光解散。
test('真实序列:胶囊成员的状态迁移与删除不破坏集合关系', async () => {
  const { dir, store } = await fixture()
  const runOps = ops => store.mutate('操作', draft => applyOps(draft, ops))
  const members = async name => (await store.read()).capsules.find(capsule => capsule.name === name)?.itemIds
  try {
    const { receipts } = await runOps([{ op: 'add_item', title: '成员甲' }, { op: 'add_item', title: '成员乙' }, { op: 'add_item', title: '成员丙' }])
    const [a, b, c] = receipts.map(row => row.target)
    await runOps([{ op: 'add_capsule', name: '选题堆', itemIds: [a, b, c] }])
    // 成员甲交会话并写回、成员乙手动改状态来回、成员丙排期又取消——胶囊纹丝不动
    await runOps([{ op: 'send_to_session', itemIds: [a] }, { op: 'write_production', targetId: a, article: '成员甲的成稿' }])
    await runOps([{ op: 'set_status', id: b, status: 'draft' }, { op: 'set_status', id: b, status: 'idea' }])
    await runOps([{ op: 'schedule_item', id: c, scheduledAt: '2026-12-03T12:00:00Z' }, { op: 'schedule_item', id: c, scheduledAt: null }])
    assert.deepEqual(await members('选题堆'), [a, b, c], '成员状态变化不影响胶囊存在性')
    const written = (await store.read()).items.find(row => row.id === a)
    assert.equal(written.sentToSession, undefined, '写回清掉交会话的登记')
    // 成员被删自动出列;删光解散
    await runOps([{ op: 'delete_item', id: a }])
    assert.deepEqual(await members('选题堆'), [b, c])
    await runOps([{ op: 'delete_item', id: b }, { op: 'delete_item', id: c }])
    assert.equal((await store.read()).capsules.length, 0, '成员删光,胶囊跟着解散')
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
