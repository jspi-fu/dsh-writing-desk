// 胶囊实体与批量改标签的领域测试:与 host.test.js 同一层,直接调用 applyOps / Store,
// 不启 HTTP、不渲染 UI。胶囊是持久化的命名灵感集合,成员灵感仍独立存在。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import { buildSeed, migrateState } from '../src/seed.js'
import { Store } from '../src/store.js'
import { retagPreview, tagShelf } from '../client/tags.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')

function seed() {
  return buildSeed(NOW)
}

test('拖到一起生成命名胶囊并持久化,成员灵感保持独立', async () => {
  const state = seed()
  const { receipts, errors } = applyOps(state, [{ op: 'add_capsule', name: '周末选题', itemIds: ['seed_1', 'seed_2'] }])
  assert.deepEqual(errors, [])
  const capsule = state.capsules[0]
  assert.equal(capsule.name, '周末选题')
  assert.deepEqual(capsule.itemIds, ['seed_1', 'seed_2'])
  assert.equal(capsule.id, receipts[0].target)
  assert.ok(capsule.createdAt, '胶囊记下创建时间')
  // 成员灵感仍独立存在,没有被合并掉
  assert.ok(state.items.some(i => i.id === 'seed_1'))
  assert.ok(state.items.some(i => i.id === 'seed_2'))
  // 下次打开仍在:落到 state.json,另一个 Store 实例(模拟重开)读得到
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-capsule-'))
  try {
    const saved = new Store(dir)
    await saved.mutate('聚合胶囊', s => applyOps(s, [{ op: 'add_capsule', name: '周末选题', itemIds: ['seed_1', 'seed_2'] }]))
    const reopened = new Store(dir)
    assert.deepEqual((await reopened.read()).capsules.map(c => c.name), ['周末选题'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('胶囊成员必须真实存在、去重、非空;空名字给默认名', () => {
  const state = seed()
  const missing = applyOps(state, [{ op: 'add_capsule', name: 'x', itemIds: ['nope', 'seed_1'] }])
  assert.equal(missing.errors.length, 1)
  assert.deepEqual(state.capsules, [], '拒收时不留下半个胶囊')
  const empty = applyOps(state, [{ op: 'add_capsule', itemIds: [] }])
  assert.equal(empty.errors.length, 1)
  const { receipts, errors: dupErrors } = applyOps(state, [{ op: 'add_capsule', itemIds: ['seed_1', 'seed_1', 'seed_2'] }])
  assert.deepEqual(dupErrors, [])
  const capsule = state.capsules.find(c => c.id === receipts[0].target)
  assert.deepEqual(capsule.itemIds, ['seed_1', 'seed_2'])
  assert.ok(capsule.name.startsWith('普通人第一次用'), '没起名就拿第一条成员的标题当名字')
  assert.ok(capsule.name.length <= 19, '名字按 18 字截断,够写在胶囊下面')
})

test('第一条成员既没有标题也没有正文时,胶囊退回默认名', () => {
  const state = seed()
  // 导入的裸数据可能两个字段都是空的;add_item 自己会补标题,这里直接塞进去模拟
  state.items.push({ id: 'bare', kind: 'note', title: '', body: '', tags: [], createdAt: NOW.toISOString() })
  const { receipts } = applyOps(state, [{ op: 'add_capsule', itemIds: ['bare', 'seed_2'] }])
  const capsule = state.capsules.find(c => c.id === receipts[0].target)
  assert.equal(capsule.name, '新胶囊')
})

test('改名与换成员;解散胶囊只删集合关系,成员灵感完整保留', () => {
  const state = seed()
  const { receipts } = applyOps(state, [{ op: 'add_capsule', name: '临时堆', itemIds: ['seed_1', 'seed_2'] }])
  const id = receipts[0].target
  const { receipts: renamed, errors: renameErrors } = applyOps(state, [{ op: 'update_capsule', id, name: '周末选题', itemIds: ['seed_2', 'seed_3'] }])
  assert.deepEqual(renameErrors, [])
  assert.equal(state.capsules[0].name, '周末选题')
  assert.deepEqual(state.capsules[0].itemIds, ['seed_2', 'seed_3'])
  const member = state.items.find(i => i.id === 'seed_3')
  const { receipts: dissolved, errors } = applyOps(state, [{ op: 'delete_capsule', id }])
  assert.deepEqual(errors, [])
  assert.deepEqual(state.capsules, [], '胶囊整个消失')
  // 成员原样还在:字段一个没动,可以单独打开
  assert.equal(state.items.find(i => i.id === 'seed_3')?.title, member.title)
  assert.equal(state.items.find(i => i.id === 'seed_3')?.status, member.status)
  assert.ok(dissolved[0].text.includes('周末选题'))
  // 不存在的胶囊报错
  assert.equal(applyOps(state, [{ op: 'delete_capsule', id }]).errors.length, 1)
  assert.equal(applyOps(state, [{ op: 'update_capsule', id, name: '再改' }]).errors.length, 1)
})

test('删掉成员灵感,只剩一个就自动解散', () => {
  const state = seed()
  applyOps(state, [{ op: 'add_capsule', name: '堆', itemIds: ['seed_1', 'seed_2', 'seed_3'] }])
  applyOps(state, [{ op: 'delete_item', id: 'seed_1' }])
  assert.deepEqual(state.capsules[0].itemIds, ['seed_2', 'seed_3'], '还剩两个成员时胶囊保留')
  applyOps(state, [{ op: 'delete_item', id: 'seed_2' }])
  assert.deepEqual(state.capsules, [], '只剩一个成员时胶囊自动解散')
  assert.ok(state.items.some(i => i.id === 'seed_3'), '最后一个成员仍独立存在')
})

test('清空示例后,胶囊里挂着的示例成员一并摘掉,不足两个的自动解散', () => {
  const state = seed()
  const { receipts: added } = applyOps(state, [{ op: 'add_item', title: '我自己的' }])
  const mine = added[0].target
  applyOps(state, [
    { op: 'add_capsule', name: '混着', itemIds: ['seed_1', mine] },
    { op: 'add_capsule', name: '全是示例', itemIds: ['seed_2', 'seed_3'] },
  ])
  applyOps(state, [{ op: 'clear_samples' }])
  assert.equal(state.capsules.length, 0, '只剩一个成员的胶囊自动解散')
  assert.ok(state.items.some(i => i.id === mine), '自己的灵感仍在画布上')
})

test('一个灵感只属于一个胶囊;少于两个成员不能建胶囊', () => {
  const state = seed()
  assert.equal(applyOps(state, [{ op: 'add_capsule', name: '独苗', itemIds: ['seed_1'] }]).errors.length, 1, '单个成员不能建胶囊')
  applyOps(state, [{ op: 'add_capsule', name: '甲', itemIds: ['seed_1', 'seed_2'] }])
  applyOps(state, [{ op: 'add_capsule', name: '乙', itemIds: ['seed_2', 'seed_3'] }])
  assert.equal(state.capsules.length, 1, '甲被拿走 seed_2 后只剩一个成员,自动解散')
  assert.equal(state.capsules[0].name, '乙')
  assert.deepEqual(state.capsules[0].itemIds, ['seed_2', 'seed_3'])
})

test('拖走成员只剩一个时,update_capsule 自动解散,最后一个成员留在灵感流里', () => {
  const state = seed()
  applyOps(state, [{ op: 'add_capsule', name: '堆', itemIds: ['seed_1', 'seed_2'] }])
  const { receipts, errors } = applyOps(state, [{ op: 'update_capsule', id: state.capsules[0].id, itemIds: ['seed_1'] }])
  assert.deepEqual(errors, [])
  assert.equal(state.capsules.length, 0)
  assert.match(receipts[0].text, /自动解散/)
  const left = state.items.find(i => i.id === 'seed_1')
  assert.ok(left, '最后一个成员仍是独立灵感')
  assert.equal(left.pos, undefined, '解散不再写画布坐标')
})

test('读旧数据时,只剩一个成员的胶囊直接解散,成员留在灵感墙上', () => {
  const state = seed()
  state.capsules = [
    { id: 'cap_old', name: '旧胶囊', itemIds: ['seed_1'], createdAt: NOW.toISOString() },
    { id: 'cap_dup', name: '抢了别人成员的胶囊', itemIds: ['seed_2', 'seed_3'], createdAt: NOW.toISOString() },
    { id: 'cap_ok', name: '正常胶囊', itemIds: ['seed_2', 'seed_3'], createdAt: NOW.toISOString() },
  ]
  const migrated = migrateState(state)
  assert.deepEqual(migrated.capsules.map(c => c.id), ['cap_dup'], '单成员胶囊解散,重复归属只留第一个')
  assert.deepEqual(migrated.capsules[0].itemIds, ['seed_2', 'seed_3'])
  assert.ok(migrated.items.some(i => i.id === 'seed_1'), '成员灵感仍在')
})

test('批量改标签带期望 revision:版本一致才应用,应用后版本前进', () => {
  const state = seed()
  const { receipts, errors } = applyOps(state, [{ op: 'retag_items', itemIds: ['seed_1', 'seed_2'], tags: ['选题', '周末'], revisions: { seed_1: 0, seed_2: 0 } }])
  assert.deepEqual(errors, [])
  assert.equal(receipts.length, 1)
  for (const id of ['seed_1', 'seed_2']) {
    const item = state.items.find(i => i.id === id)
    assert.deepEqual(item.tags, ['选题', '周末'])
    assert.equal(item.revision, 1, '标签写进库里,版本跟着走')
  }
})

test('update_item 改标签同样前进版本,改别的字段不动版本', () => {
  const state = seed()
  applyOps(state, [{ op: 'update_item', id: 'seed_1', tags: ['手动放的'] }])
  const item = state.items.find(i => i.id === 'seed_1')
  assert.deepEqual(item.tags, ['手动放的'])
  assert.equal(item.revision, 1, '手动分类也是一次标签变更')
  applyOps(state, [{ op: 'update_item', id: 'seed_1', title: '换个标题' }])
  assert.equal(state.items.find(i => i.id === 'seed_1').revision, 1, '不动标签就不前进')
})

test('版本冲突整批拒绝:一条都不应用,手动分类原样保留', () => {
  const state = seed()
  const before = Object.fromEntries(state.items.map(i => [i.id, i.tags]))
  applyOps(state, [{ op: 'update_item', id: 'seed_1', tags: ['我手动放的'] }])
  const { errors } = applyOps(state, [{ op: 'retag_items', itemIds: ['seed_1', 'seed_2'], tags: ['自动整理'], revisions: { seed_1: 0, seed_2: 0 } }])
  assert.equal(errors.length, 1)
  assert.deepEqual(state.items.find(i => i.id === 'seed_1').tags, ['我手动放的'], '陈旧的期望版本不许冲掉手动分类')
  assert.deepEqual(state.items.find(i => i.id === 'seed_2').tags, before.seed_2, '整批拒绝,没冲突的成员也不动')
  assert.equal(state.items.find(i => i.id === 'seed_2').revision, undefined)
})

test('不带期望版本的批量改标签直接拒绝', () => {
  const state = seed()
  const before = state.items.find(i => i.id === 'seed_1').tags
  const { errors } = applyOps(state, [{ op: 'retag_items', itemIds: ['seed_1'], tags: ['x'] }])
  assert.equal(errors.length, 1)
  assert.deepEqual(state.items.find(i => i.id === 'seed_1').tags, before)
})

// 改前→改后的 diff 预览:纯函数,提交时把每行的 revision 原样回传做乐观锁
test('retagPreview:逐条给出改前、改后和当前版本', () => {
  const items = [
    { id: 'a', title: '灵感 A', tags: ['旧标签'], revision: 3 },
    { id: 'b', title: '灵感 B', tags: [] },
    { id: 'c', title: '灵感 C', tags: ['选题', '周末'] },
  ]
  const rows = retagPreview(items, ['a', 'b', 'c'], ['选题', '周末'])
  assert.deepEqual(rows, [
    { id: 'a', title: '灵感 A', before: ['旧标签'], after: ['选题', '周末'], changed: true, revision: 3 },
    { id: 'b', title: '灵感 B', before: [], after: ['选题', '周末'], changed: true, revision: 0 },
    { id: 'c', title: '灵感 C', before: ['选题', '周末'], after: ['选题', '周末'], changed: false, revision: 0 },
  ])
})

// 选题资料架:按标签取用灵感的检索面
test('tagShelf:标签按使用次数排,同名去重', () => {
  const items = [
    { tags: ['选题', '周末'] },
    { tags: ['选题'] },
    { tags: ['周末', '素材'] },
    { tags: [] },
  ]
  assert.deepEqual(tagShelf(items), [
    { tag: '周末', count: 2 },
    { tag: '选题', count: 2 },
    { tag: '素材', count: 1 },
  ])
})
