// 发布交接(工单 #9、ADR 0009/0013)的模块层测试:导出物(发布包文件夹)、投递任务与发布确认。
// 与 host.test.js 同一层:只直接调用领域模块,不启 HTTP、不渲染 UI、不真调 wechatsync。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { exportPublishPackage } from '../src/publish.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import hostPlugin from '../src/host.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')
const STAMP = NOW.toISOString()

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

/** 从示例素材开一篇作品:返回 {state, work}。 */
function workState() {
  const state = buildSeed(NOW)
  const { receipts } = applyOps(state, [{ op: 'create_work', itemIds: ['seed_2'] }])
  const id = receipts[0].target
  applyOps(state, [{ op: 'update_work', id, rev: 0, title: '已排期的稿', article: '正文', cover: { prompt: 'c', status: 'done', src: 'writing-desk/files/a.jpg' } }])
  return { state, work: state.works.find(row => row.id === id) }
}

// 一份定稿:标题、正文(带小节)、封面、两张配图(一张挂在第一节)。
function published() {
  return {
    title: '第一篇成稿', article: '开头一段。\n\n## 第一节\n\n这里要改。\n\n## 第二节\n\n结尾。',
    cover: { prompt: 'c', status: 'done', src: 'writing-desk/files/a.jpg' },
    images: [
      { caption: '图注', prompt: 'i', status: 'done', anchor: '第一节', src: 'writing-desk/files/b.jpg' },
      { caption: '尾图', prompt: 'i2', status: 'done', src: 'writing-desk/files/c.png' },
    ],
  }
}

async function filesFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-pub-'))
  const filesDir = join(dir, 'files')
  await mkdir(filesDir)
  for (const name of ['a.jpg', 'b.jpg', 'c.png']) await writeFile(join(filesDir, name), PNG)
  return { dir, filesDir }
}

test('exportPublishPackage 写出 article.md + images/,图片引用都能解析到文件', async () => {
  const { dir, filesDir } = await filesFixture()
  try {
    const result = await exportPublishPackage(published(), { filesDir, exportDir: join(dir, 'out') })
    // 返回形状:{dir, articlePath, imageFiles}
    assert.equal(result.articlePath, join(result.dir, 'article.md'))
    assert.ok(Array.isArray(result.imageFiles))
    // 文件夹里只有 article.md 和 images/ 两种东西
    assert.deepEqual((await readdir(result.dir)).sort(), ['article.md', 'images'])
    // images/ 数量与成稿产物一致:封面 + 两张配图
    const images = (await readdir(join(result.dir, 'images'))).sort()
    assert.equal(images.length, 3)
    assert.deepEqual(result.imageFiles.map(f => f.split('/').pop()).sort(), images)
    // article.md 存在,标题在最前
    const article = await readFile(result.articlePath, 'utf8')
    assert.match(article, /^# 第一篇成稿\n/)
    // md 里的图片引用全部指向 images/ 内相对路径,且逐个可解析到真实文件
    const refs = [...article.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map(m => m[1])
    assert.equal(refs.length, 3)
    for (const ref of refs) await stat(join(result.dir, ref))
    // 封面挂到了 --cover,配图按小节插回:第一节末尾是图注那张
    assert.match(article, /这里要改。\n\n!\[图注\]\(images\//)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('没有画出来的图不进文件夹,纯文字稿照样能导出', async () => {
  const { dir, filesDir } = await filesFixture()
  try {
    const production = published()
    production.cover = { prompt: 'c', status: 'failed' }
    production.images = [{ caption: '没画成', prompt: 'i', status: 'failed' }]
    const result = await exportPublishPackage(production, { filesDir, exportDir: join(dir, 'out') })
    assert.deepEqual(result.imageFiles, [])
    assert.deepEqual(await readdir(result.dir).then(names => names.sort()), ['article.md', 'images'])
    const article = await readFile(result.articlePath, 'utf8')
    assert.ok(!article.includes('](images/'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('确认发布:publish_work 冻结发布稿、写 published 与发布时间', () => {
  const { state, work } = workState()
  const { receipts, errors } = applyOps(state, [{ op: 'publish_work', id: work.id }])
  assert.equal(errors.length, 0)
  const after = state.works.find(row => row.id === work.id)
  assert.equal(after.publication.status, 'published')
  assert.ok(after.publication.publishedAt)
  assert.equal(after.published.title, '已排期的稿')
  assert.equal(after.published.article, '正文')
  assert.ok(receipts[0].text.includes('已发布'))
  // 之后改当前稿不动发布稿(ADR 0014)
  applyOps(state, [{ op: 'update_work', id: work.id, rev: after.current.rev, article: '改过的正文' }])
  assert.equal(after.published.article, '正文')
})

test('没确认就什么也不发生:空稿与找不到的作品都拒绝发布', () => {
  const { state, work } = workState()
  const empty = { ...work, id: 'w_empty', current: { title: '空', article: '', rev: 0 }, publication: { status: 'draft' } }
  state.works.push(empty)
  const { errors } = applyOps(state, [{ op: 'publish_work', id: 'w_empty' }, { op: 'publish_work', id: 'nope' }])
  assert.equal(errors.length, 2)
  assert.equal(empty.publication.status, 'draft')
  assert.equal(empty.published, undefined)
})

test('投递回执:成功推到「已投递」,失败只记回执,发布状态仍只由用户确认', () => {
  const { state, work } = workState()
  applyOps(state, [{ op: 'record_work_dispatch', id: work.id, dispatch: { platform: 'zhihu', ok: true, url: 'https://example.com/draft' } }])
  assert.equal(work.publication.status, 'submitted')
  assert.ok(work.publication.submittedAt)
  assert.equal(work.published, undefined, '投递不等于发布')
  applyOps(state, [{ op: 'record_work_dispatch', id: work.id, dispatch: { platform: 'juejin', ok: false, error: '没登录' } }])
  assert.equal(work.publication.status, 'submitted')
  assert.equal(work.publication.dispatches.length, 2)
  assert.equal(work.publication.dispatches[1].error, '没登录')
})

function hostCtx() {
  let handler = null
  const ctx = {
    get: name => (name === 'connection' ? { requestRejection: () => undefined } : undefined),
    effect: (fn, name) => { if (!name?.includes('nm pairing')) fn() },
    webServer: { register: (options) => { handler = options.handler } },
  }
  hostPlugin.apply(ctx)
  const call = (path, method, body) => new Promise((resolve) => {
    const res = { statusCode: 0, headersSent: false, setHeader() {}, end: out => resolve({ status: res.statusCode, body: JSON.parse(out) }) }
    const req = { url: `/writing-desk/${path}`, method, headers: { 'sec-fetch-site': 'same-origin' } }
    if (body !== undefined) req[Symbol.asyncIterator] = function* () { yield Buffer.from(JSON.stringify(body)) }
    handler(req, res)
  })
  return { post: (path, body) => call(path, 'POST', body) }
}

/** 把一份带作品的状态写进临时 DSH_HOME,返回根目录。 */
async function seedHome() {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-pub-route-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  const root = join(dir, 'writing-desk')
  await mkdir(join(root, 'files'), { recursive: true })
  await writeFile(join(root, 'files', 'a.jpg'), PNG)
  const { state, work } = workState()
  await writeFile(join(root, 'state.json'), JSON.stringify(state))
  return { dir, root, workId: work.id, restore: () => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous } }
}

test('work/export 路由:导出发布包、cliPath 落库,绝不顺手写已发布', async () => {
  const home = await seedHome()
  try {
    const { post } = hostCtx()
    assert.equal((await post('settings', { exportDir: join(home.dir, 'out') })).status, 200)
    const result = await post('work/export', { id: home.workId })
    assert.equal(result.status, 200)
    assert.equal(result.body.articlePath, join(result.body.dir, 'article.md'))
    assert.ok(await stat(join(result.body.dir, 'article.md')))
    assert.ok(await stat(join(result.body.dir, 'images', 'cover.jpg')))
    // 导出只是出文件:发布状态一动不动
    const after = result.body.state.works.find(row => row.id === home.workId)
    assert.equal(after.publication.status, 'draft')
    assert.equal(after.published, undefined)
    assert.equal(after.cliPath, result.body.dir)
    // 再导一次写回同一个文件夹,不另开新目录
    const again = await post('work/export', { id: home.workId })
    assert.equal(again.body.dir, result.body.dir)
    // 不存在的作品拒绝导出
    const empty = await post('work/export', { id: 'w_nope' })
    assert.equal(empty.status, 400)
  } finally {
    home.restore()
    await rm(home.dir, { recursive: true, force: true })
  }
})

test('work/dispatch 路由:按选中平台写 outbox 任务(itemId 是作品 id),状态仍不动', async () => {
  const home = await seedHome()
  try {
    const { post } = hostCtx()
    assert.equal((await post('settings', { exportDir: join(home.dir, 'out') })).status, 200)
    // 未知平台被过滤,只把清单内的写进 outbox
    const result = await post('work/dispatch', { id: home.workId, platforms: ['zhihu', 'juejin', 'xiaohongshu', 'unknown-platform'] })
    assert.equal(result.status, 200)
    assert.ok(result.body.operationId)
    const after = result.body.state.works.find(row => row.id === home.workId)
    assert.equal(after.publication.status, 'draft', '投递不得改发布状态')
    assert.equal(after.published, undefined)
    assert.equal(after.cliPath, result.body.dir)

    const outbox = join(home.dir, 'writing-desk', 'bridge', 'outbox')
    const files = (await readdir(outbox)).filter(name => /^publish-[\w-]+\.json$/.test(name))
    assert.equal(files.length, 1)
    const task = JSON.parse(await readFile(join(outbox, files[0]), 'utf8'))
    assert.equal(task.operationId, result.body.operationId)
    assert.equal(task.itemId, home.workId)
    assert.deepEqual(task.platforms, ['zhihu', 'juejin', 'xiaohongshu'])
    assert.match(task.articleMd, /正文/)
    assert.ok(Object.keys(task.images).length >= 1, '发布包的图片映射要带进任务')

    // 没有可用平台 / 作品不存在都拒绝
    assert.equal((await post('work/dispatch', { id: home.workId, platforms: ['unknown-platform'] })).status, 400)
    assert.equal((await post('work/dispatch', { id: 'w_nope', platforms: ['zhihu'] })).status, 400)
  } finally {
    home.restore()
    await rm(home.dir, { recursive: true, force: true })
  }
})
