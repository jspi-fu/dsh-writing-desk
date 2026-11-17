// 成稿输入统一入口(GLOSSARY「成稿输入」):单灵感/多灵感/单胶囊/多胶囊解析为同一种输入,
// 引用进创作会话(ADR 0006)与写回落点都以它为准。
// 与 host.test.js 同一层:纯函数 + ops 走真状态,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import { resolveProduceInput } from '../src/produce-input.js'
import { buildSeed } from '../src/seed.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')

function seed() {
  return buildSeed(NOW)
}

test('四种成稿输入归一为同一种 {sourceIds, targetId}', () => {
  const state = seed()
  applyOps(state, [
    { op: 'add_capsule', name: '甲', itemIds: ['seed_1', 'seed_2'] },
    { op: 'add_capsule', name: '乙', itemIds: ['seed_3', 'seed_4'] },
  ])
  const capA = state.capsules.find(row => row.name === '甲')
  const capB = state.capsules.find(row => row.name === '乙')
  // 单灵感:旧入口 {id} 与 {itemIds:[id]} 同一种输入
  assert.deepEqual(resolveProduceInput(state, { id: 'seed_2' }), { sourceIds: ['seed_2'], targetId: 'seed_2' })
  assert.deepEqual(resolveProduceInput(state, { itemIds: ['seed_2'] }), { sourceIds: ['seed_2'], targetId: 'seed_2' })
  // 多灵感:引用与落点都取第一个。理由:成稿产物必须写在一条灵感的 production 字段上
  // (production 形状与 draft/ready 状态、排期依赖都不能动);新建承载灵感要多出一种实体,
  // 首个来源当落点最小——全部素材照样被会话读到,其余来源原样保留、随时可单独打开
  assert.deepEqual(resolveProduceInput(state, { itemIds: ['seed_1', 'seed_2'] }), { sourceIds: ['seed_1', 'seed_2'], targetId: 'seed_1' })
  // 单胶囊 / 多胶囊:解析成员,同一种输入
  assert.deepEqual(resolveProduceInput(state, { capsuleIds: [capA.id] }), { sourceIds: ['seed_1', 'seed_2'], targetId: 'seed_1' })
  assert.deepEqual(resolveProduceInput(state, { capsuleIds: [capB.id, capA.id] }), { sourceIds: ['seed_3', 'seed_4', 'seed_1', 'seed_2'], targetId: 'seed_3' })
})

test('去重并保持给定顺序', () => {
  const state = seed()
  applyOps(state, [{ op: 'add_capsule', name: '堆', itemIds: ['seed_2', 'seed_3'] }])
  const [capsule] = state.capsules
  assert.deepEqual(resolveProduceInput(state, { itemIds: ['seed_1', 'seed_1', 'seed_2'] }).sourceIds, ['seed_1', 'seed_2'])
  // 灵感与胶囊混着给:灵感在前,重复成员只算一次
  assert.deepEqual(
    resolveProduceInput(state, { itemIds: ['seed_1', 'seed_2'], capsuleIds: [capsule.id] }).sourceIds,
    ['seed_1', 'seed_2', 'seed_3'],
  )
})

test('已删除的灵感被过滤;全部失效时报 400', () => {
  const state = seed()
  applyOps(state, [{ op: 'add_capsule', name: '堆', itemIds: ['seed_1', 'seed_2', 'seed_3'] }])
  const [capsule] = state.capsules
  applyOps(state, [{ op: 'delete_item', id: 'seed_1' }])
  // 灵感 ID 失效:直接滤掉
  assert.deepEqual(resolveProduceInput(state, { itemIds: ['seed_1', 'seed_2'] }).sourceIds, ['seed_2'])
  // 胶囊成员失效:只留活着的成员
  assert.deepEqual(resolveProduceInput(state, { capsuleIds: [capsule.id] }).sourceIds, ['seed_2', 'seed_3'])
  // 一个能用的都没有:成稿无从谈起
  const err = (() => { try { resolveProduceInput(state, { itemIds: ['seed_1'] }); return null } catch (error) { return error } })()
  assert.ok(err)
  assert.equal(err.status, 400)
  assert.throws(() => resolveProduceInput(state, { itemIds: [] }), err => err.status === 400)
  assert.throws(() => resolveProduceInput(state, {}), err => err.status === 400)
})

test('send_to_session:整批来源登记 sentToSession,写回时由 submit 清掉', () => {
  const state = seed()
  applyOps(state, [{ op: 'add_capsule', name: '堆', itemIds: ['seed_1', 'seed_2'] }])
  const [capsule] = state.capsules
  const { receipts } = applyOps(state, [{ op: 'send_to_session', capsuleIds: [capsule.id] }])
  assert.match(receipts[0].text, /2 条灵感/)
  const first = state.items.find(row => row.id === 'seed_1')
  const second = state.items.find(row => row.id === 'seed_2')
  assert.ok(first.sentToSession?.at)
  assert.ok(second.sentToSession?.at)
  // 全部失效时不产生登记,回执给错误
  const { errors } = applyOps(state, [{ op: 'send_to_session', itemIds: ['gone'] }])
  assert.match(errors[0], /没有可用的灵感/)
})

test('write_production:整链写回——建产物、清登记、rev 前进、快照带内容', () => {
  const state = seed()
  applyOps(state, [{ op: 'send_to_session', itemIds: ['seed_1'] }])
  const { receipts } = applyOps(state, [{
    op: 'write_production', targetId: 'seed_1', rev: 0,
    title: '会话标题', article: '# 会话标题\n\n正文', coverText: '封面字',
    intent: { purpose: '教程', status: 'confirmed' },
    images: [{ src: 'writing-desk/files/a.png', caption: '示意图', anchor: '第一步' }],
    note: '初稿',
  }])
  assert.match(receipts[0].text, /会话写回了/)
  const item = state.items.find(row => row.id === 'seed_1')
  assert.equal(item.production.status, 'done')
  assert.equal(item.production.title, '会话标题')
  assert.equal(item.production.aiArticle, item.production.article)
  assert.equal(item.production.intent.status, 'confirmed')
  assert.equal(item.production.images[0].anchor, '第一步')
  assert.equal(item.production.rev, 1)
  assert.equal(item.production.snapshots[0].note, '初稿')
  assert.equal(item.production.snapshots[0].article, item.production.article)
  assert.equal(item.sentToSession, undefined)
  assert.equal(item.status, 'draft')
})

test('write_production:rev 基线不符时拦截并暂存 pendingWrite,裁决走 apply/discard', () => {
  const state = seed()
  applyOps(state, [
    { op: 'write_production', targetId: 'seed_1', title: '第一版', article: '第一版正文' },
    { op: 'update_production', id: 'seed_1', article: '我手改的正文' },
  ])
  const item = state.items.find(row => row.id === 'seed_1')
  const rev = item.production.rev
  // 会话还拿着旧 rev 写回:被拦下、暂存,状态与正文都不动
  const { errors } = applyOps(state, [{ op: 'write_production', targetId: 'seed_1', rev: 1, article: '会话的新版正文', note: '润色' }])
  assert.match(errors[0], /冲突/)
  assert.equal(item.production.article, '我手改的正文')
  assert.equal(item.production.pendingWrite.article, '会话的新版正文')
  assert.equal(item.production.pendingWrite.note, '润色')
  // 接受暂存:会话版本落库,rev 前进,暂存清掉
  applyOps(state, [{ op: 'apply_write', targetId: 'seed_1' }])
  assert.equal(item.production.article, '会话的新版正文')
  assert.equal(item.production.rev, rev + 1)
  assert.equal(item.production.pendingWrite, undefined)
  // 再来一次冲突,这次保留我的
  applyOps(state, [{ op: 'write_production', targetId: 'seed_1', rev: 1, title: '又一个新标题' }])
  assert.equal(item.production.pendingWrite.title, '又一个新标题')
  applyOps(state, [{ op: 'discard_write', targetId: 'seed_1' }])
  assert.notEqual(item.production.title, '又一个新标题')
  assert.equal(item.production.pendingWrite, undefined)
  // 没有暂存时报错不炸
  const empty1 = applyOps(state, [{ op: 'apply_write', targetId: 'seed_1' }])
  assert.match(empty1.errors[0], /没有待裁决的写回/)
  const empty2 = applyOps(state, [{ op: 'discard_write', targetId: 'seed_1' }])
  assert.match(empty2.errors[0], /没有待裁决的写回/)
})

test('write_production:force 语义只在用户明确说覆盖时生效', () => {
  const state = seed()
  applyOps(state, [
    { op: 'write_production', targetId: 'seed_1', title: '第一版', article: '第一版正文' },
    { op: 'update_production', id: 'seed_1', article: '我手改的正文' },
  ])
  applyOps(state, [{ op: 'write_production', targetId: 'seed_1', rev: 1, article: '用户明确让覆盖的版本', force: true }])
  const item = state.items.find(row => row.id === 'seed_1')
  assert.equal(item.production.article, '用户明确让覆盖的版本')
  assert.equal(item.production.pendingWrite, undefined)
})
