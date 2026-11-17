// 一键保存：把成稿写成一个普通文件夹，正文、封面和配图都在里面。
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, join } from 'node:path'
import { currentLang, tr } from './i18n.js'

export function defaultExportDir() {
  // 已经有中文文件夹的用户切到英文后继续用原来的文件夹
  const zh = join(homedir(), 'Documents', '图文创作台')
  if (currentLang() !== 'en' || existsSync(zh)) return zh
  return join(homedir(), 'Documents', 'Writing Desk')
}

export function resolveExportDir(value) {
  const dir = String(value ?? '').trim()
  if (!dir) return defaultExportDir()
  return dir.startsWith('~/') ? join(homedir(), dir.slice(2)) : dir
}

/** 标题清掉路径字符后当文件夹名;发布导出(工单 #9)与这里共用同一套命名。 */
export function folderName(title) {
  const clean = String(title ?? '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 60)
  return clean || tr('未命名')
}

/** 第一次保存时找一个还没人用的文件夹，标题相同的两篇不会写到一起。 */
export function freeFolder(exportDir, title) {
  const base = folderName(title)
  for (let n = 1; ; n++) {
    const dir = join(exportDir, n === 1 ? base : `${base} ${n}`)
    if (!existsSync(dir)) return dir
  }
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex')
}

function stamp(date) {
  const two = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
}

/** 成稿素材按 files/ 的落盘方式原样复制到目标文件夹,返回文件名;没画出来的(无 src)返回 null。 */
export async function copyAssetFile(asset, name, filesDir, dir) {
  const match = /^writing-desk\/files\/([\w.-]+)$/.exec(asset?.src ?? '')
  if (!match) return null
  const file = `${name}${extname(match[1])}`
  await copyFile(join(filesDir, match[1]), join(dir, file))
  return file
}

/** 配图放回对应小标题那一节的末尾;保存成稿与发布导出(工单 #9)共用同一套摆法。 */
export function articleWithFigures(production, figures) {
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
 * @param {object} production - 成稿。
 * @param {{filesDir: string, exportDir: string}} options - 素材目录与保存位置。
 * @returns {Promise<{path: string, files: string[], hashes: Record<string, string>, backups: string[]}>} 文件夹路径、写入的文件名、稿子的指纹，以及这次留下的备份。
 */
export async function saveProduction(production, { filesDir, exportDir }) {
  // 英文界面用纯 ASCII 文件名，方便在别的系统和工具里打开
  const en = currentLang() === 'en'
  const names = en
    ? { cover: 'cover-original', figure: i => `figure-${i}`, script: 'script.md' }
    : { cover: '封面原图', figure: i => `配图${i}`, script: '文章.md' }
  const target = production.savedPath || freeFolder(exportDir, production.title)
  await mkdir(target, { recursive: true })
  const files = []
  const hashes = {}
  const backups = []

  // 文件夹里的稿子和上次保存的不一样，说明在外面改过：先另存一份，再写新的
  const writeText = async (file, text) => {
    const path = join(target, file)
    const old = await readFile(path, 'utf8').catch(() => null)
    if (old !== null && old !== text && digest(old) !== production.savedHashes?.[file]) {
      const backup = `${file.slice(0, -extname(file).length)}.${en ? 'edited' : '手改备份'}-${stamp(new Date())}${extname(file)}`
      await rename(path, join(target, backup))
      backups.push(backup)
    }
    await writeFile(path, text)
    hashes[file] = digest(text)
    files.push(file)
  }

  const copy = async (asset, name) => {
    const file = await copyAssetFile(asset, name, filesDir, target)
    if (file) files.push(file)
    return file
  }

  await copy(production.cover, names.cover)
  const figures = []
  for (const [i, image] of (production.images ?? []).entries()) {
    figures.push({ image, ref: await copy(image, names.figure(i + 1)) })
  }

  await writeText(names.script, articleWithFigures(production, figures))
  return { path: target, files, hashes, backups }
}
