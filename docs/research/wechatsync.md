# Wechatsync 研究报告 —— 面向 dsh-writing-desk「一键多平台发布」融合

> 研究对象：`参考项目/Wechatsync`（本地 git 仓库，HEAD `1230678`，v2.0.10）
> 研究目的：把 Wechatsync 的一键多平台发布能力融合进 dsh-writing-desk 浏览器扩展（导出依托），并在本仓库二次开发其 CLI 作为工作台与扩展的桥。
> 阅读范围：`packages/extension/`、`packages/core/`、`packages/cli/`、`packages/mcp-server/`、`docs/adapter-spec.md`、`README.md`、`packages/extension/ROADMAP.md`。
> 所有路径引用均为 Wechatsync 仓库内相对路径（`仓库根:文件:行号`）。

---

## 0. 结论速览

| 问题 | 一句话结论 |
|------|-----------|
| 1 扩展架构 | MV3 + crxjs/Vite 构建；`<all_urls>` host_permissions + cookies/DNR/scripting/tabs 等大权限；background 是模块化 Service Worker，4 个 HTML 入口（popup/editor/sync-dialog/preprocessor）。 |
| 2 发布流程 | 5 个发起入口（微信文章页 FAB、通用悬浮球、popup、右键菜单、微信后台编辑器 FAB）；同步 UI 是注入页面的 **iframe（扩展自有 HTML 页面）**；队列按**每批 3 个平台并行**分批推进，全程**草稿优先**（所有适配器默认只建草稿）。 |
| 3 适配器层 | `PlatformAdapter` 接口 + `CodeAdapter` 基类 + `RuntimeInterface` 抽象，适配器在 SW 中纯 fetch + 正则（无 DOM）；**小红书适配器不在公开仓库**（在未检出的 private submodule 里，不可参考），weixin/zhihu/juejin 三个公开适配器的端点、Cookie/CSRF、限制详见 §3.3-3.5。 |
| 4 图片管线 | 统一走 `CodeAdapter.processImages`：正则抽 HTML/Markdown 图片 URL → 逐张下载/转存/上传到目标平台图床 → 替换 URL；**单张失败不中断，保留原图降级**；各平台自带 skipPatterns 免转存自有 CDN。 |
| 5 桥接 | 通道 = **扩展主动外连 `ws://localhost:9527`**（服务端在 Node 侧，扩展是 WS client）+ 9528 HTTP（SSE/健康检查/secondary 转发）；鉴权 = 扩展生成 token 存 storage、CLI 从 `WECHATSYNC_TOKEN` 读、**扩展侧校验每条消息的 token**；报文 = `{id, method, token, params}` / `{id, result, error}`，共 6 个方法。 |
| 6 MCP server | 与 CLI **共用同一个 `ExtensionBridge` 类**（CLI 直接 import `@wechatsync/mcp-server/bridge`）；stdio 为推荐模式，`--sse` 走 9528 `/sse`；stdio/SSE 都要先起 bridge 再挂 MCP SDK transport。 |
| 7 可复用性 | 适配器层**可整体抽出**给我们的扩展用，硬依赖只有 5 个扩展 API（cookies/declarativeNetRequest/storage/tabs/downloads）+ SW 环境约束（无 DOM，全靠正则）；CLI 骨架（bridge 连接/文件解析/本地图片处理）与协议报文均可搬。 |
| 8 许可 | 仓库整体 **GPL-3.0**（但 `cli`、`mcp-server` 两个子包 package.json 自标 MIT，存在冲突）；**复制适配器/CLI 源码 = 衍生作品，分发时必须 GPL-3.0**；最安全边界是「协议重实现 + GPL 子树隔离」或「GPL 独立包 + MIT 主体经 socket 通信」（§8）。 |

---

## 1. 仓库总览

```
Wechatsync/
├── package.json              # monorepo（workspaces: packages/*，无根 license 字段）
├── LICENSE                   # GPL-3.0
├── README.md:304-306         # 声明 "License: GPL-3.0"
├── docs/adapter-spec.md      # 适配器开发规范（464 行，中文，质量高）
├── packages/
│   ├── extension/            # Chrome MV3 扩展（vite + @crxjs/vite-plugin，v2.0.10）
│   ├── core/                 # 适配器核心（tsup 构建，源码直出 exports）
│   ├── cli/                  # CLI（commander + tsup，package.json 标 MIT）
│   └── mcp-server/           # WS 桥 + MCP Server（express + ws + MCP SDK，标 MIT）
└── skills/wechatsync/SKILL.md  # Claude/OpenClaw 的 CLI 使用 skill
```

关键分工：
- `extension` 是唯一「有平台登录态」的执行体：所有平台 API 调用都发生在扩展 Service Worker（带浏览器 Cookie）。
- `core` 是适配器实现库，被 extension 以**源码 alias** 方式引入（`packages/extension/vite.config.ts:109` `@wechatsync/core → ../core/src`），不经过构建产物。
- `cli` / `mcp-server` 自身**不实现协议**，二者共用 `mcp-server/src/ws-bridge.ts` 的 `ExtensionBridge`，仅是桥的两种宿主（CLI 命令宿主 / MCP stdio/SSE 宿主）。

---

## 2. 扩展架构（问题 1）

### 2.1 manifest.json 全貌（`packages/extension/manifest.json`）

- **manifest_version: 3**（MV3，background 为 module Service Worker，`manifest.json:34-37`）。
- **permissions**（`manifest.json:15-26`）：`storage`、`unlimitedStorage`、`cookies`、`declarativeNetRequest`、`declarativeNetRequestWithHostAccess`、`scripting`、`tabs`、`alarms`、`contextMenus`、`downloads` —— 这份清单就是适配器层对扩展 API 的完整硬依赖（见 §7）。
- **host_permissions**：`http://*/*` + `https://*/*`（`manifest.json:27-30`），即全站权限，保证 SW fetch 带 Cookie 直连任何平台。
- **content_scripts**（`manifest.json:38-68`）5 组：
  1. `src/content/api.ts` → `<all_urls>`、`document_start`、`all_frames`；
  2. `src/content/weixin.ts` → `mp.weixin.qq.com/s/*`（文章页，注入 FAB + 同步弹窗）；
  3. `src/content/weixin-editor.ts` → `mp.weixin.qq.com/cgi-bin/appmsg*`（公众号后台编辑器）；
  4. `src/content/toutiao.ts` → `mp.toutiao.com/*`；
  5. `src/content/extractor.ts` → `<all_urls>`、`document_end`（提取器 + 通用悬浮球 + 编辑器宿主）。
  - 构建时 `vite.config.ts:53-74` 会**再往 dist/manifest.json 插入一条** `reader.js + Readability.js`（`<all_urls>`、`document_start`），与 extractor 共享 ISOLATED world 全局。
- **web_accessible_resources**（`manifest.json:69-75`）：`src/editor/index.html`、`src/sync-dialog/index.html`、`inject-api.js`、assets——供 content script 建 iframe 引用。
- **action.default_popup** = `src/popup/index.html`（`manifest.json:10-13`）。

### 2.2 构建方式与产物

- 构建：`vite + @crxjs/vite-plugin beta`（`packages/extension/package.json` devDependencies；`vite.config.ts:96` `crx({ manifest })`），`build = tsc && vite build`，产物 `packages/extension/dist/`，`prod` 脚本额外 zip。
- 4 个 HTML 入口（`vite.config.ts:116-123`）：
  - `popup`（工具栏弹窗，React + zustand + tailwind）
  - `editor`（全屏编辑器，iframe 注入页面）
  - `sync-dialog`（同步对话框，iframe 注入页面）
  - `preprocessor`（1x1 隐藏预处理窗口，见 §2.4）
- core 依赖以源码 alias 打进 SW bundle；`decode-named-character-reference` 特殊 resolve 处理（`vite.config.ts:85-93`，因 SW 无 DOM）。
- 生产模式 `import.meta.env.PROD` 覆写控制 logger 降级（`vite.config.ts:102-104`）。

### 2.3 background（Service Worker）结构

`packages/extension/src/background/index.ts`（836 行）：
- **消息总线**：`chrome.runtime.onMessage` 单一入口，`MessageAction` 联合类型 21 种（`index.ts:44-69`），核心动作：`GET_PLATFORMS` / `CHECK_ALL_AUTH` / `SYNC_ARTICLE` / `START_SYNC_FROM_EDITOR` / `UPLOAD_IMAGE` / `GET_PREPROCESS_CONFIGS` / `TRIGGER_OPEN_EDITOR` / `MCP_*` / `CANCEL_SYNC` / `GET_SYNC_STATE` 等。
- **`SYNC_ARTICLE` 处理**（`index.ts:127-175`）：限频检查 → `generateSyncId()` → `performSync()`（sync-service）→ 通过 `chrome.runtime.sendMessage` + `chrome.tabs.sendMessage(senderTab)` 双通道回推 `SYNC_PROGRESS` / `IMAGE_PROGRESS` / `SYNC_DETAIL_PROGRESS`。
- **右键菜单**「同步助手 - 提取并编辑文章」（`index.ts:612-618, 637-679`）→ 向 content script 发 `OPEN_EDITOR`。
- **启动时**：`onInstalled` 预加载适配器 + 欢迎页/changelog（`index.ts:684-729`）；`initMcpIfEnabled()` 恢复 MCP WS 客户端（`index.ts:734-756`）；`preCheckPlatformsAuth()` 预热登录态缓存（`index.ts:762-779`）；alarms 做 24h 增长指标 + 6h 远程配置（`index.ts:782-792`）；**启动即清理孤儿 DNR 动态规则**（`index.ts:818-834`，防止崩溃后残留规则污染其它网站——值得抄的细节）。
- 同步状态持久化：`sync-service.ts` 维护 `activeSyncState`（`SYNC_STATE_KEY`，`sync-service.ts:71`）与 25 条 `syncHistory`，并驱动扩展图标 badge（`✓`/`!`/成功数，`sync-service.ts:86-127`）——popup 崩溃/SW 重启后可恢复现场（`popup/stores/sync.ts:205` 用 `GET_SYNC_STATE` 恢复）。

### 2.4 一个特别设计：DOM 预处理借宿于网页/隐藏窗口

MV3 SW 无 DOMParser。Wechatsync 的解法（`background/sync-service.ts:449-539`）：
1. `sendPreprocessMessage` 先找**当前活动标签页**（http/https），向其 content script 发 `PREPROCESS_FOR_PLATFORMS`；
2. 失败则轮询**所有已打开网页标签**；
3. 仍失败则 `chrome.windows.create` 开一个 **1×1 隐藏 popup** 加载 `src/preprocessor/index.html`（`preprocessor/index.ts`，39 行）完成 DOM 预处理后自动关闭（`sync-service.ts:491-539`）。
- 结果：`platformContents: Record<平台ID, {html, markdown}>`，每个平台拿到专属预处理产物。
- 含义：**没有打开任何网页时，DOM 预处理链路不可用**（`sync-service.ts:287` 打印警告）——这是我们设计自己的管线时必须规避的坑（见 §7）。

### 2.5 popup

- `src/popup/`：React 18 + zustand + react-router-dom(hash) + tailwind；页面 `HomeNew.tsx`（主界面，319 行）、`Accounts.tsx`（账号）、`History.tsx`（历史）、`AddCMS.tsx`、`About.tsx`、`SettingsDrawer.tsx`。
- 发起同步：popup 从活动标签页 `EXTRACT_ARTICLE` 提取（`popup/stores/sync.ts:326`）→ `SYNC_ARTICLE` 发给 background（`sync.ts:427-428, 501-503`）。
- SettingsDrawer 是 MCP 开关/Token/服务器地址的配置 UI（对应 `MCP_ENABLE/MCP_DISABLE/MCP_SET_SERVER_URL/MCP_WATCH_START`，`background/index.ts:336-386`）。

---

## 3. 发布流程（问题 2）

### 3.1 发起入口（共 5 个）

| 入口 | 位置 | 链路 |
|------|------|------|
| 微信文章页绿色 FAB | `content/weixin.ts:15-25`（`createSyncFab`，`lib/fab.ts:21-96`，固定右下角 40px 高胶囊按钮） | 点 FAB → 页面内提取 → 建 iframe 加载 `sync-dialog/index.html`（`weixin.ts:31-117`） |
| 通用悬浮球（任意网页，可开关） | `content/extractor.ts:905-946`，受 `floatingButtonEnabled` 设置控制（`extractor.ts:931-946`），微信域名不重复注入（`extractor.ts:908`） | 点 FAB → `TRIGGER_OPEN_EDITOR` → background 校验平台 → `OPEN_EDITOR` → **全屏 iframe 编辑器**（`extractor.ts:977-1057`） |
| popup 工具栏弹窗 | `popup/stores/sync.ts` | 提取活动标签页 → `SYNC_ARTICLE` |
| 右键菜单 | `background/index.ts:612-679` | → `OPEN_EDITOR`（全屏编辑器） |
| 公众号后台编辑器 FAB | `content/weixin-editor.ts:31-` | 与文章页同构，把当前编辑中的图文作为源 |

### 3.2 同步对话框 UI 在哪渲染

**不在页面内嵌 DOM，而是扩展自有 HTML 页面套 iframe**，规避页 CSP/样式污染：
- `sync-dialog/index.html`（web_accessible_resources）承载 `SyncDialogPage.tsx`（`src/sync-dialog/SyncDialogPage.tsx:16-205`），400×520 iframe（`content/weixin.ts:93-100`）。
- content script 与 iframe 用 **postMessage + JSON 字符串** 通信：握手 `SYNC_DIALOG_READY` → `INIT_DATA{article, platforms}` → `START_SYNC{article, platforms, syncId}` → background 处理 → 进度 `SYNC_PROGRESS` / `SYNC_DETAIL_PROGRESS` 回传 → `SYNC_COMPLETE` / `SYNC_ERROR`（`weixin.ts:128-182`、`SyncDialogPage.tsx:30-96`）。
- 编辑器（全屏）同理：`EDITOR_READY` → `ARTICLE_DATA` / `PLATFORMS_DATA`；`START_SYNC` 由 content script 拦截并**先本地做逐平台预处理**再转发 `START_SYNC_FROM_EDITOR`（`extractor.ts:1108-1152`）。
- 平台选择状态持久化在 `chrome.storage.local.selectedPlatforms`（`SyncDialogPage.tsx:8-11`），重选时尊重历史且只保留已登录平台（`SyncDialogPage.tsx:44-56`）。

### 3.3 任务队列调度

- **逐平台发布在 `syncToMultiplePlatforms`（`extension/src/adapters/index.ts:484-644`）**：
  - **并发 = 3**（`CONCURRENCY_LIMIT = 3`，`index.ts:457`），按 `platformIds` 顺序**分批 `Promise.all`**，批间串行（`index.ts:597-618`）——不是完全串行也不是全并发。
  - 每批前检查 `AbortController` 取消标记，剩余平台立即标记「已取消」（`index.ts:519-535, 599-614`）；`cancelSync()` 由 `CANCEL_SYNC` 消息触发（`index.ts:465-472`）。
  - 单平台超时 10 分钟（`PUBLISH_TIMEOUT`，`index.ts:186`，含图片上传）；认证检查超时 10 秒、并发 5 批（`index.ts:184-185`）。
  - 进度三级回调：`onResult` / `onImageProgress`（第几张图）/ `onDetailProgress`（`starting → uploading_images → saving → completed|failed` 五阶段状态机，`index.ts:376-401, 537-582`）。
- **登录态预检**：`checkAllPlatformsAuth` 带缓存（已登录 5 分钟 / 未登录 30 秒 TTL，`index.ts:181-183`），批量并行、错误也缓存（`index.ts:268-366`）。
- **预处理编排**（`background/sync-service.ts:200-447` `performSync`）：
  1. 归一化 article（markdown→HTML 兜底，`sync-service.ts:223-231`）；
  2. 除源平台外逐平台取 `preprocessConfig` → 借宿网页 DOM 产出 `platformContents`（`sync-service.ts:264-291`）；
  3. DSL 平台批量同步 + CMS（WordPress/Typecho/MetaWeblog）逐个同步（`sync-service.ts:295-428`）；
  4. 每个结果实时写 `activeSyncState` + history（`sync-service.ts:302-304`）。
- **限频防封**：5 分钟内重复同步会出警告（`lib/rate-limit.ts:11-13`）。

### 3.4 「草稿优先」的体现

- README 明示原则「默认将文章同步为草稿，发布前由你人工确认」（`README.md:20`）。
- 代码落点：`syncToPlatform` 调 `adapter.publish(article, { draftOnly: options?.draftOnly ?? true })`（`adapters/index.ts:436-443`）——**默认 true 且无人传 false**；三大适配器全部只建草稿：
  - weixin：`operate_appmsg` 创建素材（本质是草稿箱），返回编辑页 URL，`draftOnly: options?.draftOnly ?? true`（`core/src/adapters/platforms/weixin.ts:259-265`）；
  - zhihu：只调 `POST /api/articles/drafts` + `PATCH draft`，从不调发布接口（`zhihu.ts:94-189`）；
  - juejin：只调 `article_draft/create`（`juejin.ts:226-282`）。
- ROADMAP 自曝短板：`draftOnly` 参数目前**仅透传，未实现分支逻辑**（`ROADMAP.md:10`）——即传 false 也不会真发布。
- 草稿 URL 直接回填 UI 供用户点击进入平台编辑器确认发布（`postUrl` 如 `zhuanlan.zhihu.com/p/{id}/edit`）。

---

## 4. 适配器层（问题 3）

### 4.1 接口与基类

**`PlatformAdapter` 接口**（`core/src/adapters/types.ts:124-154`）：

```ts
interface PlatformAdapter {
  readonly meta: PlatformMeta                      // id/name/icon/homepage/capabilities
  readonly preprocessConfig?: Partial<PreprocessConfig>  // 声明式内容预处理配置
  init(runtime: RuntimeInterface): Promise<void>
  checkAuth(): Promise<AuthResult>                 // 预检登录态
  publish(article: Article, options?: PublishOptions): Promise<SyncResult>
  uploadImage?(file: Blob, filename?: string): Promise<string>
  getCategories?(): Promise<Category[]>
  getDrafts?(): Promise<Draft[]>
  update?(postId: string, article: Article): Promise<SyncResult>
  delete?(postId: string): Promise<void>
}
```

**`CodeAdapter` 抽象基类**（`core/src/adapters/code-adapter.ts:54-387`）提供：
- `withHeaderRules(rules, fn)`：临时挂 DNR 头规则 → 执行 → finally 清理（`code-adapter.ts:117-127`）；
- `get/postJson/postForm/postMultipart`：统一 `credentials: 'include'` 的 fetch 包装（`code-adapter.ts:134-198`）；
- `processImages(content, uploadFn, options)`：图片转存引擎（见 §5）；
- `createResult`：统一 SyncResult 构造。

**`RuntimeInterface`**（`core/src/runtime/interface.ts:7-117`）是适配器与环境的唯一边界：`fetch`（带 cookie）、`cookies.get/set/remove`、`storage`/`session`、可选 `headerRules`/`downloads`/`tabs`、`dom.parseHTML`。扩展实现见 `extension/src/runtime/extension.ts`：
- fetch 强制 `credentials:'include'` + 30s AbortController 超时（`extension.ts:21-41`）；
- **headerRules 用 `chrome.declarativeNetRequest.updateDynamicRules` 且 `initiatorDomains: [chrome.runtime.id]`**（`extension.ts:125-174`）——规则只影响扩展自身请求，不污染网页，这是全方案能伪造 Origin/Referer 的基石。

**`AdapterRegistry`**（`core/src/adapters/registry.ts:10-115`）：meta 注册 + 惰性实例化缓存 + `getPreprocessConfigs` 合并默认配置。

文章 payload 标准结构（`core/src/types.ts:8-20`）：

```ts
interface Article {
  title: string
  markdown: string      // 主格式：content script 用 Turndown/原生 DOM 转换
  html?: string         // 可选：需要 HTML 的平台（weixin/zhihu）
  summary?: string
  cover?: string
  tags?: string[]
  category?: string
  source?: { url: string; platform: string }   // 源平台标识，驱动快路径
}
```
运行期还会附加 `platformContents`（逐平台预处理结果，`adapters/index.ts:424-433`）与微信专用的 `rawHtml`（微信→微信直传快路径，`weixin.ts:147-153`）。

**架构分工**（`code-adapter.ts:1-22` 注释明示）：Content Script（有 DOM）负责全部 HTML/Markdown 加工；Service Worker 只做「图片 URL 上传替换 + 平台 API 调用」。每平台预处理配置声明在适配器的 `preprocessConfig`（如知乎的 `removeSpecialTagsWithParent` 等 11 项，`zhihu.ts:25-41`），由 `lib/content-processor.ts:40-150` 执行。

### 4.2 小红书适配器 —— **不在公开仓库（重要事实）**

- 公开仓库 `core/src/adapters/platforms/` 共 20 个适配器（`platforms/index.ts`），**没有 xiaohongshu**。
- `README.md` 平台表宣称支持小红书，`.gitmodules` 显示 `packages/core/src/adapters/platforms/private` 是指向**私有仓库** `git@github.com:wechatsync/wechatsync-private-adapters.git` 的 submodule，**未检出**（`git submodule status` 前缀 `-`）；`extension/src/adapters/index.ts:50-78` 用 `import.meta.glob` 动态装载 private 目录。
- ROADMAP 提供了仅有的一手情报（`ROADMAP.md:38`）：小红书请求 50+、状态「✅ 已支持、**仅草稿**、反爬严格」；另注「小红书审核严格，不建议自动发布」（`ROADMAP.md:9`）。
- **对我们**：无法参考其实现（未开源、非 GPL 授权范围）；小红书需自行逆向（网页端 `creator.xiaohongshu.com` 发布接口 + 反爬签名），且只能以「草稿/本地笔记」为目标。

### 4.3 微信公众号 weixin（`core/src/adapters/platforms/weixin.ts`，409 行）

- **checkAuth**（`weixin.ts:78-133`）：GET `https://mp.weixin.qq.com/`（带 Cookie），**从首页 HTML 正则刮出 5 个凭据**：`token`（`data:{...t:"..."}`）、`ticket`、`user_name`、`nick_name`、`svr_time`、头像 —— 缓存在适配器实例，供后续所有请求与图片上传使用。
- **publish**（`weixin.ts:135-269`）：
  - `withHeaderRules` 注入 `Origin/Referer: https://mp.weixin.qq.com`（`weixin.ts:67-76`）；
  - 微信→微信快路径直接用 `rawHtml`，否则走 LaTeX 渲染（codecogs 图片化，`weixin.ts:329-345`）→ `stripExternalLinks`（微信正文禁外链，非微信域名 `<a>` 降级为纯文字，`weixin.ts:356-374`）→ 图片转存（跳过 `mmbiz.qpic.cn`）→ `juice` 内联默认 CSS（`weixin.ts:22-45, 347-350`）；
  - **提交端点**：`POST https://mp.weixin.qq.com/cgi-bin/operate_appmsg?t=ajax-response&sub=create&type=77&token={token}&lang=zh_CN`，`application/x-www-form-urlencoded`，约 60 个 `xxx0` 字段（title0/content0/cdn_url0/...，`weixin.ts:167-244`）；
  - 鉴权 = URL 里的 `token` + Cookie（`credentials:'include'`），无独立 CSRF 头；
  - 成功返回 `appMsgId`，拼草稿编辑页 URL。
- **uploadImageByUrl**（`weixin.ts:271-320`）：任意 src 先 `fetch` 下载成 Blob → FormData（file/type/id/name/size）→ `POST /cgi-bin/filetransfer?action=upload_material&f=json&scene=8&writetype=doublewrite&groupid=1&ticket_id={userName}&ticket={ticket}&svr_time={svrTime}&token={token}&seq=...` → 响应 `cdn_url` 直接替换正文。**依赖 checkAuth 阶段刮到的 ticket/token**。
- **限制/错误码**：完整错误映射表 25 条（`weixin.ts:376-408`）：`-6/-8 验证码`、`200003 登录态超时`、`412/62752/64507/64562 非法外链`、`64702 标题 64 字`、`220001/220002 素材库上限` 等。另注意草稿 URL 含 token，泄漏即后台权限。

### 4.4 知乎 zhihu（`core/src/adapters/platforms/zhihu.ts`，511 行）

- **checkAuth**（`zhihu.ts:62-92`）：GET `https://www.zhihu.com/api/v4/me`（带 `x-requested-with: fetch` 头 + Cookie）。
- **publish**（`zhihu.ts:94-189`）两步草稿：
  1. `POST https://zhuanlan.zhihu.com/api/articles/drafts`（JSON：`{title, content:'', delta_time:0}`）拿 `draftId`；
  2. `PATCH https://zhuanlan.zhihu.com/api/articles/{draftId}/draft` 写入正文。
  - 头规则：`www.zhihu.com/api/*`、`zhuanlan.zhihu.com/api/*`、`api.zhihu.com/*` 注入 `x-requested-with: fetch`（`zhihu.ts:44-60`）。
  - 正文为 HTML，但有知乎 Draft.js 特化转换（`transformContent`，`zhihu.ts:194-217`）：`<img>` 必须包 `<figure>`；`<pre><code class="language-x">` → `<pre lang="x"><code>`；表格重写为 `data-draft-node="block" data-draft-type="table"` 结构（`zhihu.ts:222-275`）；剥除 `data-*`（保留 `data-draft-*`）与所有 `style`。
- **图片上传双通道**（`zhihu.ts:288-378`）：
  - 远程 URL：`POST https://zhuanlan.zhihu.com/api/uploaded_images`（form：`url + source=article`）——知乎服务端代抓，返回 `src`（最省事）；
  - data URI/二进制：`POST https://api.zhihu.com/images`（JSON：`{image_hash: md5(buffer), source:'article'}`）拿 STS 凭据 `upload_token{access_id, access_key, access_token}` + `object_key`；已存在（`state===1`）则轮询 `GET /images/{image_id}` 等 `original_hash`（最多 10 次 ×1s，`zhihu.ts:383-398`）；否则手签 **OSS V1 HMAC-SHA1**（Web Crypto）`PUT https://zhihu-pics-upload.zhimg.com/{object_key}`，bucket 为 `zhihu-pics`，带 `x-oss-security-token`，并在上传期间临时挂 `Origin: https://zhuanlan.zhihu.com` 头规则（`zhihu.ts:403-490`）；GIF 需补 `.gif` 后缀。最终 URL `https://pic4.zhimg.com/{objectKey}`。
- **鉴权**：纯 Cookie + `x-requested-with`；无 CSRF token 需求。
- **限制**：标题/内容上限未显式处理；图床域 `zhimg.com` 在 skipPatterns 中免转存。

### 4.5 掘金 juejin（对照：典型技术社区，`core/src/adapters/platforms/juejin.ts`，583 行）

- **checkAuth**：GET `https://api.juejin.cn/user_api/v1/user/get`（Cookie）。
- **CSRF**（`juejin.ts:169-199`）：`HEAD https://api.juejin.cn/user_api/v1/sys/token` 带请求头 `x-secsdk-csrf-request: 1` + `x-secsdk-csrf-version: 1.2.10`，从响应头 `x-ware-csrf-token`（格式 `0,{token},ttl,success,{session}`）取第 2 段缓存——**字节系 secsdk 方案**，之后所有写请求带 `x-secsdk-csrf-token` 头。
- **publish**（`juejin.ts:201-286`）：**Markdown 优先**（`preprocessConfig.outputFormat: 'markdown'`，`juejin.ts:106-108`）→ 图片转存（跳过 `juejin.cn/byteimg.com`）→ `POST https://api.juejin.cn/content_api/v1/article_draft/create`（JSON：brief_content/category_id/cover_image/edit_type:10/html_content:'deprecated'/**mark_content**/tag_ids/title）→ 拿 `data.id`，草稿页 `juejin.cn/editor/drafts/{id}`。头规则给 `api.juejin.cn` 与 `imagex.bytedanceapi.com` 伪造 `Origin/Referer: juejin.cn`（`juejin.ts:116-133`）。
- **图片上传 = 火山引擎 ImageX 四步**（`juejin.ts:336-559`）：
  1. `GET /imagex/v2/gen_token?aid=2608&uuid=...` 拿临时 AK/SK/SessionToken（缓存至过期前 60s）；
  2. `GET imagex.bytedanceapi.com?Action=ApplyImageUpload&ServiceId=73owjymdk6`（**AWS4 签名**，`core/src/lib/aws4.ts`）拿 StoreUri/UploadHost/SessionKey；
  3. `PUT https://{host}/{StoreUri}` 带 `Authorization: {storeAuth}` + `Content-CRC32`（自实现 crc32）；
  4. `POST ?Action=CommitImageUpload&SessionKey=...`，再 `GET /imagex/v2/get_img_url?uri=...` 换取公网 URL。
- **降级范例**：`uploadImageByUrl` 任何失败都**返回原 URL**不抛错（`juejin.ts:326-330`）——单图失败不拖垮整篇。
- 还提供 `getCategories()`（`juejin.ts:564-582`）与覆盖版 `uploadImage(Blob)`（供 MCP 上传用，`juejin.ts:292-294`）。

### 4.6 微博（默认图床，补充）

MCP/CLI 的 `uploadImage` 默认平台是 **weibo**（`mcp/client.ts:406` 等）。微博上传两条路（`weibo.ts:244-310`）：远程 URL 走 `POST card.weibo.com/article/v5/aj/editor/plugins/asyncuploadimg?uid=...`（form `urls[0]=src`）后**轮询**出 `pid`，拼 `https://wx3.sinaimg.cn/large/{pid}.jpg`；data URI 走直传。返回时附带 `attrs: {'data-pid'}`——`ImageUploadResult.attrs` 机制（`code-adapter.ts:34-39`）允许平台附加属性。

### 4.7 ZIP 下载适配器（本地导出）

`zip-download.ts`：把文章打包 `article.md + images/`（图片下载后改相对路径）经 `runtime.downloads.download`（data URL 方式，`extension/runtime/extension.ts:180-197`）落地——**「适配器」抽象也覆盖了非平台目标**，这个模式对我们「导出到本地文件」有直接参考价值。

---

## 5. 图片管线（问题 4）

### 5.1 预处理阶段（content script，有 DOM）

- `processLazyImages`：`data-src → src`（`lib/content-processor.ts:88-90`）；`removeEmptyImages`、`removeSrcset/sizes`（`content-processor.ts:100-106`）——先把「可取到」保证住。
- 微信来源的懒加载图、SVG 占位图等在此阶段修复。

### 5.2 转存引擎 `CodeAdapter.processImages`（SW，无 DOM；`code-adapter.ts:228-319`）

1. **双格式提取**：HTML `<img src>`（含单/双引号/无引号三态正则，`code-adapter.ts:240-245`）+ Markdown `![alt](url)`（手写解析器 `core/src/lib/markdown-images.ts`，处理转义/嵌套括号）。
2. **跳过规则**：`skipPatterns` 匹配平台自有 CDN（微信 `mmbiz.qpic.cn`、知乎 `zhimg.com`、掘金 `juejin.cn/byteimg.com`）则不转存；data URI 不受 skip 影响（`code-adapter.ts:266-273`）。
3. **同 URL 去重**：`uploadedMap` 缓存，同一图只上传一次（`code-adapter.ts:280-287`）。
4. **逐张上传**：调用子类 `uploadImageByUrl(src)`，成功后按原格式替换（HTML 重建 `<img src>` 并合并 `attrs`；Markdown 重建 `![alt](url)`，`code-adapter.ts:289-307`）。
5. **节流**：每张之间 `delay(300ms)`（`code-adapter.ts:315`）。
6. **进度**：`onProgress(current, total)` 上抛为 `IMAGE_PROGRESS` 消息，UI 显示第几张。

### 5.3 逐平台策略汇总

| 平台 | 下载方式 | 上传端点 | 失败行为 |
|------|---------|---------|---------|
| weixin | SW `fetch` 下载成 Blob | `/cgi-bin/filetransfer` FormData（multipart） | 抛错 → `processImages` 捕获，**保留原图 URL 继续下一张**（`code-adapter.ts:309-312`） |
| zhihu | URL 型：服务端代抓（uploaded_images）；data URI：md5+OSS 直传 | `zhuanlan/api/uploaded_images` 或 `api.zhihu.com/images` + OSS PUT | 抛错同上；二进制路径另有 `waitForImageReady` 10 次×1s 轮询 |
| juejin | SW fetch 下载（URL→Blob→ImageX） | ImageX 4 步（gen_token→apply→TOS PUT→commit→get_img_url） | **吞错返回原 URL**（`juejin.ts:326-330`） |
| weibo | URL 型：服务端转存轮询；data URI：直传 | `asyncuploadimg` + 轮询 pid | 轮询失败抛错 |

> 注意通用兜底是「单图失败 → 保留外站 URL」，**没有跨平台整体重试机制**；重试体现在 UI 层的「重试失败平台」按钮（`SyncDialogPage.tsx:143-158`，重新 `START_SYNC` 只含失败平台），以及知乎图片处理轮询。data URI 通道很重要：CLI/MCP 把本地图片转 base64 内嵌正文，由各适配器的 data URI 分支完成真正的平台内转存（CLI 侧 `convertImagesToDataUri`，`cli/src/index.ts:188-229`）。

### 5.4 CLI 侧图片策略（两选一）

- **默认（推荐）**：本地图片全部转 data URI 内嵌 → 交给目标平台适配器上传（`cli/src/index.ts:185-229`）；
- **备用**：先把本地图传到**第一个目标平台当图床**（`processLocalImages`，`cli/src/index.ts:234-282, 709-742`），其余平台再从该 URL 转存（依赖各平台「URL 代抓」能力，如知乎 uploaded_images / 微博 asyncuploadimg）。

### 5.5 MCP 大图分片

>1MB 图片按 512KB 分片走 WS：`uploadImage:start` → `uploadImage:chunk`(×N) → `uploadImage:complete`，扩展侧按序拼回 base64 再上传；会话 60s 超时、并发 5 上限（`mcp-server/src/ws-bridge.ts:530-581`；`extension/src/mcp/client.ts:415-505, 65-68`）。

---

## 6. CLI ↔ 扩展桥接（问题 5）

### 6.1 拓扑与通道

```
┌──────────────┐  主动外连 WS   ┌───────────────────────┐   stdio / SSE 9528 /sse
│ Chrome 扩展   │ ────────────▶ │ Node 侧 ExtensionBridge │ ◀────────  CLI / Claude
│ (WS client)  │ ws://localhost:9527   (WS server + HTTP API 9528)
└──────────────┘                └───────────────────────┘
```

- **服务端在 Node 侧**（`mcp-server/src/ws-bridge.ts`），**扩展是 WS client 主动外连** `ws://localhost:9527`（`extension/src/mcp/client.ts:42` `DEFAULT_SERVER_URL`，`client.ts:124`）。这个方向选择很关键：扩展不需要申请 native messaging 权限，Node 侧也不用管防火墙入站；代价是扩展必须开着且 `mcpEnabled=true` 才有连接（`client.ts:191-199` 只在启用时重连）。
- **可配置远端**：`mcpServerUrl` 存 storage 可指向非 localhost（远程桥接，`background/index.ts:364-376`）。
- **重连**：温热/冷却双阶段指数退避（温热 500ms→5s 封顶；冷却 10s→60s 封顶；`client.ts:53-63, 201-231`），设置页打开时强制温热（`setActivelyWatched`，`client.ts:237-248`）。
- **多实例**：bridge 启动时抢 9527 失败（EADDRINUSE）→ 降级 SECONDARY，把请求经 `POST localhost:9528/request` 转发给 PRIMARY；PRIMARY 死亡时 SECONDARY 轮询 `/status` 并**自动接管端口升 PRIMARY**（`ws-bridge.ts:48-61, 229-294, 349-415`）。CLI 端还内置了「端口占用进程诊断」（netstat/tasklist 提示，`cli/src/index.ts:527-549, 588-614`）。

### 6.2 Token 配置与校验

- **生成**：扩展设置页开启 MCP → `crypto.randomUUID()` 存 `chrome.storage.local.mcpToken`，已有则复用（`background/index.ts:336-352, 734-753`）。
- **分发**：用户从设置页复制 token → `export WECHATSYNC_TOKEN="..."`（CLI 引导文案，`cli/src/index.ts:60-64`）。
- **读取**：bridge 构造时读 `process.env.WECHATSYNC_TOKEN || MCP_TOKEN`（`ws-bridge.ts:29`）。
- **校验在扩展侧（不是服务器侧）**：每条请求消息带 `token` 字段，扩展比对本地 token，不匹配回 `{error:{code:403}}`，未配置回 401（`client.ts:263-304`）。服务器不验 token——**任何本地进程都能连上 9527，但发不出有效请求**；保护面是「本机其他用户/进程」而非网络。
- 协议类型定义：`mcp-server/src/types.ts`（`RequestMessage{id, method, token?, params?}` / `ResponseMessage{id, result?, error?{code,message}}` / `PlatformInfo` / `ExtensionMethod`）。

### 6.3 协议方法集（6 个）

| method | params | 返回 | 扩展侧实现 |
|--------|--------|------|-----------|
| `listPlatforms` | `{forceRefresh?}` | `PlatformInfo[]`（含登录态/用户名） | `checkAllPlatformsAuth`（`client.ts:314-317`） |
| `checkAuth` | `{platform}` | `AuthResult` | `client.ts:319-323` |
| `syncArticle` | `{platforms, article:{title, content?, markdown?, cover?}}` | `{results: SyncResult[], syncId}` | markdown→HTML 后走 `performSync`（`client.ts:325-370`）——**与 popup/编辑器共用同一同步引擎**，享受历史/状态/限频/CMS 全套 |
| `extractArticle` | 无 | `ExtractedArticle \| null` | 活动标签页 `EXTRACT_ARTICLE`；content script 未加载则动态注入 reader.js + extractor 再试（`client.ts:372-401`） |
| `uploadImage` | `{imageData(b64), mimeType, platform?}` | `{url, platform}` | `performImageUpload` → `adapter.uploadImage(Blob)`（`client.ts:516-543`） |
| `uploadImage:start/chunk/complete` | 分片 | 同上 | `client.ts:415-505` |

请求-响应配对：bridge 侧 `pendingRequests` Map + 超时 6 分钟（图片多场景，`ws-bridge.ts:25, 420-443`）；id 为 `{timestamp}-{random}`（`ws-bridge.ts:525-527`）。

### 6.4 三个命令的全链路

CLI（`cli/src/index.ts`，987 行，commander）：

- **`sync <file>`**（`cli/index.ts:629-792`）：
  解析 `.md`（YAML front-matter/一级标题提取，`parseMarkdown` :320-359）或 `.html`（title/h1/og:image/og:description meta 提取 + 本地 `<link stylesheet>` 内联 + **juice CSS 内联化**，`parseHtml` :367-464）→ 封面本地文件转 base64（:656-676）→ `--dry-run` 预览（:696-702）→ `createBridge()`（起 bridge、等扩展连接、失败时打印安装引导，:554-625）→ 本地图片处理（§5.4）→ `bridge.request('syncArticle', {...})` → 逐平台打印 `✓/✗ + postUrl + (草稿)` → `bridge.stop()` 退出。
- **`platforms`（别名 `ls`）**（:796-837）：`createBridge` → `listPlatforms`（`-a` 时 forceRefresh）→ 表格打印平台 + 登录态。
- **`extract`**（:915-966）：`createBridge` → `extractArticle` → `-o out.md` 落盘（`# 标题\n\n{markdown||content}`）或终端预览 500 字。
- 另有 `auth [platform]`（:841-911）查登录态。**默认超时 30s**（`--timeout` 可调，:31-43）。
- 复用关系：CLI `import { ExtensionBridge } from '@wechatsync/mcp-server/bridge'`（`cli/index.ts:18-19`，mcp-server 的 `exports.ts` 专门为 CLI 开了这个口子）——**CLI 不实现协议，只是桥的又一个宿主**。

---

## 7. MCP Server（问题 6）

- **与 CLI 共用桥**：同一个 `ExtensionBridge` 类；CLI 与 MCP server 可并存——后启动者自动变 SECONDARY 走 PRIMARY 的 9528 HTTP 转发（§6.1）。
- **两种启动模式**（`mcp-server/src/index.ts:22-26, 326-337`）：
  - **stdio（推荐）**：`node dist/index.js`（bin `wechatsync-mcp`）；先 `bridge.start()`（WS 9527 + HTTP API 9528），再挂 `StdioServerTransport`（`index.ts:255-267`）。日志全部走 stderr。
  - **`--sse`**：bridge 照起，express 监听 9528 暴露 `GET /sse` + `POST /message`（SSEServerTransport）+ `/health`（`index.ts:272-324`；同类实现见 `server.ts:48-92`）。
  - ⚠️ **观察到的缺陷**：`--sse` 模式且本进程为 PRIMARY 时，bridge 的 HTTP API（9528）与 express（9528）**端口冲突**（`index.ts:29` bridge 用 9527 → startHttpApi 绑 9528；`index.ts:318` express 也绑 `SYNC_HTTP_PORT=9528`），独立跑 SSE 模式可能 EADDRINUSE；只有当已有 PRIMARY（如 CLI 在跑）使本进程降级 SECONDARY、不绑第二个 HTTP API 时才能活。我们自建时不应照抄这个端口布局（桥 HTTP API 与 MCP HTTP 端口要分离）。
- **工具面**（stdio 模式 `index.ts:48-137`）：`list_platforms` / `check_auth` / `sync_article` / `extract_article` / `upload_image_file`（本地路径直读→base64→分片上传，:190-219）。`sync_article` 的 schema 里把「本地图片必须先转 base64 data URI」「markdown 不带标题行」写进了工具描述（`index.ts:80, 95`）——**用 LLM 提示词约束协议用法**的技巧值得借鉴。
- 端口可经 `SYNC_WS_PORT` / `SYNC_HTTP_PORT` 环境变量覆盖（`index.ts:22-23`）；CLI 也认 `SYNC_WS_PORT`（`cli/index.ts:21`）。

---

## 8. 可复用性评估（问题 7）

### 8.1 适配器层 → 我们的扩展

**结论：可整体抽出，迁移成本低。** 依赖面已由 manifest 和 RuntimeInterface 完全列举：

| 依赖 | 用途 | 我们的扩展需要 |
|------|------|---------------|
| SW `fetch` + `credentials:'include'` | 一切平台 API/图片下载 | host_permissions `<all_urls>`（或按平台白名单收敛） |
| `chrome.declarativeNetRequest.updateDynamicRules` | 伪造 Origin/Referer/`x-requested-with`（zhihu/juejin/weixin/weibo 全都在用） | `declarativeNetRequest` + `declarativeNetRequestWithHostAccess` 权限；`initiatorDomains:[runtime.id]` 技巧（`extension/runtime/extension.ts:125-174`） |
| `chrome.storage.local/session` | 登录态缓存、同步状态、Token | `storage` |
| `chrome.cookies` | checkAuth 辅助/个别适配器 | `cookies` |
| `chrome.tabs` + `chrome.scripting` | 预处理借宿标签页、extract 注入、alipay/douban 打开编辑页 | `tabs` + `scripting` |
| `chrome.downloads` | zip-download 适配器 | `downloads`（可选） |
| `chrome.runtime.onMessage` 消息总线 | popup/content ↔ background | 我们已有类似架构 |

适配器代码本身是**纯 TS + fetch + 正则**，在 MV3 SW 可直接跑（`docs/adapter-spec.md` 第 1 节明确列了 SW 可用/不可用 API 表）。两个要留意的移植点：
1. **DOM 预处理借宿网页**的机制（§2.4）在我们产品里应替换为 **Offscreen Document**（MV3 正规解法，`RuntimeInterface.dom` 注释里也点名了 offscreen，`core/src/runtime/interface.ts:106-117`——但扩展实现里实际没有用 offscreen，而是 `DOMParser` 直用，因为这段代码跑在 content script 而非 SW）。
2. **平台反爬时效性**：这些端点是逆向网页编辑器 API 得到的，微信错误码表、知乎 Draft.js 结构、掘金 secsdk 版本号都可能随平台改版失效，搬运后要有持续维护预期。

### 8.2 CLI 骨架 → 我们的 CLI

可直接搬的骨架（结构层面，注意 §9 许可）：
- commander 程序骨架 + `--timeout` preAction hook（`cli/index.ts:28-43`）；
- `createBridge()` 生命周期：起桥 → 等连接（30s）→ 失败诊断/安装引导 → finally `bridge.stop()`（`cli/index.ts:554-625`）；
- 端口占用诊断（netstat/tasklist，:527-549）；
- Markdown/HTML 输入解析（front-matter、h1、og: meta、CSS 内联，:284-464）；
- 本地图片→data URI / 首平台图床两种策略（:96-282）；
- 结果表格输出（✓/✗/草稿/postUrl，:764-784）。
- tsup 配置（双入口：CLI banner shebang + library exports，`cli/tsup.config.ts`）。

### 8.3 协议 → 照抄/重实现

- **报文格式**（`{id, method, token, params}` / `{id, result, error}`）与 6 个方法语义简单清晰，**协议本身（方法名/字段/端口约定）作为思想不受版权保护**，重实现无风险；逐字复制实现代码则落入 GPL（见下节）。
- 值得照抄的设计决策：**扩展主动外连**（免 native messaging）、**token 在扩展侧校验**、**PRIMARY/SECONDARY 端口接管**、**分片上传**、**超时 6 分钟**、**MCP 工具描述内嵌协议用法提示**。
- 值得改进的点：9527/9528 端口冲突缺陷（§7）；token 明文走 WS 且无一次性握手（每条消息都带 token）；无消息压缩；`extractArticle` 依赖「当前活动标签页」语义在无头场景不可用。

---

## 9. 许可分析与边界（问题 8）

### 9.1 事实

- 仓库根 `LICENSE` = **GPL-3.0**（全文），`README.md:304-306` 声明 "License: GPL-3.0"。根 `package.json` **无 license 字段**。
- **冲突点**：`packages/cli/package.json` 与 `packages/mcp-server/package.json` 各自声明 **`"license": "MIT"`**（`"author": "fun"`）。`extension`（`"private": true`）与 `core` 无 license 字段。该 MIT 字段自 `6af0ed1 "feat: support more"` 引入后未再变更。
- 法律通说：LICENSE/COPYING 文件是版权声明的主凭据；package.json 的 license 字段是元数据，可以被解释为作者对特定子包的授权意图，但**在两者冲突时不能默认子包已被单独 MIT 授权**（除非版权人明确说明）。
- 另一个关键事实：**小红书、网易号等适配器位于未公开的 private submodule**（`.gitmodules`），根本不受这份 GPL 授权——不构成可用资源，也无需担心污染。

### 9.2 GPL-3.0 对「复制代码」的含义

- **复制适配器代码 / CLI 源码 = 形成衍生作品**。一旦我们**分发**（发布扩展到商店、发 npm 包、开源仓库公开），被 GPL 覆盖的那部分及其衍生物**必须以 GPL-3.0 提供**，且必须提供对应源码。
- **对浏览器扩展的特殊性**：扩展是把 core+extension+UI 打成一个 bundle 分发的——bundle 内含 GPL 代码则**整个扩展产物需按 GPL-3.0 分发**，无法在产物级保留「我的 UI 是 MIT」。
- **不分发则义务不触发**：仅内部/个人使用（自己装 unpacked extension、自己跑 CLI），GPL 义务不启动。但 dsh-writing-desk 是要发布的产品，不能赌这一点。
- MIT 仓库「主体」与 GPL 代码同仓：Git 仓库整体不属于「分发」意义上的单一程序；**风险在于构建产物与代码拷贝的粒度**，而不是「MIT 仓库里出现 GPL 文件」这件事本身。用目录边界 + 构建/发布流程保证 GPL 代码不混进 MIT 产物，即可守住 MIT 主体。

### 9.3 边界方案选项（按安全性从高到低）

| 方案 | 做法 | 许可结果 | 风险 |
|------|------|---------|------|
| **A. 协议重实现（最推荐）** | 不复制任何 Wechatsync 源码；以 `docs/adapter-spec.md`（上游自己写的接口规范）+ 本文档 §4/§6 的**端点/参数/流程事实**为规格，自写 `RuntimeInterface`、`CodeAdapter`、各平台适配器、WS 桥与 CLI | 全部自有代码可 MIT；端点 URL、请求参数、错误码是事实/思想，不受版权保护 | 「重实现」若逐行翻译原代码（含注释/结构/命名）仍可能被认定衍生；需要真正独立书写，保留我们的实现痕迹（避免整段同构）。工程量最大但边界最干净 |
| **B. GPL 子树隔离** | 把搬来的适配器/桥代码放在独立目录（如 `packages/sync-bridge/`）或独立仓库，**该目录及依赖它的扩展产物标 GPL-3.0**，仓库主体保持 MIT；发布两个产物：MIT 的 CLI/工作台内核 + GPL-3.0 的扩展/桥 | 合法、清晰；GPL 扩展仍可被我们商用（GPL 不禁止商业分发，只要求开源该部分） | 产品叙事复杂（「扩展是 GPL 的」）；竞品可自由 fork 我们的扩展；需要发布流程严格隔离产物 |
| **C. 独立进程 + 通信（GPL FAQ 的 arm's length）** | 把「搬代码的部分」做成**独立 GPL-3.0 的 npm 包/CLI**（模仿上游：cli+mcp-server 独立包），我们的 MIT 扩展/工作台只通过 **WS/stdio 协议**与它通信，不 import 其代码 | 两个独立程序经 socket/管道通信通常不构成单一衍生作品（GPL FAQ 明确认可）；MIT 侧完全干净 | 运维双进程；若日后把 CLI 以库形式 link 进 MIT 包即破功；「同一产品、同一作者、为彼此而写」在激进解读下仍有争议（GPL FAQ 的 megabyte-per-socket 等判例讨论）——配合方案 A/B 使用更稳 |
| **D. 依赖上游 MIT 子包声明** | 直接以 `packages/cli`、`mcp-server` 的 `"license": "MIT"` 字段为由，按 MIT 复用桥/CLI 代码并保留署名 | 若上游意图成立，CLI/桥可 MIT | **法律不确定性高**：仓库级 LICENSE=GPL-3.0 且 README 宣示 GPL，字段冲突无人裁决；除非取得上游明确书面确认（issue/邮件），不建议作为唯一依据 |
| **E. 仅内部使用** | 只搬代码自用不分发 | 无义务 | 与产品发布目标冲突；且「以后再改许可」不能追溯 |

**推荐组合**：**A（协议与适配器重实现，MIT）为主干**；若工期不允许逐个重写适配器，先对「低风险、无签名算法」的平台（weixin/zhihu/juejin 端点简单）按 A 重实现，把**复杂签名类代码（知乎 OSS 签名、掘金 AWS4+CRC32、aws4.ts）单独放 GPL 子树（方案 B）**或干脆改用其公开的签名规范自写；CLI 骨架按 A 重写（结构简单，重写成本低），**桥接协议按 §6/§8.3 的设计决策重实现**。同步在本仓库 `docs/` 记录来源与依据（本文件 + adapter-spec 引用），并在 NOTICE/THIRD-PARTY 中说明「设计参考自 Wechatsync (GPL-3.0)，未复制代码」。
若采用任何形式的代码复制，请在实施前**向 Wechatsync 上游开 issue 确认子包 MIT 声明的效力**（一行确认即可把方案 D 升级为安全选项）。

---

## 10. 对融合工作的直接启示（非问题清单，供决策）

1. **内容管线**：我们的成稿本来就是 Markdown（DeepSeek Harness 产出），比 Wechatsync「从网页刮 HTML 再转 Markdown」的起点干净得多——可以砍掉 Readability/提取器/Turndown 大部分复杂度，保留「逐平台 preprocessConfig → 平台定制 payload」的骨架；小红书/公众号是 Markdown 反向转 HTML 的场景，可直接复用 CLI 的 `markdownToHtml` 思路（或用 marked/rehype 正规实现）。
2. **草稿优先**与我们「人工确认后发布」的审稿流完全同构，直接采纳「适配器只建草稿、返回 postUrl 让用户进平台编辑器」的产品行为。
3. **图片**：DeepSeek 产图通常是本地文件/data URI，走「data URI 内嵌 → 适配器转存到目标平台图床」路径即可，不需要 weibo 默认图床那一层（除非做「统一图床先上传」的优化）。
4. **桥接通道选型**见决策点 2。
5. **反爬风险**：小红书（反爬严格、仅草稿）和微信公众号（验证码/风控码 -6/-8）是两大硬骨头，第一版建议只做 zhihu/juejin/weixin 三平台打样，小红书放二期。

---

## 附录 A：关键文件索引

| 主题 | 文件 |
|------|------|
| manifest / 构建 | `packages/extension/manifest.json`；`packages/extension/vite.config.ts` |
| background 消息总线 | `packages/extension/src/background/index.ts` |
| 同步编排/状态/预处理借宿 | `packages/extension/src/background/sync-service.ts` |
| 队列调度/登录缓存 | `packages/extension/src/adapters/index.ts` |
| 适配器接口/基类 | `packages/core/src/adapters/types.ts`；`packages/core/src/adapters/code-adapter.ts` |
| 类型/运行时抽象 | `packages/core/src/types.ts`；`packages/core/src/runtime/interface.ts`；`packages/extension/src/runtime/extension.ts` |
| 三大适配器 | `packages/core/src/adapters/platforms/{weixin,zhihu,juejin}.ts`；微博 `weibo.ts`；ZIP `zip-download.ts` |
| 内容预处理 | `packages/extension/src/lib/content-processor.ts`；`packages/core/src/lib/markdown-images.ts` |
| 发起入口/UI | `packages/extension/src/lib/fab.ts`；`content/weixin.ts`；`content/weixin-editor.ts`；`content/extractor.ts`；`sync-dialog/SyncDialogPage.tsx`；`popup/` |
| 桥（扩展侧） | `packages/extension/src/mcp/client.ts` |
| 桥（Node 侧） | `packages/mcp-server/src/ws-bridge.ts`；`types.ts`；`exports.ts`；MCP `index.ts`、`server.ts` |
| CLI | `packages/cli/src/index.ts` |
| 规范文档 | `docs/adapter-spec.md` |
| 许可 | `LICENSE`；`README.md:304-306`；`packages/cli/package.json`；`packages/mcp-server/package.json`；`.gitmodules`；`packages/extension/ROADMAP.md` |
