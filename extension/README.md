# DSwritesync

浏览器侧边栏应用 + 本地 CLI：把网页收进工作台灵感墙，把文章同步到各平台草稿箱。基于 Wechatsync v2（2.0.10）的 GPL-3.0 vendored fork；收进交互参考 StashDock（AGPL-3.0），未复制其代码。

## 侧边栏

- 顶部四标签:**收进 / 同步 / 账号 / 历史**;设置由齿轮进入,两个功能区共享同一设置页。
- **收进**:整页或选区 → 标题 / 正文 / 标签 / 封面;同 URL 冲突可保留或替换;本地服务未连接时复制 Markdown 兜底。
- **同步**:当前页文章或工作台下发的成稿 → 平台多选(带登录态) → 逐平台草稿 → 进度 / 结果 / 历史。
- **账号**:平台登录态与 CMS 自建站(WordPress / Typecho / MetaWeblog)。
- 页面内保留悬浮按钮、公众号文章页与公众号后台页的同步对话框;不再内置编辑器,编辑在 DSH 工作台完成。

## 构建与加载

```bash
cd extension
pnpm install
pnpm build:extension        # 产出 packages/extension/dist
```

Edge/Chrome → 扩展 → 开发者模式 → 加载解压缩的扩展 → 选 `packages/extension/dist/`。点工具栏图标打开侧边栏。

## CLI 与配对

```bash
pnpm --filter @wechatsync/cli build
node packages/cli/dist/index.js serve     # 或已安装的 dswritesync serve
```

`serve` 会:

- 在 `~/.dsh/writing-desk/bridge/auth.json` 写入一次性握手 token(0600);
- 起 WS `127.0.0.1:9527` 与回环 HTTP `127.0.0.1:9528`;
- 监听 `bridge/outbox/` 的工作台投递任务,把结果写回 `bridge/receipts/`。

把工作台设置页显示的 Token 粘进 DSwritesync 设置页,扩展即可连上。CLI 语言默认跟随系统,可用 `--lang zh|en` 或 `DSWRITESYNC_LANG` 覆盖。

命令面与上游对齐:`dswritesync sync <file> -p ...`、`platforms --auth`、`auth`、`extract`。

## 数据流

```
扩展收进 → desk.capture → CLI 写 inbox → 宿主落灵感 → 回执 → capture-result
宿主校样浮层 → outbox → CLI → syncArticle → 扩展逐平台草稿 → receipts → item.dispatches
```

`dispatches ≠ 已发布`;是否对外可见仍由用户在平台确认,扩展与 CLI 不写发布状态。

## 许可与上游

- 本目录是 Wechatsync v2（commit `1230678`,版本 2.0.10）的 vendored fork,按 **GPL-3.0** 发布;完整许可见 [`LICENSE`](LICENSE),上游基线与修改见 [`UPSTREAM.md`](UPSTREAM.md) 与 [`NOTICE`](NOTICE)。
- 主仓库其余部分仍为 MIT。
- StashDock 仅作视觉与交互参考,未复制其 AGPL 代码。
- 上游私有适配器子模块不在公开源码中;DSwritesync 自研的小红书页面自动化适配器位于 `packages/core/src/adapters/platforms/private/xiaohongshu.ts`(仅保存浏览器本地草稿,不点发布)。