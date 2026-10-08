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
    // Recent keeps its height too, and scrolls the week inside it.
    expect(both.recent!.height).toBe(orgsOnly.recent!.height);
    expect(both.recent!.hidden).toBeGreaterThan(0);
    expect(both.portfolio!.demoted).toBe(true);
    expect(both.routines!.demoted).toBe(true);
  });

  it("still gives Recent the freed height when Orgs is not expanded", () => {
    const plain = budgetFor(false, false);
    const recent = budgetFor(false, true);
    expect(recent.recent!.rows).toBeGreaterThan(plain.recent!.rows);
    expect(recent.portfolio!.demoted).toBe(true);
  });
});
