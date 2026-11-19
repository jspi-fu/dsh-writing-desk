# 工具面判据:专用工具与宿主通用工具的分界

Status: accepted(2026-11-19 grill 审查会话逐工具定案;rev 契约修正随本 ADR 落地)

## 背景

ADR 0006 给创作会话注册了四件专用工具(read/write/add_rule/add_style),但创作会话同时持有宿主 dsh-base 组合的通用工具(dsh-tool-fs 的 read/write/edit/patch、dsh-tool-fs-search 的 glob/grep、bash、web 等),而工作台状态就是 `$DSH_HOME/writing-desk/state.json` 的普通文件——通用 read 碰得到它。「read 为什么不用通用的?」是未来每个读代码的人都会再问的问题,判据要成文,四个工具逐个过闸的结论也要成文。

## 决策

| 事项 | 决策 |
| --- | --- |
| 专用工具判据 | 会话要做的事满足任一条,必须走专用工具:①**触碰 Store 状态的写路径**——reducer 裁决状态元组、快照、三方合并撤销、双进程串行写(mtime 复查)、不可信模型输出的字段白名单,通用 write 直改 state.json 会全部绕过;②**输出需要有界裁剪与领域形状**;③**输入需要领域归一**。三条全不沾的杂务明确归通用工具(把生成的图片拷进 files/、读参考资料),不再工具化。 |
| read 过 ②③ | query 上限 12 条、正文截 4000 带 `bodyTruncated` 标记、旧稿预览截 1200;capsuleIds 经 produce-input 归一展开(去重、滤已删、定产物落点)。额外的否决项:state.json 以 `JSON.stringify` **单行落盘**,通用 read 的按行分页与 grep 的整行命中都失效,而成稿正文单条上限 20 万字,墙面增长后是常态。删掉专用 read 换「通用 read/grep + skill 条款教解析」的四项代价(分页失效、无界输出、内部形状变成事实公共 API、胶囊展开进提示词且易错)都大于省下的一个 schema。 |
| write 过 ① | 唯一写入口;rev 冲突闸门(基线不符 → 409 + pendingWrite → 校样浮层裁决)是词汇表「写回绝不静默覆盖人工修改」红线的执行点。没有现实的通用替代。 |
| add_rule / add_style 过 ①,保持两件 | 各写一个非 production 实体(skills/styles),write 的参数模型装不下。闸门不对称有实义:风格卡提炼自用户当场给的样本、是用户点名的动作,写完即设为当前;规则是模型从改稿方向自发归纳的泛化,落 proposed 等人工启用(软参考→确认→硬规则)。合并成一个 propose 省约两百首轮令牌,搭上两套语义耦合;ADR 0006「四个 schema 各自说清」维持。 |
| rev 契约修正 | 修正前 read 不回 rev,而 read/write 两边描述都让模型「写回前先 read 拿当前 rev」——新会话接着既有成稿**首次**写回时拿不到基线,按 write_production 的缺省语义(`base = rev`)闸门不触发,静默覆盖用户在校样浮层的人工修改,恰好违反工具自己的描述。修法:read 的产物概要给回 **write 可写的每个字段的当前值**(rev、title、coverText、cover、images、intent、review;正文只给预览 existingDraft)。intent/review 同时补齐 ADR 0006 的「意图单持久化在插件侧,新会话经 read 工具读回续跑」契约。 |
| 输出形状 | 产物概要嵌在 `items[].production` 下,与灵感自身字段(title/body)不再混排——词汇表口径:成稿产物与灵感自身的 title/body 是两个不同的东西。原扁平 `existingDraft` 移入 production。 |

## 不做

- 不把 state.json 改成 pretty-print 去迁就通用 read——仍剩无界输出、形状耦合、胶囊展开进提示词三项代价,且丑化每次落盘。
- 不合并 add_rule/add_style,不对齐两者的闸门(不对称是刻意的)。
- 不为杂务造工具:拷图进 files/、读参考资料走通用 bash/fs。

## 后果

- 模型契约一句话:**每次 write 带上最近一次 read 或 write 拿到的 rev**。read 之后用户改过稿,write 被拦下进校样浮层裁决——闸门对所有首写生效,不再有「新会话首写无基线」的豁免。
- read 输出多了 production 概要;内部字段(aiArticle、snapshots、savedPath、status/stage/finishedAt)依旧不出工具面。
- 通用工具与专用工具的分界从此是成文规则:新增会话能力时先过三条判据,再决定造不造工具。

## 代码影响

- `src/preset-tool.js`:新增 `summarizeProduction`(rev + write 可写字段的当前值,正文预览),`summarizeItem` 改挂 `production` 概要;read 输出 schema 描述同步。
- `test/preset.test.js`:write/read 用例改为**按 read 拿到的 rev** 续写,补「人工改稿后旧 rev 被拦」与 intent 回读断言。

## 回滚

git 历史回退即可;read 输出只是多给了字段,没有持久化形状变化,唯一消费者是会话里的模型。
