import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { scheduleFocusCandidates, selectScheduleFocus } from '../src/schedule-focus.js'

const NOW = new Date('2026-11-21T12:00:00.000Z')
const MINUTE = 60_000
const item = (id, scheduledAt, extra = {}) => ({ id, title: id, status: 'idea', scheduledAt, ...extra })
const capsule = (id, itemIds) => ({ id, name: id, itemIds })

test('按绝对时间差选择最近排期：过去和将来都参与，无效日期不参选', () => {
  const items = [
    item('future', '2026-11-21T14:00:00.000Z'),
    item('past', '2026-11-21T11:30:00.000Z'),
    item('invalid', 'not-a-date'),
    item('empty', ''),
    item('unscheduled', null),
  ]
  const focus = selectScheduleFocus(items, [], NOW)
  assert.equal(focus.id, 'past')
  assert.equal(focus.type, 'item')
  assert.equal(focus.distance, 30 * MINUTE)
  assert.deepEqual(scheduleFocusCandidates(items, [], NOW).map(row => row.id), ['past', 'future'])
})

test('无效当前时间得到空候选，不抛异常也不退化成只看未来', () => {
  const items = [item('past', '2020-01-01T00:00:00.000Z')]
  assert.deepEqual(scheduleFocusCandidates(items, [], new Date('bad')), [])
  assert.equal(selectScheduleFocus(items, [], 'bad'), null)
  assert.equal(selectScheduleFocus(items, [], NOW).id, 'past')
})

test('parentId 派生条不独立参选，也不抢所属胶囊的焦点时间', () => {
  const items = [
    item('derived', '2026-11-21T12:01:00.000Z', { parentId: 'elsewhere' }),
    item('root', '2026-11-21T14:00:00.000Z'),
    item('child', '2026-11-21T12:02:00.000Z', { parentId: 'root' }),
  ]
  const rows = scheduleFocusCandidates(items, [capsule('cap', ['root', 'child'])], NOW)
  assert.deepEqual(rows.map(row => row.id), ['cap'])
  assert.equal(rows[0].item.id, 'root')
  assert.equal(rows[0].members.length, 2, '派生条仍计入胶囊整体')
  assert.equal(rows[0].scheduledCount, 2)
})

test('整张胶囊只占一个候选，成员 ID 去重，胶囊内也取绝对距离最近的有效排期', () => {
  const items = [
    item('a', '2026-11-21T15:00:00.000Z'),
    item('b', '2026-11-21T11:50:00.000Z'),
    item('bad', 'invalid'),
    item('loose', '2026-11-20T12:00:00.000Z'),
  ]
  const rows = scheduleFocusCandidates(items, [capsule('cap', ['a', 'b', 'a', 'bad', 'missing'])], NOW)
  assert.deepEqual(rows.map(row => row.id), ['cap', 'loose'])
  assert.equal(rows[0].type, 'capsule')
  assert.equal(rows[0].item.id, 'b')
  assert.deepEqual(rows[0].members.map(member => member.id), ['a', 'b', 'bad'])
  assert.equal(rows[0].scheduledCount, 2)
  assert.equal(rows.filter(row => row.id === 'cap').length, 1)
})

test('异常重复 capsule.id 只生成一个主体，成员不会被拆成额外单条', () => {
  const items = [item('a', '2026-11-21T13:00:00.000Z')]
  const rows = scheduleFocusCandidates(items, [capsule('cap', ['a']), capsule('cap', ['a'])], NOW)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'cap')
  assert.deepEqual(rows[0].members.map(member => member.id), ['a'])
})

test('同距离稳定排序：保留 items 首次出现顺序，胶囊内部也不因相等距离换人', () => {
  const past = item('past', '2026-11-21T11:00:00.000Z')
  const future = item('future', '2026-11-21T13:00:00.000Z')
  assert.deepEqual(scheduleFocusCandidates([past, future], [], NOW).map(row => row.id), ['past', 'future'])
  assert.deepEqual(scheduleFocusCandidates([future, past], [], NOW).map(row => row.id), ['future', 'past'])
  assert.equal(selectScheduleFocus([past, future], [], NOW).id, 'past')

  const grouped = scheduleFocusCandidates([past, future], [capsule('cap', ['past', 'future'])], NOW)
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].item.id, 'past')
})

test('选择过程不修改 items、capsules 或成员顺序，内部 order 不外泄', () => {
  const items = [item('a', '2026-11-21T13:00:00.000Z'), item('b', '2026-11-21T11:00:00.000Z')]
  const capsules = [capsule('cap', ['a', 'b'])]
  const before = structuredClone({ items, capsules })
  const [focus] = scheduleFocusCandidates(items, capsules, NOW)
  assert.deepEqual({ items, capsules }, before)
  assert.equal(Object.hasOwn(focus, 'order'), false)
  assert.deepEqual(focus.members.map(member => member.id), ['a', 'b'])
})

test('没有有效排期时返回 null，空胶囊与缺失成员也安全忽略', () => {
  assert.equal(selectScheduleFocus([], [], NOW), null)
  assert.equal(selectScheduleFocus([item('a', null)], [capsule('empty', []), capsule('missing', ['x'])], NOW), null)
  assert.deepEqual(scheduleFocusCandidates(null, null, NOW), [])
})

test('杂志式焦点在宽屏与 360/420 侧栏都保持左图右字、图文等高', () => {
  const css = readFileSync(new URL('../client/schedule-focus.css', import.meta.url), 'utf8')
  const cardRules = [...css.matchAll(/\.md-root \.md-schedule-focus-card\s*\{([^}]*)\}/g)].map(match => match[1])
  assert.ok(cardRules.length >= 5)
  for (const rule of cardRules) {
    assert.match(rule, /grid-template-columns:\s*minmax\([^;]+minmax\(0,\s*1fr\)/)
    assert.doesNotMatch(rule, /flex-direction:\s*column/)
  }
  assert.match(css, /@container \(max-width: 480px\)/)
  assert.match(css, /@container \(max-width: 380px\)/)
  assert.match(css, /\.md-schedule-focus-media\s*\{[^}]*grid-column:\s*1/s)
  assert.match(css, /\.md-schedule-focus-body\s*\{[^}]*grid-column:\s*2/s)
  assert.match(css, /\.md-schedule-focus-art\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/s)
  assert.match(css, /\.md-schedule-focus-card::before\s*\{/)
  assert.match(css, /\.md-schedule-focus-day\s*\{/)
})

test('同心波纹只作装饰，离屏暂停且尊重 reduced-motion', () => {
  const css = readFileSync(new URL('../client/schedule-focus.css', import.meta.url), 'utf8')
  const jsx = readFileSync(new URL('../client/schedule.jsx', import.meta.url), 'utf8')
  assert.match(jsx, /className="md-schedule-focus-ripple" aria-hidden="true"/)
  assert.match(jsx, /IntersectionObserver/)
  assert.match(jsx, /visibilitychange/)
  assert.match(css, /@keyframes md-schedule-focus-ripple/)
  assert.match(css, /animation-play-state:\s*paused/)
  assert.match(css, /is-ripple-active[^}]*animation-play-state:\s*running/s)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.md-schedule-focus-ripple > span\s*\{[^}]*animation:\s*none/)
})
