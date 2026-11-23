# 本地助手:Native Messaging 自动配对取代 CLI 桥

Status: implemented(2026-11-19 grill 会话定案,2026-11-20 工单 #11 实现;取代 ADR 0010 的「CLI / 本地服务」实现路径。投递箱数据契约、ADR 0009 三条工作台联动与「dispatches ≠ 已发布」红线不变)

## 背景

- ADR 0010 的接入面是 `dswritesync serve` WS(127.0.0.1:9527)+ 握手 token:用户要额外安装并常驻启动 CLI,工作台设置页复制 token、扩展设置页粘贴——安装与日常使用各多一步,CLI 进程还引入端口占用、WS 保活、双实例争用等生命周期问题。
- StashDock 研究(docs/research/stashdock.md §3)的自动配对四件套:固定扩展 ID(manifest `key`)+ 插件加载时幂等注册 NM host(HKCU 注册表)+ `allowed_origins` 白名单 + 扩展侧 NM 优先发现;鉴权由浏览器内核强制,零 token。其 HTTP 兜底只是旧版兼容面,主力是 NM 短进程。
- NM 短进程 helper 让「DSH 关闭时收进仍成功落盘」——helper 原子写投递箱 inbox,宿主下次启动消化。StashDock 因此废弃了扩展端离线 pending 队列(library-client.js recoverPending 仅存历史):NM 直写即刻持久化,优于浏览器内排队等宿主复活再补交(浏览器重装/换机丢队列、冲突校验全部延迟)。**收进不强制 DSH 打开**是本决策的第一性收益。
- 备选「插件进程内起 loopback WS」(StashDock capture-bridge.mjs 先例)可省 CLI 进程但做不到离线收进(服务随 DSH 进程死),且引入端口/EADDRINUSE/WS 保活问题;NM 把这些全部卸掉,代价是推送延迟与 1MB 消息上限(均可缓解,见决策)。

## 决策

| 事项 | 决策 |
| --- | --- |
| 通道 | **NM-only**:扩展 ↔ 本地助手(短进程按请求 + 面板打开期间长端口),不保留任何 HTTP/WS 兜底通道;NM 不可用(注册漂移自愈窗口、缺 node、策略禁用)时走既有「复制 Markdown」降级。插件进程零网络面(DSH webServer 鉴权路由除外) |
| 固定扩展 ID | vendored manifest 增 `key`(RSA 一次性生成提交)——unpacked 无 key 时 ID 随加载路径漂移,白名单无从建立;扩展 ID 是配对的锚点 |
| NM host | 名 `app.dswritesync.plugin`;host manifest(name/path/type/allowed_origins)写盘与 HKCU 注册表写入由插件 apply() 时**进程内**完成(`reg add` 逐浏览器 vendor 键:Google\Chrome、Microsoft\Edge、Chromium、BraveSoftware 等,失败忽略、幂等重写)——StashDock 需要注册用 exe 是因其逻辑在 Rust,我们是 Node,直写更简;新 Chromium 分支(ego lite 等)补 vendor 键清单即可 |
| 本地助手(helper) | 顶层 `native/`:`helper.bat`(取 PATH 上的 node,缺失时输出错误 JSON 退出)+ `helper.mjs`(零依赖 node 内置模块:投递箱三向读写 + argv origin 白名单复核 + outbox 内容分片)。主仓库 MIT 自研;`BRIDGE_*` 消息面按协议事实对齐扩展侧 GPL 代码,不拷贝 |
| 消息上限 | host→Chrome 单消息 ≤1MB:任务下发拆「元数据列表 + 内容 ≤900KB 分片拉取」;Chrome→host 4GB,收进负载无压力。manifest 增 `nativeMessaging` 权限 |
| 推送语义 | 面板/对话框页打开期间 `connectNative` 长端口,helper `fs.watch` outbox(1s 轮询兜底)近实时推;SW 休眠期 chrome.alarms(30s 下限)一次性拉。投递即弹对话框的行为沿用 ADR 0010,延迟从即时变为最坏 30s |
| 离线收进 | 收进经 helper 原子写 inbox,即刻持久化;DSH 关闭时扩展提示「DSH 启动后出现在灵感墙」,不再降级为复制 Markdown(NM 不可用才降级) |
| 离线去重 | bridge 消化层按规范化 URL 去重(去 fragment/尾斜杠/`utm_*`/`fbclid`/`gclid`,规范化清单思想引自 StashDock,实现自研),只作用于收进来源 item;operationId 幂等与 `bridgeSeen` 不变 |
| CLI 退役 | 删 `packages/cli` 与 `dswritesync` 命令面;`src/publish.js` 不再生成命令字符串,校样浮层删「复制命令」兜底;终端场景由扩展手动同步覆盖 |
| 设置页 | 工作台设置页 token 区块改为「配对状态 + 安装浏览器扩展指引」;扩展设置页删 token 存储/粘贴,改 NM 连接状态(已配对/未配对 + last error) |
| 许可 | 注册器与 helper 主仓库 MIT 自研;扩展侧 NM 客户端改造在 GPL vendored 树内进行,无传染;`UPSTREAM.md` 记录「桥从 CLI 平移为 NM,消息面对齐不拷贝」 |

## 不做

- 不做 HTTP/WS 兜底通道、不做扩展端离线 pending 队列(StashDock 已验证其劣于 NM 直写)。
- 不做注册用可执行文件(注册在插件进程内完成);不做 Firefox/Safari 变体(v1 Chromium 系;host manifest 生成器留 `allowed_extensions` 口)。
- 不做 macOS/Linux helper(v1 Windows `.bat`;平台扩展留口)。
- 不让扩展持有宿主凭证;不动投递箱契约与「dispatches ≠ 已发布」红线。

## 验收场景

1. 插件已装、DSH 启动:HKCU 出现各 vendor 的 `app.dswritesync.plugin` 键指向 host manifest;开发者模式加载带 key 的扩展后,扩展 NM 状态「已配对」,全程零 token 零粘贴。
2. DSH 关闭时收进:收进成功落 inbox,扩展提示「DSH 启动后出现在灵感墙」;启动 DSH 后灵感墙出现卡片,同 URL 重复收进消化后不产生第二张卡。
3. DSH 开启时收进:灵感墙秒级出现卡片(既有惰性消化 + 轻轮询不变)。
4. 校样浮层「投递到浏览器」:面板开着时秒级弹出对话框;面板未开时 ≤30s 内弹出;逐平台到草稿箱,回执落 `item.dispatches`,status 纹丝不动。
5. 大文章(含多图)投递:分片拉取完整还原,单分片失败重试,不静默截断。
6. DSH 换安装路径后启动一次:注册自愈,扩展无需重装。
7. 双宿主进程(桌面+网页)并发:文件协议原子 rename 认领 + operationId 幂等,无重复卡片、无重复投递。
8. helper 缺 node / NM 被策略禁用:扩展显示明确错误与「复制 Markdown」降级,不丢内容。
9. 全仓库测试全绿;ego lite / Edge 真机走查 1-8。

## 后果

- 用户面:安装清单收敛为「DSH 插件(既有)+ 浏览器扩展」两件;收进不再强制 DSH 开着;投递延迟最坏 30s(面板开着则秒级)。
- 接入面:WS 端口、token、auth.json、EADDRINUSE、WS 保活等概念全部消失;配对锚点 = 扩展 ID + NM 注册表;威胁模型收敛到「本机用户权限进程可信」(与投递箱先例一致,且 NM 调用方校验有浏览器内核背书)。
- NM 调试不透明:helper 写环形日志到 bridge 目录,连接状态带 last error。
- helper 依赖 PATH 上的 node(DSH CLI 用户天然满足);缺 node 诚实报错。
- 平台改版注册表 vendor 键需随 Chromium 分支扩充;注册器单浏览器失败不影响其余浏览器。

## 代码影响

- 主仓库:新增顶层 `native/`(helper.bat/helper.mjs;npm 包只收录这两个文件,运行时生成的 NM manifest 不进包);`src/` 增 NM 注册器与消化层 URL 去重;设置页桥接区块改配对状态;`src/publish.js` 删命令字符串。
- extension/(GPL vendored):manifest 增 `key` 与 `nativeMessaging`;`src/bridge` WS 客户端换 NM 客户端(长端口 + 短请求 + 分片);删 token 存储与粘贴 UI;删 `packages/cli`。
- 文档:README/README.en 删 CLI 章节;ADR 0009/0010 状态标注;GLOSSARY 更新。

## 回滚

git 历史回退;投递箱契约与 state.json 不变,回滚只需换回 CLI 桥与旧扩展;注册表残留键无害(helper 路径失效时扩展显示未连接)。
