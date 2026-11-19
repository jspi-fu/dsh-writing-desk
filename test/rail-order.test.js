// 缩略图那排的先后跟排期界面一个口径：上日历的按日期从早到晚，没排期的接在后面。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { railOrder } from '../client/rail-order.js'

const item = (id, scheduledAt, at) => ({ type: 'item', id, at, item: { id, scheduledAt } })
const capsule = (id, times, at) => ({ type: 'capsule', id, at, members: times.map((time, index) => ({ id: `m${index}`, scheduledAt: time })) })

test('有排期的按 scheduledAt 从早到晚排前面,没排期的接在后面(新的在前)', () => {
  const entries = [
    item('late', null, '2026-11-18T10:00:00.000Z'),
    item('third', '2026-11-23T09:00:00.000Z', '2026-11-01T10:00:00.000Z'),
    item('first', '2026-11-20T09:00:00.000Z', '2026-11-02T10:00:00.000Z'),
    item('newer', null, '2026-11-19T10:00:00.000Z'),
  ]
  const { list, cut } = railOrder(entries)
  assert.deepEqual(list.map(entry => entry.id), ['first', 'third', 'newer', 'late'])
  assert.equal(cut, 2)
})

test('胶囊不上日历,按它最早的那个成员算;没成员排过期就落到未排期那一段', () => {
  const entries = [
    capsule('cap_late', [null, '2026-11-25T09:00:00.000Z'], '2026-11-01T10:00:00.000Z'),
    item('single', '2026-11-21T09:00:00.000Z', '2026-11-02T10:00:00.000Z'),
    capsule('cap_none', [null, null], '2026-11-03T10:00:00.000Z'),
  ]
  const { list, cut } = railOrder(entries)
  assert.deepEqual(list.map(entry => entry.id), ['single', 'cap_late', 'cap_none'])
  assert.equal(cut, 2)
})

test('一条都没排期就没有分界;全排了也没有', () => {
  assert.equal(railOrder([item('a', null, '2026-11-18T10:00:00.000Z')]).cut, 0)
  assert.equal(railOrder([item('a', '2026-11-18T10:00:00.000Z')]).cut, 1)
  assert.deepEqual(railOrder([]).list, [])
})

test('同一天同一时刻的两张卡:新的排前面,顺序稳定不随墙上排序跳', () => {
  const entries = [item('old', '2026-11-20T09:00:00.000Z', '2026-11-01T10:00:00.000Z'), item('new', '2026-11-20T09:00:00.000Z', '2026-11-05T10:00:00.000Z')]
  assert.deepEqual(railOrder(entries).list.map(entry => entry.id), ['new', 'old'])
  assert.deepEqual(railOrder([...entries].reverse()).list.map(entry => entry.id), ['new', 'old'])
})