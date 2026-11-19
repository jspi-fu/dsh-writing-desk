// 桥接投递箱测试(ADR 0009):采集进灵感墙、发布回执成 dispatches、原子认领互斥、
// 不可信输入的白名单校验。投递箱目录在临时 DSH_HOME 下,不碰真实用户数据。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { digestInbox, digestReceipts, bridgeStatus, writePublishTask, bridgePaths, BRIDGE_ADAPTERS } from '../src/bridge.js'
import { Store } from '../src/store.js'

const root = await mkdtemp(join(tmpdir(), 'wdesk-bridge-'))
process.env.DSH_HOME = root
const store = new Store(join(root, 'writing-desk'))

test.after(async () => { await rm(root, { recursive: true, force: true }) })

async function dropInbox(payload) {
  const paths = bridgePaths()
  await mkdir(paths.inbox, { recursive: true })
  const name = `import-${payload.operationId}.json`
  await writeFile(join(paths.inbox, name), JSON.stringify(payload))
  return name
}

test('采集投递落成灵感墙卡片,写回执,投递文件被消化掉', async () => {
  const operationId = 'test-import-1'
  await dropInbox({
    operationId,
    url: 'https://example.com/post/1',
    title: '一篇很好的文章',
    body: '正文节选'.repeat(10),
    siteName: '示例站',
    tags: ['参考', '研发'],
  })
  const result = await digestInbox(store, store.filesDir)
  assert.equal(result.imported, 1)
  const state = await store.read()
  const item = state.items.find(row => row.url === 'https://example.com/post/1')
  assert.ok(item, '灵感没有上墙')
  assert.equal(item.kind, 'web')
  assert.equal(item.title, '一篇很好的文章')
  assert.deepEqual(item.tags, ['参考', '研发'])
  const receipt = JSON.parse(await readFile(join(bridgePaths().receipts, `import-${operationId}.json`), 'utf8'))
  assert.equal(receipt.ok, true)
  assert.equal(receipt.itemId, item.id)
  assert.ok(!(await readdir(bridgePaths().inbox)).some(name => name === `import-${operationId}.json`), '投递文件应被消化掉')
})

test('同一 operationId 重投不产生重复卡片(认领互斥 + 文件已消化)', async () => {
  const payload = {
    operationId: 'test-import-dup',
    url: 'https://example.com/post/dup',
    title: '重复投递',
    body: '',
  }
  await dropInbox(payload)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  await dropInbox(payload)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  const state = await store.read()
  const hits = state.items.filter(row => row.url === 'https://example.com/post/dup')
  assert.equal(hits.length, 1)
})

test('非 http(s) 链接被拒绝并写错误回执', async () => {
  const operationId = 'test-import-badurl'
  await dropInbox({ operationId, url: 'file:///etc/passwd', title: '越界' })
  const result = await digestInbox(store, store.filesDir)
  assert.equal(result.imported, 0)
  assert.equal(result.failed, 1)
  const receipt = JSON.parse(await readFile(join(bridgePaths().receipts, `import-${operationId}.json`), 'utf8'))
  assert.equal(receipt.ok, false)
  const state = await store.read()
  assert.ok(!state.items.some(row => row.title === '越界'))
})

test('data URI 封面落成 files 素材,media.src 指向本插件目录', async () => {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  const operationId = 'test-import-cover'
  await dropInbox({
    operationId,
    url: 'https://example.com/post/cover',
    title: '带封面的采集',
    body: '',
    cover: `data:image/png;base64,${pixel.toString('base64')}`,
  })
  const result = await digestInbox(store, store.filesDir)
  assert.equal(result.imported, 1)
  const state = await store.read()
  const item = state.items.find(row => row.url === 'https://example.com/post/cover')
  assert.match(item.media.src, /^writing-desk\/files\/b[\w]+\.png$/)
  const file = await readFile(join(store.filesDir, item.media.src.split('/').pop()))
  assert.deepEqual(file, pixel)
})

test('发布任务写进 outbox,未知平台被过滤', async () => {
  const task = await writePublishTask({
    itemId: 'it_x',
    title: '一篇稿子',
    articleMd: '# 正文',
    images: { 'images/cover.jpg': join(root, 'cover.jpg') },
    platforms: ['zhihu', 'weixin', 'xiaohongshu'],
  })
  assert.match(task.file, /publish-[\w-]+\.json$/)
  const raw = JSON.parse(await readFile(task.file, 'utf8'))
  assert.deepEqual(raw.platforms, ['zhihu', 'weixin'])
  assert.equal(raw.itemId, 'it_x')
})

test('发布回执落成 dispatches,status 不被触碰', async () => {
  const created = await store.mutate('建稿', (draft) => {
    draft.items.unshift({ id: 'it_dispatch', kind: 'note', title: '投递目标', body: '', tags: [], status: 'ready', personaIds: [], createdAt: new Date().toISOString(), scheduledAt: new Date().toISOString(), production: { title: '投递目标', article: '正文', rev: 1 } })
    return draft
  })
  assert.ok(created)
  const paths = bridgePaths()
  await mkdir(paths.receipts, { recursive: true })
  await writeFile(join(paths.receipts, 'dispatch-r1.json'), JSON.stringify({
    operationId: 'r1',
    itemId: 'it_dispatch',
    results: [
      { platform: 'zhihu', ok: true, url: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'juejin', ok: false, error: '未登录' },
    ],
  }))
  await digestReceipts(store)
  const state = await store.read()
  const item = state.items.find(row => row.id === 'it_dispatch')
  assert.equal(item.dispatches.length, 2)
  assert.equal(item.dispatches[0].platform, 'zhihu')
  assert.equal(item.dispatches[0].ok, true)
  assert.equal(item.dispatches[1].ok, false)
  assert.equal(item.dispatches[1].error, '未登录')
  assert.equal(item.status, 'ready', '回执不得改状态')
  // 回执文件消化后消失
  assert.ok(!(await readdir(paths.receipts)).includes('dispatch-r1.json'))
})

test('回执里的非 http(s) 草稿链接被剥掉', async () => {
  const paths = bridgePaths()
  await writeFile(join(paths.receipts, 'dispatch-r2.json'), JSON.stringify({
    operationId: 'r2',
    itemId: 'it_dispatch',
    results: [{ platform: 'weixin', ok: true, url: 'javascript:alert(1)' }],
  }))
  await digestReceipts(store)
  const state = await store.read()
  const item = state.items.find(row => row.id === 'it_dispatch')
  const last = item.dispatches.at(-1)
  assert.equal(last.platform, 'weixin')
  assert.ok(!last.url, '危险链接必须剥掉')
})

test('bridgeStatus 读 auth 并统计队列', async () => {
  const paths = bridgePaths()
  await mkdir(paths.root, { recursive: true })
  await writeFile(paths.auth, JSON.stringify({ token: 'secret-token', wsPort: 4527, startedAt: new Date().toISOString() }), { mode: 0o600 })
  const status = await bridgeStatus()
  assert.equal(status.configured, true)
  assert.equal(status.token, 'secret-token')
  assert.equal(status.port, 4527)
  assert.ok(status.pending.inbox >= 0)
})

test('适配器清单是 v1 三平台', () => {
  assert.deepEqual(Object.keys(BRIDGE_ADAPTERS).sort(), ['juejin', 'weixin', 'zhihu'])
})
