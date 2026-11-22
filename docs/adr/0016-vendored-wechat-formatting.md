# 微信排版内置为可调用的 fork:vendor/gzh-skill-kit,按需生成内联 HTML

Status: accepted(2026-11-20 与用户定案;88lin/gzh-skill-kit 为用户本人小号仓库,允许 fork 后跟随本仓库 MIT)

## 背景

工作台需要「微信 HTML 排版预览」:同一篇 Markdown 在发布前按公众号主题排成内联 CSS 的 HTML,发布包与编辑器预览复用同一份结果。候选是 `88lin/gzh-skill-kit`:Python + Agent 读主题组件库手写内联 HTML,主题质量好,但没有 Markdown→主题 HTML 的现成 CLI;本机 `md2wx` CLI 已损坏(`ModuleNotFoundError: No module named 'md2wx.cli'`)。

原仓库许可证是 Personal Non-Commercial 1.2,不能直接内置进 MIT 分发;但该仓库是用户小号创建的,可以 fork、改许可证、随本仓库分发。用户明确要求先 fork,后续修改。

## 决策

| 事项 | 决策 |
| --- | --- |
| 引入方式 | fork `88lin/gzh-skill-kit` 到本仓库 `vendor/gzh-skill-kit`;保留原仓库署名与来源链接,新增 `NOTICE`;fork 后的代码跟随本仓库 MIT。 |
| 调用形态 | 在 fork 中补一个稳定 CLI:`render.py --input draft.md --theme <theme> --output out.html`(具体参数以实现为准),stdin/stdout 也可;输入 Markdown + 主题,输出一段可直接粘贴进公众号编辑器的内联 HTML。 |
| 依赖 | Python 3.13(本机可用);只用标准库与可选的 `requests`/`Pillow`;不引入 Node 侧新依赖,不要求联网。缺 Python 或依赖时预览降级,不阻塞编辑器。 |
| 进程边界 | host 用 `child_process.spawn` 调 Python,带超时(默认 20s)与输出上限;子进程失败只影响微信预览 tab,不影响作品保存/发布草稿。 |
| 缓存 | 按 `hash(theme + articleMarkdown + 版本)` 缓存生成结果,存在作品目录或 `~/.dsh/writing-desk/cache/`;正文或主题变化才重跑;不把生成 HTML 写进 `state.json`。 |
| 预览复用 | 作品编辑器的「微信预览」tab、发布包的微信 HTML、复制到公众号的 HTML 都来自同一个渲染函数与同一份缓存;不做第二套模板。 |
| 生成时机 | 按需:用户切到「微信预览」或点「生成发布包」时才生成;不在每次自动保存时跑 Python。 |
| 主题 | 先内置 fork 自带的主题组件库;主题选择按作品记录(可选),默认主题在设置里选。 |
| 失败降级 | Python 不可用/超时/主题不存在:显示普通 Markdown 预览与一行说明「微信排版不可用,已回退普通预览」;发布包仍可导出 Markdown,不阻塞发布确认。 |
| 许可证 | 本仓库根 `LICENSE` 仍为 MIT;`vendor/gzh-skill-kit/LICENSE` 改为 MIT 并保留原项目版权行;`NOTICE` 写明来源、fork 时间与修改。若上游作者不是用户本人,需重新取得授权——当前用户已确认是本人小号。 |
| 不内置 Agent | fork 只保留主题组件库与渲染 CLI,不把「Agent 读组件库手写」那套提示词/工作流塞进运行时;Agent 只作为开发期维护主题的手段。 |

## 不做

- 不把 Python 运行时打包进插件;用户环境需有 Python 3.13。
- 不接公众号 API、不做自动发布;排版只产出 HTML。
- 不做多主题实时切换的复杂编辑器;先支持主题选择与预览。
- 不复制原仓库的 Personal Non-Commercial 许可证文本进本仓库分发。

## 交互流程

1. 用户在作品编辑器点「微信预览」:host 取当前稿 Markdown + 作品主题,spawn Python 渲染;返回 HTML,右侧以 578px 宽容器显示。
2. 用户改正文后再次切到「微信预览」:哈希变化,重新生成;相同内容直接读缓存。
3. 用户点「生成发布包」:复用同一 HTML 写进发布包;扩展/本地助手按既有 outbox 投递。
4. Python 未安装:微信预览 tab 显示降级说明;普通预览与发布包导出仍可用。

## 验收场景

1. `vendor/gzh-skill-kit` 存在,`LICENSE` 为 MIT,`NOTICE` 有来源与 fork 说明。
2. CLI 对一篇样例 Markdown 与默认主题生成非空 HTML,含内联 `style` 属性,不含外部 CSS 链接。
3. 同一内容第二次生成命中缓存,不再启动 Python(可用日志/时间验证)。
4. 正文改动后重新生成,HTML 内容变化。
5. 删除/改名 Python 可执行文件:微信预览显示降级说明,编辑器保存/普通预览/导出 Markdown 不受影响。
6. 发布包中的微信 HTML 与预览 tab 的 HTML 字节一致。
7. `npm test` 不依赖 Python;新增的渲染测试用 mock 或跳过标记。

## 后果

- 仓库体积增加 vendor 主题库与 Python 脚本;npm 包需要把 `vendor/` 打进 files 白名单。
- 用户环境要求 Python 3.13;README/设置页说明。
- 原 `md2wx` 依赖不再使用;不修复本机损坏的 md2wx。
- 需要长期维护 fork 与上游差异;主题更新按需同步。

## 回滚

删除 `vendor/gzh-skill-kit` 与 host 的渲染调用即可回到纯 Markdown 预览;作品数据不受影响。