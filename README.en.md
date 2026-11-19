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

A page that lives in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) sidebar. Open it and you get an idea wall — one sentence, one idea; related cards bundle into capsules, and dragging a capsule into the chat hands the material to a writing session that drafts the piece in your voice. What comes back lands on your desk: proof it against the layout of each platform, edit in place, put it on the calendar, then copy it out or save it as a folder.

Four pages: **Ideas · Content · Schedule · Styles**. The interface comes in Chinese and English; it follows DeepSeek Harness's language by default and can be pinned in settings. Switch to English and pieces are written in English too. The web version opens in a mobile browser.

Built for **RedNote (Xiaohongshu), WeChat official accounts and Zhihu**, and other text-and-image platforms.

The writing itself happens in a DSH writing session: generation uses the model you configured in DeepSeek Harness, and your writing rules plus the craft method are served to the session as skills. The desk makes no model calls of its own — it keeps the data, the boards and the human checkpoints.

<br>

## The writing session

**Drag it in and go.** Drag an idea card or a capsule onto the dock below the chat input and a reference lands in your draft — add one sentence of intent ("make it a RedNote note, keep it casual") and press Enter. No dragging? The black pill on a card opens a writing session with the material as the same quote chip in the empty draft, or use its caret menu for "Add to chat" and "Copy for AI".

**Intent first.** The session condenses your material into an intent sheet — purpose, audience, the one judgment the piece serves, lines you must keep, what it will not do — and waits for your confirmation before writing. Then it reads the draft and reports findings without touching a word; you choose what gets fixed, and only then it polishes.

**Written back in stages.** First draft, review findings and the polished final each land on the desk as they finish, and every landing leaves a snapshot. Fields you edited by hand are never silently overwritten — a conflict waits for you in the proof view.

**The proof view.** Open a piece from the Content page and it lays out like the platform: RedNote's narrow column, a WeChat article, a Zhihu answer (approximate previews). Edit the title, cover text and body in place; roll back from the version list; copy, save a folder, export a publish bundle, or schedule from the footer.

**Rules grow with you.** The session proposes rules from how you edit its drafts; you turn them on in Styles, and from then on every piece follows them.

<br>

## The idea wall

**One sentence, one idea.** Text, links, images, videos and files all become a card: a 16:9 cover, a two-line title, a site row — click anywhere to edit. One import dialog serves the Note / Link / File tabs; links read their title, description and cover automatically, and files accept up to ten at a time.

**Find it before you use it.** Search and sort (newest / oldest / title) sit at the top; category chips (All / Notes / Files / Links) switch directly. Tags live in a small popover above the dock: single-select filtering, plus rename and delete.

**A capsule is a set.** Check a few cards to fold them into a capsule: a 2×2 cover stack with a count. Capsules can be multi-selected, dissolved and grow more members, but have no editor — they are just sets of ideas. The wall supports checkboxes, marquee selection, and batch "Add to chat" / "Start writing".

**Bring old data over.** Settings has "Migrate from media desk": preview the counts, then import ideas, schedules and media files in one click; angles and readers merge by name, and the whole migration can be undone.

<br>

## Schedule

**One calendar, two things.** A stamp for every day you captured something, and finished pieces dragged onto a day to schedule them. The next post is always in the corner.

<br>

## Styles

**Pick whose voice.** Creator presets across gadget, travel, lifestyle, opinion, how-to, reviews, stories and news — pick one and start writing.

**Or your own.** Paste a few pieces you wrote (or their links) and the writing session distills them into a personal style card you can edit anytime.

Writing rules live in Styles: the session proposes, you confirm. Confirmed rules flow into every writing session in real time, and can be exported as a DeepSeek Harness Skill.

The Content page sorts everything into Ideas, Written, Ready and Published; pieces written back by the session announce themselves on the intake bar.

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

It can reach <b>draft boxes</b>. Install the <a href="extension/">"Writing Desk · Capture &amp; Publish" browser extension</a> and run <code>wdesk serve</code> in a terminal, then the proof view can send a finished piece to the WeChat, Zhihu, Juejin, Weibo, Bilibili, Douban, Baijiahao, Sohu, CSDN, SegmentFault and Yuque draft boxes in one click (using your own login state via each platform's official Web APIs; images are re-uploaded by the extension). Platforms have no unified publish API, so a piece counts as published only when you confirm it; the RedNote adapter is planned for a second round.

Without the extension, copy the piece or save the folder as before: it defaults to `~/Documents/Writing Desk/` with the article, cover and figures inside, plus a ready-to-paste `wdesk sync` command.

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
scripts/dev-sandbox.sh         # Run the web build in an isolated DSH_HOME
npm pack                       # Build an installable tgz
```

`index.json` is the marketplace index; `npm run index` refreshes its version and release time from npm after each release.

| Directory | Contents |
| --- | --- |
| `client/` | UI: idea wall, content, schedule, styles, proof view, dock rail |
| `src/` | Host API, state machine, harness tools & skills, local storage, bridge mailboxes |
| `extension/` | Browser extension "Capture & Publish": web capture into the idea wall, draft delivery to platforms (see [extension/](extension/)) |
| `cli/` | `wdesk` local bridge & CLI: publish dispatch, capture delivery, sync/platforms/extract (see [cli/](cli/)) |
| `scripts/` | Packaging, sandbox, sample assets, marketplace index |
| `assets/` | Sample images and videos, all drawn by `scripts/gen-assets.py` |

The extension and CLI are not part of the npm plugin package; `npm pack` ships the plugin itself only. The bridge architecture is documented in [ADR 0009](docs/adr/0009-bridge-extension.md), with research notes in [docs/research/](docs/research/).

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
