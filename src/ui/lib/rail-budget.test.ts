import { describe, expect, it } from "vitest";
import {
  distributeRailHeight,
  sameRailBudget,
  unbudgeted,
  type TicklerRailPaneMetrics,
  type TicklerRailPaneSpec,
} from "./rail-budget";

/** The board's own four panes, so the numbers under test are the real ones. */
const PANES: TicklerRailPaneSpec[] = [
  { key: "orgs", minRows: 3, idealRows: Infinity, priority: 1 },
  { key: "recent", minRows: 3, idealRows: 12, priority: 1 },
  { key: "portfolio", minRows: 3, idealRows: 11, priority: 2 },
  { key: "routines", minRows: 2, idealRows: 4, priority: 2 },
];

/** A measured pane: 28px of header, a 20px footer, 32px rows, a 2px border. */
function box(total: number, over: Partial<TicklerRailPaneMetrics> = {}): TicklerRailPaneMetrics {
  return { head: 28, foot: 20, row: 32, frame: 2, total, ...over };
}

function metrics(totals: Record<string, number>): Record<string, TicklerRailPaneMetrics> {
  return Object.fromEntries(Object.entries(totals).map(([key, total]) => [key, box(total)]));
}

const GAP = 16;

/** What the rail is asked to draw, as one number, for comparing against `available`. */
function spent(budget: ReturnType<typeof distributeRailHeight>, boxes: Record<string, TicklerRailPaneMetrics>): number {
  let total = GAP * (PANES.length - 1);
  for (const { key } of PANES) {
    const pane = budget[key]!;
    total += pane.height ?? boxes[key].frame + boxes[key].head + (boxes[key].total === 0 ? boxes[key].foot : 0);
  }
  return total;
}

describe("distributeRailHeight", () => {
  it("leaves every pane to size itself until the rail has a height", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });
    expect(distributeRailHeight(PANES, boxes, { available: 0, gap: GAP })).toEqual(unbudgeted(PANES));
  });

  it("leaves every pane to size itself while any one of them is unmeasured", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20 });
    expect(distributeRailHeight(PANES, boxes, { available: 900, gap: GAP })).toEqual(unbudgeted(PANES));
  });

  it("treats a pane with rows but no measured row height as unmeasured", () => {
    const boxes = { ...metrics({ orgs: 12, portfolio: 11, routines: 3 }), recent: box(20, { row: 0 }) };
    expect(distributeRailHeight(PANES, boxes, { available: 900, gap: GAP })).toEqual(unbudgeted(PANES));
  });

  // The failure that opened PLI-246: twelve orgs pushed Portfolio off the
  // bottom of the screen, because Orgs had no cap of any kind.
  it("keeps every pane on a short screen with twelve orgs", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });
    const budget = distributeRailHeight(PANES, boxes, { available: 758, gap: GAP });
    for (const { key } of PANES) expect(budget[key]!.demoted, key).toBe(false);
    expect(spent(budget, boxes)).toBeLessThanOrEqual(758);
  });

  it("never draws part of a row", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });
    const budget = distributeRailHeight(PANES, boxes, { available: 903, gap: GAP });
    for (const { key } of PANES) {
      const pane = budget[key]!;
      expect(pane.height, key).toBe(boxes[key].frame + boxes[key].head + boxes[key].foot + pane.rows * boxes[key].row);
    }
  });

  // PLI-263: every height here is fractional, because a row is. A pane pinned
  // to the floor of its own contents scrolls by the fraction it was docked, and
  // its header meanwhile says it is holding nothing back — a scrollbar for rows
  // already on screen. Measured on the board: 28.297px rows budgeted 28.
  it("never pins a pane below the rows it is showing", () => {
    const boxes: Record<string, TicklerRailPaneMetrics> = {
      orgs: box(4, { head: 32.297, foot: 25.5, row: 47.297, frame: 2 }),
      recent: box(16, { head: 32.297, foot: 0, row: 28.297, frame: 2 }),
      portfolio: box(9, { head: 36.297, foot: 21.5, row: 42.297, frame: 2 }),
      routines: box(3, { head: 32.297, foot: 0, row: 28.297, frame: 2 }),
    };
    for (const available of [596, 886, 1206, 1308]) {
      const budget = distributeRailHeight(PANES, boxes, { available, gap: GAP });
      for (const { key } of PANES) {
        const pane = budget[key]!;
        if (pane.height === null) continue;
        const needed = boxes[key].frame + boxes[key].head + boxes[key].foot + pane.rows * boxes[key].row;
        expect(pane.height, `${key} at ${available}`).toBeGreaterThanOrEqual(needed);
        expect(pane.height, `${key} at ${available}`).toBe(Math.ceil(pane.height));
      }
      // And the rounding is not paid for out of the rail: a pane rounded up
      // past the band would move the scrollbar from the pane onto the rail.
      expect(spent(budget, boxes), `rail at ${available}`).toBeLessThanOrEqual(available);
    }
  });

  it("spends a taller screen instead of holding a pixel cap", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });
    const short = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    const tall = distributeRailHeight(PANES, boxes, { available: 1400, gap: GAP });
    for (const { key } of PANES) expect(tall[key]!.rows, key).toBeGreaterThanOrEqual(short[key]!.rows);
    expect(tall.recent!.rows).toBeGreaterThan(short.recent!.rows);
    expect(spent(tall, boxes)).toBeLessThanOrEqual(1400);
  });

  it("stops at each pane's ideal rather than handing one pane the whole screen", () => {
    const boxes = metrics({ orgs: 12, portfolio: 40, recent: 60, routines: 9 });
    const budget = distributeRailHeight(PANES, boxes, { available: 4000, gap: GAP });
    expect(budget.orgs!.rows).toBe(12);
    expect(budget.portfolio!.rows).toBe(11);
    expect(budget.recent!.rows).toBe(12);
    expect(budget.routines!.rows).toBe(4);
    for (const { key } of PANES) expect(budget[key]!.hidden, key).toBe(boxes[key].total - budget[key]!.rows);
  });

  // What a short screen is spent on, which is the board's one editorial choice:
  // Orgs and Recent share the first rank and keep their rows, and Portfolio —
  // second rank, and no cheaper than Recent — falls back to the digest in its
  // header rather than taking Recent's place.
  it("keeps the first-rank panes when there is only room for some of them", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });
    const budget = distributeRailHeight(PANES, boxes, { available: 500, gap: GAP });
    expect(budget.orgs!.demoted).toBe(false);
    expect(budget.recent!.demoted).toBe(false);
    expect(budget.recent!.rows).toBeGreaterThanOrEqual(3);
    expect(budget.portfolio!.demoted).toBe(true);
    expect(budget.portfolio!.height).toBeNull();
    expect(budget.portfolio!.hidden).toBe(11);
    expect(spent(budget, boxes)).toBeLessThanOrEqual(500);
  });

  // Priority buys a place in the queue, not a place on the page: a pane whose
  // minimum will not fit is passed over, and a cheaper pane behind it is still
  // served. Two routine failures are worth more of a cramped rail than the
  // twelfth Portfolio bar, which is the trade this ordering is meant to make.
  it("passes over a pane whose minimum will not fit and serves a cheaper one behind it", () => {
    const boxes = { ...metrics({ orgs: 12, recent: 20, routines: 3 }), portfolio: box(11, { row: 200 }) };
    const budget = distributeRailHeight(PANES, boxes, { available: 700, gap: GAP });
    expect(budget.portfolio!.demoted).toBe(true);
    expect(budget.routines!.demoted).toBe(false);
    expect(budget.routines!.rows).toBeGreaterThanOrEqual(2);
    expect(spent(budget, boxes)).toBeLessThanOrEqual(700);
  });

  it("demotes rather than clips when the rail is far too short", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });
    const budget = distributeRailHeight(PANES, boxes, { available: 200, gap: GAP });
    for (const { key } of PANES) expect(budget[key]!.demoted, key).toBe(true);
  });

  it("gives a pane fewer rows than its minimum when that is all it has", () => {
    const boxes = metrics({ orgs: 1, portfolio: 11, recent: 20, routines: 3 });
    const budget = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    expect(budget.orgs!.rows).toBe(1);
    expect(budget.orgs!.hidden).toBe(0);
  });

  it("leaves an empty pane alone: no rows, no height of ours, never demoted", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 0 });
    const budget = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    expect(budget.routines).toEqual({ rows: 0, height: null, hidden: 0, demoted: false });
    // Its one "all 7 routines healthy" line is still charged for, so the panes
    // above it cannot spend the height it occupies.
    expect(spent(budget, boxes)).toBeLessThanOrEqual(790);
  });

  // PLI-271: the reader's own trade. Folding the two lower panes is what pays
  // for a Recent twice as long, and the arithmetic has to actually hand the
  // freed height over rather than leave a gap at the bottom of the rail.
  it("folds a collapsed pane to its header and spends the height on the pane that asked", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 24, routines: 3 });
    const settled = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    const folded = distributeRailHeight(
      PANES.map((spec) =>
        spec.key === "recent"
          ? { ...spec, idealRows: 24 }
          : spec.key === "orgs"
            ? spec
            : { ...spec, collapsed: true },
      ),
      boxes,
      { available: 790, gap: GAP },
    );
    expect(folded.portfolio).toEqual({ rows: 0, height: null, hidden: 11, demoted: true });
    expect(folded.routines).toEqual({ rows: 0, height: null, hidden: 3, demoted: true });
    expect(folded.recent!.rows).toBeGreaterThan(settled.recent!.rows);
    expect(spent(folded, boxes)).toBeLessThanOrEqual(790);
  });

  // The half of PLI-271 that came back as a bug report: "the expand only expands
  // the orgs list". Orgs has no ideal — it wants every org it has — so it could
  // always take another row, and the round-robin gave it every other row of the
  // surplus the fold had just freed. These are the measured heights of the real
  // rail, where an org row costs two thirds again what a Recent row does, so each
  // row Orgs took was a row and a half Recent did not get.
  it("spends a fold on the pane it was freed for, not on the pane with no ideal", () => {
    const boxes: Record<string, TicklerRailPaneMetrics> = {
      orgs: box(12, { head: 32.297, foot: 25.5, row: 47.297, frame: 2 }),
      recent: box(32, { head: 32.297, foot: 0, row: 28.297, frame: 2 }),
      portfolio: box(9, { head: 36.297, foot: 21.5, row: 42.297, frame: 2 }),
      routines: box(3, { head: 32.297, foot: 0, row: 28.297, frame: 2 }),
    };
    // Exactly what `railPanes(true)` says: Recent doubled and served first, the
    // two below folded.
    const expanded: TicklerRailPaneSpec[] = [
      { key: "orgs", minRows: 3, idealRows: Infinity, priority: 1 },
      { key: "recent", minRows: 3, idealRows: 24, priority: 1, first: true },
      { key: "portfolio", minRows: 3, idealRows: 11, priority: 2, collapsed: true },
      { key: "routines", minRows: 2, idealRows: 4, priority: 2, collapsed: true },
    ];
    for (const available of [790, 1000, 1308]) {
      const settled = distributeRailHeight(PANES, boxes, { available, gap: GAP });
      const folded = distributeRailHeight(expanded, boxes, { available, gap: GAP });
      // The point of the press: more rows of Recent, and no fewer of them than
      // the fold's own arithmetic could seat.
      expect(folded.recent!.rows, `recent at ${available}`).toBeGreaterThan(settled.recent!.rows);
      // And not at the price of handing them to the pane above: Orgs keeps its
      // minimum and takes the leftovers, but it does not grow on a press that
      // was not about it.
      expect(folded.orgs!.rows, `orgs at ${available}`).toBeLessThanOrEqual(settled.orgs!.rows);
      expect(folded.orgs!.rows, `orgs at ${available}`).toBeGreaterThanOrEqual(3);
      expect(spent(folded, boxes), `rail at ${available}`).toBeLessThanOrEqual(available);
    }
  });

  // PLI-273: the same trade from the other side. Portfolio and Routines fold, and
  // Recent stays standing at its ordinary ideal — read alongside the org list,
  // not instead of it — so what the fold freed is shared between the two.
  it("gives Orgs more of its list when the two panes under Recent fold, and keeps Recent", () => {
    const boxes: Record<string, TicklerRailPaneMetrics> = {
      // Twenty-two orgs at 47px is more than a 1308px rail can hold alongside
      // anyone, so there is something under this fold to expand into.
      orgs: box(22, { head: 32.297, foot: 25.5, row: 47.297, frame: 2 }),
      recent: box(16, { head: 32.297, foot: 0, row: 28.297, frame: 2 }),
      portfolio: box(9, { head: 36.297, foot: 21.5, row: 42.297, frame: 2 }),
      routines: box(3, { head: 32.297, foot: 0, row: 28.297, frame: 2 }),
    };
    // Exactly what `railPanes("orgs")` says. Orgs' own spec is untouched: its
    // ideal is already every org, so there is no number to double, and no
    // `first`, which would starve Recent to its floor.
    const expanded: TicklerRailPaneSpec[] = [
      { key: "orgs", minRows: 3, idealRows: Infinity, priority: 1 },
      { key: "recent", minRows: 3, idealRows: 12, priority: 1 },
      { key: "portfolio", minRows: 3, idealRows: 11, priority: 2, collapsed: true },
      { key: "routines", minRows: 2, idealRows: 4, priority: 2, collapsed: true },
    ];
    for (const available of [790, 1000, 1308, 1400]) {
      const settled = distributeRailHeight(PANES, boxes, { available, gap: GAP });
      const folded = distributeRailHeight(expanded, boxes, { available, gap: GAP });
      expect(folded.portfolio!.demoted, `portfolio at ${available}`).toBe(true);
      expect(folded.routines!.demoted, `routines at ${available}`).toBe(true);
      // Recent is still drawn, and never shorter for the press.
      expect(folded.recent!.demoted, `recent at ${available}`).toBe(false);
      expect(folded.recent!.rows, `recent at ${available}`).toBeGreaterThanOrEqual(settled.recent!.rows);
      // The point of the press, and the press has to be worth making at every
      // height the rail comes in at — not just the tall one.
      expect(folded.orgs!.rows, `orgs at ${available}`).toBeGreaterThan(settled.orgs!.rows);
      expect(folded.orgs!.height, `orgs at ${available}`).not.toBeNull();
      expect(spent(folded, boxes), `rail at ${available}`).toBeLessThanOrEqual(available);
    }
    // Once Recent is at its twelve, every further row is Orgs'.
    const tall = distributeRailHeight(expanded, boxes, { available: 1400, gap: GAP });
    expect(tall.recent!.rows).toBe(12);
  });

  it("keeps a folded pane folded however tall the rail gets", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 24, routines: 3 });
    const folded = distributeRailHeight(
      PANES.map((spec) => (spec.key === "routines" ? { ...spec, collapsed: true } : spec)),
      boxes,
      { available: 4000, gap: GAP },
    );
    expect(folded.routines!.demoted).toBe(true);
    expect(folded.routines!.rows).toBe(0);
    expect(folded.portfolio!.demoted).toBe(false);
  });

  it("charges the gap between panes", () => {
    const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });
    const tight = distributeRailHeight(PANES, boxes, { available: 790, gap: 0 });
    const gapped = distributeRailHeight(PANES, boxes, { available: 790, gap: 48 });
    const rows = (budget: typeof tight) => PANES.reduce((n, { key }) => n + budget[key]!.rows, 0);
    expect(rows(tight)).toBeGreaterThan(rows(gapped));
  });
});

describe("sameRailBudget", () => {
  const boxes = metrics({ orgs: 12, portfolio: 11, recent: 20, routines: 3 });

  it("holds for two runs over the same measurements", () => {
    const a = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    const b = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    expect(sameRailBudget(a, b)).toBe(true);
  });

  it("breaks when the window changed the rail", () => {
    const a = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    const b = distributeRailHeight(PANES, boxes, { available: 1400, gap: GAP });
    expect(sameRailBudget(a, b)).toBe(false);
  });

  it("breaks when a pane appears or goes away", () => {
    const a = distributeRailHeight(PANES, boxes, { available: 790, gap: GAP });
    const { routines: _dropped, ...fewer } = a;
    expect(sameRailBudget(a, fewer)).toBe(false);
  });
});
