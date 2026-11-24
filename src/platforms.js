// 平台清单的唯一来源:排期平台与桥投递适配器都是纯数据,Host 与 Client 半片
// 共用这一份,改平台名单不用再跨文件同步(此前的三份副本已经收敛到这里)。
// 自建站是动态目标,不在静态表里:扩展经本地助手上报 bridge/targets.json(ADR 0017)。
// 不 import 任何模块:client 经 esbuild 打进浏览器,这里必须保持零依赖。

/** 排期可选的平台(灵感/胶囊的 platform 字段取值)。 */
export const PLATFORMS = ['公众号', '小红书', '知乎']

// 平台与适配器 id 的映射:与 extension/packages/core/src/adapters/platforms 的
// 内容适配器一致(20 个内容平台,排除 zip-download;xiaohongshu 为页面自动化草稿)。
export const BRIDGE_ADAPTERS = {
  weixin: '公众号',
  zhihu: '知乎',
  juejin: '掘金',
  weibo: '微博',
  bilibili: 'B站',
  douban: '豆瓣',
  baijiahao: '百家号',
  sohu: '搜狐号',
  csdn: 'CSDN',
  segmentfault: '思否',
  yuque: '语雀',
  xueqiu: '雪球',
  woshipm: '人人都是产品经理',
  '51cto': '51CTO',
  imooc: '慕课手记',
  oschina: '开源中国',
  cnblogs: '博客园',
  eastmoney: '东方财富',
  aliyun: '阿里云开发者社区',
  xiaohongshu: '小红书',
}
