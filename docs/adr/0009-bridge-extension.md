# 桥接扩展:一个浏览器扩展承担网页导入与多平台发布,CLI 本地桥承上启下

Status: accepted(2026-11-19 目标指令定案;三份研究(docs/research/) + 真机鉴权实证;实现随本 ADR 落地)

## 真机验证记录(2026-11-19,沙盒 web 宿主 + Edge 157 + CDP/computer-use)

已验证:扩展以 unpacked 方式加载(SW 运行、options/panel/dialog 三页渲染);Token 经扩展设置页真实 UI 保存后桥握手连上(wdesk serve 日志「浏览器扩展已连接」);**导入链**——扩展注入 page-capture(example.com,Readability 提取正文)→ WS → inbox → 宿主 3 秒轮询消化 → 灵感墙落卡(itemId 回执,重投幂等);**导出链**——宿主侧 writePublishTask 写 outbox → 桥认领 → 图片折算 data URI 下发扩展 → 对话框页拉起 → 三适配器真调平台 API(未登录诚实报「登录态超时/请先登录」,weixin 是平台真实响应)→ dispatch 回执被宿主消化成 `item.dispatches`,**status 纹丝未动**(红线保持)。审计:161/161 测试全绿(含 bridge.test.js 九例);`npm pack` 产物不含 extension/ 与 cli/。

已知边界:工具栏动作经由 Edge 扩展菜单条目点击触发(开发者模式加载的扩展);首次点击在无站点授权时借手势申请 `<all_urls>`,Edge 的站点级开关(允许此站使用扩展)下直接可采。宿主路由鉴权(401「未授权」)实证过,扩展与桥不持有宿主凭证。

## 背景

目标指令:把 `参考项目/` 的两个浏览器插件项目(StashDock,AGPL-3.0;Wechatsync,GPL-3.0)融合成**一个**浏览器扩展,作为工作台「导入」(网页采集进灵感墙)与「导出」(成稿多平台发布)的依托;wechatsync 的 CLI 在本仓库二次开发。界面用 impeccable 确认,真机浏览器验证,视觉验证过美观简洁。

研究结论(docs/research/stashdock.md、wechatsync.md、writing-desk-integration.md):

- 工作台是 DSH 插件,唯一 HTTP 面挂在宿主 webServer 的 `/writing-desk/*`,鉴权全权委托宿主 `connection.requestRejection`。**真机实证(2026-11-19,桌面 0.2.2-rc.3,127.0.0.1:48671):无凭证请求一律 401「未授权」**,宿主凭证只在启动 URL 里——浏览器扩展不该也不能持有宿主会话凭证,通道 A(扩展直连宿主 HTTP)排除。
- StashDock 的采集链路(MV3 + side panel + 按需注入 + Readability)自包含可平移,但整仓 AGPL——只借鉴协议与交互,代码自行实现;`@mozilla/readability` 是 Apache-2.0,可直接依赖。
- Wechatsync 的发布链路(适配器在 service worker 纯 fetch + declarativeNetRequest 伪造 Origin/Referer、草稿优先)与 CLI↔扩展桥(扩展主动外连 WS、Node 侧服务端)协议清晰,但整仓 GPL——同样只重实现不拷贝。其适配器接口、端点事实、图片管线策略是「事实与思想」,按其 adapter-spec 与研究文档重写不构成衍生。
- **小红书适配器在上游 private submodule,公开代码与本机都不存在**;需自研逆向 creator 后台(反爬签名),立项二期。v1 导出平台:公众号(weixin)、知乎(zhihu)、掘金(juejin)——三者端点可考、纯草稿接口、无验证码对抗。
- 本仓库是 npm 单包 DSH 插件,桌面 profile 是指向仓库根的 JUNCTION——新增顶层 `extension/`、`cli/`,不进 `files`,不引 workspaces。

## 决策

| 事项 | 决策 |
| --- | --- |
| 一个扩展 | `extension/`(MV3)同时承担两侧:导入 = side panel 采集预览(借鉴 StashDock 交互自行实现),导出 = 发布对话框(扩展自有页面)。工具栏点击即采集(单一职责);发布任务由工作台下发,扩展不提供挑稿入口。 |
| 本地桥(CLI) | `cli/` 二开 wechatsync CLI 为 `wdesk`:常驻 `wdesk serve` 起 WS 桥(默认 127.0.0.1:4527,可覆盖)+ 投递箱监听;命令面 `sync <file> -p platforms` / `platforms --auth` / `extract -o` 与上游对齐,便于心智迁移。CLI 与桥共用一个进程。 |
| 扩展↔桥 | WS,扩展主动外连 `ws://127.0.0.1:4527`(免 native messaging,Wechatsync 已验证的形态);**一次性握手鉴权**——token 由 `wdesk serve` 首次生成、写 `~/.dsh/writing-desk/bridge/auth.json`(0600),工作台设置页读出供复制,扩展存 chrome.storage,每条连接 hello 握手校验,不用逐条明文 token(上游缺陷修正)。 |
| 桥↔工作台 | **文件投递箱** `~/.dsh/writing-desk/bridge/`:`inbox/`(桥写导入件)→ host 消化进 applyOps;`outbox/`(host 写发布任务)→ 桥监听下发;`receipts/`(桥写回执)→ host 消化成 `item.dispatches`。迁移(migrate 直读 media-desk)与 Store mtime 双进程感知是既有先例;消化幂等靠「原子 rename 认领 + operationId 回执」(借鉴 StashDock 协议思想)。 |
| 导入链路 | side panel 采集(用户选区 → 站点适配 → Readability,自实现 DOM 工具)→ 用户确认(标题/正文/标签,dirty 守卫、冲突对话框、截断提示的交互照搬思想)→ 桥写 inbox → host 经 `add_item` 落灵感墙。桥不在时扩展降级:提示启动 + 复制 Markdown 兜底(剪贴板先例)。 |
| 导出链路 | 校样浮层发布对话框加平台多选(公众号/知乎/掘金)与「投递到浏览器」:host 导出发布包(既有 publish.js)并写 outbox 任务(含 article 正文、图片路径清单、itemId、operationId)→ 桥读取并把图片读成分片 data URI 下发扩展 → 扩展对每平台跑适配器(**只到草稿箱**)→ 回执写 receipts → host 落 `item.dispatches`(平台/草稿链接/时间/成败)。**发布状态仍只由用户确认(publish_item),dispatches ≠ 已发布**,校样浮层展示「已投递」供人工去平台发布后确认。 |
| 适配器 | `extension/src/adapters/` 注册表 + 平台适配器:weixin/zhihu/juejin 按 adapter-spec 与研究文档重实现(端点事实引用,代码原创);基类提供图片管线(抽图、去重、转存、单图失败降级继续);Origin/Referer 用 declarativeNetRequest 动态规则,`initiatorDomains` 只限扩展自身。全部 `draftOnly`,失败不静默。 |
| CLI 形态 | `cli/` 独立 package.json(`@dsh-writing-desk/cli`,bin 名 `wdesk`),不进插件包。零依赖倾向(WS 用 node:http + 手写帧或 ws 单依赖,取舍见实现);`publish.js` 生成命令字符串从 `wechatsync sync` 改为 `wdesk sync`。 |
| 许可 | 本仓库 MIT 不变;两参考项目代码零拷贝(协议/端点事实/交互思想可借鉴,文件头注明机制出处);`参考项目/` 进 .gitignore;`cli/README` 与扩展 NOTICE 声明「设计参考 Wechatsync(GPL-3.0)/StashDock(AGPL-3.0),未复制代码」;Readability 随扩展分发 Apache-2.0 声明。 |
| 扩展 UI | side panel 三段式(header/滚动表单/固定保存钮)与发布对话框(任务列表 + 平台进度)用 impeccable 确定,令牌对齐 DESIGN.md 的书桌语言(纸面/发丝线/衬线仪式感),但扩展运行在浏览器 chrome 里,不依赖宿主 CSS 变量,本地令牌自持。 |
| 宿主侧改动 | host 新增:`bridge` 投递消化(挂现有路由鉴权之后、state 读前惰性 + 轻轮询)、`GET bridge/status`(token 指纹 + inbox/outbox 计数,给设置页)、`POST production/dispatch`(写 outbox,复用导出)。client 新增:校样浮层平台多选与投递状态、设置页桥接区块(token 复制/连接状态/serve 提示)。 |
| 数据模型 | item 增 `dispatches[]`(`{platform, ok, url?, error?, at}`),ops 新 handler `record_dispatch`(与 retag_items 同类:不动状态元组,直接挂 item 字段,只追加、上限 20 条);state 增 `bridgeSeen`(operationId 回执记忆,上限 256);capture 来源的灵感沿用既有 add_item 白名单,不新增类型。 |

## 不做

- 不做小红书 v1 适配器(反爬签名对抗,二期自研);不做自动发布、自动写已发布状态(红线)。
- 不做像素级平台预览、不做 MCP server(CLI 先行,MCP 可后续按同一桥挂载)。
- 不做 Firefox/Safari 变体(v1 只 Chromium 系;构建按 manifest 生成器留口)。
- 不让扩展持有宿主凭证、不给 `/writing-desk/*` 加任何免鉴权面(真机 401 实证过的边界不动)。
- 不引 npm workspaces、不动单包结构(JUNCTION 约束)。

## 验收场景

1. 开发者模式加载 `extension/dist`,扩展图标点击 → side panel 采集当前页,保存后沙盒工作台灵感墙出现对应卡片(链接/标题/封面/正文节选)。
2. 桥未启动时采集保存:扩展给出可操作的连接提示与复制 Markdown 兜底,不丢内容。
3. `wdesk serve` 起桥后重复保存同一 URL:冲突对话框(保留/替换),不静默覆盖。
4. 校样浮层选「知乎 + 掘金」投递:扩展对话框出现任务、逐平台到草稿箱(登录态缺失时明确报「未登录」,不伪造成功);回执后校样浮层显示已投递记录,状态仍由用户确认。
5. `wdesk sync article.md -p zhihu,juejin --dry-run` 走通文件→桥→扩展全链路,--dry-run 只检查不提交。
6. `wdesk platforms --auth` 列出各平台登录状态。
7. 重复投递/双宿主进程(桌面+网页)并发消化:operationId 幂等,无重复卡片。
8. 全链路 `npm test` 全绿;真机(沙盒 web 版 + 浏览器)走查 1-6;扩展 UI 过视觉验收(美观简洁)。

## 后果

- 仓库多出两个顶层工程(`extension/`、`cli/`),`npm pack` 不受影响(files 未列);扩展分发走 unpacked/zip。
- 发布交接从「复制命令字符串」升级为「一键投递到浏览器」,但 CLI 命令字符串保留(无浏览器场景兜底)。
- 平台改版会破坏适配器——README 明示「草稿接口随平台改版需维护」的产品承诺。
- 桥进程是新的常驻面:只绑回环、握手 token、投递箱白名单校验;本机已有用户权限的进程可写投递箱,与 migrate 先例同一威胁模型。
