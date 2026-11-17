# 图文聚焦:裁掉分镜、复盘与 Monid

Status: accepted(2026-11-18 目标指令定案;实现随 0006 一起落地)

## 背景

产品收窄为图文文章的创作与发布辅助:只专注图文,产出侧不再有任何视频能力;复盘页及其整条数据链路退场;同时成稿动作迁移到 DSH harness 会话(见 0006),插件不再保留任何模型请求或自造逻辑。本 ADR 记录裁剪决策与影响面。

## 决策

| 事项 | 决策 |
| --- | --- |
| 分镜(产出侧) | `production.shots` 与整套分镜能力纵向删除:`settings.shotCount`、ai.js 的分镜师角色与 shots schema、images.js 的 SHOT_STYLE/shotPrompt、produce.js 的分镜 worker、export.js 的分镜脚本导出、produce.jsx 的 ShotsTile 与镜/秒统计、ProgressCard 分镜步、i18n 词条、mock。旧数据里的 `shots` 字段读到即忽略,不写迁移。 |
| 视频封面 | client/cover.js 的 videoCover 合成、下载与 host.js `produce/save` 收 videoCover 一并删除;图文封面保留。 |
| 复盘页 | insights.jsx、NAV 的 insights、`/insights` 路由、state 的 `metrics`/`accounts` 数据模型、seed 示例账号与指标、相关测试一并删除。日历上的灵感邮票(连续天数)属于排期页,保留。 |
| Monid | monid.js、connect.jsx 导入对话框、`/monid/*` 路由、`/account/refresh`、`scripts/mock-monid.mjs`、overseas 测试删除;风格提炼改在 harness 会话完成(0006)。 |
| 平台名单 | PLATFORMS 收敛为小红书、公众号、知乎(发布去向与跳转链接用途);旧数据中其他平台值读取宽容、显示原样。 |
| 素材侧视频 | `kind: 'video'` 灵感卡保留:视频是合法素材,可进胶囊、参与成稿。 |
| 规则来源 | 随 metrics 死亡的数据驱动建议不再保留;插件侧的规则提炼启发式(learnFromEdits 等"自造逻辑")也删。写作规则来源收敛为:手动增改、harness 会话提炼(改稿对比用的 `aiArticle` 快照保留)。 |

## 后果

- 五页变四页:灵感 · 内容 · 排期 · 风格。
- "数据进来,规则出去"的复盘闭环终止;规则迭代发生在 harness 会话与手动管理。
- 发布仍是人工(复制正文/保存文件夹自己发),平台名单只服务发布去向。
- 旧数据兼容:`shots`/`metrics`/`accounts` 字段读取时忽略即可,无需迁移脚本。

## 代码影响

- `src/`:ai.js(分镜/口播提示词)、images.js(SHOT_STYLE/shotPrompt)、produce.js(分镜 worker)、settings.js(shotCount)、state.js(start/finishAs 的 shots 处理、metrics/accounts)、export.js(分镜脚本)、monid.js(整文件)、learn.js(metrics 链路)、host.js(monid/insights/learn 路由、videoCover)、seed.js(示例账号/指标/分镜)、ops.js(PLATFORMS 白名单)。
- `client/`:produce.jsx(ShotsTile 等)、insights.jsx(整文件)、connect.jsx(整文件)、cover.js(整文件)、index.jsx(NAV/CaptureDialog 视频相关)、util.js(PLATFORMS)、en/ 词条。
- `scripts/`:mock-monid.mjs 删除,mock-llm.mjs 去分镜。
- `test/`:overseas、insights 相关用例删除;host/state/produce-input 等涉及 shots 的断言改写。

## 回滚

git 历史回退;字段未做破坏性迁移,回退即恢复。
