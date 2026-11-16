// 发布交接(工单 #9):把成稿导出成 Wechatsync CLI 能直接消费的 article.md + images/ 文件夹。
// CLI 只是本地 WebSocket 桥(默认 9527),发布发生在浏览器扩展里、只到草稿箱且没有可靠的成功信号
// (失败也 exit(0)),所以这里只产出文件与命令字符串:不调用平台 API、不解析 CLI 输出,
// 是否已发布由用户确认(见 ops.js 的 publish_item)。
import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { byLang } from './i18n.js'
import { freeFolder } from './export.js'

/** 配图放回对应小标题那一节的末尾(与 saveProduction 的脚本导出同一套摆法)。 */
function articleWithFigures(production, figures) {
  const sections = String(production.article ?? '').split(/\n(?=##\s)/)
  const unplaced = []
  for (const { image, ref } of figures) {
    if (!ref) continue
    const line = `\n\n![${image.caption ?? ''}](${ref})`
    const at = sections.findIndex(part => image.anchor && part.startsWith(`## ${image.anchor}`))
    if (at >= 0) sections[at] = `${sections[at].trimEnd()}${line}\n`
    else unplaced.push(line)
  }
  return `# ${production.title}\n\n${sections.join('\n')}${unplaced.join('')}\n`
}

/**
 * 导出发布包:成稿正文写成 article.md,封面与配图落进 images/,引用用相对路径。
 * @param {object} production - 成稿。
 * @param {{filesDir: string, exportDir: string}} options - 素材目录与导出根目录。
 * @returns {Promise<{dir: string, articlePath: string, imageFiles: string[], command: string}>}
 */
export async function exportForCli(production, { filesDir, exportDir }) {
  // 同一条成稿重复导出写回同一个文件夹(cliPath 由路由记在 production 上),不另开新目录
  const target = production.cliPath || freeFolder(join(exportDir, byLang('发布', 'publish')), production.title)
  await mkdir(join(target, 'images'), { recursive: true })

  // 素材沿用 files/ 的落盘方式原样复制;没画出来的(无 src)跳过
  const imagesDir = join(target, 'images')
  const imageFiles = []
  const copy = async (asset, name) => {
    const match = /^writing-desk\/files\/([\w.-]+)$/.exec(asset?.src ?? '')
    if (!match) return null
    const file = `${name}${extname(match[1])}`
    await copyFile(join(filesDir, match[1]), join(imagesDir, file))
    const ref = `images/${file}`
    imageFiles.push(ref)
    return ref
  }
  const figures = [{ image: production.cover ?? {}, ref: await copy(production.cover, 'cover') }]
  for (const [i, image] of (production.images ?? []).entries()) {
    figures.push({ image, ref: await copy(image, `figure-${i + 1}`) })
  }

  const articlePath = join(target, 'article.md')
  await writeFile(articlePath, articleWithFigures(production, figures))

  // 可复制的同步命令:flag 用 `wechatsync help sync` 实测过的拼法(sync <file> / --title / --cover / --dry-run)。
  // 参数统一套双引号并清掉标题里的引号,粘贴到 cmd / PowerShell / Git Bash 都能跑。
  const quote = value => `"${String(value).replace(/"/g, '')}"`
  const cover = figures[0].ref ? join(target, figures[0].ref) : null
  const command = [
    'wechatsync', 'sync', quote(articlePath),
    production.title ? `--title ${quote(production.title)}` : null,
    cover ? `--cover ${quote(cover)}` : null,
  ].filter(Boolean).join(' ')
  return { dir: target, articlePath, imageFiles, command, dryRunCommand: `${command} --dry-run` }
}
