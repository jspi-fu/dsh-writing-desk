#!/usr/bin/env node
// wdesk 命令行入口(ADR 0009)。二开自 Wechatsync CLI 的命令面心智(sync/platforms/extract),
// 协议与桥实现都是为本仓库浏览器扩展重写的,未复制上游代码(上游 GPL-3.0)。
import { main } from '../src/index.js'

main(process.argv.slice(2)).then(code => process.exit(code ?? 0)).catch(err => {
  console.error(`wdesk: ${err.message}`)
  process.exit(1)
})
