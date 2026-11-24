// 创作模式的 harness 工具(ADR 0006):读素材、写回产物、规则提案、风格卡。
// 成稿发生在 DSH 会话里,插件只提供数据与落库通道——本模块没有任何模型调用。
// 本模块是 Cordis 插件,只被 cordis.patch.yml 里 preset-writing 的 plugins 子项挂载:
// 注册落在该 preset 的 scope 层,其他模式看不到;绝不进全局 composition(工单 #55)。
// 所有写路径都走 ops/state 同一条链(applyOps + reducer),与会话外的 UI 操作同一份裁决。
// 参数与输出是 JSON Schema(dsh-tools ToolSchema/ToolOutputDefinition 的登记形态),
// 不经 defineTool(本包不依赖 dsh-tools,运行时全靠 ctx 服务鸭子类型)。

import { applyOps } from './ops.js'
import { resolveProduceInput } from './produce-input.js'
import { workOfId, workState, workTitle, worksOfItem } from './work.js'

export const name = 'writing-desk-tools'

export const inject = ['tools', 'writingDesk']

const BODY_LIMIT = 4000
const ARTICLE_PREVIEW = 1200

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function stringList(value, field) {
  if (!Array.isArray(value) || value.some(row => typeof row !== 'string')) {
    throw invalid(`${field} 必须是字符串数组`)
  }
  return value
}

const clip = (text, limit) => (typeof text === 'string' && text.length > limit ? { text: text.slice(0, limit), truncated: true } : { text: text ?? '', truncated: false })

/** 作品概要:write 能写的字段都给回当前值(正文只给预览),会话拿它取 rev、续跑意图单(ADR 0013/0014)。 */
function summarizeWork(work) {
  const current = work.current ?? {}
  const cover = current.cover
  return {
    id: work.id,
    state: workState(work),
    rev: current.rev ?? 0,
    sourceItemIds: work.sourceItemIds ?? [],
    ...(current.title ? { title: current.title } : {}),
    ...(current.coverText ? { coverText: current.coverText } : {}),
    ...(current.article ? { existingDraft: clip(current.article, ARTICLE_PREVIEW) } : {}),
    ...(cover?.src ? { cover: { src: cover.src, ...(cover.caption ? { caption: cover.caption } : {}) } } : {}),
    ...(Array.isArray(current.images) && current.images.length
      ? { images: current.images.filter(row => row?.src).map(row => ({ src: row.src, ...(row.caption ? { caption: row.caption } : {}), ...(row.anchor ? { anchor: row.anchor } : {}) })) }
      : {}),
    ...(current.intent ? { intent: current.intent } : {}),
    ...(current.review ? { review: current.review } : {}),
  }
}

function summarizeItem(state, item) {
  const body = clip(item.body, BODY_LIMIT)
  // 素材已用后正文在作品上(ADR 0013):这里只给指针,会话要写回就按 works[].id + rev 调 write
  const works = worksOfItem(state, item.id).map(work => ({ id: work.id, title: workTitle(work), state: workState(work), rev: work.current?.rev ?? 0 }))
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    body: body.text,
    ...(body.truncated ? { bodyTruncated: true } : {}),
    tags: item.tags ?? [],
    ...(item.url ? { url: item.url } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(item.media ? { media: item.media } : {}),
    ...(works.length ? { works } : {}),
    ...(item.scheduledAt ? { scheduledAt: item.scheduledAt } : {}),
  }
}

/** 读素材:按 ID 取全文,或按一句话找相关灵感。输出有界,正文超长带截断标记。 */
function readTool(desk) {
  return {
    name: 'writing_desk_read',
    description: '读图文创作台里的灵感、胶囊与作品:成稿前用它取素材全文;写回前再用一次确认当前版本(rev)。'
      + '给 itemIds / capsuleIds 取素材全文;给 workIds 取作品当前稿概要;给 query 按标题、正文与标签找相关灵感(返回摘要)。',
    parameters: {
      type: 'object',
      properties: {
        itemIds: { type: 'array', items: { type: 'string' }, description: '要读全文的灵感 ID,一或多个。' },
        capsuleIds: { type: 'array', items: { type: 'string' }, description: '要展开的胶囊 ID,按给定顺序展开成员灵感,可与 itemIds 混用。' },
        workIds: { type: 'array', items: { type: 'string' }, description: '要读当前稿的作品 ID,一或多个;写回前用它拿 rev。' },
        query: { type: 'string', description: '按标题、正文与标签找相关灵感;与其他 ID 参数二选一。' },
      },
      required: [],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', description: '灵感列表:ID、标题、正文(超长截断)、标签;已用于成稿的带 works 指针(id、状态、rev、标题)。' },
          capsules: { type: 'array', description: '胶囊列表与成员数。' },
          works: { type: 'array', description: '作品当前稿概要:ID、状态、rev、标题、封面文案、正文预览、意图单、审读报告;写回工具可写的字段当前值。' },
          total: { type: 'number', description: '命中的灵感总数。' },
        },
        required: ['items', 'capsules', 'works', 'total'],
        additionalProperties: false,
      },
      render(_args, value) {
        const names = value.items.map(row => `《${row.title}》`).join('、') || '无'
        return [{ type: 'text', text: `读到 ${value.total} 条灵感、${value.works.length} 篇作品:${names}` }]
      },
    },
    async execute(args) {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw invalid('参数必须是对象')
      const state = await desk.store.read()
      const itemIds = args.itemIds === undefined ? undefined : stringList(args.itemIds, 'itemIds')
      const capsuleIds = args.capsuleIds === undefined ? undefined : stringList(args.capsuleIds, 'capsuleIds')
      const workIds = args.workIds === undefined ? undefined : stringList(args.workIds, 'workIds')
      const query = typeof args.query === 'string' ? args.query.trim() : ''
      if (!itemIds?.length && !capsuleIds?.length && !workIds?.length && !query) throw invalid('给 itemIds、capsuleIds、workIds 或 query 之一')
      const byId = new Map(state.items.map(row => [row.id, row]))
      let rows = []
      const capsules = []
      if (itemIds?.length || capsuleIds?.length) {
        const { sourceIds } = resolveProduceInput(state, { itemIds, capsuleIds })
        rows = sourceIds.map(id => byId.get(id)).filter(Boolean)
        for (const id of capsuleIds ?? []) {
          const capsule = (state.capsules ?? []).find(row => row.id === id)
          if (capsule) capsules.push({ id: capsule.id, name: capsule.name, memberCount: capsule.itemIds.length })
        }
      } else if (query) {
        const needle = query.toLowerCase()
        rows = state.items
          .filter(row => [row.title, row.body, ...(row.tags ?? [])].some(v => String(v ?? '').toLowerCase().includes(needle)))
          .slice(0, 12)
      }
      const items = rows.map(row => summarizeItem(state, row))
      const works = (workIds ?? []).map(id => workOfId(state, id)).filter(Boolean).map(summarizeWork)
      return { items, capsules, works, total: items.length }
    },
  }
}

/** 写回:分阶段粗粒度、按字段落回;rev 基线不符即拦下暂存,绝不静默覆盖人工修改。 */
function writeTool(desk) {
  return {
    name: 'writing_desk_write',
    description: '把成稿写回图文创作台的作品:标题、正文、封面文案、封面图、配图、意图单、审读报告,按字段一次写回一个阶段。'
      + '写正文前先 writing_desk_read({ workIds }) 拿当前 rev;用户的修改优先于会话——基线不符会被拦下,交用户在作品编辑器裁决。',
    parameters: {
      type: 'object',
      properties: {
        workId: { type: 'string', description: '作品 ID(writing_desk_read 的 works[].id)。' },
        rev: { type: 'number', description: '写回前读到的作品 rev;不符且未要求覆盖会被拦下。' },
        force: { type: 'boolean', description: '只在用户明确说覆盖他的修改时才置 true。' },
        title: { type: 'string', description: '成稿大标题。' },
        coverText: { type: 'string', description: '封面大字,建议不超过 12 字。' },
        article: { type: 'string', description: '图文正文(Markdown,## 小标题分节便于配图锚定)。' },
        cover: { type: 'object', properties: { src: { type: 'string' }, caption: { type: 'string' } }, required: ['src'], description: '封面首图,src 为工作台 files 相对路径。' },
        images: { type: 'array', items: { type: 'object', properties: { src: { type: 'string' }, caption: { type: 'string' }, anchor: { type: 'string' } }, required: ['src'] }, description: '配图清单,anchor 填对应的小标题文字。' },
        intent: { type: 'object', description: '意图单:purpose/audience/judgment/mustKeep/boundary/evidence/platform/notDo 与 status(confirmed 表示用户已确认)。' },
        review: { type: 'object', description: '审读报告:findings 数组,每条含 axis(standards|intent)、severity(P0|P1|P2)、location、quote、suggestion;只报告不改稿。' },
      },
      required: ['workId'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          written: { type: 'boolean' },
          workId: { type: 'string' },
          rev: { type: 'number', description: '写回后的版本号;下次写回带上它。' },
        },
        required: ['written', 'workId', 'rev'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: value.written ? `已写回作品,当前 rev ${value.rev};在作品编辑器里可见。` : '没有写回任何字段。' }]
      },
    },
    async execute(args) {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw invalid('参数必须是对象')
      if (typeof args.workId !== 'string' || !args.workId) throw invalid('workId 必须是作品 ID')
      const hasField = ['title', 'coverText', 'article', 'cover', 'images', 'intent', 'review'].some(key => args[key] !== undefined)
      if (!hasField) throw invalid('至少给一个要写回的字段')
      const op = { op: 'write_work', id: args.workId }
      for (const key of ['title', 'coverText', 'article', 'cover', 'images', 'intent', 'review']) {
        if (args[key] !== undefined) op[key] = args[key]
      }
      if (typeof args.rev === 'number') op.rev = args.rev
      if (args.force === true) op.force = true
      const { receipts } = await desk.store.mutate('会话写回', (draft) => {
        const applied = applyOps(draft, [op])
        if (applied.errors.length) throw new Error(applied.errors[0])
        return applied
      })
      const work = await desk.store.read().then(state => workOfId(state, args.workId))
      return { written: true, workId: args.workId, rev: work?.current?.rev ?? 0, receipt: receipts[0]?.text }
    },
  }
}

/** 规则提案:以 proposed 落库,风格页人工启用后才进入 rules skill(软参考→确认→硬规则)。 */
function addRuleTool(desk) {
  return {
    name: 'writing_desk_add_rule',
    description: '把从作品原文里反复观察到的写作规则提案存进图文创作台,等用户在风格页确认。每条至少两处原文出处,kind 区分硬规则/软范式,confidence 标置信度。不用于事实修正——事实问题直接告诉用户。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '规则短名,不超过 20 字。' },
        rule: { type: 'string', description: '规则正文:以后每篇怎么做,一条一条写清楚。' },
        evidence: { type: 'string', description: '至少两处原文证据:每处写清作品名、位置(发布稿/创作对话/发布后改动)并原样摘录那句原文。图片行与链接不算证据。' },
        kind: { type: 'string', enum: ['hard', 'soft'], description: 'hard=硬规则(每篇必做);soft=软范式(倾向,允许按场景例外)。默认 hard。' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: '置信度 0~1:3 篇以上一致给 0.8+;2 篇给 0.6~0.8;仅 1 篇孤例给 0.5 以下。' },
      },
      required: ['name', 'rule'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { proposed: { type: 'boolean' } },
        required: ['proposed'],
        additionalProperties: false,
      },
      render() {
        return [{ type: 'text', text: '规则提案已存好,等用户在图文创作台的「写作规则」里确认后生效。' }]
      },
    },
    async execute(args) {
      if (args === null || typeof args !== 'object') throw invalid('参数必须是对象')
      if (typeof args.name !== 'string' || !args.name.trim() || typeof args.rule !== 'string' || !args.rule.trim()) throw invalid('规则需要名字和正文')
      if (args.kind !== undefined && args.kind !== 'hard' && args.kind !== 'soft') throw invalid('kind 只能是 hard 或 soft')
      const fields = { op: 'add_skill', name: args.name.slice(0, 20), rule: args.rule.slice(0, 500), kind: args.kind ?? 'hard', source: '创作会话', status: 'proposed' }
      if (typeof args.evidence === 'string') fields.evidence = args.evidence.slice(0, 1000)
      if (typeof args.confidence === 'number' && Number.isFinite(args.confidence)) {
        fields.confidence = Math.min(1, Math.max(0, args.confidence))
      }
      await desk.store.mutate('会话提议规则', (draft) => {
        const { errors } = applyOps(draft, [fields])
        if (errors.length) throw new Error(errors[0])
        return draft
      })
      return { proposed: true }
    },
  }
}

/** 风格卡写回:贴内容提炼后的落点,写完设为当前风格。 */
function addStyleTool(desk) {
  return {
    name: 'writing_desk_add_style',
    description: '把提炼出的个人风格卡写进图文创作台。默认设为当前风格；从作品学习候选时把 activate 设为 false,只写入候选卡。字段都从原文观察得来,不泛泛而谈。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '风格名,不超过 20 字。' },
        summary: { type: 'string', description: '一句话概括。' },
        tone: { type: 'string', description: '语气和态度。' },
        sentences: { type: 'string', description: '句式和断句。' },
        opening: { type: 'string', description: '通常怎么开头。' },
        structure: { type: 'string', description: '内容怎么组织。' },
        logic: { type: 'string', description: '看问题的逻辑。' },
        story: { type: 'string', description: '讲故事和举例子方式。' },
        flow: { type: 'string', description: '句段衔接方式。' },
        words: { type: 'array', items: { type: 'string' }, description: '常用词、口头禅,最多 8 个。' },
        avoid: { type: 'array', items: { type: 'string' }, description: '这位作者绝不会写的东西,最多 5 个。' },
        samples: { type: 'array', items: { type: 'string' }, description: '原样摘录的代表句,最多 6 句。' },
        activate: { type: 'boolean', description: '默认 true,写完设为当前风格；从作品学习候选时传 false,只放候选卡,不替用户切换。' },
      },
      required: ['name'],
    },
    output: {
      schema: {
        type: 'object',
        properties: { styleId: { type: 'string' } },
        required: ['styleId'],
        additionalProperties: false,
      },
      render(args, value) {
        return [{ type: 'text', text: args.activate === false ? '候选风格卡已写入,没有切换当前风格;等用户确认后再自己启用。' : '风格卡已存好并设为当前风格,之后每次成稿都会带上。' }]
      },
    },
    async execute(args) {
      if (args === null || typeof args !== 'object') throw invalid('参数必须是对象')
      if (typeof args.name !== 'string' || !args.name.trim()) throw invalid('风格需要名字')
      const activate = args.activate !== false
      const fields = { op: 'add_style', name: args.name.slice(0, 20), source: '创作会话' }
      for (const key of ['summary', 'tone', 'sentences', 'opening', 'structure', 'logic', 'story', 'flow']) {
        if (typeof args[key] === 'string') fields[key] = args[key].slice(0, 200)
      }
      for (const key of ['words', 'avoid', 'samples']) {
        if (Array.isArray(args[key])) fields[key] = args[key].filter(row => typeof row === 'string').slice(0, 8)
      }
      let styleId = null
      await desk.store.mutate('会话提炼风格', (draft) => {
        const { receipts, errors } = applyOps(draft, [fields])
        if (errors.length) throw new Error(errors[0])
        styleId = receipts[0]?.target ?? null
        if (styleId && activate) {
          const { errors: more } = applyOps(draft, [{ op: 'set_style', id: styleId }])
          if (more.length) throw new Error(more[0])
        }
        return draft
      })
      return { styleId: styleId ?? '' }
    },
  }
}

/** 注册进挂载 scope(preset 层)的工具注册表。 */
export function apply(ctx) {
  const desk = ctx.get('writingDesk')
  if (!desk) throw new Error('writingDesk 服务不可用:创作模式工具需要宿主工作台提供 Store')
  ctx.tools.register(readTool(desk))
  ctx.tools.register(writeTool(desk))
  ctx.tools.register(addRuleTool(desk))
  ctx.tools.register(addStyleTool(desk))
}
