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

test('create_work:胶囊整堆立一篇作品,快照带标题,当前稿从来源标题起步', () => {
  const state = seed()
  applyOps(state, [{ op: 'add_capsule', name: '堆', itemIds: ['seed_1', 'seed_2'] }])
  const [capsule] = state.capsules
  const { receipts, errors } = applyOps(state, [{ op: 'create_work', capsuleIds: [capsule.id] }])
  assert.deepEqual(errors, [])
  const work = state.works.find(row => row.id === receipts[0].target)
  assert.ok(work, '回执 target 就是作品 id')
  assert.deepEqual(work.sourceItemIds, ['seed_1', 'seed_2'])
  assert.deepEqual(work.sourceCapsuleIds, [capsule.id])
  assert.deepEqual(work.sourceSnapshot.map(row => row.itemId), ['seed_1', 'seed_2'])
  assert.equal(work.current.title, state.items.find(row => row.id === 'seed_1').title)
  assert.equal(work.current.article, '')
  assert.equal(work.current.rev, 0)
  assert.equal(work.publication.status, 'draft')
  assert.equal(work.published, undefined)
})

test('create_work:同一批素材可以反复成稿,每篇独立;成稿即消费排期', () => {
  const state = seed()
  applyOps(state, [{ op: 'schedule_item', id: 'seed_2', scheduledAt: '2026-11-01T12:00:00.000Z' }])
  const first = applyOps(state, [{ op: 'create_work', itemIds: ['seed_2'] }]).receipts[0].target
  const second = applyOps(state, [{ op: 'create_work', itemIds: ['seed_2'] }]).receipts[0].target
  assert.notEqual(first, second)
  assert.equal(state.works.filter(row => !row.demo).length, 2)
  // 排期是「到点成稿」的提醒,成稿即消费,不会同一张卡反复提醒
  assert.ok(!state.items.find(row => row.id === 'seed_2').scheduledAt, '排期被消费掉了')
  // 删作品不删素材:来源仍在,作品只是少一篇；首次演示作品不参与这个场景计数
  applyOps(state, [{ op: 'delete_work', id: first }])
  assert.deepEqual(state.works.filter(row => !row.demo).map(row => row.id), [second])
  assert.ok(state.items.some(row => row.id === 'seed_2'))
})

test('write_work:会话写回落当前稿,rev 前进;旧 rev 被 409 拦下且正文不动', () => {
  const state = seed()
  const workId = applyOps(state, [{ op: 'create_work', itemIds: ['seed_1'] }]).receipts[0].target
  const { receipts } = applyOps(state, [{
    op: 'write_work', id: workId, rev: 0,
    title: '会话标题', article: '# 会话标题\n\n正文', coverText: '封面字',
    intent: { purpose: '教程', status: 'confirmed' },
    images: [{ src: 'writing-desk/files/a.png', caption: '示意图', anchor: '第一步' }],
  }])
  assert.match(receipts[0].text, /会话写回了/)
  const work = state.works.find(row => row.id === workId)
  assert.equal(work.current.title, '会话标题')
  assert.equal(work.current.article, '# 会话标题\n\n正文')
  assert.equal(work.current.coverText, '封面字')
  assert.equal(work.current.intent.status, 'confirmed')
  assert.equal(work.current.images[0].anchor, '第一步')
  assert.equal(work.current.rev, 1)
  // 只存当前稿(ADR 0014):没有快照、没有 aiOriginal、没有人工改动标记
  assert.equal(work.current.snapshots, undefined)
  assert.equal(work.current.aiArticle, undefined)
  // 会话拿着旧 rev 写回:冲突进 conflicts,当前稿保持不变
  const stale = applyOps(state, [{ op: 'write_work', id: workId, rev: 0, article: '会话的新版正文' }])
  assert.equal(stale.errors.length, 1)
  assert.equal(stale.conflicts.length, 1)
  assert.equal(stale.conflicts[0].rev, 1)
  assert.equal(work.current.article, '# 会话标题\n\n正文')
  // 冲突裁决在界面:用户选「覆盖」= 带 force 重发一次
  applyOps(state, [{ op: 'write_work', id: workId, rev: 0, article: '确认覆盖的正文', force: true }])
  assert.equal(work.current.article, '确认覆盖的正文')
  assert.equal(work.current.rev, 2)
})

test('update_work:自动保存走同一套字段与乐观锁,不带业务字段时不前进 rev', () => {
  const state = seed()
  const workId = applyOps(state, [{ op: 'create_work', itemIds: ['seed_1'] }]).receipts[0].target
  const work = state.works.find(row => row.id === workId)
  applyOps(state, [{ op: 'update_work', id: workId, rev: 0, article: '我手写的' }])
  assert.equal(work.current.article, '我手写的')
  assert.equal(work.current.rev, 1)
  // 停笔自动保存只带 rev、没带内容:不算一次修改
  applyOps(state, [{ op: 'update_work', id: workId, rev: 1 }])
  assert.equal(work.current.rev, 1)
  // 兼容旧字段名 workId
  applyOps(state, [{ op: 'update_work', workId, rev: 1, coverText: '封面' }])
  assert.equal(work.current.coverText, '封面')
  assert.equal(work.current.rev, 2)
})

test('publish_work:冻结发布稿;空作品不许发布', () => {
  const state = seed()
  const empty = applyOps(state, [{ op: 'create_work', itemIds: ['seed_1'] }]).receipts[0].target
  const blocked = applyOps(state, [{ op: 'publish_work', id: empty }])
  assert.match(blocked.errors[0], /还没有正文/)
  applyOps(state, [{ op: 'update_work', id: empty, rev: 0, article: '正文' }])
  const { receipts } = applyOps(state, [{ op: 'publish_work', id: empty }])
  assert.match(receipts[0].text, /已发布/)
  const work = state.works.find(row => row.id === empty)
  assert.equal(work.publication.status, 'published')
  assert.equal(work.published.article, '正文')
  // 发布稿是冻结副本:之后继续改当前稿不动它
  applyOps(state, [{ op: 'update_work', id: empty, rev: 1, article: '改过的正文' }])
  assert.equal(work.published.article, '正文')
  assert.equal(work.current.article, '改过的正文')
})
