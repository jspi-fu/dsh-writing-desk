# DSH创作助手（原 DSwritesync）

浏览器侧边栏应用：把网页收录进工作台灵感墙，把工作台下发的成稿投递到各平台草稿箱。基于 Wechatsync v2（2.0.10）的 GPL-3.0 vendored fork；收录交互参考 StashDock（AGPL-3.0），未复制其代码。

## 侧边栏

- 顶部三标签：**收录 / 投递 / 账号**；设置由齿轮进入。
- **收录**：整页或选区 → 标题 / 正文 / 标签 / 封面；同 URL 冲突可保留或替换；DSH 没开着也照收落盘，启动后自动上墙；NM 不可用时复制 Markdown 兜底。
- **投递**：只呈现工作台下发的任务与逐平台进度 / 结果，不自己发起同步；投递结果由工作台的 `dispatches` 记录。
- **账号**：平台登录态与 CMS 自建站（WordPress / Typecho / MetaWeblog），自建站可增删、可测试连接。
- 页面内不注入任何入口；公众号文章页与后台页只保留提取处理器。没有悬浮按钮、历史页与「同步当前网页」。

## 构建与加载

```bash
cd extension
pnpm install
pnpm build:extension        # 产出 packages/extension/dist
```

Edge/Chrome → 扩展 → 开发者模式 → 加载解压缩的扩展 → 选 `packages/extension/dist/`。点工具栏图标打开侧边栏。

## 配对（Native Messaging，ADR 0012）

- manifest 固定 `key` 锚定扩展 ID（`hhkhkekbflmcnpbiiihpmgecpaicblbd`），配对零 token、零粘贴、零端口。
- DSH 插件每次启动时进程内注册 NM host `app.dswritesync.plugin`（技术标识沿用旧名，host manifest + 逐浏览器 HKCU vendor 键，幂等，换安装路径自愈）。
- 扩展经本地助手（主仓库 `native/` 的 helper）与投递箱三向读写：面板打开期间 `connectNative` 长端口近实时推送，SW 休眠期 `chrome.alarms`（30s 下限）一次性拉。
- 设置页显示配对状态与 last error；排障看 `~/.dsh/writing-desk/bridge/helper.log`。

## 数据流

```
扩展收录 → 助手写 inbox → 宿主落灵感 → 回执 → capture-result 事件回推
宿主校样浮层 → outbox → 助手分片下发 → 扩展逐平台草稿 → 助手写 receipts → item.dispatches
扩展 → targets.json（登录态 + 自建站元数据，无凭证）→ 宿主发布菜单
```

`dispatches ≠ 已发布`；是否对外可见仍由用户在平台确认，扩展与助手不写发布状态。

## 许可与上游

- 本目录是 Wechatsync v2（commit `1230678`，版本 2.0.10）的 vendored fork，按 **GPL-3.0** 发布；完整许可见 [`LICENSE`](LICENSE)，上游基线与修改见 [`UPSTREAM.md`](UPSTREAM.md) 与 [`NOTICE`](NOTICE)。
- 主仓库其余部分仍为 MIT；本地助手（`native/` helper）与 NM 注册器是主仓库 MIT 自研，`BRIDGE_*` 消息面与本目录按协议事实对齐、不拷贝。
- StashDock 仅作视觉与交互参考，未复制其 AGPL 代码。
- 上游私有适配器子模块不在公开源码中；本分支自研的小红书页面自动化适配器位于 `packages/core/src/adapters/platforms/private/xiaohongshu.ts`（仅保存浏览器本地草稿，不点发布）。
