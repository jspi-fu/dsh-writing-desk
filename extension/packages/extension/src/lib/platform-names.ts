/**
 * Platform id -> localized display name.
 *
 * Adapter `meta.name` stays Chinese upstream; the side panel maps the shared
 * platform id set to zh/en names instead.
 */

import { currentLang, type Lang } from './i18n'

type PlatformNames = Record<Lang, string>

export const PLATFORM_NAMES: Record<string, PlatformNames> = {
  zhihu: { zh: '知乎', en: 'Zhihu' },
  juejin: { zh: '掘金', en: 'Juejin' },
  weixin: { zh: '微信公众号', en: 'WeChat Official Accounts' },
  weibo: { zh: '微博', en: 'Weibo' },
  bilibili: { zh: '哔哩哔哩', en: 'Bilibili' },
  douban: { zh: '豆瓣', en: 'Douban' },
  baijiahao: { zh: '百家号', en: 'Baijiahao' },
  sohu: { zh: '搜狐号', en: 'Sohu' },
  csdn: { zh: 'CSDN', en: 'CSDN' },
  segmentfault: { zh: '思否', en: 'SegmentFault' },
  yuque: { zh: '语雀', en: 'Yuque' },
  xueqiu: { zh: '雪球', en: 'Xueqiu' },
  woshipm: { zh: '人人都是产品经理', en: 'Woshipm' },
  '51cto': { zh: '51CTO', en: '51CTO' },
  imooc: { zh: '慕课手记', en: 'Imooc Notes' },
  oschina: { zh: '开源中国', en: 'OSChina' },
  cnblogs: { zh: '博客园', en: 'Cnblogs' },
  eastmoney: { zh: '东方财富', en: 'Eastmoney' },
  aliyun: { zh: '阿里云开发者社区', en: 'Alibaba Cloud Developer Community' },
  xiaohongshu: { zh: '小红书', en: 'Xiaohongshu' },
  'zip-download': { zh: 'Markdown 压缩包', en: 'Markdown Archive' },
}

export function platformDisplayName(id: string | undefined, fallback?: string): string {
  if (!id) return fallback || ''
  return PLATFORM_NAMES[id]?.[currentLang()] ?? fallback ?? id
}