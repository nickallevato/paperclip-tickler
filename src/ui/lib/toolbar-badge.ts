import type { AttentionFeed } from "@paperclipai/shared";
import { epochMs, isDecideOverdue, isSnoozed, queueItemAge } from "./queue";

/**
 * What the toolbar button says before you open Tickler (PLI-367): how many
 * items arrived today across the orgs you have not hidden.
 * Per browser, like pins and hidden orgs; on until you turn it off.
 */
export const TICKLER_TOOLBAR_BADGE_STORAGE_KEY = "tickler.toolbarBadge";

export type TicklerToolbarBadgeSetting = "today" | "off";

export function normalizeToolbarBadgeSetting(value: string | null | undefined): TicklerToolbarBadgeSetting {
  return value === "off" ? "off" : "today";
}

/**
 * Fired on `window` when the page changes something the badge reads (the
 * setting, or which orgs are hidden). A `storage` event only reaches other
 * tabs, and the button sits beside the page in this one.
 */
export const TICKLER_TOOLBAR_BADGE_EVENT = "tickler:toolbar-badge";

export function notifyToolbarBadge(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TICKLER_TOOLBAR_BADGE_EVENT));
}

export interface TicklerTodayCount {
  today: number;
  overdue: number;
}

/**
 * What arrived today, counted straight off the attention feeds: the same
 * calendar-day rule as the queue's Today age chip (`queueItemAge`), so the
 * button and the chip agree. The Today lane was the first rule, and it missed
 * the case that matters — a fresh item has no decide-by, so it sat in
 * Unsorted and never reached the count.
 *
 * Every row counted is a triage row — an approval (through its attention
 * twin) or an attention item. Snoozed rows are away, as on the board; the
 * queue keeps an approval whatever its twin's dismissal says and skips any
 * other dismissed item. `overdue` counts every such row whose decide-by date
 * has passed, whenever it arrived, so red still means something is late.
 *
 * Not counted: agent alerts and routines, which the chip includes but the
 * feed does not carry. Not applied: the page's pruning of questions on
 * closed issues and of dismissed questions, which needs each org's issue list
 * and thread lookups — when it matters the badge counts one more than the
 * chip, the safe direction for a reminder to err in.
 */
export function countToolbarToday(feeds: ReadonlyArray<AttentionFeed>, nowMs: number): TicklerTodayCount {
  const count: TicklerTodayCount = { today: 0, overdue: 0 };
  for (const feed of feeds) {
    for (const item of feed.items) {
      if (item.dismissal && item.sourceKind !== "approval") continue;
      const row = {
        triage: { sourceKind: item.sourceKind, sourceId: item.subject.id },
        decideBy: item.decideBy ?? null,
        snoozedUntil: item.snoozedUntil ?? null,
      };
      if (isSnoozed(row, nowMs)) continue;
      if (isDecideOverdue(row, nowMs)) count.overdue += 1;
      if (queueItemAge({ atMs: epochMs(item.activityAt) }, nowMs) === "today") count.today += 1;
    }
  }
  return count;
}

/** The pill's text: the count, capped so the button never grows past two digits. */
export function toolbarBadgeText(today: number): string {
  return today > 9 ? "9+" : String(today);
}

/** The button's accessible name, which carries the count the pill shows. */
export function toolbarBadgeLabel(count: TicklerTodayCount | null): string {
  if (!count || count.today === 0) return "Tickler — all orgs";
  const overdue = count.overdue > 0 ? ` (${count.overdue} overdue)` : "";
  return `Tickler — ${count.today} new today${overdue}`;
}
