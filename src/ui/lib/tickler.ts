import type {
  Agent,
  Approval,
  AttentionFeed,
  AttentionItem,
  AttentionSeverity,
  Company,
  CostByAgent,
  DashboardRunActivityDay,
  DashboardSummary,
  Issue,
  Project,
  RoutineListItem,
} from "@paperclipai/shared";

export type TicklerHealth = "red" | "amber" | "green";

const CLOSED_ISSUE_STATUSES = new Set(["done", "cancelled"]);

/**
 * The issue an attention item is about, when it is about one: the subject
 * itself for issue-kind items, otherwise the `issueId` the server tucks into
 * subject metadata (thread interactions, runs). Null when there is none.
 */
export function attentionIssueId(item: AttentionItem): string | null {
  if (item.subject.kind === "issue") return item.subject.id;
  const fromMeta = item.subject.metadata?.issueId;
  return typeof fromMeta === "string" && fromMeta ? fromMeta : null;
}

/**
 * Drops attention items whose issue has already reached a terminal status.
 * The server keeps emitting an `issue_thread_interaction` for as long as the
 * interaction row is `pending`, even after the issue it hangs off was closed,
 * so a "Questions need answers" on a done issue would otherwise sit in the
 * queue forever. Only items whose issue is in `issues` AND closed are pruned;
 * an issue we don't hold (outside the list limit) is left alone rather than
 * guessed at. Returns the same feed reference when nothing changes so
 * downstream memoisation keyed on it stays quiet.
 */
export function pruneClosedIssueAttention(
  feed: AttentionFeed | undefined,
  issues: ReadonlyArray<Pick<Issue, "id" | "status">>,
): AttentionFeed | undefined {
  if (!feed || feed.items.length === 0 || issues.length === 0) return feed;
  const closed = new Set<string>();
  for (const issue of issues) if (CLOSED_ISSUE_STATUSES.has(issue.status)) closed.add(issue.id);
  if (closed.size === 0) return feed;
  const items = feed.items.filter((item) => {
    const issueId = attentionIssueId(item);
    return !issueId || !closed.has(issueId);
  });
  return items.length === feed.items.length ? feed : { ...feed, items };
}

/**
 * What Need-you is actually made of, by attention source.
 *
 * Every field is a slice of the same feed the Need-you count reads, so the
 * columns can never drift from their own total. Counted here rather than from
 * the issues list on purpose: that list is fetched with a `limit`, and a
 * company with more issues than the limit would silently under-report — these
 * are server-derived and complete.
 *
 * These are items the feed says need *you*, which is not the same as every
 * issue in that status: the attention service applies its own audience and
 * resolver-policy rules, so a company's Blocked here can be lower than its
 * raw blocked-issue count. That is the honest figure for a column headed by
 * "what needs me".
 *
 * Approvals are excluded — deriveActionable counts those separately, and
 * including them here would double them.
 */
export interface TicklerNeedsBreakdown {
  /** An agent asked you something and is waiting. */
  questions: number;
  blocked: number;
  review: number;
  decisions: number;
  /** Failed runs, budget and agent-error alerts, join requests, everything else. */
  other: number;
}

export function deriveNeedsBreakdown(attention: AttentionFeed | undefined): TicklerNeedsBreakdown {
  const breakdown: TicklerNeedsBreakdown = { questions: 0, blocked: 0, review: 0, decisions: 0, other: 0 };
  for (const item of attention?.items ?? []) {
    if (item.dismissal) continue;
    switch (item.sourceKind) {
      case "approval":
        break;
      case "issue_thread_interaction":
        breakdown.questions += 1;
        break;
      case "blocker_attention":
        breakdown.blocked += 1;
        break;
      case "review":
        breakdown.review += 1;
        break;
      case "decision":
        breakdown.decisions += 1;
        break;
      default:
        breakdown.other += 1;
    }
  }
  return breakdown;
}

export function derivePaneHealth(
  summary: DashboardSummary | undefined,
  /**
   * Optional, and worth passing wherever it is available. Incidents and agent
   * errors are not the only way a company is in trouble: a critical blocker in
   * the attention feed is exactly the state a HUD exists to surface, and
   * without this a company with three of them reads green.
   */
  attention?: AttentionFeed,
): TicklerHealth {
  const live = (attention?.items ?? []).filter((item) => !item.dismissal);
  if (summary && (summary.budgets.activeIncidents > 0 || summary.agents.error > 0)) return "red";
  if (live.some((item) => item.severity === "critical")) return "red";
  if (!summary) return "green";
  if (summary.pendingApprovals > 0) return "amber";
  if (live.some((item) => item.severity === "high")) return "amber";
  return "green";
}

/**
 * Accessible/plain-language label for a pane's health dot, naming the reason
 * (incidents, agent errors, approvals) rather than just the color.
 */
export function healthLabel(health: TicklerHealth, summary: DashboardSummary | undefined): string {
  if (health === "red") {
    const reasons: string[] = [];
    const incidents = summary?.budgets.activeIncidents ?? 0;
    const errors = summary?.agents.error ?? 0;
    if (incidents > 0) reasons.push(`${incidents} incident${incidents === 1 ? "" : "s"}`);
    if (errors > 0) reasons.push(`${errors} agent error${errors === 1 ? "" : "s"}`);
    return reasons.length > 0 ? `Health: red — ${reasons.join(", ")}` : "Health: red — unreachable";
  }
  if (health === "amber") {
    const approvals = summary?.pendingApprovals ?? 0;
    return `Health: amber — ${approvals} approval${approvals === 1 ? "" : "s"} pending`;
  }
  return "Health: green — all clear";
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return cents % 100 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

export function issueStatusLabel(status: string): string {
  return status
    .split("_")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

/**
 * Kill switch for every poll and clock in the HUD.
 *
 * Left in place as a diagnostic: flipping this to `true` freezes all of
 * Tickler's recurring state updates while leaving the UI fully rendered, which
 * is how the render loop behind PAP-style "URL changes, view doesn't" was
 * isolated. Normal operation is `false`.
 */
export const TICKLER_FREEZE = false;

export function ticklerRefetchInterval(): number | false {
  if (TICKLER_FREEZE) return false;
  return typeof document !== "undefined" && document.visibilityState === "hidden" ? 30_000 : 5_000;
}

export function selectCeo(agents: Agent[]): Agent | undefined {
  return agents.find((agent) => agent.role === "ceo");
}

export type TicklerCeoHeartbeatState = "ok" | "overdue" | "off";

export interface TicklerCeoHeartbeat {
  state: TicklerCeoHeartbeatState;
  lastBeatAt: string | null;
  intervalSec: number | null;
}

// runtimeConfig.heartbeat is untyped on this codebase generation — narrow it defensively.
function readHeartbeatConfig(agent: Agent): { enabled: boolean; intervalSec: number | null } {
  const raw = (agent.runtimeConfig as Record<string, unknown> | null | undefined)?.heartbeat;
  if (!raw || typeof raw !== "object") return { enabled: false, intervalSec: null };
  const config = raw as { enabled?: unknown; intervalSec?: unknown };
  return {
    enabled: config.enabled === true,
    intervalSec: typeof config.intervalSec === "number" && config.intervalSec > 0 ? config.intervalSec : null,
  };
}

export function deriveCeoHeartbeat(agent: Agent | undefined, nowMs: number): TicklerCeoHeartbeat {
  if (!agent) return { state: "off", lastBeatAt: null, intervalSec: null };
  const { enabled, intervalSec } = readHeartbeatConfig(agent);
  const lastBeatAt = agent.lastHeartbeatAt ? new Date(agent.lastHeartbeatAt).toISOString() : null;
  if (!enabled || agent.status === "paused" || !lastBeatAt) {
    return { state: "off", lastBeatAt, intervalSec };
  }
  if (intervalSec !== null && nowMs - new Date(lastBeatAt).getTime() > intervalSec * 1500) {
    return { state: "overdue", lastBeatAt, intervalSec };
  }
  return { state: "ok", lastBeatAt, intervalSec };
}

export function relativeTimeLabel(fromIso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - new Date(fromIso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function intervalLabel(intervalSec: number | null): string | null {
  if (intervalSec === null) return null;
  if (intervalSec % 3600 === 0) return `every ${intervalSec / 3600}h`;
  if (intervalSec >= 60) return `every ${Math.round(intervalSec / 60)}m`;
  return `every ${intervalSec}s`;
}

export const TICKLER_ALERTS_STORAGE_KEY = "tickler.alerts";

export function normalizeAlertsEnabled(value: string | null | undefined): boolean {
  return value === "on";
}

export interface TicklerActionable {
  criticalOrHigh: boolean;
  count: number;
}

/**
 * Computes the "actionable" summary (used for the Need-you counts and hot-first ordering) from
 * the pieces of TicklerCompanyData that matter for it: pending approvals,
 * undismissed attention items, and whether the CEO heartbeat is overdue.
 * Kept as a plain data-in shape (rather than taking TicklerCompanyData
 * directly) so it stays trivially unit-testable without the hook.
 */
export function deriveActionable(data: {
  approvals: Approval[];
  attention: AttentionFeed | undefined;
  ceoOverdue: boolean;
}): TicklerActionable {
  const undismissedAttention = (data.attention?.items ?? []).filter((item) => !item.dismissal);
  const criticalOrHigh = undismissedAttention.some(
    (item) => item.severity === "critical" || item.severity === "high",
  );
  // The attention feed emits one item per pending approval — those are
  // already counted via `approvals`, so exclude them here or every approval
  // counts twice. (Severity still contributes to criticalOrHigh above.)
  const nonApprovalAttention = undismissedAttention.filter((item) => item.sourceKind !== "approval");
  const count = data.approvals.length + nonApprovalAttention.length + (data.ceoOverdue ? 1 : 0);
  return { criticalOrHigh, count };
}

export interface TicklerSparklineDay {
  date: string;
  label: string;
  succeeded: number;
  failed: number;
  total: number;
  succeededHeightPct: number;
  failedHeightPct: number;
  hasActivity: boolean;
  title: string;
}

/**
 * Normalizes the trailing `count` days of `runActivity` into display-ready
 * sparkline bars: succeeded/failed heights are scaled as a percentage of the
 * max day total across the window (so bars are comparable at a glance), and
 * a day with zero runs is flagged via `hasActivity` so the renderer can draw
 * a 1px baseline mark instead of an empty gap. Pure so it's unit-testable
 * without mounting TicklerSparkline.
 */
export function sparklineDays(runActivity: DashboardRunActivityDay[], count = 7): TicklerSparklineDay[] {
  const days = runActivity.slice(-count);
  const max = Math.max(1, ...days.map((day) => day.succeeded + day.failed));
  return days.map((day) => {
    const total = day.succeeded + day.failed;
    const label = new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return {
      date: day.date,
      label,
      succeeded: day.succeeded,
      failed: day.failed,
      total,
      succeededHeightPct: total === 0 ? 0 : (day.succeeded / max) * 100,
      failedHeightPct: total === 0 ? 0 : (day.failed / max) * 100,
      hasActivity: total > 0,
      title: `${label}: ${day.succeeded} ok, ${day.failed} failed`,
    };
  });
}

export type TicklerAlertHealth = "red" | "amber" | "green";

export interface TicklerAlertSnapshot {
  health: TicklerAlertHealth;
  criticalAttentionIds: string[];
  ceoOverdue: boolean;
}

export type TicklerAlertEventKind = "health_red" | "critical_attention" | "ceo_overdue";

export interface TicklerAlertEvent {
  kind: TicklerAlertEventKind;
  detail?: string;
}

export const TICKLER_LAST_VISIT_STORAGE_KEY = "tickler.lastVisit";

/**
 * Whether the briefing strip (§7) should show: there must be a recorded
 * previous visit, and it must have been more than 30 minutes ago. A null
 * `lastVisitIso` (first-ever visit, or storage unavailable) never shows
 * the briefing — there is nothing to summarize.
 */
export function shouldShowBriefing(lastVisitIso: string | null, nowMs: number): boolean {
  if (!lastVisitIso) return false;
  const elapsedMs = nowMs - new Date(lastVisitIso).getTime();
  return elapsedMs > 30 * 60_000;
}

export interface TicklerBriefingCounts {
  done: number;
  blockers: number;
  failedRuns: number;
}

/**
 * Minimal shapes this helper needs — declared structurally here (rather
 * than imported from `@paperclipai/shared`) so fixtures in tests don't
 * need to satisfy the full `Issue` / `WorkTimelineResult` DTOs.
 */
export interface TicklerBriefingIssueInput {
  status?: string | null;
  /** Issue.updatedAt: typed `Date` on the shared DTO, but arrives as an
   * ISO string over the wire — accept either and normalize below. */
  updatedAt?: Date | string | null;
}
export interface TicklerBriefingTimelineSpan {
  status?: string | null;
}
export interface TicklerBriefingTimelineInput {
  spans?: TicklerBriefingTimelineSpan[];
}

// heartbeatRuns.status values that represent a terminal failure — mirrors
// FAILED_RUN_STATUSES in ui/src/lib/inbox.ts (kept independent here so this
// module has no dependency on inbox.ts's unrelated concerns).
const FAILED_RUN_STATUSES = new Set(["failed", "timed_out"]);

/**
 * Derives the briefing-line counts (§7).
 *
 * - `done` / `blockers` come from a *separate* issues fetch
 *   (`issuesApi.list(companyId, { status: "done,blocked" })`, batched
 *   alongside the timeline query in TicklerBriefing) rather than the
 *   work-timeline payload: `WorkTimelineEvent.kind` (created/commented/
 *   approved/delegated/assigned — see server/src/services/work-timeline.ts)
 *   carries no issue-status-transition signal, so there is no reliable way
 *   to know *when* an issue became done/blocked from the timeline alone.
 *   Instead, an issue counts if its current `status` is "done"/"blocked"
 *   AND its `updatedAt` is after `sinceIso`. This is a "changed since"
 *   approximation, not a true transition log — an issue that was already
 *   done and merely touched again (e.g. a comment) after `sinceIso` will
 *   still count. Acceptable for a glanceable briefing.
 * - `failedRuns` is still timeline-derived: `spans[].status`
 *   (heartbeatRuns.status) equal to a terminal-failure run status
 *   ("failed" | "timed_out").
 *
 * Pure so it's unit-testable without the polling hooks.
 */
export function deriveBriefingLine(input: {
  issues?: TicklerBriefingIssueInput[];
  timelineEntries?: TicklerBriefingTimelineInput;
  sinceIso: string;
}): TicklerBriefingCounts {
  const sinceMs = new Date(input.sinceIso).getTime();
  let done = 0;
  let blockers = 0;
  for (const issue of input.issues ?? []) {
    if (!issue.updatedAt) continue;
    const updatedMs = new Date(issue.updatedAt).getTime();
    if (Number.isNaN(updatedMs) || updatedMs <= sinceMs) continue;
    if (issue.status === "done") done += 1;
    else if (issue.status === "blocked") blockers += 1;
  }
  let failedRuns = 0;
  for (const span of input.timelineEntries?.spans ?? []) {
    if (span.status && FAILED_RUN_STATUSES.has(span.status)) failedRuns += 1;
  }
  return { done, blockers, failedRuns };
}

/**
 * Compares two consecutive poll snapshots and returns the alert-worthy
 * transitions: pane health entering red, a critical-severity attention item
 * id appearing for the first time, and the CEO heartbeat transitioning to
 * overdue. `prev === null` means this is the first snapshot ever taken (no
 * baseline to compare against) — returns [] silently so first load never
 * alerts. Pure so it's unit-testable without the polling hook.
 */

export function detectAlertEdges(prev: TicklerAlertSnapshot | null, next: TicklerAlertSnapshot): TicklerAlertEvent[] {
  if (prev === null) return [];
  const events: TicklerAlertEvent[] = [];
  if (prev.health !== "red" && next.health === "red") {
    events.push({ kind: "health_red" });
  }
  const prevCritical = new Set(prev.criticalAttentionIds);
  for (const id of next.criticalAttentionIds) {
    if (!prevCritical.has(id)) {
      events.push({ kind: "critical_attention", detail: id });
    }
  }
  if (!prev.ceoOverdue && next.ceoOverdue) {
    events.push({ kind: "ceo_overdue" });
  }
  return events;
}

export type TicklerSortMode = "manual" | "hot";

export const TICKLER_SORT_STORAGE_KEY = "tickler.sort";

export function normalizeSortMode(value: string | null | undefined): TicklerSortMode {
  return value === "hot" ? "hot" : "manual";
}

/**
 * Stable partition: items whose id is in hotIds move to the front, both groups
 * keeping their original relative order — so the wall only reshuffles when a
 * company enters/leaves the hot set, never on ordinary polls.
 */
export function partitionHotFirst<T extends { id: string }>(items: T[], hotIds: Set<string>): T[] {
  const hot: T[] = [];
  const rest: T[] = [];
  for (const item of items) (hotIds.has(item.id) ? hot : rest).push(item);
  return [...hot, ...rest];
}

export const TICKLER_PINNED_STORAGE_KEY = "tickler.pinned";

/** Parse the persisted pinned-company id list, tolerating junk. */
export function normalizePinnedIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

const SEVERITY_RANK: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };


/**
 * Total tokens a company burned over the rows returned by costs/by-agent.
 *
 * Counts input + cached input + output, and the subscription-billed columns
 * alongside the API-billed ones — a fleet running on a subscription plan would
 * otherwise report zero, which reads as "idle" rather than "billed elsewhere".
 */
export function sumAgentTokens(rows: ReadonlyArray<CostByAgent> | undefined): number {
  return (rows ?? []).reduce(
    (total, row) =>
      total +
      (row.inputTokens ?? 0) +
      (row.cachedInputTokens ?? 0) +
      (row.outputTokens ?? 0) +
      (row.subscriptionInputTokens ?? 0) +
      (row.subscriptionCachedInputTokens ?? 0) +
      (row.subscriptionOutputTokens ?? 0),
    0,
  );
}

/** Compact token counts: 1.19B, 574M, 99.3M, 250K. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(Math.round(n));
}

/**
 * Absolute monthly token thresholds. Paperclip has no token budget concept, so
 * there is no denominator to express these as a percentage of — a company is
 * over a number you chose, not over a cap the system knows about.
 */
export interface TicklerTokenThresholds {
  warn: number;
  crit: number;
}

export const TICKLER_TOKEN_DEFAULTS: TicklerTokenThresholds = { warn: 250_000_000, crit: 500_000_000 };

export function tokenState(tokens: number, thresholds: TicklerTokenThresholds): "crit" | "warn" | "ok" {
  if (tokens > thresholds.crit) return "crit";
  if (tokens > thresholds.warn) return "warn";
  return "ok";
}

/**
 * First-of-month through today, as the ISO dates the costs endpoints expect.
 * Tokens are quoted per calendar month because that is the window budgets and
 * invoices use; a rolling 30 days would not line up with either.
 */
export function currentMonthRange(nowMs: number): { from: string; to: string } {
  const now = new Date(nowMs);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: iso(now) };
}

/**
 * The compact per-company facts the bar's cross-company modes need. Slots
 * derive this from data they already hold and report it up, so the board can
 * lay companies side by side and total them in its footer without either
 * one owning a second copy of the fetching.
 */
export interface TicklerCompanyStats {
  running: number;
  active: number;
  /**
   * The live task breakdown. `tasksInProgress` was the board's old lone
   * "Tasks" figure; open and blocked were fetched and dropped, and blocked is
   * the most actionable of the three — work that exists and cannot move.
   */
  tasksOpen: number;
  tasksInProgress: number;
  tasksBlocked: number;
  /** Live attention items, dismissed excluded. */
  needs: number;
  critical: number;
  failed: number;
  /** Age in minutes of the oldest live attention item, or null when clear. */
  oldestMins: number | null;
  /** Undefined when the costs endpoint is unavailable to this user. */
  tokens: number | undefined;
  /** Active routines, and how many of them are not firing when they should. */
  routines: number;
  routinesOverdue: number;
  routinesFailing: number;
  unavailable: boolean;
}

export function deriveCompanyStats(input: {
  summary: DashboardSummary | undefined;
  attention: AttentionFeed | undefined;
  tokens: number | undefined;
  routines?: ReadonlyArray<RoutineListItem>;
  unavailable: boolean;
  nowMs: number;
}): TicklerCompanyStats {
  const routineHealth = deriveRoutineHealth(input.routines, input.nowMs);
  const live = (input.attention?.items ?? []).filter((item) => !item.dismissal);
  const ages = live
    .map((item) => (item.activityAt ? Math.round((input.nowMs - new Date(item.activityAt).getTime()) / 60_000) : null))
    .filter((mins): mins is number => mins !== null && Number.isFinite(mins) && mins >= 0);
  return {
    running: input.summary?.agents.running ?? 0,
    active: input.summary?.agents.active ?? 0,
    tasksOpen: input.summary?.tasks.open ?? 0,
    tasksInProgress: input.summary?.tasks.inProgress ?? 0,
    tasksBlocked: input.summary?.tasks.blocked ?? 0,
    needs: live.length,
    critical: live.filter((item) => item.severity === "critical").length,
    failed: live.filter((item) => item.sourceKind === "failed_run").length,
    oldestMins: ages.length ? Math.max(...ages) : null,
    tokens: input.tokens,
    routines: routineHealth.active,
    routinesOverdue: routineHealth.overdue,
    routinesFailing: routineHealth.failing,
    unavailable: input.unavailable,
  };
}

/** Compact ages for the bar: 18m, 4h, 2d. */
export function formatAgeMinutes(mins: number | null): string {
  if (mins === null) return "—";
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export const TICKLER_TOKEN_THRESHOLDS_STORAGE_KEY = "tickler.tokenThresholds";

export interface TicklerTokenSettings {
  /** Applies to every company without an override of its own. */
  defaults: TicklerTokenThresholds;
  /** companyId -> thresholds. Absent means "inherit the default". */
  overrides: Record<string, TicklerTokenThresholds>;
}

function readThresholds(value: unknown): TicklerTokenThresholds | null {
  if (!value || typeof value !== "object") return null;
  const { warn, crit } = value as Record<string, unknown>;
  if (typeof warn !== "number" || typeof crit !== "number") return null;
  if (!Number.isFinite(warn) || !Number.isFinite(crit) || warn <= 0 || crit <= warn) return null;
  return { warn, crit };
}

/** Parse persisted token settings, falling back to defaults for anything junk. */
export function normalizeTokenSettings(raw: string | null | undefined): TicklerTokenSettings {
  const empty: TicklerTokenSettings = { defaults: TICKLER_TOKEN_DEFAULTS, overrides: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const overrides: Record<string, TicklerTokenThresholds> = {};
    const rawOverrides = parsed.overrides;
    if (rawOverrides && typeof rawOverrides === "object") {
      for (const [companyId, value] of Object.entries(rawOverrides as Record<string, unknown>)) {
        const thresholds = readThresholds(value);
        if (thresholds) overrides[companyId] = thresholds;
      }
    }
    return { defaults: readThresholds(parsed.defaults) ?? TICKLER_TOKEN_DEFAULTS, overrides };
  } catch {
    return empty;
  }
}

/**
 * The thresholds a company is actually judged by. A company with no override
 * inherits, rather than holding a copy — so raising the default afterwards
 * still moves everyone who never opted out.
 */
export function thresholdsFor(settings: TicklerTokenSettings, companyId: string): TicklerTokenThresholds {
  return settings.overrides[companyId] ?? settings.defaults;
}

const SEVERITY_ORDER: Record<AttentionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };


/**
 * A routine that should have fired by now but has not is invisible in every
 * other surface — it produces no attention item, no failed run, nothing. It
 * simply stops happening. This grace window keeps normal scheduler lag from
 * reading as a fault.
 */
export const TICKLER_ROUTINE_OVERDUE_GRACE_MS = 10 * 60_000;

export interface TicklerRoutineHealth {
  total: number;
  /** Status "active" — paused and archived routines are not expected to fire. */
  active: number;
  paused: number;
  /** Active routines whose next scheduled run is further past than the grace window. */
  overdue: number;
  /** Active routines whose most recent run failed. */
  failing: number;
  /** Soonest upcoming run across every enabled trigger, or null when nothing is scheduled. */
  nextRunAt: string | null;
  /** The routine that soonest run belongs to. */
  nextTitle: string | null;
}

export function deriveRoutineHealth(
  routines: ReadonlyArray<RoutineListItem> | undefined,
  nowMs: number,
): TicklerRoutineHealth {
  const all = routines ?? [];
  const live = all.filter((routine) => routine.status !== "archived");
  const active = live.filter((routine) => routine.status === "active");

  let overdue = 0;
  let nextRunAt: number | null = null;
  let nextTitle: string | null = null;

  for (const routine of active) {
    for (const trigger of routine.triggers ?? []) {
      if (!trigger.enabled || !trigger.nextRunAt) continue;
      const runAt = new Date(trigger.nextRunAt).getTime();
      if (!Number.isFinite(runAt)) continue;
      if (runAt < nowMs - TICKLER_ROUTINE_OVERDUE_GRACE_MS) {
        overdue += 1;
        continue;
      }
      if (nextRunAt === null || runAt < nextRunAt) {
        nextRunAt = runAt;
        nextTitle = routine.title;
      }
    }
  }

  return {
    total: live.length,
    active: active.length,
    paused: live.filter((routine) => routine.status === "paused").length,
    overdue,
    failing: active.filter((routine) => routine.lastRun?.status === "failed").length,
    nextRunAt: nextRunAt === null ? null : new Date(nextRunAt).toISOString(),
    nextTitle,
  };
}

/** "in 12m", "in 3h", "in 2d" — or "now" when it is due this minute. */
export function formatCountdown(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const mins = Math.round((new Date(iso).getTime() - nowMs) / 60_000);
  if (!Number.isFinite(mins)) return "—";
  if (mins <= 0) return "now";
  if (mins < 60) return `in ${mins}m`;
  if (mins < 1440) return `in ${Math.round(mins / 60)}h`;
  return `in ${Math.round(mins / 1440)}d`;
}

/**
 * The specific thing an item is about, or null.
 *
 * attentionDetailText will happily return a generic sentence — "3 questions
 * awaiting answers", "blocked by ?" — which tells you the shape of the problem
 * and nothing about which problem. That is fine as a subtitle and useless as a
 * row title. This returns only text drawn from the item itself, so callers can
 * fall back to something better rather than printing a placeholder.
 */
export function attentionSpecificText(detail: AttentionItem["detail"]): string | null {
  if (!detail) return null;
  const nonEmpty = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
  switch (detail.kind) {
    case "approval":
    case "plan_approval":
    case "generic":
      return nonEmpty(detail.summaryExcerpt);
    case "confirmation":
    case "checkbox_confirmation":
    case "item_verdicts":
      return nonEmpty(detail.promptExcerpt);
    case "questions":
      return nonEmpty(detail.firstQuestionText);
    case "suggested_tasks":
      return nonEmpty(detail.firstTaskTitle);
    case "failed_run":
    case "agent_error":
      return nonEmpty(detail.failureReasonExcerpt);
    case "blocker":
      return nonEmpty(detail.blockingIssue?.title);
    default:
      return null;
  }
}

/**
 * What a one-line row should say an item is.
 *
 * Prefers the ticket title, because that is the noun you recognise; falls back
 * to the specific question or excerpt the item carries; and only then to
 * whyNow, which is written as an explanation rather than a name.
 */
/**
 * The server titles a thread interaction with whatever the agent supplied,
 * falling back to a generic label per kind. These are those fallbacks: a row
 * wearing one says nothing about *what* needs answering, so callers that
 * know the issue prefer its title instead.
 */
const GENERIC_INTERACTION_TITLES = new Set([
  "Confirmation requested",
  "Selection confirmation requested",
  "Questions need answers",
  "Suggested tasks need a decision",
  "Item verdicts need a decision",
  "Interaction needs a decision",
]);

export function isGenericInteractionTitle(title: string | null | undefined): boolean {
  return !!title && GENERIC_INTERACTION_TITLES.has(title.trim());
}

/**
 * Headline for a queue row: the subject's own title unless it is one of the
 * generic interaction labels and we know the issue, in which case the issue
 * title says far more about what is being asked.
 */
export function attentionHeadline(item: AttentionItem, issue: Pick<Issue, "title"> | null | undefined): string {
  const subjectTitle = item.subject.title?.trim();
  if (subjectTitle && !(issue && isGenericInteractionTitle(subjectTitle))) return subjectTitle;
  if (issue?.title?.trim()) return issue.title.trim();
  return attentionRowTitle(item);
}

/**
 * The ask itself, as a second line under the headline: the first question
 * (with a count when there are more), the confirmation prompt, the blocking
 * issue, the failure reason. Null when the detail adds nothing a reader
 * would not get from the headline.
 */
export function attentionAskText(item: AttentionItem, headline: string): string | null {
  const detail = item.detail;
  if (!detail) return null;
  let text: string | null;
  if (detail.kind === "questions") {
    const first = attentionSpecificText(detail);
    const count = detail.questionCount > 1 ? `${detail.questionCount} questions · ` : "";
    text = first ? `${count}${first}` : detail.questionCount > 0 ? `${detail.questionCount} question${detail.questionCount === 1 ? "" : "s"} awaiting answers` : null;
  } else if (detail.kind === "blocker") {
    const blocker = attentionSpecificText(detail);
    text = blocker ? `blocked by ${detail.blockingIssue?.identifier ? `${detail.blockingIssue.identifier} ` : ""}${blocker}` : null;
  } else {
    text = attentionSpecificText(detail);
  }
  if (!text) return null;
  return text.trim() === headline.trim() ? null : text;
}

/**
 * What the row's link does, in the verb the interaction actually wants —
 * "Answer" for questions, "Confirm" for a confirmation — rather than a
 * one-size "Reply". The link still opens the thread; nothing resolves inline.
 */
export function attentionActionLabel(item: AttentionItem): string {
  if (item.sourceKind !== "issue_thread_interaction") return "Open";
  const kind = item.subject.metadata?.kind;
  switch (kind) {
    case "ask_user_questions":
      return "Answer";
    case "request_confirmation":
    case "request_checkbox_confirmation":
      return "Confirm";
    case "suggest_tasks":
    case "request_item_verdicts":
      return "Decide";
    default:
      return "Reply";
  }
}

export function attentionRowTitle(item: AttentionItem): string {
  const subjectTitle = item.subject.title?.trim();
  if (subjectTitle) return subjectTitle;
  return attentionSpecificText(item.detail) ?? item.whyNow;
}


/**
 * Runs completed per day over the trailing window, with the failure split.
 *
 * The board's old column was labelled "7d", which named a window rather than a
 * measure — this is the measure: throughput, in runs a day.
 */
export interface TicklerThroughput {
  perDay: number;
  succeeded: number;
  failed: number;
  total: number;
  /** Whole-percent failure rate, or null when nothing ran at all. */
  failRatePct: number | null;
  days: DashboardRunActivityDay[];
}

export function deriveThroughput(runActivity: ReadonlyArray<DashboardRunActivityDay>, window = 7): TicklerThroughput {
  const days = runActivity.slice(-window);
  const succeeded = days.reduce((sum, day) => sum + day.succeeded, 0);
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  // The server's own `total` also counts `recovered` (failed, then a retry
  // succeeded) and `other`. Summing succeeded+failed alone undercounts the
  // day's work — a company whose restart-killed runs all recovered would show
  // none of them — and inflates the failure rate by shrinking its denominator.
  const total = days.reduce((sum, day) => sum + (day.total ?? day.succeeded + day.failed), 0);
  return {
    // One decimal: "4.7 /day" reads as a rate, "5 /day" reads as a count.
    perDay: Math.round((total / Math.max(1, window)) * 10) / 10,
    succeeded,
    failed,
    total,
    failRatePct: total === 0 ? null : Math.round((failed / total) * 100),
    days,
  };
}

/**
 * Tokens as millions, for a column that is read at a glance rather than
 * reconciled against an invoice. Sub-million figures keep one decimal so a
 * quiet company reads "0.4" rather than collapsing to "0".
 */
export function formatTokensMillions(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return "0";
  const millions = tokens / 1e6;
  return millions < 1 ? millions.toFixed(1) : String(Math.round(millions));
}

/**
 * How badly a company wants you, 0–5.
 *
 * Deliberately never rendered: Need-you and Decisions already answer "does
 * this company want me", so a heat mark beside them would be a second opinion
 * on the same question. Heat exists to *order* the board, which is the one
 * job those columns cannot do — it folds in the things no single column shows
 * (a stalled or over-limit run, an errored agent, an unreachable company), so a company with
 * nothing in its Need-you count can still sort to the top when it is broken.
 */
export interface TicklerHeatInput {
  unavailable: boolean;
  criticalOrHigh: boolean;
  needs: number;
  /** Age of the oldest thing waiting on you, in minutes. */
  oldestMins: number | null;
  tasksBlocked: number;
  /** Live runs that have gone quiet — see deriveCapacity. */
  stalled: number;
  /**
   * Live runs past their agent's own time limit — see countOverLimitRuns.
   * Outweighs `stalled`: a quiet run may still answer, this one never will.
   */
  overLimit: number;
  agentErrors: number;
  /** Open decisions — a slice of `needs`, counted here so heat can weight them. */
  decisionsOpen: number;
  tokenState: "crit" | "warn" | "ok";
}

export const TICKLER_HEAT_MAX = 5;

export function deriveHeat(input: TicklerHeatInput): number {
  // An unreachable company is the top of the board by definition: every other
  // signal about it is missing, which is exactly why it needs a person.
  if (input.unavailable) return TICKLER_HEAT_MAX;
  let score = 0;
  if (input.agentErrors > 0) score += 2;
  if (input.overLimit > 0) score += 3;
  if (input.stalled > 0) score += 2;
  if (input.decisionsOpen > 0) score += 1;
  if (input.criticalOrHigh) score += 2;
  // Age outranks volume: one thing ignored for two days beats six from this
  // morning, and neither the count nor the severity captures that.
  if (input.oldestMins !== null && input.oldestMins >= 1440) score += 2;
  else if (input.oldestMins !== null && input.oldestMins >= 240) score += 1;
  if (input.needs > 0) score += 1;
  if (input.tasksBlocked > 0) score += 1;
  if (input.tokenState === "crit") score += 1;
  return Math.min(TICKLER_HEAT_MAX, score);
}
