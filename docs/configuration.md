# Configuration

Tickler has two kinds of setting: a small amount of **instance config** the host
stores for it, and a larger amount of **per-browser preference** it stores
itself. Nothing here is per-user on the server.

## Instance settings

Paperclip generates a settings form for every plugin from its manifest. Tickler's
lives at:

```
/<COMPANY-PREFIX>/company/settings/instance/plugins/<plugin id>
```

![The host's plugin settings page for Tickler](screenshots/plugin-settings.png)

**Demo mode** — serve the whole HUD from a bundled fixture instead of this
instance. See below.

**Demo data URL** — *currently ignored.* The field is declared in the manifest
and the host renders it, but nothing reads the value; the fixture is always
loaded from the copy shipped with the plugin. Do not rely on it until this note
goes away.

> Paperclip stores plugin config **per company**, while Tickler is a cross-company
> page. So ticking Demo mode for *any one* company turns the whole page into a
> demo. Reading the setting costs one `/api/companies` call at mount, to work
> out which config row to ask for; nothing real is rendered while that resolves.

## Demo mode

Demo mode serves every read *and write* from a bundled fixture: four invented
companies (Acme Robotics, Globex Analytics, Initech Payments, Umbra Logistics),
~40 tickets, ~22 agents, live runs, approvals, an overdue routine and a company
in the red. Enough that every surface has something to draw.

It exists so the page can be screenshotted or demonstrated without putting real
company names, ticket titles or agent chatter on screen. Every image in these
docs is demo mode with nothing else done to it.

### Turning it on

Two switches:

- **`?demo=1`** on the Tickler URL. Sticks for the rest of the browser session, so
  Tickler's cross-company links (which do a full document load) stay in demo.
  `?demo=0` leaves. This is the switch to reach for mid-demonstration.
- **The Demo mode checkbox** on the settings page above. This is the durable
  one. Changing the checkbox drops any remembered `?demo=` override, so the
  setting can always take control back.

While it is on, the header carries an orange **DEMO DATA** badge. That is
deliberately hard to miss: a screenshot of this page is meant to be shareable,
which only works if nobody can mistake the fixture for a real instance.

### What it substitutes

Every read and write in the HUD funnels through one function, and demo mode
replaces that function. So approvals can be approved, interactions answered and
comments posted during a walkthrough, and none of it reaches the server. No
component knows demo mode exists, which is why none of them can leak real data
by forgetting about it.

It **fails closed**: if the fixture cannot be loaded, Tickler shows an error
rather than falling back to real data.

### Editing the fixture

The fixture is a real file at `dist/ui/demo-data.json`, served out of the
plugin's own asset directory — so renaming a company or rewording a ticket is an
edit plus a reload, no rebuild.

For anything structural, edit the tables at the top of
`scripts/gen-demo-data.mjs` and regenerate. A test asserts the committed JSON
matches the generator's output, so hand-edits to `src/ui/demo/demo-data.json`
fail CI.

```bash
pnpm demo:data   # regenerate src/ui/demo/demo-data.json
pnpm build       # copies it to dist/ui/demo-data.json
```

Timestamps in the fixture are relative tokens (`"@t:-5m"`, `"@d:-3"`) resolved
against page-load time, so the demo never reads as months stale no matter when
it is shown.

## Version and updates

The **gear** in the page header opens a panel whose first row is the version of
Tickler this instance has registered, and whether npm has a newer one:

```
Tickler 0.7.1   0.8.0 is available          [ Update to 0.8.0 ]
```

**Update to 0.8.0** does it in place. There is no uninstall step and nothing to
re-enter: Paperclip re-runs `npm install` for the version named on the button,
re-reads the manifest and re-registers Tickler against its existing config row,
then the page reloads onto the new build. The same button appears as a chip in
the header when an update is waiting, so it is one click from the board.

Five things worth knowing:

- **Instance admins only.** Paperclip's upgrade route requires it; anyone else
  gets told so rather than a silent failure.
- **It is quiet when it cannot tell.** The check reads
  `registry.npmjs.org/paperclip-plugin-tickler/latest` from the browser, and an
  instance with no route out just says so in the panel — no chip, no button,
  nothing that would 400 if you pressed it.
- **A version that asks for a new capability is refused**, by Paperclip and not
  by Tickler: capabilities are granted at install. The panel says to uninstall
  and reinstall, and the release notes flag such a version.
- **You can go back, too.** **Install an earlier version**, under the same
  row, asks npm for every published release older than the one you are on and
  installs the one you pick, in place, the same way. If a version crashes,
  the error notice offers **Roll back to x.y.z** directly — see
  [troubleshooting](troubleshooting.md#a-pane-or-the-page-shows-an-error-notice).
- **A local checkout updates differently.** Installed from a path rather than
  npm, the panel says so and the affordance you want is the **Reload** chip —
  see [install.md](install.md#upgrading-tickler).

## Token thresholds

The **gear** in the page header opens the token panel, below the version row.

![Token thresholds, with every company plotted against the bands](screenshots/token-thresholds.png)

Two numbers — **warn** and **critical** — applied to a company's tokens for the
current calendar month. They colour the Tokens column on the board and feed the
heat sort.

Two scopes: a **default** that applies to every company, and an optional
**override** per company. Inheriting is the absence of an override rather than a
copy of the default, so raising the default afterwards still moves everyone who
never opted out.

They are sliders rather than number fields because the useful question is not
"what number" but "where does this line fall relative to my companies" — which
the rail below the sliders answers by plotting each company's actual usage
against the bands. Dragging one line past the other pushes it rather than
clamping, so a drag never silently stops moving.

Defaults are 250M (warn) and 500M (critical).

## Alerts

The **bell** in the header toggles browser notifications. Off by default.

Turning it on asks for notification permission only while the browser has not
yet been asked. Tickler raises an alert on an *edge* — a company going red, a
critical attention item arriving, a CEO heartbeat going overdue — not on every
poll that finds the condition still true.

## Kiosk mode

The **expand** control in the header fullscreens the HUD and bumps its type
scale by roughly 1.3× — for a wall display or a TV across the room. Exit with
the same button, `Esc`, or your browser's own control.

It is deliberately not persisted: it always starts off, and fullscreen state is
read from the browser rather than remembered, since fullscreen can be left by
means Tickler never sees.

## What Tickler remembers

All of this lives in `localStorage`, per browser. Nothing is stored on the
server, so it does not follow you between machines.

| Key | What |
| --- | --- |
| `tickler.pinned` | Companies pinned to the top of the board. |
| `tickler.sort` | Board order: your order, or hot first. |
| `tickler.queueGrouping` | Queue grouping. |
| `tickler.queueSort` | Queue age tiebreaker. |
| `tickler.queueAgeFilter` | Queue age chip. |
| `tickler.portfolioSort` | Portfolio order. |
| `tickler.alerts` | Alerts on/off. |
| `tickler.tokenThresholds` | Token defaults and per-company overrides. |
| `tickler.lastVisit` | Drives the briefing strip. Refreshed on mount and every 5 minutes. |

Two things are deliberately **not** remembered: the board's company focus (a
glance, not a habit — a new visit should start on the whole portfolio) and
kiosk mode.

Clearing site data resets all of it to defaults. Nothing breaks; the page just
starts over.

## How often it polls

Per dataset, not one interval for everything, and **nothing polls in a hidden
tab**:

| Every | What |
| --- | --- |
| 5s | Company summary, live runs, attention feed. |
| 15s | Approvals. |
| 30s | Agents. |
| 60s | Issues, projects, routines. |
| 5m | Token spend. |

Countdowns and elapsed times are computed at render, so they stay live between
fetches.
