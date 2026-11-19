# 图文创作台（dsh-writing-desk）浏览器扩展 / CLI 集成点与约束研究

- 日期：2026-11-19
- 范围：本仓库（MIT，npm 单包 DSH 插件）的全部集成点；为「融合浏览器扩展（导入：网页采集进灵感墙；导出：成稿一键多平台发布）+ 二次开发参考项目 CLI」的架构设计提供事实依据。
- 仓库根：`D:\源自C盘\桌面\dsh-writing-desk`（下文 file:line 引用均相对此根）。
- 本机实证：桌面宿主 0.2.2-rc.3（`~/.dsh/dsh-runtimes/dsh-primary-runtime/runtime.json`），桌面 profile 的 `dsh-writing-desk` 是指向本仓库根的 JUNCTION（`~/.dsh/profiles/desktop/node_modules/dsh-writing-desk`），即**桌面版当前运行的就是这份源码**。

---

## 0. 八问一页结论

1. **插件形态**：双半片 npm 单包——host 半片 `src/host.js`（Cordis 插件，default export `apply(ctx)`）+ client 半片 `dist/client.js`（esbuild 产 CJS，包 `window.__ModuleLoader__.load({id,factory})` 头）；manifest 是 package.json 的 `dsh.bundle.patch` + `dsh.client` 两字段；API 边界是 Cordis `ctx` 服务鸭子类型（webServer/connection/tools/skills/slots/uiWorkspace），没有 markdown 之类"md API"。
2. **Host 接口面**：唯一 HTTP 面 `/writing-desk/*`（GET state/settings/migrate/preview/version/assets/files；POST ops/undo/upload/capture-url/preview-url/harvest-text/production/save/production/reveal/production/export/skills/export/migrate/settings），鉴权全权委托宿主 `connection.requestRejection`（拿不到就 403），数据在 `$DSH_HOME/writing-desk/`（单行 `state.json` + `files/` + 0600 的 `settings.json`）。
3. **成稿数据结构**：`item.production` = { title, coverText, article(≤20 万字), aiArticle, cover, images[], intent, review, rev, snapshots(≤10), pendingWrite, savedPath/savedHashes/savedAt, cliPath }；「导出发布包」= 写出 `article.md + images/` 文件夹 + 可复制的 `wechatsync sync` 命令字符串，绝不调平台 API、绝不写已发布状态；校样浮层是纯前端按栏宽（375/578/700px）重排的近似预览。
4. **运行环境**：`scripts/dev-sandbox.sh` 用隔离 `DSH_HOME`（默认 `../.dsh-sandbox`）+ `dsh --profile web --port 4311` 跑网页版；插件页面**不是 iframe 也不是独立窗口**——它是宿主单页里的 React 组件（slot 注入，宿主实践明文"禁 iframe"）；DSH 宿主**有本地 HTTP 服务**（webServer；web 版端口来自 `--port`，桌面版 GUI 也走 127.0.0.1 随机端口），插件路由与服务页面**同源**。
5. **现有通信原语**：client→host 只有同源 `fetch('writing-desk/…')`；工作台→会话走宿主注入的 `inputActions.setDraft/insertQuote` 与 `uiWorkspace.startSession`；模型→host 走 preset 工具；「外部进程↔插件」先例只有**文件系统**（migrate 直接读 `~/.dsh/media-desk/state.json`）与**向外 execFile**（reveal 打开资源管理器）；参考项目 Wechatsync 的 CLI↔扩展通道是本地 WebSocket 9527 + HTTP 9528。
6. **构建与测试**：`npm run build/watch`（esbuild→dist/client.js）、`npm test` = `node --test test/*.test.js`（15 个文件，直接调领域模块 + 静态接线断言，不启 HTTP 不渲染 UI）；无 eslint/prettier 配置；风格为无分号 ESM、2 空格、单引号、中文"why"注释、导出函数带 JSDoc。
7. **安全约束**：字段白名单 + 长度上限是写路径唯一入口（模型输出同样不可信）；SSRF 防护（仅 http(s) 公网、DNS 全解析拦内网、逐跳复检）；上传扩展名白名单 + 危险扩展名黑名单；跨站 POST 拒绝（sec-fetch-site）；`renderMarkdown` 先转义——扩展接入时**不得绕开 ops 白名单直写 state.json、不得放松 harvest 的内网拦截、不得让插件路由产生新的免鉴权面**。
8. **落点建议**：保持仓库根 = 插件包（桌面 JUNCTION 依赖它），新增 `extension/` 与 `cli/` 顶层目录且**不进 `files` 白名单**（`npm pack` 不受影响），不引入 workspaces（会迫使插件包搬家、弄断 junction）；CLI 若用 JS 可先做本包内 `bin` + `files` 增项的可选演进，扩展走独立打包（CRX/Web Store），许可证上 Wechatsync 是 GPL-3.0、StashDock 是 AGPL-3.0，二开拷贝前必须清边界。

---

## 1. 插件形态：manifest、加载与 API 边界

### 1.1 manifest 结构（package.json 的 `dsh` 字段）

`package.json:15-26`：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-client-ui-conversation"] }
}
```

- **bundle.patch**：指向 `cordis.patch.yml`，即 Loader patch（composition 注入清单）。本包是"host 半片 + client 半片 + preset 子插件"三合一（`cordis.patch.yml:1-6` 注释自述）。
- **client.platform: 'web'**：client 半片跑在宿主 web 页面里。
- **client.immediately: true**：client 模块**启动即预取**，不等首个 slot 渲染才懒加载（git 提交 8d56edb"client manifest 对齐官方 UI 插件模板(immediately 预取 + conversation 依赖边)"；官方 decoration 模板同款字段，见 `~/.dsh/writing-desk-v2-notes/dsh-ref/deco-package.json`）。字段语义来自提交信息与官方模板对照；宿主内部行为的精确语义未在本仓库内验证。
- **client.inject: ['@deepseek-ai/dsh-client-ui-conversation']**：声明对宿主 conversation UI 包的**依赖边**——插件 client 用到宿主 conversation 侧的能力（接驳条拿 `inputActions`、`insertQuote` 等，见 §5），这个边保证那个包的 client 模块在同一页面可用。
- **engines**（`package.json:27-30`）：`node >=20`、`dsh >=0.2.2-rc.2 <0.3.0`。插件市场索引要求每个列出版本都带 `engines.dsh`（`scripts/index-entry.mjs:9-12`）。

### 1.2 composition 注入：全局工作台 + 创作模式 preset

`cordis.patch.yml` 只有两条 insert：

1. `writing-desk` → `name: 'dsh-writing-desk'`（`cordis.patch.yml:7-9`）：全局工作台行，挂的是本包默认导出的 host 插件（UI slots/侧栏，任何模式可用）。
2. `preset-writing` → `name: '@deepseek-ai/dsh-agent-preset'`，`config.id: writing`（创作模式），其 **`plugins` 子项**引用本包子路径：`dsh-writing-desk/preset-tool`、`dsh-writing-desk/preset-skill`、官方 `@deepseek-ai/dsh-tool-skill`（`cordis.patch.yml:10-27`）。

关键机制：**preset 的 plugins 子项注册落在该 preset 的 Cordis scope 层，其他模式看不到**（`cordis.patch.yml:2-4`、ADR 0001 术语节 `docs/adr/0001-writing-desk-architecture-and-harness-migration.md:46-49`）。测试以纯文本断言钉死"provider 只出现在 preset 块，绝不进全局行"（`test/preset.test.js:48-74`）。

### 1.3 npm 包结构与宿主加载

- **子路径插件**：`exports` 暴露 `./preset-tool`、`./preset-skill`（`package.json:10-11`），preset 子项 `name: 'dsh-writing-desk/preset-tool'` 从 **profile 根 node_modules** 解析（`cordis.patch.yml:18` 注释）。
- **安装形态**：`dsh plugin --profile <p> add <pkg|file:路径>` 把包装进 profile（本机实证：桌面 profile 的 node_modules 里是指向本仓库的 JUNCTION；本地目录安装"links the checkout"，`files` 不起过滤作用——dsh-doc plugin-development.md）。`scripts/dev-sandbox.sh:17-18` 同样用 `dsh plugin --profile web add "file:$SPEC"`。
- **host 半片加载**：`src/host.js:359-391` 导出 `name` + default `apply(ctx)`（Cordis 插件两形态之一），`inject: ['webServer','connection']` 声明依赖的宿主服务；`ctx.effect(() => ctx.webServer.register(...), 'dsh-writing-desk: /writing-desk routes')` 注册路由并随 effect 清理。
- **client 半片加载**：`scripts/build.mjs:7-23` 把 `client/index.jsx` 打成 **lazy CJS**，banner/footer 包成：

  ```js
  window.__ModuleLoader__.load({id:"dsh-writing-desk",factory:(require)=>{...;return module.exports}})
  ```

  `react` 是 external（宿主页面模块表提供，`build.mjs:17`），CSS 内联成字符串（`build.mjs:19`）。产物唯一：`dist/client.js`（`package.json` exports `"./client"`）。

### 1.4 插件与宿主的 API 边界

- **全部走 Cordis ctx 服务，鸭子类型**：host 侧消费 `webServer.register`（`src/host.js:371`）、`connection.requestRejection`（`src/host.js:353-357`）；preset 子插件消费 `ctx.tools.register` / `ctx.skills.registerProvider`（`src/preset-tool.js:289-292`、`src/preset-skill.js:79`），**不经 defineTool、不依赖 dsh-tools 包**，参数/输出直接写 JSON Schema（`src/preset-tool.js:6-7`）。client 侧消费 `slots.inject/register`、`uiWorkspace`、`betterSidebar`（`client/index.jsx:500-570`），且全部**软依赖 try/catch 降级**。
- **插件自己 provide 服务**：`ctx.provide?.('writingDesk', desk)`（`src/host.js:370`）把 `{settings, versionCheck, store}` 给 preset 子插件用（`src/preset-tool.js:287-288` `ctx.get('writingDesk')`）——保证工具与页面路由**同一份 Store/Settings、同一个 reducer**。
- **没有"md API"**：仓库内不存在宿主提供的 markdown/内容 API；富文本渲染是插件自己的 `renderMarkdown`（先转义，`client/util.js:203-241`）。

---

## 2. Host 接口面（src/host.js + src/ops.js）

### 2.1 HTTP 面

注册方式：`ctx.webServer.register({ kind: 'prefix', path: '/writing-desk', handler })`（`src/host.js:371-390`），每个请求先过 `requestRejection`，再进 `withLang(req.headers['x-writing-desk-lang'], ...)`（语言上下文，`src/i18n.js:13-15`）。

**GET**（`src/host.js:220-240`）：

| 路由 | 作用 |
| --- | --- |
| `assets/:name`、`files/:name` | 插件资源 / 用户素材文件服务；名字强制 `^[\w.-]+$`（`host.js:210-218`）；files 侧 `anyType` 允许任意已知扩展名按附件回（`host.js:62-63`） |
| `state` | 全量状态 + `canUndo`；示例数据按界面语言本地化（`host.js:221-225`） |
| `settings` | `{language, exportDir, defaultExportDir}`（`host.js:227`） |
| `migrate/preview` | 只读概览 `~/.dsh/media-desk/state.json`（`host.js:229-238`） |
| `version` | npm 最新版自检（`src/version.js`，TTL 1h，双 registry 回退） |

**POST**（`src/host.js:242-344`）：

| 路由 | 作用 | 关键约束 |
| --- | --- | --- |
| `ops` | 唯一通用写入口：`applyOps(draft, body.ops)` + 可撤销 mutate（`host.js:257-264`） | 白名单字段/长度（§7） |
| `undo` | 三方合并撤销（`src/store.js:39-57`） | |
| `upload` | 素材上传（raw body + `x-writing-desk-name` 头），落 `files/`（`host.js:127-140`） | 扩展名白名单 + 黑名单、250MB 上限 |
| `capture-url` | 抓公开页 → `add_item(web)`（`host.js:113-125`） | 经 `harvest` SSRF 防护 |
| `preview-url` | 只读预读标题/简介/封面/站点名，不落库（`host.js:102-111,300-302`） | |
| `harvest-text` | 抓正文（≤5 个 URL，≥80 字才算命中）供风格提炼（`host.js:304-318`） | 只抓文本不调模型 |
| `production/save` | 一键保存成稿文件夹（`host.js:269-285`） | 回写 `savedPath/savedHashes/savedAt` |
| `production/reveal` | 打开资源管理器（`execFile open/explorer/xdg-open`，`host.js:286-294`） | **路径只取自 savedPath，不接受请求传参** |
| `production/export` | 导出发布包（`host.js:329-341`，§3.3） | 回写 `cliPath` |
| `skills/export` | 导出用户级 Skill `~/.dsh/skills/writing-desk-voice/SKILL.md`（`host.js:319-327`、`src/learn.js:20-38`） | 示例规则不导出 |
| `migrate` | 从 dsh-media-desk 迁移（`host.js:249-254`） | 媒体复制进 `files/`，`md-` 前缀 id 幂等 |
| `settings` | 更新设置（`host.js:295-298`） | |

### 2.2 ops 白名单（src/ops.js handlers）

`applyOps` 是**唯一写入口**，UI 操作与会话写回同一链（`src/ops.js:1-2`、`src/preset-tool.js:5`）。共 30 个 handler（`src/ops.js:151-459`）：

- 灵感：`add_item` / `update_item` / `delete_item`
- 胶囊：`add_capsule` / `update_capsule` / `delete_capsule`（唯一归属、≥2 成员、自动解散）
- 排期/状态/发布：`schedule_item` / `set_status` / `publish_item`（**发布是唯一经 reducer publish 事件写"已发布"的入口，导出与同步绝不自动调用**，`ops.js:245-251`）
- 成稿：`update_production`（人工就地改）/ `send_to_session`（登记 `sentToSession`）/ `write_production`（会话写回，rev 乐观锁）/ `apply_write` / `discard_write`（冲突裁决）
- 标签：`retag_items`（批量带 revisions 乐观锁）/ `rename_tag` / `delete_tag`
- 人物/角度/风格/规则：`add_…`/`update_…`/`delete_…`/`set_style`
- 其他：`clear_samples`

字段白名单与类型 coerce：`ITEM_FIELDS`（`ops.js:18-22`）、`coerce()`（`ops.js:44-71`）——media.src 只接受 `writing-desk/(assets|files)/[\w.-]+` 或 http(s)；url 只接受 http(s)；状态/平台/来源类型是枚举。

### 2.3 鉴权与数据落点

- **鉴权**：`requestRejection(ctx, req)`（`src/host.js:353-357`）——从 ctx 取 `connection` 服务，调 `connection.requestRejection({ headers })`（宿主负责 Host/Origin 与登录凭证检查）；**拿不到鉴权服务时一律 403**。另对所有 POST 拒绝跨站：`sec-fetch-site` 非 `same-origin`/`none` → 403（`host.js:244-246`）。**Web 服务不替插件做路由鉴权，每个请求自己走一遍**（`host.js:346-347` 注释）。
- **数据落点**（`src/store.js:59-72`）：`dshHome() = $DSH_HOME || ~/.dsh`；`Store.root = ~/.dsh/writing-desk/`，内含：
  - `state.json`：全量状态，**`JSON.stringify` 单行落盘**（`store.js:94`；ADR 0008 指出这使通用 read/grep 的按行工具失效）；顶层键（本机实证）：`version, sampleCleared, sampleLang, items, people, angles, skills, accounts, metrics, styles, presetVersion, activeStyleId, capsules`（accounts/metrics 是 ADR 0005 退役字段的遗留，读取宽容）。
  - `files/`：上传与迁移来的素材。
  - `settings.json`：`{language, exportDir}`，写盘 `mode 0o600`（`src/settings.js:38-42`）。
  - （本机目录另有 `dna/`，是另一轮 v2 spike 的产物，本仓库代码不引用。）
- **并发模型**：双进程（桌面+网页）共用一份数据——每次读按 mtime 重读（`store.js:74-90`）、写前 `refresh`、tmp+rename 原子替换（`store.js:92-97`）、进程内 promise 队列串行（`store.js:99-104`）、撤销栈 30 条三方合并（`store.js:7,119-146`）。

---

## 3. 成稿数据结构

### 3.1 一篇成稿的字段（`item.production`）

由 reducer `submit` 事件建立/推进（`src/state.js:73-99`）：

| 字段 | 含义 | 依据 |
| --- | --- | --- |
| `title` / `coverText` / `article` | 三个可写正文字段（WRITE_FIELDS，≤200/40/200000 字符） | `state.js:38`、`ops.js:255-264` |
| `aiArticle` | 会话写回时的 AI 原稿快照，供改稿对比 | `state.js:84` |
| `cover` | `{src, caption?, status:'done'}` | `state.js:85` |
| `images[]` | `{src, caption?, anchor?, status}`，anchor=对应 `##` 小标题文字 | `state.js:86-89`、`preset-tool.js:143` |
| `intent` | 意图单（purpose/audience/judgment/mustKeep/boundary/evidence/platform/notDo + status） | `state.js:91`、`preset-tool.js:144` |
| `review` | 审读报告（findings[]，axis/severity/location/quote/suggestion，只报告不改稿） | `state.js:92`、`preset-tool.js:145` |
| `rev` | 版本号，每次 submit/editProduction +1；写回基线 | `state.js:93,109`、ADR 0008 |
| `snapshots[]` | 内容快照 `{at, by:'session'\|'user', title, coverText, article, note?}`，留最近 10 份 | `state.js:41-50` |
| `pendingWrite` | rev 冲突被拦下的会话写回暂存（`{...fields, baseRev, at}`），校样浮层裁决 | `ops.js:273-298` |
| `savedPath` / `savedHashes` / `savedAt` | 一键保存记录 | `host.js:269-285` |
| `cliPath` | 发布包导出目录（重复导出写回同一文件夹） | `host.js:329-341`、`publish.js:19` |
| `status`/`stage`/`finishedAt`/`startedAt`/`engine` | 产物元信息（engine 缺省 `'harness'`） | `state.js:76-80` |

状态元组（`item.status / scheduledAt / production`）的唯一裁决者是 `src/state.js` reducer（事件：`submit/editProduction/schedule/unschedule/setStatus/publish`，`state.js:10`），带自愈 `heal()`（`state.js:57-67`）。

### 3.2 「导出发布包」现在做了什么（`src/publish.js`）

`production/export` → `exportForCli(production, {filesDir, exportDir})`（`publish.js:17-50`）：

1. 目录：`<exportDir>/发布|publish/<标题>/`（同稿重复导出复用 `cliPath`）；`exportDir` 来自设置，缺省 `~/Documents/图文创作台`（英文界面 `Writing Desk`，`src/export.js:9-14`）。
2. 写 `article.md`：正文 + 封面/配图按 `## anchor` 插回对应小标题节末（`articleWithFigures`，`export.js:56-67`，与一键保存共用）。
3. 图片原样复制进 `images/`（cover、figure-N），**只认 `writing-desk/files/[\w.-]+` 的本地路径**（`copyAssetFile`，`export.js:47-53`）。
4. 产出**命令字符串**（不执行）：`wechatsync sync "<article.md>" --title "<标题>" --cover "<封面绝对路径>"` 与 `dryRunCommand`（`publish.js:42-49`）。
5. 不调平台 API、不解析 CLI 输出、不写已发布状态——**是否已发布由用户确认（publish_item）**（`publish.js:1-4`、`ops.js:245-251`；校样浮层的发布对话框用"视为已发布"复选框落 `publish_item`，`client/proof.jsx:35-80`）。

一键保存（`production/save` → `saveProduction`，`export.js:74-114`）是姊妹功能：写 `文章.md`/`封面原图`/`配图N`，对文件夹里的手改做 hash 检测并另存备份。

### 3.3 校样浮层的平台形态预览（client/proof.jsx）

- 纯前端实现：三平台只差**栏宽重排**——小红书 375 / 公众号 578 / 知乎 700（`proof.jsx:11-15`），CSS 变量 `--paper-w` 切换，角标注明"近似预览"，不做像素承诺（ADR 0006 校样浮层行）。
- 图片插回：`ArticleFlow` 按 `## anchor` 匹配小标题放图，未匹配的按位置均分兜底（`proof.jsx:187-217`）。
- 就地编辑：标题/封面文案/正文 `update_production` 落库可撤销（`proof.jsx:243-245,314-340`）；版本面板回退 = 用快照三字段再走 `update_production`（`proof.jsx:83-115`）；冲突横幅给 `apply_write`/`discard_write` + 双栏 diff（`proof.jsx:118-155`）。
- 交接层：复制正文（剪贴板）、保存文件夹、打开文件夹、发布（=导出发布包+确认对话框）、排期、去向平台下拉（`proof.jsx:342-365`）。

---

## 4. 运行环境

### 4.1 dev-sandbox（scripts/dev-sandbox.sh）

`dev-sandbox.sh:1-19`：

1. 沙盒 `DSH_HOME` 默认 `<repo>/../.dsh-sandbox`（可用 `DSH_SANDBOX` 覆盖），**不碰 `~/.dsh`**。
2. `npm run build` 后 `unset DSH_SESSION_ID DSH_SHELL DSH_WEB_URL DSH_PROFILE DSH_PROFILE_DIR`，`export DSH_HOME=$SANDBOX`。
3. Windows 特判：`cygpath -m` 把 MSYS 路径转盘符路径（`dsh`/pnpm 需要盘符）。
4. `dsh plugin --profile web add "file:$SPEC"` 装插件 → `exec dsh --profile web --no-open --port 4311`。

### 4.2 桌面版与网页版差异 / 页面形态 / 本地 HTTP

- **同一份代码、同一份数据**：host/client 不分叉（`src/store.js:1-2`"桌面端和 Web 端读同一份数据"）；manifest `platform: 'web'` 对两端都成立（桌面端内嵌同一 web UI）。
- **插件页面是宿主单页里的 React 组件，不是 iframe、不是独立窗口**：
  - client 经 `ctx.slots.inject('main', …)` / `betterSidebar.registerTab` / `slots.inject('conversation.input.dock', …)` 挂进宿主页面（`client/index.jsx:503-525,553-561`）；
  - 本机宿主实践记录明文"React-in-slot、**禁 iframe**、禁 import client primitives"（`~/.dsh/writing-desk-v2-notes/NAVIGATION.md` 引 `.scratch/dsh-refs/practices.md`）；
  - dist 头部是 `window.__ModuleLoader__.load(...)`，即宿主页面模块表的一部分（`scripts/build.mjs:21`）。
- **DSH 宿主有本地 HTTP 服务**：
  - web 版：`dsh --profile web --port 4311`（`dev-sandbox.sh:19`）——端口来自 CLI 参数；
  - 桌面版：Electron 壳（本机 0.2.2-rc.3），GUI 同样经本地 HTTP 服务出来（2026-11-15 实证 `GUI: http://127.0.0.1:39405`，`~/.dsh/writing-desk-v2-notes/NAVIGATION.md`；端口随启动变化）；
  - **插件路由与服务页面同源**：`webServer.register({kind:'prefix', path:'/writing-desk'})` 挂在同一服务下（`src/host.js:371-390`），client 用**相对路径** `fetch('writing-desk/…')`（`client/desk.js:6,40-47`）——这决定了浏览器扩展**理论上可以直接打到 `http://127.0.0.1:<port>/writing-desk/*`**，但必须过 §7 的鉴权（`connection.requestRejection` 检查 Host/Origin 与登录凭证 + sec-fetch-site 跨站拒绝；扩展发起的 fetch `Sec-Fetch-Site` 通常为 `none`，能否过 `connection.requestRejection` 是**待实测的 ключ风险**，见 §9）。
  - 桌面宿主源码在 `D:/Software/DSH/resources/app.asar`（asar 虚拟路径才能读，bash/glob 看不见）。

---

## 5. 现有通信原语

### 5.1 client → host：同源 fetch

`client/desk.js:6` `const BASE = 'writing-desk/'`；`request()`（`desk.js:40-47`）带 `x-writing-desk-lang` 头；上传走 `fetch(BASE+'upload')`，文件名放 `x-writing-desk-name` 头（`desk.js:254-260`）。**没有 WebSocket、没有 postMessage、没有 storage 轮询**——client 与 host 的全部通信就是这一组同源 HTTP。

### 5.2 工作台 → DSH 会话（素材怎么进会话）

`client/session-link.js` 是唯一桥（`session-link.js:1-8` 注释"两头都是宿主注入的能力，插件自己不持有会话"）：

1. **接驳条注册输入面**：dock 挂载时把 `{setDraft, insertQuote, getDraft, submitAvailable}` 交给 `setComposer`（`client/dock.jsx:26-56`；`inputActions` 来自宿主 conversation 槽位的 standardProps，槽位名 `conversation.input.dock`，旧名 `conversation.composer.dock` 回退，`client/index.jsx:515-525`、ADR 0007 修订六）。
2. **追加引用块**：`referenceIntoDraft` 读草稿镜像（`getDraft`）→ 追加到**末尾**（红线：不清空用户已输入的文字）→ `setDraft` 整段替换（`session-link.js:106-125`）。引用是指针：只放标题与 ID，正文由会话经 read 工具取（`session-link.js:91-99`）。
3. **引用签**：宿主 `inputActions.insertQuote(text, summary)` 可插可点开看的 chip（`session-link.js:207-232`）；新会话的签经 `pendingCreate`（15s TTL）+ dock 挂载重试补投（`session-link.js:236-256`、`dock.jsx:42-50`）。
4. **开会话**：`uiWorkspace.startSession(undefined, { agentPreset: 'writing', prompt, whenDraftExists: 'append' })`（`session-link.js:257-288`；风格提炼变体 `openStyleSession`，`session-link.js:291-303`）。`uiWorkspace` 是软依赖，拿不到降级 toast（`client/index.jsx:531-543`）。
5. **画布拖拽**：插件内部 window CustomEvent（`wd-ref-dragstart/end`，`session-link.js:45-59`）+ HTML5 dataTransfer MIME `application/x-writing-desk-items` / `text/writing-desk-item` / `text/writing-desk-capsule`（`dock.jsx:158-179`）。**宿主 composer 本体只认 Files 与内部 FILE_DRAG_TOKEN_TYPE，自定义 MIME 直落不成立**（v2 spike 结论③，`~/.dsh/writing-desk-v2-notes/spike-conclusions.md`）。

### 5.3 会话（模型）→ 工作台

preset 作用域内注册四件工具（`src/preset-tool.js`）：`writing_desk_read`（按 ID/胶囊/query 读素材，输出有界截断，产物概要带 rev 与全部可写字段——ADR 0008 rev 契约修正）、`writing_desk_write`（rev 乐观锁 + pendingWrite 冲突闸门）、`writing_desk_add_rule`（proposed 落库等人工启用）、`writing_desk_add_style`（写完即设为当前）。全部写路径走 `applyOps` + reducer（`preset-tool.js:5`）。工具的 `execute` 通过 `ctx.get('writingDesk').store` 直接 mutate。

### 5.4 「外部进程 ↔ 插件」先例

- **文件系统交接**：`migrate` 路由直接读另一个插件的落盘数据 `~/.dsh/media-desk/state.json`（`src/host.js:142-162` `mediaDeskPaths()`），素材文件在 `~/.dsh/media-desk/{assets,files}` 与各 profile 的 `node_modules/dsh-media-desk/` 里找（`host.js:164-186` `findAsset`），复制进 `writing-desk/files/`（`host.js:188-202`）。**没有进程协议，纯文件**。
- **向外 execFile**：`production/reveal` 用 `execFile('explorer'|'open'|'xdg-open', [path])` 打开文件夹（`host.js:286-294`）——仓库里唯一的外部进程调用。
- **写宿主目录**：`skills/export` 写 `~/.dsh/skills/writing-desk-voice/SKILL.md`（`src/learn.js:20-38`）。
- **npm registry 只读自检**：`src/version.js`。

### 5.5 参考项目的通道先例（Wechatsync）

- **CLI ↔ 扩展 = 本地 WebSocket**：CLI 默认连/监听 `SYNC_WS_PORT || 9527`（`参考项目/Wechatsync/packages/cli/src/index.ts:21`）；桥实现 `ExtensionBridge`（`packages/mcp-server/src/ws-bridge.ts:34`）：**WS 9527 + HTTP API 9528**（`/status`、`/request`，`ws-bridge.ts:115-166`），多实例 primary/secondary 自动接管；鉴权 token `WECHATSYNC_TOKEN`（`ws-bridge.ts:29,429`）；图片分片上传（`ws-bridge.ts:529-581`）。
- **扩展侧主动外连**：`DEFAULT_SERVER_URL = 'ws://localhost:9527'`（`packages/extension/src/mcp/client.ts:42`），设置 UI 可改（`src/popup/components/SettingsDrawer.tsx:363`）。
- **扩展 manifest**：permissions `storage/unlimitedStorage/cookies/declarativeNetRequest/scripting/tabs/alarms/contextMenus/downloads`，host_permissions `http://*/* + https://*/*`，无 `externally_connectable`（`packages/extension/manifest.json`）——即**没有 native messaging**，一切靠扩展自身 fetch/WS + cookies + declarativeNetRequest 改头（只对扩展自身请求生效，`initiatorDomains: [chrome.runtime.id]`，`src/runtime/extension.ts:125-174`）。

---

## 6. 构建与测试约定

### 6.1 npm scripts（package.json:43-50）

| script | 命令 | 说明 |
| --- | --- | --- |
| `build` | `node scripts/build.mjs` | esbuild → `dist/client.js`（CJS、external react、CSS 内联、chrome120 target） |
| `watch` | `build.mjs --watch` | esbuild context watch，client 改动即时重打包 |
| `test` | `node --test test/*.test.js` | 内置 node:test，15 个文件 |
| `assets` | `python3 scripts/gen-assets.py` | 程序绘制示例素材 |
| `index` | `node scripts/build-index.mjs` | 发版后按 npm registry 刷新 index.json（官方校验器兜底） |
| `prepack` | `npm run build` | pack 前强制重建 dist |

依赖极简：devDependencies 只有 `esbuild` 与 `@deepseek-ai/dsh-plugin-market-index`（`package.json:51-54`）；运行时**零依赖**（Node ≥20 内置模块 + 宿主注入）。

### 6.2 测试框架与覆盖形态

- **node:test + node:assert/strict**，无任何 UI 自动化、不启 HTTP 服务。
- 三类断言形态（`docs/specs/2026-11-16-writing-desk-harness-migration.md:91-97`）：
  1. **领域行为**：直接调 ops/Store/reducer/导出函数，临时目录，断言最终状态与产物（`test/host.test.js`、`test/state.test.js`、`test/publish.test.js`、`test/migrate.test.js`…）。
  2. **静态接线**：正则读文件断言 import/路由/口径（`test/client-wiring.test.js`——如"produce 操作页已删除""useDesk 选择器不得 `?? []`""面板状态口径统一走 src/state.js"；`test/preset.test.js:21-74`——cordis.patch.yml 行结构断言）。
  3. **纯文本行为**：harvest SSRF、版本号解析、i18n（`test/host.test.js:1-17` 的 import 面）。
- preset 工具测试用 fake desk（`new Store(mkdtemp)` + 假 ctx）直测 execute（`test/preset.test.js`）。

### 6.3 代码风格（从现有代码归纳）

- ESM（`type: module`）、**无分号**、2 空格缩进、单引号、模板串；无 eslint/prettier 配置（仓库根确认不存在）。
- 每个文件头部一段中文注释讲**为什么/边界**（如 `src/preset-tool.js:1-7`）；注释只解释 why。
- 导出函数带 JSDoc `@param/@returns`（`src/host.js:95-101`、`src/store.js:113-118`）。
- i18n：key 即中文原文，`tr('收藏《{title}》', {title})`（`src/i18n.js:28-31`）；client 每请求带语言头。
- **纯函数模块零依赖纪律**：`src/state.js` / `src/produce-input.js` 被 Host 与 client 同时打包，不得 import i18n/async_hooks（`src/state.js:1-4`、`src/produce-input.js:2-3`）。
- 改 `src/` 要重启宿主，`client/` 走 watch 即时生效（`README.md:189`）。

---

## 7. 安全约束（扩展接入的红线）

README 声明（`README.md:191`）：**每个接口都经过 Host 鉴权；模型输出和读到的外部内容只取固定字段、限制长度，操作走白名单；粘贴的链接不能访问本机和内网**。

具体执行点：

1. **字段白名单是唯一写入口**：`applyOps` + `pick/coerce`（`src/ops.js:44-81`）；未知 op 拒收（含原型链名，`host.test.js:25-29`）；**模型输出按不可信输入对待**（`ops.js:2`）。
2. **媒体/URL 地址约束**：media.src 只允许 `writing-desk/(assets|files)/[\w.-]+` 或 http(s)（`ops.js:63-68`）；item.url 只允许 http(s)（`ops.js:35-42`）。
3. **SSRF 防护**（`src/harvest.js`）：仅 http(s)；禁 localhost/.localhost/.local；DNS 全记录解析后拦 IPv4 私网/CGNAT/链路本地、IPv6 回环/ULA/fe80、NAT64 映射（`harvest.js:10-36`）；**手动逐跳跟随重定向、每跳重新断言**（`harvest.js:65-80`）；1.5MB / 8s / 4 跳上限。**扩展的"网页采集进灵感墙"若走 host 的 capture-url/preview-url，必须复用 assertPublicUrl；若扩展在浏览器侧直接抓取再回传，回传数据同样只按白名单字段进 ops**。
4. **上传约束**：扩展名白名单 `FILE_EXT`、黑名单 `UNSAFE_EXT`（html/svg/js/exe/bat/…）（`host.js:26-30,127-140`）；250MB 上限；服务侧 `x-content-type-options: nosniff`、未知类型按 octet-stream 附件回（`host.js:61-74`）。
5. **路径安全**：assets/files 名字强制 `^[\w.-]+$`（`host.js:210-218`）；reveal 路径只来自落库的 savedPath（`host.js:286-287`）；迁移素材名同样 `safeBase` 清洗（`host.js:164-167`）。
6. **跨站拒绝**：所有 POST 检查 `sec-fetch-site`（`host.js:244-246`）。
7. **HTML 注入**：`renderMarkdown` 先 `escapeHtml` 再处理结构，模型/用户 HTML 不执行（`client/util.js:191-241`）；外链图 `referrerPolicy="no-referrer"`（`client/index.jsx:98`）。
8. **人工闸门语义**：发布状态只由用户确认（`ops.js:245-251`）；批量改标签/会话写回带版本乐观锁（`ops.js:274-298,317-333`）；撤销是最后安全网（`store.js:39-57`）。ADR 0001 决策表"发布：不自研；不写假状态"。
9. **设置文件 0600**（`src/settings.js:39-41`）。

**对扩展的推论（红线）**：
- 扩展不得绕过 `applyOps` 直写 `state.json`（会绕过白名单/快照/撤销/双进程串行——ADR 0008 三条判据同理适用于任何新写路径）。
- 扩展接入 host HTTP 面时**不得引入免鉴权路由**；`connection.requestRejection` 是宿主的，插件层面无法放宽，也不应放宽。
- 扩展侧抓取的页面内容回传 host 时，长度上限与 `contentOrigin` 标注（user/ai）语义要保留（`ops.js:50-51`）。
- **许可证红线**：`参考项目/`（未入 git，`.gitignore` 未列）里 Wechatsync 是 **GPL-3.0**、StashDock 是 **AGPL-3.0-only**——二开代码拷进 MIT 主仓库前必须清许可边界（重写而非拷贝，或隔离目录+合规声明）。

---

## 8. 落点建议（扩展 + CLI 进本仓库）

### 8.1 现状约束

- **单包结构**：仓库根即 npm 包 `dsh-writing-desk`；无 workspaces（root `package.json` 就是插件 manifest）；`files` 白名单 = `src, dist, assets, cordis.patch.yml, README.md, LICENSE`（`package.json:55-62`）→ **`npm pack` 只装这些，新增顶层目录天然不进包**。
- **桌面安装是指向仓库根的 JUNCTION**（`~/.dsh/profiles/desktop/node_modules/dsh-writing-desk`）——插件包**不能搬家**，否则 junction 断。
- `dist/` 在 `.gitignore` 但进 `files`（prepack 重建），`node_modules/`、`*.tgz` 已忽略；`参考项目/` 目前未跟踪。

### 8.2 建议

1. **`extension/`（顶层新目录）**：浏览器扩展（MV3）独立工程，自带 package.json/构建（参考 `参考项目/Wechatsync/packages/extension` 的 manifest/permission 面与 runtime 抽象）。**不进插件包 `files`**，发布走 CRX / Web Store / 开发者模式加载；`npm pack` 不受影响（`files` 白名单未列它）。扩展与插件的耦合点收敛为一组常量：API 基址（`127.0.0.1:<port>/writing-desk/`）与 ops 名单。
2. **`cli/`（顶层新目录）**：二开 Wechatsync CLI 的落点。两种形态按需选：
   - **先独立**：`cli/` 独立 package.json（如 `@dsh-writing-desk/cli` 或维持 `wechatsync` bin 名以复用 `publish.js` 生成的命令字符串），不进插件包——`npm pack` 完全不动；
   - **可选合并**：若希望 `dsh plugin add` 一并带 CLI，则给插件包加 `bin` 字段 + `files` 增 `"cli"`——但这会让插件包体积/依赖变重，且 `engines` 混置，**默认不建议**。
   - CLI 的发布通道现状：`publish.js` 只产文件与命令字符串（`publish.js:1-4`）；若 CLI 改为本地服务（WS/HTTP），工作台侧可从"复制命令"升级为"一键调用"，但**仍不得自动写 published**（红线 §7.8）。
3. **不引入 npm workspaces**：workspaces 要求插件包挪进子目录（root 变 private 工作区根），会同时弄断桌面 junction、改掉 `scripts/build.mjs` 相对路径与 `src/version.js` 读 package.json 的位置；单包 + 平级目录已满足隔离需求（奥卡姆）。
4. **`参考项目/` 处理**：加入 `.gitignore`（现在是未跟踪也未忽略的悬置目录），GPL/AGPL 代码只作机制参考，二开实现重写并保留机制出处注释（先例：ADR 0001 对 stashdock"只借鉴设计，不是要接的依赖"）。
5. **数据面**：扩展导入的网页素材走既有 `capture-url`（host 侧抓，带 SSRF 防护）或新增扩展侧抓取→`ops` 白名单写入两条路都通；导出侧新增"扩展直发"时，发布确认语义沿用 `PublishDialog` + `publish_item`（`client/proof.jsx:35-80`）。

---

## 9. 「扩展如何与工作台通信」可行通道证据汇总

| 通道 | 证据 | 评估 |
| --- | --- | --- |
| **A. 扩展 → DSH 本地 HTTP（同源路由直连）** | 宿主有本地 HTTP 服务：web 版 `dsh --profile web --port 4311`（`scripts/dev-sandbox.sh:19`）；桌面 GUI 走 `http://127.0.0.1:39405`（v2 notes 实证）；插件路由挂在同一服务的 `/writing-desk` 前缀（`src/host.js:371-390`） | 最短路径。**待实测**：`connection.requestRejection` 对无宿主凭证请求的行为（`src/host.js:353-357`"拿不到鉴权服务时一律拒绝"；它检查 Host/Origin 与登录凭证）；扩展 fetch 的 `Sec-Fetch-Site` 为 `none` 可过 sec-fetch-site 检查（`host.js:244-246`）。若被拒，需要宿主侧支持（如 token）或改走 C/D 通道 |
| **B. 文件系统交接** | migrate 直接读 `~/.dsh/media-desk/state.json` + 跨 profile 找素材（`src/host.js:142-186`）；Store 按 mtime 感知另一进程写入（`src/store.js:1-2,101-103`；`test/host.test.js:101-117` 双进程用例） | 零依赖、双端可用（桌面/网页共用 `~/.dsh`）。扩展可用 `chrome.downloads`/`Native Messaging host` 写文件；但**扩展写 `state.json` 必须经 ops 语义**（快照/撤销/白名单），宜写"投递箱"文件由 host 路由消化 |
| **C. 本地 WebSocket / HTTP 桥（参考项目先例）** | Wechatsync：CLI 起 WS 9527 + HTTP 9528，扩展主动外连 `ws://localhost:9527`，token 鉴权、分片上传（`参考项目/Wechatsync/packages/cli/src/index.ts:21`、`packages/mcp-server/src/ws-bridge.ts:34-166`、`packages/extension/src/mcp/client.ts:42`） | 二开 CLI 天然自带这套桥；扩展→CLI→（文件/ops）→工作台。host 侧要消化外部写入，仿 migrate 的"文件投递 + 路由收敛"或给 CLI 一个受限 ops 客户端 |
| **D. Chrome Native Messaging** | 参考项目**未使用**（Wechatsync manifest 无 `externally_connectable`，无 nativeMessaging 权限；沟通全靠 WS + `chrome.cookies`/`declarativeNetRequest`，`packages/extension/manifest.json`、`src/runtime/extension.ts`） | 若走 B 通道（写本地文件）或与 CLI 长连，native messaging host 是标准载体；需另行申请 `nativeMessaging` 权限与注册 host manifest。本仓库无既有线索，属新建 |
| **E. 会话通道（间接）** | 工作台→会话：`inputActions.setDraft/insertQuote`、`uiWorkspace.startSession(agentPreset:'writing')`（`client/session-link.js:106-125,257-288`）；会话→工作台：preset 工具写回（`src/preset-tool.js`） | 扩展可把素材投给**正在运行的 DSH 会话**（如经宿主 CLI/会话文件），由会话经 `writing_desk_*` 工具落库——但这是"经会话"而非"扩展↔工作台"直达，延迟与不确定性高 |
| **F. 剪贴板** | `copyReferenceForAI` / 复制命令字符串（`client/session-link.js:159-170`、`client/proof.jsx:37-44`） | 已有人工通道先例，可作扩展导入的手动兜底（扩展复制→用户在工作台粘贴） |

**桌面版侧事实**（影响 A/D 可行性）：桌面宿主源码在 `D:/Software/DSH/resources/app.asar`，`connection` 服务的鉴权细节只能实机测或读 asar（bash/glob 不可见，需 Electron asar 虚拟路径——见 `~/.dsh/writing-desk-v2-notes/NAVIGATION.md` 的方法记录）。

---

## 附录：未验证 / 待实测清单

1. `connection.requestRejection` 的具体判据（Origin 白名单？cookie？）——本仓库只见委托调用，宿主实现在 asar 内；扩展直连 A 通道的成败取决于它。
2. `dsh.client.immediately/inject` 在宿主侧的精确行为（提交信息与官方模板佐证语义，宿主代码未读）。
3. 桌面版 GUI 端口策略（观测到 39405 随机；是否每次启动变化、可否固定）。
4. Wechatsync CLI 本机是否仍可用/版本（ADR 0001 记录本机已装 `@wechatsync/cli@1.1.0`、`sync` 失败也 `exit(0)`；`参考项目/` 内是其源码）。
5. `~/.dsh/writing-desk/dna/` 与 `~/.dsh/writing-desk-v2-notes/` 是另一轮 v2 spike 的产物（属 Wechatwriting 仓库的票务记录），本仓库代码不引用；研究时仅取其宿主事实，不取其数据方案。
