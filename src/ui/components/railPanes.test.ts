import { describe, expect, it } from "vitest";
import { distributeRailHeight, type TicklerRailPaneMetrics } from "../lib/rail-budget";
import { railPanes } from "./TicklerBoardPage";

/** A measured pane: 28px of header, a 20px footer, 32px rows, a 2px border. */
function box(total: number): TicklerRailPaneMetrics {
  return { head: 28, foot: 20, row: 32, frame: 2, total };
}

const RAIL = { available: 900, gap: 16 };

/** Thirty watched orgs, four tasks today, twenty this week. */
function budgetFor(orgs: boolean, recent: boolean) {
  const specs = railPanes({ orgs, recent }, 0, 4);
  return distributeRailHeight(
    specs,
    { orgs: box(30), recent: box(recent ? 20 : 4), portfolio: box(8), routines: box(3) },
    RAIL,
  );
}

describe("railPanes", () => {
  // PLI-287: expanding Recent with Orgs expanded collapsed Orgs, so the Recent
  // header under the pointer jumped up the rail.
  it("leaves Orgs exactly where it was when Recent is expanded beside it", () => {
    const orgsOnly = budgetFor(true, false);
    const both = budgetFor(true, true);
    expect(both.orgs).toEqual(orgsOnly.orgs);
    expect(both.recent!.rows).toBeGreaterThanOrEqual(orgsOnly.recent!.rows);
  });

  // PLI-287 follow-up: on a rail with nothing to spare, Recent's press did
  // nothing visible. The panes below it leave the rail to make the room.
  it("takes Routines, then Portfolio, off the rail to grow Recent beside an expanded Orgs", () => {
    const orgsOnly = budgetFor(true, false);
    const both = budgetFor(true, true);
    // 46px each — a 30px header and a 16px gap — is at least a 32px row apiece.
    expect(both.recent!.rows).toBeGreaterThan(orgsOnly.recent!.rows + 1);
    expect(both.recent!.hidden).toBeGreaterThan(0);
    expect(both.routines!.dropped).toBe(true);
    expect(both.portfolio!.dropped).toBe(true);
  });

  it("drops only as many panes as Recent needs", () => {
    const specs = railPanes({ orgs: true, recent: true }, 0, 4);
    const budget = distributeRailHeight(
      specs,
      { orgs: box(30), recent: box(5), portfolio: box(8), routines: box(3) },
      RAIL,
    );
    expect(budget.recent!.rows).toBe(5);
    expect(budget.routines!.dropped).toBe(true);
    expect(budget.portfolio!.dropped).toBeUndefined();
    expect(budget.portfolio!.demoted).toBe(true);
  });

  it("drops nothing while Recent is not expanded", () => {
    const budget = budgetFor(true, false);
    expect(budget.routines!.dropped).toBeUndefined();
    expect(budget.portfolio!.dropped).toBeUndefined();
  });

  it("still gives Recent the freed height when Orgs is not expanded", () => {
    const plain = budgetFor(false, false);
    const recent = budgetFor(false, true);
    expect(recent.recent!.rows).toBeGreaterThan(plain.recent!.rows);
    expect(recent.portfolio!.demoted).toBe(true);
  });
});
