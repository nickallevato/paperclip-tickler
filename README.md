<p align="center">
  <img src="https://raw.githubusercontent.com/nickallevato/paperclip-tickler/main/docs/brand/tickler-icon.png" width="96" height="96" alt="Tickler">
</p>

<h1 align="center">Tickler</h1>

<p align="center">
  <strong>Every org. One page. What needs you, right now.</strong><br>
  A cross-org HUD for <a href="https://github.com/paperclipai/paperclip">Paperclip</a>.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/paperclip-plugin-tickler"><img src="https://img.shields.io/npm/v/paperclip-plugin-tickler?logo=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/paperclip-plugin-tickler"><img src="https://img.shields.io/npm/dm/paperclip-plugin-tickler?color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/nickallevato/paperclip-tickler/actions/workflows/ci.yml"><img src="https://github.com/nickallevato/paperclip-tickler/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/paperclipai/paperclip"><img src="https://img.shields.io/badge/Paperclip-plugin-18181b" alt="Paperclip plugin"></a>
  <a href="https://github.com/nickallevato/paperclip-tickler/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

![The Tickler page: Orgs, Recent, Portfolio and Routines at left; the Needs-you queue, grouped by when you said you'd decide — Today, Unsorted, This week — owning the main column](https://raw.githubusercontent.com/nickallevato/paperclip-tickler/main/docs/screenshots/hero.png)

One page that answers "what needs me, across every org, right now" — and lets you say *when*
you will deal with each thing — instead of visiting each org's dashboard in turn.

- ⚡ **Answer in place.** Approve, reject, reply, pick an option on an agent's question — right on
  the row.
- 🗓️ **Decide by.** Say *when* you'll deal with each item — Today, This week, Whenever — and the
  queue sorts itself. It's Paperclip's own decision triage, so the dates follow you there.
- 🏢 **Every org at a glance.** Who's working, token burn by the hour, what's waiting on you.
- 👀 **What agents are actually doing.** Hover any agent or task for its live narration — not
  just "3 running".
- 🚦 **Trouble surfaces itself.** Blocked projects, stalled runs, failed routines, overdue
  heartbeats.
- 📱 **Works on a phone**, and 🧩 **changes nothing in core** — UI-only, prebuilt, and fits
  whichever Paperclip build it lands on.

> **📦 Install from inside Paperclip — no terminal needed.**
> **Settings → Plugins → Install Plugin**, enter **`paperclip-plugin-tickler`** as the npm Package
> Name, and click **Install**. That's it — Tickler's button appears in the bar at the top of the page.
>
> You need to be an instance admin, on a self-hosted Paperclip whose server can reach npm.
> Prefer the command line, or building from source? See [Install](#install).

**Need a tweak or change?** Join the [Paperclip Discord](https://discord.com/channels/1478750559191302299/1532477301004959846)
and hop into the **Tickler thread** — that is where feature requests, bug reports and "is this
supposed to do that?" land. Tickler is a community plugin, not an officially supported part of
Paperclip, so please bring Tickler's rough edges here rather than to Paperclip's own issues. The
same link lives behind the **?** in the Tickler page header.

## What it shows

**Queue** — the main column. Every item across every org that wants a human: approvals, questions
and confirmations awaiting a response, blockers, failed runs, overdue heartbeats, routine
exceptions. Actions are inline — Approve, Reject, Reply, answer a question, choose on a
confirmation — so you rarely need to open the org at all.

![The Needs-you queue in its default grouping: a Today group with an overdue blocker, then Unsorted, where each new row offers Today, This week and Whenever beside its own Open, Approve, Reject or Reply](https://raw.githubusercontent.com/nickallevato/paperclip-tickler/main/docs/screenshots/needs-you.png)

By default it groups by **when you said you'd decide** — Today (and anything overdue), Unsorted,
This week, Alerts, Whenever, Snoozed. New items land in Unsorted with **Today · This week ·
Whenever** right on the row. Those are Paperclip's own decision-triage records, so a day set in
Tickler is the day Paperclip's Decisions page shows. It can also group by severity, org, kind,
project or age — by project is how you find the one project quietly generating half the noise.

**Orgs** — the left column: one line per org with who is working, its tokens by the hour over the
last 8 or 24 hours, and how much is waiting on you. Hover a name for everything else; hover a capacity square for which agent it is
and what they are doing right now. Beneath it the rail stacks Recent, Portfolio and Routines, so
the whole column is one scan: who's working, what just moved, what's stuck.

<img src="https://raw.githubusercontent.com/nickallevato/paperclip-tickler/main/docs/screenshots/left-rail.png" alt="The left rail: the Orgs list with hourly token bars, then Recent, Portfolio and Routines" width="424">

**Recent** — what's been touched lately, live rows first. Hover a row for the ticket, its status,
and the agent's own last sentence about it.

<img src="https://raw.githubusercontent.com/nickallevato/paperclip-tickler/main/docs/screenshots/recent-hover.png" alt="A Recent row's hover card: the ticket, its status, and what the agent last said" width="424">

**Routines** — only the broken ones, plus any you pin with the **+**: a pinned routine stays on
top with a ▶ to run it now (press twice; it links the issue the run made).

**In the header** — the gear names the version you are on and offers the newer one in place
when npm has it, and holds the [token thresholds](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/configuration.md#token-thresholds) that colour the spend
figures; the bell turns on browser [alerts](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/configuration.md#alerts) for the edges worth knowing about (an org going
red, a critical item arriving); the expand control is [kiosk mode](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/configuration.md#kiosk-mode), for a wall display.

Full tours, with the rest of the screenshots: [the board](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/board.md) · [the queue](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/queue.md).

> **Note:** The screenshots are Tickler's own [demo mode](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/configuration.md#demo-mode) —
> invented orgs, tickets and agents, not a real instance. Try it on your own install: add `?demo=1`
> to the Tickler page's URL (e.g. `/ACME/tickler?demo=1`). Nothing you click there reaches the
> server, and the header carries a **DEMO DATA** badge the whole time it is on.

## Install

You need an **instance admin** account on a **self-hosted** Paperclip whose server can reach the
npm registry. Nothing is built on your side: the package ships prebuilt and carries nothing tied
to a particular Paperclip build, so upgrading Paperclip later needs nothing from Tickler.

**In Paperclip:** **Settings → Plugins → Install Plugin**, enter `paperclip-plugin-tickler` as the
npm Package Name — just the name, no `@`, no version — and click **Install**.

**From the command line:**

```bash
npx paperclipai plugin install paperclip-plugin-tickler    # install
npx paperclipai plugin upgrade nickallevato.plugin-tickler # upgrade in place
```

**From source**, for working on Tickler:

```bash
git clone https://github.com/nickallevato/paperclip-tickler.git
cd paperclip-tickler && pnpm install && pnpm build
npx paperclipai plugin install /absolute/path/to/paperclip-tickler --local
```

**Then find it.** Tickler adds a button carrying its mark to the breadcrumb bar above every page,
and a page at `/<COMPANY-PREFIX>/tickler` — `/ACME/tickler`, say, using any company's issue
prefix. The page shows every org whichever prefix you arrive through; the prefix is only there
because Paperclip mounts plugin pages under a company route.

[docs/install.md](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/install.md) covers every route in detail: upgrading, the directory layout a clone
needs for its `link:` dependencies, and how to check the plugin actually loaded. If the page comes
up blank, [troubleshooting](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/troubleshooting.md) works through it in order.

## Documentation

[install](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/install.md) · [configuration](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/configuration.md) · [the board](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/board.md) · [the queue](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/queue.md) ·
[architecture](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/architecture.md) · [troubleshooting](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/troubleshooting.md) · [release notes](https://github.com/nickallevato/paperclip-tickler/tree/main/docs/releases/)

## Contributing

Bugs and feature requests go through the three issue templates — feature request, bug report, or
core limitation. [docs/intake.md](https://github.com/nickallevato/paperclip-tickler/blob/main/docs/intake.md) is the whole path from there to a merged change. You get an
answer either way: a duplicate is closed pointing at the original, and something real but not now
is *parked*, not closed, and reopens on a sentence. Not sure it is worth an issue yet? Say it in
the [Tickler thread](https://discord.com/channels/1478750559191302299/1532477301004959846) on the
Paperclip Discord first.

To send a change, read [CONTRIBUTING.md](https://github.com/nickallevato/paperclip-tickler/blob/main/CONTRIBUTING.md) — and before anything else, the one rule:
**Tickler never modifies Paperclip core.** Everything lands here, through a plugin extension
point. If the plugin surface cannot express a change, file it as a core limitation rather than
working around it. CI enforces this, with no bypass.

<sub>Formerly **Plica** (`paperclip-plugin-plica`, through 0.6.0). MIT licensed.</sub>
