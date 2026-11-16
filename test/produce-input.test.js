// 成稿输入统一入口(工单 #6):单灵感/多灵感/单胶囊/多胶囊解析为同一种输入,
// 多来源素材进成稿提示词,产物仍只落在落点灵感上。
// 与 host.test.js 同一层:纯函数 + Producer 走真 Store,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { articlePrompts, planPrompts } from '../src/ai.js'
import { applyOps } from '../src/ops.js'
import { Producer, normalizePlan } from '../src/produce.js'
import { resolveProduceInput } from '../src/produce-input.js'
import { buildSeed } from '../src/seed.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')

function seed() {
  return buildSeed(NOW)
}

test('四种成稿输入归一为同一种 {sourceIds, targetId}', () => {
  const state = seed()
  applyOps(state, [
    { op: 'add_capsule', name: '甲', itemIds: ['seed_1', 'seed_2'] },
    { op: 'add_capsule', name: '乙', itemIds: ['seed_3'] },
  ])
  const capA = state.capsules.find(row => row.name === '甲')
  const capB = state.capsules.find(row => row.name === '乙')
  // 单灵感:旧入口 {id} 与 {itemIds:[id]} 同一种输入
  assert.deepEqual(resolveProduceInput(state, { id: 'seed_2' }), { sourceIds: ['seed_2'], targetId: 'seed_2' })
  assert.deepEqual(resolveProduceInput(state, { itemIds: ['seed_2'] }), { sourceIds: ['seed_2'], targetId: 'seed_2' })
  // 多灵感:产物落点取第一个。理由:成稿产物必须写在一条灵感的 production 字段上
  // (production 形状与 draft/ready 状态、排期依赖都不能动);新建承载灵感要多出一种实体,
  // 首个来源当落点最小——全部素材照样进策划案与正文,其余来源原样保留、随时可单独打开
  assert.deepEqual(resolveProduceInput(state, { itemIds: ['seed_1', 'seed_2'] }), { sourceIds: ['seed_1', 'seed_2'], targetId: 'seed_1' })
  // 单胶囊 / 多胶囊:解析成员,同一种输入
  assert.deepEqual(resolveProduceInput(state, { capsuleIds: [capA.id] }), { sourceIds: ['seed_1', 'seed_2'], targetId: 'seed_1' })
  assert.deepEqual(resolveProduceInput(state, { capsuleIds: [capB.id, capA.id] }), { sourceIds: ['seed_3', 'seed_1', 'seed_2'], targetId: 'seed_3' })
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
  applyOps(state, [{ op: 'add_capsule', name: '堆', itemIds: ['seed_1', 'seed_2'] }])
  const [capsule] = state.capsules
  applyOps(state, [{ op: 'delete_item', id: 'seed_1' }])
  // 灵感 ID 失效:直接滤掉
  assert.deepEqual(resolveProduceInput(state, { itemIds: ['seed_1', 'seed_2'] }).sourceIds, ['seed_2'])
  // 胶囊成员失效:只留活着的成员
  assert.deepEqual(resolveProduceInput(state, { capsuleIds: [capsule.id] }).sourceIds, ['seed_2'])
  // 一个能用的都没有:成稿无从谈起
  const err = (() => { try { resolveProduceInput(state, { itemIds: ['seed_1'] }); return null } catch (error) { return error } })()
  assert.ok(err)
  assert.equal(err.status, 400)
  assert.throws(() => resolveProduceInput(state, { itemIds: [] }), err => err.status === 400)
  assert.throws(() => resolveProduceInput(state, {}), err => err.status === 400)
})

test('多来源素材进策划案与正文提示词,单来源提示词保持原样', () => {
  const state = seed()
  applyOps(state, [
    { op: 'update_item', id: 'seed_1', body: '主灵感的补充材料' },
    { op: 'update_item', id: 'seed_2', body: '另一条灵感的材料' },
    { op: 'update_item', id: 'seed_3', tags: ['周末'] },
  ])
  const item = state.items.find(row => row.id === 'seed_1')
  const others = ['seed_2', 'seed_3'].map(id => state.items.find(row => row.id === id))
  const plan = normalizePlan({ title: '标题', facts: ['事实'], images: [], shots: [] }, { imageCount: 1, shotCount: 2 }, '标题')

  // 单来源(不带 sources 或 sources 就是自己):素材块一个字都不多
  const solo = articlePrompts(state, item, '', plan)
  const same = articlePrompts(state, item, '', plan, [item])
  assert.equal(solo.user, same.user)
  assert.equal(solo.system, same.system)
  assert.doesNotMatch(solo.user, /另一条灵感的材料/)
  assert.doesNotMatch(solo.system, /相关灵感/)

  // 多来源:其余灵感的标题、正文、标签、来源都进素材块,系统提示里说清要融合成一篇
  const multi = articlePrompts(state, item, '', plan, [item, ...others])
  assert.match(multi.user, /另一条灵感的材料/)
  assert.match(multi.user, /周末/)
  assert.match(multi.system, /相关灵感/)
  // 主灵感仍是素材块的主角,不是混成一堆
  const parsed = JSON.parse(/<material>([\s\S]*?)<\/material>/.exec(multi.user)[1])
  assert.equal(parsed.灵感, item.title)
  assert.equal(parsed.补充, '主灵感的补充材料')
  assert.equal(parsed.相关灵感.length, 2)
  assert.equal(parsed.相关灵感[0].灵感, state.items.find(row => row.id === 'seed_2').title)

  // 策划案提示词同样纳入:多来源的系统提示在单来源的基础上追加说明,不改原有内容
  const planSolo = planPrompts(state, item, { imageCount: 1, shotCount: 2 })
  const planMulti = planPrompts(state, item, { imageCount: 1, shotCount: 2 }, [item, ...others])
  assert.doesNotMatch(planSolo.user, /另一条灵感的材料/)
  assert.match(planMulti.user, /另一条灵感的材料/)
  assert.ok(planMulti.system.startsWith(planSolo.system))
  assert.match(planMulti.system, /相关灵感/)
  assert.ok(multi.system.startsWith(solo.system))
})

async function producerFixture({ callText, generate, ready = true }) {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-input-'))
  const store = new Store(dir)
  await store.read()
  const settings = new Settings(dir)
  await settings.update({ imageCount: 1, shotCount: 2, ...(ready ? { image: { baseUrl: 'https://i.example/v1', model: 'm', apiKey: 'k' } } : {}) })
  return { dir, store, settings, producer: new Producer({ store, settings, callText, generate }) }
}

async function waitDone(producer, id) {
  for (let i = 0; i < 200 && producer.isRunning(id); i += 1) await new Promise(r => setTimeout(r, 5))
}

const isPlan = system => system.includes('策划案')
const PLAN = JSON.stringify({ title: '最终标题', cover: 'cover', characters: 'a man', images: [{ anchor: '第一节', caption: '图注', prompt: 'fig' }], shots: [{ shot: '特写', visual: '手', voice: '说', seconds: 4, prompt: 's1' }] })

test('多来源成稿:全部素材进提示词,产物只落在落点灵感', async () => {
  const users = []
  const callText = async ({ system, user, onText }) => {
    if (isPlan(system)) return { text: PLAN, model: 'd' }
    users.push(user)
    onText('# 模型标题\n\n正文')
    return { text: '# 模型标题\n\n## 第一节\n正文', model: 'd' }
  }
  const { dir, store, producer } = await producerFixture({ callText, generate: async () => ({ buffer: Buffer.alloc(8), ext: '.png' }) })
  try {
    await store.mutate('预备素材', draft => (applyOps(draft, [{ op: 'update_item', id: 'seed_2', body: '第二条的独有材料' }]), draft))
    const started = await producer.start('seed_1', { withImages: false, sourceIds: ['seed_1', 'seed_2'] })
    assert.equal(started, true)
    await waitDone(producer, 'seed_1')
    // 落点灵感拿到成稿产物,状态照常推进
    const after = await store.read()
    const target = after.items.find(row => row.id === 'seed_1')
    assert.equal(target.production.status, 'done')
    assert.equal(target.status, 'draft')
    // 另一条来源只出素材,不落产物
    assert.equal(after.items.find(row => row.id === 'seed_2').production, undefined)
    // 正文提示词带上了全部来源的素材
    assert.ok(users.length)
    assert.ok(users.every(user => user.includes('第二条的独有材料')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
