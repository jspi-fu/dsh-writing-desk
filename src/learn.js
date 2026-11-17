// 把生效中的规则与用户自己的风格卡导出成 DeepSeek Harness 用户级 Skill。
// 规则的沉淀(改稿对比、会话提炼)发生在 harness 侧,这里只负责写文件这一个出口。
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { activeStyle, styleToVoice } from './style.js'
import { tr } from './i18n.js'

function slug(text, fallback) {
  const ascii = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return ascii || fallback
}

/**
 * 把生效中的规则写成一个 DeepSeek Harness 用户级 Skill（<home>/skills/<name>/SKILL.md）。
 * 内容由用户在界面确认后点击导出才写入。
 * @param {object} state - 当前状态。
 * @param {string} home - DSH_HOME。
 * @returns {Promise<{name: string, path: string, rules: number}>} 写入结果。
 */
export async function exportSkill(state, home) {
  // 示例规则不是作者的风格，不能写进真实 Skill
  const rules = state.skills.filter(skill => !skill.sample && (skill.status === 'active' || skill.status === 'exported'))
  const picked = activeStyle(state)
  const style = picked && !picked.preset ? picked : null
  const name = 'writing-desk-voice'
  const dir = join(home, 'skills', name)
  if (!rules.length && !style) {
    // 之前导出过的旧 Skill 不再代表现在的设置，撤掉它
    await rm(dir, { recursive: true, force: true })
    throw Object.assign(new Error(tr('还没有你自己的风格或规则。示例规则和模板不会被导出')), { status: 400 })
  }
  await mkdir(dir, { recursive: true })
  const description = tr('作者的自媒体写作风格和规则。写选题、脚本、标题或封面文案时使用。')
  const styleBlock = style ? `## ${tr('风格：{name}', { name: style.name })}\n\n${styleToVoice(style)}\n\n` : ''
  const ruleBlock = rules.length ? `## ${tr('必须遵守的规则')}\n\n${rules.map(r => `- **${r.name}**${tr('：')}${r.rule}${r.evidence ? tr('（依据：{evidence}）', { evidence: r.evidence }) : ''}`).join('\n')}\n` : ''
  const body = `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${tr('图文写作风格')}\n\n${tr('由「图文创作台」沉淀，更新于 {date}。', { date: new Date().toISOString().slice(0, 10) })}\n\n${styleBlock}${ruleBlock}`
  await writeFile(join(dir, 'SKILL.md'), body)
  return { name, path: join(dir, 'SKILL.md'), rules: rules.length, slug: slug(name, 'writing-desk') }
}
