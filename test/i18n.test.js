import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { currentLang, tr, withLang } from '../src/i18n.js'
import { applyOps } from '../src/ops.js'
import { buildSeed, localizeSamples, migrateState, samplesNeedLocale } from '../src/seed.js'
import { Store } from '../src/store.js'
import plugin from '../src/host.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')
const CJK = /[一-鿿]/
const clone = value => JSON.parse(JSON.stringify(value))

test('tr：中文原样返回，英文查表并填占位符，查不到时退回原文', () => {
  assert.equal(currentLang(), 'zh')
  assert.equal(tr('把《{title}》排到 {when}', { title: '慢写', when: '11月3日 20:00' }), '把《慢写》排到 11月3日 20:00')
  withLang('en', () => {
    assert.equal(currentLang(), 'en')
    assert.equal(tr('把《{title}》排到 {when}', { title: 'Slow writing', when: 'Nov 3 20:00' }), 'Scheduled "Slow writing" for Nov 3 20:00')
    assert.equal(tr('还没有保存过'), 'Not saved yet')
    assert.equal(tr('词典里没有的一句'), '词典里没有的一句')
    assert.equal(tr('《{title}》状态改为「{status}」', { title: 'X', status: '待发布' }), 'Moved "X" to 待发布')
  })
  assert.equal(withLang('en-US', currentLang), 'en')
  assert.equal(withLang('zh-CN', currentLang), 'zh')
  assert.equal(withLang(undefined, currentLang), 'zh')
})

test('英文请求下生成英文示例，结构和中文版完全一致', async () => {
  const zh = buildSeed(NOW, 'zh')
  const en = withLang('en', () => buildSeed(NOW))
  assert.equal(zh.sampleLang, 'zh')
  assert.equal(en.sampleLang, 'en')
  assert.deepEqual(en.items.map(row => [row.id, row.kind, row.status, row.platform, row.scheduledAt, row.media?.src ?? null]), zh.items.map(row => [row.id, row.kind, row.status, row.platform, row.scheduledAt, ({ seed_7: 'writing-desk/assets/poster-en.jpg', seed_20: 'writing-desk/assets/emboss-en.jpg' })[row.id] ?? row.media?.src ?? null]))
  // 图上印着中文的那张，英文版换成英文图；切回中文换回来
  const back = localizeSamples(structuredClone(en), 'zh')
  assert.equal(back.items.find(row => row.id === 'seed_7').media.src, 'writing-desk/assets/poster.jpg')
  assert.deepEqual(en.styles.map(row => [row.id, row.category, row.icon]), zh.styles.map(row => [row.id, row.category, row.icon]))
  for (const row of en.items) for (const field of ['title', 'body', 'source', ...row.tags]) assert.ok(!CJK.test(field in row ? row[field] : field), `${row.id} ${field}`)
  for (const key of ['people', 'angles', 'skills']) assert.ok(!CJK.test(JSON.stringify(en[key])), key)
  for (const row of en.styles) assert.ok(!CJK.test(JSON.stringify({ ...row, category: '' })), row.id)

  // Store 在请求里第一次建库时也按请求语言写示例
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-'))
  try {
    const state = await withLang('en', () => new Store(dir).read())
    assert.equal(state.sampleLang, 'en')
    assert.equal(state.items[0].title, en.items[0].title)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('localizeSamples：中英来回切换只换示例文字，用户内容和改过的地方不动', () => {
  const state = buildSeed(NOW, 'zh')
  const original = clone(state)
  const [mine] = applyOps(state, [{ op: 'add_item', title: '我自己的灵感', body: '只属于我' }]).receipts
  applyOps(state, [
    { op: 'set_status', id: 'seed_2', status: 'published' },
    { op: 'update_item', id: 'seed_3', title: '我改过的标题' },
    { op: 'update_style', id: 'preset_news', tone: '我自己的语气' },
    { op: 'add_style', name: '我的风格', tone: '原样' },
  ])
  const before = clone(state)

  assert.equal(samplesNeedLocale(state, 'en'), true)
  assert.equal(samplesNeedLocale(state, 'zh'), false)
  localizeSamples(state, 'en')
  assert.equal(state.sampleLang, 'en')
  assert.equal(samplesNeedLocale(state, 'en'), false)
  const item = id => state.items.find(row => row.id === id)
  assert.equal(item(mine.target).title, '我自己的灵感')
  assert.equal(item(mine.target).body, '只属于我')
  assert.ok(!CJK.test(item('seed_1').title))
  assert.equal(item('seed_2').status, 'draft', '素材不承载发布状态')
  assert.equal(item('seed_2').publishedAt, undefined)
  // 中文标题先收起来，英文下显示英文示例
  assert.ok(!CJK.test(item('seed_2').title))
  assert.ok(!CJK.test(item('seed_3').title))
  assert.ok(!CJK.test(item('seed_3').body))
  const news = state.styles.find(row => row.id === 'preset_news')
  assert.equal(news.tone, '我自己的语气')
  assert.ok(!CJK.test(news.name))
  assert.equal(news.category, '热点资讯')
  assert.equal(state.styles.find(row => row.name === '我的风格').tone, '原样')
  assert.equal(state.people.find(row => row.id === 'newbie').role, 'Target reader')

  // 重复调用不再改动
  const once = JSON.stringify(state)
  localizeSamples(state, 'en')
  assert.equal(JSON.stringify(state), once)

  // 切回中文，回到切换前的样子
  localizeSamples(state, 'zh')
  const withoutStash = clone(state)
  for (const row of withoutStash.items) delete row.otherLang
  assert.deepEqual(withoutStash, { ...before, sampleLang: 'zh' })
  // 英文那份也留着：在英文下改过的内容切回英文还在
  localizeSamples(state, 'en')
  item('seed_4').title = 'My English edit'
  localizeSamples(state, 'zh')
  assert.equal(item('seed_4').title, original.items[3].title)
  localizeSamples(state, 'en')
  assert.equal(item('seed_4').title, 'My English edit')
  localizeSamples(state, 'zh')
  assert.equal(item('seed_1').title, original.items[0].title)
})

test('localizeSamples：清空示例后只换内置预设；旧数据没有 sampleLang 时当作中文', () => {
  const state = buildSeed(NOW, 'zh')
  applyOps(state, [{ op: 'add_item', title: '我的' }, { op: 'clear_samples' }])
  localizeSamples(state, 'en')
  assert.deepEqual(state.items.map(row => row.title), ['我的'])
  assert.ok(state.styles.every(row => !CJK.test(row.name)))
  localizeSamples(state, 'zh')
  assert.ok(state.styles.every(row => CJK.test(row.name)))

  const old = buildSeed(NOW, 'zh')
  delete old.sampleLang
  assert.equal(samplesNeedLocale(old, 'zh'), false)
  assert.equal(migrateState(old).sampleLang, 'zh')
  const legacy = migrateState({ items: [], people: [], angles: [], skills: [] })
  assert.equal(legacy.sampleLang, 'zh')
  localizeSamples(legacy, 'en')
  assert.ok(legacy.styles.length > 0 && legacy.styles.every(row => !CJK.test(row.name)))
})

test('GET state 按请求头的语言换示例文字', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    let handler = null
    const ctx = {
      get: name => (name === 'connection' ? { requestRejection: () => undefined } : undefined),
      effect: (fn, name) => { if (!name?.includes('nm pairing')) fn() },
      webServer: { register: (options) => { handler = options.handler } },
    }
    plugin.apply(ctx)
    const get = lang => new Promise((resolve) => {
      const res = { statusCode: 0, headersSent: false, setHeader() {}, end: body => resolve({ status: res.statusCode, body: JSON.parse(body) }) }
      handler({ url: '/writing-desk/state', method: 'GET', headers: { 'x-writing-desk-lang': lang } }, res)
    })
    const zh = await get('zh')
    assert.equal(zh.status, 200)
    assert.equal(zh.body.state.sampleLang, 'zh')
    const en = await get('en')
    assert.equal(en.body.state.sampleLang, 'en')
    assert.ok(!CJK.test(en.body.state.items[0].title))
    assert.equal(en.body.canUndo, false, '换语言不占撤销位')
    const back = await get('zh')
    assert.equal(back.body.state.items[0].title, zh.body.state.items[0].title)
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('旧的英文数据：示例上残留的中文成稿迁成作品，切回中文还在', () => {
  const state = buildSeed(NOW, 'en')
  const row = state.items.find(item => item.id === 'seed_1')
  delete row.otherLang
  row.production = { status: 'done', title: '中文成稿', article: '正文' }
  const mine = { id: 'it_mine', title: '我的中文灵感', drafts: {} }
  state.items.push(mine)
  migrateState(state)
  assert.equal(row.production, undefined)
  assert.ok(!CJK.test(row.title))
  assert.equal(mine.title, '我的中文灵感')
  const work = state.works.find(workRow => workRow.sourceItemIds.includes('seed_1'))
  assert.equal(work.current.title, '中文成稿', '旧成稿迁成作品')
  localizeSamples(state, 'zh')
  assert.equal(work.current.title, '中文成稿', '作品不是示例文字，切语言不动')
})

