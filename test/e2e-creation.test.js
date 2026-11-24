// 端到端:创作模式里 skill 的加载如何接到成稿流程(ADR 0006 主链路)。
// 与各模块的单项测试不同,这里在一份真实 Store 上串起整条链:
// preset 子插件注册 → 工具取素材 → dsh-tool-skill 式 list/get 加载两个 skill →
// 意图单/初稿/审读写回 → add_rule 提案 → 用户确认 → 下次加载 rules skill 实时反映 →
// 写回冲突闸门。不模拟模型本身与宿主 GUI,其余全是真实模块。
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyOps } from '../src/ops.js'
import { Store } from '../src/store.js'
import * as tools from '../src/preset-tool.js'
import * as skills from '../src/preset-skill.js'

/** 一份 Store + 同一 scope 下两个 preset 子插件的注册表,模拟 cordis.patch.yml 的 preset-writing。 */
function creationScope(store) {
  const desk = { store }
  const registeredTools = []
  const providers = []
  const ctx = {
    get: name => (name === 'writingDesk' ? desk : undefined),
    tools: { register: definition => registeredTools.push(definition) },
    skills: { registerProvider: create => providers.push(create({ signal: new AbortController().signal, invalidate() {} })) },
  }
  tools.apply(ctx)   // writing-desk-produce-tool
  skills.apply(ctx)  // writing-desk-rules-skill
  return { registeredTools, providers }
}

/** 模型侧加载 skill 的等价动作:遍历 provider 的 list,按 name 取回正文。 */
async function loadSkill(providers, name) {
  const candidates = []
  for (const provider of providers) candidates.push(...(await provider.list({})))
  const candidate = candidates.find(row => row.name === name)
  assert.ok(candidate, `创作模式里没有候选 skill ${name}`)
  for (const provider of providers) {
    const definition = await provider.get(candidate, {})
    if (definition) return definition
  }
  assert.fail(`没有 provider 能提供 ${name}`)
}

test('端到端:从取素材、加载 skill 到规则沉淀回流,全程同一份状态', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wfd-e2e-'))
  try {
    const store = new Store(dir)
    await store.read()
    const { registeredTools, providers } = creationScope(store)
    const byName = name => {
      const tool = registeredTools.find(row => row.name === name)
      assert.ok(tool, `创作模式缺少工具 ${name}`)
      return tool
    }
    const read = byName('writing_desk_read')
    const write = byName('writing_desk_write')
    const addRule = byName('writing_desk_add_rule')
    const addStyle = byName('writing_desk_add_style')

    // 1) 会话取素材:拖入的引用是指针,正文经 read 工具取回(ADR 0006)
    const material = await read.execute({ query: 'AI' })
    assert.ok(material.total >= 1, '种子库里应有可写的素材')
    await read.execute({ capsuleIds: [(await store.read()).capsules[0].id] })

    // 2) 加载 skill:list 给出两个候选,描述互斥指路;get 按名字拿到正文
    const candidates = []
    for (const provider of providers) candidates.push(...(await provider.list({})))
    assert.deepEqual(candidates.map(row => row.name), ['writing-desk-rules', 'writing-desk-craft'])
    const [rulesCandidate, craftCandidate] = candidates
    // 改进后的顶层指针:rules 用「腔调」、craft 用「手艺」,彼此指路,不抢同一类请求
    assert.match(rulesCandidate.description, /动笔前加载.*writing-desk-craft/)
    assert.match(craftCandidate.description, /写或改图文.*writing-desk-rules/)
    const rules0 = await loadSkill(providers, 'writing-desk-rules')
    const craft0 = await loadSkill(providers, 'writing-desk-craft')
    assert.match(rules0.content, /工作台|风格|规则/, '没有沉淀时说明去哪里沉淀')
    assert.match(craft0.content, /人工闸门/, '人工闸门写进核心纪律')
    assert.match(craft0.content, /产物是初稿/, '阶段产物明确,防 premature completion')
    assert.doesNotMatch(craft0.content, /不要自己一路跑到底|这些不是问题/, '否定式已改正向表述')
    // skill 的写回指引必须指向工具真实接受的字段,不能让模型传一个会被静默忽略的参数
    assert.match(craft0.content, /写回的字段本身标明阶段/)
    assert.equal(write.parameters.properties.note, undefined, '写回工具没有 note 参数,skill 不得指向它')

    // 3) 意图单与初稿写回:作品是第一实体,写回按 rev 逐阶段推进
    const created = await store.mutate('开始成稿', draft => applyOps(draft, [{ op: 'create_work', itemIds: ['seed_1'] }]))
    const workId = created.receipts[0].target
    const first = await write.execute({ workId, intent: { purpose: '种草', status: 'confirmed' } })
    assert.equal(first.rev, 1)
    const second = await write.execute({ workId, rev: first.rev, article: '# 初稿\n\n正文', coverText: '实测' })
    assert.equal(second.rev, 2)
    const review = await write.execute({ workId, rev: second.rev, review: { findings: [{ axis: 'standards', severity: 'P1', location: '开头', quote: '正文', suggestion: '补判断' }] } })
    assert.equal(review.rev, 3)
    const fresh = await read.execute({ workIds: [workId] })
    assert.equal(fresh.works[0].rev, 3)
    assert.equal(fresh.works[0].existingDraft.text, '# 初稿\n\n正文')

    // 4) 规则提案:会话端以 proposed 落库,此时加载 rules skill 还看不到它
    const proposed = await addRule.execute({
      name: '开头先给结论',
      rule: '开头先给结论,再补一个具体场景。',
      kind: 'hard',
      confidence: 0.9,
      evidence: '《甲》发布稿:第一句;《乙》创作对话:第二轮',
    })
    assert.equal(proposed.proposed, true)
    const newRule = (await store.read()).skills.find(row => row.name === '开头先给结论')
    assert.equal(newRule.status, 'proposed')
    const beforeConfirm = await loadSkill(providers, 'writing-desk-rules')
    assert.doesNotMatch(beforeConfirm.content, /开头先给结论,再补一个具体场景/)

    // 用户确认后,同一个 provider 立刻拿到新正文:这就是"接到创作流程里"的关键回流
    await store.mutate('用户确认规则', draft => applyOps(draft, [{ op: 'update_skill', id: newRule.id, status: 'active' }]))
    const afterConfirm = await loadSkill(providers, 'writing-desk-rules')
    assert.match(afterConfirm.content, /开头先给结论,再补一个具体场景/)
    assert.match(afterConfirm.content, /硬规则·置信度高/)
    assert.match(afterConfirm.content, /依据:《甲》发布稿:第一句;《乙》创作对话:第二轮/)
    assert.match(afterConfirm.content, /怎么用这些规则|读完就按上面的优先级动笔/)

    // 5) 风格卡回流:默认设为当前,下次加载 rules skill 实时带上;不替用户切换的候选卡不进正文
    const styled = await addStyle.execute({ name: '我的腔调', summary: '短句、说人话', tone: '克制', samples: ['哈哈哈哈'] })
    assert.ok(styled.styleId)
    await addStyle.execute({ name: '候选腔', summary: '待确认', activate: false })
    const withStyle = await loadSkill(providers, 'writing-desk-rules')
    assert.match(withStyle.content, /我的腔调/)
    assert.match(withStyle.content, /短句、说人话/)
    assert.doesNotMatch(withStyle.content, /待确认/, 'activate=false 的候选卡不进实时 skill')

    // 6) 写回闸门:拿旧 rev 写正文被拦下,先 read 拿基线再写才通过
    await assert.rejects(write.execute({ workId, rev: 1, article: '过期稿' }), /在别处更新过/)
    const baseline = await read.execute({ workIds: [workId] })
    const final = await write.execute({ workId, rev: baseline.works[0].rev, article: '# 定稿\n\n按规则写的正文' })
    assert.equal(final.rev, 4)
    assert.equal((await store.read()).works.find(row => row.id === workId).current.article, '# 定稿\n\n按规则写的正文')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
