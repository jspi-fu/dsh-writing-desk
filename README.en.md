<h1 align="center">Writing Desk</h1>

<p align="center"><b>A plugin for DeepSeek Harness. Capture a spark of an idea, drag it into a writing session, and edit, schedule and ship the piece from your desk.</b></p>

<p align="center">
  <a href="#get-started">Install</a> ·
  <a href="#does-it-cost-money">Does it cost money</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="README.md">中文</a>
</p>

<p align="center">
  <img alt="DeepSeek Harness 0.2.2" src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.2-111?style=flat-square">
  <img alt="Mac desktop &amp; web" src="https://img.shields.io/badge/Mac%20desktop-web-111?style=flat-square">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/MIT-open%20source-111?style=flat-square"></a>
  <a href="https://github.com/jspi-fu/dsh-writing-desk/stargazers"><img alt="Star" src="https://img.shields.io/github/stars/jspi-fu/dsh-writing-desk?style=flat-square&color=111&label=Star"></a>
</p>

<br>

## What it is

A page that lives in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) sidebar. Open it and you get an idea wall — one sentence, one idea; related cards bundle into capsules, and dragging a capsule into the chat hands the material to a writing session that drafts the piece in your voice. What comes back lands on your desk as a work: edit on the left, see a live platform preview on the right, autosave as you type; put it on the calendar, then copy it out or save it as a folder.

Four pages: **Ideas · Content · Schedule · Styles**. The interface comes in Chinese and English; it follows DeepSeek Harness's language by default and can be pinned in settings. Switch to English and pieces are written in English too. The web version opens in a mobile browser.

Built for **RedNote (Xiaohongshu), WeChat official accounts and Zhihu**, and other text-and-image platforms.

The writing itself happens in a DSH writing session: generation uses the model you configured in DeepSeek Harness, and your writing rules plus the craft method are served to the session as skills. The desk makes no model calls of its own — it keeps the data, the boards and the human checkpoints.

<br>

## The writing session

**Drag it in and go.** Drag an idea card or a capsule onto the dock below the chat input and a reference lands in your draft — add one sentence of intent ("make it a RedNote note, keep it casual") and press Enter. No dragging? The black pill on a card opens a writing session with the material as the same quote chip in the empty draft, or use its caret menu for "Add to chat" and "Copy for AI".

**Intent first.** The session condenses your material into an intent sheet — purpose, audience, the one judgment the piece serves, lines you must keep, what it will not do — and waits for your confirmation before writing. Then it reads the draft and reports findings without touching a word; you choose what gets fixed, and only then it polishes.

**One current draft, one published copy.** The session writes the title, body, figures and review findings back into the work; the desk keeps only the current draft and the published copy, no version snapshots. If you edited by hand, a stale write-back is blocked — settle it in the work editor with "use latest" or "use mine".

**The work editor.** Open a work from the Content page: outline and body on the left, live Markdown preview on the right, with RedNote's narrow column, a WeChat article or a Zhihu answer as the frame (approximate previews). Title, cover text and body save as you type; copy the body, save a folder, export a publish bundle, or send to a platform draft box from the footer.

**Rules grow with you.** The session proposes rules from how you edit its drafts; you turn them on in Styles, and from then on every piece follows them.

<br>

## The idea wall

**One sentence, one idea.** Text, links, images, videos and files all become a card: a 16:9 cover, a two-line title, a site row — click anywhere to edit. One import dialog serves the Note / Link / File tabs; links read their title, description and cover automatically, and files accept up to ten at a time.

**Find it before you use it.** Search and sort (newest / oldest / title) sit at the top; category chips (All / Notes / Files / Links) switch directly. Tags live in a small popover above the dock: single-select filtering, plus rename and delete.

**A capsule is a set.** Check a few cards to fold them into a capsule: a 2×2 cover stack with a count. Capsules can be multi-selected, dissolved and grow more members, but have no editor — they are just sets of ideas. The wall supports checkboxes, marquee selection, and batch "Add to chat" / "Start writing".

**Bring old data over.** Settings has "Migrate from media desk": preview the counts, then import ideas, schedules and media files in one click; angles and readers merge by name, and the whole migration can be undone.

<br>

## Schedule

**One calendar, two things.** A stamp for every day you captured something, and ideas or whole capsules dragged onto a day for an in-app reminder when it comes due; drag a scheduled card back to the tray to unschedule. The next scheduled item is always in the corner.

<br>

## Styles

**Pick whose voice.** Creator presets across gadget, travel, lifestyle, opinion, how-to, reviews, stories and news — pick one and start writing.

**Or your own.** Paste a few pieces you wrote (or their links) and the writing session distills them into a personal style card you can edit anytime.

**Or learn from your works.** Pick 1–6 pieces in Styles or the work editor; the desk reads the writing sessions registered on those works, adds their published copies (and any unpublished edits), and hands the material to a fresh style session. It only writes candidate rules and a candidate style card — nothing takes effect until you confirm each one. If a session can't be read, the material says so and falls back to the published copy.

Writing rules live in Styles: the session proposes, you confirm. Confirmed rules flow into every writing session in real time, and can be exported as a DeepSeek Harness Skill.

The Content page opens on the My Works gallery: every work grouped as draft, submitted or published, one click into the work editor. The Pipeline board shows how each work moves from draft to publication. Ideas consumed by a work are grouped under Used on the idea wall and leave the scheduling queue.

<br>

## Get started

Requires DeepSeek Harness `0.2.2-rc.2` or later `0.2.x`, verified on the `0.2.2-rc.3` desktop build. Drag-to-chat and one-click session start enable themselves when the host supports them; on older hosts the desk falls back to plain boards.

**1. Install.** Open "Plugins" in the Harness sidebar and enable the experimental index: on DSH `0.2.2` and later it is "Custom plugin index" under "Experimental plugins". Switch to "Discover" and add this index URL (once is enough):

```
https://raw.githubusercontent.com/jspi-fu/dsh-writing-desk/main/index.json
```

If GitHub is unreachable, use this CDN mirror at the cost of being up to 12 hours behind the latest release:

```
https://cdn.jsdelivr.net/gh/jspi-fu/dsh-writing-desk@main/index.json
```

"Writing Desk" appears in the list — click install. It installs the same npm package `dsh-writing-desk`; the index just saves you typing the package name.

Alternatively, enter `dsh-writing-desk` under "Plugins" → "Add plugin", or use the command line. Quit the desktop app fully (⌘Q) before installing and reopen it; on the web version restart `dsh web` after installing. No `dsh` in your terminal? Pick "Manage dsh command" in the desktop menu first.

```bash
dsh plugin --profile desktop add dsh-writing-desk
```

```bash
dsh plugin --profile web add dsh-writing-desk
```

**2. Update.** When a new version ships, the plugin page shows an update button; re-run the command above for CLI installs. The desk also checks npm for the latest version (at most hourly, version number only): an `↑ v Newest` badge appears in the header, the current version sits at the bottom of settings, and the badge links to the npm page. For offline installs, grab `dsh-writing-desk-*.tgz` from [Releases](https://github.com/jspi-fu/dsh-writing-desk/releases/latest) and set the package name to `"file:$PWD/dsh-writing-desk-<version>.tgz"`.

**3. Open.** "Writing Desk" appears in the sidebar. Everything you see first is sample data — hit "Sample data · Clear" to make it yours.

To uninstall, replace `add` with `remove dsh-writing-desk`. Your content stays in `~/.dsh/writing-desk/`.

<br>

## Does it cost money

The plugin is free and open source, with no keys bundled. Where a model is involved, it uses the account you configured in DeepSeek Harness.

| | What it uses | Notes |
| --- | --- | --- |
| **Writing** | The model you configured in DeepSeek Harness | Happens in the writing session, billed to your account |
| **Cover & figures** | Image tools available in DSH (e.g. subscription image tools) | Called by the session while writing; without one the text still works and the cover falls back to type-only |

<br>

## FAQ

<details>
<summary><b>Can it publish directly?</b></summary>
<br>

It can reach <b>draft boxes</b>. Just install the <a href="extension/">DSwritesync browser extension</a>: the extension pairs with the desk automatically over Native Messaging (the plugin registers a local helper when DSH starts — no token, no pasting, no ports), and the work editor sends a finished piece to 20 platforms' draft boxes in one click (WeChat, Zhihu, Juejin, Weibo, Bilibili, Douban, Baijiahao, Sohu, CSDN, SegmentFault, Yuque, Xueqiu, Woshipm, 51CTO, Imooc, OSChina, Cnblogs, Eastmoney, Aliyun Developer Community, Xiaohongshu; most platforms use your own login state via their official Web APIs, Xiaohongshu uses page automation, and the extension re-uploads images). Platforms have no unified publish API, so a piece counts as published only when you confirm it; Xiaohongshu is saved to the browser-local draft box and the extension never clicks Publish.

DSwritesync's side panel also has Capture (whole page or selection into the idea wall) and Sync (the current page to platform drafts); both share one settings page.

Without the extension, copy the piece or save the folder as before: it defaults to `~/Documents/Writing Desk/` with the article, cover and figures inside.

</details>

<details>
<summary><b>Where is my data?</b></summary>
<br>

All on this machine in `~/.dsh/writing-desk/`, shared by the desktop and web versions. No cloud, no accounts.

</details>

<details>
<summary><b>Does it work without an image model?</b></summary>
<br>

Yes. The body and title work as usual and the cover becomes a type-only card. Once an image tool is available on the session side, covers and figures render too.

</details>

<details>
<summary><b>Is there a chat assistant in the desk?</b></summary>
<br>

Not in the desk itself. Writing happens in a DeepSeek Harness writing session — DSH's own chat, not a built-in assistant. The desk shuttles material, rules and drafts between the session and your boards; the writing is done by the model you configured in DSH.

</details>

<details>
<summary><b>Is this made by DeepSeek?</b></summary>
<br>

No, it is a community plugin. Pieces are generated by the model you configured in DeepSeek Harness, billed to your own account.

</details>

<br>

## Development

```bash
npm install && npm test        # Host logic tests
npm run watch                  # Rebuild client/ on change
npm run index                  # Refresh index.json after a release
cd extension && pnpm install && pnpm build:extension  # build the DSwritesync extension
scripts/dev-sandbox.sh         # Run the web build in an isolated DSH_HOME
npm pack                       # Build an installable tgz
```

`index.json` is the marketplace index; `npm run index` refreshes its version and release time from npm after each release.

| Directory | Contents |
| --- | --- |
| `client/` | UI: idea wall, works page, schedule, styles, work editor, dock rail |
| `src/` | Host API, state machine, harness tools & skills, local storage, bridge mailboxes |
| `extension/` | DSwritesync: a GPL-3.0 vendored fork of Wechatsync 2.0.10 with a StashDock-style capture side panel (in `extension/packages/extension`) |
| `native/` | Local helper (helper.bat/helper.mjs) and the NM registrar: the browser extension reaches the bridge mailbox over Native Messaging; MIT in this repo |
| `scripts/` | Packaging, sandbox, sample assets, marketplace index |
| `assets/` | Sample images and videos, drawn by `scripts/gen-assets.py` (the logo is hand-made; archive in `docs/logo-final/`) |

The extension is not part of the npm plugin package; `npm pack` ships the plugin itself plus the `native/` local helper. The extension hookup (Native Messaging auto-pairing) is documented in [ADR 0012](docs/adr/0012-bridge-native-messaging.md) (Native Messaging auto-pairing; the CLI/token path is retired, the mailbox contract still follows ADR 0009/0010), with research notes in [docs/research/](docs/research/). `extension/` is GPL-3.0; the rest of the repository remains MIT.

Restart DeepSeek Harness after changing `src/`.

**Security:** every endpoint passes Host authentication; model output and fetched external content are field-filtered and length-capped, operations run through whitelists, and pasted links can never reach localhost or the internal network. Please report vulnerabilities privately via [Security Advisories](https://github.com/jspi-fu/dsh-writing-desk/security/advisories/new).

<br>

## Credits

This project began as a fork of the community plugin `dsh-media-desk`, thanks to the original author [蜗牛的科技笔记](https://www.xiaohongshu.com/user/profile/5faedce8000000000101c8a3) and everyone who tested, debugged and contributed back then:

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

And thanks to the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) team for the open plugin system.

<p align="center"><sub><a href="LICENSE">MIT</a> · A community plugin, not affiliated with DeepSeek. DeepSeek Harness's name and marks belong to their owners.</sub></p>
