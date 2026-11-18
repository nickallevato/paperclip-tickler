import { useMemo, useSyncExternalStore } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { attentionApi } from "../host/api";
import { companiesListQueryOptions } from "../host/companies-query";
import { queryKeys } from "../host/util";
import { isDemoActive } from "../demo/demo-runtime";
import {
  TICKLER_FREEZE,
  TICKLER_HIDDEN_STORAGE_KEY,
  normalizeHiddenIds,
  partitionTicklerCompanies,
} from "../lib/tickler";
import {
  TICKLER_TOOLBAR_BADGE_EVENT,
  TICKLER_TOOLBAR_BADGE_STORAGE_KEY,
  countToolbarToday,
  normalizeToolbarBadgeSetting,
  type TicklerTodayCount,
  type TicklerToolbarBadgeSetting,
} from "../lib/toolbar-badge";

function readStored(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(TICKLER_TOOLBAR_BADGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(TICKLER_TOOLBAR_BADGE_EVENT, onChange);
  };
}

/** A stored preference, re-read whenever the page (or another tab) changes one. */
function useStored(key: string): string | null {
  return useSyncExternalStore(subscribe, () => readStored(key), () => null);
}

/**
 * Once a minute, and not at all in a hidden tab: the badge is a reminder, and
 * a decide-by date moves on a scale of days.
 */
const BADGE_POLL = { refetchInterval: TICKLER_FREEZE ? false : 60_000, staleTime: 59_000 } as const;

export interface TicklerToolbarBadge {
  setting: TicklerToolbarBadgeSetting;
  /** Null while any visible org's feed is loading or failed — no badge beats a low one. */
  count: TicklerTodayCount | null;
}

/**
 * The toolbar button's Today count (PLI-367): one attention-feed request per
 * org the board would show. Off means nothing is fetched at all, not that the
 * result is hidden.
 *
 * The button lives in the host's toolbar, outside the page's query cache, so
 * it keeps its own; on the Tickler page both poll, the badge once a minute.
 */
export function useTicklerToolbarBadge(): TicklerToolbarBadge {
  const setting = normalizeToolbarBadgeSetting(useStored(TICKLER_TOOLBAR_BADGE_STORAGE_KEY));
  const hiddenRaw = useStored(TICKLER_HIDDEN_STORAGE_KEY);
  const enabled = setting === "today";

  const companiesQuery = useQuery({ ...companiesListQueryOptions, enabled, staleTime: 5 * 60_000 });
  const companies = useMemo(
    () => partitionTicklerCompanies(companiesQuery.data?.companies ?? [], normalizeHiddenIds(hiddenRaw)).shown,
    [companiesQuery.data, hiddenRaw],
  );

  const feeds = useQueries({
    queries: companies.map((company) => ({
      queryKey: queryKeys.tickler.attention(company.id),
      // Demo mode is armed module-wide by the page and outlives it; its
      // fixture must not turn into a count on the real instance's pages.
      queryFn: () => (isDemoActive() ? null : attentionApi.list(company.id)),
      enabled,
      ...BADGE_POLL,
    })),
  });

  const nowMs = Date.now();
  let count: TicklerTodayCount | null = null;
  if (enabled && companiesQuery.isSuccess && feeds.every((feed) => feed.isSuccess && feed.data)) {
    count = countToolbarToday(
      feeds.map((feed) => feed.data!),
      nowMs,
    );
  }
  return { setting, count };
}
