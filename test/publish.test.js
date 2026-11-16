// 发布交接(工单 #9)的模块层测试:导出物(文件夹与命令)与确认状态流。
// 与 host.test.js 同一层:只直接调用领域模块,不启 HTTP、不渲染 UI、不真调 wechatsync。
// CLI 失败也 exit(0) 且无 --json,所以测试只断言导出物本身,绝不解析 CLI 输出或退出码。
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { exportForCli } from '../src/publish.js'
import { applyOps } from '../src/ops.js'
import { isScheduled, panelState } from '../src/state.js'
import { buildSeed } from '../src/seed.js'
import hostPlugin from '../src/host.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')

function seed() {
  return buildSeed(NOW)
}

/** 一篇已成稿又排上期的稿子:发布确认流程的起点。 */
function readyState() {
  const state = seed()
  const item = state.items.find(row => row.id === 'seed_2')
  item.production = { status: 'done', stage: 'done', title: '已排期的稿', article: '正文' }
  item.scheduledAt = '2026-12-01T10:00:00.000Z'
  item.status = 'ready'
  return state
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

// 一份定稿:标题、正文(带小节)、封面、两张配图(一张挂在第一节)。
function published() {
  return {
    status: 'done', title: '第一篇成稿', article: '开头一段。\n\n## 第一节\n\n这里要改。\n\n## 第二节\n\n结尾。',
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

test('exportForCli 写出 CLI 原生的 article.md + images/,图片引用都能解析到文件', async () => {
  const { dir, filesDir } = await filesFixture()
  try {
    const result = await exportForCli(published(), { filesDir, exportDir: join(dir, 'out') })
    // 返回形状:{dir, articlePath, imageFiles, command}
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

test('命令是可复制的 wechatsync sync,带实测的真实 flag,--dry-run 是唯一差别', async () => {
  const { dir, filesDir } = await filesFixture()
  try {
    const production = published()
    production.title = '带"引号"的标题'
    const result = await exportForCli(production, { filesDir, exportDir: join(dir, 'out') })
    // 用 --help 实测过的拼法:sync <file>、--title、--cover、--dry-run;标题里的引号清掉,命令可直接粘贴
    assert.match(result.command, /^wechatsync sync ".*article\.md"/)
    assert.match(result.command, / --title "带引号的标题" /)
    assert.match(result.command, / --cover ".*images[/\\]cover\.jpg"/)
    assert.ok(!result.command.includes('--dry-run'))
    assert.equal(result.dryRunCommand, `${result.command} --dry-run`)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('没有画出来的图不进命令也不进文件夹,纯文字稿照样能导出', async () => {
  const { dir, filesDir } = await filesFixture()
  try {
    const production = published()
    production.cover = { prompt: 'c', status: 'failed' }
    production.images = [{ caption: '没画成', prompt: 'i', status: 'failed' }]
    const result = await exportForCli(production, { filesDir, exportDir: join(dir, 'out') })
    assert.deepEqual(result.imageFiles, [])
    assert.deepEqual(await readdir(result.dir).then(names => names.sort()), ['article.md', 'images'])
    const article = await readFile(result.articlePath, 'utf8')
    assert.ok(!article.includes('](images/'))
    assert.ok(!result.command.includes('--cover'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('确认发布:publish_item 经 reducer 写 published,记下发布时间', () => {
  const state = readyState()
  const { receipts, errors } = applyOps(state, [{ op: 'publish_item', id: 'seed_2' }])
  assert.equal(errors.length, 0)
  const item = state.items.find(row => row.id === 'seed_2')
  assert.equal(item.status, 'published')
  assert.ok(item.publishedAt)
  assert.equal(isScheduled(item), false)
  assert.equal(panelState(item), 'published')
  assert.ok(receipts[0].text.includes('已发布'))
})

test('没确认就什么也不发生:发布不会从导出或同步里自动长出来', () => {
  const state = readyState()
  // 导出/同步动作在 ops 层根本没有对应操作,状态只能由用户确认的 publish_item 或手动 set_status 改
  const { errors } = applyOps(state, [{ op: 'publish_item', id: 'nope' }])
  assert.equal(errors.length, 1)
  const item = state.items.find(row => row.id === 'seed_2')
  assert.equal(item.status, 'ready')
  assert.equal(item.publishedAt, null)
})

test('确认之后仍可手动改状态:撤回发布清掉发布时间,自愈按排期与成稿对齐', () => {
  const state = readyState()
  applyOps(state, [{ op: 'publish_item', id: 'seed_2' }])
  // 发布撤了,但这篇还排着期、也有成稿:自愈把它拉回待发布,而不是留在草稿
  applyOps(state, [{ op: 'set_status', id: 'seed_2', status: 'draft' }])
  const item = state.items.find(row => row.id === 'seed_2')
  assert.equal(item.status, 'ready')
  assert.equal(item.publishedAt, undefined)
  // 连排期一起撤掉,才真正回到草稿
  applyOps(state, [{ op: 'schedule_item', id: 'seed_2', scheduledAt: null }])
  assert.equal(item.status, 'draft')
})

test('produce/export 路由:导出发布包、cliPath 落库,绝不顺手写已发布', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-pub-route-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    // 预置一份已成稿又排上期的状态(Store 从 state.json 加载)
    const root = join(dir, 'writing-desk')
    await mkdir(join(root, 'files'), { recursive: true })
    await writeFile(join(root, 'files', 'a.jpg'), PNG)
    const state = buildSeed(NOW)
    const item = state.items.find(row => row.id === 'seed_2')
    item.production = { status: 'done', stage: 'done', title: '已排期的稿', article: '正文', cover: { prompt: 'c', status: 'done', src: 'writing-desk/files/a.jpg' } }
    item.scheduledAt = '2026-12-01T10:00:00.000Z'
    item.status = 'ready'
    await writeFile(join(root, 'state.json'), JSON.stringify(state))

    let handler = null
    const ctx = {
      get: name => (name === 'connection' ? { requestRejection: () => undefined } : undefined),
      effect: fn => fn(),
      webServer: { register: (options) => { handler = options.handler } },
    }
    hostPlugin.apply(ctx)
    const call = (path, method, body) => new Promise((resolve) => {
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end: out => resolve({ status: res.statusCode, body: JSON.parse(out) }) }
      const req = { url: `/writing-desk/${path}`, method, headers: { 'sec-fetch-site': 'same-origin' } }
      if (body !== undefined) req[Symbol.asyncIterator] = function* () { yield Buffer.from(JSON.stringify(body)) }
      handler(req, res)
    })
    const post = (path, body) => call(path, 'POST', body)

    // 导出目录先指到临时目录,别写进用户真实的 Documents
    assert.equal((await post('settings', { exportDir: join(dir, 'out') })).status, 200)
    const result = await post('produce/export', { id: 'seed_2' })
    assert.equal(result.status, 200)
    assert.equal(result.body.articlePath, join(result.body.dir, 'article.md'))
    assert.match(result.body.command, /^wechatsync sync/)
    assert.ok(await stat(join(result.body.dir, 'article.md')))
    assert.ok(await stat(join(result.body.dir, 'images', 'cover.jpg')))
    // 导出只是出文件:状态一动不动,已发布只等用户确认
    const after = result.body.state.items.find(row => row.id === 'seed_2')
    assert.equal(after.status, 'ready')
    assert.equal(after.publishedAt, null)
    assert.equal(after.production.cliPath, result.body.dir)
    // 再导一次写回同一个文件夹,不另开新目录
    const again = await post('produce/export', { id: 'seed_2' })
    assert.equal(again.body.dir, result.body.dir)
    // 没有成稿的灵感拒绝导出
    const empty = await post('produce/export', { id: 'seed_1' })
    assert.equal(empty.status, 400)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})
