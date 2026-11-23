// 首次安装自动分发的完整演示，与灵感示例共用 sample 标记和统一清理入口。
import { currentLang, normalizeLang } from './i18n.js'
import { makeWork as workFrom } from './work.js'

const HOUR = 60 * 60 * 1000
const A = name => `writing-desk/assets/${name}`

function at(now, hours) {
  return new Date(now.getTime() + hours * HOUR).toISOString()
}

function snapshot(items, ids) {
  return ids.map(itemId => {
    const item = items.find(row => row.id === itemId)
    return { itemId, title: item?.title ?? '', kind: item?.kind ?? 'note' }
  })
}

/**
 * 生成一批结构完整的演示实体。所有相对时间都锚定首次建库的 now。
 * @param {Date|string} now - 首次建库的基准时间。
 * @param {'zh'|'en'} [lang] - 演示文字语言。
 * @returns {{items: object[], capsules: object[], works: object[]}}
 */
export function buildDemo(now, lang = currentLang()) {
  const base = now instanceof Date ? now : new Date(now)
  const en = normalizeLang(lang) === 'en'
  const text = (zh, english) => en ? english : zh
  const poster = A('poster.jpg')
  const tags = (zh, english) => en ? ['Demo', english] : ['演示', zh]
  const makeItem = (id, createdHours, fields) => ({
    id,
    kind: 'note',
    title: '',
    body: '',
    tags: [],
    status: 'idea',
    angleId: null,
    personaIds: [],
    parentId: null,
    url: null,
    source: '',
    media: null,
    scheduledAt: null,
    platform: null,
    createdAt: at(base, createdHours),
    sample: true,
    demo: true,
    ...fields,
  })

  const items = [
    makeItem('demo_item_01', -96, {
      kind: 'image',
      title: text('街区观察：一家小店怎样留住熟客', 'Street notes: how a small shop keeps regulars'),
      body: text('从菜单、灯光和店主的招呼方式里，找出三个可以写成故事的细节。', 'Find three story-worthy details in the menu, lighting and the owner’s welcome.'),
      tags: tags('选题', 'Ideas'),
      status: 'ready',
      source: text('周末街拍', 'Weekend street notes'),
      media: { src: A('facade.jpg'), w: 720, h: 940 },
      scheduledAt: at(base, -26),
      reminder: true,
      remindedAt: null,
      platform: '公众号',
    }),
    makeItem('demo_item_02', -95, {
      kind: 'quote',
      title: text('熟客记住的不是折扣，是被认真对待的感觉。', 'Regulars remember feeling valued, not discounts.'),
      body: text('可以作为街区观察的结尾，也可以单独扩成一篇短评。', 'Use this to close the street story, or expand it into a short essay.'),
      tags: tags('金句', 'Quotes'),
      status: 'ready',
      source: text('采访速记', 'Interview notes'),
      scheduledAt: at(base, -26),
      reminder: true,
      remindedAt: null,
      platform: '公众号',
    }),
    makeItem('demo_item_03', -72, {
      kind: 'web',
      title: text('把复杂功能讲清楚的五个产品示例', 'Five products that explain complex features well'),
      body: text('比较它们怎样安排示例、空状态和第一步操作，整理成自己的写作提纲。', 'Compare their examples, empty states and first actions, then turn the patterns into an outline.'),
      tags: tags('产品', 'Product'),
      status: 'ready',
      source: 'example.com',
      url: 'https://example.com/demo/product-tour',
      media: { src: A('topo.jpg'), w: 720, h: 720 },
      scheduledAt: at(base, 2),
      reminder: true,
      remindedAt: null,
      platform: '小红书',
    }),
    makeItem('demo_item_04', -71, {
      kind: 'note',
      title: text('产品示例拆解提纲', 'Product example outline'),
      body: text('先给结论，再看两个正反例，最后留下一张可复用的检查清单。', 'Lead with the conclusion, compare two positive and negative examples, then leave a reusable checklist.'),
      tags: tags('提纲', 'Outline'),
      status: 'ready',
      source: text('写作提纲', 'Writing outline'),
      scheduledAt: at(base, 2),
      reminder: true,
      remindedAt: null,
      platform: '小红书',
    }),
    makeItem('demo_item_05', -48, {
      kind: 'image',
      title: text('慢写实验：七天只围绕一个问题', 'Slow writing: seven days around one question'),
      body: text('不追热点，记录同一个问题每天长出的新答案。', 'Skip the news cycle and record how one question grows a new answer each day.'),
      tags: tags('写作', 'Writing'),
      status: 'draft',
      source: text('封面实验', 'Cover experiment'),
      media: { src: poster, w: 720, h: 960 },
    }),
    makeItem('demo_item_06', -47, {
      kind: 'note',
      title: text('慢写实验的读者反馈', 'Reader notes from the slow-writing experiment'),
      body: text('读者最想看的不是成果，而是每天如何决定写什么、删掉什么。', 'Readers want the daily decisions about what to write and cut more than the final result.'),
      tags: tags('反馈', 'Feedback'),
      status: 'draft',
      source: text('读者来信', 'Reader letters'),
    }),
    makeItem('demo_item_07', -30, {
      kind: 'image',
      title: text('留白的力量：删掉一半功能之后', 'The power of whitespace after cutting half the features'),
      body: text('用三个真实改动说明：删除不是减少价值，而是让价值被看见。', 'Three real changes show how deletion can reveal value rather than reduce it.'),
      tags: tags('设计', 'Design'),
      status: 'draft',
      source: text('产品观察', 'Product notes'),
      media: { src: A('sea.jpg'), w: 900, h: 600 },
    }),
    makeItem('demo_item_08', -12, {
      kind: 'video',
      title: text('周末短片：一座城市醒来的声音', 'Weekend short: the sound of a city waking up'),
      body: text('用街道、早餐铺和第一班公交车串起 45 秒旁白。', 'Use streets, breakfast stalls and the first bus to connect a 45-second voice-over.'),
      tags: tags('短片', 'Video'),
      status: 'outline',
      source: text('分镜草图', 'Storyboard sketch'),
      media: { src: A('v-bus.mp4'), poster: A('v-bus-poster.jpg'), w: 720, h: 480 },
      scheduledAt: at(base, 30),
      reminder: true,
      remindedAt: null,
      platform: '知乎',
    }),
  ]

  const capsules = [
    {
      id: 'demo_capsule_01',
      name: text('街区小店故事', 'Neighborhood shop story'),
      itemIds: ['demo_item_01', 'demo_item_02'],
      createdAt: at(base, -90),
      sample: true,
      demo: true,
    },
    {
      id: 'demo_capsule_02',
      name: text('产品表达案例库', 'Product communication examples'),
      itemIds: ['demo_item_03', 'demo_item_04'],
      createdAt: at(base, -70),
      sample: true,
      demo: true,
    },
  ]

  const makeWork = (id, sourceItemIds, sourceCapsuleIds, current, publication, updatedHours) => ({
    ...workFrom({
      id,
      sourceItemIds,
      sourceCapsuleIds,
      sourceSnapshot: snapshot(items, sourceItemIds),
      current: { ...current, rev: 1 },
      publication,
      createdAt: at(base, updatedHours - 4),
      updatedAt: at(base, updatedHours),
    }),
    sample: true,
    demo: true,
  })

  const works = [
    makeWork(
      'demo_work_draft',
      ['demo_item_05', 'demo_item_06'],
      [],
      {
        title: text('慢写七天，我学会了先不急着给答案', 'Seven days of slow writing taught me to wait for answers'),
        coverText: text('让问题多住几天', 'Let the question stay awhile'),
        article: text('第一天，我只想尽快写完。\n\n到了第四天，读者的问题开始改变我的方向：他们关心的不是结果，而是每天怎样取舍。\n\n第七天，我留下的不是标准答案，而是一套可以继续练习的方法。', 'On day one, I only wanted to finish quickly.\n\nBy day four, reader questions had changed my direction: they cared about the daily choices, not the result.\n\nOn day seven, I had a practice to keep using rather than a final answer.'),
        cover: { src: poster, w: 720, h: 960 },
      },
      { status: 'draft' },
      -5,
    ),
    makeWork(
      'demo_work_submitted',
      ['demo_item_01', 'demo_item_02'],
      ['demo_capsule_01'],
      {
        title: text('一家小店，为什么总能等来熟客', 'Why this small shop always welcomes familiar faces'),
        coverText: text('被认真对待的感觉', 'The feeling of being valued'),
        article: text('推门进去时，店主先叫出了客人的名字。\n\n菜单不长，灯光也不耀眼，但每个细节都在说：我记得你。\n\n熟客愿意回来，不是因为一张折扣券，而是因为这段关系被认真维护。', 'The owner greeted a customer by name before they reached the counter.\n\nThe menu is short and the lighting understated, but every detail says: I remember you.\n\nRegulars return for a relationship that is carefully maintained, not for another coupon.'),
        cover: { src: A('facade.jpg'), w: 720, h: 940 },
      },
      {
        status: 'submitted',
        submittedAt: at(base, -20),
        dispatches: [{ platform: '公众号', ok: true, at: at(base, -20), url: 'https://example.com/demo/submitted' }],
      },
      -20,
    ),
  ]

  const publishedAt = at(base, -28)
  const publishedWork = makeWork(
    'demo_work_published',
    ['demo_item_07'],
    [],
    {
      title: text('删掉一半功能后，产品反而更完整了', 'The product felt more complete after we cut half its features'),
      coverText: text('少，但更清楚', 'Less, but clearer'),
      article: text('我们先删掉重复入口，再合并两组相似设置。\n\n界面里的东西变少了，用户却更快完成了第一步。\n\n留白不是空着，而是给真正重要的内容让出位置。', 'We removed duplicate entry points, then merged two similar groups of settings.\n\nThere was less on screen, yet people completed their first action faster.\n\nWhitespace is not empty; it makes room for what matters.'),
      cover: { src: A('sea.jpg'), w: 900, h: 600 },
    },
    { status: 'published', submittedAt: at(base, -29), publishedAt },
    -28,
  )
  publishedWork.published = { ...publishedWork.current, publishedAt }
  delete publishedWork.published.rev
  works.push(publishedWork)

  return { items, capsules, works }
}

