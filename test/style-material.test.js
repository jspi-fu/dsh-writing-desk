import test from 'node:test'
import assert from 'node:assert/strict'
import { buildStylePrompt, formatTranscript, messagesFromEvents } from '../src/style-material.js'

/** 一篇有正文的作品;默认已发布、没有未发布改动。 */
function work(over = {}) {
  return {
    id: 'w1',
    sourceItemIds: ['i1'],
    sourceCapsuleIds: [],
    sourceSnapshot: [{ itemId: 'i1', title: '灵感一', kind: 'note' }],
    current: { title: '标题', article: '当前稿正文', rev: 2 },
    published: { title: '标题', article: '发布稿正文' },
    publication: { status: 'published' },
    sessionIds: ['s1'],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    ...over,
  }
}

test('messagesFromEvents 只取用户与 AI 的文字,丢掉工具调用与系统事件', () => {
  const events = [
    { type: 'user/message', data: { content: [
      { type: 'text', text: '开头太慢了' },
      { type: 'tool-call', name: 'writing_desk_read', input: {} },
    ] } },
    { type: 'assistant/thinking', data: { text: '想一想' } },
    { type: 'assistant/message', data: { message: { content: [
      { type: 'text', text: '改成先给结论。' },
      { type: 'tool-result', output: '不该进材料' },
    ] } } },
    { type: 'tool/result', data: { output: '也不该进材料' } },
    { type: 'user/message', data: { content: [
      { type: 'text', text: '第二段再具体一点。' },
    ] } },
  ]
  assert.deepEqual(messagesFromEvents(events), [
    { role: 'user', text: '开头太慢了' },
    { role: 'assistant', text: '改成先给结论。' },
    { role: 'user', text: '第二段再具体一点。' },
  ])
  // 没有 content 的系统/空消息直接跳过
  assert.deepEqual(messagesFromEvents([{ type: 'user/message' }, null]), [])
})

test('formatTranscript 标出说话人,并从前面截断超长材料', () => {
  const text = formatTranscript([
    { role: 'user', text: '先给结论' },
    { role: 'assistant', text: '好' },
  ])
  assert.match(text, /【用户】\n先给结论/)
  assert.match(text, /【AI】\n好/)

  const clipped = formatTranscript([{ role: 'user', text: '前'.repeat(200) + '后'.repeat(50) }], 50)
  assert.ok(clipped.startsWith('（前略）\n'))
  assert.ok(clipped.endsWith('后'.repeat(50)))
  assert.ok(!clipped.includes('前前前'))
})

test('buildStylePrompt 带上发布稿、发布后改动与创作对话,并只写候选卡', () => {
  const published = work({
    id: 'w1',
    current: { title: '标题', article: '发布后的新句子', rev: 3 },
    published: { title: '标题', article: '发布稿正文' },
    publication: { status: 'published' },
    sessionSnapshot: undefined,
    sourceSnapshot: [{ itemId: 'i1', title: '灵感一', kind: 'note' }],
  })
  const noTranscript = work({
    id: 'w2',
    current: { title: '第二篇', article: '第二篇正文', rev: 1 },
    published: undefined,
    publication: { status: 'draft' },
    sourceSnapshot: [{ itemId: 'i2', title: '灵感二', kind: 'note' }],
    sessionIds: [],
  })
  const empty = work({
    id: 'w3',
    current: { title: '空稿', article: '   ', rev: 1 },
    published: undefined,
    publication: { status: 'draft' },
    sessionIds: [],
  })
  const state = {
    activeStyleId: 's1',
    styles: [
      { id: 's1', name: '现有腔', summary: '短句、先给结论' },
      { id: 's2', name: '另一张', summary: '口语' },
      { id: 'p1', name: '预设腔', preset: true },
    ],
    skills: [
      { name: '开头规则', rule: '开头先给结论。', status: 'active' },
      { name: '待确认规则', rule: '少用形容词。', status: 'proposed' },
    ],
  }
  const readings = {
    w1: { messages: [
      { role: 'user', text: '开头太慢了' },
      { role: 'assistant', text: '改成先给结论' },
    ] },
    w2: { error: '宿主没有提供会话读取能力' },
  }
  const { prompt, entries, missing } = buildStylePrompt(state, [published, noTranscript, empty], readings, { name: '短句' })

  assert.equal(entries.length, 2, '没有正文的作品不进材料')
  assert.deepEqual(entries[0], { workId: 'w1', title: '标题', state: 'published', messages: 2, hasTranscript: true })
  assert.equal(entries[1].hasTranscript, false)
  assert.equal(missing.length, 1)
  assert.equal(missing[0].workId, 'w2')
  assert.match(missing[0].reason, /宿主没有提供会话读取能力/)

  assert.match(prompt, /发布稿（用户确认的最终版本）/)
  assert.match(prompt, /发布稿正文/)
  assert.match(prompt, /发布后的人工改动（当前稿，未发布）/)
  assert.match(prompt, /发布后的新句子/)
  assert.match(prompt, /第二篇正文/)
  assert.match(prompt, /【用户】\n开头太慢了/)
  assert.match(prompt, /【AI】\n改成先给结论/)
  assert.match(prompt, /没有读到这篇作品的创作对话，只能依据发布稿判断/)
  assert.match(prompt, /《第二篇》没有读到创作对话/)
  assert.match(prompt, /writing_desk_add_rule/)
  assert.match(prompt, /writing_desk_add_style/)
  assert.match(prompt, /activate 设为 false/)
  assert.match(prompt, /风格卡名字用「短句」/)
  assert.match(prompt, /当前风格卡「现有腔」/)
  assert.match(prompt, /已有的我的风格卡:另一张/)
  assert.match(prompt, /待确认规则「待确认规则」:少用形容词/)
  assert.match(prompt, /<material>/)
  assert.doesNotMatch(prompt, /预设腔|空稿/)
})

test('buildStylePrompt 没有可读作品时仍返回空材料与提示', () => {
  const { prompt, entries, missing } = buildStylePrompt({ styles: [], skills: [] }, [], {}, {})
  assert.deepEqual(entries, [])
  assert.deepEqual(missing, [])
  assert.match(prompt, /<material>\n\n<\/material>/)
})

test('buildStylePrompt 把证据链三条硬门槛写进 prompt', () => {
  const { prompt } = buildStylePrompt({ styles: [], skills: [] }, [work()], {}, {})
  // 门槛一:两处原文出处,图片行/链接不算证据
  assert.match(prompt, /门槛一·原文证据/)
  assert.match(prompt, /至少给出 2 处/)
  assert.match(prompt, /图片行/)
  assert.match(prompt, /凑不满 2 处的,不要写成规则/)
  // 门槛二:置信度分档 + 异质样本隔离
  assert.match(prompt, /门槛二·置信度与样本隔离/)
  assert.match(prompt, /confidence\(0~1\)/)
  assert.match(prompt, /单列为异质样本/)
  // 门槛三:事实底稿不进风格证据
  assert.match(prompt, /门槛三·事实与风格分离/)
  assert.match(prompt, /绝不能写进常用词或规则/)
  // 规则结构:硬规则/软范式 + 落库字段
  assert.match(prompt, /kind=hard/)
  assert.match(prompt, /kind=soft/)
  assert.match(prompt, /confidence 按门槛二填/)
})