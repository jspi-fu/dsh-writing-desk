<h1 align="center">图文创作台</h1>

<p align="center"><b>DeepSeek Harness 的一个插件。记一句灵感，拖进创作会话写成图文，在书桌这边改稿、排期、拿走发布。</b></p>

<p align="center">
  <a href="#三步上手">安装</a> ·
  <a href="#要花钱吗">要花钱吗</a> ·
  <a href="#问答">问答</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <img alt="DeepSeek Harness 0.2.2" src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.2-111?style=flat-square">
  <img alt="Mac 桌面版与网页版" src="https://img.shields.io/badge/Mac%20%E6%A1%8C%E9%9D%A2%E7%89%88-%E7%BD%91%E9%A1%B5%E7%89%88-111?style=flat-square">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/MIT-%E5%BC%80%E6%BA%90-111?style=flat-square"></a>
  <a href="https://github.com/jspi-fu/dsh-writing-desk/stargazers"><img alt="Star" src="https://img.shields.io/github/stars/jspi-fu/dsh-writing-desk?style=flat-square&color=111&label=Star"></a>
</p>

<br>

## 它是什么

装在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 侧栏里的一个页面。打开是一面灵感墙，一句话记一个灵感；同一线索的几张卡收进胶囊，整堆拖进旁边的对话，创作会话就按你的风格写成图文。写回来的稿子进作品编辑器：左边改，右边按平台形态实时预览，自动保存；排上日历，复制或存成文件夹去发布。

四个页面：**灵感 · 内容 · 排期 · 风格**。界面有中文和英文，默认跟随 DeepSeek Harness 的语言，也可以在插件设置里固定；切到英文后，正文和标题也用英文写。网页版在手机浏览器里也能打开。

以**小红书、公众号、知乎**为主，其他图文平台通用。

写稿这件事发生在 DSH 创作会话里：生成用你在 DeepSeek Harness 里配好的模型，写作规则与图文写作法以 Skill 的形式实时供给会话。工作台自己不做任何模型调用，只管数据、看板和人工介入。

<br>

## 创作会话

**拖进去，就开工。** 把灵感卡或胶囊拖到对话输入框下方的接驳条，素材引用就填进输入框——补一句「写成小红书笔记，口语一点」，回车。不拖也行：点卡片黑胶囊「创作」直接开一个创作会话，素材以同款引用签落在输入框；或用小箭头菜单「添加到当前会话」「复制给 AI」。

**意图先行。** 会话先把素材提炼成一张意图单（发布目的、受众、一句话核心判断、必须保留的原文、明确不做……），你确认了才动笔。写完先审读——只报告问题，不改稿；你说改哪里，它才润色。

**写回只有当前稿。** 会话把标题、正文、配图和审读报告写回作品，工作台只存当前稿与发布稿，不再堆版本快照。你手动改过之后，会话拿着旧版本再写会被挡下——回作品编辑器选「用最新的」或「用我的覆盖」。

**作品编辑器改稿。** 内容页点开作品，左边大纲/正文，右边 Markdown 实时渲染，可切小红书、公众号、知乎三种平台宽度（近似预览）。标题、封面文案、正文随改随存；底部复制正文、保存文件夹、导出发布包、投递草稿箱。

**规则会自己长。** 会话从你的改稿方向里看出偏好，提炼成规则提案；你在风格页点「启用」，之后每篇都遵守。

<br>

## 灵感墙

**一句话，一个灵感。** 文字、链接、图片、视频、文件，贴进来就是一张卡片：16:9 封面、两行标题、站点行，整卡点开就是编辑。笔记、链接、文件三个页签共用一个导入弹层，链接会自动读标题/简介/封面，文件一次最多 10 个。

**先找得到，再动手。** 顶部搜索 + 排序（最近添加 / 最早添加 / 按标题），底部直接切分类（全部 / 笔记 / 文件 / 链接）；标签收进 dockbar 上方的小列，单选过滤，还能改名或删掉标签本身。

**同一条线索，收进一个胶囊。** 勾几张小卡就能合成胶囊：墙上是 2×2 成员封面 + 张数，可以多选、解散、继续加成员，但没有编辑入口——它只是灵感的集合。整墙支持勾选、框选，也多选后一起「添加到当前会话」「进入创作」。

**旧数据一键搬过来。** 设置里有「从自媒体工作台迁移」：预览条数后一键导入灵感、排期和媒体文件，按名字合并角度与读者，不满意可以撤销。

<br>

## 排期

**一张日历，两件事。** 每天一张灵感邮票，记录你的连续天数；灵感或整张胶囊从右边拖到某一天，就到点提醒你处理。已排期的拖回待排期托盘即撤排期。右上角永远是下一条排期。

<br>

## 风格

**按谁的风格写，你定。** 科技数码、旅行探店、Vlog 生活、观点认知、干货教程、种草测评、情感故事、热点资讯，8 个板块 15 种博主预设，选一种就能开写。

**也可以是你自己的。** 贴几篇你写过的稿子（或它们链接），创作会话提炼成专属风格卡，随时改。

**也可以直接从作品学。** 在风格页或作品编辑器里选 1–6 篇已经写过的作品，工作台会读它们登记过的创作对话，连同发布稿（以及发布后未发布的改动）一起交给新的风格会话；它只写候选规则和候选风格卡，你逐条确认后才生效。哪篇没读到对话会明确标出来，只用发布稿判断。

写作规则集中在风格页管理：会话提案、你确认；确认过的规则实时进创作会话，也能导出成 DeepSeek Harness 的 Skill。

内容页默认是「我的作品」画廊：每篇作品按草稿 / 已投递 / 已发布排好，点开就是作品编辑器；切到「流程」看板能看到每篇从成稿到发布的进度。被作品用过的素材自动收进灵感墙的「已用」分组，不再占待排期。

<br>

## 三步上手

要求 DeepSeek Harness `0.2.2-rc.2` 及以上的 `0.2.x`，已在 `0.2.2-rc.3` 的桌面版上验证。拖拽进对话、一键开会话这些能力按宿主版本自动启用；旧宿主上插件退化为纯看板。

**1. 安装。** 打开 DeepSeek Harness 侧栏的「插件」，先打开实验性的索引功能：DSH `0.2.2` 及以上在「实验性插件」下启用「自定义插件索引」；`0.2.1` 系列里它叫「自定义插件市场」，在「实验性插件」旁的「更多」里。打开后页面会多出「已安装」和「发现」两个标签。

切到「发现」，添加这条索引地址（加一次就够）：

```
https://raw.githubusercontent.com/jspi-fu/dsh-writing-desk/main/index.json
```

GitHub 直连不通时，换成这个 CDN 镜像，代价是它最多可能比最新发布晚 12 小时：

```
https://cdn.jsdelivr.net/gh/jspi-fu/dsh-writing-desk@main/index.json
```

列表里会出现「图文创作台」，点安装即可。它装的就是同一个 npm 包 `dsh-writing-desk`，索引只是省掉手输包名这一步。

不想加索引，也可以在「插件」→「添加插件」里输入包名 `dsh-writing-desk` 点安装，或者用命令行。桌面版要先完全退出（⌘Q）再装，装好重新打开；网页版装好后重启 `dsh web`。终端里没有 `dsh` 的话，先在桌面版菜单里选「管理 dsh 命令」。

```bash
dsh plugin --profile desktop add dsh-writing-desk
```

```bash
dsh plugin --profile web add dsh-writing-desk
```

**2. 更新。** 有新版本时，插件页会显示可更新，点一下就行；用命令行装的重跑一次上面的命令。工作台自己也会查 npm 上的最新版本（每小时最多一次，只读版本号）：有新版本时顶栏出现 `↑ v新版本号` 的小提示，设置底部能看到当前版本，点提示去 npm 页面看升级命令。想离线安装的话，也可以到 [Releases](https://github.com/jspi-fu/dsh-writing-desk/releases/latest) 下载 `dsh-writing-desk-*.tgz`，把包名换成 `"file:$PWD/dsh-writing-desk-版本号.tgz"`。

**3. 打开。** 右侧栏会出现「图文创作台」。第一次看到的都是示例数据，方便你先看看每个页面长什么样；点右上角「示例数据 · 清空」，换成自己的。

卸载时把 `add` 换成 `remove dsh-writing-desk`。你的内容一直在 `~/.dsh/writing-desk/`，不会跟着删。

<br>

## 要花钱吗

插件本身免费开源，不带任何密钥。用到模型的地方，走你在 DeepSeek Harness 里配好的账号。

| | 用什么 | 说明 |
| --- | --- | --- |
| **写正文** | DeepSeek Harness 里你已经配好的模型 | 在创作会话里完成，按你自己的账户计费 |
| **画封面首图、配图** | DSH 里可用的生图工具（如订阅生图） | 由会话在写作过程中调用；没配生图时正文照常，封面用纯文字版 |

<br>

## 问答

<details>
<summary><b>能直接发布吗？</b></summary>
<br>

能发到<b>草稿箱</b>。装上 <a href="extension/">DSwritesync</a> 浏览器扩展即可：扩展与图文创作台经 Native Messaging 自动配对（插件在 DSH 启动时注册本地助手，零 token、零粘贴、零端口），作品编辑器一键把成稿投递到 20 个平台的草稿箱（公众号、知乎、掘金、微博、B 站、豆瓣、百家号、搜狐号、CSDN、思否、语雀、雪球、人人都是产品经理、51CTO、慕课手记、开源中国、博客园、东方财富、阿里云开发者社区、小红书；多数平台用你自己的登录态走官方 Web 接口，小红书走页面自动化，正文与图片由扩展转存）。各平台没有统一的正式发布接口，草稿到你确认后才算发布；小红书只保存到浏览器本地草稿箱，扩展不会点发布。

DSwritesync 侧栏有「收录」（整页或选区一键收进灵感墙；DSH 没开着也照收，启动后自动出现在灵感墙）与「投递」（把工作台下发的成稿送到所选平台草稿箱，含 WordPress 等自建站）；两者共用同一个设置页。收录与投递执行是扩展的全部职责，它不再单独提供「同步当前网页」。

没有浏览器扩展时，照旧复制正文或保存文件夹：默认在 `~/Documents/图文创作台/`，里面有图文正文、封面首图和配图。

</details>

<details>
<summary><b>我的东西存在哪？</b></summary>
<br>

全在本机 `~/.dsh/writing-desk/`，桌面版和网页版共用。没有云端，没有账号系统。

</details>

<details>
<summary><b>没有生图模型也能用吗？</b></summary>
<br>

能。正文和标题照常，封面用封面大字合成一张纯文字版。会话侧接上生图工具后，封面首图和配图都会画出来。

</details>

<details>
<summary><b>工作台里有对话助手吗？</b></summary>
<br>

工作台本身没有。成稿在 DeepSeek Harness 的创作会话里进行——那是 DSH 自己的会话，不是工作台内置的助手。工作台把素材、规则、产物在会话和工作台之间搬来搬去，写作由 DSH 配好的模型完成。

</details>

<details>
<summary><b>这是 DeepSeek 做的吗？</b></summary>
<br>

不是，是社区插件。正文由你在 DeepSeek Harness 里配置的模型生成，按你自己的账户计费。

</details>

<br>

## 开发

```bash
npm install && npm test        # Host 逻辑测试
npm run watch                  # 监听 client/ 并重新打包
npm run index                  # 发布后更新 index.json 的版本和发布时间
cd extension && pnpm install && pnpm build:extension  # 构建 DSwritesync 扩展
scripts/dev-sandbox.sh         # 在隔离的 DSH_HOME 里跑网页版，不碰 ~/.dsh
npm pack                       # 打出可安装的 tgz
```

`index.json` 是插件市场索引，`npm run index` 会按 npm 上的最新发布刷新里面的版本号和发布时间，所以每次发版后跑一次，索引里才是新版本。

| 目录 | 内容 |
| --- | --- |
| `client/` | 界面：灵感墙、作品页、排期、风格、作品编辑器、素材接驳条 |
| `src/` | Host 接口、状态机、harness 工具与 skill、本地存储、桥接投递箱 |
| `extension/` | DSwritesync：Wechatsync 2.0.10 的 GPL-3.0 vendored fork + StashDock 式收录侧栏（在 `extension/packages/extension`） |
| `native/` | 本地助手（helper.bat/helper.mjs）与 NM 注册器：浏览器扩展经 Native Messaging 与投递箱交换数据，主仓库 MIT 自研 |
| `scripts/` | 打包、沙盒、示例素材生成、插件市场索引 |
| `assets/` | 示例图片和视频，由 `scripts/gen-assets.py` 程序绘制（logo 为手工设计，存档见 `docs/logo-final/`） |

扩展不进 npm 插件包；`npm pack` 的产物是插件本体加 `native/` 本地助手。扩展接入面(Native Messaging 自动配对)见 [ADR 0012](docs/adr/0012-bridge-native-messaging.md)（Native Messaging 自动配对，CLI/token 已退役；投递箱数据契约仍循 ADR 0009/0010），参考项目的研究笔记在 [docs/research/](docs/research/)。`extension/` 按 GPL-3.0 发布，仓库其余部分仍 MIT。

改了 `src/` 要重启 DeepSeek Harness。

**安全：** 每个接口都经过 Host 鉴权；模型输出和读到的外部内容只取固定字段、限制长度，操作走白名单；粘贴的链接不能访问本机和内网。漏洞请走 [Security Advisories](https://github.com/jspi-fu/dsh-writing-desk/security/advisories/new) 私下报告。

<br>

## 致谢

本项目由社区插件 `dsh-media-desk`（自媒体工作台）二次开发而来，感谢原作者 [蜗牛的科技笔记](https://www.xiaohongshu.com/user/profile/5faedce8000000000101c8a3) 及下列朋友当年认真试用、排查和贡献代码：

- [secountAiAccount](https://github.com/secountAiAccount)
- [isxiaokunos](https://github.com/isxiaokunos)
- [townmi（Harry Tang）](https://github.com/townmi)
- [zach22-1999](https://github.com/zach22-1999)
- [chenxupeng1999-eng](https://github.com/chenxupeng1999-eng)
- [dsh-agent-sixtyseven](https://github.com/dsh-agent-sixtyseven)
- [smallflycar](https://github.com/smallflycar)
- [cofftea114](https://github.com/cofftea114)
- [Feahter](https://github.com/Feahter)
- [TerryWang9112（Terry）](https://github.com/TerryWang9112)
- [ytzhangFTD（小虾米）](https://github.com/ytzhangFTD)
- [giuliano1101](https://github.com/giuliano1101)
- [wmaly13](https://github.com/wmaly13)

也感谢 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 团队提供了开放的插件系统。

浏览器扩展 [DSwritesync](extension/) 基于 [Wechatsync](https://github.com/wechatsync/Wechatsync) v2（GPL-3.0）源码二次开发，收录侧栏的交互与视觉参考了 StashDock（AGPL-3.0，仅借鉴未复制代码）；两者 upstream 的贡献者同样值得致谢。

<p align="center"><sub><a href="LICENSE">MIT</a> · 社区插件，与 DeepSeek 无关。DeepSeek Harness 的名称和标识归其所有者所有。</sub></p>
