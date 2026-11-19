# wdesk——图文创作台的本地桥与命令行

`cli/` 是为图文创作台二次开发的本地桥(常驻进程)与命令行。设计心智来自
[Wechatsync](https://github.com/wechatsync/Wechatsync) 的 CLI(sync/platforms/extract 命令面
与「扩展主动外连 WebSocket」的桥形态),协议与实现全部为本项目重写,未复制上游代码
(上游 GPL-3.0,本项目 MIT;端点与协议是事实,代码是原创)。

## 它做什么

- **导出**:监听工作台的发布任务(`~/.dsh/writing-desk/bridge/outbox/`),把成稿正文与图片
  经本地 WebSocket 下发给[浏览器扩展](../extension/),扩展用你自己的登录态调平台 Web API,
  **只到草稿箱**;逐平台结果写回执(`receipts/dispatch-*.json`),由工作台宿主消化成
  `item.dispatches`。是否已发布始终由用户确认。
- **导入**:接收扩展的网页采集,写进投递箱(`inbox/`),工作台宿主消化成灵感墙卡片。

## 命令

```bash
wdesk serve                 # 起桥(常驻);Token 首次自动生成,写入 ~/.dsh/writing-desk/bridge/auth.json
wdesk sync <file> -p zhihu,juejin [--title] [--cover] [--dry-run]
wdesk platforms [--auth]    # 列平台与登录状态(经扩展)
wdesk extract -o out.md     # 让扩展提取浏览器当前页正文
```

端口默认 WS 4527 / HTTP 4528(`WDESK_WS_PORT` / `WDESK_HTTP_PORT` 可覆盖)。

## 配对

1. 工作台「设置 → 浏览器扩展(网页收发)」复制 Token(桥起过一次后才有);
2. 扩展设置页粘贴 Token 保存;
3. `wdesk serve` 起桥,扩展几秒内自动连上。

## 发布

`npm pack`(在 cli/ 内)或直接以本目录为入口运行;不进插件 npm 包的发布物。
