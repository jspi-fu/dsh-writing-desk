# DSwritesync 重写共识

Status: confirmed(2026-11-19 grill 会话;实现前的共享理解,决策细节见 [ADR 0010](../adr/0010-dswritesync-wechatsync-fork.md))

> **已被 ADR 0012 部分取代(2026-11-19)**:本地接入面最终走了 Native Messaging 自动配对——本文的 `dswritesync serve` CLI、WS 端口、token/auth.json 与「Desk 协议 v1」章节仅作历史记录,现状以 [ADR 0012](../adr/0012-bridge-native-messaging.md) 与 `GLOSSARY.md` 的「本地助手 / 配对 / 投递箱」词条为准。

## 目标

把现有自研浏览器扩展与本地桥完全替换为 **DSwritesync**:一个以 Wechatsync v2 完整源码为基座、加入 StashDock 浏览器扩展采集能力的 MV3 侧边栏应用 + CLI。用户在一个侧栏里完成「收进网页 → 同步到平台草稿箱」;工作台继续承担编辑、成稿、校样与发布状态确认。

## 产品形态

- 浏览器侧边栏是唯一首页,popup 退役;点工具栏图标开侧栏。
- 头部:DSwritesync 品牌、连接状态、设置齿轮。
- 顶部分段标签:收进 / 同步 / 账号 / 历史。
- 设置是共享页,由齿轮进入;采集与同步共用。
- 默认落在「收进」。
- 侧栏之外保留:通用文章页 FAB、公众号文章页同步对话框 iframe、公众号后台编辑器页同步对话框 iframe。FAB 直接进同步。
- 删除:全屏编辑器、编辑器 iframe、同步对话框里的「调整文章」按钮。preprocessor 保留(它服务于无网页标签时的同步预处理,不是编辑器)。编辑只在 DSH 工作台。

## 目录与构建

```
extension/                     # vendored Wechatsync fork, GPL-3.0
  package.json                 # pnpm workspace 根
  pnpm-workspace.yaml
  UPSTREAM.md                  # upstream commit 1230678, 2.0.10
  LICENSE / NOTICE
  packages/core/               # 适配器与同步引擎
  packages/extension/          # 侧边栏应用(原 popup 收编)
  packages/cli/                # bin: dswritesync;src/bridge/ 为扩展桥
```

- 顶层 `cli/` 删除,CLI 并入 vendored workspace。
- 主仓库仍是 npm 单包;`extension/` 不进 `files`,不引 root workspaces。
- 构建用 pnpm(独立 node_modules / lockfile),Vite 出 `packages/extension/dist`。
- 内部 workspace 包名保留 `@wechatsync/*` 以减小上游 diff;用户面的 bin / manifest / 关于页全部 DSwritesync。

## 命令面

```
dswritesync serve                 # 本地服务:WS 9527 + 投递箱监听 + token 生成
dswritesync sync <file> -p ...    # 上游文件同步
dswritesync platforms --auth      # 平台 / 登录态
dswritesync auth [platform]       # 登录检查
dswritesync extract -o <file>     # 从当前页提取文章
```

- token:`dswritesync serve` 生成 `~/.dsh/writing-desk/bridge/auth.json`(0600);工作台设置页显示;扩展设置页粘贴;扩展只连一个 WS。
- 语言:默认系统 locale;`--lang zh|en`、`DSWRITESYNC_LANG`、`~/.dsh/writing-desk/config.json` 覆盖;CLI help / 提示 / 进度 / 错误全双语。
- MCP server 已移除;接入面只保留 CLI + skill,`serve` 是唯一本地服务。

## 数据流

1. **收进**:扩展读当前页 / 选区 → 用户确认标题 / 正文 / 标签 / 封面 → WS `desk.capture` → CLI 写 `inbox/` → 宿主消化成灵感;冲突 / 替换带 operationId;断连复制 Markdown。
2. **当前页同步**:扩展提取当前页文章 → 平台多选 / 登录态 → 适配器逐平台草稿 → 进度 / 结果 / 历史;不依赖工作台。
3. **工作台投递**:校样浮层 → host 写 `outbox/` → CLI 下发扩展 → 同步页逐平台 → 回执写 `receipts/` → host `item.dispatches`;status 不变(红线)。
4. **账号 / 历史**:扩展 storage 与平台登录态检测;历史保留最近记录。

## Desk 协议 v1(扩展 ↔ `dswritesync serve`)

传输:`ws://127.0.0.1:9527`,扩展主动外连;HTTP 9528 只绑回环、带 token,供 CLI secondary 转发。`serve` 不得复用上游 `createBridge`(它等连接、装 SIGINT 后直接退出);用 `ExtensionBridge` 直接 `start()`,并 fail-fast 于 secondary/端口被占。

**握手**

1. 扩展连上后首帧:`{kind:'hello', token, version, lang}`。
2. CLI 用 `auth.json` 的 token 校验;成功回 `{kind:'hello-ok', version}`;失败 close(4001 缺 token / 4003 不匹配)。
3. 之后的请求/响应沿用上游 `{id, method, params?}` / `{id, result?, error?}`;token 不再逐条携带。HTTP `/request` 必须带 `Authorization: Bearer <token>`(或 body token),否则 401。

**扩展 → CLI 事件**

- `{kind:'event', event:'desk.capture', id, payload:{operationId, url, title, body, siteName, tags, cover?, captureMethod?, truncated?, replaceItemId?}}`
  - CLI 原子写 `inbox/import-<operationId>.json`;立即回 `{kind:'ack', id, ok:true, operationId, queued:true}`。
  - 宿主回执 `receipts/import-<operationId>.json` 出现后,CLI 推 `{kind:'event', event:'desk.capture-result', payload:{operationId, ok, itemId?, error?, duplicate?, replaced?}}`。
- `{kind:'event', event:'desk.catalog-request', id}` → CLI 回 `{kind:'event', event:'desk.catalog', id, payload:{at, tags:[...], urls:{url:itemId}}}`;读 `bridge/catalog.json`,缺失时返回空表。
- `{kind:'event', event:'desk.log', payload:{level, message}}` 可选,只打印不落库。

**Catalog 与冲突替换**

- 宿主每 3 秒/state 变化时原子写 `bridge/catalog.json`:`{at, tags:[...], urls:{url:itemId}}`;结构未变可跳过写。
- 扩展收进前请求 catalog;URL 命中 → 冲突对话框(保留/替换)。替换发送 `desk.capture` 带 `replaceItemId`。
- 宿主 inbox import:有 `replaceItemId` 且 item 存在 → `update_item`(id + 字段);否则 `add_item`;同一 `operationId` 的回执幂等语义不变。`duplicate` 由扩展的 catalog 命中决定,宿主不再猜。

**工作台投递**

1. CLI 监听 `outbox/publish-*.json`,原子认领(`.claiming`),忽略 `.tmp/.failed`。
2. 读 `articleMd`,把 `images/<file>` 按 `images` 映射替换为 data URI 或分片上传,复上游 `sync` 的图片管线。
3. 调上游 `syncArticle`(`{platforms, article:{title, markdown, content?, cover?}}`);结果行 `{success, postUrl, draftOnly, error}` 映射成宿主回执 `{platform, ok, url?, error?}`。
4. 原子写 `receipts/dispatch-<operationId>.json`;同一 operationId 不得写不同结果;无扩展时保留任务重试(有上限),已认领断线写 `ok:false` 回执。
5. 平台 id 必须命中宿主 `BRIDGE_ADAPTERS`;该清单随适配器扩容(20 个内容平台,排除 `zip-download`;小红书走页面自动化,只存本地草稿)。

**auth.json**

- `{v:1, token, wsPort:9527, httpPort:9528, pid, startedAt}`;目录 0700、文件 0600(Windows best-effort)。
- token 优先级:`--token` > `WECHATSYNC_TOKEN` > `auth.json`;首次生成 UUID。
- 扩展设置粘贴 token/ws URL;`BRIDGE_SET_TOKEN` 写 `chrome.storage.local`;`BRIDGE_STATUS` 只回 `hasToken/tail`,不再自动生成或回传完整 token。

**平台名**

- 扩展 UI 与 CLI 输出都按平台 id 映射中英名;上游 `meta.name` 保持中文,不改 20+ 个适配器。CLI 的英文名表与扩展 UI 的 i18n 表共用同一 id 集合。

## 设置页

- **连接**:服务地址 / 端口、桥接 Token 粘贴、连接状态、复制 `dswritesync serve`、工作台取 Token 提示。
- **通用**:语言(跟随系统 / 中文 / English);暗色跟随系统。
- **同步**:常用平台、深度清理、悬浮按钮。
- **自建站**:CMS 账号(WordPress / Typecho / MetaWeblog)。
- **关于**:版本、GPL-3.0、上游归属(Wechatsync;StashDock 视觉参考未复制代码)。

## 许可与归属

- vendored `extension/` 按 GPL-3.0 发布;保留上游版权 / NOTICE;`UPSTREAM.md` 记录基线与修改。
- 主仓库其余部分仍 MIT;README 写清分发边界与 GPL 源码义务。
- StashDock 是 AGPL-3.0;只重实现视觉与交互,不复制代码。

## 实施顺序

1. **基座**:vendor Wechatsync 2.0.10 到 `extension/`,pnpm install / build,加载未改动的扩展跑通基线;记录 upstream commit。
2. **壳**:侧栏 manifest / action、头部、四个标签、设置路由、popup 退役;Wechatsync 页面迁入侧栏。
3. **收进**:StashDock 式表单 + 封面 + 标签建议 + 冲突替换;CLI `serve` + desk capture 协议 + inbox;宿主消化;离线 Markdown。
4. **同步**:当前页 / 工作台任务在同步页;账号 / 历史;FAB 与公众号 iframe 改接同步;删除编辑器 / 调整按钮;保留 preprocessor。
5. **i18n**:扩展词典与 LocaleProvider;CLI 词典与 `--lang`;平台名双语映射。
6. **品牌与清理**:DSwritesync 命名、图标、manifest、关于页;移除遥测 / 远程配置 / 版本检查 / 推广;LICENSE / NOTICE / UPSTREAM;README / GLOSSARY / ADR 更新。
7. **验收**:单测 + ego lite / Edge 真机全链路。

## 风险与待验证

- pnpm / Node 版本与 Windows 构建;上游 Vite 依赖能否在本地复现。
- `sidePanel.open` 需要用户手势;工作台一键投递的 fallback(优先侧栏,失败开 396×560 同步窗口)。
- 宽 host 权限的安装提示与用户接受度。
- 上游适配器随平台改版失效;登录态真机验证。
- GPL 合规:扩展 / CLI 分发时的源码提供与 NOTICE。
- 移除编辑器对上游模块的牵连(route、content script、ArticleCard 按钮);preprocessor 保留。
- 旧测试 / 文档改写范围。

## 验收场景

见 [ADR 0010 的验收场景](../adr/0010-dswritesync-wechatsync-fork.md#验收场景)。