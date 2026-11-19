// 发布交接(工单 #9、ADR 0009):把成稿导出成 wdesk CLI 能直接消费的 article.md + images/ 文件夹。
// 发布发生在浏览器扩展里、只到草稿箱,所以这里只产出文件与命令字符串:不调用平台 API、
// 不解析 CLI 输出,是否已发布由用户确认(见 ops.js 的 publish_item)。
// 一键投递走 production/dispatch 路由(经本地桥下发扩展),这条命令字符串是没起桥时的兜底。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { byLang } from './i18n.js'
// 素材复制与分节摆图与 saveProduction 同一套实现(工单 #9 与一键保存共用)
import { articleWithFigures, copyAssetFile, freeFolder } from './export.js'

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
    const file = await copyAssetFile(asset, name, filesDir, imagesDir)
    if (!file) return null
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

  // 可复制的同步命令:拼法与 wdesk sync 的参数面一致(sync <file> / --title / --cover / --dry-run)。
  // 参数统一套双引号并清掉标题里的引号,粘贴到 cmd / PowerShell / Git Bash 都能跑。
  const quote = value => `"${String(value).replace(/"/g, '')}"`
  const cover = figures[0].ref ? join(target, figures[0].ref) : null
  const command = [
    'wdesk', 'sync', quote(articlePath),
    production.title ? `--title ${quote(production.title)}` : null,
    cover ? `--cover ${quote(cover)}` : null,
  ].filter(Boolean).join(' ')
  return { dir: target, articlePath, imageFiles, command, dryRunCommand: `${command} --dry-run` }
}
