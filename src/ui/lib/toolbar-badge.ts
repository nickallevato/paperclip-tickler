import type { AttentionFeed } from "@paperclipai/shared";
import { decideLane, isDecideOverdue } from "./queue";

/**
 * What the toolbar button says before you open Tickler (PLI-367): how many
 * items sit in the queue's Today lane across the orgs you have not hidden.
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
 * The Today lane, counted straight off the attention feeds.
 *
 * Every row the lane can hold is a triage row — an approval or an attention
 * item — and both carry their decide-by and snooze on the feed (an approval's
 * on its attention twin), so the feed alone gives the lane's count without the
 * approvals, agents and routines the queue is otherwise built from. The rules
 * are `decideLane` and `isDecideOverdue` themselves, so the two cannot drift.
 *
 * Not applied: the page's pruning of questions on closed issues and of
 * dismissed questions, which needs each org's issue list and thread lookups.
 * Such a row rarely carries a decide-by, and when it does the badge counts one
 * the lane has dropped — the safe direction for a reminder to err in.
 */
export function countToolbarToday(feeds: ReadonlyArray<AttentionFeed>, nowMs: number): TicklerTodayCount {
  const count: TicklerTodayCount = { today: 0, overdue: 0 };
  for (const feed of feeds) {
    for (const item of feed.items) {
      // The queue keeps an approval whatever its twin says; it skips any other dismissed item.
      if (item.dismissal && item.sourceKind !== "approval") continue;
      const row = {
        triage: { sourceKind: item.sourceKind, sourceId: item.subject.id },
        decideBy: item.decideBy ?? null,
        snoozedUntil: item.snoozedUntil ?? null,
      };
      if (decideLane(row, nowMs) !== "today") continue;
      count.today += 1;
      if (isDecideOverdue(row, nowMs)) count.overdue += 1;
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
  return `Tickler — ${count.today} to decide today${overdue}`;
}
