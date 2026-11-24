// 风格:把一个人的写法固定成一张卡。写回会话与导出 Skill 都经 styleToVoice 变成写作要求。
import { currentLang } from './i18n.js'

/** 把风格卡变成写作要求。 */
export function styleToVoice(style) {
  if (!style) return ''
  // 这段也会写进导出的 Skill 文件，英文界面时用英文标签
  const en = currentLang() === 'en'
  const [overall, tone, sentences, opening, structure, logic, story, flow, words, avoid, samples, sep] = en
    ? ['Overall: ', 'Tone: ', 'Sentences: ', 'Opening: ', 'Structure: ', 'Reasoning: ', 'Storytelling: ', 'Transitions: ', 'Go-to words: ', 'Never: ', 'Sample lines (study the rhythm, write your own):', ', ']
    : ['整体：', '语气：', '句式：', '开头：', '结构：', '逻辑：', '讲述：', '衔接：', '常用词：', '绝不要：', '样句（学节奏，正文另写）：', '、']
  const lines = [
    style.summary && `${overall}${style.summary}`,
    style.tone && `${tone}${style.tone}`,
    style.sentences && `${sentences}${style.sentences}`,
    style.opening && `${opening}${style.opening}`,
    style.structure && `${structure}${style.structure}`,
    style.logic && `${logic}${style.logic}`,
    style.story && `${story}${style.story}`,
    style.flow && `${flow}${style.flow}`,
    style.words?.length && `${words}${style.words.join(sep)}`,
    style.avoid?.length && `${avoid}${style.avoid.join(sep)}`,
    style.samples?.length && `${samples}\n${style.samples.map(row => `- ${row}`).join('\n')}`,
  ]
  return lines.filter(Boolean).join('\n')
}

export function activeStyle(state) {
  return state.styles?.find(row => row.id === state.activeStyleId) ?? null
}
