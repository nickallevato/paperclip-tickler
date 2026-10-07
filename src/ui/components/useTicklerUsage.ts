import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { Company } from "@paperclipai/shared";
import { heartbeatsApi } from "../host/api";
import { queryKeys } from "../host/util";
import { TICKLER_FREEZE } from "../lib/tickler";
import {
  bucketUsage,
  runUsages,
  sumUsageSeries,
  TICKLER_USAGE_HOURS,
  usageScale,
  type TicklerRunUsage,
  type TicklerUsageSeries,
  type TicklerUsageWindow,
} from "../lib/usage";

/**
 * Runs asked for first. A busy org runs ~150 in a day, so this reaches back a
 * full day for nearly everyone in one request.
 */
const FIRST_LIMIT = 200;
/** The server's cap, asked for only when the first page did not reach back far enough. */
const DEEP_LIMIT = 1000;

/**
 * One org's last day of usage, reduced to (when, fresh, cached) triples.
 *
 * The runs list has no time filter, only a count, so a page that is full and
 * still inside the window is asked again at the server's cap. Kept reduced in
 * the cache rather than as raw rows — a full run row is ~4KB, most of it
 * context snapshot the chart never reads.
 */
async function fetchUsage(companyId: string): Promise<TicklerRunUsage[]> {
  const sinceMs = Date.now() - TICKLER_USAGE_HOURS * 3_600_000;
  let runs = await heartbeatsApi.runsForCompany(companyId, FIRST_LIMIT);
  const oldest = runs[runs.length - 1];
  if (runs.length >= FIRST_LIMIT && oldest && Date.parse(oldest.createdAt) > sinceMs) {
    runs = await heartbeatsApi.runsForCompany(companyId, DEEP_LIMIT);
  }
  return runUsages(runs).filter((usage) => usage.atMs >= sinceMs - 3_600_000);
}

export interface TicklerOrgUsage {
  /** Per org; absent while loading, or when the viewer cannot read run telemetry. */
  byCompany: Record<string, TicklerUsageSeries | undefined>;
  /** Every org added hour by hour, for the footer. Undefined until any org lands. */
  all: TicklerUsageSeries | undefined;
  /** The busiest single hour of any org — every row is drawn against it. */
  scale: number;
}

/**
 * Token usage for every org on the board, bucketed for the chosen window.
 *
 * Fetched here rather than in each company slot because the rows share one
 * scale: whether Lion Peak's bar is tall is a question about every other org's
 * bars, so something above the rows has to see them all.
 *
 * Polled every five minutes: usage lands when a run finishes, and an hourly
 * bar does not need to be fresher than that.
 */
export function useTicklerUsage(companies: Company[], window: TicklerUsageWindow, nowMs: number): TicklerOrgUsage {
  const queries = useQueries({
    queries: companies.map((company) => ({
      queryKey: queryKeys.tickler.usage(company.id),
      queryFn: () => fetchUsage(company.id),
      refetchInterval: TICKLER_FREEZE ? (false as const) : 5 * 60_000,
      staleTime: 4 * 60_000,
      // Permission-gated, like the month's tokens: a 403 means no chart, not a retry storm.
      retry: false,
    })),
  });
  // `useQueries` hands back a fresh array every render; keyed on when each
  // org's usage last landed so the series keep their identity between polls.
  const stamp = queries.map((query) => query.dataUpdatedAt).join(",");
  return useMemo(() => {
    const byCompany: Record<string, TicklerUsageSeries | undefined> = {};
    const landed: TicklerUsageSeries[] = [];
    companies.forEach((company, index) => {
      const data = queries[index]?.data;
      if (!data) return;
      const series = bucketUsage(data, nowMs, window);
      byCompany[company.id] = series;
      landed.push(series);
    });
    return {
      byCompany,
      all: landed.length > 0 ? sumUsageSeries(landed, nowMs, window) : undefined,
      scale: usageScale(landed),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, window, nowMs, stamp]);
}
