import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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

/** Rows of a pane's list that are out of its view, read off the page. */
interface TicklerRailSide {
  rows: HTMLElement[];
  /** `data-rail-needs` summed — what those rows say waits on you. */
  needs: number;
  /** `data-rail-label`s, for the hover, where the pane gives them. */
  names: string[];
}

interface TicklerRailOffscreen {
  above: TicklerRailSide;
  below: TicklerRailSide;
}

/**
 * Which of a pane's rows its scroller is not showing, and on which side.
 *
 * A row is out of view when its middle is: the budget pins panes to whole rows,
 * so a half-drawn row only happens mid-scroll, and counting it either way would
 * make the number flicker by one as the wheel turns.
 */
function readOffscreen(scroller: HTMLElement): TicklerRailOffscreen {
  const view = scroller.getBoundingClientRect();
  const above: HTMLElement[] = [];
  const below: HTMLElement[] = [];
  for (const row of scroller.querySelectorAll<HTMLElement>("[data-rail-row]")) {
    const rect = row.getBoundingClientRect();
    const middle = (rect.top + rect.bottom) / 2;
    if (middle < view.top) above.push(row);
    else if (middle > view.bottom) below.push(row);
  }
  return { above: side(above), below: side(below) };
}

// Read into state rather than off the rows at render: the chip renders in the
// same pass as the rows it counts, before their new attributes are on the page.
function side(rows: HTMLElement[]): TicklerRailSide {
  return {
    rows,
    needs: rows.reduce((sum, row) => sum + (Number(row.dataset.railNeeds) || 0), 0),
    names: rows.map((row) => row.dataset.railLabel ?? "").filter(Boolean),
  };
}

function sameSide(a: TicklerRailSide, b: TicklerRailSide): boolean {
  return (
    a.needs === b.needs &&
    a.rows.length === b.rows.length &&
    a.rows.every((row, index) => row === b.rows[index]) &&
    a.names.join("\n") === b.names.join("\n")
  );
}

function sameOffscreen(a: TicklerRailOffscreen | null, b: TicklerRailOffscreen | null): boolean {
  if (a === null || b === null) return a === b;
  return sameSide(a.above, b.above) && sameSide(a.below, b.below);
}

/**
 * "2 more ↓", in a pane's header: the rows this pane is scrolled past, and a
 * button that scrolls to them.
 *
 * A pane that is holding rows back has to say so. The old rail hid them behind
 * a pixel cap, and the only tell that there was anything under the fold was a
 * row cut in half at the bottom.
 *
 * It used to be "+2 more" and nothing else (PLI-278): the budget's count of
 * rows past the fold, which neither moved when the pane was scrolled nor said
 * whether the rows it hid mattered. So it is read off the pane instead — which
 * rows are out of view right now, and on which side — and it does three things
 * with that:
 *
 * - it points the way: ↓ while anything is under the fold, ↑ once the reader
 *   has scrolled down and the rest are above;
 * - it is a press that scrolls a page that way, so the number is something to
 *   act on rather than a reason to hunt for the scrollbar;
 * - it says what is waiting on you in the rows it hides, for a pane whose rows
 *   say so (`data-rail-needs`) — "2 more · 3 need you", in the queue's ochre —
 *   because in Hot first order the orgs under the fold are the quiet ones, and
 *   the one time they are not is the one time the chip has to be read.
 *
 * Until the pane has been laid out — the first frame, or a host that never
 * lays it out at all — it falls back on the budget's count, which is the same
 * number with the reader at the top of the list.
 */
export function TicklerRailMore({
  budget,
  className,
  countClassName,
}: {
  budget?: TicklerRailPaneBudget;
  className?: string;
  /**
   * On the "2 more" of "2 more · 3 need you", for a header too narrow for both:
   * the count of rows is the part to give up, since the hover names them.
   */
  countClassName?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [offscreen, setOffscreen] = useState<TicklerRailOffscreen | null>(null);
  const live = Boolean(budget && !budget.demoted && budget.hidden > 0);

  const scroller = useCallback(
    () => ref.current?.closest("[data-rail-pane]")?.querySelector<HTMLElement>("[data-rail-scroll]") ?? null,
    [],
  );

  // Every render, not on a dependency list: the rows change under this chip —
  // an org starts needing you, a task finishes — without anything it was given
  // changing, and a read is a handful of rects.
  useLayoutEffect(() => {
    const element = live ? scroller() : null;
    const next = element && element.clientHeight > 0 ? readOffscreen(element) : null;
    setOffscreen((previous) => (sameOffscreen(previous, next) ? previous : next));
  });

  useEffect(() => {
    const element = live ? scroller() : null;
    if (!element) return;
    const update = () => {
      const next = element.clientHeight > 0 ? readOffscreen(element) : null;
      setOffscreen((previous) => (sameOffscreen(previous, next) ? previous : next));
    };
    element.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [live, scroller]);

  if (!budget || budget.hidden <= 0) return null;

  // Demoted, the pane is its header and there is nothing to scroll: the count
  // is all there is to say, and the header beside it already digests the rows.
  if (budget.demoted) {
    return (
      <span
        data-rail-more
        className={cn(MICRO, "shrink-0 font-normal normal-case tracking-normal tabular-nums text-muted-foreground")}
        title={`${budget.hidden} more — give the rail a taller window to see them`}
      >
        +{budget.hidden} more
      </span>
    );
  }

  const measured = offscreen !== null;
  // Below first: it is where an unscrolled pane's rows are, and where a reader
  // part-way down still has the most to see.
  const down = offscreen ? offscreen.below.rows.length > 0 : true;
  const hidden = offscreen ? (down ? offscreen.below : offscreen.above) : null;
  const rows = hidden?.rows ?? [];
  const count = hidden ? rows.length : budget.hidden;
  // Not null: the ref is how the next read finds the pane. Without it the read
  // comes back empty, the chip falls back on the budget's count and draws, reads
  // 0 again and hides — every commit, until React gives up (#185, PLI-286).
  if (count === 0) return <button ref={ref} type="button" hidden />;
  const needs = hidden?.needs ?? 0;
  const Arrow = down ? ArrowDown : ArrowUp;
  const where = down ? "below" : "above";
  const other = offscreen ? (down ? offscreen.above : offscreen.below).rows.length : 0;
  const title = [
    hidden && hidden.names.length > 0 ? `${count} ${where}: ${hidden.names.join(", ")}` : `${count} more ${where}`,
    needs > 0 ? `${needs} need${needs === 1 ? "s" : ""} you there` : null,
    other > 0 ? `${other} more ${down ? "above" : "below"}` : null,
    `Click to scroll ${down ? "down" : "up"}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const scroll = () => {
    const element = scroller();
    if (!element) return;
    const view = element.getBoundingClientRect();
    // A page at most, so a long list moves in steps the eye can follow, and
    // never past the last hidden row on that side.
    const edge = down ? rows[rows.length - 1]!.getBoundingClientRect().bottom - view.bottom : rows[0]!.getBoundingClientRect().top - view.top;
    const delta = down ? Math.min(edge, element.clientHeight) : Math.max(edge, -element.clientHeight);
    element.scrollBy({ top: delta, behavior: "smooth" });
  };

  return (
    <button
      ref={ref}
      type="button"
      data-rail-more={down ? "below" : "above"}
      data-rail-more-needs={needs > 0 ? needs : undefined}
      onClick={measured ? scroll : undefined}
      title={title}
      aria-label={`${count} more ${down ? "below" : "above"}${needs > 0 ? `, ${needs} need you` : ""} — scroll ${down ? "down" : "up"}`}
      className={cn(
        MICRO,
        "-my-0.5 inline-flex shrink-0 items-center gap-0.5 rounded px-1 font-normal normal-case tracking-normal tabular-nums hover:bg-muted",
        needs > 0 ? "text-tickler-wait" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {needs > 0 ? (
        <>
          <span className={countClassName}>{count} more · </span>
          <span className="font-semibold">{needs} need you</span>
        </>
      ) : (
        <>{count} more</>
      )}
      <Arrow className="h-3 w-3" aria-hidden="true" />
    </button>
  );
}

/**
 * The toggle that gives a pane the rail, in that pane's header.
 *
 * Shared by Recent (PLI-271) and Orgs (PLI-273) because it has to look and
 * behave like one control: the two are alternatives — expanding either folds
 * Portfolio and Routines, and only one can be expanded at a time — so a reader comparing
 * the two headers is comparing the same button, and a second hand-rolled copy is
 * how two buttons that mean the same thing end up a pixel and an aria attribute
 * apart.
 *
 * What is *not* shared is the `title`, which is the only part that carries any
 * information: what the press buys differs per pane — Recent trades two panes
 * for a week of history, Orgs trades the same two for the rest of the list —
 * and that is exactly the part the icon cannot say.
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
