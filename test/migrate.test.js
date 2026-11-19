// 自媒体工作台迁移的领域测试:不启 HTTP,直接喂 state.json 形状的数据。
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrateMediaDesk, summarizeMediaDesk } from '../src/migrate.js'
import { buildSeed } from '../src/seed.js'

const NOW = new Date('2026-10-31T15:00:00+08:00')

function source() {
  return {
    activeStyleId: 'preset_x',
    angles: [{ id: 'case', name: '真实案例', hook: '一个人做了什么', prompt: '从具体的人切入' }],
    people: [{ id: 'newbie', name: '想入门的小林', role: '目标读者', note: '怕术语', traits: ['想要第一步'], tone: 0 }],
    styles: [{ id: 'preset_x', name: 'AI 科技博主', icon: '🤖', summary: '讲人话', tone: '清醒', words: ['说白了'], samples: ['我试了一下'] }],
    items: [
      {
        id: 'seed_1', kind: 'image', title: '一条灵感', body: '正文', tags: ['AI', 'AI', '变现'],
        status: 'draft', angleId: 'case', personaIds: ['newbie'],
        media: { src: 'media-desk/assets/hills.jpg', w: 900, h: 620 },
        url: null, source: '路上想到', createdAt: '2026-11-09T01:00:00.000Z',
        scheduledAt: '2026-11-11T12:00:00.000Z', platform: '抖音', sample: true,
      },
      {
        id: 'seed_2', kind: 'quote', title: '一句引用', body: '', tags: [], status: 'idea',
        media: null, url: 'https://example.com/post', source: '读书', createdAt: '2026-11-08T03:14:00.000Z',
      },
    ],
  }
}

test('迁移概览按写作台口径归类,quote 算笔记', () => {
  const summary = summarizeMediaDesk(source())
  assert.equal(summary.total, 2)
  assert.deepEqual(summary.kinds, { image: 1, note: 1 })
  assert.equal(summary.media, 1)
  assert.equal(summary.samples, 1)
  assert.equal(summary.scheduled, 1)
})

test('迁移条目:保留时间/状态/标签并重映射角度与读者;重复运行不重复添加', () => {
  const state = buildSeed(NOW)
  const media = new Map([['media-desk/assets/hills.jpg', { src: 'writing-desk/files/md-hills.jpg' }]])
  const result = migrateMediaDesk(state, source(), { media, now: '2026-11-18T00:00:00.000Z' })
  assert.deepEqual(result, { added: 2, skipped: 0, missingMedia: 0 })
  const image = state.items.find(item => item.id === 'md-seed_1')
  assert.equal(image.kind, 'image')
  assert.deepEqual(image.tags, ['AI', '变现'])
  assert.equal(image.status, 'draft')
  assert.equal(image.createdAt, '2026-11-09T01:00:00.000Z')
  assert.equal(image.scheduledAt, '2026-11-11T12:00:00.000Z')
  assert.equal(image.platform, null, '写作台没有抖音这个发布平台')
  assert.equal(image.media.src, 'writing-desk/files/md-hills.jpg')
  assert.equal(image.media.w, 900)
  assert.equal(image.sample, true, '源数据是示例的，迁移后仍可一键清空')
  assert.ok(image.angleId, '角度按名字映射到已有或新建的角度')
  assert.ok(image.personaIds.length, '读者按名字映射')
  const quote = state.items.find(item => item.id === 'md-seed_2')
  assert.equal(quote.kind, 'note')
  assert.equal(quote.url, 'https://example.com/post')
  assert.equal(quote.media, null)
  assert.equal(quote.sample, false)
  // 再跑一次:同源 id 已经存在,跳过
  const again = migrateMediaDesk(state, source(), { media, now: '2026-11-19T00:00:00.000Z' })
  assert.deepEqual(again, { added: 0, skipped: 2, missingMedia: 0 })
  assert.equal(state.items.filter(item => item.id.startsWith('md-')).length, 2)
  assert.equal(state.migrations['dsh-media-desk'], '2026-11-19T00:00:00.000Z')
})

test('同名角度、读者、风格按名字合并,不重复建实体', () => {
  const state = buildSeed(NOW)
  const beforeAngles = state.angles.length
  const beforePeople = state.people.length
  migrateMediaDesk(state, source(), { now: NOW.toISOString() })
  const angle = state.angles.find(row => row.name === '真实案例')
  assert.ok(angle, '已有同名角度直接复用')
  assert.equal(state.angles.filter(row => row.name === '真实案例').length, 1)
  assert.equal(state.angles.length, beforeAngles, '没有新增角度')
  assert.equal(state.people.filter(row => row.name === '想入门的小林').length, 1)
  assert.ok(state.people.length >= beforePeople)
  const style = state.styles.find(row => row.name === 'AI 科技博主')
  assert.ok(style)
  assert.equal(state.activeStyleId, style.id, '当前风格跟着迁移过来')
})

test('媒体文件缺失时条目仍迁移,只丢掉媒体', () => {
  const state = buildSeed(NOW)
  const result = migrateMediaDesk(state, source(), { now: NOW.toISOString() })
  assert.equal(result.missingMedia, 1)
  const image = state.items.find(item => item.id === 'md-seed_1')
  assert.equal(image.media, null)
  assert.equal(image.title, '一条灵感')
})