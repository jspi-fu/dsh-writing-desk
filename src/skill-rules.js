// 规则口径的单一事实源:实时 rules skill、导出的 SKILL.md 都从这里取分档与用法说明。
// 两处各写一份阈值/措辞会漂移(导出文件会缺"怎么用"),这里统一定义一次。

const ZH = (s) => s

/** 置信度分档:给模型一个可执行的优先次序,低档先当候选。 */
export function ruleBand(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0.5
  if (n >= 0.8) return 'high'
  if (n >= 0.6) return 'mid'
  return 'low'
}

export function ruleKind(rule) {
  return rule?.kind === 'soft' ? 'soft' : 'hard'
}

/** 一条规则的正文:方括号是提炼记录,不是要照抄的句子。 */
export function formatRule(rule, t = ZH) {
  const kind = ruleKind(rule) === 'soft' ? t('软范式') : t('硬规则')
  const band = ruleBand(rule.confidence)
  const label = band === 'high' ? t('高') : band === 'mid' ? t('中') : t('低')
  const evidence = rule.evidence ? ` 依据:${rule.evidence}` : ''
  return `- [${kind}·${t('置信度')}${label}] **${rule.name}**:${rule.rule}${evidence}`
}

/**
 * 规则列表的用法与完成判据:读完就按优先级动笔,规则本身留在心里,不写进正文。
 * 正向陈述目标,避免把"照抄/凑数"这些失败模式带进上下文。
 */
export function rulesGuide(t = ZH) {
  return `## ${t('怎么用这些规则')}\n\n- ${t('硬规则每篇照做,软范式按场景取用')}。\n- ${t('置信度低的先当候选,宁可少写几条,也要保住具体感')}。\n- ${t('方括号与依据只作判断用,正文按自己的写法写')}。\n- ${t('读完就按上面的优先级动笔,把规则用在文字里')}。\n`
}
