import { ChevronsUpDown } from "lucide-react";
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

/**
 * The toggle that gives a pane the rail, in that pane's header.
 *
 * Shared by Recent (PLI-271) and Orgs (PLI-273) because it has to look and
 * behave like one control: the two are alternatives — expanding either folds the
 * other panes, and only one can be expanded at a time — so a reader comparing
 * the two headers is comparing the same button, and a second hand-rolled copy is
 * how two buttons that mean the same thing end up a pixel and an aria attribute
 * apart.
 *
 * What is *not* shared is the `title`, which is the only part that carries any
 * information: what the press costs differs per pane — Recent trades two panes
 * for a week of history, Orgs trades three for the rest of the list — and that
 * is exactly the part the icon cannot say.
 *
 * Last in its header by convention, past the counts and the "+N more" those
 * counts qualify: it is the one thing in a pane header that changes the page
 * rather than describing it.
 */
export function TicklerRailExpand({
  pane,
  label,
  expanded,
  expandable = true,
  title,
  onExpanded,
}: {
  /** The pane's key, as `data-rail-pane` spells it. The test handle. */
  pane: string;
  /** The pane's name as its header says it, for the label read aloud. */
  label: string;
  expanded: boolean;
  /**
   * Whether expanding would show anything. False on a pane that is already
   * drawing every row it has, where the button says so rather than folding its
   * neighbours to make room for nothing.
   */
  expandable?: boolean;
  /** What the press costs, in the pane's own terms. */
  title: string;
  onExpanded: (expanded: boolean) => void;
}) {
  return (
    /* `aria-pressed` rather than two labels doing the same job: this is one
       control in two states, not two controls. */
    <button
      type="button"
      data-rail-expand={pane}
      aria-pressed={expanded}
      aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
      // Disabled only on the way in: an expanded pane is always collapsible,
      // even once the board has changed under it into one with nothing left to
      // expand into.
      disabled={!expanded && !expandable}
      title={title}
      onClick={() => onExpanded(!expanded)}
      className={cn(
        "-my-0.5 shrink-0 rounded border p-0.5",
        expanded ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
        !expanded && !expandable && "cursor-not-allowed opacity-40 hover:text-muted-foreground",
      )}
    >
      {/* One icon in both states, like the header's own toggles: the obvious
          second icon is `ChevronsDownUp`, and at 12px inside a bordered square
          it reads as a close button. The pressed background is what says which
          state this is. */}
      <ChevronsUpDown className="h-3 w-3" />
    </button>
  );
}
