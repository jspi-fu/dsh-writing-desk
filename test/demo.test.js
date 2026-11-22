import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildDemo } from '../src/demo.js'
import { withLang } from '../src/i18n.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { selectScheduleFocus } from '../src/schedule-focus.js'
import { reminderDue } from '../src/state.js'
import { Store } from '../src/store.js'
import { hasUnpublishedChange, workState } from '../src/work.js'

const NOW = new Date('2026-11-21T18:00:00+08:00')
const HOUR = 60 * 60 * 1000
const COLLECTIONS = ['items', 'capsules', 'works']
const SAMPLE_COLLECTIONS = [...COLLECTIONS, 'people', 'angles', 'skills', 'styles']
const CJK = /[一-鿿]/
const clone = value => structuredClone(value)
const at = (base, hours) => new Date(base.getTime() + hours * HOUR).toISOString()
const demoRows = (state, key) => state[key].filter(row => row.demo)
const userRows = state => Object.fromEntries(COLLECTIONS.map(key => [key, state[key].filter(row => !row.sample)]))

function addOwnContent(state) {
  const first = applyOps(state, [{ op: 'add_item', title: '我的第一条内容', body: '不能被动到' }]).receipts[0].target
  const second = applyOps(state, [{ op: 'add_item', title: '我的第二条内容' }]).receipts[0].target
  const work = applyOps(state, [{ op: 'create_work', itemIds: [first] }]).receipts[0].target
  applyOps(state, [{ op: 'update_work', id: work, article: '我的正文', coverText: '我的封面字' }])
  applyOps(state, [{ op: 'add_capsule', name: '我的胶囊', itemIds: [first, second] }])
  return { itemIds: [first, second], workId: work }
}

test('buildSeed 首次自动包含完整 demo、三种作品状态、整体排期与到点提醒', () => {
  const state = buildSeed(NOW)
  const demo = buildDemo(NOW)
  assert.equal(state.items[0].id, 'seed_1', '原始灵感示例保持既有顺序')
  assert.equal(state.items.filter(row => !row.demo).length, 25, '原始 25 条首次示例保持不变')
  assert.deepEqual(demoRows(state, 'items'), demo.items)
  assert.deepEqual(demoRows(state, 'capsules'), demo.capsules)
  assert.deepEqual(demoRows(state, 'works'), demo.works)
  assert.equal(demo.items.length, 8)
  assert.equal(demo.capsules.length, 2)
  assert.equal(demo.works.length, 3)
  assert.equal(state.sampleScheduleReset, true, '重开不会再跑旧示例排期清理迁移')

  const ids = new Set()
  for (const key of COLLECTIONS) {
    for (const row of demo[key]) {
      assert.match(row.id, /^demo_/)
      assert.equal(row.sample, true, `${row.id} sample`)
      assert.equal(row.demo, true, `${row.id} demo`)
      assert.equal(ids.has(row.id), false, `${row.id} 全局唯一`)
      ids.add(row.id)
    }
  }

  assert.deepEqual(demo.works.map(workState).sort(), ['draft', 'published', 'submitted'])
  for (const work of demo.works) {
    for (const field of ['title', 'coverText', 'article']) assert.ok(work.current[field].trim(), `${work.id}.${field}`)
    assert.ok(work.current.cover?.src.startsWith('writing-desk/assets/'), `${work.id} 有现成封面`)
    assert.equal(work.sourceSnapshot.length, work.sourceItemIds.length)
    for (const entry of work.sourceSnapshot) {
      const item = demo.items.find(row => row.id === entry.itemId)
      assert.deepEqual(entry, { itemId: item.id, title: item.title, kind: item.kind })
    }
    for (const capsuleId of work.sourceCapsuleIds) assert.ok(demo.capsules.some(row => row.id === capsuleId))
  }
  const published = demo.works.find(row => row.id === 'demo_work_published')
  assert.equal(published.publication.publishedAt, published.published.publishedAt)
  assert.equal(published.published.rev, undefined)
  assert.equal(hasUnpublishedChange(published), false)

  const scheduled = []
  for (const capsule of demo.capsules) {
    const rows = capsule.itemIds.map(id => demo.items.find(row => row.id === id))
    assert.ok(rows.every(row => row?.scheduledAt), `${capsule.id} 全体成员有排期`)
    assert.ok(rows.every(row => row.scheduledAt === rows[0].scheduledAt), `${capsule.id} 整体排期`)
    scheduled.push(...rows)
  }
  const due = scheduled.filter(row => reminderDue(row, NOW))
  assert.deepEqual(due.map(row => row.id), ['demo_item_01', 'demo_item_02'])
  assert.ok(due.every(row => row.remindedAt == null && row.scheduledAt === at(NOW, -26)))
  const focus = selectScheduleFocus(state.items, state.capsules, NOW)
  assert.equal(focus?.id, 'demo_capsule_02')
  assert.equal(focus?.scheduledAt, at(NOW, 2))
  assert.equal(demo.items.find(row => row.id === 'demo_item_08').scheduledAt, at(NOW, 30))
})

test('clear_samples 一次清掉原始示例和完整 demo，所有用户实体与来源快照保留', () => {
  const state = buildSeed(NOW)
  const own = addOwnContent(state)
  const sampleWorkId = applyOps(state, [{ op: 'create_work', itemIds: ['demo_item_05'] }]).receipts[0].target
  applyOps(state, [{ op: 'update_work', id: sampleWorkId, article: '用户基于示例写成的正文' }])
  const childId = applyOps(state, [{ op: 'add_item', title: '挂在示例下的自己的内容' }]).receipts[0].target
  state.items.find(row => row.id === childId).parentId = 'seed_1'
  const expected = clone(userRows(state))
  expected.items.find(row => row.id === childId).parentId = null

  const { receipts, errors } = applyOps(state, [{ op: 'clear_samples' }])
  assert.deepEqual(errors, [])
  assert.match(receipts[0].text, /已清空全部示例数据/)
  assert.deepEqual(userRows(state), expected)
  for (const key of SAMPLE_COLLECTIONS) assert.equal(state[key].some(row => row.sample), false, `${key} 不残留 sample`)
  assert.ok(state.items.some(row => row.id === own.itemIds[0]))
  assert.ok(state.works.some(row => row.id === own.workId))
  assert.equal(state.works.find(row => row.id === sampleWorkId).sourceSnapshot[0].title, demoRows(buildSeed(NOW), 'items').find(row => row.id === 'demo_item_05').title)
  assert.equal(state.sampleCleared, true)

  const once = clone(state)
  const again = applyOps(state, [{ op: 'clear_samples' }])
  assert.deepEqual(again.errors, [])
  assert.deepEqual(state, once, '重复清空不改变用户内容')
})

test('clear_samples 保护混合用户胶囊：不足两名时整批拒绝，足够时只摘示例成员', () => {
  const state = buildSeed(NOW)
  const first = applyOps(state, [{ op: 'add_item', title: '我的成员一' }]).receipts[0].target
  const mixed = applyOps(state, [{ op: 'add_capsule', name: '我的混合胶囊', itemIds: [first, 'demo_item_05'] }]).receipts[0].target
  const before = clone(state)

  const blocked = applyOps(state, [{ op: 'clear_samples' }])
  assert.deepEqual(blocked.receipts, [])
  assert.equal(blocked.errors.length, 1)
  assert.match(blocked.errors[0], /我的混合胶囊/)
  assert.match(blocked.errors[0], /未改动任何数据/)
  assert.deepEqual(state, before)
  const english = withLang('en', () => applyOps(state, [{ op: 'clear_samples' }]))
  assert.match(english.errors[0], /your capsule "我的混合胶囊".*Nothing was changed/)
  assert.deepEqual(state, before)

  assert.deepEqual(applyOps(state, [{ op: 'delete_capsule', id: mixed }]).errors, [])
  const second = applyOps(state, [{ op: 'add_item', title: '我的成员二' }]).receipts[0].target
  const safe = applyOps(state, [{ op: 'add_capsule', name: '安全混合胶囊', itemIds: [first, second, 'demo_item_06'] }]).receipts[0].target
  const cleared = applyOps(state, [{ op: 'clear_samples' }])
  assert.deepEqual(cleared.errors, [])
  assert.deepEqual(state.capsules.find(row => row.id === safe)?.itemIds, [first, second])
  assert.ok(state.items.some(row => row.id === first) && state.items.some(row => row.id === second))
  for (const key of SAMPLE_COLLECTIONS) assert.equal(state[key].some(row => row.sample), false)
})

test('load_demo 与 clear_demo 独立入口已移除', () => {
  const state = buildSeed(NOW)
  const before = clone(state)
  for (const op of ['load_demo', 'clear_demo']) {
    const result = applyOps(state, [{ op }])
    assert.deepEqual(result.receipts, [])
    assert.equal(result.errors.length, 1)
    assert.match(result.errors[0], /不支持的操作/)
  }
  assert.deepEqual(state, before)
})

test('英文 buildSeed 自动带英文完整 demo，统一清空回执完整', () => {
  const zh = buildSeed(NOW, 'zh')
  const en = buildSeed(NOW, 'en')
  for (const row of demoRows(en, 'items')) {
    for (const value of [row.title, row.body, row.source, ...row.tags]) assert.ok(!CJK.test(value), `${row.id}: ${value}`)
  }
  for (const capsule of demoRows(en, 'capsules')) assert.ok(!CJK.test(capsule.name))
  for (const work of demoRows(en, 'works')) {
    for (const field of ['title', 'coverText', 'article']) assert.ok(!CJK.test(work.current[field]), `${work.id}.${field}`)
  }
  assert.deepEqual(
    demoRows(en, 'items').map(row => [row.id, row.scheduledAt, row.media?.src]),
    demoRows(zh, 'items').map(row => [row.id, row.scheduledAt, row.media?.src]),
  )
  const cleared = withLang('en', () => applyOps(en, [{ op: 'clear_samples' }]))
  assert.match(cleared.receipts[0].text, /Cleared all sample data/)
  assert.deepEqual(cleared.errors, [])
})

test('Store 首次建库自动持久化完整 demo，重开保留排期，统一清空可撤销', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-demo-'))
  try {
    const store = new Store(dir)
    const seeded = await store.read()
    assert.equal(demoRows(seeded, 'items').length, 8)
    assert.equal(demoRows(seeded, 'works').length, 3)
    const future = seeded.items.find(row => row.id === 'demo_item_03').scheduledAt

    const reopened = await new Store(dir).read()
    assert.equal(reopened.sampleScheduleReset, true)
    assert.equal(reopened.items.find(row => row.id === 'demo_item_03').scheduledAt, future)
    assert.equal(demoRows(reopened, 'capsules').length, 2)

    const own = await store.mutate('准备自己的内容', state => {
      const result = applyOps(state, [{ op: 'add_item', title: '我的持久内容' }])
      return result.receipts[0].target
    }, { undoable: false })
    await store.mutate('清空示例数据', state => applyOps(state, [{ op: 'clear_samples' }]))
    const cleared = await store.read()
    assert.equal(cleared.items.some(row => row.sample), false)
    assert.equal(cleared.works.length, 0)
    assert.ok(cleared.items.some(row => row.id === own))

    assert.equal(await store.undoLast(), '清空示例数据')
    const restored = await store.read()
    assert.equal(demoRows(restored, 'items').length, 8)
    assert.equal(demoRows(restored, 'works').length, 3)
    assert.ok(restored.items.some(row => row.id === own))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
