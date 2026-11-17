// 创作模式的 skill provider(ADR 0006):两个 skill,一个实时、一个静态。
// 本模块是 Cordis 插件,只被 cordis.patch.yml 里 preset-writing 的 plugins 子项挂载:
// ctx.skills.registerProvider 落在挂载 scope(preset 层)的 skill 注册表里,
// 其他模式看不到;绝不进全局 composition(工单 #55)。
// - writing-desk-rules:内容不落文件,每次 get 实时读工作台状态,风格卡与已生效规则改动即时生效
//   (与 learn.exportSkill 的「导出成用户级 Skill 文件」是两条互补通道,互不覆盖)。
// - writing-desk-craft:图文写作法(意图单/声纹/审读/润色),静态正文见 craft-skill.js。
// Provider 形态按 @deepseek-ai/dsh-skill 的 SkillProvider 接口(name/list/get)。

import { CRAFT_DESCRIPTION, CRAFT_NAME, craftBody } from './craft-skill.js'
import { activeStyle, styleToVoice } from './style.js'

export const name = 'writing-desk-rules'

export const inject = ['skills', 'writingDesk']

const SKILL_NAME = 'writing-desk-rules'

const DESCRIPTION = '图文创作台沉淀的写作规则与个人风格。写选题、标题、正文或封面文案前先加载,按作者自己的腔调写。'

/** 生效中的规则:与 exportSkill 同一口径——示例规则不是作者的风格,不导出。 */
function activeRules(state) {
  return (state.skills ?? []).filter(skill => !skill.sample && (skill.status === 'active' || skill.status === 'exported'))
}

/** 当前风格卡:预设模板不是作者的腔调,与 exportSkill 一样排除,只认用户自己的卡。 */
function userStyle(state) {
  const style = activeStyle(state)
  return style && !style.preset ? style : null
}

function rulesBlock(rules) {
  const lines = rules.map(rule => `- **${rule.name}**:${rule.rule}${rule.evidence ? `(依据:${rule.evidence})` : ''}`)
  return `\n## 必须遵守的规则\n\n${lines.join('\n')}\n`
}

/** 组装 rules skill 正文(Markdown body;元数据已由 provider 字段承载,不带 front-matter)。 */
function rulesBody(state) {
  const style = userStyle(state)
  const rules = activeRules(state)
  const intro = `由「图文创作台」沉淀,实时来自工作台的风格卡与已生效规则(读取于 ${new Date().toISOString().slice(0, 10)})。`
  if (!style && !rules.length) {
    return `# 图文写作风格\n\n${intro}\n\n还没有沉淀个人风格。在图文创作台侧栏提炼风格卡、确认写作规则后,这里会实时给出要遵守的写法。`
  }
  const styleBlock = style ? `\n## 风格:${style.name}\n\n${styleToVoice(style)}\n` : ''
  const ruleBlock = rules.length ? rulesBlock(rules) : ''
  return `# 图文写作风格\n\n${intro}\n${styleBlock}${ruleBlock}`
}

/** 候选与完整定义共用一份摘要;rules 内容在 get 时实时读。 */
function rulesCandidate() {
  return {
    name: SKILL_NAME,
    description: DESCRIPTION,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider: 'writing-desk',
    rank: 0,
    locator: SKILL_NAME,
  }
}

function craftCandidate() {
  return {
    name: CRAFT_NAME,
    description: CRAFT_DESCRIPTION,
    invocation: { modelInvocable: true, userInvocable: true },
    source: 'custom',
    provider: 'writing-desk',
    rank: 0,
    locator: CRAFT_NAME,
  }
}

/** 注册进挂载 scope(preset 层)的 skill 注册表。 */
export function apply(ctx) {
  const desk = ctx.get('writingDesk')
  if (!desk) throw new Error('writingDesk 服务不可用:创作模式的 skill 需要宿主工作台提供 Store')
  ctx.skills.registerProvider(() => ({
    name: 'writing-desk',
    // 列表结果里只有稳定的摘要;rules 正文一律 get 时现读,注册表缓存不会藏旧规则
    async list() {
      return [rulesCandidate(), craftCandidate()]
    },
    async get(candidateItem) {
      if (candidateItem?.name === SKILL_NAME) {
        const state = await desk.store.read()
        return { ...rulesCandidate(), content: rulesBody(state) }
      }
      if (candidateItem?.name === CRAFT_NAME) {
        return { ...craftCandidate(), content: craftBody() }
      }
      return undefined
    },
  }))
}
