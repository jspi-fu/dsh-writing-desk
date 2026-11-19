/**
 * CLI 语言脚手架（DSwritesync Phase 3a / 5a）。
 *
 * 解析顺序：`--lang` > `DSWRITESYNC_LANG` > `~/.dsh/writing-desk/config.json` > 系统 locale。
 * 覆盖全部命令的 help、运行输出与图片提示；必须在 Commander 定义命令之前初始化：
 * help 文本是定义时生成的，preAction 来不及。
 */
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

export type Lang = 'zh' | 'en'

const zh: Record<string, string> = {
  'cli.description': 'DSwritesync — 把文章同步到多个内容平台，并为工作台提供本地收进 / 投递服务',
  'cli.bannerTagline': '从网页收进，同步到平台草稿箱',
  'cli.bannerQuickstart': '快速开始:',
  'cli.bannerServe': '启动本地服务（WS + 投递箱）',
  'cli.bannerSync': '同步 Markdown 文件',
  'cli.bannerExtract': '从浏览器提取文章',
  'cli.bannerPlatforms': '支持的平台: 知乎、掘金、微信公众号、微博、B站、CSDN 等 20+ 平台',
  'cli.website': '官网',
  'cli.github': 'GitHub',
  'global.timeout': '等待 Extension 连接超时（毫秒）',
  'global.lang': '输出语言：zh 或 en（默认跟随系统）',
  'help.usage': '用法:',
  'help.arguments': '参数:',
  'help.options': '选项:',
  'help.commands': '命令:',
  'help.help': '显示帮助信息',
  'help.version': '显示版本号',
  'help.helpCommand': '显示指定命令的帮助',
  'help.default': '默认',
  'help.choices': '可选值',
  'help.preset': '预设',
  'help.env': '环境变量',
  'install.badge': ' 需要安装 Chrome 扩展 ',
  'install.intro': 'DSwritesync CLI 需要配合 Chrome 扩展使用。',
  'install.role': '扩展负责处理各平台的登录状态和 API 调用。',
  'install.steps': '安装步骤:',
  'install.step1': '  1. 访问官网安装扩展:',
  'install.step2': '  2. 运行 dswritesync serve，把生成的 Token 粘贴到扩展设置页',
  'install.step3': '  3. 配置环境变量:',
  'install.tokenCommand': 'export WECHATSYNC_TOKEN="你的token"',
  'install.step4': '  4. 在各平台（知乎、掘金等）登录你的账号',
  'install.step5': '  5. 重新运行此命令',
  'install.openPrompt': '是否打开扩展安装页面? (y/N) ',
  'install.opening': '正在打开浏览器...',
  'bridge.starting': '启动服务...',
  'bridge.secondaryWait': '检测到已有实例，等待其完成或接管端口...',
  'bridge.waitExtension': '等待 Chrome Extension 连接...',
  'bridge.connectedSecondary': 'Chrome Extension 已连接（通过 PRIMARY 转发）',
  'bridge.connected': 'Chrome Extension 已连接',
  'bridge.timeoutUnreachable': '连接超时: 端口被占用但无法与已有实例通讯',
  'bridge.oldProcess': '可能是旧的 dswritesync 进程未正常退出',
  'bridge.portHolder': '  端口 {port} 占用进程: {process}',
  'bridge.solution': '解决方法:',
  'bridge.killCommand': '  1. 终止旧进程: {command}',
  'bridge.otherPort': '  2. 使用其他端口: {command}',
  'bridge.timeoutNoExtension': '连接超时: 已有实例正在运行但 Chrome Extension 未连接',
  'bridge.enableHint': '请确保 Chrome 扩展已启用「同步桥接」并且 Token 正确',
  'sync.description': '同步 Markdown/HTML 文件到平台（HTML 文件可保留自定义排版样式）',
  'sync.platformsOption': '目标平台，逗号分隔',
  'sync.titleOption': '文章标题（默认从文件提取）',
  'sync.coverOption': '封面图 URL 或本地路径',
  'sync.dryRunOption': '仅显示将要执行的操作，不实际同步',
  'sync.fileMissing': '文件不存在: {file}',
  'sync.titleMissing': '无法从文件提取标题，请使用 --title 指定',
  'sync.titleHint': '提示: Markdown 文件需要包含 # 标题或 YAML front matter',
  'sync.coverMissing': '封面图文件不存在: {file}',
  'sync.summary': '同步信息:',
  'sync.fieldFile': '文件',
  'sync.fieldTitle': '标题',
  'sync.fieldFormat': '格式',
  'sync.fieldPlatforms': '平台',
  'sync.fieldContent': '内容',
  'sync.fieldCover': '封面',
  'sync.keepLayout': ' (保留原始排版)',
  'sync.localImage': '(本地图片)',
  'sync.chars': '{count} 字符',
  'sync.dryRun': '(dry-run 模式，不实际同步)',
  'sync.preview': '内容预览:',
  'sync.localImages': '发现 {count} 张本地图片，上传到 {platform}...',
  'sync.imageResult': '图片上传完成: {ok} 成功, {failed} 失败',
  'sync.imageHostOthers': '(其他平台将从 {platform} 图床转存)',
  'sync.uploading': '正在同步...',
  'sync.results': '同步结果:',
  'sync.draftOnly': '(草稿)',
  'sync.unknownError': '未知错误',
  'sync.done': '同步完成: {ok} 成功, {failed} 失败',
  'sync.failed': '同步失败',
  'platforms.description': '列出所有支持的平台',
  'platforms.authOption': '同时显示登录状态',
  'platforms.loading': '获取平台列表...',
  'platforms.header': '支持的平台 ({count}):',
  'platforms.signedIn': '✓ 已登录',
  'platforms.signedOut': '✗ 未登录',
  'platforms.failed': '获取失败',
  'auth.description': '检查平台登录状态',
  'auth.refreshOption': '强制刷新状态',
  'auth.loading': '检查登录状态...',
  'auth.signedIn': '✓ {platform} 已登录',
  'auth.signedOut': '✗ {platform} 未登录',
  'auth.user': '用户:',
  'auth.error': '错误:',
  'auth.header': '登录状态:',
  'auth.signedInHeader': '已登录 ({count}):',
  'auth.signedOutHeader': '未登录 ({count}):',
  'auth.failed': '检查失败',
  'extract.description': '从当前浏览器页面提取文章',
  'extract.outputOption': '输出到文件',
  'extract.loading': '提取文章...',
  'extract.failed': '提取失败',
  'extract.empty': '无法从当前页面提取文章内容，请确认当前页面包含文章',
  'extract.saved': '✓ 已保存到: {file}',
  'extract.savedHint': '  同步到平台: dswritesync sync {file}',
  'extract.title': '标题:',
  'extract.preview': '内容预览:',
  'extract.previewHint': '提示: 使用 -o article.md 保存后可通过 dswritesync sync article.md 同步',
  'media.skipped': '  ⚠ 跳过: {file}（文件不存在或格式不支持）',
  'media.converted': '  ✓ 转换: {file}',
  'media.uploaded': '  ✓ 上传: {file}',
  'media.failed': '  ✗ 失败: {file} - {error}',
  'serve.description': '启动本地服务：WS 连接扩展、监听工作台投递箱、生成桥接 token',
  'serve.tokenOption': '固定桥接 token（默认读环境变量 / auth.json，没有则生成 UUID）',
  'serve.hostOption': 'WebSocket 绑定地址',
  'serve.wsPortOption': 'WebSocket 端口（默认 9527）',
  'serve.httpPortOption': '本机 HTTP 转发端口（默认 WS 端口 + 1，只绑回环）',
  'serve.starting': '正在启动本地服务…',
  'serve.running': '本地服务已启动：ws://{host}:{wsPort} · http://127.0.0.1:{httpPort}',
  'serve.authWritten': '桥接信息已写入 {file}（目录 0700 / 文件 0600，best-effort）',
  'serve.tokenTail': 'Token 末尾 {tail}；完整值只从 auth.json 读取，不在终端打印',
  'serve.tokenHint': '工作台设置页可读取 Token；把同一 Token 粘进扩展设置即可连接',
  'serve.portBusy': '端口 {port} 已被占用，serve 需要独占端口；如果已有实例在运行，请直接使用 `dswritesync sync`（它会走 HTTP 转发）',
  'serve.portInvalid': '端口必须是 1–65535 的整数：{port}',
  'serve.portSame': 'WebSocket 与 HTTP 端口不能相同',
  'serve.secondary': '端口被占用，serve 不能以降级（secondary）模式运行',
  'serve.startFailed': '本地服务启动失败：{error}',
  'serve.extensionConnected': '扩展已连接（协议 {version}，语言 {lang}）',
  'serve.extensionDisconnected': '扩展断开，等待重连…',
  'serve.captureQueued': '收进任务已入队：{operationId}',
  'serve.captureRejected': '收进任务被拒绝：{error}',
  'serve.captureWriteFailed': '收进任务写盘失败：{error}',
  'serve.payloadRequired': 'payload 缺失',
  'serve.operationIdRequired': 'operationId 缺失或格式非法',
  'serve.platformsRequired': 'platforms 缺失',
  'serve.ignoredEvent': '忽略未知事件 {event}',
  'serve.catalogMissing': 'catalog.json 不存在或无效，已返回空表',
  'serve.taskReceived': '收到投递任务 {operationId} → {platforms}',
  'serve.taskWaiting': '扩展未连接，任务 {operationId} 等待重试（{count}/{max}）',
  'serve.taskDone': '投递完成 {operationId}：{summary}',
  'serve.taskSkipped': '已有回执，跳过投递任务 {operationId}',
  'serve.taskInvalid': '投递文件无效，已留档：{error}',
  'serve.taskFailed': '投递失败 {operationId}：{error}',
  'serve.resultMissing': '扩展没有返回该平台的结果',
  'serve.imageConverted': '图片已转为 data URI：{ref}',
  'serve.imageUploaded': '图片已分片上传：{ref} → {url}',
  'serve.imageSkipped': '图片读取失败，保留原引用：{ref}',
  'serve.stopped': '本地服务已停止',
  'serve.log': '扩展日志 [{level}] {message}',
  'serve.captureResult': '已推送收进回执：{operationId}',
  'serve.badArgs': '参数无效：{error}',
}

const en: Record<string, string> = {
  'cli.description': 'DSwritesync — sync articles to multiple publishing platforms and serve the workspace locally',
  'cli.bannerTagline': 'capture from the web, sync to platform drafts',
  'cli.bannerQuickstart': 'Quick start:',
  'cli.bannerServe': 'start the local service (WS + drop boxes)',
  'cli.bannerSync': 'sync a Markdown file',
  'cli.bannerExtract': 'extract the current browser article',
  'cli.bannerPlatforms': 'Supported platforms: Zhihu, Juejin, WeChat Official Accounts, Weibo, Bilibili, CSDN, and 20+ more',
  'cli.website': 'Website',
  'cli.github': 'GitHub',
  'global.timeout': 'timeout waiting for the Extension connection (ms)',
  'global.lang': 'output language: zh or en (defaults to system locale)',
  'help.usage': 'Usage:',
  'help.arguments': 'Arguments:',
  'help.options': 'Options:',
  'help.commands': 'Commands:',
  'help.help': 'display help for command',
  'help.version': 'output the version number',
  'help.helpCommand': 'display help for command',
  'help.default': 'default',
  'help.choices': 'choices',
  'help.preset': 'preset',
  'help.env': 'env',
  'install.badge': ' Chrome extension required ',
  'install.intro': 'The DSwritesync CLI works together with the Chrome extension.',
  'install.role': 'The extension handles sign-in state and API calls for each platform.',
  'install.steps': 'Setup steps:',
  'install.step1': '  1. Install the extension from the website:',
  'install.step2': '  2. Run dswritesync serve and paste the generated token into the extension settings',
  'install.step3': '  3. Set the environment variable:',
  'install.tokenCommand': 'export WECHATSYNC_TOKEN="<token>"',
  'install.step4': '  4. Sign in to your accounts on each platform (Zhihu, Juejin, etc.)',
  'install.step5': '  5. Run this command again',
  'install.openPrompt': 'Open the extension install page? (y/N) ',
  'install.opening': 'Opening the browser…',
  'bridge.starting': 'Starting service…',
  'bridge.secondaryWait': 'Existing instance detected; waiting for it to finish or hand over the port…',
  'bridge.waitExtension': 'Waiting for the Chrome extension to connect…',
  'bridge.connectedSecondary': 'Chrome extension connected (via PRIMARY forwarding)',
  'bridge.connected': 'Chrome extension connected',
  'bridge.timeoutUnreachable': 'Connection timed out: the port is occupied but the existing instance is unreachable',
  'bridge.oldProcess': 'An old dswritesync process may not have exited cleanly',
  'bridge.portHolder': '  Process holding port {port}: {process}',
  'bridge.solution': 'How to fix:',
  'bridge.killCommand': '  1. Kill the old process: {command}',
  'bridge.otherPort': '  2. Use a different port: {command}',
  'bridge.timeoutNoExtension': 'Connection timed out: an instance is running but no Chrome extension is connected',
  'bridge.enableHint': 'Make sure the Chrome extension has Sync Bridge enabled and the token is correct',
  'sync.description': 'sync a Markdown/HTML file to platforms (HTML keeps its custom styling)',
  'sync.platformsOption': 'target platforms, comma-separated',
  'sync.titleOption': 'article title (defaults to the file)',
  'sync.coverOption': 'cover image URL or local path',
  'sync.dryRunOption': 'preview the planned actions without syncing',
  'sync.fileMissing': 'File not found: {file}',
  'sync.titleMissing': 'Could not extract a title from the file; pass one with --title',
  'sync.titleHint': 'Hint: a Markdown file needs an H1 heading or YAML front matter',
  'sync.coverMissing': 'Cover image not found: {file}',
  'sync.summary': 'Sync details:',
  'sync.fieldFile': 'File',
  'sync.fieldTitle': 'Title',
  'sync.fieldFormat': 'Format',
  'sync.fieldPlatforms': 'Platforms',
  'sync.fieldContent': 'Content',
  'sync.fieldCover': 'Cover',
  'sync.keepLayout': ' (custom layout preserved)',
  'sync.localImage': '(local image)',
  'sync.chars': '{count} characters',
  'sync.dryRun': '(dry run — nothing is synced)',
  'sync.preview': 'Content preview:',
  'sync.localImages': 'Found {count} local images; uploading to {platform}…',
  'sync.imageResult': 'Image upload finished: {ok} succeeded, {failed} failed',
  'sync.imageHostOthers': '(other platforms copy images from the {platform} image host)',
  'sync.uploading': 'Syncing…',
  'sync.results': 'Sync results:',
  'sync.draftOnly': '(draft)',
  'sync.unknownError': 'Unknown error',
  'sync.done': 'Sync finished: {ok} succeeded, {failed} failed',
  'sync.failed': 'Sync failed',
  'platforms.description': 'list all supported platforms',
  'platforms.authOption': 'also show sign-in status',
  'platforms.loading': 'Fetching platforms…',
  'platforms.header': 'Supported platforms ({count}):',
  'platforms.signedIn': '✓ signed in',
  'platforms.signedOut': '✗ not signed in',
  'platforms.failed': 'Failed to fetch platforms',
  'auth.description': 'check platform sign-in status',
  'auth.refreshOption': 'force a status refresh',
  'auth.loading': 'Checking sign-in status…',
  'auth.signedIn': '✓ {platform}: signed in',
  'auth.signedOut': '✗ {platform}: not signed in',
  'auth.user': 'User:',
  'auth.error': 'Error:',
  'auth.header': 'Sign-in status:',
  'auth.signedInHeader': 'Signed in ({count}):',
  'auth.signedOutHeader': 'Not signed in ({count}):',
  'auth.failed': 'Sign-in check failed',
  'extract.description': 'extract the article from the current browser tab',
  'extract.outputOption': 'write to a file',
  'extract.loading': 'Extracting article…',
  'extract.failed': 'Extract failed',
  'extract.empty': 'Could not extract an article from this page; make sure it contains one',
  'extract.saved': '✓ Saved to {file}',
  'extract.savedHint': '  Sync it: dswritesync sync {file}',
  'extract.title': 'Title:',
  'extract.preview': 'Content preview:',
  'extract.previewHint': 'Hint: save with -o article.md, then run dswritesync sync article.md',
  'media.skipped': '  ⚠ skipped: {file} (missing or unsupported format)',
  'media.converted': '  ✓ inlined: {file}',
  'media.uploaded': '  ✓ uploaded: {file}',
  'media.failed': '  ✗ failed: {file} - {error}',
  'serve.description': 'start the local service: WS bridge, outbox watcher, and bridge token',
  'serve.tokenOption': 'fixed bridge token (defaults to env / auth.json, else a new UUID)',
  'serve.hostOption': 'WebSocket bind address',
  'serve.wsPortOption': 'WebSocket port (default 9527)',
  'serve.httpPortOption': 'local HTTP forward port (default WS port + 1, loopback only)',
  'serve.starting': 'Starting the local service…',
  'serve.running': 'Local service running: ws://{host}:{wsPort} · http://127.0.0.1:{httpPort}',
  'serve.authWritten': 'Bridge auth written to {file} (dir 0700 / file 0600, best-effort)',
  'serve.tokenTail': 'Token tail {tail}; the full value stays in auth.json and is never printed',
  'serve.tokenHint': 'Read the token from the workspace settings and paste it into the extension settings',
  'serve.portBusy': 'Port {port} is already in use; serve needs exclusive ports. If an instance is already running, use `dswritesync sync` (it forwards over HTTP)',
  'serve.portInvalid': 'Port must be an integer between 1 and 65535: {port}',
  'serve.portSame': 'WebSocket and HTTP ports must differ',
  'serve.secondary': 'Ports are occupied; serve cannot run in secondary mode',
  'serve.startFailed': 'Failed to start the local service: {error}',
  'serve.extensionConnected': 'Extension connected (protocol {version}, language {lang})',
  'serve.extensionDisconnected': 'Extension disconnected; waiting for reconnect…',
  'serve.captureQueued': 'Capture queued: {operationId}',
  'serve.captureRejected': 'Capture rejected: {error}',
  'serve.captureWriteFailed': 'Failed to write capture: {error}',
  'serve.payloadRequired': 'payload is missing',
  'serve.operationIdRequired': 'operationId is missing or invalid',
  'serve.platformsRequired': 'platforms is missing',
  'serve.ignoredEvent': 'Ignored unknown event {event}',
  'serve.catalogMissing': 'catalog.json missing or invalid; returned an empty catalog',
  'serve.taskReceived': 'Dispatch task {operationId} → {platforms}',
  'serve.taskWaiting': 'Extension not connected; task {operationId} retry ({count}/{max})',
  'serve.taskDone': 'Dispatch finished {operationId}: {summary}',
  'serve.taskSkipped': 'Receipt already exists; skipped dispatch task {operationId}',
  'serve.taskInvalid': 'Invalid dispatch file, kept for inspection: {error}',
  'serve.taskFailed': 'Dispatch failed {operationId}: {error}',
  'serve.resultMissing': 'The extension returned no result for this platform',
  'serve.imageConverted': 'Image inlined as data URI: {ref}',
  'serve.imageUploaded': 'Image uploaded in chunks: {ref} → {url}',
  'serve.imageSkipped': 'Could not read image; keeping original reference: {ref}',
  'serve.stopped': 'Local service stopped',
  'serve.log': 'Extension log [{level}] {message}',
  'serve.captureResult': 'Capture result pushed: {operationId}',
  'serve.badArgs': 'Invalid arguments: {error}',
}

/** 平台 ID → 英文名；中文名沿用上游 meta.name，不在此重复维护。 */
const platformNamesEn: Record<string, string> = {
  zhihu: 'Zhihu',
  juejin: 'Juejin',
  weixin: 'WeChat Official Accounts',
  weibo: 'Weibo',
  bilibili: 'Bilibili',
  douban: 'Douban',
  baijiahao: 'Baijiahao',
  sohu: 'Sohu',
  csdn: 'CSDN',
  segmentfault: 'SegmentFault',
  yuque: 'Yuque',
  xueqiu: 'Xueqiu',
  woshipm: 'Woshipm',
  '51cto': '51CTO',
  imooc: 'Imooc',
  oschina: 'OSChina',
  cnblogs: 'Cnblogs',
  eastmoney: 'Eastmoney',
  aliyun: 'Alibaba Cloud Developer',
  xiaohongshu: 'Xiaohongshu',
  'zip-download': 'Markdown Zip',
}

const dictionaries: Record<Lang, Record<string, string>> = { zh, en }

let currentLang: Lang = resolveLang(process.argv.slice(2), process.env)

/** 把 zh-CN / en-US / 大小写等变体归一为 zh|en；无法识别返回 null。 */
function normalizeLang(value: unknown): Lang | null {
  if (typeof value !== 'string') return null
  const lower = value.trim().toLowerCase().replace(/_/g, '-')
  if (lower === 'zh' || lower.startsWith('zh-')) return 'zh'
  if (lower === 'en' || lower.startsWith('en-')) return 'en'
  return null
}

/** 系统 locale → zh|en（非中文一律英文）。 */
function systemLang(): Lang {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale
    return normalizeLang(locale) ?? 'en'
  } catch {
    return 'en'
  }
}

function readConfigLang(env: NodeJS.ProcessEnv): Lang | null {
  try {
    const file = join(env.DSH_HOME || join(homedir(), '.dsh'), 'writing-desk', 'config.json')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    return normalizeLang(raw?.lang ?? raw?.language)
  } catch {
    return null
  }
}

/**
 * 预扫描语言（在 Commander 定义命令之前调用）。
 * @param argv - 进程参数（不含 node 与脚本路径）。
 * @param env - 环境变量。
 */
export function resolveLang(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Lang {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--lang' && i + 1 < argv.length) {
      const value = normalizeLang(argv[i + 1])
      if (value) return value
    } else if (arg.startsWith('--lang=')) {
      const value = normalizeLang(arg.slice('--lang='.length))
      if (value) return value
    }
  }
  const fromEnv = normalizeLang(env.DSWRITESYNC_LANG)
  if (fromEnv) return fromEnv
  const fromConfig = readConfigLang(env)
  if (fromConfig) return fromConfig
  return systemLang()
}

/** 初始化/覆盖当前语言（index.ts 在定义 Commander 前调用）。 */
export function initLang(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Lang {
  currentLang = resolveLang(argv, env)
  return currentLang
}

/** 显式设置语言；非法值回退到系统 locale。 */
export function setLang(lang: unknown): Lang {
  currentLang = normalizeLang(lang) ?? systemLang()
  return currentLang
}

export function getLang(): Lang {
  return currentLang
}

/**
 * 按当前语言选平台显示名。
 * 中文用上游 meta.name（fallbackName）；英文按 id 映射，未知 id 回退上游名。
 * @param id - 平台 ID。
 * @param fallbackName - 扩展返回的平台名。
 */
export function platformDisplayName(id: string, fallbackName?: string): string {
  if (currentLang === 'en') return platformNamesEn[id] ?? fallbackName ?? id
  return fallbackName || id
}

/**
 * 取翻译并代入 `{name}` 占位符。
 * @param key - 字典键。
 * @param vars - 占位符值。
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = dictionaries[currentLang][key] ?? zh[key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (
    vars[name] === undefined ? match : String(vars[name])
  ))
}