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
  packages/cli/             # @wechatsync/cli;src/bridge/ 为本地服务桥
```

- 上游 `packages/mcp-server/` 已移除（2026-11-19）；其 `ExtensionBridge` / 消息类型并入 `packages/cli/src/bridge/`，接入面只保留 CLI + skill。
- 三个包的 `src/`、构建配置、`package.json`、`manifest.json`、`public/`、`assets/`、`test/`、`__tests__/` 均按上游原样复制，作为 vendoring 基线。
- 源文件头与版权声明保持原样；vendoring 阶段未修改 upstream 源码。
- vendoring 阶段的唯一改动是根 `package.json` 的脚本与 `packageManager` 字段（yarn → pnpm）。之后的 DSwritesync 修改（品牌、侧栏、采集协议、CLI `serve`、i18n、清理）见 `NOTICE` 与 ADR 0010，均按 GPL-3.0 发布。

## 复制时的排除项

按项目要求，以下内容未复制：

- `.git/`、`.claude*`、`.agents/`、`skills/`（上游仓库级工具配置）
- `node_modules/`、`dist/`、`*.zip`（构建产物与依赖）
- 根目录及包内的 `README.md`、`CHANGELOG.md`、`CONTRIBUTING.md`（本项目后续自行撰写文档）
- 上游 `docs/` 与 `yarn.lock`（非构建必需）

## 私有 submodule（未包含）

上游 `.gitmodules` 声明了私有适配器 submodule：

```
[submodule "private-adapters"]
  path = packages/core/src/adapters/platforms/private
  url = git@github.com:wechatsync/wechatsync-private-adapters.git
```

- 本次复制时该 submodule 未检出，目录为空（gitlink `ec378eab262778ff5053d0ddf87451b7b821e516`）。
- 私有适配器（含小红书 `xiaohongshu`）属于闭源内容，不随 GPL 源码分发；当前基座不包含对应平台适配器。
- 若后续需要小红书等平台，必须另行获得私有仓库访问权，不能从公开源码补齐。

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
