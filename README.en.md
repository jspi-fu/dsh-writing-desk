<h1 align="center">Writing Desk</h1>

<p align="center"><b>A DeepSeek Harness plugin. Capture an idea, then draft the article, title, cover image and illustrations.</b></p>

<p align="center">
  <a href="#get-started">Install</a> ·
  <a href="#what-it-costs">What it costs</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="README.md">简体中文</a>
</p>

<p align="center">
  <img alt="DeepSeek Harness 0.2.x" src="https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-111?style=flat-square">
  <img alt="Mac desktop and web" src="https://img.shields.io/badge/Mac%20desktop-web-111?style=flat-square">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/MIT-open%20source-111?style=flat-square"></a>
  <a href="https://github.com/jspi-fu/dsh-writing-desk/stargazers"><img alt="Star" src="https://img.shields.io/github/stars/jspi-fu/dsh-writing-desk?style=flat-square&color=111&label=Star"></a>
</p>

<br>

## What it is

Writing Desk is a page in the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) right sidebar. It opens on a wall of your ideas, one line each. Open one, click **Draft it**, and you get an article, a headline, a cover image and illustrations. Edit the draft in place and undo any step. Then drag the finished piece onto the calendar, publish it, and come back for the numbers.

There are five pages: **Ideas · Content · Schedule · Insights · Styles**. The interface is available in English and Chinese. By default it follows the DeepSeek Harness language, and you can lock it to either one in the plugin settings. When the interface is in English, articles and titles are written in English. The web version also works in a phone browser.

Built for **RedNote, WeChat Official Accounts and Zhihu** first, with general support for other platforms.

Writing Desk has no built-in chat assistant and does not stand up a separate agent. Generation runs on the model you've configured in DeepSeek Harness. Writing rules can be exported as a DSH Skill for the harness to reuse. More writing actions will be wired into DSH's own session as Skills / tools over time.

<br>

## Draft it in one click

The layout appears as soon as you open an idea. The title, cover image, article and illustrations are generated in parallel and appear as each one is ready.

**Note or article, your call.** A note uses short blocks, made for RedNote. An article is written in full paragraphs, made for WeChat Official Accounts and Zhihu. Both get a headline, and both stay close to the style and reference you chose.

**Edit on the page.** Edit the article paragraph by paragraph and copy it with one click; the title, cover text and illustrations can each be regenerated, and every step can be undone.

**Take it with you.** Copy the article, or save the whole piece (cover and illustrations) to one folder.

<br>

## The idea wall

**One line, one idea.** Text, links, images, videos and quotes all become cards. They line up on the wall by time, and cards on the same thread can fold into a capsule.

**Related ideas come to you.** Type "agent" and press Enter. Your new idea is saved, and every earlier idea that mentions agents moves next to it, sorted by relevance.

<br>

## Schedule

**One calendar for ideas and posts.** Each day you capture an idea gets a stamp, so you can see your streak. Drag a finished piece from the side list onto a day to schedule it. Your next post is always pinned in the top right.

<br>

## Insights

**See what worked, and keep doing it.** Enter numbers by hand, paste a CSV, or import your own account. You'll see daily reads, a breakdown by platform and your top pieces in one place.

Turn a suggestion into a writing rule with one click and it applies to everything you write next. Rules can be exported as a DeepSeek Harness skill.

<br>

## Styles

**Pick a voice.** Fifteen creator presets in eight categories: tech, travel and food, lifestyle, opinion, tutorials, reviews, stories and news. Pick one and start writing.

**Or use your own.** Import your account or paste a few of your posts, and Writing Desk learns your style into a card you can edit.

The content board shows where every piece stands: idea, outline, draft, ready or published.

<br>

<a id="get-started"></a>
## Get started

Requires DeepSeek Harness `0.2.1-rc.5` or later in the `0.2.x` line. Tested on `0.2.2-rc.1`, desktop and web.

**1. Install.** Open **Plugins** in the DeepSeek Harness sidebar and switch on the experimental index support: on DSH `0.2.2` and later it is **Custom plugin indexes** under **Experimental plugins**; on the `0.2.1` line it is **Custom plugin markets**, under **More** beside **Experimental plugins**. The page then shows the **Installed** and **Discover** tabs.

Switch to **Discover** and add this index URL — once is enough:

```
https://raw.githubusercontent.com/jspi-fu/dsh-writing-desk/main/index.json
```

If github.com is hard to reach from your network, use this CDN mirror instead — it can lag up to 12 hours behind the latest release:

```
https://cdn.jsdelivr.net/gh/jspi-fu/dsh-writing-desk@main/index.json
```

**Writing Desk** shows up in the list; install it from there. It installs the same `dsh-writing-desk` npm package, the index just saves typing the package name.

Without the index, go to Plugins → Add plugin, enter `dsh-writing-desk`, and install. You can also install from the command line. Quit the desktop app completely (⌘Q) first and reopen it afterwards. For the web version, restart `dsh web`. If the `dsh` command isn't available in your terminal, choose "Manage dsh command" from the desktop app's menu.

```bash
dsh plugin --profile desktop add dsh-writing-desk
```

```bash
dsh plugin --profile web add dsh-writing-desk
```

**2. Update.** When a new version comes out, the Plugins page shows an update — click it; a command-line install runs the same command again. Writing Desk also checks npm itself (at most once an hour, reading only the version number): when a newer version exists the top bar shows `↑ vX.Y.Z`, Settings shows the version you are on, and the badge opens the npm page with the upgrade command. To install offline, download `dsh-writing-desk-*.tgz` from [Releases](https://github.com/jspi-fu/dsh-writing-desk/releases/latest) and use `"file:$PWD/dsh-writing-desk-VERSION.tgz"` in place of the package name.

**3. Open.** **Writing Desk** appears in the right sidebar. On first launch it's filled with sample data so you can explore every page. Click **Clear sample data** in the top right when you're ready to start with your own.

To uninstall, replace `add` with `remove dsh-writing-desk`. Your content stays in `~/.dsh/writing-desk/`.

<br>

<a id="what-it-costs"></a>
## What it costs

The plugin is free and ships with no API keys. Anything that uses a model runs on your own accounts.

| | What it uses | Without it |
| --- | --- | --- |
| **Article** | The model you've set up in DeepSeek Harness | A structural outline only |
| **Cover image, illustrations** | Your image API key, or a registered DSH subscription image tool, selected in settings | The article still works, and the cover is made from text |
| **Account import** (optional) | Monid, a third-party data service billed per request. Under a cent per TikTok, Instagram or X account; about $0.02 for RedNote. Zhihu is not supported | Enter numbers by hand, or paste posts to learn a style |

Images work with any service compatible with the OpenAI Images API (`POST {endpoint}/images/generations`), and with Alibaba Bailian: Qwen-Image uses the sync endpoint, while Wan 2.5 and earlier use the async task API. OpenAI, xAI, Volcengine Ark, Zhipu, SiliconFlow, Alibaba Bailian, Bailian Token Plan and Bailian Wan (async) come pre-filled, or you can add a custom endpoint. Click **Generate test image** to check that it works. Each draft makes a cover image and several illustrations by default, and you can change that; you can also uncheck **Draw images** before **Draft it** to get text only this time, and draw individual images later. Your key is stored only in the local `settings.json` (file mode 600). It never goes into your content data and is never sent to the text model.

<br>

### Use DSH generation tools

Reuse subscription image generation made available to DSH by a plugin. For example, if a plugin lets you generate images in DSH with a ChatGPT (GPT) subscription, Writing Desk can reuse that capability without a separate image API key. Subscriptions from other services also require plugin-provided image generation supported by Writing Desk; signing in or connecting a chat model alone does not enable it. Currently supports `dsh-plugin-subscriptions`, which controls service and account selection and fallback.

In Settings, choose **DSH generation tools** as the image source to reuse `image_generate` registered by `dsh-plugin-subscriptions` (including its collision alias). No additional API key is needed. Existing HTTP settings (including size and quality) are preserved; tool size and quality are configured separately, and Image API remains the default. Detection only confirms a compatible registration and a direct-call schema from the default executor, not sign-in or quota; **Generate test image** makes a real request and consumes subscription quota. Name/schema checks do not authenticate plugin identity; enable only trusted tool plugins.

The host must support `tools.executable()`, `tools.selectExecutor().describe()` and standalone `tools.execute()` batches (public contracts verified against DSH 0.2.2-rc.1). Calls go through the host execution pipeline without reading credentials or importing subscription-plugin internals. Only images inside the DSH home `plugins/subscriptions/images/` directory are imported into the existing Writing Desk asset workflow. Discovery currently checks only `dsh_subscriptions_image_generate` and `image_generate`, not arbitrary tool names. Other plugins must also match the parameters, output structure and output directory even when the name matches. Tools registered only in an Agent-private scope are unavailable.

This is an independent background service operation, not a call on behalf of the visible chat session: it does not inherit that session's restrictions, historical toggles or account affinity. Global host tool policies and current subscription-tool preferences still apply. Approval-required calls without a suitable session fail closed. The tool owns provider/account selection and fallback (for example, Grok may be used when ChatGPT is logged out); Writing Desk never falls back to HTTP or adds retries to tool requests.

A pure Code Mode / PTC executor currently rejects direct root image-tool calls and is detected as unavailable. Use a native executor supporting direct calls or HTTP images. Missing tools or unsupported host APIs do not affect existing HTTP functionality.

## Import your own account

In Styles or Insights, click **Import account** and paste your profile link. Supported: RedNote, Douyin, Bilibili, TikTok, Instagram and X. Zhihu and WeChat Official Accounts are not supported for import yet; you can still schedule posts for them, and paste content or public links to learn a style. Your latest public posts and their engagement go into Content and Insights, and Writing Desk learns your style from them. Importing again only refreshes the numbers.

The first time, connect [Monid](https://monid.ai) in three steps:

1. In a new DeepSeek Harness session, send `set up https://monid.ai/SKILL.md`. It installs the Monid command-line tool.
2. Sign up at [app.monid.ai](https://app.monid.ai/access/api-keys) and create an API key.
3. In your terminal, run `monid keys add -k YOUR_KEY -l main`. Don't paste the key into a chat.

The plugin only runs the local `monid` command and never sees your key.

<br>

<a id="faq"></a>
## FAQ

<details>
<summary><b>Can I import someone else's account?</b></summary>
<br>

Import only accounts you own. Profile links are sent to Monid and its data providers, so check that this fits your platform's terms. Only public data is available: RedNote and Douyin don't show view counts publicly, so Insights uses engagement instead. RedNote body text is around 100 characters, Douyin gives the caption, and Bilibili mostly titles, so the learned style can be edited by hand. Zhihu, WeChat Official Accounts, WeChat Channels and YouTube can't be imported yet; you can still schedule posts for them, and paste content or public links to learn a style.

</details>

<details>
<summary><b>Can it post for me?</b></summary>
<br>

No. Platforms don't offer a common publishing API, so copy the article or save the folder and post it yourself. Saved folders go to `~/Documents/Writing Desk/` by default and include the article, cover image and illustrations.

</details>

<details>
<summary><b>Where is my data?</b></summary>
<br>

Everything stays on your computer in `~/.dsh/writing-desk/`, shared by the desktop and web versions. No cloud and no sign-up.

</details>

<details>
<summary><b>Does it work without an image model?</b></summary>
<br>

Yes. The article and title are written as usual, and the cover is made from the cover text. Connect an image model to draw the cover and illustrations too.

</details>

<details>
<summary><b>Do I have to generate images every time?</b></summary>
<br>

No. Uncheck **Draw images** next to **Draft it** and that draft gets only the title, cover text and article; you can also change the default in settings. Add images later with **Draw cover** or **Draw this** on any single image. Without an image model, drawing is skipped anyway and the saved cover is composed from text.

</details>

<details>
<summary><b>Is there a chat assistant in the desk?</b></summary>
<br>

No. Writing Desk has no built-in chat assistant or agent. Article generation runs on the model you've configured in DeepSeek Harness, and writing rules can be exported as a DSH Skill for the harness to reuse. More ways to wire writing actions into the harness are on the way.

</details>

<details>
<summary><b>Is this made by DeepSeek?</b></summary>
<br>

No. It's a community plugin. Articles are written by the model you've set up in DeepSeek Harness and billed to your own account.

</details>

<br>

## Development

```bash
npm install && npm test        # host logic tests
npm run watch                  # rebuild when client/ changes
npm run index                  # refresh index.json after a release
scripts/dev-sandbox.sh         # run the web version in an isolated DSH_HOME
node scripts/mock-llm.mjs      # mock text and image models, no quota used
npm pack                       # build the installable tgz
```

`index.json` is the plugin market index; `npm run index` refreshes its version and publish time from the latest npm release, so run it once after every release.

`scripts/mock-monid.mjs` is a fake `monid` command that returns made-up content, so you can test the import flow for free. Wrap it as an executable named `monid` and put it first on your `PATH`.

| Path | Contents |
| --- | --- |
| `client/` | UI: idea wall, studio, content, schedule, insights, styles, settings |
| `src/` | Host routes, drafting pipeline, prompts, image generation, style learning, Monid import, local storage |
| `scripts/` | Bundling, sandbox, mock models, sample asset generation, market index |
| `assets/` | Sample images and videos, all generated by `scripts/gen-assets.py` |

Restart DeepSeek Harness after changing `src/`.

**Security:** Every route is authenticated by the host. Model output and fetched content are reduced to known fields with length limits, and only allow-listed operations run. Pasted links can't reach localhost or private networks. `monid` runs without a shell, and account IDs must match fixed formats. Please report vulnerabilities privately through [Security Advisories](https://github.com/jspi-fu/dsh-writing-desk/security/advisories/new).

<br>

## Thanks

This project is a second development of the community plugin `dsh-media-desk` (Media Desk). Thanks to the original author [蜗牛的科技笔记](https://www.xiaohongshu.com/user/profile/5faedce8000000000101c8a3) and the following people for their early testing, troubleshooting and code contributions:

- [secountAiAccount](https://github.com/secountAiAccount)
- [isxiaokunos](https://github.com/isxiaokunos)
- [townmi (Harry Tang)](https://github.com/townmi)
- [zach22-1999](https://github.com/zach22-1999)
- [chenxupeng1990-eng](https://github.com/chenxupeng1990-eng)
- [dsh-agent-sixtyseven](https://github.com/dsh-agent-sixtyseven)
- [smallflycar](https://github.com/smallflycar)
- [cofftea114](https://github.com/cofftea114)
- [Feahter](https://github.com/Feahter)
- [TerryWang9112 (Terry)](https://github.com/TerryWang9112)
- [ytzhangFTD](https://github.com/ytzhangFTD)
- [giuliano1101](https://github.com/giuliano1101)
- [wmaly13](https://github.com/wmaly13)

Also thanks to the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) team for the open plugin system.

<p align="center"><sub><a href="LICENSE">MIT</a> · A community plugin, not affiliated with DeepSeek. DeepSeek Harness and its marks belong to their respective owners.</sub></p>
