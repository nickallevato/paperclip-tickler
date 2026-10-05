import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Maximize, Minimize, Settings, TriangleAlert } from "lucide-react";
import { authApi } from "./host/api";
import { companiesListQueryOptions } from "./host/companies-query";
import { useBreadcrumbs } from "./host/shims";
import { useCompanyOrder } from "./host/useCompanyOrder";
import { countCapacity, deriveCapacity } from "./lib/capacity";
import { releaseStrandedPointerEvents } from "./lib/drafts";
import {
  normalizePaneOrder,
  TICKLER_PANE_ORDER_STORAGE_KEY,
  type TicklerPaneKey,
} from "./lib/pane-order";
import { TicklerBoardPage } from "./components/TicklerBoardPage";
import { TicklerBriefing } from "./components/TicklerBriefing";
import { TicklerHelp } from "./components/TicklerHelp";
import { TicklerMark } from "./components/TicklerMark";
import { TicklerPaneOrder } from "./components/TicklerPaneOrder";
import { TicklerReloadBadge } from "./components/TicklerReloadBadge";
import { TicklerSelfUpdatePanel, TicklerUpdateChip } from "./components/TicklerSelfUpdate";
import { TicklerTokenSettingsPanel } from "./components/TicklerTokenSettings";
import type { TicklerCompanyData } from "./components/useTicklerCompanyData";
import {
  TICKLER_PORTFOLIO_SORT_STORAGE_KEY,
  TICKLER_QUEUE_AGE_FILTER_STORAGE_KEY,
  TICKLER_QUEUE_GROUPING_STORAGE_KEY,
  TICKLER_QUEUE_SORT_STORAGE_KEY,
  TICKLER_RECENT_EXPANDED_STORAGE_KEY,
  normalizePortfolioSort,
  normalizeRecentExpanded,
  normalizeQueueAgeFilter,
  normalizeQueueGrouping,
  normalizeQueueSort,
  type TicklerPortfolioSort,
  type TicklerQueueAgeFilter,
  type TicklerQueueGrouping,
  type TicklerQueueSort,
} from "./lib/queue";
import { cn, queryKeys } from "./host/util";
import {
  TICKLER_ALERTS_STORAGE_KEY,
  TICKLER_LAST_VISIT_STORAGE_KEY,
  TICKLER_PINNED_STORAGE_KEY,
  TICKLER_SORT_STORAGE_KEY,
  TICKLER_TOKEN_THRESHOLDS_STORAGE_KEY,
  normalizeAlertsEnabled,
  normalizePinnedIds,
  normalizeSortMode,
  normalizeTokenSettings,
  TICKLER_FREEZE,
  deriveHeat,
  thresholdsFor,
  tokenState,
  shouldShowBriefing,
  type TicklerActionable,
  type TicklerCompanyStats,
  type TicklerSortMode,
} from "./lib/tickler";

/** Preferences the retired classic views persisted; cleared once so they don't linger. */
const LEGACY_STORAGE_KEYS = [
  "tickler.layout",
  "tickler.view",
  "tickler.rows",
  "tickler.bar",
  "tickler.collapsed",
  // The projects rail's own grouping/sort, retired with it when the rail
  // became the Portfolio chart — a chart ordered worst-first has nothing left
  // for those controls to choose between.
  "tickler.projectGrouping",
  "tickler.projectSort",
];

/** Read a persisted preference, tolerating no storage at all (SSR, private mode). */
function readStored(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a persisted preference; a failure just means it lasts the session. */
function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode) — the choice still applies for this session
  }
}

/**
 * Tickler: the Queue + Board page. One header (totals, settings, alerts,
 * kiosk), then the board — the "Needs you" rail, the company ledger and the
 * cross-company lists — with the "since you last looked" briefing as the
 * rail's footer.
 */
export interface TicklerHudProps {
  /**
   * True when the page is being served from the demo fixture rather than this
   * instance. Only drives the badge — the substitution itself happens in
   * `host/api`, so the HUD is otherwise unaware of it.
   */
  demo?: boolean;
}

export function TicklerHud({ demo = false }: TicklerHudProps = {}) {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Tickler" }]);
  }, [setBreadcrumbs]);
  useEffect(() => {
    try {
      for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    } catch {
      // storage unavailable — nothing to clean
    }
  }, []);

  // Watched companies sort to the top of the board. Persisted per browser.
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => normalizePinnedIds(readStored(TICKLER_PINNED_STORAGE_KEY)));
  const togglePinned = (companyId: string) => {
    const next = pinnedIds.includes(companyId) ? pinnedIds.filter((id) => id !== companyId) : [...pinnedIds, companyId];
    setPinnedIds(next);
    writeStored(TICKLER_PINNED_STORAGE_KEY, JSON.stringify(next));
  };

  // Each company's slot owns the one data poll and reports up: a compact
  // stats summary, an "actionable" summary, and the whole data bundle the
  // board derives the rail and lists from.
  const [statsByCompany, setStatsByCompany] = useState<Record<string, TicklerCompanyStats | undefined>>({});
  const handleStats = useCallback((companyId: string, stats: TicklerCompanyStats) => {
    setStatsByCompany((current) => ({ ...current, [companyId]: stats }));
  }, []);
  const [dataByCompany, setDataByCompany] = useState<Record<string, TicklerCompanyData | undefined>>({});
  const handleData = useCallback((companyId: string, data: TicklerCompanyData) => {
    setDataByCompany((current) => (current[companyId] === data ? current : { ...current, [companyId]: data }));
  }, []);
  const [actionableByCompany, setActionableByCompany] = useState<Record<string, TicklerActionable>>({});
  const handleActionable = useCallback((companyId: string, actionable: TicklerActionable) => {
    setActionableByCompany((prev) => {
      const existing = prev[companyId];
      if (existing && existing.criticalOrHigh === actionable.criticalOrHigh && existing.count === actionable.count) {
        return prev;
      }
      return { ...prev, [companyId]: actionable };
    });
  }, []);

  const [queueGrouping, setQueueGrouping] = useState<TicklerQueueGrouping>(() =>
    normalizeQueueGrouping(readStored(TICKLER_QUEUE_GROUPING_STORAGE_KEY)),
  );
  const selectQueueGrouping = (grouping: TicklerQueueGrouping) => {
    setQueueGrouping(grouping);
    writeStored(TICKLER_QUEUE_GROUPING_STORAGE_KEY, grouping);
  };

  const [queueSort, setQueueSort] = useState<TicklerQueueSort>(() =>
    normalizeQueueSort(readStored(TICKLER_QUEUE_SORT_STORAGE_KEY)),
  );
  const selectQueueSort = (sort: TicklerQueueSort) => {
    setQueueSort(sort);
    writeStored(TICKLER_QUEUE_SORT_STORAGE_KEY, sort);
  };

  // Persisted, unlike the company focus: which slice of the backlog you work
  // is a habit, not a glance, and re-picking "Today" on every visit is exactly
  // the friction the chips exist to remove.
  const [ageFilter, setAgeFilter] = useState<TicklerQueueAgeFilter>(() =>
    normalizeQueueAgeFilter(readStored(TICKLER_QUEUE_AGE_FILTER_STORAGE_KEY)),
  );
  const selectAgeFilter = (filter: TicklerQueueAgeFilter) => {
    setAgeFilter(filter);
    writeStored(TICKLER_QUEUE_AGE_FILTER_STORAGE_KEY, filter);
  };

  const [portfolioSort, setPortfolioSort] = useState<TicklerPortfolioSort>(() =>
    normalizePortfolioSort(readStored(TICKLER_PORTFOLIO_SORT_STORAGE_KEY)),
  );
  const selectPortfolioSort = (sort: TicklerPortfolioSort) => {
    setPortfolioSort(sort);
    writeStored(TICKLER_PORTFOLIO_SORT_STORAGE_KEY, sort);
  };

  // Recent, doubled, with Portfolio and Routines folded to their headers to pay
  // for it. Persisted for the same reason the age chips are: which pane of the
  // rail you actually read is a habit, and re-expanding it on every visit is the
  // friction the button exists to remove.
  const [recentExpanded, setRecentExpanded] = useState<boolean>(() =>
    normalizeRecentExpanded(readStored(TICKLER_RECENT_EXPANDED_STORAGE_KEY)),
  );
  const selectRecentExpanded = (expanded: boolean) => {
    setRecentExpanded(expanded);
    writeStored(TICKLER_RECENT_EXPANDED_STORAGE_KEY, expanded ? "on" : "off");
  };

  // The narrow board's stack order. Per-browser and only that: a plugin has no
  // key/value store on the host to put it in — see `lib/pane-order`.
  const [paneOrder, setPaneOrder] = useState<TicklerPaneKey[]>(() =>
    normalizePaneOrder(readStored(TICKLER_PANE_ORDER_STORAGE_KEY)),
  );
  const selectPaneOrder = (order: TicklerPaneKey[]) => {
    setPaneOrder(order);
    writeStored(TICKLER_PANE_ORDER_STORAGE_KEY, JSON.stringify(order));
  };
  // Only the board can say whether it is one column — it is the rail going
  // `display: contents` — but the button belongs up here with the other controls
  // over how the page is laid out. Stable identity: the board reports through an
  // effect, and a fresh callback each render would re-run it every render.
  const [boardNarrow, setBoardNarrow] = useState(false);
  const reportBoardNarrow = useCallback((narrow: boolean) => setBoardNarrow(narrow), []);

  const [tokenSettings, setTokenSettings] = useState(() => normalizeTokenSettings(readStored(TICKLER_TOKEN_THRESHOLDS_STORAGE_KEY)));
  const [tokenSettingsOpen, setTokenSettingsOpen] = useState(false);
  const persistTokenSettings = (next: typeof tokenSettings) => {
    setTokenSettings(next);
    writeStored(TICKLER_TOKEN_THRESHOLDS_STORAGE_KEY, JSON.stringify(next));
  };

  const [sortMode, setSortMode] = useState<TicklerSortMode>(() => normalizeSortMode(readStored(TICKLER_SORT_STORAGE_KEY)));
  const selectSortMode = (mode: TicklerSortMode) => {
    setSortMode(mode);
    writeStored(TICKLER_SORT_STORAGE_KEY, mode);
  };

  // Kiosk mode: fullscreens the HUD root and bumps the type scale. Not
  // persisted — always starts off; `fullscreenchange` is the source of truth
  // since fullscreen can also be exited via Esc or browser chrome.
  const rootRef = useRef<HTMLDivElement>(null);
  // Last line of defence: whatever happened inside the HUD, navigating away
  // from it must not leave the host's own chrome unable to take a click.
  useEffect(() => () => void releaseStrandedPointerEvents(), []);
  const [isKiosk, setIsKiosk] = useState(false);
  useEffect(() => {
    const onFullscreenChange = () => {
      setIsKiosk(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);
  const toggleKiosk = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void rootRef.current?.requestFullscreen();
    }
  };
  // Tickler's type scale: every size is written as
  // text-[length:var(--tickler-fs-*,<default>)]. Desk tracks the host app
  // (micro = --text-micro, body = text-sm, stat = text-base); kiosk is ~1.3x
  // for a TV across the room. Set on the document root so portaled dialogs
  // inherit too; nothing outside Tickler reads these vars.
  useEffect(() => {
    const style = document.documentElement.style;
    const scale = isKiosk
      ? { micro: "14px", body: "18px", stat: "21px", title: "26px" }
      : { micro: "11px", body: "14px", stat: "16px", title: "20px" };
    for (const [role, size] of Object.entries(scale)) {
      style.setProperty(`--tickler-fs-${role}`, size);
    }
    return () => {
      for (const role of Object.keys(scale)) {
        style.removeProperty(`--tickler-fs-${role}`);
      }
    };
  }, [isKiosk]);

  // Alerts: off by default, persisted; enabling asks for Notification
  // permission only while it is still undecided.
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(() => normalizeAlertsEnabled(readStored(TICKLER_ALERTS_STORAGE_KEY)));
  const toggleAlerts = () => {
    const next = !alertsEnabled;
    setAlertsEnabled(next);
    writeStored(TICKLER_ALERTS_STORAGE_KEY, next ? "on" : "off");
    if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  };

  // Briefing: read the previous visit timestamp on mount (before overwriting
  // it); the strip shows until dismissed for this visit. `tickler.lastVisit` is
  // refreshed on mount and every 5 minutes so a long-lived tab doesn't keep
  // reporting a stale "since" time to itself.
  const [lastVisit] = useState<string | null>(() => readStored(TICKLER_LAST_VISIT_STORAGE_KEY));
  const [briefingDismissed, setBriefingDismissed] = useState(false);
  const showBriefing = !briefingDismissed && lastVisit !== null && shouldShowBriefing(lastVisit, Date.now());
  useEffect(() => {
    const recordVisit = () => writeStored(TICKLER_LAST_VISIT_STORAGE_KEY, new Date().toISOString());
    recordVisit();
    const interval = TICKLER_FREEZE ? null : setInterval(recordVisit, 5 * 60_000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  // The ["companies"] cache entry is shared app-wide and holds a
  // CompanyListResult, not a bare array — reusing its canonical query options
  // keeps the shape intact.
  const companiesQuery = useQuery(companiesListQueryOptions);
  const activeCompanies = (companiesQuery.data?.companies ?? []).filter((company) => company.status !== "archived");
  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  // Base order = the user's sidebar company-switcher drag order.
  const { orderedCompanies } = useCompanyOrder({
    companies: activeCompanies,
    userId: session?.user?.id ?? session?.session?.userId ?? null,
  });
  // Heat is computed and never drawn: Need-you and Decisions already say
  // whether a company wants you, so a heat mark beside them would restate it.
  // Its job is the row order — the one thing those columns cannot do, because
  // it folds in what none of them show (a silent run, an errored agent, an
  // unreachable company).
  const heatByCompany = useMemo(() => {
    const now = Date.now();
    const heat: Record<string, number> = {};
    for (const company of orderedCompanies) {
      const stats = statsByCompany[company.id];
      const data = dataByCompany[company.id];
      const actionable = actionableByCompany[company.id];
      const tokens = stats?.tokens;
      heat[company.id] = deriveHeat({
        unavailable: data?.unavailable ?? false,
        criticalOrHigh: actionable?.criticalOrHigh ?? false,
        needs: actionable?.count ?? 0,
        oldestMins: stats?.oldestMins ?? null,
        tasksBlocked: stats?.tasksBlocked ?? 0,
        stalled: countCapacity(deriveCapacity(data?.agents ?? [], data?.liveRuns ?? [], now)).stalled,
        agentErrors: data?.summary?.agents.error ?? 0,
        decisionsOpen: data?.needsBreakdown?.decisions ?? 0,
        tokenState: tokens === undefined ? "ok" : tokenState(tokens, thresholdsFor(tokenSettings, company.id)),
      });
    }
    return heat;
  }, [orderedCompanies, statsByCompany, dataByCompany, actionableByCompany, tokenSettings]);
  const companies = useMemo(
    () =>
      sortMode === "hot"
        // Stable: equal-heat companies keep the user's own order, so the board
        // only reshuffles when a company's situation actually changes.
        ? [...orderedCompanies].sort((a, b) => (heatByCompany[b.id] ?? 0) - (heatByCompany[a.id] ?? 0))
        : orderedCompanies,
    [sortMode, orderedCompanies, heatByCompany],
  );
  // Watched first, then the chosen order.
  const boardCompanies = useMemo(
    () => [...companies.filter((company) => pinnedIds.includes(company.id)), ...companies.filter((company) => !pinnedIds.includes(company.id))],
    [companies, pinnedIds],
  );

  // The board's own columns and totals row carry these numbers now, so the
  // header no longer runs its own per-company summary fan-out. `anyStale` is
  // kept from the slots' own reports rather than a second set of queries.
  const anyStale = Object.values(dataByCompany).some((data) => data?.staleSince != null);
  // The rail's own total, so the number up top is the number you find below it.

  return (
    <div ref={rootRef} className={cn("space-y-4", isKiosk && "tickler-kiosk bg-background p-4")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <TicklerMark className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-[length:var(--tickler-fs-title,20px)] leading-[1.3] font-semibold tracking-tight">Tickler</h1>
          <span className="text-[length:var(--tickler-fs-body,14px)] leading-[1.45] text-muted-foreground">all orgs</span>
          {demo && (
            /* Deliberately hard to miss. A screenshot of this page is meant to
               be shareable, which only works if nobody can mistake the fixture
               for a real instance. */
            <span
              className="rounded-full border border-tickler-wait/40 bg-tickler-wait/10 px-2 py-0.5 text-[length:var(--tickler-fs-micro,11px)] leading-[1.45] font-semibold uppercase tracking-(--tracking-label) text-tickler-wait"
              title="Tickler is showing bundled demo data, not this instance. Add ?demo=0 to the URL to leave demo mode."
            >
              Demo data
            </span>
          )}
          {/* Beside "Demo data" rather than above the header: this is about the
              build, not the data, but it shares that badge's job of qualifying
              what you are looking at. Silent unless Tickler's stylesheet is
              provably stale. */}
          {/* Same family: the build on disk is newer than Paperclip's
              registration of it. Silent otherwise. */}
          <TicklerReloadBadge />
          {/* And the published half of that question: a newer Tickler is on
              npm. Mutually exclusive with the badge above — that one only
              fires for a local-path install, this one only for an npm one. */}
          <TicklerUpdateChip />
        </div>
        <div className="ml-auto flex items-center gap-3 text-[length:var(--tickler-fs-body,14px)] leading-[1.45] text-muted-foreground">
          {anyStale && (
            <span className="inline-flex items-center gap-1 text-tickler-wait">
              <TriangleAlert className="h-3.5 w-3.5" /> polling degraded
            </span>
          )}
          {/* First in the group, and only when the board is a single column:
              it is the control that acts on that layout. */}
          {boardNarrow && <TicklerPaneOrder order={paneOrder} onOrder={selectPaneOrder} />}
          <button
            type="button"
            aria-pressed={tokenSettingsOpen}
            aria-label="Token thresholds"
            title="Token thresholds"
            onClick={() => setTokenSettingsOpen((open) => !open)}
            className={cn("rounded-md border p-1", tokenSettingsOpen ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-pressed={alertsEnabled}
            aria-label={alertsEnabled ? "Disable alerts" : "Enable alerts"}
            onClick={toggleAlerts}
            className={cn("rounded-md border p-1", alertsEnabled ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {alertsEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label={isKiosk ? "Exit kiosk mode" : "Enter kiosk mode"}
            onClick={toggleKiosk}
            className="rounded-md border p-1 text-muted-foreground hover:text-foreground"
          >
            {isKiosk ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
          </button>
          {/* Last, and deliberately: the three before it are things you came to
              the header to do, and this is the one you only look for once
              something else has gone wrong. */}
          <TicklerHelp />
        </div>
      </div>

      {tokenSettingsOpen && (
        <div className="space-y-3">
          {/* The version row comes first and renders whether or not there are
              companies to threshold: "which Tickler am I on" is the question
              somebody opens this panel with when nothing else is wrong. */}
          <TicklerSelfUpdatePanel />
          {companies.length > 0 && (
            <TicklerTokenSettingsPanel
              companies={companies}
              statsById={statsByCompany}
              settings={tokenSettings}
              onChange={persistTokenSettings}
              onClose={() => setTokenSettingsOpen(false)}
            />
          )}
        </div>
      )}

      {companiesQuery.isLoading ? (
        <p className="text-[length:var(--tickler-fs-body,14px)] leading-[1.45] text-muted-foreground">Loading orgs…</p>
      ) : companies.length === 0 ? (
        <p className="text-[length:var(--tickler-fs-body,14px)] leading-[1.45] text-muted-foreground">No orgs to show.</p>
      ) : (
        <TicklerBoardPage
          companies={boardCompanies}
          pinnedIds={pinnedIds}
          onTogglePin={togglePinned}
          dataByCompany={dataByCompany}
          statsByCompany={statsByCompany}
          actionableByCompany={actionableByCompany}
          tokenSettings={tokenSettings}
          alertsEnabled={alertsEnabled}
          onActionable={handleActionable}
          onStats={handleStats}
          onData={handleData}
          sortMode={sortMode}
          onSortMode={selectSortMode}
          grouping={queueGrouping}
          onGrouping={selectQueueGrouping}
          queueSort={queueSort}
          onQueueSort={selectQueueSort}
          ageFilter={ageFilter}
          onAgeFilter={selectAgeFilter}
          portfolioSort={portfolioSort}
          onPortfolioSort={selectPortfolioSort}
          recentExpanded={recentExpanded}
          onRecentExpanded={selectRecentExpanded}
          paneOrder={paneOrder}
          onNarrow={reportBoardNarrow}
          footer={
            showBriefing && lastVisit ? (
              <TicklerBriefing companies={companies} since={lastVisit} onDismiss={() => setBriefingDismissed(true)} />
            ) : undefined
          }
        />
      )}
    </div>
  );
}
