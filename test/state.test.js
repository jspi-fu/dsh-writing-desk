// 状态机 reducer 的模块层测试:共享谓词口径 + 四个历史不一致场景。
// 与 host.test.js 同一层:只直接调用领域模块,不启 HTTP、不渲染 UI。
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import { EVENTS, isDrafted, isScheduled, panelState, reduce } from '../src/state.js'
import { migrateState } from '../src/seed.js'

const NOW = '2026-11-17T10:00:00.000Z'

function item(overrides = {}) {
  return { id: 'it_1', kind: 'note', title: '测试灵感', body: '', tags: [], status: 'idea', createdAt: NOW, scheduledAt: null, ...overrides }
}

// 事件时间一律显式携带,断言不依赖真实时钟。
function run(entry, event) {
  return reduce({ items: [entry] }, { id: entry.id, at: NOW, ...event })
}

test('state.js 零依赖,Host 与 Client(经 esbuild 打包)都能直接引用', () => {
  const source = readFileSync(new URL('../src/state.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /^\s*(import\s|export\s+.+\sfrom\s|require\()/m)
})

// 遗留口径清理(工单 #7):双轨写法不许回来——手写稿 op 与旧的状态推演函数已下线,
// 草稿字段的任何读写(取属性、赋值、键名、字面量)都算残留;文案里的「草稿」一词不算。
test('src/ 内不再有旧状态口径的残留', () => {
  for (const file of readdirSync(new URL('../src/', import.meta.url))) {
    if (!file.endsWith('.js')) continue
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /save_draft|applyStatus|applySchedule/, `${file} 还有旧状态推演的残留`)
    assert.doesNotMatch(source, /\bdrafts\s*(\??\.|\[)|\bdrafts\s*[:=]|['"]drafts\b/, `${file} 还有遗留草稿字段的残留`)
  }
})

test('状态机事件:会话写回 submit 与人工改稿 editProduction,加排期与发布(ADR 0006)', () => {
  assert.deepEqual(EVENTS, ['submit', 'editProduction', 'schedule', 'unschedule', 'setStatus', 'publish'])
})

// 遗留草稿字段的存量清除(工单 #7):旧数据里读到就无害删键,不进任何判断。
test('migrateState 无害清除旧数据里的遗留草稿字段', () => {
  const state = { items: [{ id: 'it_old', title: '旧数据', drafts: { article: { text: '旧手写稿', by: 'user' } } }] }
  migrateState(state)
  assert.equal(state.items[0].drafts, undefined)
  assert.equal(state.items[0].title, '旧数据')
})

test('成稿口径只有一份:成稿产物算数,遗留草稿字段不再参与判断', () => {
  const aiDone = item({ status: 'draft', production: { status: 'done', article: '模型写的正文' } })
  assert.equal(isDrafted(aiDone), true)
  assert.equal(panelState(aiDone), 'drafted')
  assert.equal(isScheduled(aiDone), false)
  // 旧的手写稿字段已下线(存量数据由 migrateState 清除):就算旧数据里还带着,也不算成稿
  const legacy = item({ drafts: { article: { text: '我自己写的正文', by: 'user' } } })
  assert.equal(isDrafted(legacy), false)
  assert.equal(panelState(legacy), 'idea')
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
})

test('会话写回:没有产物就建一份,灵感推进成草稿,已排期的推进成待发布', () => {
  const fresh = item()
  run(fresh, { type: 'submit', article: '会话写回的正文', title: '会话定的标题' })
  assert.equal(fresh.production.status, 'done')
  assert.equal(fresh.production.article, '会话写回的正文')
  assert.equal(fresh.production.title, '会话定的标题')
  assert.equal(fresh.production.engine, 'harness')
  assert.equal(fresh.production.aiArticle, '会话写回的正文', 'AI 快照就是会话刚写的版本')
  assert.equal(fresh.production.rev, 1)
  assert.equal(fresh.status, 'draft')
  assert.equal(isDrafted(fresh), true)
  assert.equal(panelState(fresh), 'drafted')
  const planned = item({ scheduledAt: '2026-12-01T10:00:00.000Z', sentToSession: { at: NOW } })
  run(planned, { type: 'submit', article: '正文' })
  assert.equal(planned.status, 'ready')
  assert.equal(planned.sentToSession, undefined, '写回清掉交会话的登记(相位推进)')
})

test('会话写回落内容快照并带阶段说明,重复写回 rev 前进、覆盖人工修改前先有快照', () => {
  const wrote = item({ status: 'draft', production: { status: 'done', article: '人工改过的正文', rev: 3, snapshots: [{ at: '2026-11-10T00:00:00.000Z', by: 'user', article: '人工改过的正文' }] } })
  run(wrote, { type: 'submit', article: '会话的新版本', note: '按反馈润色' })
  assert.equal(wrote.production.article, '会话的新版本')
  assert.equal(wrote.production.aiArticle, '会话的新版本')
  assert.equal(wrote.production.rev, 4)
  const snapshots = wrote.production.snapshots
  assert.equal(snapshots.length, 2)
  assert.equal(snapshots[1].by, 'session')
  assert.equal(snapshots[1].note, '按反馈润色')
  assert.equal(snapshots[1].article, '会话的新版本', '快照带内容,校样浮层可回退')
})

test('只写部分字段时,其余字段与来历原样保留', () => {
  const wrote = item({
    status: 'draft',
    production: {
      status: 'done', article: '已有正文', aiArticle: '已有AI原稿', engine: 'harness',
      title: '旧标题', cover: { src: 'writing-desk/files/c.png', status: 'done' }, images: [{ src: 'writing-desk/files/a.png', status: 'done' }],
      savedPath: '~/导出/稿子', savedHashes: { '文章.md': 'h1' },
    },
  })
  run(wrote, { type: 'submit', title: '新标题' })
  assert.equal(wrote.production.title, '新标题')
  assert.equal(wrote.production.article, '已有正文')
  assert.equal(wrote.production.aiArticle, '已有AI原稿', '没写正文就不动 AI 快照')
  assert.equal(wrote.production.engine, 'harness')
  assert.equal(wrote.production.savedPath, '~/导出/稿子')
  assert.deepEqual(wrote.production.cover, { src: 'writing-desk/files/c.png', status: 'done' })
  assert.equal(wrote.production.images.length, 1)
})

test('写回可带意图单、审读报告与配图清单', () => {
  const fresh = item()
  run(fresh, {
    type: 'submit',
    article: '正文',
    intent: { purpose: '立观点', status: 'confirmed' },
    review: { findings: [{ axis: 'standards', severity: 'P1', location: '第 2 段', quote: '原文', suggestion: '删掉补分析' }] },
    images: [{ src: 'writing-desk/files/a.png', caption: '配图', anchor: '为什么' }],
    cover: { src: 'writing-desk/files/c.png', caption: '封面字' },
  })
  assert.deepEqual(fresh.production.intent, { purpose: '立观点', status: 'confirmed' })
  assert.equal(fresh.production.review.findings.length, 1)
  assert.equal(fresh.production.images[0].anchor, '为什么')
  assert.equal(fresh.production.cover.src, 'writing-desk/files/c.png')
  assert.equal(fresh.production.images[0].status, 'done')
})

// 人工改稿经 editProduction(update_production 的 reducer 事件):写完照常自愈,
// 直写 production 不经 reducer 的旧缺口(改完不自愈)由此关闭。
test('人工清空正文:不再算已成稿,状态由自愈按未成稿的事实裁决', () => {
  // 已取消的成稿留有正文(白等一场不丢稿的那份),未排期:清空后不算已成稿,
  // 手动标过的草稿被自愈尊重,面板口径退回灵感
  const plain = item({ status: 'draft', production: { status: 'cancelled', article: '取消成稿留下的正文' } })
  run(plain, { type: 'editProduction', article: '' })
  assert.equal(plain.production.article, '')
  assert.equal(isDrafted(plain), false)
  assert.equal(plain.status, 'draft')
  assert.equal(panelState(plain), 'idea')
  // 排期里的:清空后排期还在,待发布按「已排期未成稿」的口径由自愈维持
  const planned = item({ scheduledAt: '2026-12-01T10:00:00.000Z', status: 'ready', production: { status: 'cancelled', article: '取消成稿留下的正文' } })
  run(planned, { type: 'editProduction', article: '' })
  assert.equal(isDrafted(planned), false)
  assert.equal(planned.status, 'ready')
  assert.equal(panelState(planned), 'scheduled')
})

test('人工补写正文:自愈向前推进,排期里没写稿的大纲当场待发布', () => {
  // 旧实现直写 production.article 不经 reducer,这条大纲会一直冒充「没写稿」
  const outlined = item({ scheduledAt: '2026-12-01T10:00:00.000Z', status: 'outline', production: { status: 'cancelled', article: '' } })
  run(outlined, { type: 'editProduction', article: '排期里补写的正文' })
  assert.equal(isDrafted(outlined), true)
  assert.equal(outlined.status, 'ready')
  assert.equal(panelState(outlined), 'drafted')
})

test('人工改稿不动 AI 原稿快照:aiArticle 只由会话写回产生,rev 前进并落用户快照', () => {
  const wrote = item({ status: 'draft', production: { status: 'done', article: '改过的正文', aiArticle: 'AI 原稿', engine: 'harness', rev: 1 } })
  run(wrote, { type: 'editProduction', title: '人工定的标题', coverText: '封面文案', article: '再改一次的正文' })
  assert.equal(wrote.production.title, '人工定的标题')
  assert.equal(wrote.production.coverText, '封面文案')
  assert.equal(wrote.production.article, '再改一次的正文')
  assert.equal(wrote.production.aiArticle, 'AI 原稿', '手改不许冲掉 AI 原稿快照')
  assert.equal(wrote.production.rev, 2)
  const snapshots = wrote.production.snapshots
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].by, 'user')
  assert.equal(snapshots[0].article, '再改一次的正文')
  // 没给的字段一个都不动;没有成稿产物的人工改稿直接报错
  run(wrote, { type: 'editProduction' })
  assert.equal(wrote.production.title, '人工定的标题')
  assert.throws(() => run(item(), { type: 'editProduction', article: '正文' }), /还没有成稿/)
})

test('快照最多留十份,旧的先出去', () => {
  const wrote = item({ status: 'draft', production: { status: 'done', article: 'v0' } })
  for (let i = 1; i <= 12; i++) run(wrote, { type: 'editProduction', article: `v${i}` })
  assert.equal(wrote.production.snapshots.length, 10)
  assert.equal(wrote.production.snapshots[0].article, 'v3')
  assert.equal(wrote.production.snapshots[9].article, 'v12')
  assert.equal(wrote.production.rev, 12)
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

test('取消排期:没成稿的大纲退回灵感(沿用旧 applySchedule 的推演)', () => {
  const planned = item({ status: 'outline', scheduledAt: '2026-12-01T10:00:00.000Z' })
  run(planned, { type: 'unschedule' })
  assert.equal(planned.scheduledAt, null)
  assert.equal(planned.status, 'idea')
  // 已成稿的取消排期留草稿,不退灵感
  const wrote = item({ status: 'ready', scheduledAt: '2026-12-01T10:00:00.000Z', production: { status: 'done', article: '正文' } })
  run(wrote, { type: 'unschedule' })
  assert.equal(wrote.status, 'draft')
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

test('一条灵感从会话写回到发布的整个生命周期,每个节点面板口径一致', () => {
  const entry = item({ sentToSession: { at: NOW } })
  run(entry, { type: 'submit', article: '正文', engine: 'harness' })
  assert.equal(isDrafted(entry), true)
  assert.equal(panelState(entry), 'drafted')
  assert.equal(entry.status, 'draft')
  run(entry, { type: 'schedule', scheduledAt: '2026-12-01T10:00:00.000Z' })
  assert.equal(entry.status, 'ready')
  assert.equal(isScheduled(entry), true)
  run(entry, { type: 'publish' })
  assert.equal(panelState(entry), 'published')
  assert.equal(entry.publishedAt, NOW)
})
