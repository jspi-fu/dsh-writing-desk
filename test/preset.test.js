// 创作模式 scope 隔离骨架(工单 #8):preset 声明、tool provider、skill provider 的静态
// 结构断言与模块行为测试。与 client-wiring.test.js 同一形态:读文件/读模块做纯文本与
// 行为断言;真实 scope 可见性(cordis_inspect_query)属于实机验证阶段,不在自动化范围。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import * as produceTool from '../src/preset-tool.js'
import * as rulesSkill from '../src/preset-skill.js'
import { Producer } from '../src/produce.js'
import hostPlugin from '../src/host.js'
import { Settings } from '../src/settings.js'
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
  // 全局 UI 行(工单 #8:工作台侧栏仍全局注册,不在本单改动范围)
  const desk = blockOf(blocks, 'writing-desk')
  assert.match(desk.text, /name: '?dsh-writing-desk'?/, '全局行必须挂 dsh-writing-desk 包')
  assert.doesNotMatch(desk.text, /preset-tool|preset-skill|agent-preset/, '全局行不得夹带创作模式的 tool/skill provider')
  // 创作模式 preset 行:Agent Preset 声明(dsh-agent-preset/skills/dsh-doc 的 compositions.md 与
  // dsh-web-app/presets/minimal.patch.yml 是同一写法的官方先例)
  const preset = blockOf(blocks, 'preset-writing')
  assert.match(preset.text, /name: '?@deepseek-ai\/dsh-agent-preset'?/, 'preset 行挂官方 dsh-agent-preset 声明插件')
  assert.match(preset.text, /config:/, 'preset 行带 config(id/name/plugins)')
  assert.match(preset.text, /id: writing\b/, 'config.id 是会话保存的模式标识(写作模式)')
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

const SIGNAL = new AbortController().signal

test('tool provider 挂到 ctx.tools,只注册一个 writing_desk_produce', () => {
  const { ctx, registered } = toolContext({ store: {}, producer: {} })
  produceTool.apply(ctx)
  assert.equal(registered.length, 1)
  const tool = registered[0]
  assert.equal(tool.name, 'writing_desk_produce')
  assert.ok(typeof tool.description === 'string' && tool.description, '模型要能看到用途描述')
  // 参数 schema:成稿输入 ID 集合与选项(与 produce 路由同一种输入)
  assert.deepEqual(Object.keys(tool.parameters.properties), ['itemIds', 'capsuleIds', 'withImages'])
  assert.deepEqual(tool.parameters.required, [])
  // 注册契约(dsh-tools register 的硬校验):output { schema, render }
  assert.ok(tool.output && tool.output.schema && typeof tool.output.render === 'function')
  assert.equal(typeof tool.execute, 'function')
  // 插件本体是 preset 子项:inject 依赖 tools 与 writingDesk 服务,名字与 patch 子项 id 一致
  assert.deepEqual(produceTool.inject, ['tools', 'writingDesk'])
  assert.equal(produceTool.name, 'writing-desk-produce-tool')
})

test('execute 把输入归一成 {sourceIds, targetId},成稿写回同一份状态机', async () => {
  // 真实 Store + Producer(假模型):断言落点灵感的最终状态,不盯 mock 的调用参数——
  // 输入归一、落点取舍与产物落库都由状态本身说话(与 host.js produce 路由同一条链)。
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-preset-'))
  try {
    const store = new Store(dir)
    await store.read()
    // 空库自带种子灵感;胶囊要自己收一份,胶囊输入才有东西可展开
    await store.mutate('预置选题堆', draft => { applyOps(draft, [{ op: 'add_capsule', name: '选题堆', itemIds: ['seed_1', 'seed_2'] }]); return draft })
    const settings = new Settings(dir)
    // 不配生图服务(assets 停在 skipped),withImages 的两种取值都能从状态上分辨出来
    await settings.update({ imageCount: 1, shotCount: 2 })
    const PLAN = JSON.stringify({ title: '归一成稿标题', cover: 'c', characters: '', images: [{ anchor: '一', caption: '图', prompt: 'p' }], shots: [] })
    const callText = async ({ system, onText }) => {
      if (system.includes('策划案')) { onText(PLAN); return { text: PLAN, model: 'd' } }
      onText('# 归一成稿标题\n\n正文')
      return { text: '# 归一成稿标题\n\n正文', model: 'd' }
    }
    const producer = new Producer({ store, settings, callText, generate: async () => ({ buffer: Buffer.alloc(8), ext: '.png' }) })
    const desk = { store, producer }
    const { ctx, registered } = toolContext(desk)
    produceTool.apply(ctx)
    const tool = registered[0]
    // 多灵感输入:落点取首个,产物只落在落点灵感;显式 withImages: false 时不画图
    const result = await tool.execute({ itemIds: ['seed_1', 'seed_2'], withImages: false }, { signal: SIGNAL })
    assert.deepEqual(result, { started: true, targetId: 'seed_1', sourceIds: ['seed_1', 'seed_2'] })
    for (let i = 0; i < 200 && producer.isRunning(result.targetId); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    let state = await store.read()
    const target = state.items.find(row => row.id === result.targetId)
    assert.equal(target.production.status, 'done')
    assert.equal(target.production.article, '正文')
    assert.equal(target.production.withImages, false, '显式 withImages: false 不画图')
    assert.equal(state.items.find(row => row.id === 'seed_2').production, undefined, '其余来源只出素材,不成稿')

    // 胶囊展开归一成同一批 sourceIds;withImages 缺省时按工作台设置(默认画图)
    const capsule = (await store.read()).capsules.find(row => row.name === '选题堆')
    const again = await tool.execute({ capsuleIds: [capsule.id] }, { signal: SIGNAL })
    assert.deepEqual(again, { started: true, targetId: 'seed_1', sourceIds: ['seed_1', 'seed_2'] })
    for (let i = 0; i < 200 && producer.isRunning(again.targetId); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    state = await store.read()
    const rewritten = state.items.find(row => row.id === again.targetId)
    assert.equal(rewritten.production.status, 'done')
    assert.equal(rewritten.production.article, '正文')
    assert.equal(rewritten.production.withImages, true, '缺省时按设置画图')
    assert.equal(rewritten.production.images.length, (await settings.read()).imageCount, '配图数量按工作台设置')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('execute 报告已运行,空输入与不可用灵感报错', async () => {
  const desk = {
    store: { read: async () => seedState() },
    producer: { start: async () => false },
  }
  const { ctx, registered } = toolContext(desk)
  produceTool.apply(ctx)
  const tool = registered[0]
  const result = await tool.execute({ itemIds: ['seed_1'] }, { signal: SIGNAL })
  assert.deepEqual(result, { started: false, targetId: 'seed_1', sourceIds: ['seed_1'] })
  await assert.rejects(tool.execute({}, { signal: SIGNAL }), /没有可用的灵感/)
  await assert.rejects(tool.execute({ itemIds: ['missing'] }, { signal: SIGNAL }), /没有可用的灵感/)
})

test('execute 用与 produce 路由同一个 Producer 启动成稿,写回同一份状态机', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-preset-'))
  try {
    const store = new Store(dir)
    await store.read()
    const settings = new Settings(dir)
    await settings.update({ imageCount: 1, shotCount: 2, generateImages: false })
    // 假模型:与 produce-input.test.js 同一形态,流水线跑完不依赖网络
    const PLAN = JSON.stringify({ title: '工具成稿标题', cover: 'c', characters: '', images: [{ anchor: '一', caption: '图', prompt: 'p' }], shots: [] })
    const callText = async ({ system, onText }) => {
      if (system.includes('策划案')) { onText(PLAN); return { text: PLAN, model: 'd' } }
      onText('# 工具成稿标题\n\n正文')
      return { text: '# 工具成稿标题\n\n正文', model: 'd' }
    }
    const producer = new Producer({ store, settings, callText, generate: async () => ({ buffer: Buffer.alloc(8), ext: '.png' }) })
    const desk = { store, producer }
    const { ctx, registered } = toolContext(desk)
    produceTool.apply(ctx)
    const tool = registered[0]
    const result = await tool.execute({ itemIds: ['seed_1', 'seed_2'] }, { signal: SIGNAL })
    assert.equal(result.started, true)
    for (let i = 0; i < 200 && producer.isRunning(result.targetId); i += 1) await new Promise(resolve => setTimeout(resolve, 5))
    const state = await store.read()
    const target = state.items.find(row => row.id === result.targetId)
    // 同一 Producer 实例、同一 reducer:产物落在落点灵感,另一来源只出素材
    assert.equal(target.production.status, 'done')
    assert.equal(target.production.article, '正文')
    assert.equal(state.items.find(row => row.id === 'seed_2').production, undefined)
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
    skills: { registerProvider: create => providers.push(create({ signal: SIGNAL, invalidate() {} })) },
  }
  return { ctx, providers }
}

/** 带风格卡与两条规则的领域状态:一条生效、一条示例、一条提议(只有生效的进 skill)。 */
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

test('skill provider 经 ctx.skills.registerProvider 注册,导出形态与官方 provider 一致', () => {
  const { ctx, providers } = skillContext({ store: { read: async () => seedState() } })
  rulesSkill.apply(ctx)
  assert.equal(providers.length, 1)
  const provider = providers[0]
  assert.equal(provider.name, 'writing-desk')
  assert.equal(typeof provider.list, 'function')
  assert.equal(typeof provider.get, 'function')
  assert.deepEqual(rulesSkill.inject, ['skills', 'writingDesk'])
  assert.equal(rulesSkill.name, 'writing-desk-rules-skill')
})

test('list 给出可被模型与用户共同调用的候选,get 读出实时规则与风格', async () => {
  const state = styledState()
  const { ctx, providers } = skillContext({ store: { read: async () => state } })
  rulesSkill.apply(ctx)
  const provider = providers[0]
  const candidates = await provider.list({})
  assert.equal(candidates.length, 1)
  const candidate = candidates[0]
  assert.equal(candidate.name, 'writing-desk-rules')
  assert.ok(candidate.description)
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(candidate.source, 'custom')
  assert.equal(candidate.provider, 'writing-desk')
  assert.equal(candidate.rank, 0)
  const definition = await provider.get(candidate, {})
  assert.ok(definition && typeof definition.content === 'string')
  // 内容来自当前状态:风格卡与已生效规则都在,示例与未确认的提议不进
  assert.match(definition.content, /测试腔/)
  assert.match(definition.content, /短句、说人话/)
  assert.match(definition.content, /同一选题优先在一个平台首发。/)
  assert.match(definition.content, /首发平台/)
  assert.doesNotMatch(definition.content, /示例不算风格/)
  assert.doesNotMatch(definition.content, /用户没确认的不算/)
})

test('没有风格与规则时 skill 仍在,正文说明去哪里沉淀;规则改动后 get 读到新内容', async () => {
  const state = seedState()
  const { ctx, providers } = skillContext({ store: { read: async () => state } })
  rulesSkill.apply(ctx)
  const [provider] = providers
  const [candidate] = await provider.list({})
  const empty = await provider.get(candidate, {})
  assert.ok(empty.content)
  assert.match(empty.content, /工作台|风格|规则/)
  assert.doesNotMatch(empty.content, /必须遵守的规则/)
  // 规则是 get 时实时读的:写入新规则后,同一个 provider 立刻给出新正文
  applyOps(state, [{ op: 'add_skill', name: '新规则', rule: '标题要有动词。', status: 'active' }])
  const fresh = await provider.get(candidate, {})
  assert.match(fresh.content, /标题要有动词。/)
})

// ---------- host 半片接线(src/host.js) ----------

test('host 半片发布 writingDesk 服务,preset 子插件经它拿到同一份 Store 与 Producer', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'writing-desk-host-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = dir
  try {
    const provided = {}
    const ctx = {
      get: () => undefined,
      effect: fn => fn(),
      provide: (name, value) => { provided[name] = value },
      webServer: { register() {} },
    }
    hostPlugin.apply(ctx)
    const desk = provided.writingDesk
    assert.ok(desk, 'apply 之后必须已经 provide writingDesk 服务')
    assert.equal(typeof desk.store.read, 'function')
    assert.equal(typeof desk.producer.start, 'function')
    assert.ok(desk.settings, 'settings 也在同一份服务里')
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
