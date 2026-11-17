// 工作台设置。写作与生图都发生在创作会话侧(ADR 0006),插件只剩界面语言与导出位置。
// 语言偏好独立存放,文件权限 600,也不会返回给浏览器之外的地方。
import { chmod, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tr } from './i18n.js'

const DEFAULTS = { language: 'auto', exportDir: '' }

export class Settings {
  constructor(root) {
    this.file = join(root, 'settings.json')
    this.value = null
  }

  async read() {
    // 每次都读文件：桌面版和 Web 版可能同时运行
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'))
      // 旧设置里的生图/分镜等字段随流水线退役,读取时直接丢掉
      this.value = {
        language: ['auto', 'zh', 'en'].includes(saved.language) ? saved.language : 'auto',
        exportDir: typeof saved.exportDir === 'string' ? saved.exportDir : '',
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
      this.value = structuredClone(DEFAULTS)
    }
    return this.value
  }

  async update(patch) {
    const next = await this.read()
    if (patch.exportDir !== undefined) {
      if (typeof patch.exportDir !== 'string') throw Object.assign(new Error(tr('导出位置无效')), { status: 400 })
      next.exportDir = patch.exportDir.trim().slice(0, 500)
    }
    if (['auto', 'zh', 'en'].includes(patch.language)) next.language = patch.language
    const tmp = `${this.file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
    this.value = next
    return next
  }
}

/** 发给浏览器的版本。 */
export function publicSettings(settings) {
  return { language: settings.language, exportDir: settings.exportDir }
}
