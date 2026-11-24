/**
 * Side-panel i18n: Chinese source strings, English lookup table.
 *
 * The dictionary is keyed by the exact Chinese copy so pages can call t() with
 * the source text directly. When a key is missing English falls back to the
 * source, which keeps untranslated strings visible instead of blank.
 */

export type Lang = 'zh' | 'en'
export type LanguagePreference = 'system' | Lang

export const LANGUAGE_STORAGE_KEY = 'language'

export interface TranslationVars {
  [key: string]: string | number
}

const EN: Record<string, string> = {
  // AppShell
  '收录': 'Save',
  '投递': 'Dispatch',
  '账号': 'Accounts',
  '检查中': 'Checking',
  '已连接': 'Connected',
  '连接中': 'Connecting',
  '未配对': 'Not paired',
  'DSwritesync 本地助手连接状态': 'DSwritesync local helper status',
  '设置': 'Settings',

  // Stash page
  '收录当前页': 'Save current page',
  '正在读取当前标签页…': 'Reading the current tab…',
  '尚未读取页面': 'No page read yet',
  '刷新当前页': 'Refresh current page',
  '刷新': 'Refresh',
  '本地助手未配对': 'Local helper not paired',
  '重启一次 DeepSeek Harness 会自动修复注册，并确认本机装有 Node.js；详情见设置页的连接状态。': 'Restart DeepSeek Harness once to repair the registration automatically, and make sure Node.js is installed; see the connection status in Settings.',
  '重新检查': 'Check again',
  '打开设置': 'Open settings',
  '正在读取当前页': 'Reading the current page',
  '无法读取当前页': "Couldn't read the current page",
  '请打开一个网页后重试。': 'Open a web page and try again.',
  '重新读取': 'Read again',
  '已采集当前选区': 'Captured the current selection',
  '链接': 'Link',
  '标题': 'Title',
  '文章标题': 'Article title',
  '正文': 'Content',
  '粘贴或输入 Markdown 正文': 'Paste or type Markdown content',
  '正文较长，已按可采集范围截断，可手动补全。': 'The content was truncated to what could be captured; you can fill in the rest manually.',
  '封面': 'Cover',
  '截取中…': 'Capturing…',
  '截取当前页': 'Capture current page',
  '封面预览': 'Cover preview',
  '移除封面': 'Remove cover',
  '暂无封面': 'No cover',
  '截取失败，可重试或留空。': 'Capture failed. Try again or leave it empty.',
  '标签': 'Tags',
  '移除标签 {tag}': 'Remove tag {tag}',
  '已达 {max} 个标签上限': 'Tag limit of {max} reached',
  '继续添加…': 'Add more…',
  '输入标签，回车添加': 'Type a tag and press Enter',
  '工作台已有标签': 'Tags already in your desk',
  '复制 Markdown': 'Copy Markdown',
  '已复制 Markdown': 'Markdown copied',
  '收录中…': 'Saving…',
  '已收录': 'Saved',
  '已收录。图文创作台没在运行，它下次启动后会出现在灵感墙': 'Saved. The desk is not running; this page will appear on your wall after its next launch.',
  '收录没有被工作台收下': 'The desk did not accept this capture',
  '这条链接已经收录过，没有重复建卡': 'This link was already saved; no duplicate card was created',
  '收录至工作台': 'Save to desk',
  '这个页面已经收录过': 'This page was already saved',
  '「{title}」已存在工作台中。保留原条目，还是用当前内容替换？': '"{title}" is already in your desk. Keep the existing item or replace it with the current content?',
  '当前页面': 'current page',
  '保留原条目': 'Keep existing',
  '替换': 'Replace',
  '当前页无法读取': "Couldn't read the current page",
  '刷新失败，请重试': 'Refresh failed. Try again.',
  '最多添加 {max} 个标签': 'You can add up to {max} tags',
  '复制失败，请手动选择正文': 'Copy failed. Select the content manually.',
  '收录失败，请重试': 'Save failed. Try again.',
  '已保留原条目，本次未收录': 'Kept the existing item; nothing was saved.',
  '没有收到页面读取结果': 'No page read result was returned',
  '读取当前页失败': 'Failed to read the current page',
  '当前页没有可收录的内容': 'Nothing on this page can be saved',
  '本地助手没有回应': 'The local helper did not respond',
  '工作台未能收录该网页': 'The desk could not save this page',
  '收录失败': 'Save failed',
  '当前页没有可收录的正文': 'This page has no content to save',
  '未连接到工作台': 'Not connected to the desk',
  '没有活动标签页': 'No active tab',
  '当前页不支持提取': 'This page cannot be extracted',
  '未能提取当前页正文': "Couldn't extract the page content",
  '本地助手没有回应(超时)': 'The local helper did not respond (timed out)',
  '未配对：本地助手未注册或 Node.js 缺失，重启一次 DeepSeek Harness': 'Not paired: the local helper is not registered or Node.js is missing — restart DeepSeek Harness once',
  '本地助手中途退出，请查看投递箱目录里的 helper.log': 'The local helper exited unexpectedly; check helper.log in the mailbox directory',
  '分片拉取失败': 'Shard fetch failed',
  '任务没有可投递的平台': 'The task has no platforms to dispatch to',
  '工作台投递': 'Desk dispatch',

  // Settings page
  '通用': 'General',
  '语言': 'Language',
  '跟随系统': 'Follow system',
  '中文': 'Chinese',
  '连接': 'Connection',
  'DSwritesync 本地助手': 'DSwritesync local helper',
  '扩展与图文创作台经浏览器 Native Messaging 直连：装好两边即自动配对，无需 token 或端口配置。': 'The extension connects to the desk over browser Native Messaging: once both sides are installed, pairing is automatic — no token or port setup.',
  '未配对时：重启一次 DeepSeek Harness（启动即自动注册修复），确认本机装有 Node.js，然后回到本页查看状态。': 'If not paired: restart DeepSeek Harness once (launching repairs the registration automatically), make sure Node.js is installed, then come back here to check the status.',
  '图文创作台没在运行:现在收录的网页会在它下次启动后出现在灵感墙。': 'The desk is not running: pages captured now will appear on your wall after its next launch.',
  '投递设置': 'Dispatch',
  '常用平台': 'Common platforms',
  '隐藏不常用的平台 · {shown}/{total} 个显示': 'Hide less-used platforms · {shown}/{total} shown',
  '加载平台列表中…': 'Loading platforms…',
  '深度格式清理': 'Deep format cleanup',
  '投递前通过 Markdown 清理格式，可能损失部分排版': 'Clean up formatting with Markdown before dispatching; some layout may be lost',
  '自建站点': 'Self-hosted sites',
  '关于': 'About',
  '版本': 'Version',
  '许可': 'License',
  '返回设置': 'Back to settings',
  '全选': 'Show all',
  '全不选': 'Hide all',

  // Accounts page
  '支持 XML-RPC 或 REST API': 'Supports XML-RPC or REST API',
  '支持 XML-RPC 接口': 'Supports XML-RPC',
  '通用博客接口协议（博客园等）': 'Generic blog API protocol (Cnblogs and others)',
  '已登录': 'Signed in',
  '去登录': 'Sign in',
  '加载失败': 'Load failed',
  '配置 {name}': 'Configure {name}',
  '输入站点信息以连接': 'Enter the site details to connect',
  '站点名称': 'Site name',
  '我的博客': 'My blog',
  '站点地址': 'Site URL',
  '用户名': 'Username',
  '密码': 'Password',
  '密码仅存储在本地，不会上传到任何服务器': 'The password is stored locally and is never uploaded to any server',
  '连接中...': 'Connecting...',
  '添加站点': 'Add site',
  '添加自建站点': 'Add self-hosted site',
  '选择博客系统类型': 'Choose a blog system',
  '平台状态加载失败': 'Failed to load platform status',
  '重试': 'Retry',
  '未登录': 'Not signed in',
  '未连接': 'Not connected',
  '测试连接': 'Test connection',
  '添加': 'Add',
  '删除': 'Delete',
  '暂无自建站点': 'No self-hosted sites yet',
  '添加 WordPress / Typecho 等': 'Add WordPress / Typecho and others',
  '添加失败': 'Add failed',
  '{authed}/{total} 已登录': '{authed}/{total} signed in',
  '不支持的 CMS 类型': 'Unsupported CMS type',
  '账户不存在': 'Account not found',
  '密码未找到，请重新添加账户': 'Password not found; add the account again',
  '连接失败': 'Connection failed',

  // Dispatch page
  '来自工作台投递：{title}': 'From your desk: {title}',
  '还没有投递任务。在工作台发布对话框点「投递」，任务会出现在这里。': 'No dispatch tasks yet. Click "Dispatch" in the workbench publish dialog and the task will show up here.',
  '投递中': 'Dispatching',
  '投递中…': 'Dispatching…',
  '投递完成': 'Dispatch complete',
  '投递失败': 'Dispatch failed',
  '清除': 'Clear',

  // Dispatch progress list
  '已取消': 'Cancelled',
  '完成': 'Done',
  '取消': 'Cancel',
  '草稿': 'Draft',
  '查看': 'View',
  '失败': 'Failed',
  '准备中': 'Preparing',
  '图片 {current}/{total}': 'Image {current}/{total}',
  '上传图片': 'Uploading images',
  '保存中': 'Saving',
  '未执行': 'Skipped',
  '等待中': 'Waiting',
  '正在提取文章内容...': 'Extracting article content...',
  '无法连接当前页提取脚本': "Couldn't reach the page extraction script",
  '提取失败': 'Extraction failed',

  // Background / bridge client
  'CMS 账户不存在': 'CMS account not found',
  '密码未找到': 'Password not found',
  '工作台拒绝了收录请求': 'The desk rejected the capture request',

  // Adapter error mapping
  '登录已失效，请重新登录': 'Your session expired. Sign in again.',
  '登录超时，请重试': 'Sign-in timed out. Try again.',
  '网络错误，请检查网络连接': 'Network error. Check your connection and try again.',
  '没有权限执行此操作': 'You do not have permission to do this.',
  '草稿创建失败，请稍后重试': 'Could not create the draft. Try again later.',
  '操作过于频繁，请稍后再试': 'Too many requests. Try again later.',
  '图片上传失败': 'Image upload failed.',
  '无法连接页面的读取脚本，请刷新页面后重试': "Couldn't reach this page's reader script. Refresh the page and try again.",
}

let activeLang: Lang = resolveSystemLang()
let initialized = false
const listeners = new Set<(lang: Lang) => void>()

function resolveSystemLang(): Lang {
  if (typeof navigator === 'undefined') return 'zh'
  const tag = navigator.language || navigator.languages?.[0] || ''
  return tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return value === 'zh' || value === 'en' ? value : 'system'
}

export function preferenceToLang(preference: LanguagePreference): Lang {
  return preference === 'system' ? resolveSystemLang() : preference
}

export function currentLang(): Lang {
  return activeLang
}

/**
 * Content scripts run inside the host page; changing that page's <html lang>
 * would misrepresent it. Only extension pages own their document language.
 */
function ownsDocumentLanguage(): boolean {
  return typeof document !== 'undefined'
    && (typeof location === 'undefined' || location.protocol === 'chrome-extension:')
}

export function setActiveLang(lang: Lang): void {
  const changed = lang !== activeLang
  activeLang = lang
  if (ownsDocumentLanguage()) {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }
  if (!changed) return
  for (const listener of listeners) listener(lang)
}

function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  )
}

/**
 * Translate a Chinese source string (plus optional {var} interpolation).
 * Missing English entries fall back to the Chinese source.
 */
export function t(text: string, vars?: TranslationVars): string {
  const template = activeLang === 'zh' ? text : EN[text] ?? text
  return interpolate(template, vars)
}

/**
 * Adapter errors come from upstream in mixed Chinese/English. Map the common
 * user-facing failure modes to localized copy; anything else falls back to the
 * original message so real diagnostic detail is never hidden.
 */
const ADAPTER_ERROR_RULES: ReadonlyArray<{ pattern: RegExp; message: string }> = [
  {
    // Chrome 通道错误(收录页最常见):内容脚本没注入或通道断了,英文原文直出最伤观感
    pattern: /receiving\s+end\s+does\s+not\s+exist|could\s+not\s+establish\s+connection|message\s+port\s+closed/i,
    message: '无法连接页面的读取脚本，请刷新页面后重试',
  },
  {
    pattern: /登录(态|状态)?(已)?(失效|过期)|重新登录|session\s+(expired|invalid)|unauthorized|401/i,
    message: '登录已失效，请重新登录',
  },
  {
    pattern: /登录.*(超时|timed?\s*out)|login.*timeout/i,
    message: '登录超时，请重试',
  },
  {
    pattern: /未登录|未登陆|请先登录|not\s+(signed|logged)\s+in|login\s+required|must\s+login|please\s+log\s*in/i,
    message: '未登录',
  },
  {
    pattern: /网络(错误|异常|失败|连接|超时)|连接(失败|超时)|请求(失败|超时)|超时|failed\s+to\s+fetch|fetch\s+failed|network\s*(error|failure)|timed?\s*out|timeout|ECONN|socket/i,
    message: '网络错误，请检查网络连接',
  },
  {
    pattern: /无权限|没有权限|权限不足|forbidden|permission\s+denied|403/i,
    message: '没有权限执行此操作',
  },
  {
    pattern: /草稿(创建|保存)?失败|failed\s+to\s+(create|save)\s+(the\s+)?draft|draft\s+(creation|save)\s+failed/i,
    message: '草稿创建失败，请稍后重试',
  },
  {
    pattern: /频率|过于频繁|操作频繁|请求频繁|too\s+many\s+requests|rate\s*limit|429/i,
    message: '操作过于频繁，请稍后再试',
  },
  {
    pattern: /图片上传失败|上传图片失败|image\s+upload\s+failed/i,
    message: '图片上传失败',
  },
]

export function translateAdapterError(error: string | null | undefined): string {
  if (!error) return ''
  // 规则对两种语言都生效:平台错误中英混杂,zh 模式同样需要映射到可读文案;
  // 未命中的消息保持原文——真实的诊断细节永远不藏
  for (const rule of ADAPTER_ERROR_RULES) {
    if (rule.pattern.test(error)) return t(rule.message)
  }
  return t(error)
}

export function onLanguageChange(listener: (lang: Lang) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function readLanguagePreference(): Promise<LanguagePreference> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return 'system'
  try {
    const stored = await chrome.storage.local.get(LANGUAGE_STORAGE_KEY)
    return normalizeLanguagePreference(stored[LANGUAGE_STORAGE_KEY])
  } catch {
    return 'system'
  }
}

export async function writeLanguagePreference(preference: LanguagePreference): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  try {
    await chrome.storage.local.set({ [LANGUAGE_STORAGE_KEY]: preference })
  } catch {
    // Storage may be unavailable in a torn-down extension context.
  }
}

function handleStorageChange(
  changes: Record<string, chrome.storage.StorageChange>,
  areaName: string,
): void {
  if (areaName !== 'local' || !changes[LANGUAGE_STORAGE_KEY]) return
  const preference = normalizeLanguagePreference(changes[LANGUAGE_STORAGE_KEY].newValue)
  setActiveLang(preferenceToLang(preference))
}

/**
 * Apply the stored preference and keep following it. Safe to call repeatedly.
 */
export function initI18n(): void {
  if (initialized) return
  initialized = true

  setActiveLang(activeLang)

  if (typeof chrome === 'undefined' || !chrome.storage?.local) return

  void (async () => {
    setActiveLang(preferenceToLang(await readLanguagePreference()))
  })()
  chrome.storage.onChanged.addListener(handleStorageChange)
}