---
name: 图文创作台（dsh-writing-desk）
description: DeepSeek Harness 插件——一句话记灵感，一键做出图文正文、标题、封面与配图。
colors:
  ink: "#1f2329"
  ink-secondary: "#4e5560"
  ink-tertiary: "#86909c"
  ink-caption: "#a9b0b8"
  on-primary: "#ffffff"
  primary: "#17181c"
  primary-hover: "#2a2c33"
  bg-base: "#f4f5f7"
  card: "#ffffff"
  accent: "#6b5cff"
  status-outline: "#d39a2c"
  status-draft: "#4176e6"
  status-submitted: "#8a5fe0"
  status-published: "#2fa36c"
  danger: "#d13c35"
  tone-warm: "#f6e2d5"
  tone-blue: "#dfe7fb"
  tone-green: "#dcf0df"
  tone-pink: "#f6dfe9"
  tone-sand: "#efe9cf"
  tone-violet: "#e6dff7"
typography:
  display:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "30px"
    fontWeight: 300
    lineHeight: "40px"
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "34px"
    fontWeight: 300
    lineHeight: "44px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
  body:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "22px"
  label:
    fontFamily: "var(--dsw-font-family)"
    fontSize: "11.5px"
    fontWeight: 400
    lineHeight: "16px"
  serif:
    fontFamily: "\"Songti SC\", \"STSong\", \"Noto Serif SC\", \"Source Han Serif SC\", Georgia, serif"
    fontSize: "20px"
    fontWeight: 500
    lineHeight: "30px"
  latin-serif:
    fontFamily: "\"Iowan Old Style\", \"Palatino\", Georgia, \"Songti SC\", serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: "28px"
rounded:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  tile: "26px"
  media: "18px"
  panel: "28px"
  capture: "34px"
  round: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-ghost:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-tertiary}"
    rounded: "{rounded.md}"
    height: "30px"
  chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.tile}"
  capsule-card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.tile}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
  dialog:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.capture}"
---

# Design System: 图文创作台（dsh-writing-desk）

## Overview

**Creative North Star: 「书桌上的编辑部」**

整个系统是一张安静的书桌。内容永远放在「纸」上——白底、柔影、小圆角的面板；玻璃只做桌面陈设——顶栏导航、底部 dock、悬浮工具条这些「桌面本身」的物件；文字的仪式感交给衬线体——金句、稿面标题、题词票。它是一份给个人创作者的编辑工具：先收集灵感（灵感墙上的卡片与胶囊），再把它们写成一篇图文（稿面），最后排期发布（日历上的小邮票）。

密度中等偏高但呼吸从容：卡片之间 10–16px 的间隙、面板内 14–20px 的内边距、一级标题用 300 细体大字号拉开层级。动效克制而「活」：入场一律 `translateY(8px) + fade` 上浮，悬停是 1–3px 的抬起，弹性曲线 `cubic-bezier(.2, 1.3, .4, 1)` 只给拖拽与弹层。明暗主题由宿主（DSH）切换，本系统全部颜色经语义别名取用，不持私有色。

**Key Characteristics:**
- 纸面承载内容，玻璃只做 chrome（桌面陈设）
- 衬线双声部：宋体给中文的仪式感，Iowan/Palatino 给数字的编辑味
- 状态色是全系统唯一的高饱和色，成稿进度一目了然
- 邮票是纪念母题：齿孔遮罩、4:5 票面、色纸衬线首字（只留给内容页与日历）
- 一切缩略重排字号，绝不整体缩放（No-Scale Rule）

## Colors

调色板由宿主 DSH 的语义别名提供，本插件不自造颜色；状态色与氛围渐变是仅有的本地常量。下表为浅色主题参考值，规范来源永远是 `--dsw-alias-*`。

### Primary
- **墨黑 Primary**（`--primary` → `var(--dsw-alias-button-primary-fill)`，参考 `#17181c`）：主按钮、当前导航项、置顶卡反白底、toast 底、日历「今天」。黑而非品牌色——工具本身不抢戏。
- **强调 Accent**（`--accent` → `var(--dsw-alias-link)`，参考 `#6b5cff`）：链接、折线图、拖拽选中描边、框选矩形。只在「可点」与「数据」上出现。

### Status（唯一的高饱和色系）
- **构思 Outline**（`#d39a2c` 琥珀）：素材还是一句原话。
- **草稿 Draft**（`#4176e6` 蓝）：作品已创建、还没投递或发布。
- **已投递 Submitted**（`#8a5fe0` 紫）：已送进平台草稿箱，不等同已发布。
- **已发布 Published**（`#2fa36c` 绿）：用户确认发布；同时给作品卡反白（`is-inverted`）。
- **危险**（`#d13c35`）：解散、移出等破坏性菜单与按钮。
- 状态一律「7px 圆点」或「12px 圆角小徽章」出现，永远配 `STATUS_LABEL` 文案。状态色只属于内容栏目的作品卡与日历；灵感卡、胶囊卡不加状态色。

### Neutral
- **纸白 Card**（`--card` → `var(--dsw-alias-bg-layer-2)`，参考 `#ffffff`）：一切内容面板、卡片、对话框。
- **底色 BG**（`--bg` → `var(--dsw-alias-bg-base)`，参考 `#f4f5f7`）：画布底；工作区页面在底色上再混 3.5% 墨色（`color-mix(in srgb, var(--ink) 3.5%, var(--bg))`）做出「桌面垫」。
- **文字四级**（`--ink`/`--ink2`/`--ink3`/`--ink4`，参考 `#1f2329 / #4e5560 / #86909c / #a9b0b8`）：正文 / 次要 / 说明与占位 / 行号等最弱信息。
- **线**（`--line` / `--line-strong`，参考 `rgb(0 0 0 / .08 / .14)`）：一律 .5px 发丝线，不用 1px 实线框。
- **悬停/按下**（`--hover` / `--active`，参考 `rgb(0 0 0 / .05 / .09)`）：行悬停、分段控件底。

### Named Rules
**宿主令牌至上。** 任何新颜色先问 `--dsw-alias-*` 有没有对应位；本地常量只允许「状态色、色纸 tone、氛围渐变」三张白名单。明暗主题由宿主负责，写死色值等于只支持一半用户。

**色纸 Tone Rule。** 文字类内容的「底图」从六张色纸里轮转（`tone-0..5`：暖橙/雾蓝/豆绿/樱粉/麦黄/雪青），同一容器内不重复相邻，替代任何插画装饰。

## Typography

**Display/Body Font:** 宿主无衬线（`--dsw-font-family`）
**Serif Font:** 宋体系（`--serif`: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif）
**Numeral Font:** 衬线拉丁（`--latin-serif`: "Iowan Old Style", "Palatino", Georgia, serif）
**Works Display Fonts:** 沿用系统宋体系与 Iowan/Palatino 拉丁衬线，不装载独立字体文件。

**Character:** 操作界面文字走宿主无衬线，保持工具的安静；衬线主要出现在「被创作的内容」上——金句卡、稿面标题、风格引文、封面题字——像印刷品贴在界面上。作品页是唯一按 Experience 处理的展示例外：刊名、作品题名、封面题字与期刊数字沿用系统的 **宋体系 + Iowan/Palatino**，以字级、留白和目录结构而非额外字体下载形成杂志感；其余控件、正文与元信息仍用宿主无衬线。数字是另一个声部：统计大数用衬线拉丁（常常斜体、`tabular-nums`），让数据带一点杂志排版的味道。

### Hierarchy
- **Display**（300，30px/40px）：页面与弹层页题；移动端降到 24px/34px。
- **Headline**（300，34px/44px）：普通页面页题；稿面文章题则用衬线 22–24px/600。
- **Title**（500–600，13–15px）：面板标题、卡片标题、看板列头。
- **Body**（400，14px/22px；prose 14.5px/26px，稿面阅读态 16px/30px）：界面正文与文章。
- **Label**（400，11–12.5px，`--ink3`）：页脚、来源、时间、行号；数字用 `font-variant-numeric: tabular-nums`。

### Named Rules
**衬线只给内容与作品展示的仪式感。** 按钮文案、表单、导航、面包屑永远无衬线；金句、稿面标题、题字、统计大数，以及作品页的刊名与作品题名才允许衬线。展示字体只在 `.md-works-page` 内生效，不能向排期、设置等 Operate 页面扩散。

**The No-Scale Rule.** 任何缩略场景（时间轴缩略图、胶囊浮层、看板缩略图）都按容器宽度**重排**文字到真实字号（≥11px），禁止 `transform: scale` 缩小整卡——缩出来的字等于没有字（ADR 0004 的教训）。窄屏不靠缩放硬塞：胶囊浮层头部在 ≤820px 收成图标（保留 `aria-label` 与 `title`），翻页在 ≤660px 移到面板底部，成员仍保持两列。

## Layout

侧栏工具，挂载在 DSH 宿主框架内，自身是一个 `md-root` 容器（`container: md-root / inline-size`）。

- **灵感墙**：单列滚动区。顶部 sticky 一行 = 搜索框 + 排序方钮（36px）；其下是时间轴；再下是网格 `repeat(auto-fill, minmax(232px, 1fr))`、gap 16px。搜索、缩略图、网格与空态共享 `width: min(1180px, 100%)` 的居中列（ADR 0007）；宽屏留白在两侧，侧栏宽度不足时自然占满。
- **全屏内容尺度**：顶栏仍贯通窗口，普通功能内容不强行铺满显示器。作品页卷首、主打、目录与输入条沿 1180px 中轴居中；排期与风格页内容沿 1240px 中轴居中。居中只约束内容列，不重排编辑器，不用整体缩放。
- **时间轴**：一行横滚的缩略图，48×36、15px 圆角，只分「本周」与「之后」两段——两段之间一条 2×18px 墨色短竖杠，竖排「本周」（10.5px）贴在靠左/居中那一侧；可左右滑，滑到端点时该侧渐隐提示消失，悬停浮现左右箭头（触摸设备不显示、端点侧变灰禁用、箭头被指着时不突然消失）；键盘左右键切换焦点并把它滚到半屏正中，滚动区两端留出箭头不吃内容的余量。行末只一个纯数字（灵感 + 胶囊总数，胶囊成员不重复计）。
- **底部 dockbar**：分类 chips（全部 / 笔记 / 文件 / 链接）+ 标签按钮 + 新建圆钮，悬浮于底部中央，是墙面唯一的固定 chrome。
- **普通页面**：内边距 `78px 28px 40px`，内容自适应；面板卡片化。
- **工作区（成稿）**：bento 网格 `1.04fr / 1fr`，区域 `idea / hero / article / shots`；`@container` 断点 1040px（分镜 3 列）、620px（hero 折叠单列）、760px（工作区单列）。
- **移动端**：`@container md-root (max-width: 560px)` 顶栏收纳、墙面降到两列、隐藏计数与次要按钮。
- **节奏**：间隙 4 / 8 / 10 / 12 / 16px 一档一档来；标题的上方留白大于下方（`margin: 22px 0 8px` 这类）。

## Elevation & Depth

「桌面」有三层：底色 → 纸面 → 悬浮 chrome。深度主要由柔影承担，一律带 offset 与 blur，禁止零偏移彩色光晕。

### Shadow Vocabulary
- **`--dsw-elevation-soft`**（宿主令牌）：卡片、面板、输入条、小浮层的常驻影。
- **`--dsw-elevation-prominent`**（宿主令牌）：dockbar、对话框、菜单、toast、大图查看器。
- **本地深影**（如 `0 16px 36px -14px rgb(0 0 0 / .16)`、`0 30px 90px -30px rgb(0 0 0 / .45)`）：大浮层与相册卡的外层空间感，负 spread 收边。
- **发丝线描边**（`.5px solid` / `inset 0 0 0 .5px`）：不承担深度，只承担边界。
- **遮罩模糊**：弹层背景 `blur(18–20px) saturate(125–140%)` + 18% 底色，内容浮层永远可读；吸附的搜索条同一套玻璃，`blur(24px)` + 86% 底色，滚上来的卡片只能透出形状、透不出字。

### Named Rules
**玻璃只做桌面陈设。** `backdrop-filter` 只允许出现在 chrome 层：顶栏导航、吸附的墙面搜索条、dockbar、多选工具条、查找条、版本 pill。内容面板（卡片、对话框、作品页、稿面）一律实心纸白——纸不透明。

## Shapes

圆角阶梯：4（行内小件）→ 8（按钮小件/分段内格）→ 12（按钮、输入框、菜单）→ 16（列表卡、图板、缩略图）→ 20（面板）→ 26（灵感卡）→ 28（浮层）→ 34（新建与编辑对话框）；灵感卡里的 16:9 封面是 18px。真圆（圆钮、圆点、头像）一律 `border-radius: 50%` 且配 `corner-shape: round`。

边界语言：`.5px` 发丝线是默认边；`inset 0 0 0 .5px` 是玻璃件的替代边；虚线（`1px dashed`）只表示「可以放下东西来」（dropzone、风格添加卡）。邮票是唯一的异形：`radial-gradient` 齿孔遮罩打出锯齿边（`--s: 9px; --hole: 2.4px`），且因为 mask 会吃掉 box-shadow，阴影必须走 `filter: drop-shadow`。

## Components

### 按钮（md-btn）
- **Shape:** 12px 圆角、36px 高、13px 字；`is-small` 28px/12px。
- **Primary:** 墨黑底白字；hover 换 `--primary-hover`；active `scale(.97)`；danger 红字 + 40% 红描边。
- **圆钮（md-round 40px）：** 唯一的主行动圆钮（dockbar 里的「记下灵感」），hover 旋转 90°。
- **图标钮（md-icon-btn 32px）：** 透明底，hover `--hover`；顶栏里升级为 36px 玻璃底。

### 灵感卡（md-tile，ADR 0007 签名组件）
- **Shape:** 26px 圆角、纸白、`inset 0 0 0 .5px` 边、内边距 8px；封面 16:9、18px 圆角、`object-fit: cover` + `object-position: top`——「相纸贴在卡纸上」。封面不强制：没有图就不留灰块。
- **Reading order:** 封面 → 两行标题（15px/500、`min-height` 撑住两行，有无封面都占同样高度）→ 站点行（类型图标 + 来源/域名/文件名）→ 30px 黑胶囊「创作」（右侧 caret 出菜单：复制给 AI / 添加到当前会话）。整卡点击 = 打开编辑弹层，不打开原网页。
- **进创作的方式:** 点「创作」新开一个创作会话，素材以输入框里的**引用签**（与「添加到当前会话」同款 chip：标签 + 标题 + 摘要）落进空草稿，不自动发送，等用户补一句意图。宿主复用当前写作会话时，签补进当前输入框。
- **Chrome:** 封面左上 26px 圆形勾选钮、右上 26px 删除钮，只在 hover / 键盘聚焦 / 选中时显形（160ms）。
- **State:** hover 抬起 `translateY(-2px)` 且封面 `scale(1.015)`；选中 `1.5px` 墨色描边。
- **拖拽:** 卡可拖起（拖的是整张卡或已选的那一叠），拖到胶囊卡上松手即并入，拖动中源卡 `opacity .45`、落点胶囊卡 `1.5px` 描边。
- **变体:** `is-compact`（26px 圆角小卡，给多选浮条）、`is-bare`（只留封面位、标题与站点行，给胶囊浮层）。胶囊卡也用 `is-capsule` 复用这套封面位，只把封面内容换成相册拼贴，见下节。
- **无封面（DefaultCover）:** 封面位按类别换色纸底，居中铺类型图标 + 类型名（`.md-tile-voidcap`，如图片 / 视频 / 网页 / 笔记 / 文件）；不铺标题或正文预览，卡高恒定。站点行按类型给信息：链接 = 域名 + 外链，文件 = 文件名 + 打开原件，笔记 = 类型字。可打开时，类型图标、来源文字与外链符号组成同一个按钮，点来源文字即可打开，不必精确点中箭头；在胶囊内点击来源也不触发成员编辑或拖拽。

### 胶囊卡（md-capsule-art，ADR 0004/0013）
- **Shape:** 和灵感卡共用同一个 `.md-tile` 骨架：16:9 封面位、两行标题、站点行、底部黑胶囊。胶囊不靠变大或纸堆轮廓区分，靠封面位里的「相册拼贴」——一叠素材摊开在同一个相框里，一眼看出里面有几张。
- **Mosaic:** 1 张铺满；2 张并排；3 张左大右两小；4 张两行两列；超过 4 张只报数字。空位用类型色纸底 + `link/folder/pen` 图标，不铺标题。右下角 `.md-capsule-count` 只报「N 张」。
- **Reading order:** 相册封面（含张数）→ 胶囊名（与灵感卡同字号的两行标题）→ 站点行「胶囊 · N 张」→ 底部黑胶囊「创作」+ caret（更多）。整张卡与灵感卡同高同宽，并排摆放时只差封面里的内容。
- **Chrome:** 左上勾选钮、右上解散钮，位置和灵感卡一致；名字在胶囊浮层里改，卡上不做全卡编辑入口。
- **三处胶囊形态:** 灵感墙是完整相册拼贴；待排期托盘是横向三张错位照片（`.md-capsule-mini`，不是普通灵感行）；日历是 2×2 相册签（宽栏 32px、窄栏 24px）+ 纸边 + 右下角张数。三处都保留「里面有多张」的相册结构，不靠颜色区分。
- **浮层（md-capsule-view）:** 居中白纸面板，宽度 `min(560px, calc(100% - 8px))`；遮罩内边距按容器宽 `clamp(12px, 3vw, 24px)`。一页 6 格两列（窄到 400px 也不塌成一列），使用等宽等高的 Grid 而非瀑布流，成员卡按 `is-bare` 原字号重排并始终保留两行标题高度；成员可拖拽排序、拖出浮层即移出，墙上的卡拖进来即并入。头部一行 = 名字（可改）/ 张数（多页时带页码）/ 添加灵感 / 解散，永不换行；不设单独关闭钮，点遮罩或 Esc 退出。宽度 ≤820px 时两个动作收成 38px 图标钮（图标 22px，文字进 `aria-label` 与 `title`，视觉隐藏），≤660px 时面板改 `max-height: 100%` 内部滚动、翻页从两侧移到面板底部；≤520/400px 只压缩成员封面高度（116/98px），不减少列数。
- **状态:** 悬停成员时 `translateY(-2px)`；正在拖动的卡 `opacity .7`，落点卡 `1.5px` 描边。

### 作品卡与作品页（md-work-card，ADR 0013/0015）
- **作品页:** 内容栏目默认「我的作品」，按当代文学杂志 × 独立出版社目录处理。卷首只有墨色长发丝线上的刊名、策展式短句与日期，不加 eyebrow/kicker 或装饰标签；下方是 42px 搜索与「我的作品 / 流程」分段，工具仍是操作界面，不套展示字体。
- **卷首主打:** 当前过滤结果的第一篇（默认即最近更新）占一个完整编辑位，宽屏是左侧题名/状态/日期/来源、右侧封面的非对称双栏，≤700px 时封面在上、题跋在下。主打只承载真实作品事实与打开动作，不造统计数字或独立仪表盘；搜索结果也沿用同一主次结构，不重复作品。
- **目录:** 卷首和卡片之间一条 `作品目录 ——— 共 N 篇` 的目录尺；搜索时左字改「搜索结果」、右字改「找到 N 篇」。主体 `auto-fill` 网格（默认 `minmax(220px, 1fr)`），页面自身是 inline-size 容器，不按视口断点：≤840px 卷首重排，≤560px 改 `minmax(200px, 1fr)` 与 22/16px 间距，360–480px 侧栏优先、更窄自然落成一列。
- **作品卡:** 透明目录底 + 底部发丝线 + 4:3 封面，不堆叠厚纸面板；无封面时用 `coverText || 标题` 做展示衬线字封面。左上目录号从 `02` 接续主打，标题两行，状态点 + 日期 + 来源仍完整可读。柔影只给封面，hover 整卡抬 3px、封面轻微放大；新写回只用细描边与既有新鲜度提示，不再加一层彩卡。
- **动效:** 卷首以一次轻微 clip reveal 建立刊物开场，主打随后进入，目录以 35ms、最多 8 项的短 stagger 接续；曲线为 `cubic-bezier(.16, 1, .3, 1)`，没有漂浮、循环装饰或大视差。全局 `prefers-reduced-motion` 下降级到近乎无动画。
- **已用改动:** 当前稿与发布稿不一致时不加徽标、不显示 diff；卡片只呈现 current。
- **流程看板:** 三列草稿 / 已投递 / 已发布，列头是状态点 + 12px 字 + 右侧计数；条目是标题一行 + 时间。不提供拖拽改状态，拖起不出现落点。
- **空状态:** 保留同一刊头与「01 — 第一篇」的编辑标记，接「你写下的，会留在这里。」、一句说明和「去灵感墙」下划线按钮；不铺插画、不旋转纸板、不居中成一张空卡。

### 作品编辑器（md-work-editor）
- **Shape:** 全屏纸面浮层,顶栏 56px(返回 / 标题 / 保存状态 / 状态徽章 / 发布 / ⋯),主体左右两栏,中间 `.5px` 发丝线;窄屏(<880px)改为上下或单栏切换,不挤压到不可读。
- **左编辑:** 标题(20px 衬线)、封面文案、正文 Markdown 源文(14px/1.75)、封面与配图;无边框输入,聚焦时纸白底 + 1.5px 墨线。
- **右预览:** 实时 `renderMarkdown`;顶部平台宽度切换(微信 578 / 小红书 375 / 知乎 700),按真实 CSS 重排,不做 iframe + transform 缩放;浅灰桌面垫上放白纸,预览本身就是「发出去的样子」。
- **发布稿:** 切到「发布稿」时整页只读,顶栏出现「这是已发布版本」;没有发布稿时禁用。
- **保存状态:** 「已保存 / 保存中 / 有改动未保存」三态,12px 弱文字;冲突时横幅横跨顶栏下方,不遮正文。
- **已用分组:** 与标签栏同级、默认收起;展开后是低饱和的素材行,行尾 `⋯` 菜单管显示/隐藏与全部删除。蓝点 6px,点在卡右上角,不盖标题。

### 从作品学习（md-learn-list，ADR 0014）
- **入口:** 风格页 hero 第三个按钮「从作品学习」;作品编辑器底栏「学习写法」;两处打开同一个对话框,宽 560。
- **选择:** 只列有正文、未归档的作品,已发布优先;每行一枚复选、标题、状态与「N 段创作会话 / 没有登记创作会话」;最多 6 篇,超出给 toast。
- **底部:** 可选风格卡名字、候选说明、已选计数与主按钮「学习写法」;读对话时按钮显示「正在读对话…」。
- **结果:** 新开风格会话并把材料预填进输入框;不在这里展示规则,确认仍在风格页逐条完成。没有候选作品时只显一句空状态,不铺插画。

### 排期焦点（md-schedule-focus）
- **位置:** DOM 顺序固定为日历 → 排期焦点 → 待排期托盘；宽屏用三列把焦点放在日历和托盘之间，中屏让焦点横贯下一行，≤760px 按 DOM 顺序纵向堆叠。
- **选择:** 常驻展示与当前时刻绝对距离最近的一条有效排期，过去与未来都参与，每分钟重算；它不是只看未来的「下一条」。胶囊作为一个主体，显示整体拼贴、成员张数与排期汇总，不拆成多条。
- **Shape:** 独特的黑底杂志卡：左侧大图或胶囊拼贴的高度由右侧文字块决定，两者始终等高，不再按图片宽高比撑高卡片；右侧用系统衬线题名、细刊线、绝对时间 / 相对状态 / 平台或成员信息建立编辑排版。背景只用低对比刊线、柔和纸面光、取自真实排期日期的装饰大数字与 Magic UI 式同心波纹，不另造刊号或统计信息。整卡点击打开对应灵感/胶囊。没有排期时保留同位置安静空态，不用全局弹层替代。
- **边界:** 不写 `remindedAt`，不确认全局到点提醒，不自动成稿或发布；hover 仅抬 2px。波纹只做 transform 错相呼吸，进入视口且页面可见时才运行，离屏 / 页面隐藏即暂停，reduced-motion 保留静态圆环并去掉所有位移；360–480px 侧栏按真实宽度重排，文字不压图、不横向溢出。

### 邮票（md-stamp）
- **Shape:** 4:5 票面、齿孔遮罩（`--s: 9px`）、`filter: drop-shadow`；hover `scale(1.08) rotate(-2deg)`。
- **文字票（is-type）:** 色纸底 + 衬线字（首字或词）；今天的票 `--primary` 底 + 呼吸动画。
- **用途:** 灵感的「已收藏」纪念（首屏迷你邮票条）、日历格里的发布标记。

### 导航与 dockbar
- **顶部 md-nav:** 玻璃底（`blur(24px) saturate(160%)`）+ 4px 内衬，当前项墨黑底白字；可选模块用 10px 上标区分。
- **底部 dockbar:** 玻璃 + prominent 影、24px 圆角、悬浮于底部中央；分类 chips + 标签按钮（开锚定小列面板，有筛选时 `is-on` 反白）+ 新建圆钮（先打开创作模式再新建）。分类直接切换，不弹层。

### Chips / 分段
- **md-chips:** 30px 高、12.5px 字、透明底；选中 `--active` 底。
- **md-seg:** 4px 内衬的分段控件，选中项纸白底 + soft 影。
- **pill:** 34px 胶囊（浮条与提示条），玻璃底 `.5px` 描边；`is-primary` 墨黑。灵感卡里的操作胶囊是 30px。

### 输入与表单
- **行内无边输入:** 墙面搜索框、记录条——透明底、focus 时才出现纸白底 + `0 0 0 1.5px var(--ink)`。
- **表单域（md-field）:** 12.5px 标签 + 36px 输入框 + `.5px` 描边；focus 边框转 `--ink`。
- **错误:** `#d13c35` 文案 + 12% 红底差量（改标签 diff、toast）。

### 对话框 / 浮层 / 提示
- **md-dialog:** 28px 圆角、paper 白、prominent 影、`md-pop` 弹入（`scale(.94) translateY(10px)` → 0，0.4s 弹性）；`is-capture` 变体 34px 圆角、600px 宽，是新建与编辑灵感的唯一弹层，对齐 StashDock 的导入收藏弹层。
- **导入 / 编辑弹层（is-capture）:** 新建带 笔记 / 链接 / 文件 三页签；链接页粘贴后预读标题/简介/封面，重复链接先问保留或替换；文件页最多 10 个、总计 10MB，逐文件给标题与说明；标签是 chip 输入（上限 12，带建议），封面可预览、更换或恢复自动。编辑态没有页签，按类型铺标题 / 想法（链接为简介）/ 站点 / 封面 / 标签，左下滑出红色删除。图片与视频也按文件处理。
- **mask:** 60–70px 层级、`--dsw-alias-bg-mask-1` 或 18% 底 + blur(20px)。
- **toast:** 底部中央 76px、`--primary` 底白字、错误态 `#c33a33`；可带虚线点下划线的操作链接。
- **⋯ 菜单:** 12px 圆角纸面、5px 内衬、7px/10px 行、danger 红 + 12% 红底 hover；从卡上的 ⋯ / caret / 排序钮打开，浮层锚定触发按钮正下方 6px、右缘对齐、下方不够就翻到上方，绝不盖住按钮；卡片本身没有右键菜单。
- **选择浮条（md-selectbar）:** 玻璃底、`border-radius: 999px`、prominent 影；已选计数 + 动作（全选 / 添加到当前会话 / 复制给 AI / 进入创作 / 合成胶囊（仅 2 个以上未入胶囊的灵感）/ 删除或解散 / 取消）。选中的卡左上勾选钮反白。
- **标签筛选面板（md-tagpanel）:** 锚在 dockbar 的标签按钮上方（`bottom: 100% + 10px`、右缘对齐），宽 260px、最大高 `min(50dvh, 320px)`、12px 圆角纸白 + soft 影；竖排单选、首行「全部标签」+ 灵感计数，行尾 ⋯ 菜单给重命名与删除（`rename_tag` / `delete_tag`），面板不覆盖下半屏；内外点击与 Esc 关闭。
- **设置对话框:** 520px，语言（跟随宿主 / 中文 / English）、成稿保存目录、版本行，以及「从自媒体工作台迁移」块：先只读预览来源条数（灵感 / 媒体 / 排期、其中示例数、上次迁移时间），再给主按钮「迁移过来 / 再迁移一次」；完成后 toast 条数与没找到的媒体数，整次迁移可撤销。设置页不提供示例数据操作；首次安装自动带入全部示例，「清空示例数据」放在顶栏设置旁，统一清理示例并保留用户内容。
- **框选:** 在墙面空白处按住拖出 `--accent` 半透明矩形（9% 底 + 46% 边），与矩形相交的卡片即被选中；松手未拖动则清空选择。

### 工作区稿面（bento / tile）
- **Tile:** 20px 圆角纸面、soft 影、70ms 逐格入场；打开态 absolute 铺满 + prominent 影，其余格 `opacity .25`。
- **Hero tile:** 三团柔光渐变（`#c9b6f2 / #f7b899 / #a9cdf5`，`color-mix 34–42%`）做底，成稿运行时 `md-wash` 缓慢漂移；标题 `clamp(25px, 4.4cqw, 42px)` 细体。
- **分镜:** 2–3 列网格、白纸相片（`is-paper`：`0 0 0 .5px #17171a40` 边）；生成中 shimmer、生成完 `md-develop`（blur 10px → 0）显影。
- **拼贴:** 封面与配图以 ±3–5° 旋转叠放，hover 转正放大。

### 进度 / 反馈
- **步骤条（md-progress-step）:** 14px 圆环描边 → 激活呼吸 → 完成实心墨点。
- **骨架屏:** 999px 圆角条、shimmer 渐变、`3n`/`5n` 变长制造参差。
- **空状态:** 居中 13px `--ink3` 一句话 + 可选 dashed 添加卡。

### 图标（Icon）
- **规格:** 单一 path、24 viewBox、1.6 stroke、round cap/join、`currentColor`；尺寸 12–22px。
- **语义:** `+` 只表示新建/添加，`⋯` 打开更多菜单，`⌄` 展开或次级操作，`↗` 只打开外部原件，内部前进用 chevron，`←` 返回；圆点只表示状态。内部日历入口用 calendar，发布用 send、导出用 save；灵感/胶囊的封面类型共用同一个分类 helper，folder 不再同时表示胶囊。
- **禁止:** 位图图标、第三方图标库、emoji 充当新图标（历史遗留的 emoji 不扩散）。

### 动效
- **入场:** 工具列表用 `md-rise`（8px 上浮 + fade，0.45–0.6s `--ease`），逐项 22ms 延迟；作品目录单独用 35ms、最多 8 项的短 stagger，卷首与主打只有一次轻量 clip reveal，不让整个应用反复飞入。
- **弹性:** `cubic-bezier(.2, 1.3, .4, 1)` 只给弹层、拖拽落定、hover 抬起。
- **显影:** 图片生成用 `md-develop`（blur + scale 进场），进行中用 shimmer（220% 底位移）。
- **无障碍:** `prefers-reduced-motion` 全局降级到 0.01ms。

## Do's and Don'ts

### Do:
- **Do** 取色先查 `--dsw-alias-*` 别名；本地常量限于状态色、tone 色纸、氛围渐变三张白名单。
- **Do** 圆角走 4 / 8 / 12 / 16 / 20 / 26 / 28 / 34 阶梯（灵感卡 26px、其封面 18px、编辑对话框 34px，见 ADR 0007），圆形必配 `corner-shape: round`。
- **Do** 内容放纸面（`--card`）、chrome 才许玻璃（blur + saturate + 发丝 inset 边）。
- **Do** 衬线给「作品的一部分」：金句、稿面标题、题字、统计大数（衬线拉丁 + tabular-nums）；作品页展示例外只限系统衬线作用域，不扩散到操作控件。
- **Do** 缩略一律按容器重排真实字号（≥11px），媒体用固定高度 + `object-fit: cover` 裁切。
- **Do** 交互反馈用位移：hover `translateY(-1~-3px)`、active `scale(.97)`、弹层 `md-pop` 弹性进场。
- **Do** 状态用 7px 圆点或小徽章表达，且永远是同一组四色。

### Don't:
- **Don't** 对内容面板使用毛玻璃或半透明底（glass 只属于顶栏、dock、工具条）。
- **Don't** 用 `transform: scale` 缩小含文字的卡片（No-Scale Rule）；也不给格子强行套固定宽高比去裁正文。
- **Don't** 自造颜色或引入品牌色块；主色就是墨黑。
- **Don't** 用零偏移彩色光晕、渐变文字、硬投影（`4px 4px 0`）——柔影必须带 offset 与 blur。
- **Don't** 引入第三方图标库或位图图标；新图标照 Icon 系统规格画 path。
- **Don't** 给列表/卡片加 1px 以上彩色 border-left 当强调；强调用状态点、描边或反白。
- **Don't** 在 mask（齿孔）元素上用 box-shadow——会被遮罩吃掉，改用 `filter: drop-shadow`。
- **Don't** 给灵感卡加右键菜单、星标或成稿状态色：整卡点击就是编辑，状态四色只属于内容页与日历（ADR 0007）。
- **Don't** 把标签摊成一行 chips：标签进 dockbar 上方的锚定小列，墙上只留分类。
