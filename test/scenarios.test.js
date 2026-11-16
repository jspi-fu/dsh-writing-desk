// 状态权威迁移的真实操作序列测试(工单 #5):按创作者的真实操作次序,
// 断言四个历史不一致场景消失。与 host.test.js 同一层:直接调用 Store / Producer /
// applyOps 与 src/state.js 的共享谓词,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isDrafted, isScheduled, panelState } from '../src/state.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { Store } from '../src/store.js'
import { Producer } from '../src/produce.js'
import { Settings } from '../src/settings.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

function seed() {
  return buildSeed(NOW)
}

const isPlan = system => system.includes('策划案')
const PLAN = JSON.stringify({ title: '最终标题', cover: 'cover', characters: 'a man', images: [{ anchor: '第一节', caption: '图注', prompt: 'fig' }], shots: [{ shot: '特写', visual: '手', voice: '说', seconds: 4, prompt: 's1' }, { shot: '全景', visual: '街', voice: '说', seconds: 6, prompt: 's2' }] })

async function fixture({ callText, generate = async () => ({ buffer: PNG, ext: '.png' }), ready = true }) {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-seq-'))
  const store = new Store(dir)
  await store.read()
  const settings = new Settings(dir)
  await settings.update({ imageCount: 1, shotCount: 2, ...(ready ? { image: { baseUrl: 'https://i.example/v1', model: 'm', apiKey: 'k' } } : {}) })
  return { dir, store, settings, producer: new Producer({ store, settings, callText, generate }) }
}

async function waitDone(producer, id) {
  for (let i = 0; i < 200 && producer.isRunning(id); i += 1) await new Promise(r => setTimeout(r, 5))
}

async function waitUntil(store, id, predicate) {
  for (let i = 0; i < 400; i += 1) {
    const item = (await store.read()).items.find(row => row.id === id)
    if (item && predicate(item)) return item
    await new Promise(r => setTimeout(r, 5))
  }
  return null
}

/** 新起一条自己的灵感,返回 id。 */
function addItem(state, title) {
  const { receipts } = applyOps(state, [{ op: 'add_item', title, body: '素材正文', contentOrigin: 'user' }])
  return receipts[0].target
}

// 场景②(User Story #29):重新成稿不再清空上一次写好的正文,重试不毁稿。
test('场景② 真实序列:重新成稿不清空上一篇正文,新一轮写完才原子替换', async () => {
  let round = 0
  let release
  const gate = new Promise((r) => { release = r })
  const callText = async ({ system, onText }) => {
    if (isPlan(system)) return { text: PLAN, model: 'd' }
    round += 1
    if (round === 1) {
      onText('# 模型标题\n\n## 第一节\n正文')
      return { text: '# 模型标题\n\n## 第一节\n正文', model: 'd1' }
    }
    await gate
    onText('# 第二轮标题\n\n## 第一节\n第二轮正文')
    return { text: '# 第二轮标题\n\n## 第一节\n第二轮正文', model: 'd2' }
  }
  const { dir, store, producer } = await fixture({ callText, ready: false })
  let id = null
  try {
    id = addItem(await store.read(), '要重写的灵感')
    // 第一轮:写完、完成
    assert.equal(await producer.start(id, { withImages: false }), true)
    await waitDone(producer, id)
    const first = (await store.read()).items.find(row => row.id === id)
    assert.equal(first.production.status, 'done')
    assert.equal(first.production.article, '## 第一节\n正文')
    assert.equal(first.status, 'draft')

    // 第二轮:正文先挂着,此时上一篇正文必须还在
    await producer.start(id, { withImages: false })
    const midRun = await waitUntil(store, id, item => item.production?.status === 'running')
    assert.ok(midRun, '第二轮开跑了')
    assert.equal(midRun.production.article, '## 第一节\n正文', '重新成稿不清空上一篇正文')

    release()
    await waitDone(producer, id)
    const second = (await store.read()).items.find(row => row.id === id)
    assert.equal(second.production.status, 'done')
    assert.equal(second.production.article, '## 第一节\n第二轮正文')
    assert.equal(second.production.engine, 'd2')
  } finally {
    producer.jobs.get(id)?.controller.abort()
    await waitDone(producer, id)
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})
