// Host 英文词典：key 是中文原文，{name} 是占位符。
// 成稿在创作会话里发生(ADR 0006):生图、分镜、口播等流水线词条随流水线一起退役。
export const EN = {
  // 请求与文件
  未授权: 'Not authorized',
  内容太大: 'The content is too large',
  '请求不是有效的 JSON': 'The request is not valid JSON',
  不支持的文件类型: 'Unsupported file type',
  文件不存在: 'File not found',
  '不支持这种文件：{type}': 'Unsupported file: {type}',
  未知: 'unknown',
  路径无效: 'Invalid path',
  接口不存在: 'Not found',
  不支持的方法: 'Method not allowed',
  拒绝跨站请求: 'Cross-site request refused',
  操作: 'Action',

  // 风格
  '{url}：页面上几乎没有文字，可能需要登录': '{url}: there is almost no text on the page. It may require sign-in.',
  '{url}：{error}': '{url}: {error}',
  手动: 'Manual',

  // 收藏
  '收藏《{title}》': 'Save "{title}"',

  // 网页抓取
  '只支持 http 和 https 链接': 'Only http and https links are supported',
  不能抓取本机地址: 'Can\'t fetch addresses on this machine',
  不能抓取内网地址: 'Can\'t fetch private network addresses',
  跳转次数过多: 'Too many redirects',
  '页面返回 {status}，可能需要登录或被平台拦截': 'The page returned {status}. It may need a login or be blocked by the platform.',
  '这不是网页（{type}）': 'This isn\'t a web page ({type})',
  未知类型: 'unknown type',

  // 桥接投递箱(ADR 0009/0012)
  '链接必须是 http(s) 地址': 'The link must be an http(s) address',
  封面图片太大: 'The cover image is too large',
  封面地址不受支持: 'The cover address is not supported',
  投递格式无效: 'Invalid delivery payload',
  '从浏览器收下《{title}》': 'Taken in from the browser: "{title}"',
  '同一编号的投递内容与上次不同,拒绝处理': 'The delivery with the same id has different content than last time; refused',
  '记下发布投递': 'Record publish dispatch',
  回执格式无效: 'Invalid receipt payload',
  '同一编号的回执内容与上次不同,拒绝处理': 'The receipt with the same id has different content than last time; refused',
  投递缺少平台: 'The dispatch is missing a platform',
  没有可投递的平台: 'No platform to dispatch to',
  '至少选一个可投递的平台': 'Pick at least one dispatchable platform',

  // 保存与发布交接
  导出发布包: 'Export publish pack',
  '《{title}》已发布': '"{title}" marked as published',
  这份作品还没有正文: 'This work has no body yet',
  保存作品: 'Save work',
  还没有保存过: 'Not saved yet',
  未命名: 'Untitled',
  '选择成稿保存文件夹': 'Choose a folder for the work',
  文件夹不存在: 'The folder does not exist',
  '无法打开文件夹选择器': 'Could not open the folder picker',

  // 回执
  '找不到对象：{id}': 'Not found: {id}',
  未排期: 'Not scheduled',
  灵感内容为空: 'The idea is empty',
  '{date}的视频': 'Video from {date}',
  '{date}的图片': 'Image from {date}',
  '记下灵感《{title}》': 'Saved idea "{title}"',
  '更新《{title}》': 'Updated "{title}"',
  '删除《{title}》': 'Deleted "{title}"',
  排期时间无效: 'Invalid schedule time',
  '把《{title}》排到 {when}': 'Scheduled "{title}" for {when}',
  '取消《{title}》的排期': 'Unscheduled "{title}"',
  状态无效: 'Invalid status',
  '《{title}》状态改为「{status}」': 'Moved "{title}" to {status}',
  '修改《{title}》': 'Edited "{title}"',
  目标读者: 'Target reader',
  人物需要名字: 'A person needs a name',
  '添加人物「{name}」': 'Added person "{name}"',
  '更新人物「{name}」': 'Updated person "{name}"',
  '删除人物「{name}」': 'Deleted person "{name}"',
  角度需要名字: 'An angle needs a name',
  '添加创作角度「{name}」': 'Added angle "{name}"',
  '更新创作角度「{name}」': 'Updated angle "{name}"',
  '删除创作角度「{name}」': 'Deleted angle "{name}"',
  风格需要名字: 'A style needs a name',
  '添加风格「{name}」': 'Added style "{name}"',
  '更新风格「{name}」': 'Updated style "{name}"',
  '删除风格「{name}」': 'Deleted style "{name}"',
  不再使用特定风格: 'No longer using a specific style',
  '之后按「{name}」的风格写': 'Writing in the "{name}" style from now on',
  'Skill 需要名字和规则': 'A writing rule needs a name and a rule',
  '沉淀规则「{name}」': 'Added writing rule "{name}"',
  '更新规则「{name}」': 'Updated writing rule "{name}"',
  '删除规则「{name}」': 'Deleted writing rule "{name}"',
  已清空全部示例数据: 'Cleared all sample data',
  '移除示例成员后，你的胶囊「{name}」将不足两名成员。请先调整或解散该胶囊；本次未改动任何数据。': 'Removing sample ideas would leave your capsule "{name}" with fewer than two members. Adjust or dissolve that capsule first. Nothing was changed.',
  '不支持的操作：{op}': 'Unsupported operation: {op}',

  // 状态
  灵感: 'Idea',
  大纲: 'Outline',
  草稿: 'Draft',
  待发布: 'Ready',
  已发布: 'Published',

  // 成稿输入与会话写回(ADR 0006)
  '会话写回了《{title}》': 'The session wrote back "{title}"',
  // 作品是第一实体(ADR 0013):成稿、写回、删除都落在作品上
  '开始成稿《{title}》': 'Started "{title}"',
  新作品: 'New work',
  '删除作品《{title}》': 'Deleted work "{title}"',
  '这篇作品在别处更新过（你手上是第 {base} 版，现在是第 {rev} 版）': 'This work was updated elsewhere (you have v{base}, it is now v{rev})',
  '找不到这篇作品：{id}': 'Work not found: {id}',
  '成稿需要至少一条灵感': 'A work needs at least one idea as its source',
  '这份作品还没有正文，先写点内容再发布': 'This work has no body yet. Write something before publishing',
  '这次写回没有可写的内容': 'Nothing to write back',

  // 风格学习(ADR 0014):host 把会话转录与发布稿拼成材料
  没有选作品: 'No works selected',
  '一次最多学习 6 篇作品': 'Learn from at most 6 works at a time',
  作品不存在: 'Work not found',
  所选作品还没有正文: 'The selected works have no body yet',
  没有登记创作会话: 'No writing session recorded',
  宿主没有提供会话读取能力: 'The host does not provide session reading',
  '创作会话里没有可读的文字': 'No readable text in the writing session',

  // 导出 Skill
  '导出 Skill': 'Export skill',
  '还没有你自己的风格或规则。示例规则和模板不会被导出': 'You don\'t have your own style or writing rules yet. Sample rules and presets are never exported.',
  '作者的自媒体写作风格和规则。写选题、脚本、标题或封面文案时使用。': 'The author\'s social media writing style and rules. Use it when writing topics, scripts, titles or cover text.',
  '风格：{name}': 'Style: {name}',
  必须遵守的规则: 'Rules to follow',
  '：': ': ',
  '（依据：{evidence}）': ' (based on: {evidence})',
  图文写作风格: 'Writing style',
  '由「图文创作台」沉淀，更新于 {date}。': 'Generated by Writing Desk. Updated {date}.',

  // 胶囊
  胶囊至少要收进两条灵感: 'A capsule needs at least two ideas',
  '灵感 {ids} 不存在，收不进胶囊': 'Idea {ids} not found, can\'t add it to a capsule',
  '把 {n} 条灵感收进胶囊《{name}》': 'Added {n} idea(s) to capsule "{name}"',
  '把《{title}》收进胶囊《{name}》': 'Taken into capsule "{name}": "{title}"',
  新胶囊: 'New capsule',
  '更新胶囊《{name}》': 'Updated capsule "{name}"',
  '胶囊《{name}》成员不足两个，已自动解散': 'Capsule "{name}" has fewer than two ideas and was dissolved automatically',
  // 胶囊是一张卡:排期、状态、发布都按整体改(ADR 0011)
  '把胶囊《{name}》排到 {when}': 'Scheduled capsule "{name}" for {when}',
  '取消胶囊《{name}》的排期': 'Unscheduled capsule "{name}"',
  '胶囊《{name}》状态改为「{status}」': 'Moved capsule "{name}" to {status}',
  '解散胶囊《{name}》，{n} 条灵感仍在': 'Dissolved capsule "{name}". Its {n} idea(s) are untouched',

  // 标签:挂在灵感上的字符串,改名/删除遍历改写
  标签名不能为空: 'The tag name cannot be empty',
  '标签 #{from} 改名为 #{to}（{n} 条）': 'Tag #{from} renamed to #{to} ({n} idea(s))',
  '删除了标签 #{tag}（{n} 条）': 'Removed tag #{tag} ({n} idea(s))',

  // 自媒体工作台迁移
  '自媒体工作台的数据格式不认识': 'The media desk data format is not recognized',
  没有找到自媒体工作台的数据: 'No media desk data found',
  从自媒体工作台迁移: 'Migrate from the media desk',
  导出位置无效: 'Invalid export location',
}
