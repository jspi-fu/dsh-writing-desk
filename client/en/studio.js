// 英文词典（studio）。key 是中文原文，value 是英文。
export const STUDIO = {
  // 状态和类型（util.js 里的 STATUS_LABEL、KIND_LABEL）

  // 平台

  // 风格分类（util.js 里的 STYLE_CATEGORIES）

  // 灵感墙首屏
  '{m} 月 {d} 日': '{mon} {d}',
  '灵感视图': 'Idea layout',
  '收进胶囊': 'Add to capsule',

  // 卡片和邮票
  '{kind}：{title}': '{kind}: {title}',
  '今天还没有记录，记一条': 'Nothing yet today. Add one',
  '{label} 没有记录': '{label}: no ideas',
  '{label}：{title}，共 {n} 条': '{label}: {title} ({n} total)',

  // 素材接驳条（dock.jsx）
  '拖到这里，把素材写进对话': 'Drop here to add material to the conversation',

  // 作品编辑器（work-editor.jsx）：左写作右预览，停笔自动保存，冲突摆两条路
  '作品': 'Work',
  '作品编辑器': 'Work editor',
  '正文写回这一篇': 'Write back to this work',
  '标题': 'Title',
  '封面文案': 'Cover text',
  '一句话顶在封面上': 'One line on the cover',
  '正文': 'Body',
  '正文从这儿开始……也可以先让 AI 起草': 'Start writing — or let the AI draft first',
  '正文已复制': 'Body copied',
  '复制正文': 'Copy body',
  '保存文件夹': 'Save to folder',
  '打开保存的文件夹': 'Show in folder',
  '导出发布包': 'Export publish pack',
  '这篇还没有正文。': 'No body yet on this one.',
  '近似预览': 'Approximate preview',
  '平台形态': 'Platform shape',
  '编辑': 'Edit',
  '分栏': 'Split',
  '预览': 'Preview',
  '显示方式': 'View mode',
  '已保存': 'Saved',
  '未保存': 'Unsaved',
  '有冲突': 'Conflict',
  '用最新的': 'Use the latest',
  '用我的覆盖': 'Overwrite with mine',
  '这篇作品在别处更新过': 'This work was updated elsewhere',
  '让 AI 写': 'Ask AI to write',
  '发布': 'Publish',
  '标记已发布': 'Mark as published',
  '投递': 'Dispatch',
  '投递中…': 'Dispatching…',
  '投递到浏览器扩展(只到草稿箱)': 'Dispatch to the browser extension (drafts only)',
  '选择平台': 'Pick platforms',
  '已投递给浏览器扩展,完成后这里会亮起草稿链接': 'Sent to the browser extension; draft links show up here when done',
  '已到草稿箱': 'In drafts',
  '投递失败': 'Dispatch failed',
  '发布包已导出': 'Publish pack exported',
  '停笔约 0.7 秒自动保存': 'Saves about 0.7s after you stop typing',
  '删除作品': 'Delete work',
  '删除这篇作品？来源素材会留着，还能再成稿。': 'Delete this work? Its sources stay and can start a new work.',
  '字': ' word{s}',
  '收起': 'Collapse',

  // 作品页（content.jsx）：我的作品画廊 + 流程看板
  '我的作品': 'My works',
  '流程': 'Pipeline',
  '已投递': 'Submitted',

  // 发布交接（导出发布包 + 用户确认发布状态）
  '发布包(article.md + images/):{dir}': 'Publish pack (article.md + images/): {dir}',

  // 编辑界面（点开一条灵感进入的地方）
  '编辑灵感': 'Edit idea',
  '删除这条灵感': 'Delete this idea',
  '打开草稿': 'Open draft',
  '处理中…': 'Working…',
  "投递只把草稿送进平台草稿箱;真的发了才点「标记已发布」。": "Dispatch only drops the draft into the platform's draft box. Mark it published only once it's actually live.",
  '这篇作品在别处更新过（你手上是第 {base} 版，现在是第 {rev} 版）': 'This work was updated elsewhere (you have v{base}, it is now v{rev})',
}
