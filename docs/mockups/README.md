# Mockups

Standalone design studies. Each is a single HTML file with no build step and no
server — open it in a browser, or `xdg-open` it. They carry placeholder data,
never a real company.

| File | What it studies |
| --- | --- |
| [`board-v2.html`](board-v2.html) | The board ledger rebuild: one row per org, SCADA-muted palette, alarm colour reserved for alarms. Shipped. |
| [`sidebar-v3.html`](sidebar-v3.html) | The left rail — how it spends height, and whether it should be configurable. PLI-246: A shipped, C is PLI-247, D is PLI-248. |
| [`toolbar-badge.html`](toolbar-badge.html) | A count or dot on the toolbar button, and the setting that turns it off. PLI-367: C shipped, with an Off setting. |

Pictures are captured with:

```
node scripts/capture-mockup.mjs sidebar-v3
node scripts/capture-mockup.mjs sidebar-v3 --only budget
node scripts/capture-mockup.mjs toolbar-badge --only overdue
```

They land in `docs/mockups/<name>/`. Playwright is resolved from the Paperclip
checkout, the same read-only reference `capture-screenshots.mjs` uses; this repo
installs nothing.

---

## sidebar-v3 — the left rail (PLI-246)

The study renders the board inside a **simulated screen** whose size you pick, so
the height problem is visible rather than described. Two controls drive
everything: screen size, and how many orgs you watch.

### What is actually wrong

> **A shipped.** What follows describes the rail as it was when the study was
> made. The caps are gone: the rail is pinned to `100vh - 2rem`, measures itself,
> and hands each pane a height — see `src/ui/lib/rail-budget.ts` for the
> distribution pass and `src/ui/components/useRailBudget.ts` for the measuring.
> B was not taken. C and D are PLI-247 and PLI-248.

The rail was four cards in a sticky column capped at `100vh - 2rem`, and each
card carried its own scroll cap:

| Pane | Cap before A | Set where |
| --- | --- | --- |
| Orgs | *none* | `TicklerBoardPage.tsx` |
| Recent | `max-h-64` — 256px | `TicklerRecentTasks.tsx:198` |
| Portfolio | whatever is left | `TicklerPortfolio.tsx:173` |
| Routines | `max-h-40` — 160px | `TicklerRoutineExceptions.tsx:60` |

Three consequences, in the order they hurt:

1. **Orgs has no cap.** Every org you watch pushes the panes below it down. At
   twelve orgs Portfolio is off the bottom of the screen entirely — the rail
   breaks by adding orgs, not by resizing a window.
2. **The caps are pixel constants.** A 27&Prime; monitor gets the same 160px of
   Routines as a 13&Prime; laptop. Height that exists is not spent.
3. **Heights are not a whole number of rows**, so panes end in a row sliced
   through the middle, and nothing says how much is being held back.

Twelve orgs, 1512×790 — Portfolio has left the building:

![Today, twelve orgs](sidebar-v3/current-1512x790-12orgs.png)

### A · Height budget — shipped

The rail is told how tall it is and spends it. Each pane declares
`rows: [minimum, ideal]` and a priority; every pane gets its minimum, then the
surplus goes out one row at a time in priority order. Row heights are measured
from the DOM, not guessed, so a pane is always a header plus whole rows. A pane
holding rows back says `+8 more` in its header. Below its minimum a pane demotes
to a one-line digest — `3 need attention ▸` — instead of being clipped.

Same twelve orgs, same screen. Every pane present, nothing cut:

![Budget, twelve orgs](sidebar-v3/budget-1512x790-12orgs.png)

On a 27&Prime; monitor the surplus goes into the panes rather than into a scrollbar:

![Budget on a 27-inch screen](sidebar-v3/budget-2560x1400.png)

The distribution pass is `applyBudget()` in the study — about 30 lines, and it
was the reference for the real one. What shipped differs in three places, all of
them things the study could take for granted and the board cannot:

- A pane with nothing in it — "all 7 routines healthy" — is not a demoted pane.
  It keeps its own height and is never promoted or clipped.
- A demoted pane has no rows left on the page to measure, so the last heights it
  had are remembered; otherwise it could never be promoted back.
- Row height is the tallest of a sample rather than the second row, because
  Portfolio's sticky company headings are rows too and are shorter than a bar.

A demoted pane is its header, which is where each pane's digest already lived —
`3 need attention`, `8 working`, `35 open · 5 blocked` — rather than a separate
digest line.

### B · One tall panel, tabbed — alternative

Orgs stays pinned, since it is navigation and a filter rather than content.
Recent, Portfolio and Routines share one panel that takes every remaining pixel,
with badges carrying the signal you would otherwise lose. One scrollbar in the
rail instead of four; the open pane gets roughly 3× the height it has today. The
cost is a click, and a failed routine is only a number until you go back to it.

![Tabbed rail](sidebar-v3/tabs-1440x900-12orgs.png)

### C · Customisable rail — next, PLI-247

A gear on the rail: which panes appear, in what order, how dense, how wide,
saved per person **and per screen size** — a laptop and a desk monitor keep
different lists, because one list for every screen just moves the problem.
Shown as one person has it: Orgs and Portfolio kept, everything else off, and
Portfolio given the whole column.

![Customisable rail](sidebar-v3/custom-1440x900.png)

Needs somewhere to persist — plugin user settings, where the token thresholds
already live. It ships *after* A: customisation on top of a rail that behaves is
a preference; on top of one that does not, it is a workaround.

### D · No rail — context strip + drawer — PLI-248, narrow screens only

The rail becomes a row of dense cards above the queue; clicking one opens it in
a drawer. The queue gets ~330px back. This is already what the board does below
`64rem`, where the rail stacks on top — adopting it deliberately makes the narrow
case a design rather than a fallback. Everything becomes a number, so it is the
wrong default on a large screen: PLI-248 takes it below `64rem` only.

![Context strip](sidebar-v3/strip-1280x720.png)

---

## toolbar-badge — what the Tickler button says before you open it (PLI-367)

Five variants of the toolbar button, drawn together in one simulated breadcrumb
bar each, so a single state compares them all. The State, Width and Theme
toggles drive the study; Width `< sm` is the host breakpoint below which the
button drops its label and is just the mark.

| Variant | Shows | Clears when |
| --- | --- | --- |
| A · Off | nothing — today's button | — |
| B · New dot | attention items created since `tickler.lastVisit` | you open Tickler |
| C · Today count | the queue's Today lane across visible orgs, inline pill | you decide or snooze the items |
| D · Corner bubble | C's count, overhanging the corner | as C |
| E · Count + dot | C, plus B's dot | each half as above |

The count turns alarm-coloured only when something in it is overdue; the dot is
the board's `live` blue. Above nine the count reads `9+`.

All of it comes from the per-org attention feed, which carries `decideBy`,
`snoozedUntil` and `createdAt` and already covers approvals through their
attention twins — one request per visible org.

C shipped, with an **Off / Today count** setting in the gear panel. The study
assumed the button could share the page's query cache; it cannot (the page owns
its client, and the button is mounted outside it), so the button keeps its own
and polls once a minute.
