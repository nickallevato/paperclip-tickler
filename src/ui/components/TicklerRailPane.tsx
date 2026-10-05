import type { CSSProperties } from "react";
import { cn } from "../host/util";
import type { TicklerRailPaneBudget } from "../lib/rail-budget";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";

/**
 * What the rail's height budget does to a pane's box.
 *
 * A budgeted pane is pinned to an exact height — header plus a whole number of
 * measured rows — and stops flexing, because a `flex-1` basis of zero would
 * override the height it was just given. An unbudgeted pane keeps whatever
 * height it gives itself, which is what the narrow layout wants.
 */
export function railPaneBox(budget: TicklerRailPaneBudget | undefined): {
  className: string | undefined;
  style: CSSProperties | undefined;
} {
  // A pane folded to its header does not flex either: `flex-1` on Portfolio is
  // there to spend the rail's leftovers on bars, and a Portfolio with no bars
  // left to draw would spend them on an empty card (PLI-271).
  if (budget?.demoted) return { className: "flex-none", style: undefined };
  if (!budget || budget.height === null) return { className: undefined, style: undefined };
  return { className: "flex-none", style: { height: budget.height } };
}

/**
 * "+8 more", in a pane's header.
 *
 * A pane that is holding rows back has to say so. The old rail hid them behind
 * a pixel cap, and the only tell that there was anything under the fold was a
 * row cut in half at the bottom.
 */
export function TicklerRailMore({ budget }: { budget?: TicklerRailPaneBudget }) {
  if (!budget || budget.hidden <= 0) return null;
  return (
    <span
      data-rail-more
      className={cn(MICRO, "shrink-0 font-normal normal-case tracking-normal tabular-nums text-muted-foreground")}
      title={`${budget.hidden} more — scroll this pane, or give the rail a taller window`}
    >
      +{budget.hidden} more
    </span>
  );
}
