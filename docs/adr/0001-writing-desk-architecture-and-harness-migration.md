# 图文创作台的架构归属与向 harness 迁移的方向

Status: accepted（2026-11-16 讨论达成共识；本轮只更新文档，未改代码）

## 背景

一次「点击灵感卡片改为进入编辑界面、删除成稿界面」的需求讨论，暴露出更大的问题：工作台里哪些能力是 DSH 提供的，哪些是插件自己用 JS 实现的，以及「把生成能力交回 harness」在当前是否可落地。本 ADR 记录查到的事实、做出的决策与迁移路线图。

## 事实（基于代码与本机环境，非推测）

### 1. 领域逻辑由插件自有 JS 实现，但宿主服务已被深度使用

灵感墙、成稿流水线、排期、复盘、风格，以及提示词、生图、状态机、多语言、导出，都是本插件代码（`src/` 约 4000 行 + `client/` 24 个文件）。DSH 核心没有「灵感墙」「生成图文」这类领域服务。

但插件并非与宿主持割裂：`agentDefaultModel.currentSelection()`（`src/ai.js:17`）、`llm.prepareCall/stream`（`src/ai.js:25,40-64`）、`webServer.register`（`src/host.js:369`）、`connection.requestRejection`（`src/host.js:349-352`）、`tools` 执行管线（`src/image-tool.js:16-26,80`）、`slots`/`betterSidebar`（`client/index.jsx`）、模块加载器与宿主 React（`scripts/build.mjs:17,21`）均来自宿主。单独拎出来跑，只剩领域算法。

### 2. DSH 没有「原生 vs 插件」的能力墙

DSH 架构文档明说没有可 patch 的特权核心，model adapter、tool registry、session log、agent loop 本身都是插件。边界是 **composition 边界**（谁进入 profile patch 层、拿到 core service 注入），不是能力边界。因此「更原生」不能被当作目标本身；它只是「少重复造轮子」的手段。

### 3. 状态不一致的根因在领域层，与宿主无关

同一条灵感上有四套独立字段：`item.status`、`item.scheduledAt`、`item.production.status`、遗留 `item.drafts.*`。两条写路径：`src/ops.js:104-118` 与 `src/produce.js:95-101,113-119,214-232` 直接 `store.mutate` 绕过前者。四个面板各写谓词：`client/content.jsx:40,150`、`client/schedule.jsx:140-142`、`client/card.jsx:81,83`、`client/studio.jsx:111,187,223-235`。已确认的具体不一致场景：

- 成稿被取消/中断但正文已写入 → `production.status=cancelled`，全站显示未成稿；重新成稿会把正文清空。
- `save_draft`（`src/ops.js:172-179`）写 `drafts` 不写 `production`，内容页算「已成稿」而排期页算「灵感」。
- 看板手动 `set_status`（`src/ops.js:165-171`）可制造 `production=done + status=idea` 并存。
- 重新成稿时 `item.status` 不变，跨页身份漂移。

把生成交给 harness 不会自动修好这些；需要领域层先有唯一权威。

### 4. DSH 没有可复用的内置编辑器

存在的是配置编辑器（只改 `cordis.patch.yml`）、聊天输入框草稿（不可复用）、只读 Markdown 预览、agent 命令行式 `str_replace_editor`、`shell.overlay` 浮层容器。本机唯一可交互编辑器是第三方插件 `dsh-better-sidebar` 的 `ctx.betterSidebar`（CodeMirror 6，`src/client/TextEditor.tsx:19-22,386-418`），且是文件制、按 mtime 写回。工作台只挂 `betterSidebar` 的右侧栏页面，不再向 `slots` 注册左侧栏入口（同一个页面不重复出现在两处）。

### 5. Wechatsync 只到草稿箱，无可靠程序化回写

`@wechatsync/cli@1.1.0` 本机已全局安装，但 CLI 只是本地 WebSocket 桥（默认 9527），真正发布由浏览器扩展用已登录 Cookie 调平台接口；`sync` 默认存草稿、无 `--json`、失败也 `exit(0)`（本地 bundle `dist/index.js:927-954`）。因此「调 CLI 自动回写 published」不成立。

### 6. stashdock-dsh 是可借鉴的设计，不是要接的依赖

它是已装插件（右侧栏 tab），设计要点：5 字段速记卡、`contentOrigin` 区分手写/AI、标签当「上下文资料架」、批量改标签走 diff 预览 + revision 乐观锁、注入上下文不碰当前草稿。它本身没有「气泡/胶囊聚合」。

## 术语与边界

- **seam**：Service Definition + Service Provider + Consumer 三角色，DSH 的扩展接缝。
- **bundle**：进入 profile patch 层、拿到 core service 注入的扩展单元；「原生」只意味着 composition 上的这个位置。
- **Agent Preset（模式）**：`ctx.agentPresets` 声明的 Agent 配置；把 tool/skill provider 插件挂进 preset 的 `plugins` 子列表，注册就落在该 preset 的 Cordis scope 层，其他模式看不到（`dsh-agent-preset/src/index.ts:16-29`；`dsh-skill/src/index.ts:346-352,551-556`；`dsh-tools/src/index.ts:122,128-151`）。`defineTool` 没有 scope 参数；`restrict({allow,deny})` 只裁剪全局工具，不是真隔离。
- 本项目中「原生」的精确含义：**进入 profile 默认 bundle 组合、消费 core service 注入**，而不是搬进某个特权核心。

## 决策

| 事项 | 决策 | 理由 |
| --- | --- | --- |
| 产品定位 | 「灵感 → 聚合 → 成稿 → 发布」一体化图文工作台 | 痛点覆盖收、聚、写、发、风格闭环全链路 |
| 接管范围 | 只把 AI 动作层交回 harness；领域数据与视图留在插件 | DSH 没有对应领域服务；全量会话化只会换个地方割裂 |
| 胶囊与成稿输入 | 胶囊是持久化的命名灵感集合；成稿输入统一解析为灵感 ID 集合，单/多灵感与单/多胶囊同一入口 | 用户明确「胶囊只是更好梳理呈现给用户的 UI 设计」 |
| 状态机 | 新建纯 reducer 统一事件与迁移，导出共享谓词；Producer 与 ops 都走它，Store 只持久化；手动改状态后由 reducer 自愈对齐 | 根因是双写路径 + 四套谓词，与宿主无关 |
| 编辑器 | 自带统一 CodeMirror 组件替换 `AutoText`/`ArticleTile` 的 textarea，保留 `dispatchOps`/`undo()` 语义；不依赖第三方编辑器插件 | DSH 无内置编辑器；为「原生感」绑定第三方插件不值 |
| 创作模式 | 新建/启用 `writing` preset，tool 与 skill provider 只挂进该 preset 的 `plugins`；工作台 UI 仍全局可用；新增工具不写全局 Loader 行 | DSH 原生支持 scope 隔离；用户要的是工具不冲突，不是工作台消失 |
| 发布 | 不自研；导出 CLI 原生 `article.md + images/` 文件夹 + 可复制命令；上传后询问「是否视为已发布」，默认是、可手改 | CLI 只到草稿箱、无可靠回写；不写假状态 |
| 反馈 | 四步闭环：反馈/导出稿 → 规则写入风格卡 → 下次成稿自动套用 → 导出 DSH Skill；数据面板降级为可选模块 | 闭环不依赖自动采集即可跑通 |
| 灵感收集 | 只借鉴 stashdock-dsh 的字段与交互设计，运行时不集成 | 公开插件不应把核心收集压在第三方插件上 |
| 本轮交付 | 文档共识 + 路线图；不改代码 | 方向难逆转、需先固化 |

## 路线图（阶段、验收、回滚）

### 阶段 0：编辑界面与统一成稿入口（与迁移正交，先行）

- 建立独立编辑界面；点灵感卡片进入它。
- 统一编辑器组件替换 `AutoText`/`ArticleTile` 的 textarea，保留 ops 提交与撤销。
- 删除 Studio 浮层；成稿入口接受任意「成稿输入」（单/多灵感、单/多胶囊）。
- 速记卡借鉴 5 字段、`contentOrigin`、标签资料架与 revision 设计。
- **验收**：点单条灵感进编辑界面；四种选择都能进入同一成稿入口；正文可编辑可撤销；`production` 字段与 `draft/ready` 未被破坏。
- **回滚**：保留 Studio 组件，用开关切回。

### 阶段 1：领域状态机权威

- 新建纯 reducer（如 `src/item-state.js`），统一 `start / articleWritten / done / fail / cancel / schedule / unschedule / setStatus / publish` 的原子迁移，导出 `isDrafted / isScheduled / panelState`。
- Producer 与 ops 都经 reducer；Store 只持久化；四面板统一调用共享谓词；胶囊集合关系纳入不变量。
- **验收**：本 ADR 第 3 节四个不一致场景全部消失；取消/失败保留正文且状态正确；重新成稿不清空正文；手动改状态后自愈。
- **回滚**：按提交回退；reducer 保持纯函数，便于单独测试。

### 阶段 2：创作模式与 harness 动作层

- 启用 `writing` preset（profile 中已有 `preset-writing / disabled: true` 占位行），tool 与 skill provider 只作为其 `plugins` 子项；工作台 UI 仍在全局 slot。
- 注册一个粗粒度 `writing_desk.produce` tool（输入成稿输入 ID 集合与选项，写回同一 reducer）与承载风格/写作规则的 SKILL.md；配 `dsh-tool-skill`。
- **验收**：创作模式下可见并可用 tool+skill；编程/视频等模式看不到；侧栏工作台在所有模式可用；一次成稿写回同一状态机。
- **回滚**：禁用 preset 行即可；全局层不受污染。
- **实现前验证**：Client 侧 scope 查询本次因页面未连接超时，需在页面连接后用 `cordis_inspect_query` 复测。

### 阶段 3：发布交接

- 导出 CLI 原生 `article.md + images/` 文件夹，给出可复制的 `wechatsync sync` 命令。
- 上传后询问「是否视为已发布」，默认是、可手动改；只由用户确认写入 `published`。
- **验收**：导出文件夹可被 CLI 直接消费；无自动假状态；状态只从 `ready` 经用户确认进入 `published`。

### 阶段 4：风格闭环与数据面板降级

- 打通四步循环；数据面板降级为可选模块（手动录入、CSV 导入），不进主链路。
- **验收**：手动闭环可跑通；主链路不强制数据采集。

## 后果 / 待决问题

无阻塞决策。实现阶段需实测两项：Client scope 的 tool/skill 可见性（阶段 2），以及 Wechatsync 浏览器扩展是否已连接（阶段 3，不阻塞导出功能）。

## 代码影响

无。本次仅更新 `GLOSSARY.md` 与本 ADR，未改动任何源码、测试、构建产物或 profile 配置。
