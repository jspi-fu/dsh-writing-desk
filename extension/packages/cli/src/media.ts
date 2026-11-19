/**
 * 图片管线（从上游 CLI 抽出，供 sync 与 serve 共用）。
 *
 * - `convertImagesToDataUri`：把正文里的本地图片引用换成 data URI，由平台适配器
 *   自己转存到目标平台图床（上游推荐方式）。
 * - `processLocalImages`：把小图直接上传到指定平台图床，把引用换成 URL。
 * - `inlineTaskImages`：serve 消费 outbox 时用。图片键来自宿主 `images` 映射，
 *   `images/<file>` 与正文引用一致；低于分片阈值转 data URI，大图走
 *   `uploadImageChunked` 分片上传，失败则回退 data URI。
 */
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import type { ExtensionBridge } from './bridge/index.js'
import { t } from './i18n.js'

export interface LocalImage {
  originalRef: string  // 原始引用，如 ![alt](./img.png) 或 <img src="./img.png">
  localPath: string    // 本地路径
  absolutePath: string // 绝对路径
}

/**
 * MIME 类型映射
 */
export const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

/**
 * 查找内容中的本地图片引用
 */
export function findLocalImages(content: string, basePath: string): LocalImage[] {
  const images: LocalImage[] = []
  const seen = new Set<string>()

  // Markdown 图片: ![alt](path)
  const mdImageRegex = /!\[[^\]]*\]\(([^)]+)\)/g
  let match
  while ((match = mdImageRegex.exec(content)) !== null) {
    const imgPath = match[1].trim()
    // 跳过网络图片和 data URI
    if (imgPath.startsWith('http://') || imgPath.startsWith('https://') || imgPath.startsWith('data:')) {
      continue
    }
    if (!seen.has(imgPath)) {
      seen.add(imgPath)
      images.push({
        originalRef: match[0],
        localPath: imgPath,
        absolutePath: path.resolve(basePath, imgPath),
      })
    }
  }

  // HTML 图片: <img src="path">
  const htmlImageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
  while ((match = htmlImageRegex.exec(content)) !== null) {
    const imgPath = match[1].trim()
    if (imgPath.startsWith('http://') || imgPath.startsWith('https://') || imgPath.startsWith('data:')) {
      continue
    }
    if (!seen.has(imgPath)) {
      seen.add(imgPath)
      images.push({
        originalRef: match[0],
        localPath: imgPath,
        absolutePath: path.resolve(basePath, imgPath),
      })
    }
  }

  return images
}

/**
 * 读取本地图片为 base64
 */
export function readImageAsBase64(imagePath: string): { data: string; mimeType: string } | null {
  if (!fs.existsSync(imagePath)) {
    return null
  }

  const ext = path.extname(imagePath).toLowerCase()
  const mimeType = MIME_TYPES[ext]
  if (!mimeType) {
    return null
  }

  const buffer = fs.readFileSync(imagePath)
  return {
    data: buffer.toString('base64'),
    mimeType,
  }
}

/**
 * 将本地图片转换为 data URI（推荐方式）
 * 让各平台适配器自己处理图片上传，确保图片存储在目标平台的图床
 */
export function convertImagesToDataUri(
  content: string,
  basePath: string
): { content: string; convertedCount: number; failedCount: number } {
  const images = findLocalImages(content, basePath)

  if (images.length === 0) {
    return { content, convertedCount: 0, failedCount: 0 }
  }

  let processedContent = content
  let convertedCount = 0
  let failedCount = 0

  for (const img of images) {
    const imageData = readImageAsBase64(img.absolutePath)
    if (!imageData) {
      console.log(chalk.yellow(t('media.skipped', { file: img.localPath })))
      failedCount++
      continue
    }

    // 构建 data URI
    const dataUri = `data:${imageData.mimeType};base64,${imageData.data}`

    // 替换内容中的引用
    if (img.originalRef.startsWith('![')) {
      // Markdown 格式
      const newRef = img.originalRef.replace(img.localPath, dataUri)
      processedContent = processedContent.replace(img.originalRef, newRef)
    } else {
      // HTML 格式
      const newRef = img.originalRef.replace(img.localPath, dataUri)
      processedContent = processedContent.replace(img.originalRef, newRef)
    }

    console.log(chalk.green(t('media.converted', { file: img.localPath })))
    convertedCount++
  }

  return { content: processedContent, convertedCount, failedCount }
}

/**
 * 上传图片到指定图床并替换内容中的引用（备用方式）
 */
export async function processLocalImages(
  content: string,
  basePath: string,
  bridge: ExtensionBridge,
  platform: string = 'weibo'
): Promise<{ content: string; uploadedCount: number; failedCount: number }> {
  const images = findLocalImages(content, basePath)

  if (images.length === 0) {
    return { content, uploadedCount: 0, failedCount: 0 }
  }

  let processedContent = content
  let uploadedCount = 0
  let failedCount = 0

  for (const img of images) {
    const imageData = readImageAsBase64(img.absolutePath)
    if (!imageData) {
      console.log(chalk.yellow(t('media.skipped', { file: img.localPath })))
      failedCount++
      continue
    }

    try {
      // 使用分片上传（大图片自动分片）
      const result = await bridge.uploadImageChunked(imageData.data, imageData.mimeType, platform)

      // 替换内容中的引用
      if (img.originalRef.startsWith('![')) {
        // Markdown 格式
        const newRef = img.originalRef.replace(img.localPath, result.url)
        processedContent = processedContent.replace(img.originalRef, newRef)
      } else {
        // HTML 格式
        const newRef = img.originalRef.replace(img.localPath, result.url)
        processedContent = processedContent.replace(img.originalRef, newRef)
      }

      console.log(chalk.green(t('media.uploaded', { file: img.localPath })))
      uploadedCount++
    } catch (error) {
      console.log(chalk.red(t('media.failed', { file: img.localPath, error: (error as Error).message })))
      failedCount++
    }
  }

  return { content: processedContent, uploadedCount, failedCount }
}

export interface TaskImageStats {
  content: string
  convertedCount: number
  uploadedCount: number
  failedCount: number
}

/** 分片阈值与 ExtensionBridge.uploadImageChunked 的内部分界线保持一致。 */
const CHUNK_THRESHOLD = 1024 * 1024

/**
 * serve 消费 outbox 时的图片处理：按宿主的 `images` 映射替换正文引用。
 * 小图转 data URI；达到 1MB 的图片走扩展分片上传，失败再回退 data URI。
 * @param content - `articleMd` 正文。
 * @param images - `{ 'images/x.png': '/abs/path/x.png' }` 映射。
 * @param bridge - 已连接扩展的 bridge（无连接时只做 data URI）。
 * @param platform - 分片上传使用的图床平台（任务里的第一个平台）。
 * @param log - 可选的输出回调。
 */
export async function inlineTaskImages(
  content: string,
  images: unknown,
  bridge: ExtensionBridge | null,
  platform: string,
  log: (message: string) => void = () => {}
): Promise<TaskImageStats> {
  let processedContent = content
  let convertedCount = 0
  let uploadedCount = 0
  let failedCount = 0

  if (!images || typeof images !== 'object' || Array.isArray(images)) {
    return { content: processedContent, convertedCount, uploadedCount, failedCount }
  }

  for (const [ref, file] of Object.entries(images as Record<string, unknown>)) {
    if (!ref || typeof file !== 'string' || !processedContent.includes(ref)) continue

    const imageData = readImageAsBase64(file)
    if (!imageData) {
      failedCount++
      log(`skip|${ref}`)
      continue
    }

    let replacement: string | null = null
    if (imageData.data.length >= CHUNK_THRESHOLD && bridge?.hasClient()) {
      try {
        const uploaded = await bridge.uploadImageChunked(imageData.data, imageData.mimeType, platform)
        replacement = uploaded.url
        uploadedCount++
        log(`upload|${ref}|${uploaded.url}`)
      } catch {
        // 分片上传失败：回退到 data URI，让平台适配器自己转存
      }
    }

    if (!replacement) {
      replacement = `data:${imageData.mimeType};base64,${imageData.data}`
      convertedCount++
      log(`inline|${ref}`)
    }

    processedContent = processedContent.split(ref).join(replacement)
  }

  return { content: processedContent, convertedCount, uploadedCount, failedCount }
}