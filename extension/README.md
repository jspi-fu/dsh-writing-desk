# 图文创作台 · 网页收发(浏览器扩展)

图文创作台的浏览器侧窗口(ADR 0009):**收**——任意网页一键收进灵感墙;
**发**——成稿一键投递到公众号、知乎、掘金的草稿箱。

- 采集:side panel 预览(标题/正文/标签可编辑,封面自动取 og:image 或截屏),
  交互形态参考 StashDock(dirty 守卫、冲突对话框、截断提示),实现为原创。
- 发布:平台适配器在 service worker 里用浏览器 Cookie 调各平台 Web 编辑器同款接口,
  只建草稿;Origin/Referer 经 declarativeNetRequest 动态规则补齐,`initiatorDomains`
  只允许本扩展。端点事实参考 Wechatsync 的公开适配器与 [docs/research/wechatsync.md](../docs/research/wechatsync.md),
  代码为本项目原创(上游 GPL-3.0,本项目 MIT)。
- 通信:只连本机 `ws://127.0.0.1:4527` 的 wdesk 桥(一次性握手 token),
  不持有也不接触 DeepSeek Harness 宿主的任何凭证。
- 小红书适配器立项二期(上游 private submodule 未公开,需自研反爬签名)。

## 安装(开发者模式)

1. `npm install && npm run build`(本目录内);
2. Edge/Chrome → 扩展 → 开发者模式 → 「加载解压缩的扩展」→ 选 `extension/dist/`;
3. 终端跑 `wdesk serve`(见 [cli/](../cli/)),把工作台设置页的 Token 粘进扩展设置;
4. 任意网页点扩展图标 → side panel 预览 → 「收进书桌」。

## 结构

```
src/background/   service worker:采集编排、发布任务、桥接客户端
src/capture/      页面采集(Readability + DOM 遍历,Apache-2.0 库随包分发声明见 NOTICE)
src/background/adapters/  weixin / zhihu / juejin 适配器
src/panel/        采集侧栏 UI
src/dialog/       发布进度对话框
src/options/      Token 配对设置页
static/           页面壳与样式(令牌镜像 DESIGN.md,暗色随 prefers-color-scheme)
```

## 许可

MIT(随主仓库)。第三方依赖:`@mozilla/readability`(Apache-2.0)、`marked`(MIT)。
设计参考 Wechatsync(GPL-3.0)/StashDock(AGPL-3.0),未复制其代码。
