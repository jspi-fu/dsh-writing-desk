// 状态机 reducer 的模块层测试:素材只剩排期与阶段,(ADR 0013)成稿/发布已迁到作品。
// 与 host.test.js 同一层:只直接调用领域模块,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { EVENTS, awaitingSchedule, isScheduled, reduce, reminderDue } from '../src/state.js'
import { migrateState } from '../src/seed.js'

const NOW = '2026-11-17T10:00:00.000Z'

function item(overrides = {}) {
  return { id: 'it_1', kind: 'note', title: '测试灵感', body: '', tags: [], status: 'idea', createdAt: NOW, scheduledAt: null, ...overrides }
}

// 事件时间一律显式携带,断言不依赖真实时钟。
function run(entry, event) {
  return reduce({ items: [entry], works: [] }, { id: entry.id, at: NOW, ...event })
}

test('state.js 零依赖,Host 与 Client(经 esbuild 打包)都能直接引用', () => {
  const source = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*(import\s|export\s+.+\sfrom\s|require\()/m)
})

// 双轨写法不许回来:旧状态推演函数与遗留草稿字段都已下线,src/ 里任何一处出现都算残留。
test('src/ 内不再有旧状态口径的残留', () => {
  for (const file of readdirSync(new URL('../src/', import.meta.url))) {
    if (!file.endsWith('.js')) continue
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /save_draft|applyStatus|applySchedule|update_production|write_production|publish_item/, `${file} 还有旧成稿链路的残留`)
    assert.doesNotMatch(source, /\bdrafts\s*(\??\.|\[)|\bdrafts\s*[:=]|['"]drafts\b/, `${file} 还有遗留草稿字段的残留`)
  }
})

test('状态机事件只剩排期、撤排期与手动改阶段(ADR 0013)', () => {
  assert.deepEqual(EVENTS, ['schedule', 'unschedule', 'setStatus'])
})

test('排期:时间规整成 ISO,状态自愈到大纲或待发布', () => {
  const fresh = run(item({ status: 'idea' }), { type: 'schedule', scheduledAt: '2026-12-01T18:00:00+08:00' })
  assert.equal(fresh.scheduledAt, '2026-12-01T10:00:00.000Z')
  assert.equal(fresh.status, 'outline')
  assert.equal(isScheduled(fresh), true)
  const drafted = run(item({ status: 'draft' }), { type: 'schedule', scheduledAt: '2026-12-01T18:00:00+08:00' })
  assert.equal(drafted.status, 'ready')
})

test('排期时间变了,旧的「知道了」作废;同一个时间重排不清', () => {
  const entry = item({ scheduledAt: '2026-12-01T10:00:00.000Z', remindedAt: NOW, status: 'outline' })
  const same = run(entry, { type: 'schedule', scheduledAt: '2026-12-01T10:00:00.000Z' })
  assert.equal(same.remindedAt, NOW)
  const moved = run(entry, { type: 'schedule', scheduledAt: '2026-12-08T10:00:00.000Z' })
  assert.equal(moved.remindedAt, undefined)
})

test('排期时间无效直接报错,不落半个状态', () => {
  const entry = item()
  assert.throws(() => run(entry, { type: 'schedule', scheduledAt: '不是时间' }), /排期时间无效/)
  assert.throws(() => run(entry, { type: 'schedule', scheduledAt: undefined }), /排期时间无效/)
  assert.equal(entry.scheduledAt, null)
})

test('撤排期:清时间与回执,大纲退回灵感,待发布退回草稿', () => {
  const outline = run(item({ scheduledAt: '2026-12-01T10:00:00.000Z', status: 'outline', remindedAt: NOW }), { type: 'unschedule' })
  assert.equal(outline.scheduledAt, null)
  assert.equal(outline.remindedAt, undefined)
  assert.equal(outline.status, 'idea')
  const ready = run(item({ scheduledAt: '2026-12-01T10:00:00.000Z', status: 'ready' }), { type: 'unschedule' })
  assert.equal(ready.status, 'draft')
})

test('手动改阶段:允许灵感到草稿;待发布没有排期就自愈回草稿;无效值报错', () => {
  assert.equal(run(item(), { type: 'setStatus', status: 'outline' }).status, 'outline')
  const drafted = run(item(), { type: 'setStatus', status: 'draft' })
  assert.equal(drafted.status, 'draft')
  // 「已发布」不再是素材状态:写进去也会被自愈拉回草稿
  const published = run(item(), { type: 'setStatus', status: 'published' })
  assert.equal(published.status, 'draft')
  assert.throws(() => run(item(), { type: 'setStatus', status: 'nope' }), /状态无效/)
})

test('到点该提醒:排期已过、没关提示、没确认过才亮', () => {
  const due = item({ scheduledAt: '2026-11-17T09:00:00.000Z' })
  assert.equal(reminderDue(due, new Date(NOW)), true)
  assert.equal(reminderDue(due, new Date('2026-11-17T08:00:00.000Z')), false, '还没到点')
  assert.equal(reminderDue(item({ scheduledAt: null }), new Date(NOW)), false, '没排期')
  assert.equal(reminderDue({ ...due, reminder: false }, new Date(NOW)), false, '用户关了系统提示')
  assert.equal(reminderDue({ ...due, remindedAt: '2026-11-17T09:30:00.000Z' }, new Date(NOW)), false, '已经知道了')
  // 改了排期时间,旧回执不再算数
  assert.equal(reminderDue({ ...due, remindedAt: '2026-11-17T08:30:00.000Z' }, new Date(NOW)), true, '回执早于这一次排期')
})

test('待排期:没父条目、没排期、也没被任何未归档作品引用', () => {
  const state = { items: [{ ...item({ id: 'it_a' }) }, { ...item({ id: 'it_b' }) }], works: [] }
  assert.equal(awaitingSchedule(state, state.items[0]), true)
  // 有父条目(胶囊成员的线索)不进待排期
  assert.equal(awaitingSchedule(state, { ...state.items[0], parentId: 'it_parent' }), false)
  // 排了期就不在待排期
  assert.equal(awaitingSchedule(state, { ...state.items[0], scheduledAt: '2026-12-01T10:00:00.000Z' }), false)
  // 被作品引用 = 已用素材,从托盘收起
  state.works = [{ id: 'w1', sourceItemIds: ['it_a'], current: { rev: 0 } }]
  assert.equal(awaitingSchedule(state, state.items[0]), false)
  assert.equal(awaitingSchedule(state, state.items[1]), true)
  // 归档作品不算「已用」,素材回来
  state.works = [{ id: 'w1', sourceItemIds: ['it_a'], archivedAt: NOW, current: { rev: 0 } }]
  assert.equal(awaitingSchedule(state, state.items[0]), true)
})

test('无效状态事件、找不到的灵感都直接报错', () => {
  assert.throws(() => reduce({ items: [] }, { type: 'schedule', id: 'gone', scheduledAt: NOW }), /找不到这条灵感/)
  assert.throws(() => reduce({ items: [item()] }, { type: 'submit', id: 'it_1' }), /不支持的状态事件/)
})

test('migrateState 无害清除旧数据里的遗留草稿字段与 production', () => {
  const state = { items: [{ id: 'it_old', title: '旧数据', drafts: { article: { text: '旧手写稿', by: 'user' } }, status: 'published', publishedAt: NOW, production: { status: 'done', article: '旧成稿' }, autoProduce: true, autoDispatch: true }] }
  migrateState(state)
  assert.equal(state.items[0].drafts, undefined)
  assert.equal(state.items[0].production, undefined)
  // 自动成稿/自动投递已删除(ADR 0013 修订),旧状态里的开关不再保留
  assert.equal(state.items[0].autoProduce, undefined)
  assert.equal(state.items[0].autoDispatch, undefined)
  assert.equal(state.items[0].title, '旧数据')
  // 存量成稿转成作品(ADR 0013),素材本身不再有 production
  assert.equal(state.works.length, 1)
  assert.equal(state.works[0].current.article, '旧成稿')
  assert.equal(state.works[0].publication.status, 'published')
})
