import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { assertPublicUrl, harvest, harvestText } from '../src/harvest.js'
import { activeStyle, styleToVoice } from '../src/style.js'
import { migrateState } from '../src/seed.js'
import { previewUrl, requestRejection } from '../src/host.js'
import { exportSkill } from '../src/learn.js'
import { applyOps } from '../src/ops.js'
import { buildSeed } from '../src/seed.js'
import { Store } from '../src/store.js'
import { saveProduction, resolveExportDir } from '../src/export.js'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { publicSettings, Settings } from '../src/settings.js'
import { stat } from 'node:fs/promises'

const NOW = new Date('2026-10-31T15:00:00+08:00') // 周六

function seed() {
  return buildSeed(NOW)
}

test('applyOps 拒绝未知操作和原型链上的名字', () => {
  const state = seed()
  const { errors } = applyOps(state, [{ op: 'constructor' }, { op: 'rm_rf' }])
  assert.equal(errors.length, 2)
})

test('applyOps 过滤非法字段和危险媒体地址', () => {
  const state = seed()
  const { receipts } = applyOps(state, [{ op: 'add_item', title: 'x', media: { src: 'javascript:alert(1)' }, url: 'javascript:alert(1)', status: 'nope', evil: 1 }])
  const item = state.items.find(i => i.id === receipts[0].target)
  assert.equal(item.media, undefined)
  assert.equal(item.url, undefined)
  assert.equal(item.status, 'idea')
  assert.equal(item.evil, undefined)
})

test('applyOps 部分失败不影响其余操作', () => {
  const state = seed()
  const { receipts, errors } = applyOps(state, [{ op: 'set_status', id: 'nope', status: 'draft' }, { op: 'set_status', id: 'seed_2', status: 'draft' }])
  assert.equal(errors.length, 1)
  assert.equal(receipts.length, 1)
  assert.equal(state.items.find(i => i.id === 'seed_2').status, 'draft')
})

test('删除父卡片时子卡片接到上一级', () => {
  const state = seed()
  applyOps(state, [{ op: 'update_item', id: 'seed_2', parentId: 'seed_1' }, { op: 'update_item', id: 'seed_3', parentId: 'seed_2' }, { op: 'delete_item', id: 'seed_2' }])
  assert.equal(state.items.find(i => i.id === 'seed_3').parentId, 'seed_1')
})

test('clear_samples 清空示例但保留用户内容', () => {
  const state = seed()
  applyOps(state, [{ op: 'add_item', title: '我自己的' }, { op: 'clear_samples' }])
  assert.deepEqual(state.items.map(i => i.title), ['我自己的'])
})

test('速记卡的来源类型只接受「我写的 / AI 生成的」', () => {
  const state = seed()
  const { receipts } = applyOps(state, [
    { op: 'add_item', title: '手写的', body: 'x', source: '速记', tags: ['选题'], contentOrigin: 'user' },
    { op: 'add_item', title: 'AI 出的', body: 'y', contentOrigin: 'ai' },
    { op: 'add_item', title: '坏值不落库', contentOrigin: 'gpt' },
  ])
  const items = state.items
  assert.equal(items.find(i => i.id === receipts[0].target).contentOrigin, 'user')
  assert.equal(items.find(i => i.id === receipts[1].target).contentOrigin, 'ai')
  assert.equal(items.find(i => i.title === '坏值不落库').contentOrigin, undefined)
  const target = receipts[0].target
  applyOps(state, [{ op: 'update_item', id: target, contentOrigin: 'ai' }, { op: 'update_item', id: target, contentOrigin: null }])
  assert.equal(items.find(i => i.id === target).contentOrigin, null)
})

test('编辑界面保存沿用操作历史：撤销一次回到上一版正文', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-edit-'))
  try {
    const store = new Store(dir)
    await store.read()
    // 编辑器的保存就是 ops 路由那一套：applyOps + 可撤销的 store.mutate
    const save = (label, ops) => store.mutate(label, draft => ({ ...applyOps(draft, ops), state: draft }))
    const { receipts } = await save('记下灵感', [{ op: 'add_item', title: '第一版', body: '最初正文' }])
    const id = receipts[0].target
    await save('保存编辑', [{ op: 'update_item', id, body: '第二版正文' }])
    await save('保存编辑', [{ op: 'update_item', id, title: '改个标题', body: '第三版正文' }])
    assert.equal(await store.undoLast(), '保存编辑')
    const after = (await store.read()).items.find(i => i.id === id)
    assert.equal(after.body, '第二版正文')
    assert.equal(after.title, '第一版', '那一步同时改过标题和正文，就一起回到上一版')
    assert.equal(await store.undoLast(), '保存编辑')
    const first = (await store.read()).items.find(i => i.id === id)
    assert.equal(first.body, '最初正文')
    assert.equal(first.title, '第一版')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Store 持久化、撤销，并能感知另一进程的写入', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-'))
  try {
    const a = new Store(dir)
    const before = (await a.read()).items.length
    await a.mutate('add', s => applyOps(s, [{ op: 'add_item', title: '新灵感' }]))
    assert.equal((await a.read()).items.length, before + 1)
    assert.equal(await a.undoLast(), 'add')
    assert.equal((await a.read()).items.length, before)

    const b = new Store(dir)
    await b.mutate('b', s => applyOps(s, [{ op: 'add_item', title: '来自桌面端' }]))
    assert.equal((await a.read()).items[0].title, '来自桌面端')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('requestRejection 没有鉴权服务时拒绝，有服务时听它的', () => {
  const req = { headers: { cookie: 'x' } }
  assert.equal(requestRejection({ get: () => undefined }, req), 403)
  assert.equal(requestRejection({ get: () => ({ requestRejection: () => 401 }) }, req), 401)
  let seen = null
  const allowed = requestRejection({ get: () => ({ requestRejection: (r) => { seen = r; return undefined } }) }, req)
  assert.equal(allowed, undefined)
  assert.equal(seen.headers, req.headers)
})

test('exportSkill 不导出示例规则和示例人物', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-skill-'))
  try {
    const state = seed()
    await assert.rejects(exportSkill(state, dir), /示例规则和模板不会被导出/)
    applyOps(state, [{ op: 'add_skill', name: '我的规则', rule: '标题不超过 20 字', status: 'active' }])
    const result = await exportSkill(state, dir)
    assert.equal(result.rules, 1)
    const body = await readFile(result.path, 'utf8')
    assert.match(body, /^---\nname: writing-desk-voice\n/)
    assert.match(body, /我的规则/)
    assert.doesNotMatch(body, /开头先给数字/)
    assert.doesNotMatch(body, /想入门的小林/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('assertPublicUrl 拒绝本机和内网地址', async () => {
  for (const url of ['http://localhost:3000', 'http://127.0.0.1', 'http://10.0.0.1', 'http://192.168.1.1', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd']) {
    await assert.rejects(assertPublicUrl(url), url)
  }
})

test('harvest 解析元信息，并拦截跳转到内网', async () => {
  const page = '<html><head><title>备用标题</title><meta property="og:title" content="主页 &amp; 档案"><meta name="description" content="粉丝 1.2万"><meta property="og:image" content="/a.jpg"></head></html>'
  const ok = async () => new Response(page, { headers: { 'content-type': 'text/html' } })
  const info = await harvest('https://93.184.216.34/u', ok)
  assert.equal(info.title, '主页 & 档案')
  assert.equal(info.image, 'https://93.184.216.34/a.jpg')
  assert.equal(info.followers, 12000)

  const redirect = async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
  await assert.rejects(harvest('https://93.184.216.34/u', redirect), /本机|内网/)
})

test('previewUrl 只回预填字段，不写库', async () => {
  const page = '<html><head><meta property="og:title" content="主页"><meta property="og:description" content="一句话简介"><meta property="og:image" content="/a.jpg"><meta property="og:site_name" content="某站"></head></html>'
  const ok = async () => new Response(page, { headers: { 'content-type': 'text/html' } })
  const info = await previewUrl('https://93.184.216.34/u', ok)
  assert.deepEqual(info, { url: 'https://93.184.216.34/u', title: '主页', description: '一句话简介', image: 'https://93.184.216.34/a.jpg', siteName: '某站' })
  // 元信息缺失的页面也要给空串，对话框直接填进输入框
  const bare = async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
  const empty = await previewUrl('https://93.184.216.34/plain', bare)
  assert.equal(empty.title, '')
  assert.equal(empty.image, '')
})

test('Settings 只剩语言与导出位置，权限 600,旧字段读取时丢掉', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-set-'))
  try {
    const settings = new Settings(dir)
    // 旧版本的 settings.json 里存着生图配置:读进来直接丢,不再外泄也不再生效
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ image: { apiKey: 'sk-abcdefgh1234' }, shotCount: 6, language: 'en', exportDir: '~/稿件' }))
    const open = publicSettings(await settings.read())
    assert.deepEqual(open, { language: 'en', exportDir: '~/稿件' })
    assert.ok(!JSON.stringify(open).includes('abcdefgh'))
    // Windows 不暴露 Unix 权限位,chmod 后就不再校验 mode
    if (process.platform !== 'win32') assert.equal((await stat(join(dir, 'settings.json'))).mode & 0o777, 0o600)
    await settings.update({ exportDir: 'D:/稿件', imageCount: 99, shotCount: 3 })
    assert.deepEqual(await settings.read(), { language: 'en', exportDir: 'D:/稿件' })
    await assert.rejects(settings.update({ exportDir: 123 }), /导出位置无效/)
    await settings.update({ language: 'zh' })
    assert.equal((await settings.read()).language, 'zh')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

test('saveProduction 写出文章、封面和配图，标题里的路径字符被清掉，配图锚到小标题', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-save-'))
  try {
    const filesDir = join(dir, 'files')
    await mkdir(filesDir)
    await writeFile(join(filesDir, 'a.jpg'), PNG)
    await writeFile(join(filesDir, 'b.jpg'), PNG)
    const p = {
      title: '../危险/标题: 测试',
      article: '# ../危险/标题: 测试\n\n开头。\n\n## 为什么\n\n这里要改。\n\n## 怎么办\n\n收尾。',
      cover: { src: 'writing-desk/files/a.jpg', status: 'done' },
      images: [{ src: 'writing-desk/files/b.jpg', caption: '配图', anchor: '为什么', status: 'done' }],
    }
    const saved = await saveProduction(p, { filesDir, exportDir: join(dir, 'out') })
    assert.equal(saved.path, join(dir, 'out', '危险 标题 测试'))
    const names = await readdir(saved.path)
    assert.deepEqual(names.sort(), ['封面原图.jpg', '文章.md', '配图1.jpg'].sort())
    const article = await readFile(join(saved.path, '文章.md'), 'utf8')
    assert.match(article, /^# \.\.\/危险/)
    assert.match(article, /这里要改。\n\n!\[配图\]\(配图1\.jpg\)/)
    // 再存一次写回同一个文件夹
    p.savedPath = saved.path
    assert.equal((await saveProduction({ ...p, title: '改名了' }, { filesDir, exportDir: join(dir, 'out') })).path, saved.path)
    // 用户在系统选择器里另选了文件夹:显式 target 优先于 savedPath
    const picked = join(dir, 'picked')
    assert.equal((await saveProduction(p, { filesDir, exportDir: join(dir, 'out'), target: picked })).path, picked)
    assert.ok(existsSync(join(picked, '文章.md')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('resolveExportDir 展开 ~，空值用默认位置', () => {
  assert.match(resolveExportDir('').replace(/\\/g, '/'), /Documents\/图文创作台$/)
  assert.ok(!resolveExportDir('~/x').startsWith('~'))
  assert.equal(resolveExportDir('/tmp/x'), '/tmp/x')
})

test('风格:ops 白名单只放行风格字段,选中的卡能变成写作要求', () => {
  const state = seed()
  const { receipts } = applyOps(state, [{ op: 'add_style', name: '慢半拍', tone: '很独特的语气', words: ['那天', 3], evil: 1 }])
  const style = state.styles.find(row => row.id === receipts[0].target)
  assert.equal(style.evil, undefined, '白名单之外的字段不落库')
  assert.deepEqual(style.words, ['那天'], '非字符串词被滤掉')
  assert.match(styleToVoice(style), /常用词：那天/)
  assert.equal(styleToVoice(null), '')

  assert.equal(activeStyle(state), null, '还没选中时不跟任何卡走')
  applyOps(state, [{ op: 'set_style', id: receipts[0].target }])
  assert.equal(activeStyle(state).name, '慢半拍')
  applyOps(state, [{ op: 'delete_style', id: receipts[0].target }])
  assert.equal(state.activeStyleId, null)
})


test('风格预设：旧模板换成新预设，清空示例也不会删预设', async () => {
  const { STYLE_CATEGORIES, STYLE_PRESETS } = await import('../src/style-presets.js')
  for (const row of STYLE_PRESETS) {
    assert.ok(STYLE_CATEGORIES.includes(row.category), row.name)
    for (const key of ['icon', 'name', 'summary', 'tone', 'sentences', 'opening', 'structure']) assert.ok(row[key], `${row.name} 缺 ${key}`)
    assert.ok(row.words.length && row.avoid.length && row.samples.length, row.name)
    assert.ok(!/[\u4e00-\u9fff]/.test(row.icon), `${row.name} 的图标不能是汉字`)
  }
  assert.equal(new Set(STYLE_PRESETS.map(row => row.icon)).size, STYLE_PRESETS.length)
  for (const category of STYLE_CATEGORIES) assert.ok(STYLE_PRESETS.some(row => row.category === category), category)

  const old = { items: [], activeStyleId: 'seed_style_story', styles: [{ id: 'seed_style_story', name: '松弛讲故事', sample: true }, { id: 'st_1', name: '我的' }] }
  migrateState(old)
  assert.equal(old.activeStyleId, 'preset_story')
  assert.equal(old.styles.some(row => row.id.startsWith('seed_style_')), false)
  assert.equal(old.styles[0].name, '我的')
  assert.equal(old.styles.filter(row => row.preset).length, STYLE_PRESETS.length)

  // 预设删过之后不再补回来
  const deleted = migrateState({ items: [], sampleCleared: true })
  assert.equal(deleted.styles.length, STYLE_PRESETS.length)
  applyOps(deleted, [{ op: 'delete_style', id: 'preset_news' }])
  assert.equal(migrateState(deleted).styles.some(row => row.id === 'preset_news'), false)

  const state = seed()
  assert.equal(state.styles.length, STYLE_PRESETS.length)
  assert.ok(state.items.some(row => row.sample))
  applyOps(state, [{ op: 'add_style', name: '我的' }, { op: 'set_style', id: 'preset_travel' }, { op: 'clear_samples' }])
  assert.equal(state.items.some(row => row.sample), false)
  assert.equal(state.skills.some(row => row.sample), false)
  assert.equal(state.styles.length, STYLE_PRESETS.length + 1)
  assert.equal(state.activeStyleId, 'preset_travel')
})

test('migrateState: 旧版 writing-desk 的空结构迁移成新版完整结构，不丢字段', () => {
  // 重构前 state.json 是这套字段：cards/boxes/drafts/works…，客户端新版全用 items 等。
  const legacy = JSON.parse('{"version":1,"cards":[],"boxes":[],"copies":[],"drafts":[],"mergeRecords":[],"upgradeIntents":[],"works":[],"undoHistory":[],"actions":[],"templates":[],"updatedAt":"2026-11-16T03:02:36.957Z"}')
  const migrated = migrateState(legacy)
  for (const key of ['items', 'people', 'angles', 'skills', 'styles']) {
    assert.ok(Array.isArray(migrated[key]), `迁移后 ${key} 必须是数组`)
  }
  assert.equal(typeof migrated.sampleCleared, 'boolean')
  assert.ok(migrated.sampleLang === 'zh' || migrated.sampleLang === 'en')
  // 客户端 header 用 state.items.some，迁移后不得再是 undefined
  assert.doesNotThrow(() => migrated.items.some(() => false))
})

test('harvestText 抽出正文，去掉脚本和导航', async () => {
  const page = '<html><head><title>标题</title><style>x{}</style></head><body><nav>导航内容不要这段内容</nav><script>var a=1</script><p>这是第一段正文内容，足够长。</p><div>这是第二段&amp;正文内容，足够长。</div></body></html>'
  const { text, title } = await harvestText('https://93.184.216.34/a', async () => new Response(page, { headers: { 'content-type': 'text/html' } }))
  assert.equal(title, '标题')
  assert.match(text, /第一段正文/)
  assert.match(text, /第二段&正文/)
  assert.doesNotMatch(text, /导航|var a/)
  await assert.rejects(harvestText('http://127.0.0.1/x'), /本机|内网/)
})

test('排期：排上日历是大纲/待发布，取消排期退回灵感/草稿，已发布不再挂在素材上', () => {
  const state = seed()
  const [ideaR, doneR] = applyOps(state, [{ op: 'add_item', title: '只有灵感' }, { op: 'add_item', title: '写成作品的' }]).receipts
  const done = state.items.find(row => row.id === doneR.target)
  // 作品承载正文(ADR 0013):素材本身没有成稿字段
  const work = applyOps(state, [{ op: 'create_work', itemIds: [doneR.target] }]).receipts[0]
  state.works[0].current = { title: '写成作品的', article: '正文', rev: 1 }
  applyOps(state, [{ op: 'schedule_item', id: ideaR.target, scheduledAt: '2026-12-01T12:00:00Z' }, { op: 'schedule_item', id: doneR.target, scheduledAt: '2026-12-01T12:00:00Z' }])
  assert.equal(state.items.find(row => row.id === ideaR.target).status, 'outline')
  // 已排期的素材状态由用户与排期决定,不再由成稿产物推出来
  assert.equal(done.status, 'outline')
  applyOps(state, [{ op: 'set_status', id: doneR.target, status: 'draft' }])
  assert.equal(done.status, 'ready', '已排期的草稿自愈成待发布')
  applyOps(state, [{ op: 'schedule_item', id: doneR.target, scheduledAt: null }])
  assert.equal(done.status, 'draft')
  // 「已发布」不是素材阶段:写进去自愈回草稿,发布只落在作品上
  applyOps(state, [{ op: 'update_item', id: doneR.target, status: 'published' }])
  assert.equal(done.status, 'draft')
  assert.equal(done.publishedAt, undefined)
  assert.equal(work.target, state.works[0].id)
  const [media] = applyOps(state, [{ op: 'add_item', kind: 'image', media: { src: 'writing-desk/files/x.png' } }]).receipts
  assert.match(state.items.find(row => row.id === media.target).title, /的图片$/)
})


test('撤销只撤回那一步：之后生成的成稿和画好的图不受影响', async () => {
  const { Store, revertChange } = await import('../src/store.js')
  const dir = await mkdtemp(join(tmpdir(), 'md-undo-'))
  try {
    const store = new Store(dir)
    const state = await store.read()
    const id = state.items[0].id
    // 1. 切换风格（可撤销）
    await store.mutate('切换风格', (draft) => { draft.activeStyleId = 'preset_travel' })
    // 2. 之后开始成稿（不可撤销的后台写入）
    await store.mutate('成稿', (draft) => { draft.works = [{ id: 'w_1', sourceItemIds: [id], current: { title: '原标题', images: [{ no: 1, prompt: 'a', status: 'done', src: 'old.png' }], rev: 0 }, publication: { status: 'draft' } }] }, { undoable: false })
    // 3. 对话改了标题和第 1 镜的画面（可撤销）
    await store.mutate('对话', (draft) => { const p = draft.works[0].current; p.title = '新标题'; p.images[0].prompt = 'b'; p.images[0].status = 'running' })
    // 4. 第 1 镜重画完成（不可撤销）
    await store.mutate('成稿', (draft) => { const pic = draft.works[0].current.images[0]; pic.status = 'done'; pic.src = 'new.png' }, { undoable: false })

    assert.equal(await store.undoLast(), '对话')
    let p = (await store.read()).works[0].current
    assert.equal(p.title, '原标题')
    assert.equal(p.images[0].prompt, 'a')
    assert.equal(p.images[0].src, 'new.png')
    assert.equal(p.images[0].status, 'done')

    assert.equal(await store.undoLast(), '切换风格')
    const after = await store.read()
    assert.equal(after.activeStyleId, null)
    p = after.works[0].current
    assert.equal(p.title, '原标题', '撤销切换风格不能抹掉作品')

    // 什么都没改的操作不进撤销栈
    await store.mutate('空操作', () => {})
    assert.equal(store.undo.length, 0)

    // 新增和删除也能撤回，删掉的行回到原位
    const removed = after.items[1]
    await store.mutate('删除', (draft) => { draft.items.splice(1, 1) })
    await store.mutate('新增', (draft) => { draft.items.unshift({ id: 'new_1', title: '新灵感' }) })
    await store.undoLast()
    await store.undoLast()
    const back = await store.read()
    assert.equal(back.items.some(row => row.id === 'new_1'), false)
    assert.equal(back.items[1].id, removed.id)

    assert.deepEqual(revertChange({ a: 1 }, { a: 2 }, { a: 3 }), { a: 3 }, '之后又被改过就保留现在的值')
  } finally {
    await rm(dir, { recursive: true })
  }
})

test('状态规则：发布时间只属于作品、排期与取消排期、清空示例不留悬空数据', () => {
  const state = seed()
  const [r] = applyOps(state, [{ op: 'add_item', title: '只有灵感' }]).receipts
  const item = state.items.find(row => row.id === r.target)
  applyOps(state, [{ op: 'schedule_item', id: item.id, scheduledAt: '2026-12-01T12:00:00Z' }])
  assert.equal(item.status, 'outline')
  applyOps(state, [{ op: 'schedule_item', id: item.id, scheduledAt: null }])
  assert.equal(item.status, 'idea', '没成稿的灵感取消排期回到灵感')
  // 素材不再承载发布状态:写 published 自愈回草稿,也不会记发布时间(见 ADR 0013)
  applyOps(state, [{ op: 'update_item', id: item.id, status: 'published' }])
  assert.equal(item.status, 'draft')
  assert.equal(item.publishedAt, undefined, '素材上没有发布时间')
  // 发布时间落在作品的发布稿上
  const [work] = applyOps(state, [{ op: 'create_work', itemIds: [item.id] }]).receipts
  applyOps(state, [{ op: 'update_work', id: work.target, rev: 0, title: '标题', article: '正文' }])
  applyOps(state, [{ op: 'publish_work', id: work.target }])
  const row = state.works.find(workRow => workRow.id === work.target)
  assert.equal(row.publication.status, 'published')
  assert.ok(row.publication.publishedAt, '发布作品记发布时间')
  const sample = state.items.find(row => row.sample)
  const [child] = applyOps(state, [{ op: 'add_item', title: '挂在示例下面', parentId: sample.id }]).receipts
  applyOps(state, [{ op: 'clear_samples' }])
  assert.equal(state.items.find(row => row.id === child.target).parentId, null)
})


test('参考内容：风格卡只留六个样句,写作要求带上逻辑与衔接', () => {
  const state = seed()
  const { receipts } = applyOps(state, [{ op: 'add_style', name: '我', logic: '先讲反例', story: '从一件小事讲起', flow: '用「然后呢」接', samples: ['一', '二', '三', '四', '五', '六'] }])
  const style = state.styles.find(row => row.id === receipts[0].target)
  assert.equal(style.samples.length, 6)
  const voice = styleToVoice(style)
  assert.match(voice, /逻辑：先讲反例/)
  assert.match(voice, /衔接：用「然后呢」接/)
  assert.match(voice, /样句（学节奏，不要照抄）/)
  applyOps(state, [{ op: 'set_style', id: receipts[0].target }])
  assert.equal(activeStyle(state).logic, '先讲反例')
})
