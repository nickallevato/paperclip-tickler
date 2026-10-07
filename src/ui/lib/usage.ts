/**
 * Per-org token usage by the hour (PLI-278).
 *
 * The Orgs footer's month-to-date figure says how much was used, never by whom
 * or when. This answers "which org burned tokens today, if any" — one bar per
 * hour, per org, on one shared scale.
 *
 * Only fresh tokens (input + output) are drawn. Cache reads run about fifteen
 * times larger and would flatten every other bar; they are carried along for
 * the hover title only. Dollars are not used at all: on a subscription every
 * cost event is $0, so tokens are the only figure that moves.
 */

/** The two windows the Orgs header toggles between. */
export type TicklerUsageWindow = 8 | 24;

export const TICKLER_USAGE_WINDOWS: readonly TicklerUsageWindow[] = [8, 24];

/** Per browser, like the pane order and the watched orgs. */
export const TICKLER_USAGE_WINDOW_STORAGE_KEY = "tickler.usageWindow";

/** Always fetched for the longer window; 8h is a slice of the same data. */
export const TICKLER_USAGE_HOURS = 24;

const HOUR_MS = 3_600_000;

export function normalizeUsageWindow(raw: unknown): TicklerUsageWindow {
  return raw === "8" || raw === 8 ? 8 : 24;
}

/** What one finished run used, reduced to the three numbers the chart reads. */
export interface TicklerRunUsage {
  /** Epoch ms the usage is charged to — when the run finished. */
  atMs: number;
  fresh: number;
  cached: number;
}

/** The fields of a heartbeat run this module reads; everything else is ignored. */
export interface TicklerHeartbeatRunLike {
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  usageJson?: Record<string, unknown> | null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Reduce raw runs to what was used and when. A run still going has no usage
 * yet, and is dropped rather than counted as zero at some arbitrary hour.
 */
export function runUsages(runs: readonly TicklerHeartbeatRunLike[]): TicklerRunUsage[] {
  const usages: TicklerRunUsage[] = [];
  for (const run of runs) {
    const usage = run.usageJson;
    if (!usage) continue;
    const atMs = Date.parse(run.finishedAt ?? run.startedAt ?? run.createdAt);
    if (!Number.isFinite(atMs)) continue;
    const fresh = count(usage.inputTokens) + count(usage.outputTokens);
    const cached = count(usage.cachedInputTokens);
    if (fresh === 0 && cached === 0) continue;
    usages.push({ atMs, fresh, cached });
  }
  return usages;
}

export interface TicklerUsageHour {
  /** Start of the hour, epoch ms. */
  startMs: number;
  fresh: number;
  cached: number;
  runs: number;
}

export interface TicklerUsageSeries {
  /** Oldest first; the last bar is the hour in progress. */
  hours: TicklerUsageHour[];
  fresh: number;
  cached: number;
  runs: number;
}

/**
 * Bucket usage into the trailing `window` clock hours, the current one last.
 *
 * Clock hours rather than a sliding 60 minutes back from now, so a bar does not
 * change which run it holds every time the page re-renders — the spike at 2pm
 * stays the 2pm bar until it scrolls off the left.
 */
export function bucketUsage(usages: readonly TicklerRunUsage[], nowMs: number, window: number): TicklerUsageSeries {
  const currentHour = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const firstHour = currentHour - (window - 1) * HOUR_MS;
  const hours: TicklerUsageHour[] = Array.from({ length: window }, (_, index) => ({
    startMs: firstHour + index * HOUR_MS,
    fresh: 0,
    cached: 0,
    runs: 0,
  }));
  const series: TicklerUsageSeries = { hours, fresh: 0, cached: 0, runs: 0 };
  for (const usage of usages) {
    const index = Math.floor((usage.atMs - firstHour) / HOUR_MS);
    if (index < 0 || index >= window) continue;
    const hour = hours[index];
    hour.fresh += usage.fresh;
    hour.cached += usage.cached;
    hour.runs += 1;
    series.fresh += usage.fresh;
    series.cached += usage.cached;
    series.runs += 1;
  }
  return series;
}

/** Add series hour by hour — the footer's "All" strip. Assumes the same window. */
export function sumUsageSeries(series: readonly TicklerUsageSeries[], nowMs: number, window: number): TicklerUsageSeries {
  const total = bucketUsage([], nowMs, window);
  for (const one of series) {
    one.hours.forEach((hour, index) => {
      const into = total.hours[index];
      if (!into) return;
      into.fresh += hour.fresh;
      into.cached += hour.cached;
      into.runs += hour.runs;
    });
    total.fresh += one.fresh;
    total.cached += one.cached;
    total.runs += one.runs;
  }
  return total;
}

/** The busiest hour across every series — the one scale every row is drawn on. */
export function usageScale(series: readonly TicklerUsageSeries[]): number {
  let max = 0;
  for (const one of series) for (const hour of one.hours) max = Math.max(max, hour.fresh);
  return max;
}

/**
 * A token count in four characters or fewer: `0`, `950`, `12k`, `452k`,
 * `1.4M`, `12M`. One decimal only where it is the difference between two
 * orgs that would otherwise read the same.
 */
export function formatTokensCompact(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) {
    const thousands = tokens / 1_000;
    // 999.6k rounds up into the next unit rather than printing "1000k".
    return thousands >= 999.5 ? "1.0M" : thousands < 10 ? `${thousands.toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(thousands)}k`;
  }
  const millions = tokens / 1_000_000;
  return millions < 10 ? `${millions.toFixed(1)}M` : `${Math.round(millions)}M`;
}

/** "14:00", in the reader's own clock. */
function hourLabel(startMs: number): string {
  return new Date(startMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The hover line for one bar. */
export function usageHourTitle(hour: TicklerUsageHour): string {
  if (hour.runs === 0) return `${hourLabel(hour.startMs)} · no tokens`;
  return `${hourLabel(hour.startMs)} · ${formatTokensCompact(hour.fresh)} fresh · ${formatTokensCompact(hour.cached)} cache reads · ${hour.runs} run${hour.runs === 1 ? "" : "s"}`;
}

/** The hover line for a whole row's total. */
export function usageSeriesTitle(series: TicklerUsageSeries, window: number): string {
  if (series.runs === 0) return `No tokens used in the last ${window}h`;
  return `${series.fresh.toLocaleString()} fresh tokens (input + output) in the last ${window}h, over ${series.runs} run${series.runs === 1 ? "" : "s"} · ${series.cached.toLocaleString()} cache reads not counted`;
}
