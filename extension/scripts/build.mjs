// 扩展构建(ADR 0009):esbuild 出 5 个 bundle,其余原样拷进 dist/。
// background 是 module SW;panel/dialog/options/page-capture 是 IIFE。
// --watch 时用 context 监听,和主仓库 npm run watch 同一用法。
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, context } from 'esbuild'

const root = dirname(fileURLToPath(import.meta.url))
const dist = join(root, '..', 'dist')

const common = {
  bundle: true,
  minify: false,
  logLevel: 'info',
  target: 'chrome120',
  sourcemap: false,
}

const entries = [
  { entryPoints: [join(root, '..', 'src/background/index.js')], outfile: join(dist, 'background.js'), format: 'esm' },
  { entryPoints: [join(root, '..', 'src/panel/panel.js')], outfile: join(dist, 'panel/panel.js'), format: 'iife' },
  { entryPoints: [join(root, '..', 'src/dialog/dialog.js')], outfile: join(dist, 'dialog/dialog.js'), format: 'iife' },
  { entryPoints: [join(root, '..', 'src/options/options.js')], outfile: join(dist, 'options/options.js'), format: 'iife' },
  // 注入页面的采集器:Readability 一起打进去,脚本自己挂 window.__wdeskCapture
  { entryPoints: [join(root, '..', 'src/capture/page.js')], outfile: join(dist, 'page-capture.js'), format: 'iife' },
]

async function run() {
  await rm(dist, { recursive: true, force: true })
  await mkdir(dist, { recursive: true })
  for (const entry of entries) {
    if (process.argv.includes('--watch')) {
      const ctx = await context({ ...common, ...entry })
      await ctx.watch()
    } else {
      await build({ ...common, ...entry })
    }
  }
  // 静态文件:manifest、页面壳、图标、令牌表
  const staticFrom = join(root, '..', 'static')
  await cp(staticFrom, dist, { recursive: true })
  await cp(join(root, '..', 'manifest.json'), join(dist, 'manifest.json'))
  // tokens 单独放,避免 esbuild 的 CSS 产物同名覆盖页面样式
  await cp(join(root, '..', 'src/common/tokens.css'), join(dist, 'tokens.css'))
  if (!process.argv.includes('--watch')) console.log('extension dist/ 已就绪')
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
