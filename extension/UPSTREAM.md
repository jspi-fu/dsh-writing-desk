# Upstream 基线

本目录是 [Wechatsync](https://github.com/wechatsync/Wechatsync) v2 源码的 vendored fork，作为 DSwritesync 的构建基座。

| 项目 | 值 |
| --- | --- |
| 仓库 | https://github.com/wechatsync/Wechatsync |
| 分支 | `v2` |
| Commit | `1230678434e180697e288106d9a9a4e11d84a028`（简称 `1230678`） |
| 版本 | `2.0.10`（`packages/extension/package.json` / `manifest.json`） |
| 复制日期 | 2026-11-19 |
| 许可证 | GPL-3.0（见 `LICENSE` 与 `NOTICE`） |

## 保留的目录结构

```
extension/
  package.json              # pnpm workspace 根（构建脚本已改为 pnpm）
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.json
  LICENSE
  packages/core/            # @wechatsync/core
  packages/extension/       # @wechatsync/extension
```

- 上游 `packages/mcp-server/` 与 `packages/cli/` 均已移除（mcp-server 2026-11-19 并入当时的 CLI，CLI 2026-11-20 随 ADR 0012 整体退役，见文末）。
- 两个包的 `src/`、构建配置、`package.json`、`manifest.json`、`assets/`、`__tests__/` 均按上游原样复制，作为 vendoring 基线。
- 上游遗留物已删除（2026-11-22）：`packages/extension/test/test-sdk.html`（CDN + 内联脚本的旧测试页）、`ROADMAP.md`（上游路线图，「直接发布」条目与本项目「只到草稿箱」红线冲突）、`packages/extension/public/lib/`（reader 库重复副本，与 `src/lib/reader/` 字节一致，已收敛为单一份额并改由构建脚本从 `src/lib/reader/` 复制）。
- 源文件头与版权声明保持原样；vendoring 阶段未修改 upstream 源码。
- vendoring 阶段的唯一改动是根 `package.json` 的脚本与 `packageManager` 字段（yarn → pnpm）。之后的 DSwritesync 修改（品牌、侧栏、采集协议、i18n、清理）见 `NOTICE` 与 ADR 0010，均按 GPL-3.0 发布。
- `tsc` 已改为纯类型检查（tsconfig `noEmit`），不再把 `.js/.d.ts` 编译产物吐进 `src/`（上游遗留行为）；core 不再使用 tsup 构建（其产物从未被消费，包以 TS 源码形态被 extension 引用）。

## 复制时的排除项

按项目要求，以下内容未复制：

- `.git/`、`.claude*`、`.agents/`、`skills/`（上游仓库级工具配置）
- `node_modules/`、`dist/`、`*.zip`（构建产物与依赖）
- 根目录及包内的 `README.md`、`CHANGELOG.md`、`CONTRIBUTING.md`（本项目后续自行撰写文档）
- 上游 `docs/` 与 `yarn.lock`（非构建必需）

## 私有 submodule（未检出）

上游 `.gitmodules` 声明了私有适配器 submodule：

```
[submodule "private-adapters"]
  path = packages/core/src/adapters/platforms/private
  url = git@github.com:wechatsync/wechatsync-private-adapters.git
```

- 本次复制时该 submodule 未检出，目录为空（gitlink `ec378eab262778ff5053d0ddf87451b7b821e516`）。
- 上游的私有闭源适配器仍未包含，也不能从公开源码补齐。
- 但小红书平台在 ADR 0010 修订（2026-11-19）中以**页面自动化**方式自研落地：`packages/core/src/adapters/platforms/private/xiaohongshu.ts` 是本仓库原创实现（随 GPL-3.0 源码分发），不是上游私有代码，也没有 submodule。

## 为什么保留 `@wechatsync/*` 包名

- 四个 workspace 包、`workspace:*` 依赖、Vite alias、tsconfig paths 与 manifest 构建链均按这些包名解析。
- 保留包名可以把与上游的 diff 控制在产品层（侧边栏、品牌、协议），便于后续合并 upstream 修复。
- 用户可见的 bin、manifest 名称、关于页会在 Phase 2 品牌化时改为 DSwritesync，不改变内部包名。

## 构建适配记录

- `package.json` 增加 `"packageManager": "pnpm@11.6.0"`。
- 根脚本由 `yarn workspace/workspaces` 改为 `pnpm --filter` / `pnpm -r`，命令语义与上游保持一致。
- `package.json` 中原有的 `pnpm.onlyBuiltDependencies` 已移除：pnpm 11 不再读取该字段。
- `pnpm-workspace.yaml` 的 `ignoredBuiltDependencies` 改为 pnpm 11 的 `allowBuilds: { esbuild: true }`，保留上游允许 esbuild 执行安装脚本的意图。
- 依赖安装与构建使用独立 pnpm workspace，不进入主仓库的 npm 依赖图。
## 桥从 CLI 平移为 Native Messaging(2026-11-20,ADR 0012)

- 上游 Wechatsync 没有「工作台桥」这一层;ADR 0010 阶段的桥是 CLI(`dswritesync serve`,WS 9527 + 握手 token),2026-11-20 起整体退役。
- 现行接入面:浏览器扩展 ↔ 本地助手(`native/helper.mjs`,主仓库 MIT 自研)经 Chrome Native Messaging(host `app.dswritesync.plugin`);扩展侧 `src/bridge/` 的 NM 客户端与 `BRIDGE_*` 消息面按协议事实与助手对齐,不拷贝任何上游或 StashDock 代码。
- 上游 `packages/cli` 目录随退役删除;WS/HTTP 端口、token、auth.json 概念不复存在,投递箱文件契约(inbox/outbox/receipts、原子 rename 认领、operationId 回执)不变。
