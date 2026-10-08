/**
 * The left rail's height budget.
 *
 * The rail used to be four cards in a column, each with its own pixel scroll
 * cap — 256px of Recent, 160px of Routines, and nothing at all on Orgs. Two
 * consequences, both visible on the board: watching another org pushed every
 * pane below Orgs down the page until Portfolio was off the bottom of the
 * screen, and a 27-inch monitor got exactly the same 160px of Routines as a
 * 13-inch laptop. Height that existed was not spent; height that did not exist
 * was spent anyway.
 *
 * So the rail is told how tall it is and spends it. Each pane declares the
 * fewest rows worth drawing and the most rows worth keeping, plus a priority.
 * Everyone who can afford its minimum gets it, then the surplus goes out one
 * row at a time in priority order, round-robin, so the pane that most wants
 * height gets it first and nothing starves. A pane that cannot afford its
 * minimum demotes to its header rather than being clipped, and a pane holding
 * rows back says how many. One pane may be marked {@link TicklerRailPaneSpec.first}
 * and is filled to its ideal before that round-robin starts, which is how the
 * height another pane was folded to free reaches the pane that asked for it.
 *
 * Every height here is measured from the page ({@link useRailBudget}) rather
 * than assumed: a row's height depends on the theme's line height and on the
 * density setting, and a constant that drifts from it is precisely how the old
 * rail ended up drawing a row sliced through the middle.
 *
 * Those measurements are fractional, and the direction of the rounding is the
 * whole of PLI-263: a pane pinned to the floor of what its rows need scrolls
 * by the fraction, so its header says it is showing everything while a
 * scrollbar says otherwise. Only `height` is rounded, and it is rounded up.
 */

export interface TicklerRailPaneSpec {
  /** Matches `data-rail-pane` on the pane's own element. */
  key: string;
  /** Below this the pane is not worth drawing at all, and it demotes. */
  minRows: number;
  /** Past this, height is better spent on another pane. `Infinity` = all of them. */
  idealRows: number;
  /**
   * Lower goes first, both for minimums and for the surplus. Panes may share a
   * rank — they are then served in the order they are declared, which is how
   * "these two matter and the rest are equal" is written down.
   */
  priority: number;
  /**
   * Folded to its header by the reader, not by the arithmetic. It draws no rows
   * whatever the rail's height, and the rows it would have taken are surplus for
   * everyone else — which is how one pane is given a taller list than the rail
   * could otherwise seat (PLI-271).
   *
   * Distinct from `minRows: 0`: a pane with no floor still joins the surplus
   * round-robin and would quietly grow back the moment the window did.
   */
  collapsed?: boolean;
  /**
   * Filled to its ideal before the surplus goes round, because this pane is the
   * reason there is a surplus (PLI-271).
   *
   * Priority is not enough for that: it orders the panes inside each turn of the
   * round-robin, and every pane that can still grow takes a row every turn. So
   * folding Portfolio and Routines to lengthen Recent handed Orgs — which has no
   * ideal, and so can always grow — every other row of what the fold freed, and
   * Orgs rows cost half again what Recent rows do. The reader pressed a button on
   * Recent and watched Orgs grow, which is PLI-271's bug report.
   *
   * Only for a pane whose ideal is finite, and only worth setting when something
   * else was folded to pay for it: an unconditional `first` is a pane that eats
   * a short rail before anyone else is served their minimum — which the floors
   * below already prevent, but it would still take every spare row on a tall one.
   */
  first?: boolean;
  /**
   * Rows served straight after the pane's own floor, as far as the rail can pay
   * for them — the rows the reader asked for by name. So they come ahead of the
   * floor of every pane served after this one, and of everyone's surplus.
   *
   * Routines' pinned rows (PLI-275). They were first drawn outside the budget,
   * so a pinned routine was height nobody had paid for and the rail scrolled.
   * Inside it, but only as ordinary rows, they would wait their turn in the
   * round-robin behind Orgs and Recent and fold behind "+N more" on any screen
   * short of tall. Reserved, the panes served before this one keep their
   * floors, and the rest shave their surplus or fold to their headers.
   *
   * Unlike a floor, a reserve the rail cannot pay for in full is paid in part:
   * the pane is never demoted for asking.
   */
  reserveRows?: number;
  /**
   * Rows to keep growing towards once everyone else has been served, paying for
   * them by taking `droppable` panes off the rail if what is left is not enough
   * (PLI-287).
   *
   * For a pane the reader expanded on a rail that had nothing left to give it:
   * Portfolio and Routines already folded to their headers, and Orgs — above
   * it — not to be touched, because every row taken from Orgs moves the header
   * that was just pressed. So it is served last, and from below.
   */
  tailRows?: number;
  /**
   * Folded, and may leave the rail altogether — header and gap — when the
   * `tailRows` pane still wants rows. Last declared goes first, so the rail
   * gives up its bottom pane before the one above it. Only with `collapsed`.
   */
  droppable?: boolean;
}

/** One pane, as the page actually drew it. */
export interface TicklerRailPaneMetrics {
  /** The header. Always drawn, and the whole of a demoted pane. */
  head: number;
  /** Everything else that is not a row: a legend, an "N more" line, an empty note. */
  foot: number;
  /** One row. Zero when the pane has no rows to measure. */
  row: number;
  /** The pane's own border and padding, which its height has to carry too. */
  frame: number;
  /* Each of the four above is fractional — see the note at the top. */
  /** Rows the pane has to show, whether or not they fit. */
  total: number;
}

export interface TicklerRailPaneBudget {
  /** Rows the pane may draw. Zero means demoted, or that it has none. */
  rows: number;
  /** Whole pixels to pin the pane to — rounded up — or null to let it size itself. */
  height: number | null;
  /** Rows it is holding back, for the header to own up to. */
  hidden: number;
  /** Header only: the pane could not afford even its minimum. */
  demoted: boolean;
  /** Off the rail entirely, header included — see `droppable`. */
  dropped?: boolean;
}

export type TicklerRailBudget = Record<string, TicklerRailPaneBudget | undefined>;

/** A pane left to size itself, which is every pane until the rail is measured. */
const UNBUDGETED: TicklerRailPaneBudget = { rows: 0, height: null, hidden: 0, demoted: false };

/** Every pane sizing itself — the pre-measurement state, and the narrow layout. */
export function unbudgeted(specs: readonly TicklerRailPaneSpec[]): TicklerRailBudget {
  return Object.fromEntries(specs.map((spec) => [spec.key, UNBUDGETED]));
}

/**
 * Enough of a pane measured to reason about it: a header, and a row height if
 * it has rows. A pane that has not been measured yet takes the whole rail out
 * of the budget rather than being guessed at — a bad guess here moves panes
 * around on the reader after first paint, which is worse than one frame of the
 * heights the panes give themselves.
 */
function measured(metrics: TicklerRailPaneMetrics | undefined): metrics is TicklerRailPaneMetrics {
  if (!metrics || metrics.head <= 0) return false;
  return metrics.total === 0 || metrics.row > 0;
}

/**
 * Hand out `available` pixels of rail to `specs`.
 *
 * `gap` is the space between two panes; it is charged once per join, so the
 * budget is the rail's inner height minus the gaps it must draw.
 */
export function distributeRailHeight(
  specs: readonly TicklerRailPaneSpec[],
  metrics: Record<string, TicklerRailPaneMetrics | undefined>,
  { available, gap }: { available: number; gap: number },
): TicklerRailBudget {
  const panes = specs.map((spec) => ({ spec, box: metrics[spec.key] }));
  if (available <= 0 || !panes.every(({ box }) => measured(box))) return unbudgeted(specs);
  const boxes = metrics as Record<string, TicklerRailPaneMetrics>;

  // An empty pane is not a demoted one: "all 7 routines healthy" is the answer,
  // not a pane that has been squeezed out. It is never promoted and never
  // clipped, and it costs whatever its one line costs.
  const empty = (key: string) => boxes[key].total === 0;
  const ideal = (spec: TicklerRailPaneSpec) => Math.min(spec.idealRows, boxes[spec.key].total);
  const floor = (spec: TicklerRailPaneSpec) => Math.min(spec.minRows, boxes[spec.key].total);

  const rows: Record<string, number> = Object.fromEntries(specs.map((spec) => [spec.key, 0]));
  /** Panes taken off the rail for a `tailRows` pane: no header, and no gap. */
  const dropped = new Set<string>();
  /**
   * What the pane costs, rounded up to the whole pixel it will be pinned to.
   *
   * Up, and at the end rather than per part: every height here is fractional
   * (a row is 28.375px long before it is anything else), and a pane pinned to
   * the floor of its own contents scrolls by the fraction it was docked — a
   * scrollbar for rows the pane is already showing, which is PLI-263. Rounding
   * up spends at most one pixel per pane and leaves it to the row list, which
   * is the flexible child.
   */
  const paneHeight = (key: string) => {
    if (dropped.has(key)) return 0;
    const box = boxes[key];
    const drawn = rows[key] > 0 || empty(key);
    return Math.ceil(box.frame + box.head + (drawn ? box.foot : 0) + rows[key] * box.row);
  };
  const spent = () =>
    specs.reduce((total, spec) => total + paneHeight(spec.key), 0) +
    gap * Math.max(0, specs.length - dropped.size - 1);
  /** Take `n` rows if the rail can still pay for every pane; otherwise change nothing. */
  const afford = (key: string, n: number) => {
    const held = rows[key];
    rows[key] = n;
    if (spent() <= available) return true;
    rows[key] = held;
    return false;
  };

  const order = [...specs].sort((a, b) => a.priority - b.priority);
  for (const spec of order) {
    // A folded pane is never given a floor, and the surplus loop below skips
    // anything still at zero rows, so it stays a header for as long as it is
    // folded however much height turns up.
    if (empty(spec.key) || spec.collapsed) continue;
    if (!afford(spec.key, floor(spec)) || !spec.reserveRows) continue;
    // Rows asked for by name — see `reserveRows` — straight after the pane's
    // own floor, so ahead of the floor of every pane served after it.
    const reserve = Math.min(spec.reserveRows, ideal(spec));
    while (rows[spec.key] < reserve && afford(spec.key, rows[spec.key] + 1));
  }
  // The pane the height was freed for, filled first and in one go — see `first`.
  // After its minimum, so a rail too short for everyone's floor still spends
  // itself the way it would have.
  for (const spec of order) {
    if (!spec.first || rows[spec.key] === 0) continue;
    while (rows[spec.key] < ideal(spec) && afford(spec.key, rows[spec.key] + 1));
  }
  // The surplus, one row at a time, cycling the panes in priority order and
  // skipping any already at its ideal. Orgs is cheap and first, so it is whole
  // before Routines takes its fourth row; on a tall screen every pane grows
  // together instead of one pane eating the height.
  for (let moving = true; moving; ) {
    moving = false;
    for (const spec of order) {
      if (rows[spec.key] === 0 || rows[spec.key] >= ideal(spec)) continue;
      if (afford(spec.key, rows[spec.key] + 1)) moving = true;
    }
  }
  // Last, the pane still growing towards `tailRows`: from whatever is left, then
  // from the panes below it, one at a time from the bottom of the rail. Every row
  // above it is already settled, so this only ever moves things under it.
  const droppable = specs.filter((spec) => spec.collapsed && spec.droppable).reverse();
  for (const spec of order) {
    if (!spec.tailRows || rows[spec.key] === 0) continue;
    const want = Math.min(spec.tailRows, boxes[spec.key].total);
    for (const next of droppable) {
      while (rows[spec.key] < want && afford(spec.key, rows[spec.key] + 1));
      if (rows[spec.key] >= want) break;
      dropped.add(next.key);
    }
    while (rows[spec.key] < want && afford(spec.key, rows[spec.key] + 1));
  }
  // A pane dropped for less than a row's worth is put back: gone for nothing is
  // still gone.
  for (const spec of [...droppable].reverse()) {
    if (!dropped.has(spec.key)) continue;
    dropped.delete(spec.key);
    if (spent() > available) dropped.add(spec.key);
  }

  return Object.fromEntries(
    specs.map((spec) => {
      const box = boxes[spec.key];
      const drawn = rows[spec.key];
      // Folded reads as demoted to the pane itself — header only — because that
      // is the state it already knows how to draw. It is told how many rows it
      // is holding so the header can say so.
      if (dropped.has(spec.key)) return [spec.key, { rows: 0, height: null, hidden: box.total, demoted: true, dropped: true }];
      if (spec.collapsed) return [spec.key, { rows: 0, height: null, hidden: box.total, demoted: true }];
      if (empty(spec.key)) return [spec.key, UNBUDGETED];
      if (drawn === 0) return [spec.key, { rows: 0, height: null, hidden: box.total, demoted: true }];
      return [
        spec.key,
        {
          rows: drawn,
          // Header plus a whole number of rows, always: this is what keeps a
          // pane from ending in a row cut in half.
          height: paneHeight(spec.key),
          hidden: Math.max(0, box.total - drawn),
          demoted: false,
        },
      ];
    }),
  );
}

/**
 * The budget of a folded pane, for a rail that has no budget to fold.
 *
 * Wide, `collapsed` on the spec does this and frees the height besides. Narrow
 * there is nothing to free — the rail is `display: contents` and every pane
 * sizes itself — but the fold is the reader's choice either way, so it is
 * applied to the pane directly. Whatever the budget knew about rows held back
 * is carried through.
 */
export function collapsedPane(budget: TicklerRailPaneBudget | undefined): TicklerRailPaneBudget {
  return { rows: 0, height: null, hidden: budget?.hidden ?? 0, demoted: true };
}

/** Two budgets that would draw the same rail, so the hook can skip a re-render. */
export function sameRailBudget(a: TicklerRailBudget, b: TicklerRailBudget): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const left = a[key];
    const right = b[key];
    if (!left || !right) return left === right;
    if (
      left.rows !== right.rows ||
      left.height !== right.height ||
      left.hidden !== right.hidden ||
      left.demoted !== right.demoted ||
      Boolean(left.dropped) !== Boolean(right.dropped)
    )
      return false;
  }
  return true;
}
