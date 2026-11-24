# DSwritesync:以 Wechatsync 上游为基座重写扩展与 CLI

Status: accepted(2026-11-19 grill 会话逐项定案;取代 ADR 0009 的扩展/CLI 实现路径,采集与投递的数据契约、「dispatches ≠ 已发布」红线不变)。**「CLI / 本地服务」实现路径 superseded by ADR 0012(2026-11-19):接入面改为 Native Messaging 自动配对,CLI 与 WS/token 退役**;**扩展功能范围 superseded by ADR 0017(2026-11-24):独立同步、历史、CMS 与页面入口删除,扩展收敛为工作台浏览器端**;vendored fork、GPL 边界、配对与收录/投递契约仍以本文为准

## 背景

ADR 0009 的自研扩展与 CLI 在真机走查后被判定达不到预期:界面不是 StashDock 的浏览器侧栏形态,也没有 Wechatsync 的完整功能区与命令面;继续在自研代码上补 UI 只会重复造轮子。目标改为:**以 Wechatsync v2(2.0.10,HEAD `1230678`)完整源码为基座**,把 StashDock 浏览器扩展的采集能力加成侧栏的一个标签,CLI 照搬其命令面并加工作台投递箱适配;产品名统一 `DSwritesync`,现有自研实现完全推翻。

## 决策

| 事项 | 决策 |
| --- | --- |
| 基座 | vendor Wechatsync v2 源码(core / extension / cli)到 `extension/`,以 pnpm workspace 独立构建;`UPSTREAM.md` 记录 upstream commit 与修改;不引 root npm workspaces,不影响主仓库单包与 JUNCTION |
| 许可 | vendored 目录按 GPL-3.0 发布(Wechatsync 仓库 LICENSE;cli 包元数据虽标 MIT,与仓库 LICENSE 冲突,保守按 GPL);主仓库其余部分仍 MIT;`extension/LICENSE`、`NOTICE`、源文件头保留上游版权;StashDock 只借鉴视觉与交互、不拷 AGPL 代码,避免 AGPL 传染 |
| 品牌 | 用户面产品名统一 `DSwritesync`,无前后缀;扩展 manifest / 侧栏头部 / 关于页均用该名;CLI 二进制 `dswritesync`;工作台插件仍叫「图文创作台」;vendored 内部 workspace 包名保留 `@wechatsync/*` 以减小上游 diff,不对外暴露 |
| 扩展形态 | 浏览器侧边栏是唯一首页(popup 退役,action 点击开侧栏);头部品牌 + 连接状态 + 设置齿轮,顶部分段标签「收进 / 同步 / 账号 / 历史」;设置由齿轮进入,采集与同步共享同一设置页;默认落在「收进」 |
| 收进 | StashDock 式采集:当前页 / 选区 → 标题 / 正文 / 标签 / 封面(og:image,截屏兜底) → 冲突对话框(保留 / 替换,替换真正带 force 重发) → CLI 写 inbox → 宿主落灵感;断连时复制 Markdown 兜底;标签建议取工作台已有标签,取不到退化自由输入 |
| 同步 | 完整 Wechatsync 功能区:当前页文章 → 平台多选(带登录态) → 逐平台草稿 → 进度 / 结果;账号页(含 CMS 自建站)、历史页保留;扩展独立同步与工作台下发的任务在同一功能区呈现 |
| 侧栏之外的入口 | 保留通用文章页 FAB、公众号文章页同步对话框 iframe、公众号后台编辑器页同步对话框 iframe;FAB 直接进同步;去掉全屏编辑器、编辑器 iframe 与同步对话框里的「调整文章」按钮;preprocessor 保留(它服务于无网页标签时的同步预处理,不是编辑器);编辑只在 DSH 工作台 |
| 视觉 | Wechatsync React + Tailwind 代码基座;令牌换 StashDock 中性体系(Inter、18px 控件 / 26px 面板、发丝线、44px 行、黑色主按钮);暗色跟随系统;不搬 Arc 组件,不混第二套样式体系 |
| CLI / 本地服务 | 上游 CLI 为唯一本地服务:`dswritesync serve` 起 WS(默认 127.0.0.1:9527)+ 投递箱监听;保留 `sync / platforms / auth / extract` 命令面;`serve` 生成 `~/.dsh/writing-desk/bridge/auth.json`(0600),工作台设置页显示 Token,扩展设置页粘贴;扩展只连一个 WS;桥实现位于 `packages/cli/src/bridge/` |
| 工作台联动 | 保留 ADR 0009 的三条:采集 → inbox → 灵感;校样浮层投递 → outbox → CLI → 扩展同步;回执 → receipts → `item.dispatches`;`dispatches ≠ 已发布` 红线不变 |
| i18n | 扩展全部页面 + 同步对话框 + 设置:跟随系统 / 中文 / English,默认跟随系统,`chrome.storage.local` 持久化,即时生效;CLI 全部输出双语:默认系统 locale,`--lang zh\|en`、`DSWRITESYNC_LANG`、`~/.dsh/writing-desk/config.json` 覆盖;manifest 名称固定 `DSwritesync`,描述用 `_locales` 跟随浏览器语言 |
| 功能边界 | 保留 Wechatsync 全部用户功能(同步 / 账号 / 历史 / CMS / 悬浮按钮 / 上游全部适配器);移除遥测、远程配置、版本检查、推广横幅与 Wechatsync 增长入口;小红书由自研页面自动化适配器覆盖(仅草稿) |
| 旧实现 | 删除现有自研 `extension/src|static|scripts|dist` 与顶层 `cli/`,替换为 vendored fork;旧代码留 git 历史;更新 README / README.en、ADR 0009 状态、GLOSSARY、package 脚本与 NOTICE |
| 权限 | 采用上游宽 host 权限(`http://*/*`、`https://*/*`、cookies、declarativeNetRequest 等),这是多平台同步与 FAB 的前提;安装时用户可见的权限范围扩大 |

## 不做

- 不在扩展里保留编辑能力(全屏编辑器 / 编辑器 iframe / preprocessor);编辑由 DSH 工作台完成。
- 不做自动发布、不自动写已发布状态;同步只到草稿箱,是否发布由用户确认。
- 不做小红书自动发布(通过页面自动化只保存本地草稿,发布由用户确认)。
- 不引 root npm workspaces、不改主仓库单包结构;vendored workspace 只存在于 `extension/`。
- 不搬 StashDock 代码;不把 AGPL 带进扩展。
- 不保留 popup 首页;不双轨保留旧自研扩展 / CLI。

## 验收场景

1. `pnpm --dir extension install && pnpm --dir extension build` 产出可加载的扩展;开发者模式加载后点图标开侧栏,四个标签与共享设置页渲染,popup 不再出现。
2. 任意网页「收进」→ 工作台灵感墙出现卡片;同 URL 再收进出现冲突,「替换」真正更新;桥未启动时提示启动并给复制 Markdown。
3. 「同步」当前页到知乎 + 掘金:平台登录态可见,逐平台进度,登录缺失诚实报错,结果进历史。
4. 工作台校样浮层「投递到浏览器」→ 扩展出现任务并逐平台到草稿箱;回执后 `item.dispatches` 追加,status 不变。
5. `dswritesync serve` 生成 token,工作台设置页显示,扩展粘贴后连上;`dswritesync sync article.md -p zhihu,juejin --dry-run` 走通;`dswritesync platforms --auth` 可用。
6. 扩展设置切中文 / English / 跟随系统,所有页面与同步对话框即时切换;`dswritesync --lang en` 输出英文。
7. 全仓库测试全绿;ego lite / Edge 真机走查 1–6;无遥测 / 远程配置 / 推广请求。
8. 关于页显示 DSwritesync 版本与上游归属(Wechatsync GPL-3.0;StashDock 视觉参考 AGPL-3.0,未复制代码)。

## 后果

- `extension/` 成为 GPL-3.0 的大型 vendored 树;主仓库 MIT 与它的分发边界要在 README / NOTICE 写清,对外分发扩展 / CLI 时需履行 GPL 源码提供义务。
- 构建从 esbuild 单脚本变为 pnpm + Vite;扩展依赖树显著变大,需要独立 node_modules 与 lockfile。
- 上游改版 / 适配器失效的维护成本转由我们承担;`UPSTREAM.md` 记录基线与合并策略。
- 去掉编辑器意味着 Wechatsync 的部分页面 / 内容脚本可删,但也意味着用户不能在扩展里改稿;这是有意的范围收缩。
- popup 退役、侧栏成为唯一首页;侧栏 API 的打开手势限制可能影响工作台一键投递,需要 fallback(优先侧栏,失败时开 396×560 同步窗口)。
- 旧自研扩展 / CLI 的测试与文档需同步改写;git 历史保留回滚能力。
- 宽 host 权限会让安装提示从「当前站点」扩大到「所有网站」,这是完整 Wechatsync 功能的代价。

## 代码影响

- `extension/` 整体替换为 Wechatsync fork(pnpm workspace: core / extension / cli),新增 DSwritesync 品牌、侧栏壳、收进标签、i18n、desk adapter。
- 删除顶层 `cli/`;README / README.en 的 `wdesk` 命令改为 `dswritesync`;`src/publish.js` 生成的命令字符串改为 `dswritesync sync`。
- 宿主 `src/bridge.js`、路由、`publish.js`、client 设置与校样浮层的桥接文案改 Token / 命令 / 状态;投递箱路径与回执契约不变。
- `docs/adr/0009` 标 superseded;新增本 ADR 与 `docs/specs/2026-11-19-dswritesync-rebuild.md`;`GLOSSARY.md` 更新。

## 回滚

git 历史回退到本 ADR 落地前;旧扩展 / CLI 源码、测试、README 均在历史中。数据层(灵感 / 投递箱 / state.json)没有不可逆迁移,投递箱契约保持,回滚只需换回旧二进制与扩展。

## 修订:移除 MCP server(2026-11-19)

- 删除 `packages/mcp-server/`(MCP stdio/SSE 入口及其 SDK 依赖);`ExtensionBridge` / 消息类型迁入 `packages/cli/src/bridge/`,CLI 是本地服务的唯一宿主。
- 扩展侧 `src/mcp/client` 更名为 `src/bridge/client`,消息面 `MCP_*` → `BRIDGE_*`,存储键 `mcp*` → `bridge*`(启动时一次性迁移,保留已粘贴的 token)。
- 接入面收敛为 **CLI + skill**;不再提供 MCP server,也不再保留 `MCP_TOKEN` 环境变量。
- 上表中「MCP 保留 / secondary 转发」的表述以本节为准。

## 修订:小红书页面自动化适配器落地(2026-11-19)

- 上游私有 submodule(`wechatsync-private-adapters`)不可得;改为自研 `packages/core/src/adapters/platforms/private/xiaohongshu.ts`,通过扩展已登录的创作者中心页面完成:上传图片 → 填标题/正文/话题 → 点「暂存离开」。
- 不调用私有 API、不读取/导出 cookie、不实现 x-s 签名;签名由创作者页面自身完成。
- 只保存到浏览器本地草稿箱,**永不点击「发布」**;`SyncResult.draftOnly = true`,`postUrl` 指向发布页,不写发布状态。
- 发布按钮位于 `<xhs-publish-btn>` 的 closed shadow root;适配器通过 isolated world 的 `chrome.dom.openOrClosedShadowRoot` 找到并点击「暂存离开」。
- 验证:真实登录的 Edge/Chromium 中跑通扩展 `SYNC_ARTICLE`,草稿箱出现标题为「DSwritesync 适配器验收」的图文笔记,标签成为可点击话题 chip;核心单测 9/9。实现只依赖现有扩展 API 与内部 `parseMarkdownImages`,未新增 npm 依赖;填充在 MAIN world 执行,点「暂存离开」在 ISOLATED world 执行以读取 closed shadow root。