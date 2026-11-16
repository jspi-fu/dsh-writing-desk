// 状态机 reducer 的模块层测试:共享谓词口径 + 四个历史不一致场景。
// 与 host.test.js 同一层:只直接调用领域模块,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { EVENTS, isDrafted, isScheduled, panelState, reduce } from '../src/state.js'

const NOW = '2026-11-17T10:00:00.000Z'

function item(overrides = {}) {
  return { id: 'it_1', kind: 'note', title: '测试灵感', body: '', tags: [], status: 'idea', createdAt: NOW, drafts: {}, scheduledAt: null, ...overrides }
}

// 事件时间一律显式携带,断言不依赖真实时钟。
function run(entry, event) {
  return reduce({ items: [entry] }, { id: entry.id, at: NOW, ...event })
}

test('state.js 零依赖,Host 与 Client(经 esbuild 打包)都能直接引用', () => {
  const source = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*(import\s|export\s+.+\sfrom\s|require\()/m)
})

test('状态机事件就是 spec 定下的九个', () => {
  assert.deepEqual(EVENTS, ['start', 'articleWritten', 'done', 'fail', 'cancel', 'schedule', 'unschedule', 'setStatus', 'publish'])
})

test('手动写的稿与 AI 生成稿在谓词口径上一致', () => {
  const aiDone = item({ status: 'draft', production: { status: 'done', article: '模型写的正文' } })
  const manualArticle = item({ drafts: { article: { text: '我自己写的正文', by: 'user' } } })
  const manualScript = item({ drafts: { script: { text: '我自己写的口播稿', by: 'user' } } })
  for (const wrote of [aiDone, manualArticle, manualScript]) {
    assert.equal(isDrafted(wrote), true)
    assert.equal(panelState(wrote), 'drafted')
    assert.equal(isScheduled(wrote), false)
  }
  const bare = item()
  assert.equal(isDrafted(bare), false)
  assert.equal(panelState(bare), 'idea')
})

test('已成稿的条目手动改回灵感,自愈对齐回草稿', () => {
  const wrote = item({ production: { status: 'done', article: '正文' } })
  assert.equal(run(wrote, { type: 'setStatus', status: 'idea' }).status, 'draft')
})

test('已排期且已成稿的条目手动改回灵感,自愈对齐回待发布', () => {
  const wrote = item({ scheduledAt: '2026-12-01T10:00:00.000Z', production: { status: 'done', article: '正文' } })
  assert.equal(run(wrote, { type: 'setStatus', status: 'idea' }).status, 'ready')
})

test('手动写的稿同样受自愈保护,不会被标回灵感', () => {
  const manual = item({ drafts: { article: { text: '我自己写的正文', by: 'user' } } })
  assert.equal(run(manual, { type: 'setStatus', status: 'idea' }).status, 'draft')
})

test('没成稿但已排期的条目标灵感,自愈对齐成大纲(已进排期流程)', () => {
  const planned = item({ scheduledAt: '2026-12-01T10:00:00.000Z' })
  assert.equal(run(planned, { type: 'setStatus', status: 'idea' }).status, 'outline')
})

test('没成稿的条目可以手动标草稿,但没排期的待发布自愈退回草稿', () => {
  assert.equal(run(item(), { type: 'setStatus', status: 'draft' }).status, 'draft')
  assert.equal(run(item({ status: 'ready' }), { type: 'setStatus', status: 'ready' }).status, 'draft')
})

test('手动撤掉发布:发布时间清掉,已成稿且未排期的退回草稿', () => {
  const wrote = item({ status: 'published', publishedAt: '2026-11-01T00:00:00.000Z', production: { status: 'done', article: '正文' } })
  assert.equal(run(wrote, { type: 'setStatus', status: 'draft' }).status, 'draft')
  assert.equal(wrote.publishedAt, undefined)
})

test('无效状态、未知事件、找不到的灵感都直接报错', () => {
  assert.throws(() => run(item(), { type: 'setStatus', status: 'nope' }), /状态无效/)
  assert.throws(() => run(item(), { type: 'rewind' }), /不支持的状态事件/)
  assert.throws(() => reduce({ items: [] }, { type: 'setStatus', status: 'idea', id: 'nope' }), /找不到这条灵感/)
  assert.throws(() => run(item(), { type: 'cancel' }), /还没有成稿/)
})

test('成稿取消后,已写好的正文保留,谓词仍说已成稿', () => {
  const wrote = item({
    status: 'draft',
    production: { status: 'running', stage: 'making', article: '已经落盘的正文', cover: { status: 'pending' }, images: [{ status: 'running' }], shots: [{ status: 'done' }] },
  })
  assert.equal(panelState(wrote), 'producing')
  run(wrote, { type: 'cancel' })
  assert.equal(wrote.production.status, 'cancelled')
  assert.equal(wrote.production.stage, 'done')
  assert.equal(wrote.production.error, null)
  assert.equal(wrote.production.article, '已经落盘的正文')
  assert.equal(wrote.production.cover.status, 'idle')
  assert.equal(wrote.production.images[0].status, 'idle')
  assert.equal(wrote.production.shots[0].status, 'done')
  assert.equal(isDrafted(wrote), true)
  assert.equal(panelState(wrote), 'drafted')
})

test('成稿失败同样保留正文,错误信息留给用户看', () => {
  const wrote = item({ status: 'draft', production: { status: 'running', article: '已经落盘的正文' } })
  run(wrote, { type: 'fail', error: '模型超时' })
  assert.equal(wrote.production.status, 'failed')
  assert.equal(wrote.production.error, '模型超时')
  assert.equal(wrote.production.article, '已经落盘的正文')
  assert.equal(isDrafted(wrote), true)
})

test('重新成稿不清空上一次写好的正文,画面清零等这一轮重画', () => {
  const wrote = item({
    status: 'draft',
    production: {
      status: 'done', stage: 'done', finishedAt: '2026-11-10T00:00:00.000Z', article: '上一篇正文', aiArticle: '上一篇AI原稿', engine: 'deepseek', notice: null,
      savedPath: '~/导出/稿子', savedHashes: { '脚本.md': 'h1' }, cover: { status: 'done' }, images: [{ status: 'done' }], shots: [{ status: 'done' }],
    },
  })
  run(wrote, { type: 'start', withImages: true, format: 'article' })
  assert.equal(wrote.production.status, 'running')
  assert.equal(wrote.production.stage, 'brief')
  assert.equal(wrote.production.startedAt, NOW)
  assert.equal(wrote.production.format, 'article')
  assert.equal(wrote.production.withImages, true)
  assert.equal(wrote.production.title, '测试灵感')
  // 重试不毁稿:正文和它的来历(AI 原稿、引擎)都还在
  assert.equal(wrote.production.article, '上一篇正文')
  assert.equal(wrote.production.aiArticle, '上一篇AI原稿')
  assert.equal(wrote.production.engine, 'deepseek')
  assert.equal(wrote.production.savedPath, '~/导出/稿子')
  assert.deepEqual(wrote.production.savedHashes, { '脚本.md': 'h1' })
  // 上一轮的画面不冒充这一轮的
  assert.equal(wrote.production.cover, null)
  assert.deepEqual(wrote.production.images, [])
  assert.deepEqual(wrote.production.shots, [])
  // 新一轮写出正文后原子替换
  run(wrote, { type: 'articleWritten', article: '新正文', engine: 'deepseek' })
  assert.equal(wrote.production.article, '新正文')
  assert.equal(wrote.production.aiArticle, '新正文')
  assert.equal(wrote.production.engine, 'deepseek')
})

test('重新成稿后又取消,上一篇正文还在', () => {
  const wrote = item({ status: 'draft', production: { status: 'done', article: '上一篇正文' } })
  run(wrote, { type: 'start' })
  run(wrote, { type: 'cancel' })
  assert.equal(wrote.production.status, 'cancelled')
  assert.equal(wrote.production.article, '上一篇正文')
  assert.equal(isDrafted(wrote), true)
})

test('正文落盘即成稿:灵感推进成草稿,已排期的推进成待发布', () => {
  const fresh = item()
  run(fresh, { type: 'start' })
  run(fresh, { type: 'articleWritten', article: '正文' })
  assert.equal(fresh.status, 'draft')
  assert.equal(isDrafted(fresh), true)
  const planned = item({ scheduledAt: '2026-12-01T10:00:00.000Z' })
  run(planned, { type: 'start' })
  run(planned, { type: 'articleWritten', article: '正文' })
  assert.equal(planned.status, 'ready')
})

test('成稿完成:产物定稿并记下完成时间,未排期的落回草稿', () => {
  const fresh = item()
  run(fresh, { type: 'start' })
  run(fresh, { type: 'done' })
  assert.equal(fresh.production.status, 'done')
  assert.equal(fresh.production.stage, 'done')
  assert.equal(fresh.production.finishedAt, NOW)
  assert.equal(fresh.status, 'draft')
  assert.equal(panelState(fresh), 'drafted')
})

test('排期与取消排期:已成稿的排上就是待发布,退回来就是草稿', () => {
  const wrote = item({ status: 'draft', production: { status: 'done', article: '正文' } })
  run(wrote, { type: 'schedule', scheduledAt: '2026-12-01T10:00:00.000Z' })
  assert.equal(wrote.scheduledAt, '2026-12-01T10:00:00.000Z')
  assert.equal(wrote.status, 'ready')
  assert.equal(isScheduled(wrote), true)
  run(wrote, { type: 'unschedule' })
  assert.equal(wrote.scheduledAt, null)
  assert.equal(wrote.status, 'draft')
  assert.equal(isScheduled(wrote), false)
})

test('没成稿的排上日历算大纲,不会冒充待发布', () => {
  const plain = item()
  run(plain, { type: 'schedule', scheduledAt: '2026-12-01T10:00:00.000Z' })
  assert.equal(plain.status, 'outline')
  assert.equal(isScheduled(plain), true)
})

test('发布:记下发布时间,已排期谓词让位,面板说已发布', () => {
  const wrote = item({ status: 'ready', scheduledAt: '2026-12-01T10:00:00.000Z', production: { status: 'done', article: '正文' } })
  run(wrote, { type: 'publish' })
  assert.equal(wrote.status, 'published')
  assert.equal(wrote.publishedAt, NOW)
  assert.equal(isScheduled(wrote), false)
  assert.equal(panelState(wrote), 'published')
})

test('排期时间无效直接报错', () => {
  assert.throws(() => run(item(), { type: 'schedule', scheduledAt: '不是日期' }), /排期时间无效/)
})

test('一条灵感从成稿到发布的整个生命周期,每个节点面板口径一致', () => {
  const entry = item()
  run(entry, { type: 'start', withImages: false, format: 'script' })
  assert.equal(panelState(entry), 'producing')
  run(entry, { type: 'articleWritten', article: '正文', engine: 'deepseek' })
  assert.equal(isDrafted(entry), true)
  assert.equal(panelState(entry), 'producing')
  run(entry, { type: 'done' })
  assert.equal(panelState(entry), 'drafted')
  assert.equal(entry.status, 'draft')
  run(entry, { type: 'schedule', scheduledAt: '2026-12-01T10:00:00.000Z' })
  assert.equal(entry.status, 'ready')
  assert.equal(isScheduled(entry), true)
  run(entry, { type: 'publish' })
  assert.equal(panelState(entry), 'published')
  assert.equal(entry.publishedAt, NOW)
})
