/**
 * DSwritesync CLI
 *
 * 命令行同步文章到多个内容平台
 *
 * 使用方式:
 *   dswritesync serve
 *   dswritesync sync article.md --platforms zhihu,juejin
 *   dswritesync platforms
 *   dswritesync auth
 */
import { Command, Help } from 'commander'
import type { Argument, Option } from 'commander'
import chalk from 'chalk'
import ora from 'ora'
import open from 'open'
import fs from 'fs'
import path from 'path'
import juice from 'juice'
import { ExtensionBridge } from './bridge/index.js'
import type { PlatformInfo, SyncResult } from './bridge/index.js'
import { findLocalImages, processLocalImages } from './media.js'
import { getLang, initLang, platformDisplayName, t } from './i18n.js'
import { runServe } from './serve.js'

// 语言必须在 Commander 定义命令前解析：help 文本在定义时就已生成。
initLang()

const CLI_VERSION = '2.0.10'
const WS_PORT = parseInt(process.env.SYNC_WS_PORT || '9527', 10)
const HTTP_PORT = parseInt(process.env.SYNC_HTTP_PORT || String(WS_PORT + 1), 10)

// 官网和安装地址
const WEBSITE_URL = 'https://www.wechatsync.com'
const EXTENSION_URL = 'https://www.wechatsync.com/#install'
const GITHUB_URL = 'https://github.com/wechatsync/Wechatsync'

const program = new Command()

/**
 * Commander 内建的 "Usage:" / "Options:" / "Commands:" 与默认值说明是英文；
 * 按当前语言替换，保证 --lang zh 的 help 也全是中文。
 * configureHelp 会把配置对象合并进 Help 实例，因此必须传自有属性函数。
 */
function localizedOptionDescription(option: Option): string {
  const extras: string[] = []
  if (option.argChoices) {
    extras.push(`${t('help.choices')}: ${option.argChoices.map(choice => JSON.stringify(choice)).join(', ')}`)
  }
  if (option.defaultValue !== undefined) {
    const showDefault = option.required || option.optional
      || (option.isBoolean() && typeof option.defaultValue === 'boolean')
    if (showDefault) {
      extras.push(`${t('help.default')}: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`)
    }
  }
  if (option.presetArg !== undefined && option.optional) {
    extras.push(`${t('help.preset')}: ${JSON.stringify(option.presetArg)}`)
  }
  if (option.envVar !== undefined) {
    extras.push(`${t('help.env')}: ${option.envVar}`)
  }
  return extras.length > 0
    ? `${option.description} (${extras.join(', ')})`
    : option.description
}

function localizedArgumentDescription(argument: Argument): string {
  const extras: string[] = []
  if (argument.argChoices) {
    extras.push(`${t('help.choices')}: ${argument.argChoices.map(choice => JSON.stringify(choice)).join(', ')}`)
  }
  if (argument.defaultValue !== undefined) {
    extras.push(`${t('help.default')}: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`)
  }
  return extras.length > 0
    ? `${argument.description} (${extras.join(', ')})`
    : argument.description
}

const ZH_HELP_TERMS: Array<[string, string]> = [
  ['[options]', '[选项]'],
  ['[command]', '[命令]'],
  ['[platform]', '[平台]'],
  ['<file>', '<文件>'],
  ['<platforms>', '<平台>'],
  ['<platform>', '<平台>'],
  ['<title>', '<标题>'],
  ['<url>', '<地址>'],
  ['<output>', '<文件>'],
  ['<ms>', '<毫秒>'],
  ['<lang>', '<语言>'],
  ['<token>', '<Token>'],
  ['<host>', '<主机>'],
  ['<port>', '<端口>'],
]

function localizeHelpTerm(term: string): string {
  if (getLang() !== 'zh') return term
  let next = term
  for (const [from, to] of ZH_HELP_TERMS) next = next.split(from).join(to)
  return next
}

function localizedFormatHelp(cmd: Command, helper: Help): string {
  const termWidth = helper.padWidth(cmd, helper)
  const helpWidth = helper.helpWidth || 80
  const itemIndentWidth = 2
  const itemSeparatorWidth = 2
  const formatItem = (term: string, description?: string): string => {
    if (!description) return term
    const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`
    return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth)
  }
  const formatList = (items: string[]): string => (
    items.join('\n').replace(/^/gm, ' '.repeat(itemIndentWidth))
  )

  let output = [`${t('help.usage')} ${localizeHelpTerm(helper.commandUsage(cmd))}`, '']

  const commandDescription = helper.commandDescription(cmd)
  if (commandDescription.length > 0) {
    output = output.concat([helper.wrap(commandDescription, helpWidth, 0), ''])
  }

  const argumentList = helper.visibleArguments(cmd).map(argument => (
    formatItem(localizeHelpTerm(helper.argumentTerm(argument)), helper.argumentDescription(argument))
  ))
  if (argumentList.length > 0) {
    output = output.concat([t('help.arguments'), formatList(argumentList), ''])
  }

  const optionList = helper.visibleOptions(cmd).map(option => (
    formatItem(localizeHelpTerm(helper.optionTerm(option)), helper.optionDescription(option))
  ))
  if (optionList.length > 0) {
    output = output.concat([t('help.options'), formatList(optionList), ''])
  }

  const commandList = helper.visibleCommands(cmd).map(subcommand => (
    formatItem(localizeHelpTerm(helper.subcommandTerm(subcommand)), helper.subcommandDescription(subcommand))
  ))
  if (commandList.length > 0) {
    output = output.concat([t('help.commands'), formatList(commandList), ''])
  }

  return output.join('\n')
}

// 默认超时时间
let connectionTimeout = 30000

program
  .name('dswritesync')
  .description(t('cli.description'))
  .version(CLI_VERSION, '-V, --version', t('help.version'))
  .option('--timeout <ms>', t('global.timeout'), '30000')
  .option('--lang <lang>', t('global.lang'))
  .helpOption('-h, --help', t('help.help'))
  .configureHelp({
    formatHelp: localizedFormatHelp,
    optionDescription: localizedOptionDescription,
    argumentDescription: localizedArgumentDescription,
  })
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts()
    if (opts.timeout) {
      connectionTimeout = parseInt(opts.timeout)
    }
  })

/**
 * 显示 Extension 安装引导
 */
function showInstallGuide(): void {
  console.log()
  console.log(chalk.bgYellow.black(t('install.badge')))
  console.log()
  console.log(t('install.intro'))
  console.log(t('install.role'))
  console.log()
  console.log(chalk.bold(t('install.steps')))
  console.log()
  console.log(t('install.step1'))
  console.log(`     ${chalk.cyan(EXTENSION_URL)}`)
  console.log()
  console.log(t('install.step2'))
  console.log()
  console.log(t('install.step3'))
  console.log(`     ${chalk.cyan(t('install.tokenCommand'))}`)
  console.log()
  console.log(t('install.step4'))
  console.log()
  console.log(t('install.step5'))
  console.log()
  console.log(chalk.gray(`${t('cli.website')}: ${WEBSITE_URL}`))
  console.log(chalk.gray(`${t('cli.github')}: ${GITHUB_URL}`))
  console.log()
}

/**
 * 询问是否打开安装页面
 */
async function promptOpenInstallPage(): Promise<void> {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(chalk.yellow(t('install.openPrompt')), async (answer) => {
      rl.close()
      if (answer.toLowerCase() === 'y') {
        console.log(chalk.gray(t('install.opening')))
        await open(EXTENSION_URL)
      }
      resolve()
    })
  })
}

// ============ Markdown/HTML 处理 ============

interface ParsedContent {
  title: string | null
  content: string
  format: 'markdown' | 'html'
  /** 从 HTML meta 提取的封面图 */
  cover?: string
  /** 从 HTML meta 提取的摘要 */
  summary?: string
}

/**
 * 解析文件内容，提取标题和正文
 */
function parseFileContent(filePath: string): ParsedContent {
  const content = fs.readFileSync(filePath, 'utf-8')
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.md' || ext === '.markdown') {
    return parseMarkdown(content)
  } else if (ext === '.html' || ext === '.htm') {
    return parseHtml(content, filePath)
  } else {
    // 当作纯文本处理
    return {
      title: path.basename(filePath, ext),
      content: content,
      format: 'markdown',
    }
  }
}

/**
 * 解析 Markdown 文件
 */
function parseMarkdown(content: string): ParsedContent {
  let title: string | null = null
  let body = content

  // 1. 尝试从 YAML front matter 提取
  const yamlMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  if (yamlMatch) {
    const frontMatter = yamlMatch[1]
    const titleMatch = frontMatter.match(/^title:\s*["']?(.+?)["']?\s*$/m)
    if (titleMatch) {
      title = titleMatch[1].trim()
    }
    // 移除 front matter
    body = content.slice(yamlMatch[0].length)
  }

  // 2. 尝试从 # 标题提取
  if (!title) {
    const h1Match = body.match(/^#\s+(.+)$/m)
    if (h1Match) {
      title = h1Match[1].trim()
      // 移除标题行（只移除第一个匹配的）
      body = body.replace(/^#\s+.+\n+/, '')
    }
  }

  // 3. 清理内容
  body = body.trim()

  // 4. 如果内容为空，返回原始内容
  if (!body) {
    body = content
  }

  return {
    title,
    content: body,
    format: 'markdown',
  }
}

/**
 * 解析 HTML 文件
 * 1. 提取标题（title > h1）、meta 信息（封面、摘要）
 * 2. 解析本地 <link rel="stylesheet"> 引用
 * 3. 将 <style> CSS 内联到元素的 style 属性上（juice）
 */
function parseHtml(content: string, filePath?: string): ParsedContent {
  let title: string | null = null

  // 从 <title> 标签提取
  const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i)
  if (titleMatch) {
    title = titleMatch[1].trim()
  }

  // 从 <h1> 标签提取
  if (!title) {
    const h1Match = content.match(/<h1[^>]*>([^<]+)<\/h1>/i)
    if (h1Match) {
      title = h1Match[1].trim()
    }
  }

  // 从 <meta> 标签提取封面和摘要
  let cover: string | undefined
  let summary: string | undefined
  const ogImageMatch = content.match(/<meta\s[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || content.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/i)
  if (ogImageMatch) {
    cover = ogImageMatch[1]
  }
  const descMatch = content.match(/<meta\s[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || content.match(/<meta\s[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)
    || content.match(/<meta\s[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)
  if (descMatch) {
    summary = (descMatch[1] || descMatch[2] || '').trim() || undefined
  }

  // 解析本地 <link rel="stylesheet"> 引用，读取并内联
  const fileDir = filePath ? path.dirname(filePath) : undefined
  if (fileDir) {
    content = content.replace(
      /<link\s[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
      (_match, href: string) => {
        // 只处理本地文件，跳过 http(s) 链接
        if (href.startsWith('http://') || href.startsWith('https://')) return _match
        const cssPath = path.resolve(fileDir, href)
        if (fs.existsSync(cssPath)) {
          const css = fs.readFileSync(cssPath, 'utf-8')
          return `<style>${css}</style>`
        }
        return _match
      }
    )
  }

  // 提取 <style> 标签（可能在 <head> 中），合并到 body
  const styles: string[] = []
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let styleMatch
  while ((styleMatch = styleRegex.exec(content)) !== null) {
    styles.push(styleMatch[0])
  }

  // 提取 body 内容
  let body = content
  const bodyMatch = content.match(/<body[^>]*>([\s\S]*?)<\/body>/i)
  if (bodyMatch) {
    body = bodyMatch[1].trim()
  }

  // 将 <head> 中的 <style> 合并到 body
  const bodyStyles = new Set<string>()
  const bodyStyleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi
  let bs
  while ((bs = bodyStyleRegex.exec(body)) !== null) {
    bodyStyles.add(bs[0])
  }
  const extraStyles = styles.filter(s => !bodyStyles.has(s))
  if (extraStyles.length > 0) {
    body = extraStyles.join('\n') + '\n' + body
  }

  // 用 juice 将 <style> CSS 内联到元素的 style 属性
  // 这样即使平台删除 <style> 标签，样式也能保留
  try {
    body = juice(body, {
      removeStyleTags: true,
      preserveImportant: true,
      preserveMediaQueries: false,
      preserveFontFaces: false,
    })
  } catch (e) {
    // juice 失败不阻塞，保留原始 HTML
  }

  return {
    title,
    content: body,
    format: 'html',
    cover,
    summary,
  }
}

/**
 * 简单的 Markdown 转 HTML（用于需要 HTML 的平台）
 */
function markdownToHtml(markdown: string): string {
  let html = markdown

  // 代码块
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')

  // 行内代码
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  // 标题
  html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>')
  html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')

  // 粗体和斜体
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // 无序列表
  html = html.replace(/^\s*[-*+]\s+(.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')

  // 有序列表
  html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')

  // 引用
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>')

  // 水平线
  html = html.replace(/^---+$/gm, '<hr />')

  // 段落（连续的非空行）
  html = html.replace(/^(?!<[a-z])((?:[^\n]+\n?)+)/gm, (match) => {
    const trimmed = match.trim()
    if (trimmed && !trimmed.startsWith('<')) {
      return `<p>${trimmed}</p>\n`
    }
    return match
  })

  return html
}

// ============ Bridge 连接 ============

/**
 * 检测占用端口的进程信息
 */
async function detectPortProcess(port: number): Promise<string | null> {
  const { execSync } = await import('child_process')
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: 'utf-8' })
      const pid = output.trim().split(/\s+/).pop()
      if (pid) {
        const info = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf-8' }).trim()
        return `PID ${pid} (${info.split(',')[0]?.replace(/"/g, '') || 'unknown'})`
      }
    } else {
      const output = execSync(`lsof -i :${port} -t 2>/dev/null`, { encoding: 'utf-8' }).trim()
      if (output) {
        const pid = output.split('\n')[0]
        const cmdline = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: 'utf-8' }).trim()
        return `PID ${pid} (${cmdline.slice(0, 60)})`
      }
    }
  } catch {
    // 检测失败也没关系
  }
  return null
}

/**
 * 创建并连接 Bridge
 */
async function createBridge(): Promise<ExtensionBridge | null> {
  const bridge = new ExtensionBridge(WS_PORT, { silent: true, httpPort: HTTP_PORT })
  const timeout = connectionTimeout

  // 注册信号处理，确保进程退出时释放端口
  const cleanup = () => {
    bridge.stop()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  const spinner = ora(t('bridge.starting')).start()

  await bridge.start()

  if (bridge.getMode() === 'secondary') {
    spinner.text = t('bridge.secondaryWait')
  } else {
    spinner.text = t('bridge.waitExtension')
  }

  try {
    await bridge.waitForConnection(timeout)
    spinner.succeed(
      bridge.getMode() === 'secondary'
        ? t('bridge.connectedSecondary')
        : t('bridge.connected')
    )
    return bridge
  } catch (error) {
    spinner.stop()
    const errMsg = (error as Error).message || ''

    if (bridge.getMode() === 'secondary') {
      if (errMsg.includes('timeout:unreachable')) {
        // PRIMARY HTTP API 不可达 — 僵尸进程占了 WS 端口但没有 HTTP API
        console.log()
        console.log(chalk.red(t('bridge.timeoutUnreachable')))
        console.log(chalk.gray(t('bridge.oldProcess')))
        console.log()

        const processInfo = await detectPortProcess(WS_PORT)
        if (processInfo) {
          console.log(chalk.yellow(t('bridge.portHolder', { port: WS_PORT, process: processInfo })))
          console.log()
        }

        console.log(chalk.bold(t('bridge.solution')))
        const killCommand = process.platform === 'win32'
          ? 'taskkill /F /PID <pid>'
          : `kill $(lsof -i :${WS_PORT} -t)`
        console.log(t('bridge.killCommand', { command: chalk.cyan(killCommand) }))
        console.log(t('bridge.otherPort', { command: chalk.cyan('SYNC_WS_PORT=9600 dswritesync ...') }))
      } else {
        // PRIMARY 可达但 Extension 没连上
        console.log()
        console.log(chalk.red(t('bridge.timeoutNoExtension')))
        console.log(chalk.gray(t('bridge.enableHint')))
      }
    } else {
      // PRIMARY 模式超时：Extension 没连上来
      showInstallGuide()
      await promptOpenInstallPage()
    }

    console.log()
    bridge.stop()
    return null
  }
}

// ============ serve 命令 ============

program
  .command('serve')
  .description(t('serve.description'))
  .option('--token <token>', t('serve.tokenOption'))
  .option('--host <host>', t('serve.hostOption'), '127.0.0.1')
  .option('--ws-port <port>', t('serve.wsPortOption'))
  .option('--http-port <port>', t('serve.httpPortOption'))
  .action(async (options) => {
    try {
      await runServe({
        token: options.token,
        host: options.host,
        wsPort: options.wsPort === undefined ? undefined : parseInt(options.wsPort, 10),
        httpPort: options.httpPort === undefined ? undefined : parseInt(options.httpPort, 10),
      })
    } catch (error) {
      console.error(chalk.red(t('serve.startFailed', { error: (error as Error).message || String(error) })))
      process.exitCode = 1
    }
  })

// ============ sync 命令 ============

program
  .command('sync <file>')
  .description(t('sync.description'))
  .option('-p, --platforms <platforms>', t('sync.platformsOption'), 'zhihu,juejin')
  .option('-t, --title <title>', t('sync.titleOption'))
  .option('--cover <url>', t('sync.coverOption'))
  .option('--dry-run', t('sync.dryRunOption'))
  .action(async (file: string, options) => {
    // 检查文件是否存在
    const filePath = path.resolve(file)
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(t('sync.fileMissing', { file: filePath })))
      process.exit(1)
    }

    // 解析文件
    const parsed = parseFileContent(filePath)

    // 确定标题
    const title = options.title || parsed.title
    if (!title) {
      console.error(chalk.red(t('sync.titleMissing')))
      console.log(chalk.gray(t('sync.titleHint')))
      process.exit(1)
    }

    // 处理封面图（优先使用命令行参数，回退到 HTML meta）
    let cover = options.cover || parsed.cover
    if (cover && !cover.startsWith('http') && !cover.startsWith('data:')) {
      // 本地文件，转为 base64
      const coverPath = path.resolve(cover)
      if (fs.existsSync(coverPath)) {
        const coverBuffer = fs.readFileSync(coverPath)
        const ext = path.extname(coverPath).toLowerCase()
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
        }
        const mimeType = mimeTypes[ext] || 'image/png'
        cover = `data:${mimeType};base64,${coverBuffer.toString('base64')}`
      } else {
        console.error(chalk.red(t('sync.coverMissing', { file: coverPath })))
        process.exit(1)
      }
    }

    const platforms = options.platforms.split(',').map((p: string) => p.trim().toLowerCase())

    // 准备内容
    const markdown = parsed.format === 'markdown' ? parsed.content : undefined
    const html = parsed.format === 'html' ? parsed.content : markdownToHtml(parsed.content)

    console.log()
    console.log(chalk.bold(t('sync.summary')))
    console.log(`  ${t('sync.fieldFile')}: ${chalk.cyan(path.basename(filePath))}`)
    console.log(`  ${t('sync.fieldTitle')}: ${chalk.cyan(title)}`)
    console.log(`  ${t('sync.fieldFormat')}: ${chalk.cyan(parsed.format)}${parsed.format === 'html' ? chalk.green(t('sync.keepLayout')) : ''}`)
    console.log(`  ${t('sync.fieldPlatforms')}: ${chalk.cyan(platforms.join(', '))}`)
    console.log(`  ${t('sync.fieldContent')}: ${chalk.gray(t('sync.chars', { count: parsed.content.length }))}`)
    if (cover) {
      console.log(`  ${t('sync.fieldCover')}: ${chalk.cyan(cover.startsWith('data:') ? t('sync.localImage') : cover)}`)
    }
    console.log()

    if (options.dryRun) {
      console.log(chalk.yellow(t('sync.dryRun')))
      console.log()
      console.log(chalk.bold(t('sync.preview')))
      console.log(chalk.gray(parsed.content.slice(0, 300) + (parsed.content.length > 300 ? '...' : '')))
      process.exit(0)
    }

    const bridge = await createBridge()
    if (!bridge) {
      process.exit(1)
    }

    // 处理本地图片：上传到第一个目标平台作为图床
    const fileDir = path.dirname(filePath)
    const localImages = findLocalImages(parsed.content, fileDir)

    let processedMarkdown = markdown
    let processedHtml = html

    if (localImages.length > 0) {
      // 使用第一个目标平台作为图床
      const imageHost = platforms[0]
      const imageHostName = platformDisplayName(imageHost)
      console.log(chalk.bold(t('sync.localImages', {
        count: localImages.length,
        platform: imageHostName,
      })))
      console.log()

      const imageResult = await processLocalImages(parsed.content, fileDir, bridge, imageHost)

      if (imageResult.uploadedCount > 0) {
        // 更新内容
        if (parsed.format === 'markdown') {
          processedMarkdown = imageResult.content
          processedHtml = markdownToHtml(imageResult.content)
        } else {
          processedHtml = imageResult.content
        }
      }

      console.log()
      console.log(t('sync.imageResult', {
        ok: chalk.green(imageResult.uploadedCount),
        failed: chalk.red(imageResult.failedCount),
      }))
      if (platforms.length > 1) {
        console.log(chalk.gray(t('sync.imageHostOthers', { platform: imageHostName })))
      }
      console.log()
    }

    const syncSpinner = ora(t('sync.uploading')).start()

    try {
      const response = await bridge.request<{ results: SyncResult[]; syncId: string }>('syncArticle', {
        platforms,
        article: {
          title,
          markdown: processedMarkdown,
          content: processedHtml,
          cover,
        },
      })

      const results = response.results || []

      syncSpinner.stop()
      console.log()
      console.log(chalk.bold(t('sync.results')))
      console.log()

      for (const result of results) {
        if (result.success) {
          console.log(
            chalk.green('  ✓'),
            chalk.bold(result.platform),
            result.draftOnly ? chalk.gray(t('sync.draftOnly')) : ''
          )
          if (result.postUrl) {
            console.log(`    ${chalk.cyan(result.postUrl)}`)
          }
        } else {
          console.log(chalk.red('  ✗'), chalk.bold(result.platform))
          console.log(`    ${chalk.red(result.error || t('sync.unknownError'))}`)
        }
      }

      const successCount = results.filter((r) => r.success).length
      console.log()
      console.log(t('sync.done', {
        ok: chalk.green(successCount),
        failed: chalk.red(results.length - successCount),
      }))
    } catch (error) {
      syncSpinner.fail(t('sync.failed'))
      console.error(chalk.red((error as Error).message))
    } finally {
      bridge.stop()
      process.exit(0)
    }
  })

// ============ 平台列表排版 ============

/** 终端显示宽度：CJK 全角字符按 2 列计。 */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    width += (
      (code >= 0x1100 && code <= 0x115f)
      || (code >= 0x2e80 && code <= 0xa4cf)
      || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff)
      || (code >= 0xfe30 && code <= 0xfe6f)
      || (code >= 0xff00 && code <= 0xff60)
      || (code >= 0xffe0 && code <= 0xffe6)
    ) ? 2 : 1
  }
  return width
}

function padDisplay(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - displayWidth(text)))
}

// ============ platforms 命令 ============

program
  .command('platforms')
  .alias('ls')
  .description(t('platforms.description'))
  .option('-a, --auth', t('platforms.authOption'))
  .action(async (options) => {
    const bridge = await createBridge()
    if (!bridge) {
      process.exit(1)
    }

    const spinner = ora(t('platforms.loading')).start()

    try {
      const platforms = await bridge.request<PlatformInfo[]>('listPlatforms', {
        forceRefresh: options.auth,
      })

      spinner.stop()
      console.log()
      console.log(chalk.bold(t('platforms.header', { count: platforms.length })))
      console.log()

      for (const p of platforms) {
        const status = options.auth
          ? p.isAuthenticated
            ? chalk.green(t('platforms.signedIn'))
            : chalk.red(t('platforms.signedOut'))
          : ''
        const username = p.username ? chalk.gray(`(${p.username})`) : ''
        const name = padDisplay(platformDisplayName(p.id, p.name), 24)

        console.log(`  ${chalk.cyan(p.id.padEnd(15))} ${name} ${status} ${username}`)
      }
      console.log()
    } catch (error) {
      spinner.fail(t('platforms.failed'))
      console.error(chalk.red((error as Error).message))
    } finally {
      bridge.stop()
      process.exit(0)
    }
  })

// ============ auth 命令 ============

program
  .command('auth [platform]')
  .description(t('auth.description'))
  .option('-r, --refresh', t('auth.refreshOption'))
  .action(async (platform: string | undefined, options) => {
    const bridge = await createBridge()
    if (!bridge) {
      process.exit(1)
    }

    const spinner = ora(t('auth.loading')).start()

    try {
      if (platform) {
        const result = await bridge.request<PlatformInfo>('checkAuth', {
          platform,
        })

        spinner.stop()
        console.log()

        const name = platformDisplayName(result.id || platform, result.name)
        if (result.isAuthenticated) {
          console.log(chalk.green(t('auth.signedIn', { platform: name })))
          if (result.username) {
            console.log(`  ${t('auth.user')} ${chalk.cyan(result.username)}`)
          }
        } else {
          console.log(chalk.red(t('auth.signedOut', { platform: name })))
          if (result.error) {
            console.log(`  ${t('auth.error')} ${chalk.gray(result.error)}`)
          }
        }
      } else {
        const platforms = await bridge.request<PlatformInfo[]>('listPlatforms', {
          forceRefresh: options.refresh,
        })

        spinner.stop()

        const authenticated = platforms.filter((p) => p.isAuthenticated)
        const unauthenticated = platforms.filter((p) => !p.isAuthenticated)

        console.log()
        console.log(chalk.bold(t('auth.header')))
        console.log()

        if (authenticated.length > 0) {
          console.log(chalk.green(t('auth.signedInHeader', { count: authenticated.length })))
          for (const p of authenticated) {
            const username = p.username ? chalk.gray(`(${p.username})`) : ''
            const name = padDisplay(platformDisplayName(p.id, p.name), 24)
            console.log(`  ${chalk.cyan(p.id.padEnd(15))} ${name} ${username}`)
          }
          console.log()
        }

        if (unauthenticated.length > 0) {
          console.log(chalk.red(t('auth.signedOutHeader', { count: unauthenticated.length })))
          for (const p of unauthenticated) {
            const name = padDisplay(platformDisplayName(p.id, p.name), 24)
            console.log(`  ${chalk.gray(p.id.padEnd(15))} ${name}`)
          }
          console.log()
        }
      }
    } catch (error) {
      spinner.fail(t('auth.failed'))
      console.error(chalk.red((error as Error).message))
    } finally {
      bridge.stop()
      process.exit(0)
    }
  })

// ============ extract 命令 ============

program
  .command('extract')
  .description(t('extract.description'))
  .option('-o, --output <file>', t('extract.outputOption'))
  .action(async (options) => {
    const bridge = await createBridge()
    if (!bridge) {
      process.exit(1)
    }

    const spinner = ora(t('extract.loading')).start()

    try {
      const article = await bridge.request<{
        title: string
        content: string
        markdown?: string
      } | null>('extractArticle')

      spinner.stop()

      if (!article) {
        spinner.fail(t('extract.failed'))
        console.error(chalk.red(t('extract.empty')))
        process.exit(1)
      }

      if (options.output) {
        const outputPath = path.resolve(options.output)
        const content = article.markdown || article.content
        const output = `# ${article.title}\n\n${content}`
        fs.writeFileSync(outputPath, output, 'utf-8')
        console.log(chalk.green(t('extract.saved', { file: outputPath })))
        console.log(chalk.gray(t('extract.savedHint', { file: options.output })))
      } else {
        console.log()
        console.log(chalk.bold(t('extract.title')), article.title)
        console.log()
        console.log(chalk.bold(t('extract.preview')))
        const preview = (article.markdown || article.content).slice(0, 500)
        console.log(chalk.gray(preview + (preview.length >= 500 ? '...' : '')))
        console.log()
        console.log(chalk.gray(t('extract.previewHint')))
      }
    } catch (error) {
      spinner.fail(t('extract.failed'))
      console.error(chalk.red((error as Error).message))
    } finally {
      bridge.stop()
      process.exit(0)
    }
  })

// ============ 默认行为 ============

program.helpCommand('help [command]', t('help.helpCommand'))

if (process.argv.length <= 2) {
  console.log()
  console.log(chalk.bold('DSwritesync') + ' — ' + t('cli.bannerTagline'))
  console.log()
  console.log(`${t('cli.website')}: ${chalk.cyan(WEBSITE_URL)}`)
  console.log()
  console.log(t('cli.bannerPlatforms'))
  console.log()
  console.log(chalk.bold(t('cli.bannerQuickstart')))
  console.log(`  ${chalk.cyan('dswritesync serve')}                 ${t('cli.bannerServe')}`)
  console.log(`  ${chalk.cyan('dswritesync sync article.md')}      ${t('cli.bannerSync')}`)
  console.log(`  ${chalk.cyan('dswritesync extract -o out.md')}    ${t('cli.bannerExtract')}`)
  console.log()
  program.outputHelp()
  process.exit(0)
}

program.parse()
