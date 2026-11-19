# StashDock 研究笔记：浏览器扩展网页采集能力

> 研究对象：`参考项目/StashDock`（本地 git 仓库，AGPL-3.0，版本 1.1.0，commit `c3d5b07`）。
> 研究目的：把 StashDock 的浏览器扩展网页采集能力融合进 dsh-writing-desk 自己的浏览器扩展，作为灵感墙的「导入」依托。
> 以下路径均相对 StashDock 仓库根目录；行号以 commit `c3d5b07` 为准。

## 0. 总览：产品形态与三条存储链路

StashDock 是一个「本地视觉上下文库」：收藏链接/文件/笔记，供 AI 对话引用。它有四个客户端，共享同一份 SQLite 库（`%APPDATA%/app.stashdock.desktop/stashdock.sqlite3`）：

| 客户端 | 技术 | 与库的关系 |
| --- | --- | --- |
| Desktop 桌面应用 | Tauri 2 + Rust (rusqlite) | 直接持有库，起 HTTP 服务 |
| Chrome/Edge/Firefox 扩展 | MV3 + Native Messaging | 经 native host 短进程或 HTTP 写库 |
| ChatGPT / DSH 插件 | Node + MCP SDK (`node:sqlite`) | 直接打开同一个 SQLite 文件 |
| 浏览器扩展保存组件（helper） | Rust 短进程（非 Tauri） | 直接写库 |

与本次融合最相关的是**扩展采集链路**：`side panel (React) ← background service worker ← 注入页面的只读采集脚本 → 本地保存组件 (native host 短进程 / HTTP) → SQLite`。

---

## 1. 扩展架构（manifest 与构建）

### 1.1 manifest 全貌（MV3）

`extension/manifest.json`（全文 43 行）：

- `manifest_version: 3`，`minimum_chrome_version: "141"`，`incognito: "not_allowed"`（extension/manifest.json:2-7）。
- **permissions**：`activeTab, scripting, storage, sidePanel, nativeMessaging`（:8-14）——注意没有 `tabs`、`contextMenus`、`cookies`、`debugger`。
- **host_permissions**：仅两个回环端口 `http://127.0.0.1:17863/*` 和 `http://127.0.0.1:17864/*`（:15-18）。
- **optional_host_permissions**：`<all_urls>`（:19-21）——网站访问是用户点击时通过 `permissions.request` 动态授予的（见 §2.1），不预授权。
- **入口**：
  - background：`background.js`，`"type": "module"`（:22-25）；
  - `action`（工具栏按钮）无 popup，靠 `action.onClicked` 驱动（:32-38）；
  - **side panel**：`side_panel.default_path: "sidepanel.html"`（:39-41）；
  - 没有 content_scripts 声明——采集脚本用 `chrome.scripting.executeScript` 按需注入；
  - `key` 字段固定扩展 ID（:42）。

Firefox/Safari 变体由构建脚本生成（见 §1.3）：Firefox 换 `sidebar_action` + `background.scripts`；Safari 用 popup 承载同一份 `sidepanel.html`（scripts/build-browser-extensions.mjs:20-46）。

### 1.2 运行时文件布局（extension/ 目录，全部为手写源码或生成物）

| 文件 | 角色 |
| --- | --- |
| `background.js`（82 行） | service worker：会话/去重/保存 RPC 总线（extension/background.js） |
| `sidepanel.html` / `sidepanel.js`（4/31 行） | side panel 壳，挂载 React 采集表单（extension/sidepanel.js） |
| `ui/popup.js`（约 520KB 生成物） | esbuild 打包的 React 采集表单，入口 `src/features/browser-extension/Popup.tsx` |
| `ui/page-capture.js`（生成 IIFE，全局名 `StashDockPageCapture`） | 注入页面的只读采集器，含 Readability，入口 `extension/page-capture.js` |
| `capture-client.js` | 「读当前页」编排：tab 身份校验 + 截图 |
| `capture-sessions.js` | 每窗口一个采集任务的生命周期/会话存储 |
| `capture-dom.js` | DOM 遍历工具（可见性过滤、文本规范化） |
| `platform-posts.js` + `page-capture.js` 内 `xPost/adaptedPost` | X/Instagram/Reddit/LinkedIn/Pinterest/小红书/知乎适配器 |
| `library-client.js` | 保存客户端：lookup→dedup→POST /capture |
| `native-client.js` | Native Messaging 客户端（每请求一个短进程） |
| `setup-client.js` | 服务发现/握手（native 优先，HTTP 兜底） |
| `sidebar-client.js` | side panel ↔ worker 的长连接（port）+ 轮询调停 |
| `screenshot.js` | OffscreenCanvas 截图压缩（≤720px JPEG q0.68） |
| `browser-host.js` | Chrome/Edge/Firefox/Safari 的 API 差异适配 |
| `safari-native.js` / `safari-provider.js` / `firefox-provider.js` | Safari 走 Swift 容器、Firefox 走 fetch 代理 |
| `ui/`（其余） | foundation.css（Arc 设计令牌）、Inter 字体、tooltips、notices（第三方许可证副本） |

### 1.3 构建方式

- **无打包器壳**：扩展源码本身是原生 ESM（Chrome MV3 支持 module worker）；只有两个 bundle 由 esbuild 现生成（scripts/sync-extension-ui.mjs:23-64）：
  - `ui/popup.js`：从 `src/features/browser-extension/Popup.tsx` 打包（esm、minify、woff2/svg 内联）——桌面 React 应用与扩展复用同一批 Arc 组件（`src/components/arc/*`）；
  - `ui/page-capture.js`：从 `extension/page-capture.js` 打包成 IIFE 挂到 `globalThis.StashDockPageCapture`。
  - `sync-extension-ui.mjs` 同时把 `src/lib/siteIdentity.ts`、`src/lib/tooltips.ts`、`src/lib/reference-url.mjs`、Arc CSS、字体、Lucide/Readability 许可证同步（转译/拷贝）到 `extension/ui/`，并提供 `--check` 防漂移。
- **多浏览器产物**：`scripts/build-browser-extensions.mjs` 把 `extension/` 整目录拷到 `output/extensions/<browser>/`，按浏览器改写 manifest（scripts/build-browser-extensions.mjs:48-73），并校验扩展公钥→ID 的映射（:9-18，来源 `src-tauri/product-links.json`）。
- **桌面主应用**是 Vite（vite.config.ts 只做 react + tailwind 插件和 `@` alias），与扩展构建互不依赖。

---

## 2. 采集流程

### 2.1 触发方式

- **唯一入口是工具栏图标点击**（`action.onClicked`，extension/background.js:40-50）。无右键菜单、无快捷键、无页面内按钮——注释明确说明这是刻意的：权限请求必须发生在真实用户手势内（:38-39）。
- 点击后 worker 并行做三件事：请求 `<all_urls>` optional 权限（浏览器弹授权条）、打开 side panel（`host.open`）、启动该窗口的采集会话 `sessions.read(windowId, true, epoch)`。
- `panel-behavior.js` 强制 `openPanelOnActionClick: false`（extension/panel-behavior.js:4-6），保证每次点击都走 `onClicked`，从而每次都有手势内的权限请求。

### 2.2 采集会话（capture-sessions.js）

- **每窗口一个任务**：`tasks/epochs/intents/writes` 四张 Map 管生命周期；任务入口（token=UUID、expected={tabId,windowId,url}、revision、loading）写入 `chrome.storage.session` 的 `stashdock-sidepanel:<windowId>` 键（extension/capture-sessions.js:8,38）。
- 读页是异步的：先等 tab `status!=='loading'`（最多 150×100ms，:46-53），然后调 `capture()`，失败把 `error.message` 写进 entry 而不是抛出（:59）。
- side panel 通过 storage.onChanged 订阅 + 2 秒健康轮询对账（sidebar-client.js:86-96），页面切换/隐藏期间的事件被折成一个 `navigate()`（:87-88）。

### 2.3 正文/标题/封面提取（page-capture.js）

注入 `ui/page-capture.js`（ISOLATED world）后调 `StashDockPageCapture.captureCurrentDocument()`，流程（extension/page-capture.js:118-137）：

1. **URL 校验**：仅 http/https、无凭据（safeUrl）。
2. **用户选区优先**：`getSelection` 的文本（排除表单/可编辑区域内的选区）作为 `captureMethod:'selection'`（:123-127）。
3. **平台适配器优先于 Readability**：X/Twitter（`xPost`，:12-58）、Instagram/Reddit/LinkedIn/Pinterest（extension/platform-posts.js:133-136）、小红书/知乎（:60-98）。适配器只解析**单帖页**，feed/登录页一律报错而不落库（platform-posts.js:3-4 注释）；正文用 `renderedText`（可见性过滤的 DOM 遍历，上限 10,000 节点/100,000 字符，capture-dom.js:22-34）。
4. **通用正文**：`article()`（page-capture.js:100-116）——克隆 DOM（>20,000 元素直接拒绝），按 live 文档的 computed style 修剪隐藏节点，移除 `EXCLUDE` 选择器（script/nav/aside/footer/form/[contenteditable]…，capture-dom.js:4），再交给 **`@mozilla/readability` 0.6.0**（`maxElemsToParse: 20000, charThreshold: 80, disableJSONLD: true, serializer: renderedText`），失败退回语义容器（`articleBody/.entry-content/article/main`）的 renderedText。
5. **元数据**：标题 `og:title`→`doc.title`→hostname（≤300 字符）；favicon `link[rel~=icon]`；封面/预览 `og:image`/`twitter:image`；作者 meta[author]；发布时间 `article:published_time`（:130-136）。
6. **正文上限 20,000 字符**，超限标记 `truncated`（:128-129）。
7. **失败降级**：阅读失败时退到 `metadataOnly` 捕获（只有标题/URL/元信息），保证「链接可存、正文可后补」（:139-148）。

### 2.4 SPA 内容变化监听（page-capture.js:155-185）

注入页面里跑一个 MutationObserver（1.5s 节流 + 400ms 最小间隔 + visibility 检查），内容指纹变化时只发一个**不带正文**的 `{type:'page-content-changed', token}` 通知；worker 校验 nonce/发送方 documentId/当前 tab 后重读（background.js:56-60）。这避免了把页面数据持续泵过消息通道。

### 2.5 截图（capture-client.js:66-88 + screenshot.js）

- `tabs.captureVisibleTab`（JPEG q72），遇 `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECONDS` 限流重试 3 次；
- 用 OffscreenCanvas 按视口内容宽度比例裁剪缩放，宽 ≤720px、高按 0.625 比例，JPEG q0.68（extension/screenshot.js:39-55）；
- 截图是**可选增强**：失败只保留链接+文本（capture-client.js:71-77 注释）。
- 整个读页过程中反复校验「tab 还是原来那个」（`tab()` 闭包 + onActivated/onUpdated 监听器，:6-19），杜绝「截到别的标签页」。

### 2.6 采集预览/编辑 UI

- 渲染在 **Chrome side panel**（`sidepanel.html` → React `Popup`，src/features/browser-extension/Popup.tsx:140-166）。Firefox 用 sidebar_action，Safari 用 popup 承载同一页面。
- 表单字段：只读 Link、可编辑 Title（≤500）、Content textarea（≤20,000，可手改）、ReferenceTagsField 标签选择器（≤12 个、每个 ≤48 字符）、底部 Save page 按钮。
- **实时刷新但不覆盖编辑**：`dirty` ref 记录 title/content 是否被用户改过；SPA 长文渐进加载时 `apply()` 只更新未脏字段（Popup.tsx:74-83）。
- 断连时显示 `Connect StashDock` 警告条 + Check again 按钮；读取失败显示错误 + Retry reading page；保存成功按钮变 `Saved` 并禁用。

### 2.7 保存前去重（三层）

1. **扩展端**：保存前先 POST `/v1/capture/lookup`（带 url + operationId + 请求体 SHA-256 digest）；`value.saved` 直接返回（幂等回执），`value.duplicate` 且非 replace 时返回冲突（extension/library-client.js:53-64）。
2. **UI 端**：冲突弹出 `FluidDialog`「Replace saved page?」，Keep existing / Replace page 二选一（Popup.tsx:157-164）。
3. **服务端**（src-tauri/src/library/browser_capture.rs）：
   - URL 规范化去 query 噪声：去 fragment、去 `utm_*`/`fbclid`/`gclid` 等、去尾斜杠（src-tauri/src/library.rs:546-580）；
   - `find()` 先按精确 url 匹配，再全表扫描按规范化后匹配（browser_capture.rs:27-52）；
   - **operationId 回执**：`app_meta` 表存 `browser_capture_receipt_v1:<operationId>` → {digest, result}，同一 operationId+digest 重放直接返回上次结果，digest 变了报错；回执只留最近 256 条（:152-169,241）；
   - **revision 乐观锁**：duplicate 摘要含 `revision = SHA-256(行内容)`；Replace 请求必须带匹配的 id+revision 才允许覆盖，且冲突重查发生在写入事务内（:170-182,344-365）。

---

## 3. 与桌面的通信

### 3.1 通道拓扑（三条，按优先级）

1. **Native Messaging（首选，跨 Chrome/Edge/Firefox）**：
   - host 名：`app.stashdock.desktop`（桌面应用装的 helper）与 `app.stashdock.plugin`（Node 插件装的 helper），extension/native-client.js:3；
   - helper 是 Rust 短进程 `src-tauri/src/bin/browser-host.rs`（不启动 Tauri/WebView），每请求一个进程、一次性 stdin/stdout 4 字节长度前缀 JSON 帧（src-tauri/src/library/native_host.rs:171-196）；
   - **消息协议极简**：请求 `{path, body?}`，path 白名单 `/health /setup /tags /capture/lookup /capture`（:107-111）；响应 `{ok:true,value}` 或 `{error}`（extension/native-client.js:19-20）；
   - 调用方校验：进程参数必须含 `chrome-extension://<id>/` 且 id 在 product-links.json 白名单（含 legacyIds）（native_host.rs:77-99）；host manifest 用 `allowed_origins`（Chromium）/`allowed_extensions`（Firefox）双重锁定（:198-209）；
   - Firefox 有独立的代理型 host（`src-tauri/src/native_messaging.rs`）：因为 Firefox 扩展无法直接 fetch 回环地址，该 host 校验方法/路径/端口白名单后**转发**到 127.0.0.1:17863/17864（native_messaging.rs:57-120），即 Firefox 的通道是「native host → 本机 HTTP」两级。
   - **注册**：Windows 写 `HKCU\Software\Mozilla\NativeMessagingHosts\<name>`（Firefox）或 Chromium 的同名注册表键指向 host manifest JSON；macOS 写 `~/Library/Application Support/Mozilla/NativeMessagingHosts/` 等（native_messaging.rs:167-199；native_host.rs:256+）。Chrome 的注册由桌面应用或插件安装时完成（`registerBrowserHost`，plugins/stashdock-dsh/host.mjs:37）。
2. **本地 HTTP（兜底/旧版兼容）**：桌面应用用 tiny_http 监听 `127.0.0.1:17863`（插件占 17864），路由 `/v1/health /v1/setup /v1/tags /v1/capture /v1/capture/lookup`（src-tauri/src/library/bridge.rs:13,130-131）。鉴权双重：`Origin` 必须是已注册的 chrome-extension/moz-extension 源（安装时 `/v1/setup` 把 origin+extensionId 记进库，:263-312）+ `X-StashDock-Client: chrome-extension-v1` 头（:113-121）。**没有 WebSocket**。
3. **Safari**：走 Swift containing app 的 `SafariWebExtensionHandler`（extension/safari-native.js，safari/SafariWebExtensionHandler.swift），wire 格式不同故单独适配。

### 3.2 扩展侧发现与降级（setup-client.js / library-client.js）

- `checkSetup`：先试 native（`/setup` 带 browser/version/extensionId），失败再扫 17864→17863 两个 HTTP 端口；老版本服务无 `/v1/setup`（404）时退 `/v1/health` 探测（extension/setup-client.js:4-30）。770ms/2.5s 超时，结果缓存在闭包（one-flight，:34-37）。
- `query()` 的多级 fallback：native → HTTP 17864 → HTTP 17863（extension/library-client.js:34-43）。
- **桌面未运行时**：因为 native host 是每次请求新起的短进程，**保存依然可用**（README.md:109-111「Page saving then works even when Desktop and the AI app are closed」）；HTTP 通道才要求桌面活着。两者都失败时 UI 显示 Connect StashDock 警告 + Check again（Popup.tsx:144）。
- 写操作安全纪律（注释多处强调）：**不确定的写请求绝不通过另一条通道重放**——`save()` 只经 `at()` 单通道单次尝试，重试复用同一 operationId 靠服务端回执幂等（library-client.js:60-63）。
- 离线兜底：标签列表缓存在 `chrome.storage.local`（knownTags）；历史遗留的 pending 操作有 `recoverPending()` 重放队列（library-client.js:65-86），新代码不再往里写。

### 3.3 保存 payload 协议

`POST /v1/capture`（或 native `/capture`）请求体：

```json
{ "item": { StashItem, kind 限 web|repo }, "operationId": "16-64位字母数字-", "replace": {id, revision} | 省略 }
```

响应：`{saved:true,id,replaced}` 或 `{duplicate:{id,title,revision}}`。服务端逐字段校验（kind 白名单、title≤500、content≤20000、tags≤12×48、preview 必须是 ≤750KB 的 data:image/(png|jpeg|webp) base64、禁 assetPath/originalPath/contextOverride）（browser_capture.rs:98-149）。请求体上限 1MB，HTTP 层 4MB（bridge.rs:14,216-219）。

---

## 4. DSH 插件（plugins/stashdock-dsh/）

### 4.1 如何读到同一份收藏库

**直接读 SQLite 文件，不经 Tauri。** 链路：

- `host.mjs` 在 DSH 加载插件时（仅当 DSH webServer 绑定 loopback 且非远程授权才启用，host.mjs:22-28）动态 import `./runtime/dist/mcp-server.mjs`——这是由 `scripts/build-mcp-app.mjs` 从 `plugins/stashdock/server/create-server.mjs` 打包出来的共享 MCP 服务器（scripts/build-mcp-app.mjs:67-69）；
- 服务器内部用 **Node 内置 `node:sqlite`（DatabaseSync）** 打开 `%APPDATA%/app.stashdock.desktop/stashdock.sqlite3`（plugins/stashdock/server/local-library.mjs:5,44-47,99-100），与桌面 Rust 进程以 WAL 模式并发共享同一文件；
- 与桌面通信的 MCP 传输是 **InMemoryTransport 配对**（host.mjs:39-44）——即插件把 MCP server 嵌进 DSH 进程内，不跨进程。

### 4.2 manifest 结构（package.json）

- `name: stashdock-dsh`、`license: AGPL-3.0-only`、`engines: { dsh: ">=0.2.2-rc.1 <0.3.0" }`（plugins/stashdock-dsh/package.json:13）；
- `dsh.bundle.patch: ./cordis.patch.yml`（内容就一行：向 DSH 注入 id 为 `stashdock` 的面板，cordis.patch.yml:1-3）；
- `dsh.client.inject`：声明依赖的宿主 API 模块（sidebar-right、conversation、theme、api-session-controller）（:14-25）；
- 代码入口 `exports["."] = ./index.mjs`（构建产物），`inject` 数组声明构造期要的 ctx 键（host.mjs:13，client.mjs:8）。

### 4.3 引用签（把收藏加入 DSH 对话）的实现

完整链路分四段：

1. **Shelf UI（React，MCP App 协议跑在沙箱 iframe 里）**：`src/features/mcp-app/McpShelf.tsx` 选中若干收藏 → `buildContext(items)`（src/lib/context-format.mjs:45-51）拼 Markdown：`# StashDock context` 标题 + 每条一个 `## 标题` 段（Source/URL/File/Author/Published/Tags 元数据行 + `### Saved page content` 等正文标签 + 截断/缺正文警示行，context-format.mjs:29-43）。
2. **发送**：`addAttachmentToDraft`（src/features/mcp-app/draft.ts:45-78）走 MCP App 的 `host.sendMessage`，payload 为 `{role:'user', content:[{type:'text',text:markdown}], _meta:{'stashdock/dsh-draft':{send:false, title, files?}}}`（:50-55）；有原生文件时附 `files`（收藏 ID 列表）。DSH 不支持时退回 `openai/message` + `openai/title` 协议（:61-77）。
3. **宿主拦截**：`plugins/stashdock-dsh/client.mjs:67-74` 在 iframe 的 postMessage 通道里接住 `ui/message`，调 `addDraft(ctx, sessionId, …)`（draft.mjs:14-102）。
4. **落草稿**：`addDraft` 校验会话活跃/草稿冻结 → 纯文本时 `shell.insertQuote(quote)` 插入输入框；带文件时先 POST `/api/stashdock/files` 拿清单（≤30 个、单文件 ≤512MB、批次 ≤1GB，files.mjs:4-5），再逐个 POST `/api/stashdock/file` 流式读原始字节（并发 ≤2），用 DSH 的 `ConversationController.createDrafts/addAttachments` 挂为原生附件，失败逐件回滚（draft.mjs:87-101）。

文件字节不进 MCP/iframe——ID 经 MCP 工具 `get_stashdock_file` 解析出**本地绝对路径**（files.mjs:15-25），再由插件侧 Node 直接 `open(path)` 读（files.mjs:45-53）；这两条 Fetch 路由注册在 DSH 自己的认证连接下（files.mjs:26）。

### 4.4 暴露给模型的工具

host.mjs:15-18 把 7 个 MCP 工具注册为 DSH 模型工具：`search_stashdock / list_stashdock_tags / get_stashdock_items / get_stashdock_item / get_stashdock_file / save_stashdock_reference / apply_stashdock_tag_changes`，另注册 `use-stashdock` skill（host.mjs:101-106）。

---

## 5. 数据模型

### 5.1 内存/传输层：`StashItem`（src/types.ts:25-47）

```ts
StashKind = "web" | "repo" | "pdf" | "image" | "note" | "file"
StashItem = {
  id: string (UUID);          title: string;        kind: StashKind;
  source: string;             url?: string;         excerpt: string;   // 摘要 ≤2000
  tags: string[];             createdAt: string(ISO);
  favorite?: boolean;         useCount?: number;
  preview?: string;           // data:image base64 封面/截图
  previewStatus?: queued|working|failed|unavailable;
  contentStatus?: 同上;
  assetPath?: string;         originalPath?: string; mimeType?: string; sizeBytes?: number; hasFile?: boolean;
  content?: string;           // 全文（网页 ≤20,000 字符）
  contextOverride?: string;   // 用户手写的最终上下文
  origin?: StashOrigin;
}
StashOrigin = {
  platform; importMethod: bookmark_html|browser_bookmarks|browser_extension|manual_url|local_file|note|platform_import|ai_context;
  contentOrigin?: 'provided'|'generated';
  externalId?; author?; publishedAt?; captureMethod?: 'page'|'selection'; truncated?: boolean;
  faviconUrl?; previewKind?: 'screenshot'|'cover'; fileName?; importedAt; ...
}
```

扩展保存时侧面板从 entry 组装 draft（extension/sidepanel.js:17-22）：`origin.importMethod='browser_extension'`、`externalId=url`、kind 按 `github.com` 归 `repo` 否则 `web`。

### 5.2 磁盘层：SQLite（plugins/stashdock/server/schema.sql:5-21）

```sql
CREATE TABLE stash_items (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, source TEXT NOT NULL,
  url TEXT, excerpt TEXT NOT NULL, tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, favorite INTEGER DEFAULT 0, preview TEXT,
  asset_path TEXT, original_path TEXT, mime_type TEXT, size_bytes INTEGER,
  content TEXT, origin_json TEXT, context_override TEXT, updated_at TEXT NOT NULL,
  preview_version INTEGER NOT NULL DEFAULT 0 );
CREATE TABLE reference_usage (id TEXT PRIMARY KEY REFERENCES stash_items(id) ON DELETE CASCADE, use_count INTEGER);
CREATE TABLE reference_usage_receipts (operation_id TEXT PRIMARY KEY);
```

- 位置：`%APPDATA%/app.stashdock.desktop/stashdock.sqlite3`（可被 `library-root-v1.json` 锚点重定向到用户自选目录，local-library.mjs:20-27,52-58）；
- WAL 模式 + busy_timeout 5000ms，允许多进程并发（schema.sql:1-3）；
- tags 以 `tags_json` JSON 数组存列内（无标签表），全量标签用 `json_each` 聚合查询（browser_capture.rs:11）；
- FTS5 全文索引在 `search-index.sql`（搜索由 `searchReferenceIds` 提供）。

---

## 6. 可复用性评估

### 6.1 可较干净抽到我们扩展的模块（纯 JS/TS，无 Tauri/SQLite 依赖）

| 文件 | 复用价值 | 说明 |
| --- | --- | --- |
| `extension/page-capture.js` | ★★★ 核心 | Readability + 平台适配 + 元数据/封面提取。依赖仅 `@mozilla/readability`（Apache-2.0）和 `capture-dom.js`/`platform-posts.js`。对小红书/知乎/X 的适配器对我们是现成的中文平台支持 |
| `extension/capture-dom.js` | ★★★ | 可见性过滤 DOM 遍历、normalize、safeUrl，零依赖 |
| `extension/platform-posts.js` | ★★★ | Instagram/Reddit/LinkedIn/Pinterest 适配器 |
| `extension/capture-client.js` | ★★☆ | 「读当前页」编排（tab 身份校验、settle 轮询、截图限流重试）只依赖 chrome.* API |
| `extension/screenshot.js` | ★★☆ | OffscreenCanvas 压缩，零依赖 |
| `extension/capture-sessions.js` | ★★☆ | 每窗口任务生命周期 + storage.session 持久化；逻辑自洽 |
| `extension/sidebar-client.js` | ★☆☆ | 若我们同样采用 side panel + port 架构可参考，否则仅需其「重试/对账」思路 |
| `extension/native-client.js` + `setup-client.js` | ★★☆ | NM 短进程客户端 + 服务发现，协议极简，改成我们的 host 名即可 |
| `src/features/browser-extension/Popup.tsx` + `Popup.module.css` | ★★☆ | 采集预览表单的交互模式（dirty 守卫、冲突对话框、连接态）值得照搬；React/Arc 组件部分需要换成我们的 UI 栈 |
| `src/lib/context-format.mjs` | ★★☆ | `buildContext` 的上下文拼装格式可直接用于灵感墙卡片→DSH 上下文 |
| `src/lib/siteIdentity.ts` / `reference-url.mjs` / `canonical-url.ts` | ★☆☆ | favicon 规范化、URL 规范化（去 utm 等）小工具 |

### 6.2 与 Tauri/SQLite 深耦合、需要重写的部分

- **服务端保存/去重/回执**（`src-tauri/src/library/browser_capture.rs`、`bridge.rs`）：Rust+rusqlite+tiny_http。我们的扩展若没有本地 helper，需要把「lookup→dedup→revision 乐观锁→operationId 回执」这套协议在我们自己的后端（比如 DSH 插件内的 Node `node:sqlite` 或 dsh-writing-desk 的宿主进程）重新实现；协议本身可以照抄，代码不行。
- **Native host 二进制**（`src-tauri/src/bin/browser-host.rs`、`library/native_host.rs`、`native_messaging.rs`）：Rust。Node 侧其实有对应物——`plugins/stashdock/server/` 里 `register-browser-host.mjs`/`browser-capture.mjs`（Node 版 capture 存储，供插件 helper `app.stashdock.plugin` 使用），说明**用 Node 写 NM host 是被验证过的路线**，更适合我们。
- **MCP 服务器/本地库**（`plugins/stashdock/server/local-library.mjs` 等 30+ 文件）：node:sqlite 直写同一 SQLite。我们不需要共享库场景——灵感墙有自己的存储——所以只抽其 schema 设计与去重协议。
- **DSH 插件的宿主桥**（`plugins/stashdock-dsh/draft.mjs`）：依赖 DSH 0.2.2 的 `ConversationController.createDrafts/addAttachments` 内部 API。我们本来就是 DSH 插件，这部分要按我们的插件上下文重接，但**「send:false 的 sendMessage + _meta 私有键」这个注入草稿的模式**和 **「文件走 ID→本地路径→Node 流式读」的模式**可直接借鉴。
- **构建脚本**（`scripts/sync-extension-ui.mjs`）：其「单一源码、esbuild 现打包、`--check` 防漂移、许可证文件随包」的工程方法值得复制，但路径全部绑定其仓库结构。

### 6.3 一句话评估

采集侧（页面→草稿）是**自包含前端代码，可整体平移**；落库侧（草稿→存储→去重）是**协议清晰但实现绑定 Rust/SQLite，需要按同一协议在我们自己的存储上重写**（Node 版已有先例）。

---

## 7. 许可注意（AGPL-3.0 → 我们的 MIT 仓库）

- **整仓代码 AGPL-3.0-only**（LICENSE、LICENSING.md:5-13）。注意 LICENSING.md:24-28：**本修订之前的版本曾以 MIT 发布**，旧版权保留在 `licenses/StashDock-legacy-MIT.txt`——但本地仓库当前 HEAD 已是 AGPL，无法据此直接拿 MIT 授权。
- **AGPL 对我们（MIT 仓库）复用的含义**：
  1. **逐字/派生复制**任何 AGPL 文件（哪怕大段改写）→ 那部分代码必须以 AGPL-3.0 发布，且若作为浏览器扩展被用户「网络交互」使用，还触发 §13 网络条款（须提供对应源）。MIT 仓库混入 AGPL 文件等于整仓被传染（除非清晰隔离为独立 AGPL 模块并声明）。
  2. **安全路径**：(a) 不复制代码，只**借鉴协议/交互/字段设计**（协议与思路不受版权保护）；(b) 独立写实现。Readability（Apache-2.0）、Radix（MIT）等第三方库各自许可允许直接使用，不经由 StashDock。
  3. 若决定接受传染：把复用的采集模块放进独立目录、文件头保留 AGPL 声明与出处，并向法务/维护者明示——这是产品决策不是技术决策。
- **第三方依赖清单**（package.json + THIRD_PARTY_NOTICES.md）：运行时 22 个直接依赖（react 19、motion、@radix-ui/* ×6、@mozilla/readability、@modelcontextprotocol/sdk+ext-apps、pdfjs-dist、@tanstack/react-virtual、lucide-react、@fontsource-variable/{inter,geist}、@iconify/react、react-markdown/remark-gfm、zod、smol-toml、@tauri-apps/*），dev 15 个（vite 7、esbuild、tailwind 4、typescript 等）。THIRD_PARTY_NOTICES.md 47 行，关键项：Arc 免费组件（MIT，vendored 于 src/components/arc）、Readability（Apache-2.0，随扩展分发许可证副本）、Inter/Geist（OFL-1.1）、Simple Icons（CC0）、扩展 bundle 内所有 npm 包许可证自动收集到 `extension/ui/notices/`（sync-extension-ui.mjs:27-42，缺许可证会构建失败）。
- **对融合的实际影响**：我们复用 Readability 需自行带 Apache-2.0 声明；其余想复用的 StashDock 文件均为 AGPL，需按 §7.1 处理。

---

## 8. UI 设计要点（采集弹层）

弹层 = Chrome side panel 内的全高 React 页（约 320px 宽），结构（Popup.tsx:140-166 + Popup.module.css）：

1. **信息密度与层级**：`header`（标题 "Save current page" + 刷新图标按钮）→ 可滚动 `body`（Link 只读、Title 自动聚焦、Content 大 textarea、Tags）→ 固定 `footer`（唯一主按钮 Save page）。栅格 `grid-template-rows: auto minmax(0,1fr)`，`overscroll-behavior: contain`（Popup.module.css:4-5）。
2. **三态先行**：加载态用骨架屏（Skeleton lines 2/2/5/2 模拟真实字段布局）；断连态是可操作的警告条（Check again 按钮，非死提示）；错误态区分「读不了」（Retry reading page 按钮）与「存不了」。
3. **乐观但可撤销的编辑保护**：后台 SPA 刷新不覆盖用户已编辑字段（dirty ref），错误恢复后保留用户输入；保存中禁用但不锁滚动。
4. **冲突处理**：Radix Dialog + FluidDialog（motion 弹簧入场、高度自适应动画、焦点归还原触发元素，src/components/FluidDialog.tsx:60-99），文案具体（"「X」is already in your library"），动作是 Keep existing / Replace page——**不静默覆盖、不静默丢弃**。
5. **标签交互**：TagInput（Enter 提交、逗号不触发）+ 右上 Choose tags Popover 列出已有标签（>12 个才出搜索框，ScrollArea 限高 240px），已选标签打勾禁用重复添加（ReferenceTagsField.tsx:23-48）；短弹层（max-height 640px）下字段自动收缩保 Tags 可见（Popup.module.css:18-23）。
6. **成功反馈**：保存成功按钮原地变 `Saved`（打勾图标）并禁用，面板保持打开——不自动关闭，允许继续改标签。
7. **细节**：`aria-busy`/`aria-label` 全覆盖、Escape 关闭（保存中不可关）、暗色跟随 `prefers-color-scheme`（sidepanel.js:13-15）、工具提示统一 tooltip 系统、本地 Inter 字体不依赖网络。设计令牌来自自研 Arc 体系（oklch 中性色 + 语义变量，src/components/arc/foundation.css）。
8. **触发即授权**：工具栏点击 = 打开面板 + 权限请求 + 开始采集三件事同手势完成；面板内没有设置/管理功能——**单一职责**（保存当前页），管理在桌面应用做。

值得借鉴的核心：①「点击即采集、面板即预览」而非弹小窗；②保存前的结构化冲突协商（回执 + revision + 明确对话框）；③后台渐进刷新不覆盖用户编辑的 dirty 守卫；④截断提示（"Only the visible text was captured…"）让用户知道内容不完整。

---

## 附：关键数字速查

- 正文上限 20,000 字符；标题 ≤300（源）/500（表单）；excerpt ≤180（表单）/2000（库）；tags ≤12 个 ×48 字符；截图 ≤720px JPEG；preview base64 ≤750KB；保存请求体 ≤1MB。
- 端口：17863（桌面）/17864（插件）；NM host：`app.stashdock.desktop` / `app.stashdock.plugin`（Firefox：`app.stashdock.firefox`，见 product-links.json）。
- 超时：NM 读 6s / capture 14s；HTTP 1.8s；发现 0.7s（Chrome）/2.5s（Firefox/Safari）；侧面板轮询 2s。
- 回执保留 256 条；MutationObserver 节流 1.5s；settle 轮询 12×400ms。
