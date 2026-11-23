# 成稿迁移 harness 会话:插件去模型化,只做数据、看板与人工介入

Status: accepted(2026-11-18 目标指令定案;双视角设计评审 + Wechatwriting-skills 消化合成;实现随本 ADR 落地。**部分被 0013/0014 取代:成稿产物挂在灵感上、写回快照、校样浮层与四列稿子看板不再有效;「写发生在创作会话、插件不做模型调用、发布由用户确认」继续有效。**)

## 真机验证记录(2026-11-18,沙盒 web 宿主 + ego-browser)

已验证:四页导航、会话写回(真路由 ops)→ 内容页签收栏与相位徽章 → 校样浮层(三形态重排/就地编辑 rev+用户快照/版本列表)→ 409 冲突横幅三按钮 → 接受裁决;右键「去创作会话」经 uiWorkspace.startSession(agentPreset:'writing') 打开创作会话并把指针化引用块写入草稿;「引用到对话」在接驳条缺席时优雅降级 toast。

已知边界:**conversation.composer.dock 的第三方条目在未完成账号引导的 web 壳上不渲染**——对照实验用官方模板原样的最小探针插件(修好组合行、补 host 半片、改名强制重装后)apply 可运行但 dock 槽位仍为空,属宿主侧门槛而非插件缺陷。接驳条代码就绪、降级链完备(镜像读不到→只写引用块;composer 未挂→toast),待账号完备的宿主自然生效;右键路径是已验证的等价入口。

## 背景

目标指令确立两条设计原则:**插件不保留任何模型请求或自造逻辑**,由 harness + 预设模式(preset-writing)的工具或 skill 维护项目状态机;同时必须保留**人工介入修改、编辑、预览的途径**。现状的成稿是插件内置流水线(produce.js 编排 + ai.js 提示词 + images.js 生图),四格 bento 操作页是它的驾驶舱——两条原则之下,这个驾驶舱连同流水线整体退场,写的主战场搬到 DSH 创作会话。

用户视角评审(Sudowrite/Jasper/Claude Artifacts/ChatGPT Canvas 对标)与设计师评审(接驳条/校样浮层/收发室)对方向一致,本 ADR 是合成后的决策。

## 决策

| 事项 | 决策 |
| --- | --- |
| 架构反转 | 删除插件内置成稿流水线:`produce.js`、`ai.js`、`images.js`、`image-tool.js`、style/extract 的模型调用、内置生图 HTTP 配置与试画。写作、生图、风格提炼全部发生在 DSH 创作会话(preset-writing,本插件 bundle 挂载)。`writing_desk_produce` 工具废弃。 |
| 状态机权威 | `state.js` reducer 仍是唯一裁决者,但事件集简化:内部流水线的 `start / articleWritten / done / fail / cancel` 移除;保留 `schedule / unschedule / setStatus / publish / editProduction`,新增 `submit`(会话成稿落库)与 `send`(素材交会话,见相位)。产出只经工具驱动。 |
| 写回契约 | **分阶段粗粒度、按字段写回**(用户评审 P0):`writing_desk_write` 工具支持 `{ targetId, intent?, title?, article?, coverText?, cover?, images? }` 部分写回,一次写回一稿一阶段,不做全量 replace。每次写回落**快照**(production.snapshots,记 at/来源/字段);正文写回带 AI 快照 `aiArticle`(供改稿对比)。 |
| 冲突防护 | 字段级乐观锁沿用 retag 的 revisions 模式:人工在浮层改过的字段,会话再写回时若基线不符,拒绝并要求用户在校样浮层的冲突横幅里裁决(diff/接受写回/保留我的)。撤销(Store 三方合并)是最后一道安全网。 |
| 工具面 | preset-writing 注册四件:`writing_desk_read`(读素材:按 itemIds/capsuleIds 取全文,按 query 找相关,有界输出带省略标记)、`writing_desk_write`(上述写回)、`writing_desk_add_rule`(规则提案,以 proposed 落库,风格页人工启用——软参考→确认→硬规则)、`writing_desk_add_style`(风格卡写回并设为当前)。相关操作不共享 action 参数,四个 schema 各自说清。 |
| skill 面 | `writing-desk-rules`(既有实时 provider)保持;新增 `writing-desk-craft` 静态 skill:消化 Wechatwriting-skills 的**声纹契约双向清单**(什么不是问题/什么是问题/防御性声明与 AI 味黑名单/优先级链/事实否决权)、**审读双轴**(Standards/Intent,P0-P2,只报告不改稿)、**润色四遍法与四关质检**、**意图单模板**——从公众号泛化到小红书/公众号/知乎。skill 条款写死人工闸门:**未经用户确认不得连续推进阶段**;用户明确要求快成稿时可合并阶段。 |
| 意图单 | 8 字段(发布目的/受众场景/一句话核心判断/必须保留的素材金句/争议边界/证据尺度/发布目标/明确不做)挂在 production 上,`status: draft \| confirmed`,change log 记 keep/replace/append。会话预填、用户一次确认;持久化在插件侧,新会话经 read 工具读回续跑。 |
| 成稿入口 | **拖拽为主、右键为辅,全部停在草稿**:灵感卡/胶囊拖到对话区,松手把引用块经 `inputActions.setDraft` **追加**进草稿(绝不清理用户已输入的文字),用户补一句意图再回车;卡片右键「引用到对话」同路径,「去创作会话」经 `uiWorkspace.startSession({ agentPreset: 'writing' })` 开会话并预填,不自动 submit。引用是指针:草稿里只放标题摘要与 ID,正文由会话经 read 工具取。 |
| 接驳条 | composer.dock 槽位渲染**素材接驳条**(恒高一行):平时近无;素材拖起时淡入为虚线 dropzone;悬停转实线内衬;落手后素材签(引用 chip,最多露四张折 +n)弹入——整个浮层唯一"作者时刻"。落点就是接驳条:宿主红线(插件不写组件外 DOM)决定做不了全对话区高亮,拖起即显形的接驳条是最大可做的落点提示。 |
| 相位 | 素材交会话时记 `sentToSession`(时间 + 会话线索),写回时清除。内容页据此呈现三相位:**审读中**(色纸占位卡,静态,无进度条)→ **已写回**(签收:未打开过的写回在内容页上方以签收栏宣布,点开校样浮层即签收)→ **人工修改中**(pen 徽章)。相位是同一列稿子的生命阶段,不加列。 |
| 校样浮层 | 取代 produce 操作页的人工介入载体:三层信息架构(状态层/内容层/交接层);三平台形态**重排**近似预览(小红书 375 窄栏 / 公众号 578 中栏 / 知乎 700 宽栏,角标注明"近似预览",不做像素承诺);就地无 chrome 编辑(标题/封面文案/正文,经 update_production 可撤销);版本快照列表与回退;冲突横幅;foot 交接(复制/保存文件夹/发布导出/排期/去向)。内容页成稿卡与签收栏打开它;灵感卡仍走灵感编辑界面。 |
| 内容页 | 四列看板(灵感/成稿/待发布/已发布;outline 数据宽容归入成稿列);写回签收栏 + 相位徽章;表格视图状态列加相位。 |
| 宿主版本 | 要求 DSH 0.2.2-rc.2+,能力检测启用拖拽/接驳条/一键开会话;旧宿主降级为纯看板(灵感墙/内容/排期/风格 + 编辑),成稿入口隐藏。README 声明同步。 |
| 快成稿 | 不做第二入口。会话里用户明说"直接写"时 skill 允许合并阶段;UI 不加任何跳过闸门的按钮。 |

## 不做

- 不做自动发送、自动推进阶段、自动发布(发布始终由用户确认)。
- 不在校样浮层内嵌第二条 AI 通路(Notion AI 教训):一切改稿请求经 setDraft 投回会话。
- 不做像素级平台预览、不接平台 API、不做富样式排版库。
- 引用不做全文粘贴(指针化,省上下文)。

## 交互流程(主链路)

1. 灵感墙记下几条灵感,收进胶囊或拖选多张。
2. 拖到对话区接驳条(或右键「引用到对话」):草稿末尾追加引用块;用户补一句意图,回车。
3. 创作会话经 read 工具取素材全文、经 craft/rules skill 带上风格与规则;先出意图单(预填),用户确认。
4. 会话分阶段写回:初稿 → 审读(只报告)→ 润色定稿;每步经 write 工具落库,内容页相位推进、签收栏宣布。
5. 用户在校样浮层预览三平台形态、就地修改(或把修改意见投回会话);人工修改与写回的冲突经横幅裁决。
6. 排期(日历拖拽)→ 发布交接(复制/保存文件夹/导出发布包)→ 用户确认已发布。
7. 改稿对比素材(aiArticle vs article)留在插件;规则沉淀由会话经 add_rule 提案、风格页确认。

## 验收场景

1. 拖一张灵感卡到对话区:接驳条淡入,松手后草稿末尾出现引用块,已有文字原样保留;不回车就不发送。
2. 拖胶囊:落成一个胶囊签(注明成员数);会话经 read 展开成员。
3. 会话调 write 写回初稿:内容页"审读中"占位卡变正常稿卡,签收栏出现;打开校样浮层签收消失。
4. 用户在校样浮层改过正文后,会话对同一字段再写回:工具拒绝,浮层出现冲突横幅,可 diff、接受写回或保留我的。
5. 校样浮层切平台形态:栏宽/字号/段距重排,出现"近似预览"角标;切回不丢编辑。
6. 版本列表可回退到上一快照,回退可撤销。
7. 会话经 add_rule 提案规则:风格页出现 proposed 规则,启用后进入 rules skill 实时内容。
8. 旧宿主(无 dock/startSession 能力):插件照常可用,成稿入口隐藏,README 有说明。
9. 全流程 npm test 全绿;真机(sandbox web 版)走查 1-7 通过。

## 后果

- 插件代码里不再有任何模型请求与生图配置;设置页删去生图来源/尺寸/质量/试画。
- 成稿产物只来自会话写回或 update_production;produce/save 与 live 轮询路由随流水线一起删。
- `writing_desk_produce` 从 preset 撤下;创作模式的工具面换血为 read/write/add_rule/add_style。
- 内容页从流水线看板变为收发室;五页变四页(0005)。
- 上游能力(生图、写作质量)完全依赖用户在 DSH 配好的模型与订阅生图工具。

## 代码影响

- 删除:`src/produce.js`、`src/ai.js`、`src/images.js`、`src/image-tool.js`、`client/produce.jsx`、`client/cover.js`(videoCover 合成)、host 的 produce*/settings-test 路由、settings 生图字段、分镜残余(0005 清单)、相关测试与 mock。
- 新增:`src/desk-tools.js`(read/write/add_rule/add_style 四个工具;后并入 `src/preset-tool.js`,本节按当时命名记录)、`src/craft-skill.js`(writing-desk-craft 内容)、state.js 新事件与快照、ops.js 的 update_production 扩展(cover/images/intent/review 白名单)、client 的 `dock.jsx`(接驳条)、`proof.jsx`(校样浮层)、content 相位与签收栏。
- 改造:`preset-tool.js`、`preset-skill.js`(多 skill provider)、`editor.jsx`(去「去成稿」,加引用到对话)、`card.jsx`/`capsule.jsx`(可拖引用)、`content.jsx`、`styles.css`、`client/en/*`、README。

## 回滚

git 历史回退;新事件与快照字段对旧版本是多余数据,读取无害,回退即恢复流水线。
