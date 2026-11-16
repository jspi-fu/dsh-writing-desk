// 创作模式的粗粒度成稿 tool provider(工单 #8)。
// 本模块是 Cordis 插件,只被 cordis.patch.yml 里 preset-writing 的 plugins 子项挂载:
// 注册落在该 preset 的 scope 层,其他模式看不到;绝不进全局 composition(工单 #55)。
// 成稿动作与 produce 路由同一条链:同一个 writingDesk 服务(Store + Producer),
// 经 resolveProduceInput 归一后调用 producer.start,产物写回同一个 reducer。
// 参数与输出是 JSON Schema(dsh-tools ToolSchema/ToolOutputDefinition 的登记形态),
// 不经 defineTool(本包不依赖 dsh-tools,运行时全靠 ctx 服务鸭子类型)。

import { resolveProduceInput } from './produce-input.js'

export const name = 'writing-desk-produce-tool'

export const inject = ['tools', 'writingDesk']

const PARAMETERS = {
  type: 'object',
  properties: {
    itemIds: { type: 'array', items: { type: 'string' }, description: '成稿依据的灵感 ID,一个或多个;多选时全部素材融合进一篇。' },
    capsuleIds: { type: 'array', items: { type: 'string' }, description: '成稿依据的胶囊 ID,按给定顺序展开成员灵感;可与 itemIds 混用。' },
    withImages: { type: 'boolean', description: '是否生成封面与配图;缺省按工作台设置。' },
  },
  required: [],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    started: { type: 'boolean', description: '是否成功启动成稿;false 表示落点灵感已有成稿在跑' },
    targetId: { type: 'string', description: '成稿产物落点的灵感 ID' },
    sourceIds: { type: 'array', items: { type: 'string' }, description: '这次成稿依据的全部灵感 ID' },
  },
  required: ['started', 'targetId', 'sourceIds'],
  additionalProperties: false,
}

function invalid(message) {
  return Object.assign(new Error(message), { status: 400 })
}

function stringList(value, field) {
  if (!Array.isArray(value) || value.some(row => typeof row !== 'string')) {
    throw invalid(`${field} 必须是字符串数组`)
  }
  return value
}

/** 登记进 preset scope 的 tool 定义:参数/output/呈现与执行一体,注册时整体交给 ctx.tools。 */
function produceTool(desk) {
  return {
    name: 'writing_desk_produce',
    description: '把图文创作台里的一组灵感(或胶囊)写成一篇图文稿子:标题、正文、封面首图、配图、分镜一次生成。'
      + '给 itemIds 或 capsuleIds 之一即可;生成进度与成稿结果在图文创作台界面查看。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        const text = value.started
          ? `已在图文创作台启动成稿:落点灵感 ${value.targetId},依据灵感 ${value.sourceIds.join('、')}。标题、正文、封面与配图会陆续生成,可在工作台界面查看进度与结果。`
          : `这条灵感(${value.targetId})已有成稿在跑,本次没有重复启动;可在工作台界面查看进度。`
        return [{ type: 'text', text }]
      },
    },
    presentCall(args) {
      return { card: 'generic', title: '图文成稿', kind: 'other', rawInput: args }
    },
    async execute(args, exec) {
      if (args === null || typeof args !== 'object' || Array.isArray(args)) throw invalid('参数必须是对象')
      const { withImages } = args
      if (withImages !== undefined && typeof withImages !== 'boolean') throw invalid('withImages 必须是布尔值')
      const itemIds = args.itemIds === undefined ? undefined : stringList(args.itemIds, 'itemIds')
      const capsuleIds = args.capsuleIds === undefined ? undefined : stringList(args.capsuleIds, 'capsuleIds')
      if (!exec?.signal) throw invalid('执行上下文缺少取消信号')
      // 与 produce 路由同一条链:同一份 Store 读状态、同一 Producer 启动、写回同一 reducer
      const input = resolveProduceInput(await desk.store.read(), { itemIds, capsuleIds })
      const options = { sourceIds: input.sourceIds }
      if (typeof withImages === 'boolean') options.withImages = withImages
      const started = await desk.producer.start(input.targetId, options)
      return { started, targetId: input.targetId, sourceIds: input.sourceIds }
    },
  }
}

/** 注册进挂载 scope(preset 层)的工具注册表。 */
export function apply(ctx) {
  const desk = ctx.get('writingDesk')
  if (!desk) throw new Error('writingDesk 服务不可用:创作模式的成稿 tool 需要宿主工作台提供 Store 与 Producer')
  ctx.tools.register(produceTool(desk))
}
