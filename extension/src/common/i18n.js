// 扩展界面文案:中文为源,英文查表;语言跟随浏览器 UI(与宿主「跟随」策略同一精神)。
const ZH = {}
const EN = {
  '网页收发': 'Capture & Publish',
  '收进书桌': 'Save to desk',
  '收进中…': 'Saving…',
  '已收进': 'Saved',
  '正在读取页面…': 'Reading page…',
  '重新读取页面': 'Retry reading page',
  '检查桥接': 'Check bridge',
  '没有连接到桥。先在工作台设置页复制 Token 粘进扩展设置,再跑 wdesk serve。': 'No bridge. Copy the token from the desk settings into the extension settings, then run "wdesk serve".',
  '已复制 Markdown': 'Markdown copied',
  '复制 Markdown': 'Copy Markdown',
  '只有可见文字被收进来': 'Only the visible text was captured',
  '正文太长,截到了 20000 字': 'Content over 20000 chars — truncated',
  '这条页面已经收过了': 'This page is already in your desk',
  '保留原有的': 'Keep existing',
  '替换为新内容': 'Replace with new',
  '标签': 'Tags',
  '还没配对桥:收进书桌前先完成三步': 'Bridge not paired — three steps first',
  '工作台设置页复制桥接 Token': 'Copy the bridge token from the desk settings',
  '扩展设置页粘贴保存': 'Paste & save it in the extension settings',
  '终端跑 wdesk serve 起桥': 'Run "wdesk serve" in a terminal',
  '去配对': 'Pair now',
  '打开原页': 'Open page',
  '标题': 'Title',
  '链接': 'Link',
  '正文': 'Content',
  '封面': 'Cover',
  '发布任务': 'Publish task',
  '发布只到草稿箱,正式发布由你在平台确认': 'Drafts only — publishing on the platform is your call',
  '排队中': 'Queued',
  '上传图片 {n}/{m}': 'Uploading images {n}/{m}',
  '完成': 'Done',
  '失败': 'Failed',
  '桥已连接': 'Bridge connected',
  '桥未连接': 'Bridge offline',
  '扩展设置': 'Extension settings',
  '保存设置': 'Save',
  '桥接 Token': 'Bridge token',
  '把工作台设置页显示的 Token 粘在这里': 'Paste the token shown in the desk settings',
  '桥地址': 'Bridge address',
  '设置已保存,正在连接…': 'Saved — connecting…',
  '已保存': 'Saved',
}

const lang = (globalThis.navigator?.language ?? 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en'

export function t(text) {
  if (lang === 'zh') return text
  return EN[text] ?? text
}

export function currentLang() {
  return lang
}
