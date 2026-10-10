import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  distributeRailHeight,
  holdTallest,
  sameRailBudget,
  unbudgeted,
  type TicklerRailBudget,
  type TicklerRailPaneMetrics,
  type TicklerRailPaneSpec,
} from "../lib/rail-budget";
import { resolveScrollport } from "../lib/scrollport";

/** Fallback when the rail has no computed gap to read — matches `gap-4`. */
const FALLBACK_GAP = 16;

/** Enough rows to find the tallest one without walking a hundred of them. */
const ROW_SAMPLE = 12;

/** The least room to leave above the rail — the `top-4` it pins at. */
const GUTTER = 16;

/**
 * Taller than any rail, and small enough to stay exact in a layout engine.
 *
 * Only ever written and read back inside one layout pass — see
 * {@link insetBelow} — so it is never painted.
 */
const PROBE_HEIGHT = 100_000;

/**
 * The box the rail is pinned inside, which is not the window.
 *
 * The host scrolls an inner `<main>` rather than the document, and that element
 * is both shorter than the viewport and offset down it. A rail sized at
 * `100vh - 2rem` — which is what it was — is therefore taller than the band it
 * can ever occupy, and the pane at the bottom hangs below the fold: exactly the
 * complaint this work exists to answer, arrived at from the other direction.
 *
 * `resolveScrollport` is the walk, and it answers `null` for the two cases where
 * the page itself scrolls — narrow hosts that leave `<main>` visible, and kiosk
 * mode, where the top-layer box is the screen and a scroller above it governs
 * nothing. There the document element is the band, and its `clientHeight` is the
 * viewport.
 */
function scrollPort(node: HTMLElement): HTMLElement | null {
  return resolveScrollport(node) ?? node.ownerDocument.documentElement;
}

/**
 * How far the rail's top sits below the top of the box it scrolls inside.
 *
 * The answer has to be where the rail was laid out, not where it is stuck, or
 * the height changes under a scroll. Neither a rect nor `offsetTop` gives that
 * on its own: both include the sticky shift, so with the page scrolled 1000px
 * a rail laid out 124px down reads as 1016px down a 600px band. The band then
 * measures nothing, every pane demotes, and scrolling back up brings them all
 * back — the rail that "dances and compacts itself" in GH#85, set off by any
 * render while the page was scrolled. So the rail is unstuck for the read and
 * stuck again straight after, inside the same layout effect: `static` lays a
 * box out exactly where `sticky` does, only without the shift, and nothing is
 * painted in between.
 */
function offsetWithin(node: HTMLElement, port: HTMLElement): number {
  const laidOutTop = (from: HTMLElement): number => {
    let top = 0;
    for (let el: HTMLElement | null = from; el; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
    return top;
  };
  const held = node.style.position;
  node.style.position = "static";
  const top = laidOutTop(node);
  node.style.position = held;
  return Math.max(0, top - laidOutTop(port));
}

/**
 * What the layout puts below the rail, which the rail's height has to leave room for.
 *
 * The board's grid sits inside a `<main>` with `p-6`, so under the rail there is
 * 24px of padding that belongs to nobody — and the rail's height used to be the
 * band less `GUTTER` at each end, 16px. Eight pixels of content with nothing in
 * them: as long as the queue was the taller column nobody could tell, because
 * the page was already scrolling for the queue. On a quiet board, where the rail
 * *is* the tallest thing on the page, the page grew a scrollbar that scrolled 8px
 * and revealed nothing — PLI-263 again, one level out from the panes.
 *
 * Measured rather than read off the CSS, because the answer is not only padding:
 * an ancestor's margin, a border, a grid row under the rail, a host that wraps
 * the page in another box all land in the same number. Stretch the rail past
 * anything else on the page and its column decides `scrollHeight`, so whatever
 * is left over above the probe is exactly what sits below the rail. Written and
 * undone inside a layout effect, before the browser paints.
 */
function insetBelow(rail: HTMLElement, port: HTMLElement): number {
  const held = rail.style.height;
  rail.style.height = `${PROBE_HEIGHT}px`;
  const inset = port.scrollHeight - offsetWithin(rail, port) - PROBE_HEIGHT;
  rail.style.height = held;
  return Math.max(0, inset);
}

/**
 * A box's real height, fractions and all.
 *
 * `offsetHeight` — which this used to read — is an integer, and a rail row is
 * almost never a whole number of pixels: the micro type scale is 11px at a line
 * height of 1.45, so a row lands on something like 28.375px and reports 28.
 * Three rows of it are then budgeted 84px against 85.125px of rows, and the
 * pane scrolls by a pixel while its header says it is showing everything —
 * which is the complaint in PLI-263, arrived at from the measuring end. Rects
 * are fractional, so a row costs what it costs and {@link distributeRailHeight}
 * rounds the one number it hands back up rather than every input down.
 */
function heightOf(node: HTMLElement | null): number {
  return node ? node.getBoundingClientRect().height : 0;
}

/**
 * The pane's own border and padding — the part of its height no row can use.
 *
 * Read from the computed style rather than as `offsetHeight - clientHeight`,
 * because both of those are integers and their difference carries both
 * roundings.
 */
function frameOf(node: HTMLElement): number {
  const style = getComputedStyle(node);
  const px = (value: string) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (
    px(style.borderTopWidth) + px(style.borderBottomWidth) + px(style.paddingTop) + px(style.paddingBottom)
  );
}

/**
 * Measure the rail and hand each pane its height.
 *
 * The panes mark themselves up for this: `data-rail-pane` on the pane,
 * `data-rail-head` on its header, `data-rail-foot` on anything else that is not
 * a row, and `data-rail-row` on each row. Nothing is measured by class name and
 * no height is a constant, so the budget survives a density change, a font
 * change and a theme that sets its own line height.
 *
 * Returns a ref for the rail and a budget keyed by pane. Until the rail has a
 * height — the narrow layout, where the rail is `display: contents` and has no
 * box at all; a test in jsdom, where everything measures zero — every pane is
 * unbudgeted and sizes itself exactly as it did before.
 *
 * Those two cases are not the same thing, though, and `narrow` tells them
 * apart: unmeasured is a state that ends at the next frame, while `contents` is
 * a layout the rail will stay in until the window changes. A pane that has to
 * bound itself when nothing is bounding it — Recent, whose rows are the
 * fleet's and grow with it — needs to know which one it is in.
 */
export function useRailBudget(specs: readonly TicklerRailPaneSpec[]): {
  railRef: (node: HTMLDivElement | null) => void;
  budget: TicklerRailBudget;
  /** The rail is `display: contents`: one column, and no height to share out. */
  narrow: boolean;
} {
  const railRef = useRef<HTMLDivElement | null>(null);
  // Kept across renders because a demoted pane has no rows on the page to
  // measure: without the last heights it had, it could never be promoted back.
  const remembered = useRef<Record<string, TicklerRailPaneMetrics>>({});
  // What the budget was last handed, and the rail it was handed for — see
  // `holdTallest`. A pane's header can only grow while this rail stands.
  const settled = useRef<{
    band: number;
    specs: readonly TicklerRailPaneSpec[];
    totals: string;
    metrics: Record<string, TicklerRailPaneMetrics>;
  } | null>(null);
  const [budget, setBudget] = useState<TicklerRailBudget>(() => unbudgeted(specs));
  // False until the rail has been looked at, which is the wide layout's answer
  // and also the one frame before the first measurement. Wrong for that frame
  // on a phone, but it is a pre-paint frame — `useLayoutEffect` runs before the
  // browser draws — so the panes are never seen unbounded.
  const [narrow, setNarrow] = useState(false);

  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    // Narrow: the rail is `display: contents`, its panes are grid items of the
    // page, and there is no column to share out. Anything written here would
    // be ignored anyway, so it is taken back rather than left behind for the
    // next time the window is wide.
    if (getComputedStyle(rail).display === "contents") {
      rail.style.height = "";
      rail.style.maxHeight = "";
      setNarrow(true);
      setBudget((current) => {
        const next = unbudgeted(specs);
        return sameRailBudget(current, next) ? current : next;
      });
      return;
    }
    setNarrow(false);
    // The rail is told its height here rather than in a class, because the band
    // it is pinned inside belongs to the host, not to the window.
    const port = scrollPort(rail);
    // Less what the rail starts below: the board's own header is inside the
    // scrolling box and above the rail, so at rest — which is where the page
    // opens, and where it stays until someone scrolls it — a rail given the
    // whole band hangs exactly that far below the fold. Measured at 2560×1400:
    // a 1308px rail starting 118px down a 1340px box, with Routines 65px past
    // the bottom of the screen. The offset is static, so the rail keeps one
    // height whatever the scroll position; once it pins at `top-4` the cost is
    // that much unused room under it, which is a gap rather than a clipped pane.
    // The `--tickler-rail-max-h` cap is the first-paint value and nothing more:
    // it is `100dvh` less an allowance for the host's chrome, so on a host with
    // less chrome than that allowance it is *shorter* than the band we are about
    // to measure, and would clip the panes the budget had just been told fit. A
    // measured rail answers to the measurement. Lifted before the probe too, or
    // it would cap the probe and `insetBelow` would read the cap back.
    rail.style.maxHeight = port ? "none" : "";
    const head = port ? Math.max(GUTTER, offsetWithin(rail, port)) : 0;
    // What is under the rail is measured, not assumed to match `head`: the
    // board's `p-6` leaves 24px down there and the rail used to keep 16, so the
    // page scrolled 8px over nothing whenever the rail outgrew the queue.
    const tail = port ? insetBelow(rail, port) : 0;
    const band = port ? Math.max(0, port.clientHeight - head - tail) : 0;
    rail.style.height = band > 0 ? `${band}px` : "";
    if (band <= 0) rail.style.maxHeight = "";
    for (const spec of specs) {
      const pane = rail.querySelector<HTMLElement>(`[data-rail-pane="${spec.key}"]`);
      if (!pane) continue;
      const rows = Array.from(pane.querySelectorAll<HTMLElement>("[data-rail-row]"));
      let foot = 0;
      for (const part of pane.querySelectorAll<HTMLElement>("[data-rail-foot]")) foot += heightOf(part);
      const held = remembered.current[spec.key];
      remembered.current[spec.key] = {
        // A dropped pane (`droppable`) is `display: none` and measures nothing,
        // header included; without the height it had, it could never come back.
        head: heightOf(pane.querySelector<HTMLElement>("[data-rail-head]")) || (held?.head ?? 0),
        // A demoted pane draws neither rows nor footer. Measuring its footer as
        // nothing would cost it that much less to promote than it really costs,
        // and it would come back a footer too tall for the rail. An empty pane
        // still draws its "all 7 healthy" note, so it measures itself.
        foot: rows.length === 0 && foot === 0 ? (held?.foot ?? 0) : foot,
        // The tallest of the sample rather than the first: Portfolio's sticky
        // company headings are rows too and are shorter than a project's bar,
        // and a row height that under-measures puts the half-drawn row back.
        row: rows.length ? Math.max(...rows.slice(0, ROW_SAMPLE).map(heightOf)) : (held?.row ?? 0),
        frame: frameOf(pane),
        total: rows.length || (held?.total ?? 0),
      };
    }
    // The same rail as last time — same band, same specs, the same rows in
    // every pane — is measured at the tallest it has drawn, or a header that
    // wraps only while its pane holds rows back flips the budget every commit.
    const totals = specs.map((spec) => remembered.current[spec.key]?.total ?? -1).join(",");
    const held = settled.current;
    const metrics =
      held && held.band === band && held.specs === specs && held.totals === totals
        ? holdTallest(held.metrics, remembered.current)
        : { ...remembered.current };
    settled.current = { band, specs, totals, metrics };
    const gap = Number.parseFloat(getComputedStyle(rail).rowGap);
    const next = distributeRailHeight(specs, metrics, {
      available: band,
      gap: Number.isFinite(gap) ? gap : FALLBACK_GAP,
    });
    setBudget((current) => (sameRailBudget(current, next) ? current : next));
  }, [specs]);

  // After every render, because the rail's contents are the thing that changes:
  // a run starts, an org is watched, a routine recovers. Reading a header, a
  // footer and a dozen row heights is cheap, and the budget is only applied
  // when it differs. It settles because what it measures cannot shrink under
  // it — `settled` — not because the budget cannot change what it measures:
  // a pane's header carries its "+N more", and assuming otherwise is GH#84.
  useLayoutEffect(measure);

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      railRef.current = node;
      if (!node || typeof ResizeObserver === "undefined") return;
      // The scrolling box, not the rail: the rail's height is the thing being
      // written, and observing what you write is how a layout loop starts. The
      // box it is pinned inside changes only when the window does.
      const port = scrollPort(node);
      if (!port) return;
      const observer = new ResizeObserver(() => measure());
      observer.observe(port);
      return () => observer.disconnect();
    },
    [measure],
  );

  return { railRef: attach, budget, narrow };
}
