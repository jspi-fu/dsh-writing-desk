// 发布交接(工单 #9、ADR 0009/0012):把成稿导出成发布包(article.md + images/)。
// 投递经本地助手(NM)下发浏览器扩展:work/export 路由先在这里落文件,再把
// 正文与图片路径写进 outbox 任务。只产出文件,不调用平台 API、不写已发布状态——
// 是否已发布由用户确认(见 ops.js 的 publish_work)。命令字符串已随 CLI 退役。
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { byLang } from './i18n.js'
// 素材复制与分节摆图与作品落盘同一套实现(工单 #9 与一键保存共用)
import { articleWithFigures, copyAssetFile, freeFolder } from './export.js'

/**
 * 导出发布包:成稿正文写成 article.md,封面与配图落进 images/,引用用相对路径。
 * @param {object} production - 作品当前稿(workDoc 形状)。
 * @param {{filesDir: string, exportDir: string}} options - 素材目录与导出根目录。
 * @returns {Promise<{dir: string, articlePath: string, imageFiles: string[]}>}
 */
export async function exportPublishPackage(production, { filesDir, exportDir }) {
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
  return { dir: target, articlePath, imageFiles }
}
