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
  status-ready: "#8a5fe0"
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
    fontSize: "33px"
    fontWeight: 300
    lineHeight: "46px"
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
  panel: "28px"
  pile: "18px"
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
    rounded: "{rounded.xl}"
  capsule-pile:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.pile}"
    width: "352px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "36px"
  dialog:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.panel}"
---

# Design System: 图文创作台（dsh-writing-desk）

## Overview

**Creative North Star: 「书桌上的编辑部」**

整个系统是一张安静的书桌。内容永远放在「纸」上——白底、柔影、小圆角的面板；玻璃只做桌面陈设——顶栏导航、底部 dock、悬浮工具条这些「桌面本身」的物件；文字的仪式感交给衬线体——金句、稿面标题、题词票。它是一份给个人创作者的编辑工具：先收集灵感（邮票、卡堆），再把它们写成一篇图文（稿面），最后排期发布（日历上的小邮票）。

密度中等偏高但呼吸从容：卡片之间 10–16px 的间隙、面板内 14–20px 的内边距、一级标题用 300 细体大字号拉开层级。动效克制而「活」：入场一律 `translateY(8px) + fade` 上浮，悬停是 1–3px 的抬起，弹性曲线 `cubic-bezier(.2, 1.3, .4, 1)` 只给拖拽与弹层。明暗主题由宿主（DSH）切换，本系统全部颜色经语义别名取用，不持私有色。

**Key Characteristics:**
- 纸面承载内容，玻璃只做 chrome（桌面陈设）
- 衬线双声部：宋体给中文的仪式感，Iowan/Palatino 给数字的编辑味
- 状态色是全系统唯一的高饱和色，成稿进度一目了然
- 邮票是灵魂母题：齿孔遮罩、4:5 票面、色纸衬线首字
- 一切缩略重排字号，绝不整体缩放（No-Scale Rule）

## Colors

调色板由宿主 DSH 的语义别名提供，本插件不自造颜色；状态色与氛围渐变是仅有的本地常量。下表为浅色主题参考值，规范来源永远是 `--dsw-alias-*`。

### Primary
- **墨黑 Primary**（`--primary` → `var(--dsw-alias-button-primary-fill)`，参考 `#17181c`）：主按钮、当前导航项、置顶卡反白底、toast 底、日历「今天」。黑而非品牌色——工具本身不抢戏。
- **强调 Accent**（`--accent` → `var(--dsw-alias-link)`，参考 `#6b5cff`）：链接、折线图、拖拽选中描边、编辑器高亮。只在「可点」与「数据」上出现。

### Status（唯一的高饱和色系）
- **构思 Outline**（`#d39a2c` 琥珀）：灵感还是一句原话。
- **草稿 Draft**（`#4176e6` 蓝）：成稿进行中。
- **待发布 Ready**（`#8a5fe0` 紫）：已排期。
- **已发布 Published**（`#2fa36c` 绿）：完成态；同时给卡片反白（`is-inverted`）。
- **危险**（`#d13c35`）：解散、移出等破坏性菜单与按钮。
- 状态一律「7px 圆点」或「12px 圆角小徽章」出现，永远配 `STATUS_LABEL` 文案。

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

**Character:** 界面文字全部走宿主无衬线，保持工具的安静；衬线只出现在「被创作的内容」上——金句卡、稿面标题、风格引文、封面题字——像印刷品贴在界面上。数字是另一个声部：统计大数用衬线拉丁（常常斜体、`tabular-nums`），让数据带一点杂志排版的味道。

### Hierarchy
- **Display**（300，33px/46px，-0.015em）：首屏 hero 一句话；移动端降到 24px/34px。
- **Headline**（300，34px/44px）：普通页面页题；稿面文章题则用衬线 22–24px/600。
- **Title**（500–600，13–15px）：面板标题、卡片标题、看板列头。
- **Body**（400，14px/22px；prose 14.5px/26px，稿面阅读态 16px/30px）：界面正文与文章。
- **Label**（400，11–12.5px，`--ink3`）：页脚、来源、时间、行号；数字用 `font-variant-numeric: tabular-nums`。

### Named Rules
**衬线只给内容的仪式感。** 按钮文案、表单、导航、面包屑永远无衬线；金句、标题、题字、统计大数才允许衬线。判断标准：这段字是不是「作品的一部分」。

**The No-Scale Rule.** 任何缩略场景（卡堆、邮票、看板缩略图）都按容器宽度**重排**文字到真实字号（≥11px），禁止 `transform: scale` 缩小整卡——缩出来的字等于没有字（ADR 0004 的教训）。

## Layout

侧栏工具，挂载在 DSH 宿主框架内，自身是一个 `md-root` 容器（`container: md-root / inline-size`）。

- **灵感墙**：CSS 多列瀑布流 `columns: 236px`、列距 16px、`max-width: 1500px` 居中；卡片间距 16px。
- **首屏 Hero**：`max-width: 560px` 居中，日期行 + 33px 细体一句话 + 48px 高的记录输入条。
- **胶囊资料架**：灵感墙顶部的横向条（`align-items: flex-start`），卡堆宽固定 352px、高度随成员数自适应（ADR 0004）。
- **普通页面**：内边距 `78px 28px 40px`，内容自适应；面板卡片化。
- **工作区（成稿）**：bento 网格 `1.04fr / 1fr`，区域 `idea / hero / article / shots`；`@container` 断点 1040px（分镜 3 列）、620px（hero 折叠单列）、760px（工作区单列）。
- **移动端**：`@container md-root (max-width: 560px)` 顶栏收纳、hero 缩到 24px、隐藏次要按钮。
- **节奏**：间隙 4 / 8 / 10 / 12 / 16px 一档一档来；标题的上方留白大于下方（`margin: 22px 0 8px` 这类）。

## Elevation & Depth

「桌面」有三层：底色 → 纸面 → 悬浮 chrome。深度主要由柔影承担，一律带 offset 与 blur，禁止零偏移彩色光晕。

### Shadow Vocabulary
- **`--dsw-elevation-soft`**（宿主令牌）：卡片、面板、输入条、小浮层的常驻影。
- **`--dsw-elevation-prominent`**（宿主令牌）：dockbar、对话框、菜单、toast、大图查看器。
- **本地深影**（如 `0 16px 36px -14px rgb(0 0 0 / .16)`、`0 30px 90px -30px rgb(0 0 0 / .45)`）：大浮层与卡堆的外层空间感，负 spread 收边。
- **发丝线描边**（`.5px solid` / `inset 0 0 0 .5px`）：不承担深度，只承担边界。
- **遮罩模糊**：弹层背景 `blur(18–20px) saturate(125–140%)` + 18% 底色，内容浮层永远可读。

### Named Rules
**玻璃只做桌面陈设。** `backdrop-filter` 只允许出现在 chrome 层：顶栏导航、dockbar、多选工具条、查找条、版本 pill。内容面板（卡片、对话框、卡堆、稿面）一律实心纸白——纸不透明。

## Shapes

圆角六档阶梯：4（行内小件）→ 8（按钮小件/分段内格）→ 12（按钮、输入框、菜单）→ 16（列表卡、图板）→ 20（卡片、面板）→ 28（对话框、浮层）；卡堆例外用 18px。真圆（圆钮、圆点、头像）一律 `border-radius: 50%` 且配 `corner-shape: round`。

边界语言：`.5px` 发丝线是默认边；`inset 0 0 0 .5px` 是玻璃件的替代边；虚线（`1px dashed`）只表示「可以放下东西来」（dropzone、风格添加卡）。邮票是唯一的异形：`radial-gradient` 齿孔遮罩打出锯齿边（`--s: 9px; --hole: 2.4px`），且因为 mask 会吃掉 box-shadow，阴影必须走 `filter: drop-shadow`。

## Components

### 按钮（md-btn）
- **Shape:** 12px 圆角、36px 高、13px 字；`is-small` 28px/12px。
- **Primary:** 墨黑底白字；hover 换 `--primary-hover`；active `scale(.97)`；danger 红字 + 40% 红描边。
- **圆钮（md-round 40px）：** 唯一的主行动圆钮（dockbar 里的「记下灵感」），hover 旋转 90°。
- **图标钮（md-icon-btn 32px）：** 透明底，hover `--hover`；顶栏里升级为 36px 玻璃底。

### 卡片（md-card）
- **Corner Style:** 20px；内嵌媒体 `margin: 6px 6px 0`、14px 圆角——「相纸贴在卡纸上」。
- **Shadow Strategy:** soft 常驻；hover 抬起 `translateY(-3px)`。
- **Footer:** 11.5px，状态点 + 来源 + 相对时间，`min-height: 36px` 对齐。
- **反白（is-inverted）：** 已发布卡整体换 `--primary` 底白字。

### 胶囊卡堆（md-pile，签名组件）
- **Shape:** 352px 宽、18px 圆角、白纸面板、内边距 12px、两列 `columns: 2` 列距 10px。
- **内容:** 成员卡按列宽原字号重排（不缩放），媒体压 112px 等高、正文 3 行；±0.5° 交错旋转。
- **折叠:** 超过 4 张折成底部两道纸边；不画空槽位、不显示条数。
- **浮层:** 一页 6 张、`min(560px)` 白纸面板、28px 圆角、两侧 40px 圆形翻页钮、遮罩模糊。
- **状态:** 拖入时 `0 0 0 2px var(--ink)` 描边 + `scale(1.02)`；多选 1.5px 描边。

### 邮票（md-stamp）
- **Shape:** 4:5 票面、齿孔遮罩（`--s: 9px`）、`filter: drop-shadow`；hover `scale(1.08) rotate(-2deg)`。
- **文字票（is-type）:** 色纸底 + 衬线字（首字或词）；今天的票 `--primary` 底 + 呼吸动画。
- **用途:** 灵感的「已收藏」纪念（首屏迷你邮票条）、日历格里的发布标记。

### 导航与 dockbar
- **顶部 md-nav:** 玻璃底（`blur(24px) saturate(160%)`）+ 4px 内衬，当前项墨黑底白字；可选模块用 10px 上标区分。
- **底部 dockbar:** 玻璃 + prominent 影、24px 圆角、悬浮于底部中央；类型筛选 chips + 标签 chips + 圆钮。

### Chips / 分段
- **md-chips:** 30px 高、12.5px 字、透明底；选中 `--active` 底。
- **md-seg:** 4px 内衬的分段控件，选中项纸白底 + soft 影。
- **pill:** 34px 胶囊（hero 操作、日期），玻璃底 `.5px` 描边；`is-primary` 墨黑。

### 输入与表单
- **行内无边输入:** 记录条、hero 输入、改名框——透明底、focus 时才出现纸白底 + `0 0 0 1.5px var(--ink)`。
- **表单域（md-field）:** 12.5px 标签 + 36px 输入框 + `.5px` 描边；focus 边框转 `--ink`。
- **错误:** `#d13c35` 文案 + 12% 红底差量（改标签 diff、toast）。

### 对话框 / 浮层 / 提示
- **md-dialog:** 28px 圆角、paper 白、prominent 影、`md-pop` 弹入（`scale(.94) translateY(10px)` → 0，0.4s 弹性）。
- **mask:** 60–70px 层级、`--dsw-alias-bg-mask-1` 或 18% 底 + blur(20px)。
- **toast:** 底部中央 76px、`--primary` 底白字、错误态 `#c33a33`；可带虚线点下划线的操作链接。
- **右键菜单:** 12px 圆角纸面、5px 内衬、7px/10px 行、danger 红 + 12% 红底 hover。

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
- **禁止:** 位图图标、第三方图标库、emoji 充当新图标（历史遗留的 emoji 不扩散）。

### 动效
- **入场:** `md-rise`（8px 上浮 + fade，0.45–0.6s `--ease`），列表逐项 22ms 延迟。
- **弹性:** `cubic-bezier(.2, 1.3, .4, 1)` 只给弹层、拖拽落定、hover 抬起。
- **显影:** 图片生成用 `md-develop`（blur + scale 进场），进行中用 shimmer（220% 底位移）。
- **无障碍:** `prefers-reduced-motion` 全局降级到 0.01ms。

## Do's and Don'ts

### Do:
- **Do** 取色先查 `--dsw-alias-*` 别名；本地常量限于状态色、tone 色纸、氛围渐变三张白名单。
- **Do** 圆角走 4 / 8 / 12 / 16 / 20 / 28 阶梯（卡堆 18px 是唯一例外），圆形必配 `corner-shape: round`。
- **Do** 内容放纸面（`--card`）、chrome 才许玻璃（blur + saturate + 发丝 inset 边）。
- **Do** 衬线只给「作品的一部分」：金句、稿面标题、题字、统计大数（衬线拉丁 + tabular-nums）。
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
