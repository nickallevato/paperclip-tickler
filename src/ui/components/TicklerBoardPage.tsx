import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Company } from "@paperclipai/shared";
import { cn } from "../host/util";
import {
  TICKLER_FREEZE,
  deriveNeedsBreakdown,
  deriveThroughput,
  formatTokensMillions,
  thresholdsFor,
  type TicklerActionable,
  type TicklerCompanyStats,
  type TicklerSortMode,
  type TicklerTokenSettings,
} from "../lib/tickler";
import {
  countQueueByAge,
  deriveQueueItems,
  filterQueueByAge,
  groupQueue,
  isSnoozed,
  recentTasks,
  summarizeDecide,
  summarizeQueue,
  TICKLER_RECENT_EXPANDED_LIMIT,
  TICKLER_RECENT_EXPANDED_WINDOW_MS,
  upcomingProjects,
  upcomingRoutines,
  type TicklerExpandedPane,
  type TicklerPortfolioSort,
  type TicklerQueueAgeFilter,
  type TicklerQueueGrouping,
  type TicklerQueueSort,
} from "../lib/queue";
import {
  normalizePinnedRoutineIds,
  pinnedRoutineEntries,
  TICKLER_PINNED_ROUTINES_STORAGE_KEY,
  togglePinnedRoutineId,
} from "../lib/pinned-routines";
import { paneOrderClass, type TicklerPaneKey } from "../lib/pane-order";
import { collapsedPane, type TicklerRailPaneSpec } from "../lib/rail-budget";
import { TicklerCompanySlot } from "./TicklerCompanySlot";
import { TicklerPortfolio } from "./TicklerPortfolio";
import { railPaneBox, TicklerRailExpand, TicklerRailMore } from "./TicklerRailPane";
import { TicklerQueue } from "./TicklerQueue";
import { TicklerRecentTasks } from "./TicklerRecentTasks";
import { TicklerRoutineExceptions } from "./TicklerRoutineExceptions";
import { TicklerPinRoutinePicker } from "./TicklerPinnedRoutines";
import { TicklerSegmented } from "./TicklerSegmented";
import type { TicklerCompanyData } from "./useTicklerCompanyData";
import { applyTriageOverrides, useQueueTriage } from "./useQueueTriage";
import { useRailBudget } from "./useRailBudget";
import { useTicklerUsage } from "./useTicklerUsage";
import { TicklerUsageStrip } from "./TicklerUsageStrip";
import {
  formatTokensCompact,
  normalizeUsageWindow,
  TICKLER_USAGE_WINDOW_STORAGE_KEY,
  TICKLER_USAGE_WINDOWS,
  usageSeriesTitle,
  type TicklerUsageWindow,
} from "../lib/usage";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";

/**
 * How the rail spends its height. Three numbers per pane and nothing else:
 * the fewest rows worth drawing, the most rows worth keeping, and who gets
 * served first when there is not enough for everyone. `distributeRailHeight`
 * in `lib/rail-budget` is what is done with them.
 *
 * Orgs and Recent are the two that matter, so they share the first rank and a
 * short screen spends itself on them: Orgs because it is navigation — every org
 * you watch belongs on the page, and its rows are the cheapest in the rail —
 * and Recent because it is what the board is for. Orgs has no ideal; Recent
 * stops at twelve, past which it is a log rather than a glance. Portfolio and
 * Routines share the second rank, equal to each other, and take what is left:
 * Portfolio capped at eleven, since comparing bars past that is not something
 * anyone does at a glance, and Routines content with four — on a good day it
 * has no exceptions at all and the header alone is the answer. Pinned routines
 * (PLI-275) come on top of those four, and are reserved: served straight after
 * Routines' own floor, so Orgs and Recent keep their three rows each, and it is
 * their surplus that shrinks to seat the pins, and Portfolio that folds first.
 *
 * Ranks tie by the order written here, which is the only thing this order does.
 *
 * `expanded` is the reader's own override of that settlement: one pane is given
 * the rail and the others fold to their headers, which is where the height for
 * its extra rows comes from. Only one at a time — see `TicklerExpandedPane` —
 * because the height each would be asking for is the height the other was just
 * folded to free.
 *
 * Recent expanded (PLI-271) doubles its ideal and folds the two panes under it.
 * It is also served `first`, which is the half of this the first cut got wrong:
 * priority alone orders the panes inside each turn of the surplus round-robin,
 * and Orgs, which has no ideal and so can always take another row, took every
 * other row the fold had just freed — at half again the price, an org row being
 * taller than a Recent row. Pressing a button on Recent grew Orgs, which is what
 * the bug report said. Filled first, Recent gets the rows it asked for and Orgs
 * takes what is left over, which on a tall screen is still most of what it had.
 *
 * Orgs expanded (PLI-273) is the same trade from the other side, and folds the
 * same two panes. It first folded Recent as well, on the grounds that Recent is
 * the largest of Orgs' neighbours — but Recent is a pane people read alongside
 * the org list, not instead of it, and the first thing asked of the release was
 * to have it back. So Recent stands at its ordinary ideal and shares the freed
 * height round-robin with Orgs: it is served to its twelve rows, and Orgs takes
 * every row after that. Nothing changes about Orgs' own spec — its ideal is
 * already every org you watch, so there is no number to double, and no `first`,
 * which would starve Recent to its floor of three on any rail short of the
 * whole org list.
 */
function railPanes(expanded: TicklerExpandedPane, pinnedRoutines: number): readonly TicklerRailPaneSpec[] {
  const orgs = expanded === "orgs";
  const recent = expanded === "recent";
  const portfolio: TicklerRailPaneSpec = { key: "portfolio", minRows: 3, idealRows: 11, priority: 2, collapsed: orgs || recent };
  const routines: TicklerRailPaneSpec = {
    key: "routines",
    minRows: 2,
    idealRows: pinnedRoutines + ROUTINE_EXCEPTION_ROWS,
    priority: 2,
    collapsed: orgs || recent,
    reserveRows: pinnedRoutines,
  };
  return [
    { key: "orgs", minRows: 3, idealRows: Infinity, priority: 1 },
    {
      key: "recent",
      minRows: 3,
      idealRows: recent ? RECENT_EXPANDED_ROWS : RECENT_ROWS,
      priority: 1,
      first: recent,
    },
    // Pinned routines are rows the reader asked for by name (PLI-275), so with
    // any pinned Routines is served ahead of Portfolio: on a window too short
    // for both, Portfolio is the one folded to its header.
    ...(pinnedRoutines > 0 ? [routines, portfolio] : [portfolio, routines]),
  ];
}

/** Broken routines worth a row each; past this the header's count is the answer. */
const ROUTINE_EXCEPTION_ROWS = 4;

/** Past twelve, Recent is a log rather than a glance — unless asked for. */
const RECENT_ROWS = 12;

/** "Double the list", literally: the point of the fold below it. */
const RECENT_EXPANDED_ROWS = RECENT_ROWS * 2;

/** Re-render on a slow clock so ages and countdowns don't freeze between polls. */
function useNowMs(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (TICKLER_FREEZE) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/**
 * Queue + Board: a column of context on the left — one line per company, the
 * portfolio, routines that need attention — and the Needs-you queue owning the
 * main column. Each company still has exactly one TicklerCompanySlot; it renders
 * the company's line and reports its data up, and the page derives the queue
 * and the lists from what it has been told.
 */
export function TicklerBoardPage({
  companies,
  pinnedIds,
  onTogglePin,
  dataByCompany,
  statsByCompany,
  actionableByCompany,
  tokenSettings,
  alertsEnabled,
  onActionable,
  onStats,
  onData,
  sortMode,
  onSortMode,
  grouping,
  onGrouping,
  queueSort,
  onQueueSort,
  ageFilter,
  onAgeFilter,
  portfolioSort,
  onPortfolioSort,
  expandedPane,
  onExpandedPane,
  paneOrder,
  onNarrow,
  footer,
}: {
  /** Already ordered: watched first, then hot-first or the sidebar order. */
  companies: Company[];
  pinnedIds: string[];
  onTogglePin: (companyId: string) => void;
  dataByCompany: Record<string, TicklerCompanyData | undefined>;
  statsByCompany: Record<string, TicklerCompanyStats | undefined>;
  actionableByCompany: Record<string, TicklerActionable | undefined>;
  tokenSettings: TicklerTokenSettings;
  alertsEnabled: boolean;
  onActionable: (companyId: string, actionable: TicklerActionable) => void;
  onStats: (companyId: string, stats: TicklerCompanyStats) => void;
  onData: (companyId: string, data: TicklerCompanyData) => void;
  sortMode: TicklerSortMode;
  onSortMode: (mode: TicklerSortMode) => void;
  grouping: TicklerQueueGrouping;
  onGrouping: (grouping: TicklerQueueGrouping) => void;
  queueSort: TicklerQueueSort;
  onQueueSort: (sort: TicklerQueueSort) => void;
  ageFilter: TicklerQueueAgeFilter;
  onAgeFilter: (filter: TicklerQueueAgeFilter) => void;
  portfolioSort: TicklerPortfolioSort;
  onPortfolioSort: (sort: TicklerPortfolioSort) => void;
  /** The one rail pane given the rail, with the others folded to pay for it. */
  expandedPane: TicklerExpandedPane;
  onExpandedPane: (pane: TicklerExpandedPane) => void;
  /** The narrow stack's order. Ignored wide, where `order` is overridden away. */
  paneOrder: readonly TicklerPaneKey[];
  /**
   * Whether the board is down to one column, which only the rail can answer —
   * it is the element that goes `display: contents`. Reported up because the
   * control that acts on it lives in the HUD header, not on the board.
   */
  onNarrow: (narrow: boolean) => void;
  footer?: ReactNode;
}) {
  const nowMs = useNowMs();
  const orgsExpanded = expandedPane === "orgs";
  const recentExpanded = expandedPane === "recent";
  // Clicking a row's Need-you count narrows the rail to that company; clicking
  // it again (or the rail's chip) widens it back. Not persisted — it is a
  // glance, not a setting.
  const [focusCompanyId, setFocusCompanyId] = useState<string | null>(null);
  const focusCompany = focusCompanyId ? companies.find((company) => company.id === focusCompanyId) ?? null : null;
  const toggleFocus = (companyId: string) =>
    setFocusCompanyId((current) => (current === companyId ? null : companyId));
  const companiesById = useMemo(
    () => Object.fromEntries(companies.map((company) => [company.id, company])) as Record<string, Company | undefined>,
    [companies],
  );
  // Memoised on its inputs: every derivation below keys off this array, so a
  // fresh one per render would recompute the queue on every poll of any query.
  const loaded = useMemo(
    () =>
      companies
        .map((company) => ({ company, data: dataByCompany[company.id] }))
        .filter((entry): entry is { company: Company; data: TicklerCompanyData } => entry.data !== undefined),
    [companies, dataByCompany],
  );

  const queueItems = useMemo(
    () =>
      loaded
        .filter(({ company }) => !focusCompanyId || company.id === focusCompanyId)
        .flatMap(({ company, data }) =>
        deriveQueueItems({
          companyId: company.id,
          approvals: data.approvals,
          attention: data.attention,
          agents: data.agents,
          routines: data.routines,
          issues: data.issues,
          nowMs,
        }),
      ),
    [loaded, nowMs, focusCompanyId],
  );
  const { overrides, busy: triageBusy, triage } = useQueueTriage((companyId) => dataByCompany[companyId]?.invalidate());
  // Pending decide-by / snooze / archive writes applied on top, so a row moves
  // when clicked rather than a poll later. Snoozed items only exist in the
  // Decide-by grouping's Snoozed lane; everywhere else they are simply away.
  const triagedItems = useMemo(() => {
    const applied = applyTriageOverrides(queueItems, overrides);
    return grouping === "decide" ? applied : applied.filter((item) => !isSnoozed(item, nowMs));
  }, [queueItems, overrides, grouping, nowMs]);
  const projects = useMemo(() => loaded.flatMap(({ data }) => data.projects), [loaded]);
  // Counted before the filter is applied, so each chip can say how much it is
  // holding back — a chip that reported its own post-filter count would read
  // "0" for every bucket you are not standing in.
  const ageCounts = useMemo(() => countQueueByAge(triagedItems, nowMs), [triagedItems, nowMs]);
  const visibleItems = useMemo(
    () => filterQueueByAge(triagedItems, ageFilter, nowMs),
    [triagedItems, ageFilter, nowMs],
  );
  const decideSummary = useMemo(() => summarizeDecide(visibleItems, nowMs), [visibleItems, nowMs]);
  const groups = useMemo(
    () => groupQueue(visibleItems, grouping, companies, { projects, nowMs, sort: queueSort }),
    [visibleItems, grouping, companies, projects, nowMs, queueSort],
  );
  // The badge counts what is on screen: a rail filtered to "today" that still
  // claimed 137 would be describing a list the reader cannot see.
  const summary = useMemo(
    () => summarizeQueue(visibleItems.filter((item) => !isSnoozed(item, nowMs)), nowMs),
    [visibleItems, nowMs],
  );
  const recentEntries = useMemo(
    () =>
      loaded.map(({ company, data }) => ({
        company,
        runs: data.liveRuns,
        issues: data.runIssues.length > 0 ? [...data.issues, ...data.runIssues] : data.issues,
      })),
    [loaded],
  );
  const recent = useMemo(
    () => recentTasks(recentEntries, { nowMs }),
    [recentEntries, nowMs],
  );
  /**
   * The same list, a week deep and capped at twice the rows.
   *
   * Built whether or not Recent is expanded, because whether expanding would
   * show anything is the one thing the button has to know before it is pressed —
   * see `expandable` below. It is the same walk over the same issues the list
   * above already does, so the cost of knowing is a second pass over a few
   * hundred tickets.
   */
  const recentDeep = useMemo(
    () =>
      recentTasks(recentEntries, {
        nowMs,
        limit: TICKLER_RECENT_EXPANDED_LIMIT,
        windowMs: TICKLER_RECENT_EXPANDED_WINDOW_MS,
      }),
    [recentEntries, nowMs],
  );
  // Nothing to expand into: a board quiet enough that a week holds no more than
  // a day is a board where the fold would buy blank height, and the toggle says
  // so rather than appearing to do nothing — which is exactly how the first cut
  // read from the outside.
  const recentExpandable = recentDeep.items.length > recent.items.length;
  const routines = useMemo(
    () => upcomingRoutines(loaded.map(({ company, data }) => ({ company, routines: data.routines })), nowMs),
    [loaded, nowMs],
  );
  // Pinned routines (PLI-275): per browser, like the watched orgs.
  const [pinnedRoutineIds, setPinnedRoutineIds] = useState<string[]>(() => {
    try {
      return normalizePinnedRoutineIds(localStorage.getItem(TICKLER_PINNED_ROUTINES_STORAGE_KEY));
    } catch {
      return [];
    }
  });
  const togglePinnedRoutine = (id: string) => {
    const next = togglePinnedRoutineId(pinnedRoutineIds, id);
    setPinnedRoutineIds(next);
    try {
      localStorage.setItem(TICKLER_PINNED_ROUTINES_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage unavailable (private mode) — the pin still applies for this session
    }
  };
  const routineEntries = useMemo(
    () => loaded.map(({ company, data }) => ({ company, routines: data.routines })),
    [loaded],
  );
  const pinnedRoutines = useMemo(
    () => pinnedRoutineEntries(pinnedRoutineIds, routineEntries, routines, nowMs),
    [pinnedRoutineIds, routineEntries, routines, nowMs],
  );
  const pinnedRoutineSet = useMemo(() => new Set(pinnedRoutineIds), [pinnedRoutineIds]);
  // Hourly tokens per org (PLI-278). The window is per browser, like the pins.
  const [usageWindow, setUsageWindow] = useState<TicklerUsageWindow>(() => {
    try {
      return normalizeUsageWindow(localStorage.getItem(TICKLER_USAGE_WINDOW_STORAGE_KEY));
    } catch {
      return 24;
    }
  });
  const changeUsageWindow = (next: TicklerUsageWindow) => {
    setUsageWindow(next);
    try {
      localStorage.setItem(TICKLER_USAGE_WINDOW_STORAGE_KEY, String(next));
    } catch {
      // storage unavailable (private mode) — the choice still applies for this session
    }
  };
  const usage = useTicklerUsage(companies, usageWindow, nowMs);
  const projectEntries = useMemo(
    () => upcomingProjects(loaded.map(({ company, data }) => ({ company, projects: data.projects, issues: data.issues })), nowMs),
    [loaded, nowMs],
  );

  const totals = companies.reduce(
    (sum, company) => {
      const stats = statsByCompany[company.id];
      const data = dataByCompany[company.id];
      const actionable = actionableByCompany[company.id];
      return {
        needs: sum.needs + (actionable?.count ?? 0),
        runs: sum.runs + deriveThroughput(data?.summary?.runActivity ?? []).total,
        tokens: sum.tokens + (stats?.tokens ?? 0),
      };
    },
    { needs: 0, runs: 0, tokens: 0 },
  );

  // The rail's height, shared out. Orgs is read back here because its markup
  // lives on this page rather than in a component of its own. Memoised on the
  // one thing that changes the specs: the hook keys its measurement callback on
  // their identity, so a fresh array per render would re-measure the rail every
  // render instead of every layout change.
  const specs = useMemo(() => railPanes(expandedPane, pinnedRoutines.length), [expandedPane, pinnedRoutines.length]);
  const { railRef, budget, narrow } = useRailBudget(specs);
  // `narrow` is measured rather than guessed, and is false for the one pre-paint
  // frame before the first measurement, so the header's Pane order button is
  // never briefly offered on a desktop.
  useEffect(() => {
    onNarrow(narrow);
    return () => onNarrow(false);
  }, [narrow, onNarrow]);
  const orgsBudget = budget.orgs;
  const orgsBox = railPaneBox(orgsBudget);
  /**
   * Whether expanding Orgs would show anything — read straight off the budget,
   * because the budget already knows: `hidden` is the orgs the rail could not
   * seat, and the "+N more" beside this button is the same number. So unlike
   * Recent, which had to derive a week's worth of tasks it was not showing in
   * order to find out, Orgs can just be asked.
   *
   * Zero on a rail tall enough for every org, which is the common case on a
   * desktop — and zero narrow, where the pane is unbudgeted and draws all of
   * them anyway, so the button is disabled down there rather than folding two
   * panes for a list that is already complete.
   */
  const orgsExpandable = (orgsBudget?.hidden ?? 0) > 0;

  // Wide: one sticky column of context (Companies, Recent, Portfolio, Routines)
  // beside the queue, which owns the main column because it is where the work
  // is. The left column's wrapper is `display: contents` when narrow, so its
  // panels join the page grid and `order` can slot the queue in after
  // Companies instead of after everything — and, since PLI-262, wherever else
  // the reader has dragged it: the five `order-N` classes below come from
  // `paneOrderClass` rather than being written in. The `@[64rem]/board:order-none`
  // on each of them is what makes that narrow-only, so the wide column cannot
  // be reordered even by a stored order that names the panes backwards.
  // Widths are measured on the board,
  // not the window — the host sidebar decides how much of the window Tickler
  // gets. 64rem is a 400px column plus a queue wide enough for its inline
  // decide-by picks.
  //
  // Every panel below carries `min-w-0`, and that is load-bearing when narrow:
  // `display: contents` makes them grid items, a grid item's automatic minimum
  // size is its min-content size, and an `auto` track will not shrink below it.
  // So one pane with a wide min-content — Recent's rows, whose titles truncate
  // only once they are given a width to truncate to — widens the single column
  // past the viewport and clips every pane in it on the right. `min-w-0` drops
  // that floor, the column is the viewport again, and the rows truncate.
  return (
    <div data-view="board" className="@container/board flex flex-col gap-4">
      <div className="grid gap-4 @[64rem]/board:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] @[96rem]/board:grid-cols-[440px_minmax(0,1fr)] [.tickler-kiosk_&]:gap-6 [.tickler-kiosk_&]:@[110rem]/board:grid-cols-[540px_minmax(0,1fr)]">
        {/* A column that knows its own height can spend it: `useRailBudget`
            gives this box the height of the band it is pinned inside — the
            host's scrolling `<main>` (see `lib/scrollport`), which is shorter
            than the window and offset down it, so `100vh` overshot it by the
            height of the host's chrome and hung the rail's last panel below the
            edge where nothing could scroll to it (PLI-243) — and hands every
            pane below a height of header plus a whole number of rows (see
            `distributeRailHeight`). `--tickler-rail-max-h` is only the
            viewport-based cap that holds until that first measurement, or for a
            host without ResizeObserver, and `overflow-y-auto` is the floor
            under it all, for a window too short to seat even the demoted
            headers. Scroll chaining is left on: at the end of the rail the
            wheel should carry on down the page, not stop dead. */}
        <div
          ref={railRef}
          className="contents @[64rem]/board:sticky @[64rem]/board:top-4 @[64rem]/board:flex @[64rem]/board:max-h-[var(--tickler-rail-max-h)] @[64rem]/board:min-w-0 @[64rem]/board:flex-col @[64rem]/board:gap-4 @[64rem]/board:self-start @[64rem]/board:overflow-y-auto"
        >
          <section
            data-tickler-companies
            data-rail-pane="orgs"
            aria-label="Orgs"
            style={orgsBox.style}
            className={cn(
              paneOrderClass(paneOrder, "orgs"),
              "@container/orgs flex min-h-0 min-w-0 shrink-0 flex-col rounded-lg border bg-card @[64rem]/board:order-none",
              orgsBox.className,
            )}
          >
            <div data-rail-head className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
              <h2 className={cn(MICRO, "font-semibold uppercase tracking-(--tracking-label) text-muted-foreground")}>
                Orgs
              </h2>
              <TicklerSegmented
                label="Org order"
                options={[
                  { value: "hot", label: "Hot first" },
                  { value: "manual", label: "My order" },
                ]}
                value={sortMode}
                onChange={onSortMode}
              />
              {usage.all && (
                <TicklerSegmented
                  label="Token window"
                  options={TICKLER_USAGE_WINDOWS.map((hours) => ({ value: String(hours) as "8" | "24", label: `${hours}h` }))}
                  value={String(usageWindow) as "8" | "24"}
                  onChange={(value) => changeUsageWindow(normalizeUsageWindow(value))}
                  optionProps={(value) => ({ "data-usage-window": value })}
                />
              )}
              {/* Demoted, the header is the whole pane, so it carries the count
                  the lines underneath would have carried. */}
              <span className={cn(MICRO, "ml-auto text-muted-foreground")}>
                {orgsBudget?.demoted ? (
                  <>
                    <span className="font-semibold text-foreground">{totals.needs}</span> need you · {companies.length}{" "}
                    orgs
                  </>
                ) : (
                  <>
                    {usage.all && <span className="hidden @[26rem]/orgs:inline">tokens · </span>}
                    need you
                  </>
                )}
              </span>
              <TicklerRailMore budget={orgsBudget} />
              <TicklerRailExpand
                pane="orgs"
                label="Orgs"
                expanded={orgsExpanded}
                expandable={orgsExpandable}
                title={
                  orgsExpanded
                    ? "Collapse Orgs — Portfolio and Routines get their rows back"
                    : orgsExpandable
                      ? // Not "every org": on a short rail the fold buys rows
                        // rather than the whole list, and the "+N more" beside
                        // this is what says whether any are still held back.
                        "Expand Orgs — as many orgs as the rail can hold, with Portfolio and Routines folded to their headers to make room"
                      : "Nothing to expand — every org you watch is already listed"
                }
                onExpanded={(next) => onExpandedPane(next ? "orgs" : null)}
              />
            </div>
            {!orgsBudget?.demoted && (
              <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {companies.map((company) => (
                  <TicklerCompanySlot
                    key={company.id}
                    company={company}
                    onActionable={onActionable}
                    onStats={onStats}
                    onData={onData}
                    tokenThresholds={thresholdsFor(tokenSettings, company.id)}
                    alertsEnabled={alertsEnabled}
                    pinned={pinnedIds.includes(company.id)}
                    onTogglePin={() => onTogglePin(company.id)}
                    onFocusNeeds={() => toggleFocus(company.id)}
                    needsFocused={focusCompanyId === company.id}
                    usage={usage.byCompany[company.id]}
                    usageScale={usage.scale}
                  />
                ))}
              </ul>
            )}
            {companies.length > 1 && !orgsBudget?.demoted && (
              <div
                data-board-totals
                data-rail-foot
                className={cn(
                  MICRO,
                  "flex shrink-0 items-center gap-2.5 border-t px-3 py-1.5 tabular-nums text-muted-foreground",
                )}
              >
                <span className="uppercase tracking-(--tracking-label)">All</span>
                {usage.all ? (
                  // Same columns as the lines above, so the strip and the total
                  // sit under theirs. The month's figure, cache reads and all,
                  // is the total's hover.
                  <>
                    <span className="normal-case">· last {usageWindow}h</span>
                    <span className="ml-auto" />
                    <TicklerUsageStrip
                      series={usage.all}
                      // Its own scale: the sum of every org is taller than any
                      // one of them, and would otherwise run off the top.
                      scale={Math.max(...usage.all.hours.map((hour) => hour.fresh))}
                      className="w-20 @[24rem]/orgs:w-[120px]"
                    />
                    <span
                      data-usage-total
                      className="w-10 text-right"
                      title={`${usageSeriesTitle(usage.all, usageWindow)}\n${formatTokensMillions(totals.tokens)}M tokens this month, cache reads included`}
                    >
                      {formatTokensCompact(usage.all.fresh)}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="ml-auto">{formatTokensMillions(totals.tokens)}M tokens</span>
                    <span className="w-12 text-right">{Math.round((totals.runs / 7) * 10) / 10}/d</span>
                  </>
                )}
                <span className="w-8 text-right font-semibold text-foreground">{totals.needs}</span>
              </div>
            )}
          </section>
          {/* Directly under Orgs, above Portfolio: it is the only pane on the
              page that changes while you watch it, and it answers "what is the
              fleet on" — the question the Orgs lines above it raise. The budget
              fixes its height, so a run starting cannot shove Portfolio.
              Narrow there is no budget — see `narrow` on `useRailBudget` — and
              this is the one pane long enough to matter, so it is told. */}
          <TicklerRecentTasks
            tasks={recentExpanded ? recentDeep : recent}
            nowMs={nowMs}
            budget={budget.recent}
            narrow={narrow}
            expanded={recentExpanded}
            expandable={recentExpandable}
            onExpanded={(next) => onExpandedPane(next ? "recent" : null)}
            className={cn(paneOrderClass(paneOrder, "recent"), "min-w-0 @[64rem]/board:order-none")}
          />
          <TicklerPortfolio
            items={projectEntries}
            nowMs={nowMs}
            companies={companies}
            sort={portfolioSort}
            onSort={onPortfolioSort}
            // No `min-h` floor here any more: the budget is what keeps Portfolio
            // from being squeezed to nothing by a tall stack of orgs — it is
            // given a height of its own, or demoted to its header, rather than
            // left to fight the panes above it for the leftovers.
            // Folded when either of the two panes above it is expanded. Wide the
            // spec has already said so and this changes nothing; narrow there is
            // no budget to say it in, and the fold is the reader's choice at
            // either width.
            budget={expandedPane ? collapsedPane(budget.portfolio) : budget.portfolio}
            className={cn(paneOrderClass(paneOrder, "portfolio"), "min-h-0 min-w-0 flex-1 @[64rem]/board:order-none")}
          />
          <TicklerRoutineExceptions
            items={routines}
            pinned={pinnedRoutines}
            onUnpin={togglePinnedRoutine}
            picker={
              <TicklerPinRoutinePicker entries={routineEntries} pinned={pinnedRoutineSet} onToggle={togglePinnedRoutine} />
            }
            nowMs={nowMs}
            budget={expandedPane ? collapsedPane(budget.routines) : budget.routines}
            className={cn(paneOrderClass(paneOrder, "routines"), "min-w-0 @[64rem]/board:order-none")}
          />
        </div>

        <div className={cn(paneOrderClass(paneOrder, "queue"), "min-w-0 @[64rem]/board:order-none")}>
          <TicklerQueue
            groups={groups}
            summary={summary}
            grouping={grouping}
            onGrouping={onGrouping}
            sort={queueSort}
            onSort={onQueueSort}
            ageFilter={ageFilter}
            onAgeFilter={onAgeFilter}
            ageCounts={ageCounts}
            companiesById={companiesById}
            nowMs={nowMs}
            onActed={(companyId) => dataByCompany[companyId]?.invalidate()}
            decideSummary={decideSummary}
            onTriage={triage}
            triageBusy={triageBusy}
            footer={footer}
            filterCompany={focusCompany}
            onClearFilter={() => setFocusCompanyId(null)}
          />
        </div>
      </div>
    </div>
  );
}
