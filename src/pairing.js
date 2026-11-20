// NM 自动配对注册器(ADR 0012):插件在 DSH 启动时进程内完成 NM host 注册——
// host manifest(name/path/type/allowed_origins)写盘 + 逐浏览器 vendor 键写
// HKCU 注册表,幂等重写,单浏览器失败不影响其余;换安装路径后启动一次即自愈。
// 鉴权靠固定扩展 ID 白名单 + 浏览器内核校验,零 token、零端口。
// StashDock 需要注册用 exe 是因其逻辑在 Rust;我们是 Node,直写更简。
import { execFile } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTENSION_ID, HOST_NAME } from '../native/helper.mjs'
import { dshHome } from './store.js'

// Chromium 分支的 NM 注册表 vendor 键(HKCU\Software\<vendor>\NativeMessagingHosts)。
// 未列入的分支(ego lite 等)待真机探出后在此扩充一行即可(ADR 0012);多数
// 未改注册根的分支会落到 Chromium 键上,已是兜底之一。
export const PAIRING_VENDORS = [
  'Google\\Chrome',
  'Microsoft\\Edge',
  'Chromium',
  'BraveSoftware\\Brave-Browser',
  'Vivaldi',
  'Opera Software',
  'Quark',
]

/**
 * 配对相关路径:host manifest 与 helper 同目录(随插件安装位走),注册结果
 * 记录落投递箱目录给设置页读。
 * @param {{home?: string, pluginDir?: string}} [overrides] - 测试注入。
 */
export function pairingPaths({ home = dshHome(), pluginDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'native') } = {}) {
  const root = join(home, 'writing-desk', 'bridge')
  return {
    root,
    helperBat: join(pluginDir, 'helper.bat'),
    manifest: join(pluginDir, `${HOST_NAME}.json`),
    record: join(root, 'native.json'),
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  try {
    await rename(tmp, file)
  } catch (error) {
    if (error.code !== 'EPERM' && error.code !== 'EEXIST') throw error
    await rm(file, { force: true })
    await rename(tmp, file)
  }
}

/** 生成 host manifest;allowed_extensions 留口,Firefox/Safari 变体后续从这里接。 */
export function hostManifest({ helperBat, extensionId = EXTENSION_ID, hostName = HOST_NAME } = {}) {
  return {
    name: hostName,
    description: 'DSwritesync local helper for the writing desk bridge',
    path: helperBat,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extensionId}/`],
  }
}

/**
 * 对一个浏览器 vendor 键执行 reg add。幂等(/f 覆盖),失败抛错由调用方隔离。
 * @param {string} vendor - HKCU\Software 下的浏览器厂商键。
 * @param {string} manifestPath - host manifest 的绝对路径。
 * @param {(cmd: string, args: string[]) => Promise<void>} [run] - 命令执行器,测试注入。
 */
export async function registerVendor(vendor, manifestPath, run = execRun) {
  await run('reg', [
    'add', `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${HOST_NAME}`,
    '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f',
  ])
}

function execRun(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true }, error => (error ? reject(error) : resolve()))
  })
}

/**
 * 幂等完成/修复 NM 注册:每次 DSH 启动调用,重写 manifest 与全部 vendor 键。
 * 单 vendor 失败不挡其余;注册结果落 native.json 给工作台设置页展示。
 * @param {{vendors?: string[], run?: (cmd: string, args: string[]) => Promise<void>, paths?: ReturnType<typeof pairingPaths>, home?: string, platform?: string}} [options] - 测试注入点。
 * @returns {Promise<{paired: boolean, extensionId: string, manifestPath: string, browsers: string[], failedVendors: string[], registeredAt: string}>}
 */
export async function applyPairing({
  vendors = PAIRING_VENDORS,
  run = execRun,
  paths = pairingPaths(),
  home = dshHome(),
  platform = process.platform,
} = {}) {
  const manifest = hostManifest({ helperBat: paths.helperBat })
  await writeJsonAtomic(paths.manifest, manifest)

  const browsers = []
  const failedVendors = []
  if (platform === 'win32') {
    for (const vendor of vendors) {
      try {
        await registerVendor(vendor, paths.manifest, run)
        browsers.push(vendor)
      } catch (error) {
        // 失败忽略:没装的浏览器、被策略锁住的键都不该挡住其余浏览器
        failedVendors.push(vendor)
      }
    }
  }

  const record = {
    v: 1,
    hostName: HOST_NAME,
    extensionId: EXTENSION_ID,
    manifestPath: paths.manifest,
    helperPath: paths.helperBat,
    supported: platform === 'win32',
    vendors: Object.fromEntries(vendors.map(vendor => [vendor, browsers.includes(vendor)])),
    registeredAt: new Date().toISOString(),
  }
  await writeJsonAtomic(paths.record, record)
  return {
    paired: browsers.length > 0,
    extensionId: EXTENSION_ID,
    manifestPath: paths.manifest,
    browsers,
    failedVendors,
    registeredAt: record.registeredAt,
  }
}

/**
 * 读最近一次注册结果(设置页配对状态用);还没注册过返回 null。
 * @param {{home?: string}} [options]
 */
export async function readPairing({ home = dshHome() } = {}) {
  try {
    const raw = JSON.parse(await readFile(pairingPaths({ home }).record, 'utf8'))
    const browsers = Object.entries(raw.vendors ?? {}).filter(([, ok]) => ok === true).map(([vendor]) => vendor)
    return {
      paired: raw.supported === true && browsers.length > 0,
      extensionId: typeof raw.extensionId === 'string' ? raw.extensionId : null,
      registeredAt: typeof raw.registeredAt === 'string' ? raw.registeredAt : null,
      browsers,
    }
  } catch {
    return null
  }
}
