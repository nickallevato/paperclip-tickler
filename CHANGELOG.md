# Changelog

Short-form. The reader-facing write-up for each version is in
[`docs/releases/`](docs/releases/).

## Unreleased

- **"+2 more" now tells you something.** The count in a rail pane's header
  used to say only that rows were out of view. It now follows the scroll: "2
  more ↓" while rows are below, "2 more ↑" once you have scrolled past them. It
  is a button that scrolls a page that way. In Orgs it also says when an org
  out of view needs you, as "1 more · 5 need you", in the same colour as the
  need-you column, and its tooltip names the orgs. On the narrowest rail it
  shortens to "5 need you".

## 0.14.1

- **The Orgs header stays on one line.** 0.14.0 put the **8h | 24h** switch in
  the Orgs header, which squeezed the "tokens · need you" caption onto a second
  line at most rail widths. The switch now sits on the All line at the bottom of
  the pane, under the charts it controls, in place of the "· last 24h" text.
  The caption drops words instead of wrapping on a narrow rail. With only one
  org there is no All line, so the switch takes the place of **Hot first | My
  order** in the header.

## 0.14.0

- **See which org used tokens, hour by hour.** Each line in Orgs now has a
  small bar chart of that org's tokens, one bar per hour, and its total, with an
  **8h | 24h** switch in the header. All lines share one scale, so the org that
  used the most stands out, and any hour with usage gets a visible bar, so a
  quiet org is never drawn as idle. It counts fresh tokens (input and output);
  cache reads are in each bar's tooltip. The bottom line adds every org
  together. The chart takes the place of runs per day on the line; runs per day
  is still in the detail card, and comes back on the line if the chart can't
  read run telemetry.

## 0.13.1

- **Pinned routines no longer give the left rail a scrollbar.** 0.13.0 drew
  pinned rows on top of the Routines pane without counting them against the
  rail's height, so with a few pins the rail outgrew the window and scrolled.
  Pinned rows now share the rail's height like every other row, and they come
  first: Orgs and Recent give up their extra rows to seat them, and on a window
  too short for both, Portfolio folds to its header before a pin does. Pins that
  still don't fit fold behind **+N more** in the Routines header and scroll
  inside the pane, never the rail. A pinned row is also the same height as a
  broken routine's row now, so the pane never ends in a part row.

## 0.13.0

- **Pin routines and run them from Tickler.** The **+** in the Routines pane
  header lists every routine across your orgs; pin one and it stays at the top
  of the pane whatever its health, with when it next runs (or last ran) and a
  ▶ button. The first press arms it (**Run?**), a second press within three
  seconds starts it, and the row then links the issue the run created. A
  routine with a required variable that has no default opens a small form in
  the row instead. Runs use the routine's default project, assignee and
  workspace — the same call as **Run now** on Paperclip's Routines page, so
  the host's permissions apply. A pinned routine that is also failing, blocked
  or overdue says so in its pinned row rather than twice. Pins are per
  browser, like watched orgs.

## 0.12.2

- **Queued runs in Recent are named, and a long queue no longer fills the
  pane.** On a big company most queued rows read **system**: Tickler loads 200
  tickets per company, the host returns them priority first, and a ticket
  outside those 200 left the row with nothing but the run's trigger label. On
  a 1,509-ticket board that was 13 of the 17 tickets with live runs. Tickler
  now fetches those tickets by id, so every queued row shows its key and title
  — and so does the hover on the agent capacity strip. A ticket that still
  cannot be found reads `<agent> · Waiting for a runner`, never **system**.

  Queued rows now say `queued 6m` rather than a bare `6m`. Working rows all
  show, as before; queued rows stop at three, and the rest fold into one
  `12 more queued` line that lists their tickets on hover, so the tasks you
  touched today keep their rows. The header still counts every queued run.

## 0.12.1

- **Expanding Orgs no longer folds Recent.** 0.12.0's Orgs toggle folded Recent,
  Portfolio and Routines; now it folds only Portfolio and Routines, the same two
  Recent's toggle folds. Recent keeps its ordinary size, up to twelve rows, and
  shares the freed height with Orgs — topped up to its twelve first, every row
  after that going to Orgs. On a 2560×1400 desktop with 22 orgs that is 13 orgs
  and 12 recent tasks, where 0.12.0 gave 21 orgs and no Recent; a 1512×790
  laptop, where Portfolio is already folded, gains only a row each. Still one
  pane expanded at a time.

## 0.12.0

- **Orgs can be expanded too, and the three panes under it fold to pay for it.**
  The same toggle Recent got in 0.11.0, at the end of the Orgs header. Orgs is
  the pane with no cap of its own — it wants every org you watch — so on a rail
  that cannot seat them all it has been saying `+15 more` and leaving you to
  scroll. Pressing it folds **Recent**, **Portfolio** and **Routines** to a
  single header line each, digests kept, and the height goes to the org list. On
  a 2560×1400 desktop with 22 orgs that is 7 visible rows becoming 21; on a
  1512×790 laptop, 4 becoming 8.

  Three panes rather than Recent's two because Orgs is at the top of the rail,
  so Recent is just the largest of its neighbours. When every org already fits
  the toggle is **disabled** rather than folding three panes for a list that is
  already complete — which is also the case one column, where the pane draws all
  of them anyway.

  **One pane at a time:** expanding Orgs collapses Recent and vice versa, since
  the height either is asking for is the height the other would be folded to
  free. A Recent expansion saved by 0.11 carries over.

## 0.11.1

- **Expanding Recent now actually lengthens Recent.** Two things were wrong with
  the toggle 0.11.0 shipped, and on a quiet board they cancelled out to "the
  expand only expands the orgs list".

  The pane got twice the height and twice the row cap, but the list still only
  reached back **one day** — and a day is three or four tasks on a real board, so
  Recent was already showing everything it had and the extra height went to
  rows that did not exist. Expanded, it now reaches back **seven days**, which is
  where the rows come from; the same board that has four tasks in a day has
  nearly thirty in a week. The header says which window it is on (`7 days`), the
  footer counts what is left over "this week", and when a week holds no more than
  the day already shows, the toggle is disabled rather than folding two panes to
  make room for nothing.

  And the height the fold freed was not going to the pane that asked for it.
  **Orgs** has no row cap — it wants every org you watch — so it could always
  take another row, and the budget hands the spare height out one row at a time
  to every pane that can still grow. Half of what the fold freed went to Orgs, at
  half again the price, an org row being taller than a Recent row. Recent is now
  filled to its rows first; Orgs keeps its minimum and takes what is left.

## 0.11.0

- **Recent can be expanded to twice the list, and the two panes under it fold to
  pay for it.** A toggle at the end of the Recent header. The rail's height is
  fixed and shared out, so a longer list is not free: pressing it folds
  **Portfolio** and **Routines** to a single header line each, keeping their
  digests — `35 open · 5 blocked`, `3 need attention` — so what they were
  telling you survives the fold without being drawn a row at a time. On a
  1512×790 laptop that is 4 visible Recent rows becoming 11. The model's own cap
  doubles with the pane (16 rows to 32), because a doubled pane fed the same
  sixteen would run out of list halfway down its new height. **Orgs** is left
  alone — it is how you steer the board — and on most screens it picks up a row
  from the height freed below it. One column there is no rail height to trade, so
  the toggle doubles Recent's own cap instead, 4 rows to 8. Saved in that browser
  only, like the pane order.

  No new layout machinery: a pane spec gained a "header only, whatever the
  height" flag, which is the state the height budget already demotes a pane to on
  a short screen. So Portfolio and Routines needed no second rendering path, and
  a folded pane cannot quietly grow back when the window does.

## 0.10.0

- **A `?` in the header, and one line at the top of the README: where to take a
  tweak or a change.** Both point at the **Tickler thread** on the Paperclip
  Discord, and both say the thing that was nowhere on the page before — Tickler
  is a community plugin, not an officially supported part of Paperclip. Somebody
  who has just hit a rough edge had no way to tell which of the two projects to
  be annoyed at, and the nearest obvious target was Paperclip's own issue
  tracker, where nobody who can fix Tickler is reading. The panel renders inline
  rather than portalled to the page, so it still appears in kiosk mode, where a
  body-level popup would open invisibly behind the fullscreen view.

## 0.9.2

- **The board page no longer scrolls 8px over nothing.** 0.9.1 took the
  scrollbar off the rail's panes and left one on the page itself: on a quiet
  board — a short queue, where the left rail is the tallest thing on the screen
  — the page offered a scrollbar, scrolled exactly 8px, and showed nothing you
  had not already seen. The rail is told how tall it may be, and it kept a fixed
  16px under itself for the gap it pins at; what is actually under it is the
  board's own 24px of padding. Eight pixels of content with nothing in them, on
  every window wide enough to lay the rail out beside the queue. The rail now
  measures what the layout puts below it — stretched past everything else on the
  page for one layout pass, so its column decides `scrollHeight` and what is left
  over is the answer — instead of assuming it matches the gap above.

  It survived the first fix because demo mode's queue is long enough to scroll
  the page on every screen, and a page already scrolling for the queue hides a
  rail that is a few pixels too tall for its box. `pnpm check:scroll` now checks
  each of its 32 screens twice, the second time with the queue bounded, where
  the page has to answer for its own scrollbar: 24 of the 32 failed that pass
  before this change, none do now.

## 0.9.1

- **A rail pane with nothing left to show no longer scrolls.** On any window
  1080px tall or taller, Routines in the left rail had a working scrollbar and
  one pixel to scroll — while its own header said it was showing every row there
  was. The layout was not at fault; the measuring was. The rail sizes itself and
  hands each pane a height of "header plus a whole number of rows", and it
  measured with `offsetHeight`, which is a rounded integer, where a rail row is
  not: a Routines row is 28.297px tall and reported 28, so three of them were
  budgeted 84px to hold 85.125px of rows. The pane was pinned a pixel short of
  its own contents and dutifully offered to scroll. Heights now come off
  `getBoundingClientRect()`, the pane's frame is read from its computed border
  and padding rather than the difference of two rounded integers, and the
  rounding happens once, upwards, on the only number handed out.

  One visible consequence, because the old arithmetic was flattering itself:
  where a pane used to fit in a row by under-measuring it, it now admits it
  cannot. At 1920×1080 Routines shows two rows and a `+1 more` where it showed
  three before — the third of them a hair clipped behind the scrollbar this
  fixes.

  A new `pnpm check:scroll` sweeps the board at 32 window sizes in a real
  browser and fails on any box that scrolls while its pane claims to be showing
  everything. Nine of the 32 screens failed before this change; none do now.

## 0.9.0

- **The narrow board's panes are yours to order.** On one column the page is a
  stack — Orgs, the queue, Recent, Portfolio, Routines — in an order nobody
  chose, and which one you want on top depends on what you opened the phone
  for. A **Pane order** button now reorders it — it joins the header's own row
  of toggles, beside token thresholds, alerts and kiosk, which is the family it
  belongs to. Open it and drag the rows by their grips; there is no mode to
  enter first, because the five rows are not commands and reordering them is the
  only errand the menu has. It borrows its grips from Paperclip's own Orgs
  switcher, which does hide them behind an **Edit** toggle — that menu's usual
  job is switching orgs, and this one has no usual job to protect. The wide
  board is untouched and cannot be otherwise: at two columns the panes' order is
  overridden away, so the button is not offered there at all.

  The order is saved **in that browser only** — it will not follow you from your
  phone to your desktop. That is a limit rather than a choice: a plugin has
  nowhere on the server to keep a preference of its own, and inventing a
  half-working sync would be worse than saying so.

## 0.8.2

- **A merge to `main` releases itself.** Pushing a `v*` tag has published
  unattended since 0.6.0, but everything before the tag was done by hand — pick
  the version, rename the changelog heading, write it into `package.json` and
  `src/manifest.ts`, write the release page — and nothing said a tag was due. So
  0.8.0's self-update button was finished and sitting on `main` with no release
  to put it in. Now the merge is the release: the `release` workflow reads the
  conventional-commit subjects since the last tag, and a `feat`, `fix`, `perf` or
  `revert` among them means it picks the version, writes all four declarations,
  generates the release page from the changelog entries, commits and tags on
  `main`, and publishes — in one run, so the publish still comes from
  `release.yml` where npm's trusted-publisher entry expects it. A merge carrying
  only chores, docs, CI or a refactor publishes nothing and spends no version
  number. A new `release plan` check on every pull request names the version
  merging it will publish, and fails a releasing pull request that has no
  changelog entry for it — because that entry is now the release page rather
  than something to tidy up before tagging.
- **The README is half the length.** It had grown to 283 lines and ten
  screenshots, most of them duplicating a tour page. It now leads with the hero
  and keeps only the three current shots — `hero.png`, `needs-you.png`,
  `left-rail.png`, plus the Recent hover card — and points at
  [docs/board.md](docs/board.md) and [docs/queue.md](docs/queue.md) for the
  rest. The build-internals essays moved out verbatim to a new
  [docs/architecture.md](docs/architecture.md): the source layout, the host
  stylesheet subtraction, the vendored core components and the dev commands.
  `phone.png` now illustrates the stacking paragraph in `docs/board.md`, where
  that behaviour is described. Docs only; nothing in the plugin changed.
- **The docs say what the header does, and every link resolves.** The README
  covered the board and the queue but nothing in the page header, so the gear's
  version-and-update row, the token thresholds, the alerts bell and kiosk mode
  were documented only for someone who already knew to go looking; it now names
  all four in a line and points at
  [docs/configuration.md](docs/configuration.md). It also says where Tickler
  turns up once installed — the breadcrumb button and the
  `/<COMPANY-PREFIX>/tickler` page — which the install section had left to the
  screenshot, and states the two prerequisites (instance admin, self-hosted with
  npm reachable) before the first command rather than only inside the callout.
  `docs/install.md` pointed at a README section that moved to
  `docs/architecture.md` in the consolidation above, and `docs/releases/0.3.0.md`
  still linked a `#…-rebuild-plica` anchor from before the rename; both now land.
  `docs/README.md` says once that Paperclip's *companies* and Tickler's *Orgs*
  are the same thing, since the pages use both words. Docs only.

## 0.8.1

- **A new lead image on the README.** The old one was the full-height page shot
  from `docs/screenshots/tickler-page.png`, which is taller than a reader's
  screen and shows the queue in its decide-by grouping. The README now leads
  with `docs/screenshots/hero.png`: one viewport, the host's own chrome around
  it, and the queue sorted by severity into Now / Soon / Later. It is
  hand-captured and listed as such, so `scripts/capture-screenshots.mjs` no
  longer owns it; `tickler-page.png` is untouched and still what
  [docs/install.md](docs/install.md) shows.

No plugin change — the build published for 0.8.1 is 0.8.0's.

## 0.8.0

- **The left rail spends the height it has.** It used to be four cards each with
  its own pixel scroll cap — 256px of Recent, 160px of Routines, and no cap at
  all on Orgs, so every org you watched pushed the panes below it down until
  Portfolio was off the bottom of the screen. The rail is now pinned to the
  viewport, measures itself, and gives each pane a height of its header plus a
  whole number of measured rows: everyone gets the fewest rows worth drawing,
  then the surplus goes out one row at a time in rank order — Orgs and Recent
  first, Portfolio and Routines equal behind them, so a short screen is spent on
  the two panes worth reading. No pane ends in
  a row cut in half, a pane holding rows back says `+8 more`, one the rail cannot
  seat falls back to its header instead of being clipped, and a taller monitor
  goes into the panes rather than into a scrollbar. The layout studies behind it
  are in [docs/mockups](docs/mockups/README.md).
- **Tickler updates itself from a button.** Moving to a new version meant
  uninstalling and reinstalling the plugin, which throws away its config row —
  Paperclip's Plugin Manager has no update button, though the server has had the
  endpoint all along. Tickler now checks npm for a newer version of itself and
  offers it: an **Update to 0.x.y** chip in the page header, and the same button
  on a new first row of the gear panel that names the version you are on.
  Pressing it upgrades in place, keeps your settings, and reloads onto the new
  build. Instance admins only, silent when npm cannot be reached, and it stands
  down for a local-path install — there the **Reload** chip still owns updates.
- **The npm OIDC diagnostic no longer guesses why npm refused.** The registry
  answers `404 ... package not found` both when a package has no trusted
  publisher entry and when it has one that does not match the run, so the old
  message — a hardcoded list of what the fields were supposed to be — read as a
  verdict it could not support, and `publish-npm.mjs` separately claimed the
  entry was missing. Both now say the 404 is ambiguous and name the case that
  produced it: a repository rename leaves entries pointing at the old path.
  On a refusal the script decodes its own OIDC token and prints the
  `repository`, `repository_owner`, `workflow_ref` and `environment` claims the
  run actually presents, which is the half of the comparison npmjs.com cannot
  show. Never the token itself.
- **A `npm oidc diagnostic` workflow runs that probe on demand**, so answering
  "does the trusted publisher entry match?" no longer costs a throwaway branch
  and a failed release. It holds `contents: read`, installs nothing and takes no
  npm token; it cannot publish.

## 0.7.1

- **The board's left column no longer runs off the bottom of the page.** It is
  pinned inside Paperclip's scrolling `<main>`, which is shorter than the window
  by the height of the host's chrome, but it was capped at the window's height —
  so its last panels were painted below the edge of the scroll area and nothing
  could scroll to them, and the column appeared to move only while the queue on
  the right scrolled. The cap is now measured from the box the column is
  actually pinned in, the column scrolls itself when its panels still do not
  fit, and Portfolio keeps a minimum height instead of being squeezed to a bare
  heading.

## 0.7.0

- **Plica is now Tickler.** A tickler file is the office folder of dated
  reminders you work through by due date, which is what the decide-by queue is.
  Everything is renamed: the npm package (`paperclip-plugin-tickler`), the
  plugin id (`nickallevato.plugin-tickler`), the route (`/:companyPrefix/tickler`),
  CSS classes, browser-storage keys and the repository. There is no migration:
  uninstall Plica and install Tickler, re-enter the token thresholds, and saved
  view settings (pins, layout, filters) start fresh.
- **The README has a header, badges and a highlights list**, and its images and
  links are absolute, so the npm package page renders the same as GitHub.
  `package.json` gets a fuller description, more keywords, and `homepage`/`bugs`
  pointing at the repository.
- **A failed publish says which credential to go and fix.** npm's two rejections
  here are both misleading: `ENEEDAUTH` in a workflow run means the package has
  no trusted publisher, not that the runner needs `npm adduser`, and a `403`
  from a working token means the token is read-only, not that the account is
  wrong. `scripts/publish-npm.mjs` already knows which credential it used, so it
  now prints the matching explanation. Both are written up in
  [docs/releases/README.md](docs/releases/README.md#what-npms-two-credential-errors-actually-mean).
- **A refused trusted publish reports the registry's reason, not `ENEEDAUTH`.**
  npm asks GitHub for an OIDC token, trades it with the registry for a publish
  credential, and on refusal discards what the registry said — leaving one error
  that means both "no trusted publisher" and "an entry that does not match this
  run", with a tag push as the only way to tell them apart. The new
  `scripts/diagnose-npm-oidc.mjs` repeats those two requests and prints the
  status and message behind them; a failed publish runs it automatically. It is
  read-only, publishes nothing, and logs no credential.

## 0.6.0

- **Releases publish themselves.** Pushing a `v*` tag runs the new
  [`release` workflow](.github/workflows/release.yml), which publishes
  `paperclip-plugin-plica` to npm. It shares one script with a publish by hand
  (`pnpm release:publish`), so both refuse the same things: a tag that disagrees
  with `package.json`, a manifest left on the previous version, a version with
  no changelog entry or release page, and an unclean checkout. `pnpm
  check:release` runs those version checks alone, before there is a tag to
  push. Credentials come from an npm token on the environment — the `NPM_TOKEN`
  Actions secret in CI, the token Paperclip binds to an agent otherwise — or,
  preferably, npm trusted publishing with no token at all; the script prints
  which one it used. See
  [docs/releases/README.md](docs/releases/README.md#publishing-credentials).

## 0.5.0

- **Published to npm as `paperclip-plugin-plica`.** Install it from Paperclip's
  Plugin Manager (**Install Plugin**, then the package name) or with
  `paperclipai plugin install paperclip-plugin-plica`, and upgrade it with
  `paperclipai plugin upgrade nickallevato.plugin-plica`. The package is
  prebuilt, so there is nothing to clone or build. Installing from a git clone
  with `--local` remains the development route.
- **Host-duplicate selectors are subtracted in the browser, not at build time.**
  Plica's sheet is now Tailwind's whole output; at injection, Plica reads every
  selector the page's other stylesheets define through the CSSOM and deletes its
  own class rules the host already has, so a stray `.hidden` still cannot pin
  Paperclip in its mobile layout. The build-time version subtracted against
  whichever Paperclip UI build was on the builder's disk, which went stale on
  every Paperclip upgrade and would have made a published package wrong for
  everyone else's Paperclip.
- **Removed: the "Stylesheet stale" badge and `PLICA_HOST_CSS`.** With nothing
  recorded at build time there is nothing to go stale, so the badge that warned
  about it, the override that pointed the build at a host sheet, and
  `scripts/host-css.mjs` are gone. The build no longer needs a Paperclip UI
  build on disk.
- **Paperclip upgrades no longer need a Plica rebuild.** The one operational rule
  in the README — rebuild Plica after every Paperclip upgrade, host first — no
  longer applies, and one package no longer carries a particular Paperclip
  version's stylesheet baked into it.
- **Plica reloads itself after an upgrade.** After a `git pull && pnpm build`
  that bumps the version, a **Reload 0.x.y** chip appears in the header; one
  click has Paperclip re-read the plugin from disk in place, where it used to
  take a DevTools snippet. Instance admins only. A new version that adds a
  capability shows **Reinstall needed** instead, since Paperclip only grants
  capabilities on a fresh install.
- **"Recent" replaces the live strip.** The full-width row of pills across the
  top of the page is gone; the left column now carries **Recent** — one line per
  task, live ones first and newest first, with the same pulsing dot on the rows
  an agent is on right now and the task's own status glyph on the rest. A row is
  as wide as the column, so the ticket title fits, and a task that has just
  finished stays in place instead of vanishing with its run. The list scrolls
  inside a capped height, so a run starting cannot shove Portfolio or Routines
  down the page.
- **Fixed: the board no longer overflows the viewport at phone width.** Recent's
  rows were as wide as their untruncated ticket titles, which widened the
  single-column grid past the window and clipped every pane in it on the right —
  Orgs lost its runs/day and Need-you figures, and its header lost `need you`.
  Every panel now has a floor of zero width, so the column is the window again
  and the titles truncate.

## 0.4.0

### On a phone

- **Queue rows stay readable at phone width.** A row's actions drop to their
  own line under the title instead of crushing it to "Budget…" and the meta to
  one word per line; the Today / This week / Whenever picks come back there
  instead of hiding.

### Decide by

- **"Orgs", not "companies"**, everywhere Plica labels them: the list, the
  queue and portfolio grouping, the header ("all orgs").

- **The queue owns the page.** The wide company ledger is now a compact
  **Orgs** list in the left column — name, who is working, runs per day,
  and Need you — so the queue takes the main column. Every figure the ledger
  showed (Questions, Blocked, Review, Open, Tokens, the run sparkline, the
  lead agent) is in a card on hovering a company's name, with Watch and Open.
  Narrow, the page stacks Orgs, the queue, then Portfolio and Routines.

- **The queue is grouped by when you'll decide.** Today, Unsorted, This week,
  Alerts, Whenever and Snoozed replace Now / Soon / Later as the default
  grouping (Severity is still one click away). The lanes come from Paperclip's
  own decision triage, so a day set in Plica is the day Paperclip's Decisions
  page shows.
- **Unsorted rows sort in one click**: Today · This week · Whenever sit inline.
- **Every row has a triage menu**: decide by, snooze (1 hour to a week), wake,
  archive. Changes apply immediately and are rolled back with a toast if
  Paperclip refuses them.
- **Snoozed items are away.** They sit folded in the Snoozed lane and nowhere
  else, and they no longer count toward the Needs you badge.
- The header reads *N today (N overdue) · N unsorted · N snoozed*.
- The demo fixture now carries realistic triage (it used to store an instant
  where Paperclip stores a preset or a date), and demo mode accepts the triage
  and archive writes.

### A calmer board

- **Colour marks one thing per row.** The ledger's Questions, Blocked and
  Review counts are plain ink now; only **Need you** carries ochre or brick.
  Every nonzero count used to be ochre, so one question read as loudly as five
  things waiting on you.
- **Critical rows in Now carry an edge, not a band.** A faint tint and a brick
  edge replace the solid pink (maroon in dark mode) fill.
- **Moving work and good runs are sage, not neon.** Portfolio bars, the
  sparkline and answered cards use Plica's new low-chroma `ok` colour.
- **Liveness is Paperclip's own blue**, the same one its nav dots and
  in-progress icons use.
- **The ledger no longer clips its last column.** The totals row was padded
  wider than the rows above it, which pushed the pin and open icons out of the
  card. The sparkline now hides when the ledger is narrow rather than when the
  window is, and the board stacks (ledger and queue first) when there isn't
  room for both columns.
- **One toggle style.** Hot first / My order, Trouble / Company and the queue
  grouping all draw like Paperclip's tabs.
- "Expected every every 1h" on an overdue heartbeat now reads "expected every 1h".

### Paperclip v2026.916.0

- **In-progress tasks draw Paperclip's new spinner glyph.** The host replaced the
  rotate arrow with an open circle that turns (and holds still under reduced
  motion);
  Plica's copy of the glyph had fallen behind, so the same task looked
  different in Plica and in Paperclip.
- **Links into `/tasks` and `/chats` keep their company.** Both are new
  company-scoped routes; Plica did not know them, so a link into one could lose
  its company prefix.
- **Dialogs respect reduced motion**, as Paperclip's now do.
- **`pnpm check:vendored`** reports any vendored host file that has drifted from
  the Paperclip checkout. Nothing caught the two above until now.

### The mark

- **Plica has its own icon.** A sheet folded down its middle, seen end-on — a
  *plica*, which reads flat as a caret. It replaces the two stock Lucide icons
  that stood in for it: the Telescope on the breadcrumb-bar button and the
  Layers glyph beside the page title. Both surfaces now show the same mark, so
  the button in the host's chrome and the page it opens are recognisably the
  same thing.
- Drawn as an SVG component rather than shipped as the supplied PNG, so it
  inherits `currentColor` and tracks the text beside it through hover, light
  mode and dark mode. The source artwork and its geometry are kept in
  [`docs/brand/`](docs/brand/) for anyone who has to redraw it.

### The stylesheet coupling

- **Plica now warns when it needs rebuilding after a Paperclip upgrade.** Plica
  filters its own utilities against Paperclip's compiled stylesheet once, at
  build time; upgrade Paperclip and that filtering goes stale, and Plica's
  leftover duplicates can override Paperclip's responsive rules and strand the
  whole application in its mobile layout. The symptom shows up in Paperclip's
  own chrome with nothing pointing at Plica, and the fix — `pnpm build` in the
  Plica checkout — is not one anyone would guess. A **Stylesheet stale** badge
  now appears in the Plica header, and its hover text names the fix and shows
  the stylesheet Plica was built against next to the one currently loaded.
- **It stays quiet unless it is sure.** If the host's stylesheet cannot be
  identified from the page, Plica shows nothing rather than a warning it cannot
  stand behind. Nothing about rendering, data or demo mode changes either way.

### Documentation

- **A documentation set with real screenshots**, in [`docs/`](docs/): install,
  configuration, the board, the queue, and troubleshooting. The README is now an
  overview that hands off to them rather than the only page there is.
- Screenshots are **generated**, by `scripts/capture-screenshots.mjs`, from a
  running instance in demo mode. Refreshing them after a UI change is one
  command instead of a manual session with a cropping tool, which is the only
  version of "keep the screenshots current" that survives contact with a
  release. See [`docs/screenshots/README.md`](docs/screenshots/README.md).
- Removed the README's claim that a classic layout is available behind a toggle.
  The classic views were retired in `e40e459`; the line documented a feature
  that does not exist.
- `demoDataUrl` is now documented as accepted-and-ignored on the settings page.
  It is declared in the manifest and rendered by the host, but nothing reads it.
- Corrected two `PLUGIN_SPEC.md §24` citations in `src/manifest.ts` and
  `src/ui/host/api.ts`. §24 is *Operator UX*; the statement they lean on is in
  the spec's *Current implementation caveats*.
- Marked the plugin-migration plan as completed and corrected its description of
  what shipped — a `globalToolbarButton` slot, not a navigate launcher in the
  sidebar zone.

## 0.3.0

### Demo mode

- **Plica can now serve the whole HUD from a bundled fixture instead of the
  live instance**, so the page can be shown or screenshotted without exposing
  real company names, ticket titles or agent narration. Four invented companies
  with ~40 tickets, ~22 agents, live runs, an overdue routine and a company in
  the red — sized so every surface has something to draw rather than reading as
  an empty prototype.
- Two switches: `?demo=1` on the URL (sticky for the browser session, and
  superseded as soon as the setting is changed) and a **Demo mode** checkbox
  on the host's plugin settings page,
  which Paperclip renders from the new `instanceConfigSchema` in the manifest.
  Host plugin config is company-scoped and Plica is not, so the box ticked for
  any one company turns the whole page into a demo.
- The substitution happens at one seam — `request()` in `src/ui/host/api.ts` —
  which every read Plica performs already funnels through. No component knows
  demo mode exists, and none can leak real data by forgetting about it. Writes
  are intercepted too, so approving an approval or answering an interaction
  works in a walkthrough without reaching the server.
- Fails closed. The page renders a placeholder until the mode is resolved and
  an error if the fixture cannot be loaded, rather than showing real data for a
  frame or falling back to it silently. A **Demo data** badge sits in the
  header the whole time it is on.
- Addressed by the plugin's row UUID, looked up from `/api/plugins`. The
  plugin-**key** form of the asset route 500s: its `getById` guard reads
  `error.code` while drizzle puts the Postgres `22P02` on `error.cause`, so a
  non-UUID id escapes the guard instead of falling through to `getByKey`.
- The fixture is a real file at `dist/ui/demo-data.json`, so renaming a company
  is an edit and a reload. Structural changes go through
  `scripts/gen-demo-data.mjs` (`pnpm demo:data`); a test asserts the two agree.
  Timestamps are relative tokens resolved at page load, so the demo never reads
  as months stale.

### Layout

- **Live now moved out of the rail and onto a strip across the top of the
  board.** It was the one block whose height tracked the size of the fleet, so
  every run that started or finished shoved the lists below it down the page.
  As a single row of pills its height cannot change at all, and nothing below
  it ever moves. Running agents are a glance, not a list you work through.
- Each run is now a pill: company, ticket, agent, elapsed. The title and the
  agent's narration moved into the hover, where they cannot wrap a pill onto a
  second line and change the strip's height.
- No cap and no "+N more" line — the row scrolls sideways, so the header count
  and what you can reach always agree.
- The rail is a sticky column **capped** at the viewport rather than pinned to
  a fixed height. The fixed height had to guess how much chrome sat above it
  and guessed high, which pushed Routines off the bottom of the screen.
  Routines is now `shrink-0`: it is the one thing that can never be squeezed
  out of view, and Portfolio scrolls inside itself only once the column would
  otherwise overflow.

### Portfolio (was Projects)

- The projects rail is now a chart, not a list. The folds, the company
  grouping, the `most open` / `least open` sort and the per-project deep links
  are gone — what people actually read off that rail was the shape of the bars,
  and the rows were not being clicked.
- One bar per project across every company, **scaled to the largest project**
  so lengths compare down the column rather than only within a row. Three
  segments now: moving, **waiting**, blocked — waiting is the untouched
  remainder the old two-segment bar left as bare track and therefore never
  named.
- Ordered worst-first (latest overdue → most stuck → biggest), not by deadline.
  A chart read at a glance must put the worst bar under the eye first.
- **Trouble / By company** toggle in the header, persisted in
  `plica.portfolioSort`. Company order follows the board's own — watched first,
  then hot-first or the sidebar order — so a company sits in the same place in
  both panes, and the worst project still leads inside each company. Gathering
  the bars is the only way to see that one company's whole portfolio is stuck,
  which trouble-order scatters down the column.
- In company order each block is headed by the company's name and its own
  open / blocked / late figures. The header is **sticky**, because a block can
  be taller than the pane and scrolling past the name would leave a run of bars
  with nothing saying whose they are. The per-row company icon drops away in
  that mode — the header already answers it — and stays in Trouble order, where
  consecutive bars have no shared owner to head.
- `plica.projectGrouping` and `plica.projectSort` retired; both are cleared on
  load with the other legacy keys.

### Routines

- Replaced the week's timetable with **exceptions only**: failed, wedged on a
  blocked issue, or overdue. A schedule you can predict is not information —
  the old list spent its whole height saying twenty routines would fire on
  time and gave the two that broke the same weight as the rest.
- Healthy routines are a count in the footer. When everything is healthy the
  block is one reassuring line; with no routines at all it says so distinctly.
- A routine that both failed and ran late is one problem, filed under the
  failure, which is the half that says why.

### Needs you

- Age filter chips in the rail header: **All / Today / Yesterday / Last week /
  Old**, persisted in `plica.queueAgeFilter`. A rail carrying a hundred-odd
  items is a wall you stop reading, and the oldest things on it are the least
  likely to still matter.
- Buckets are **calendar days cut at local midnight**, not rolling hours — an
  item raised at 9pm last night is yesterday's at 8am today. The Age *grouping*
  now uses the same buckets, so the two can never disagree about which pile an
  item is in.
- Each chip carries the count of the **unfiltered** queue, so an empty bucket
  is distinguishable from a hidden one. Empty buckets stay visible but disabled
  rather than disappearing, so the chips never move under the cursor as items
  age past midnight.
- Under an age filter, **Later starts open**: narrowing to "Old" is an explicit
  request for that slice, and a rail whose only match is folded away reads as
  empty.
- The rail's badge and "oldest" now describe what is on screen, not the queue
  behind the filter.
- Age sort remains a toggle in the rail header (`oldest` / `newest`), persisted
  in `plica.queueSort`. Severity still decides the order first — the toggle only
  flips which of two equally urgent items leads, so grouping by Severity with
  newest first works as one view.
- Every group in the rail folds from its header, not just Later.

### Internal

- `PlicaListControls` factored out of the queue's own header. `PlicaFoldGroup`
  and `PlicaCompanyGroup` are gone with the rail they served — the Portfolio
  chart and the routine exceptions have nothing to fold.
- The projects rail's grouping and sorting helpers (`groupProjects`,
  `compareProjectEntries`, `projectDueBucket`, `projectHealth`) removed with it;
  a chart ordered worst-first has nothing left for them to choose between.
- Test timezone pinned to UTC. The queue's age buckets cut at *local* midnight
  by design, so the suite has to agree on which local.

### Project

- **Requests have one path now**, written down in `docs/intake.md`: capture,
  deduplicate, clarify, scope, propose a priority, build, review, merge,
  changelog. Two steps are the repository owner's — the priority band and the
  merge — and the document says so rather than leaving it to be discovered.
- Three issue templates (feature request, bug report, core limitation) produce
  the *Problem / Proposed scope / Acceptance criteria / Open questions* shape
  triage needs, so triage fills gaps instead of restructuring prose. Blank
  issues stay enabled on purpose.
- The **core limitation** template is the sanctioned exit from the
  no-core-changes rule and the only one: it asks which extension point comes
  closest, why it falls short, and what Plica ships in the meantime — then parks
  the work for the owner rather than routing around core.
- A state label is now mandatory on every issue, because an issue with no state
  label is the one failure mode nothing else in this repository has an alarm on.

## 0.2.0

### Board

- Rebuilt the company ledger around what is waiting on you. Columns are now
  `Need you · Questions · Blocked · Review · Open · Runs/d · Tokens`, with the
  first four counted off the attention feed so they can never disagree with
  their own total. Routines and Spend columns dropped — routines duplicate the
  rail beside the board, and dollars were the least actionable figure on the row.
- **Capacity strip** replaces the old `0 / 4` count: one square per agent, in
  org order (chief first, each manager followed by their reports), showing
  working / queued / stalled / error / idle. A run that holds a runner while
  reporting nothing for 20 minutes now reads as stalled — previously invisible.
- Agents that cannot take work (paused, terminated, pending approval) no longer
  occupy squares; drawing them as idle overstated available capacity.
- Heat is computed and used to order the board, and deliberately never drawn.
- SCADA-influenced palette: `--plica-live` / `--plica-wait` / `--plica-alarm` /
  `--plica-rest`, low-chroma, one meaning each. Company brand colour is the only
  saturated thing on the board and never encodes a value.
- Header totals removed, along with the per-company summary fan-out behind them.

### Rails

- Routines and Projects group by company, following the board's own company
  order, each foldable to a one-line summary. No more `+n more` truncation.
- Routines read in calendar order, Sunday through Saturday, and colour by where
  each sits in its cycle: warming toward live over the day before it fires, live
  for the hour it runs, then straight back to rest.
- Every routine carries an outcome mark for its last run (ok / blocked / failed /
  working / skipped) that links to the issue that stopped it.

### Fixed

- **Host navigation could wedge while Plica was open** — the URL changed and the
  view never followed. `needsBreakdown` was rebuilt on every render while sitting
  in an effect dependency array, producing a render loop that starved React
  Router 7's `startTransition`. Memoised, and every `?? []` fallback in the same
  hook replaced with shared constants to close the whole class.
- Radix modal dialogs unmounted by a queue refresh could strand
  `pointer-events: none` on `<body>`, disabling every click in the app.

### Performance

- Polls paced per dataset (5s live, 15s approvals, 30s agents, 60s issues and
  projects) instead of everything at 5s, and none refetch in a hidden tab. The
  issue list — the heaviest payload on the page — was being refetched twelve
  times a minute per company.
- Dropped the sidebar-badges query entirely; nothing had rendered it since the
  Inbox column came out.

### Removed

- The CEO nudge. An overdue heartbeat now offers "Open CEO" instead.

## 0.1.0

Initial release.
