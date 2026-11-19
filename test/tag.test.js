// 标签是挂在灵感上的字符串：改名与删除只动 tags，不删灵感。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')

test('rename_tag 遍历改写并去重,撞到已有标签时合并', () => {
  const state = buildSeed(NOW)
  state.items[0].tags = ['AI', '设计']
  state.items[1].tags = ['AI', '方法论']
  const { receipts, errors } = applyOps(state, [{ op: 'rename_tag', from: 'AI', to: '人工智能' }])
  assert.deepEqual(errors, [])
  assert.equal(receipts[0].kind, 'tag')
  assert.deepEqual(state.items[0].tags, ['人工智能', '设计'])
  assert.deepEqual(state.items[1].tags, ['人工智能', '方法论'])
  assert.equal(state.items[0].revision, 1)

  state.items[2].tags = ['人工智能', 'AI']
  applyOps(state, [{ op: 'rename_tag', from: 'AI', to: '人工智能' }])
  assert.deepEqual(state.items[2].tags, ['人工智能'], '改完要和已有标签去重')
})

test('delete_tag 只摘标签,不删灵感', () => {
  const state = buildSeed(NOW)
  const before = state.items.length
  state.items[0].tags = ['AI', '设计']
  const { receipts, errors } = applyOps(state, [{ op: 'delete_tag', tag: 'AI' }])
  assert.deepEqual(errors, [])
  assert.equal(receipts[0].kind, 'tag')
  assert.deepEqual(state.items[0].tags, ['设计'])
  assert.equal(state.items.length, before)
})

test('空标签名报错,不写状态', () => {
  const state = buildSeed(NOW)
  const { errors } = applyOps(state, [{ op: 'rename_tag', from: '', to: 'AI' }, { op: 'delete_tag', tag: ' ' }])
  assert.equal(errors.length, 2)
})