// 桥接投递箱测试(ADR 0009):采集进灵感墙、发布回执成 dispatches、原子认领互斥、
// 不可信输入的白名单校验。投递箱目录在临时 DSH_HOME 下,不碰真实用户数据。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { digestInbox, digestReceipts, bridgeStatus, touchHeartbeat, writePublishTask, writeCatalog, bridgePaths, normalizeCaptureUrl } from '../src/bridge.js'
import { BRIDGE_ADAPTERS } from '../src/platforms.js'
import { applyOps } from '../src/ops.js'
import { Store } from '../src/store.js'

const root = await mkdtemp(join(tmpdir(), 'dswritesync-bridge-'))
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

test('replaceItemId 命中已有灵感时走 update_item,不新增卡片,回执带 replaced', async () => {
  const url = 'https://example.com/post/replace'
  const payload = {
    operationId: 'test-replace-base',
    url,
    title: '替换前',
    body: '旧正文',
    siteName: '示例站',
    tags: ['旧标签'],
  }
  await dropInbox(payload)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  const before = (await store.read()).items.find(row => row.url === url)
  assert.ok(before, '替换目标没有先落库')

  const replace = {
    operationId: 'test-replace-go',
    replaceItemId: before.id,
    url,
    title: '替换后',
    body: '新正文',
    siteName: '新站',
    tags: ['新标签'],
  }
  await dropInbox(replace)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  let state = await store.read()
  const hits = state.items.filter(row => row.url === url)
  assert.equal(hits.length, 1, '替换不应新增第二条卡片')
  const item = hits[0]
  assert.equal(item.id, before.id, '替换必须写回原卡片')
  assert.equal(item.title, '替换后')
  assert.equal(item.body, '新正文')
  assert.deepEqual(item.tags, ['新标签'])
  assert.equal(item.source, '新站')
  let receipt = JSON.parse(await readFile(join(bridgePaths().receipts, 'import-test-replace-go.json'), 'utf8'))
  assert.equal(receipt.ok, true)
  assert.equal(receipt.itemId, before.id)
  assert.equal(receipt.replaced, true)

  // 同一 operationId 原样重投:复用回执,不再改一次卡片
  await dropInbox(replace)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  state = await store.read()
  assert.equal(state.items.filter(row => row.url === url).length, 1)
  receipt = JSON.parse(await readFile(join(bridgePaths().receipts, 'import-test-replace-go.json'), 'utf8'))
  assert.equal(receipt.replay, true)
  assert.equal(receipt.itemId, before.id)
  assert.equal(receipt.replaced, true)
})

test('replaceItemId 指向不存在的灵感时退回 add_item', async () => {
  const url = 'https://example.com/post/replace-missing'
  const payload = {
    operationId: 'test-replace-missing',
    replaceItemId: 'it_not_there',
    url,
    title: '没有替换目标',
    body: '',
  }
  await dropInbox(payload)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  const state = await store.read()
  const item = state.items.find(row => row.url === url)
  assert.ok(item, '目标不存在时应新增')
  const receipt = JSON.parse(await readFile(join(bridgePaths().receipts, 'import-test-replace-missing.json'), 'utf8'))
  assert.equal(receipt.ok, true)
  assert.equal(receipt.itemId, item.id)
  assert.ok(!receipt.replaced)
})

test('catalog 原子写出标签去重与 url 映射,结构未变跳过写', async () => {
  const state = await store.read()
  assert.equal(await writeCatalog(store), true)
  const first = JSON.parse(await readFile(bridgePaths().catalog, 'utf8'))
  assert.ok(!Number.isNaN(Date.parse(first.at)))
  const expectedTags = [...new Set(state.items.flatMap(row => Array.isArray(row.tags) ? row.tags : []))]
  assert.deepEqual(first.tags, expectedTags)
  const expectedUrls = Object.fromEntries(state.items
    .filter(row => typeof row.url === 'string' && row.url)
    .map(row => [row.url, row.id]))
  assert.deepEqual(first.urls, expectedUrls)

  // 同一结构再写:跳过,时间戳与内容都不变
  assert.equal(await writeCatalog(store), false)
  assert.equal(JSON.parse(await readFile(bridgePaths().catalog, 'utf8')).at, first.at)

  // 新增带标签和链接的灵感后结构变化,必须重写
  await store.mutate('catalog fixture', (draft) => {
    draft.items.unshift({
      id: 'it_catalog', kind: 'web', title: 'catalog fixture', body: '正文',
      url: 'https://example.com/catalog', tags: ['新标签'], status: 'idea',
      personaIds: [], createdAt: new Date().toISOString(),
    })
    return draft
  }, { undoable: false })
  assert.equal(await writeCatalog(store), true)
  const next = JSON.parse(await readFile(bridgePaths().catalog, 'utf8'))
  assert.ok(next.tags.includes('新标签'))
  assert.equal(next.urls['https://example.com/catalog'], 'it_catalog')
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
    platforms: ['zhihu', 'weixin', 'xiaohongshu', 'unknown-platform'],
  })
  assert.match(task.file, /publish-[\w-]+\.json$/)
  const raw = JSON.parse(await readFile(task.file, 'utf8'))
  assert.deepEqual(raw.platforms, ['zhihu', 'weixin', 'xiaohongshu'])
  assert.equal(raw.itemId, 'it_x')
})

test('发布回执落成作品 dispatches,投递不改发布状态', async () => {
  // 作品才是投递目标(ADR 0013):素材开一篇作品,回执按作品 id 落 publication.dispatches
  await store.mutate('建作品', (draft) => {
    const { receipts } = applyOps(draft, [{ op: 'add_item', title: '投递目标', body: '素材正文' }])
    const workId = applyOps(draft, [{ op: 'create_work', itemIds: [receipts[0].target] }]).receipts[0].target
    applyOps(draft, [{ op: 'update_work', id: workId, rev: 0, title: '投递目标', article: '正文' }])
    draft.items.find(row => row.id === receipts[0].target).scheduledAt = new Date().toISOString()
    return draft
  })
  const paths = bridgePaths()
  await mkdir(paths.receipts, { recursive: true })
  const state0 = await store.read()
  const work0 = state0.works.find(row => row.current.title === '投递目标')
  await writeFile(join(paths.receipts, 'dispatch-r1.json'), JSON.stringify({
    operationId: 'r1',
    itemId: work0.id,
    results: [
      { platform: 'zhihu', ok: true, url: 'https://zhuanlan.zhihu.com/p/1/edit' },
      { platform: 'juejin', ok: false, error: '未登录' },
    ],
  }))
  await digestReceipts(store)
  const state = await store.read()
  const work = state.works.find(row => row.id === work0.id)
  assert.equal(work.publication.dispatches.length, 2)
  assert.equal(work.publication.dispatches[0].platform, 'zhihu')
  assert.equal(work.publication.dispatches[0].ok, true)
  assert.equal(work.publication.dispatches[1].ok, false)
  assert.equal(work.publication.dispatches[1].error, '未登录')
  // 成功投递只推到「已投递」,发布仍等用户确认
  assert.equal(work.publication.status, 'submitted')
  assert.equal(work.published, undefined, '投递不得写发布稿')
  const item = state.items.find(row => row.title === '投递目标')
  assert.equal(item.dispatches, undefined, '回执不再挂到素材上')
  // 回执文件消化后消失
  assert.ok(!(await readdir(paths.receipts)).includes('dispatch-r1.json'))
})

test('投递目标快照让自建站可投递,回执记下站点显示名', async () => {
  const paths = bridgePaths()
  await mkdir(paths.root, { recursive: true })
  await writeFile(paths.targets, JSON.stringify({
    at: '2026-11-24T00:00:00.000Z',
    platforms: [{ id: 'zhihu', name: '知乎', authenticated: true }],
    cms: [{
      id: 'cms_wordpress_12345678', type: 'wordpress', name: '我的博客',
      url: 'https://blog.example.com', username: 'me', connected: true,
    }],
    hidden: [],
  }))

  const task = await writePublishTask({
    itemId: 'it_cms',
    title: '自建站稿',
    articleMd: '# 正文',
    images: {},
    platforms: ['zhihu', 'cms_wordpress_12345678', 'cms_unknown_00000000', 'unknown-platform'],
  })
  const raw = JSON.parse(await readFile(task.file, 'utf8'))
  assert.deepEqual(raw.platforms, ['zhihu', 'cms_wordpress_12345678'])

  // 回执里的自建站 id 按快照放行,并带上账户名供历史展示
  const state0 = await store.read()
  const work0 = state0.works.find(row => row.current.title === '投递目标')
  await writeFile(join(paths.receipts, 'dispatch-r-cms.json'), JSON.stringify({
    operationId: 'r-cms',
    itemId: work0.id,
    results: [{
      platform: 'cms_wordpress_12345678',
      platformName: '改名后的博客',
      ok: true,
      url: 'https://blog.example.com/wp-admin/post.php?post=1',
    }],
  }))
  await digestReceipts(store)
  const state = await store.read()
  const work = state.works.find(row => row.id === work0.id)
  const row = work.publication.dispatches.find(dispatch => dispatch.platform === 'cms_wordpress_12345678')
  assert.equal(row.ok, true)
  // 回执自带的显示名优先于快照,账户改名/删除后历史仍读得懂
  assert.equal(row.label, '改名后的博客')
})

test('回执里的非 http(s) 草稿链接被剥掉', async () => {
  const state0 = await store.read()
  const work0 = state0.works.find(row => row.current.title === '投递目标')
  const paths = bridgePaths()
  await mkdir(paths.receipts, { recursive: true })
  await writeFile(join(paths.receipts, 'dispatch-r2.json'), JSON.stringify({
    operationId: 'r2',
    itemId: work0.id,
    results: [{ platform: 'weixin', ok: true, url: 'javascript:alert(1)' }],
  }))
  await digestReceipts(store)
  const state = await store.read()
  const work = state.works.find(row => row.id === work0.id)
  const last = work.publication.dispatches.at(-1)
  assert.equal(last.platform, 'weixin')
  assert.ok(!last.url, '危险链接必须剥掉')
})

test('bridgeStatus 读 NM 配对结果并统计队列', async () => {
  const paths = bridgePaths()
  await mkdir(paths.root, { recursive: true })
  // 还没注册过:未配对,不炸
  let status = await bridgeStatus()
  assert.equal(status.paired, false)
  assert.ok(status.pending.inbox >= 0)
  // 注册器(ADR 0012)写出的 native.json:设置页据此显示配对状态
  await writeFile(join(paths.root, 'native.json'), JSON.stringify({
    v: 1, hostName: 'app.dswritesync.plugin', extensionId: 'hhkhkekbflmcnpbiiihpmgecpaicblbd',
    manifestPath: 'C:/plugin/native/app.dswritesync.plugin.json', supported: true,
    vendors: { 'Google\\Chrome': true, 'Microsoft\\Edge': false }, registeredAt: new Date().toISOString(),
  }))
  status = await bridgeStatus()
  assert.equal(status.paired, true)
  assert.equal(status.extensionId, 'hhkhkekbflmcnpbiiihpmgecpaicblbd')
  assert.deepEqual(status.browsers, ['Google\\Chrome'])
  assert.ok(status.pending.outbox >= 0)
})

test('normalizeCaptureUrl 去掉 utm/fbclid/gclid 噪声、fragment 与尾斜杠', () => {
  assert.equal(normalizeCaptureUrl('https://Example.com/a/?utm_source=rss&utm_medium=x&id=7#top'), 'https://example.com/a?id=7')
  assert.equal(normalizeCaptureUrl('https://example.com/a/?fbclid=1&gclid=2&utm_content=3'), 'https://example.com/a')
  assert.equal(normalizeCaptureUrl('https://example.com/a/?b=2&a=1'), 'https://example.com/a?a=1&b=2')
  assert.equal(normalizeCaptureUrl('https://example.com/'), 'https://example.com/')
  assert.equal(normalizeCaptureUrl('not a url'), null)
})

test('离线重复收进同一 URL(含 utm 噪声)只得到一张卡片,回执标 duplicate', async () => {
  const first = {
    operationId: 'test-dedup-1',
    url: 'https://example.com/post/dedup?utm_source=rss',
    title: '第一次收进',
    body: '正文',
  }
  await dropInbox(first)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  const second = {
    operationId: 'test-dedup-2',
    url: 'https://example.com/post/dedup/?utm_medium=social&utm_campaign=x',
    title: '离线又收了一次',
    body: '正文',
  }
  await dropInbox(second)
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1, '重复件也走消化流程写回执')
  const state = await store.read()
  const hits = state.items.filter(row => typeof row.url === 'string' && row.url.startsWith('https://example.com/post/dedup'))
  assert.equal(hits.length, 1, '灵感墙不能出现两张同源卡片')
  assert.equal(hits[0].title, '第一次收进', '先到的卡片留下')
  assert.equal(hits[0].via, 'capture')
  const receipt = JSON.parse(await readFile(join(bridgePaths().receipts, 'import-test-dedup-2.json'), 'utf8'))
  assert.equal(receipt.ok, true)
  assert.equal(receipt.duplicate, true)
  assert.equal(receipt.itemId, hits[0].id)
})

test('去重只作用于收进来源的卡片,手动建的卡不挡新收进', async () => {
  await store.mutate('手动建卡', (draft) => {
    applyOps(draft, [{ op: 'add_item', kind: 'web', title: '手动粘贴', body: '', url: 'https://example.com/manual' }])
    return draft
  })
  await dropInbox({ operationId: 'test-dedup-manual', url: 'https://example.com/manual', title: '从浏览器收下', body: '' })
  assert.equal((await digestInbox(store, store.filesDir)).imported, 1)
  const state = await store.read()
  const hits = state.items.filter(row => row.url === 'https://example.com/manual')
  assert.equal(hits.length, 2, '手动卡与收进卡互不干扰')
  const captured = hits.find(row => row.via === 'capture')
  assert.ok(captured, '新收进的那张带 via=capture')
  const receipt = JSON.parse(await readFile(join(bridgePaths().receipts, 'import-test-dedup-manual.json'), 'utf8'))
  assert.ok(!receipt.duplicate, '手动卡不算重复')
})

test('适配器清单覆盖 20 个内容平台(排除 zip-download)', () => {
  assert.deepEqual(Object.keys(BRIDGE_ADAPTERS).sort(), [
    '51cto', 'aliyun', 'baijiahao', 'bilibili', 'cnblogs', 'csdn', 'douban',
    'eastmoney', 'imooc', 'juejin', 'oschina', 'segmentfault', 'sohu', 'weibo',
    'weixin', 'woshipm', 'xiaohongshu', 'xueqiu', 'yuque', 'zhihu',
  ])
  // 中文标签仍然齐全,扩展 / CLI 平台名映射不用另起一套英文 id
  assert.equal(BRIDGE_ADAPTERS['51cto'], '51CTO')
  assert.equal(BRIDGE_ADAPTERS.woshipm, '人人都是产品经理')
  assert.equal(BRIDGE_ADAPTERS.aliyun, '阿里云开发者社区')
  assert.equal(BRIDGE_ADAPTERS.xiaohongshu, '小红书')
})

test('心跳文件:touchHeartbeat 建立并刷新 mtime,供 helper 判活', async () => {
  const paths = await touchHeartbeat()
  const first = await stat(paths.heartbeat)
  // mtime 精度到秒级时立刻重 touch 可能同值,等 5ms 再刷
  await new Promise(resolve => setTimeout(resolve, 5))
  await touchHeartbeat()
  const second = await stat(paths.heartbeat)
  assert.ok(second.mtimeMs >= first.mtimeMs, '重 touch 不回退')
  assert.equal(first.size, 0, '心跳是空文件,只承担活性')
})
