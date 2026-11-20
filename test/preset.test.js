// 创作模式 scope 隔离骨架(工单 #8 / ADR 0006):preset 声明、四个 harness 工具、
// 两个 skill provider 的静态结构断言与模块行为测试。与 client-wiring.test.js 同一形态:
// 读文件/读模块做纯文本与行为断言;真实 scope 可见性(cordis_inspect_query)属于实机验证阶段。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import * as tools from '../src/preset-tool.js'
import * as skills from '../src/preset-skill.js'
import hostPlugin from '../src/host.js'
import { buildSeed } from '../src/seed.js'
import { Store } from '../src/store.js'

const ROOT = new URL('../', import.meta.url)
const read = file => readFileSync(new URL(file, ROOT), 'utf8')
const PATCH = read('cordis.patch.yml')

// cordis.patch.yml 是「insert 行 + preset 声明」的 YAML。这里只需要断言行结构,
// 不引入 YAML 依赖:按「- id: xxx」行的缩进切块,块延伸到下一个同级行。
function patchBlocks(source) {
  const lines = source.split(/\r?\n/)
  const blocks = []
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)- (?:id: ([\w-]+)|insert:)/.exec(lines[i])
    if (!match) continue
    const indent = match[1].length
    const text = [lines[i]]
    let j = i + 1
    for (; j < lines.length; j += 1) {
      const next = /^(\s*)- /.exec(lines[j])
      if (next && next[1].length <= indent) break
      text.push(lines[j])
    }
    blocks.push({ id: match[2], text: `${text.join('\n')}\n` })
  }
  return blocks
}

function blockOf(blocks, id) {
  const block = blocks.find(row => row.id === id)
  assert.ok(block, `cordis.patch.yml 里没有 id 为 ${id} 的行`)
  return block
}

test('patch 同时插入全局工作台行与创作模式 preset 行,互不混淆', () => {
  const blocks = patchBlocks(PATCH)
  // 全局 UI 行:工作台侧栏全局注册,不带创作模式的 provider
  const desk = blockOf(blocks, 'writing-desk')
  assert.match(desk.text, /name: '?dsh-writing-desk'?/, '全局行必须挂 dsh-writing-desk 包')
  assert.doesNotMatch(desk.text, /preset-tool|preset-skill|agent-preset/, '全局行不得夹带创作模式的 tool/skill provider')
  // 创作模式 preset 行:Agent Preset 声明(dsh-agent-preset/skills/dsh-doc 的 compositions.md 与
  // dsh-web-app/presets/minimal.patch.yml 是同一写法的官方先例)
  const preset = blockOf(blocks, 'preset-writing')
  assert.match(preset.text, /name: '?@deepseek-ai\/dsh-agent-preset'?/, 'preset 行挂官方 dsh-agent-preset 声明插件')
  assert.match(preset.text, /config:/, 'preset 行带 config(id/name/plugins)')
  assert.match(preset.text, /id: writing\b/, 'config.id 是会话保存的模式标识(创作模式)')
  assert.match(preset.text, /plugins:/, 'preset 必须带 plugins 子列表')
})

test('preset 的 plugins 子项只有本插件两个 provider 与官方 skill 消费 tool', () => {
  const blocks = patchBlocks(PATCH)
  const preset = blockOf(blocks, 'preset-writing')
  const desk = blockOf(blocks, 'writing-desk')
  // 子项 name 引用本包子路径(profile 根 node_modules 解析,见 package.json exports)
  for (const name of ['dsh-writing-desk/preset-tool', 'dsh-writing-desk/preset-skill', '@deepseek-ai/dsh-tool-skill']) {
    const escaped = name.replace(/[/.]/g, '\\$&')
    assert.match(preset.text, new RegExp(`name: '?${escaped}'?`), `plugins 子项缺少 ${name}`)
    // 隔离铁律(工单 #55):provider 只出现在 preset 块里,不进任何全局行
    assert.doesNotMatch(desk.text, new RegExp(escaped), `${name} 混进了全局工作台行`)
  }
})

test('package.json exports 暴露两个 provider 子路径供 preset 子项引用', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.exports['./preset-tool'], './src/preset-tool.js')
  assert.equal(pkg.exports['./preset-skill'], './src/preset-skill.js')
})

// ---------- tool provider(src/preset-tool.js) ----------

const NOW = new Date('2026-10-31T15:00:00+08:00')

function seedState() {
  const state = buildSeed(NOW)
  applyOps(state, [{ op: 'add_capsule', name: '选题堆', itemIds: ['seed_1', 'seed_2'] }])
  return state
}

/** 假 ctx:tools 记录注册,writingDesk 返回给定 desk(与真实宿主一样经服务解析)。 */
function toolContext(desk) {
  const registered = []
  const ctx = {
    get: name => (name === 'writingDesk' ? desk : undefined),
    tools: { register: definition => registered.push(definition) },
  }
  return { ctx, registered }
}

test('tool provider 挂到 ctx.tools,注册读写与沉淀四个工具', () => {
  const { ctx, registered } = toolContext({ store: {} })
  tools.apply(ctx)
  assert.deepEqual(registered.map(row => row.name), ['writing_desk_read', 'writing_desk_write', 'writing_desk_add_rule', 'writing_desk_add_style'])
  for (const tool of registered) {
    assert.ok(typeof tool.description === 'string' && tool.description, '模型要能看到用途描述')
    assert.ok(tool.output && tool.output.schema && typeof tool.output.render === 'function', '注册契约:output { schema, render }')
    assert.equal(typeof tool.execute, 'function')
    assert.ok(tool.parameters && typeof tool.parameters === 'object')
  }
  // 插件本体是 preset 子项:inject 依赖 tools 与 writingDesk 服务,名字与 patch 子项 id 一致
  assert.deepEqual(tools.inject, ['tools', 'writingDesk'])
  assert.equal(tools.name, 'writing-desk-tools')
  // 旧的一键成稿工具不回来了:成稿发生在会话里,不再触发插件内置流水线
  assert.ok(!registered.some(row => row.name === 'writing_desk_produce'))
})

test('writing_desk_read:按 ID 与胶囊取全文,按 query 找相关,输出有界', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-tools-'))
  try {
    const store = new Store(dir)
    await store.read()
    await store.mutate('预置', draft => { applyOps(draft, [{ op: 'add_capsule', name: '选题堆', itemIds: ['seed_1', 'seed_2'] }]); return draft })
    const { ctx, registered } = toolContext({ store })
    tools.apply(ctx)
    const read = registered.find(row => row.name === 'writing_desk_read')
    // 按 ID 读全文,胶囊展开并带成员数;seed_1 已在胶囊里,归一去重后是两条
    const full = await read.execute({ itemIds: ['seed_1'], capsuleIds: [(await store.read()).capsules[0].id] })
    assert.equal(full.total, 2)
    assert.equal(full.items[0].id, 'seed_1')
    assert.ok(full.items[0].title)
    assert.deepEqual(full.capsules, [{ id: full.capsules[0].id, name: '选题堆', memberCount: 2 }])
    // query 模式:按标题找,带摘要
    const found = await read.execute({ query: 'AI' })
    assert.ok(found.total >= 1)
    assert.ok(found.items.every(row => row.id))
    // 空输入直接报错
    await assert.rejects(read.execute({}), /给 itemIds/)
    await assert.rejects(read.execute({ itemIds: ['missing'] }), /没有可用的灵感/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writing_desk_write:字段写回落库,rev 前进;冲突被拦下时错误里说清裁决去处', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-tools-'))
  try {
    const store = new Store(dir)
    await store.read()
    const { ctx, registered } = toolContext({ store })
    tools.apply(ctx)
    const write = registered.find(row => row.name === 'writing_desk_write')
    const read = registered.find(row => row.name === 'writing_desk_read')
    // 首次写回:rev 缺省视为一致,建产物、清交会话登记
    await store.mutate('交会话', draft => { applyOps(draft, [{ op: 'send_to_session', itemIds: ['seed_1'] }]); return draft })
    const first = await write.execute({ targetId: 'seed_1', title: '初稿标题', article: '# 初稿\n\n正文', intent: { purpose: '种草', status: 'confirmed' }, note: '初稿' })
    assert.equal(first.written, true)
    assert.equal(first.rev, 1)
    let state = await store.read()
    let target = state.items.find(row => row.id === 'seed_1')
    assert.equal(target.production.article, '# 初稿\n\n正文')
    assert.equal(target.sentToSession, undefined)
    assert.equal(target.status, 'draft')
    // 拿着旧 rev 再写回:409,错误说清去校样浮层裁决;pendingWrite 已暂存
    await assert.rejects(write.execute({ targetId: 'seed_1', rev: 0, article: '会话新版' }), /冲突.*校样浮层/s)
    state = await store.read()
    assert.equal(state.items.find(row => row.id === 'seed_1').production.pendingWrite.article, '会话新版')
    // 读一次拿到 rev 与产物概要(write 可写的字段都在,正文只给预览),按读到的 rev 续写就通过
    const fresh = await read.execute({ itemIds: ['seed_1'] })
    assert.equal(fresh.items[0].production.rev, 1)
    assert.equal(fresh.items[0].production.title, '初稿标题')
    assert.equal(fresh.items[0].production.existingDraft.text, '# 初稿\n\n正文')
    assert.equal(fresh.items[0].production.intent.purpose, '种草')
    const second = await write.execute({ targetId: 'seed_1', rev: fresh.items[0].production.rev, article: '定稿正文', note: '润色' })
    assert.equal(second.rev, 2)
    // 用户在浮层改过之后,会话按 read 拿基线再写:旧 rev 被拦下——闸门没有首写豁免(ADR 0008)
    await store.mutate('人工改稿', draft => { applyOps(draft, [{ op: 'update_production', id: 'seed_1', title: '人工标题' }]); return draft })
    const afterEdit = await read.execute({ itemIds: ['seed_1'] })
    assert.equal(afterEdit.items[0].production.rev, 3)
    assert.equal(afterEdit.items[0].production.title, '人工标题')
    await assert.rejects(write.execute({ targetId: 'seed_1', rev: 2, article: '又写一版' }), /冲突/)
    // 没有字段直接报错
    await assert.rejects(write.execute({ targetId: 'seed_1' }), /至少给一个/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('writing_desk_add_rule 以 proposed 落库等确认;add_style 写卡并设为当前', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-tools-'))
  try {
    const store = new Store(dir)
    await store.read()
    const { ctx, registered } = toolContext({ store })
    tools.apply(ctx)
    const addRule = registered.find(row => row.name === 'writing_desk_add_rule')
    const addStyle = registered.find(row => row.name === 'writing_desk_add_style')
    await addRule.execute({ name: '初稿写短些', rule: '你通常把初稿删到六成,以后控制得更紧凑。', evidence: '来自 3 次改稿' })
    let state = await store.read()
    const skill = state.skills.find(row => row.name === '初稿写短些')
    assert.equal(skill.status, 'proposed', '提案等用户确认,不直接生效')
    assert.equal(skill.source, '创作会话')
    // 名字与正文缺一不可
    await assert.rejects(addRule.execute({ name: '只有名字' }), /名字和正文/)
    await addStyle.execute({ name: '测试腔', summary: '短句、说人话', tone: '克制', words: ['那天', 3] })
    state = await store.read()
    const style = state.styles.find(row => row.name === '测试腔')
    assert.deepEqual(style.words, ['那天'])
    assert.equal(state.activeStyleId, style.id, '写完设为当前风格')
    await assert.rejects(addStyle.execute({}), /风格需要名字/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

// ---------- skill provider(src/preset-skill.js) ----------

/** 假 ctx:skills 记录 registerProvider 注册的 provider(writingDesk 同上)。 */
function skillContext(desk) {
  const providers = []
  const ctx = {
    get: name => (name === 'writingDesk' ? desk : undefined),
    skills: { registerProvider: create => providers.push(create({ signal: new AbortController().signal, invalidate() {} })) },
  }
  return { ctx, providers }
}

/** 带风格卡与规则的领域状态:一条生效、一条示例、一条提议(只有生效的进 skill)。 */
function styledState() {
  const state = seedState()
  applyOps(state, [{ op: 'add_style', name: '测试腔', summary: '短句、说人话', tone: '克制', avoid: ['陈词滥调'] }])
  // add_style 把新卡插到最前;set_style 的 id 必须等它跑完再取
  applyOps(state, [{ op: 'set_style', id: state.styles[0].id }])
  applyOps(state, [
    { op: 'add_skill', name: '首发平台', rule: '同一选题优先在一个平台首发。', status: 'active', evidence: '数据复盘' },
    { op: 'add_skill', name: '示例规则', rule: '示例不算风格。', status: 'active' },
    { op: 'add_skill', name: '还在提议', rule: '用户没确认的不算。', status: 'proposed' },
  ])
  const sample = state.skills.find(row => row.name === '示例规则')
  if (sample) sample.sample = true
  return state
}

test('skill provider 注册一次,给出 rules 与 craft 两个候选', async () => {
  const { ctx, providers } = skillContext({ store: { read: async () => seedState() } })
  skills.apply(ctx)
  assert.equal(providers.length, 1)
  const provider = providers[0]
  assert.equal(provider.name, 'writing-desk')
  assert.equal(typeof provider.list, 'function')
  assert.equal(typeof provider.get, 'function')
  assert.deepEqual(skills.inject, ['skills', 'writingDesk'])
  assert.equal(skills.name, 'writing-desk-rules')
  const candidates = await provider.list({})
  assert.deepEqual(candidates.map(row => row.name), ['writing-desk-rules', 'writing-desk-craft'])
  for (const candidate of candidates) {
    assert.ok(candidate.description)
    assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
    assert.equal(candidate.source, 'custom')
    assert.equal(candidate.provider, 'writing-desk')
  }
  // 未知候选返回 undefined,不硬塞内容
  assert.equal(await provider.get({ name: 'nope' }, {}), undefined)
})

test('rules skill get 读出实时规则与风格;示例与未确认的提议不进', async () => {
  const state = styledState()
  const { ctx, providers } = skillContext({ store: { read: async () => state } })
  skills.apply(ctx)
  const [provider] = providers
  const [candidate] = await provider.list({})
  const definition = await provider.get(candidate, {})
  assert.ok(definition && typeof definition.content === 'string')
  assert.match(definition.content, /测试腔/)
  assert.match(definition.content, /短句、说人话/)
  assert.match(definition.content, /同一选题优先在一个平台首发。/)
  assert.doesNotMatch(definition.content, /示例不算风格/)
  assert.doesNotMatch(definition.content, /用户没确认的不算/)
  // 规则是 get 时实时读的:写入新规则后,同一个 provider 立刻给出新正文
  applyOps(state, [{ op: 'add_skill', name: '新规则', rule: '标题要有动词。', status: 'active' }])
  const fresh = await provider.get(candidate, {})
  assert.match(fresh.content, /标题要有动词。/)
})

test('rules skill 没有风格与规则时仍在,正文说明去哪里沉淀', async () => {
  const state = seedState()
  const { ctx, providers } = skillContext({ store: { read: async () => state } })
  skills.apply(ctx)
  const [provider] = providers
  const [candidate] = await provider.list({})
  const empty = await provider.get(candidate, {})
  assert.ok(empty.content)
  assert.match(empty.content, /工作台|风格|规则/)
  assert.doesNotMatch(empty.content, /必须遵守的规则/)
})

test('craft skill 是静态写作法:意图单、声纹双向清单、审读双轴、润色四遍都在', async () => {
  const { ctx, providers } = skillContext({ store: { read: async () => seedState() } })
  skills.apply(ctx)
  const [provider] = providers
  const [, craft] = await provider.list({})
  assert.equal(craft.name, 'writing-desk-craft')
  const definition = await provider.get(craft, {})
  assert.match(definition.content, /意图单/)
  assert.match(definition.content, /不是问题/)
  assert.match(definition.content, /Standards 轴|Standards/)
  assert.match(definition.content, /Intent 轴|Intent/)
  assert.match(definition.content, /停下/)
  assert.match(definition.content, /小红书/)
  assert.match(definition.content, /公众号/)
  assert.match(definition.content, /知乎/)
  // 人工闸门写进条款:不许自动跑到底
  assert.match(definition.content, /不要自己一路跑到底|未经用户确认/)
})

// ---------- host 半片接线(src/host.js) ----------

test('host 半片发布 writingDesk 服务,preset 子插件经它拿到同一份 Store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-host-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const provided = {}
    const ctx = {
      get: () => undefined,
      effect: (fn, name) => { if (!name?.includes('nm pairing')) fn() },
      provide: (name, value) => { provided[name] = value },
      webServer: { register() {} },
    }
    hostPlugin.apply(ctx)
    const desk = provided.writingDesk
    assert.ok(desk, 'apply 之后必须已经 provide writingDesk 服务')
    assert.equal(typeof desk.store.read, 'function')
    assert.ok(desk.settings, 'settings 也在同一份服务里')
    assert.equal(desk.producer, undefined, '内置流水线退役,不再有 producer')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('全局半片不引创作模式的 provider 模块(不污染全局作用域)', () => {
  const host = read('src/host.js')
  assert.doesNotMatch(host, /preset-tool|preset-skill|writing_desk_produce/, 'host.js 不得 import 或注册创作模式 provider')
  // 浏览器半片同样不该碰它们:provider 只经 patch 子项在宿主进程加载
  for (const file of readdirSync(new URL('../client/', import.meta.url))) {
    if (!file.endsWith('.jsx') && !file.endsWith('.js')) continue
    const source = readFileSync(new URL(`../client/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /preset-tool|preset-skill/, `client/${file} 引用了创作模式 provider`)
  }
})
