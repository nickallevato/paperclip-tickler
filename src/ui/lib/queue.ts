import type {
  Agent,
  Approval,
  AttentionFeed,
  AttentionItem,
  Company,
  Issue,
  Project,
  RoutineListItem,
} from "@paperclipai/shared";
import type { LiveRunForIssue } from "../host/api";
import { isRunActive, runPhase, type RunPhase } from "./runs";
import {
  TICKLER_ROUTINE_OVERDUE_GRACE_MS,
  attentionIssueId,
  deriveCeoHeartbeat,
  selectCeo,
  type TicklerCeoHeartbeat,
} from "./tickler";

/**
 * The "Needs you" queue: everything across every company that is waiting on a
 * human, in one list, in the order you should work it.
 *
 * Three buckets, by how long the thing can wait:
 *   now   — approvals, critical attention, an overdue CEO heartbeat
 *   soon  — high attention, routines that stopped firing or whose last run failed
 *   later — medium / low attention (shown as a count, expanded on demand)
 *
 * Pure functions over the pieces of TicklerCompanyData, like the other derive*
 * helpers, so the bucketing is unit-tested without the polling hook.
 */
export type TicklerQueueBucket = "now" | "soon" | "later";

export const TICKLER_QUEUE_BUCKETS: ReadonlyArray<{ bucket: TicklerQueueBucket; label: string }> = [
  { bucket: "now", label: "Now" },
  { bucket: "soon", label: "Soon" },
  { bucket: "later", label: "Later" },
];

interface TicklerQueueItemBase {
  /** Stable across polls: `${kind}:${source id}`. */
  id: string;
  companyId: string;
  bucket: TicklerQueueBucket;
  /** Lower sorts first within a bucket. */
  rank: number;
  /** When the item started needing you (epoch ms), or null when unknown. */
  atMs: number | null;
  /**
   * The identity Paperclip's decision triage is keyed by (the attention
   * item's `sourceKind` + `subject.id`), or null for the conditions Tickler
   * derives itself — an overdue heartbeat, a stalled routine — which have no
   * triage row and clear on their own.
   */
  triage: { sourceKind: string; sourceId: string } | null;
  /** Server-side decide-by: "today" | "this_week" | "whenever" | YYYY-MM-DD, or null. */
  decideBy: string | null;
  /** Server-side snooze, ISO; the item hides until then outside the Snoozed lane. */
  snoozedUntil: string | null;
}

export type TicklerQueueItem =
  | (TicklerQueueItemBase & { kind: "approval"; approval: Approval; requestedBy: string | null })
  | (TicklerQueueItemBase & {
      kind: "attention";
      item: AttentionItem;
      /** The issue the item is about, when it is about one we hold. */
      issue: Issue | null;
    })
  | (TicklerQueueItemBase & { kind: "heartbeat"; ceo: Agent; beat: TicklerCeoHeartbeat })
  | (TicklerQueueItemBase & { kind: "routine"; routine: RoutineListItem; reason: "overdue" | "failed" });

const BUCKET_ORDER: Record<TicklerQueueBucket, number> = { now: 0, soon: 1, later: 2 };

const PHASE_ORDER: Record<RunPhase, number> = { working: 0, queued: 1 };

function epochMs(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function attentionBucket(severity: AttentionItem["severity"]): { bucket: TicklerQueueBucket; rank: number } {
  switch (severity) {
    case "critical":
      return { bucket: "now", rank: 0 };
    case "high":
      return { bucket: "soon", rank: 2 };
    case "medium":
      return { bucket: "later", rank: 4 };
    default:
      return { bucket: "later", rank: 5 };
  }
}

export function deriveQueueItems(input: {
  companyId: string;
  approvals: ReadonlyArray<Approval>;
  attention: AttentionFeed | undefined;
  agents: ReadonlyArray<Agent>;
  routines: ReadonlyArray<RoutineListItem>;
  /** Optional; lets attention rows name the issue behind a thread interaction. */
  issues?: ReadonlyArray<Issue>;
  nowMs: number;
}): TicklerQueueItem[] {
  const items: TicklerQueueItem[] = [];
  const agentName = new Map(input.agents.map((agent) => [agent.id, agent.name]));
  const issueById = new Map((input.issues ?? []).map((issue) => [issue.id, issue]));
  // An approval's decide-by and snooze live on its attention-feed twin, which
  // is otherwise skipped below; read them off it so both halves agree.
  const approvalTwin = new Map(
    (input.attention?.items ?? [])
      .filter((item) => item.sourceKind === "approval")
      .map((item) => [item.subject.id, item]),
  );

  for (const approval of input.approvals) {
    const twin = approvalTwin.get(approval.id);
    items.push({
      triage: { sourceKind: "approval", sourceId: approval.id },
      decideBy: twin?.decideBy ?? null,
      snoozedUntil: twin?.snoozedUntil ?? null,
      kind: "approval",
      id: `approval:${approval.id}`,
      companyId: input.companyId,
      bucket: "now",
      rank: 1,
      atMs: epochMs(approval.createdAt),
      approval,
      requestedBy: approval.requestedByAgentId ? (agentName.get(approval.requestedByAgentId) ?? null) : null,
    });
  }

  // The attention feed emits one item per pending approval; those are already
  // in the queue via `approvals` (with their Approve/Reject actions), so they
  // are skipped here — the same exclusion deriveActionable makes.
  for (const item of input.attention?.items ?? []) {
    if (item.dismissal || item.sourceKind === "approval") continue;
    const { bucket, rank } = attentionBucket(item.severity);
    items.push({
      triage: { sourceKind: item.sourceKind, sourceId: item.subject.id },
      decideBy: item.decideBy ?? null,
      snoozedUntil: item.snoozedUntil ?? null,
      kind: "attention",
      id: `attention:${item.id}`,
      companyId: input.companyId,
      bucket,
      rank,
      atMs: epochMs(item.activityAt),
      item,
      issue: (() => {
        const issueId = attentionIssueId(item);
        return issueId ? (issueById.get(issueId) ?? null) : null;
      })(),
    });
  }

  const ceo = selectCeo([...input.agents]);
  const beat = deriveCeoHeartbeat(ceo, input.nowMs);
  if (ceo && beat.state === "overdue") {
    items.push({
      triage: null,
      decideBy: null,
      snoozedUntil: null,
      kind: "heartbeat",
      id: `heartbeat:${ceo.id}`,
      companyId: input.companyId,
      bucket: "now",
      rank: 1,
      atMs: epochMs(beat.lastBeatAt),
      ceo,
      beat,
    });
  }

  // A routine that stopped firing produces no attention item and no failed
  // run — this is the only place it becomes visible.
  for (const routine of input.routines) {
    if (routine.status !== "active") continue;
    const overdueAt = (routine.triggers ?? [])
      .filter((trigger) => trigger.enabled && trigger.nextRunAt)
      .map((trigger) => epochMs(trigger.nextRunAt as unknown as string))
      .filter((ms): ms is number => ms !== null && ms < input.nowMs - TICKLER_ROUTINE_OVERDUE_GRACE_MS)
      .sort((a, b) => a - b)[0];
    if (overdueAt !== undefined) {
      items.push({
        triage: null,
        decideBy: null,
        snoozedUntil: null,
        kind: "routine",
        id: `routine:${routine.id}:overdue`,
        companyId: input.companyId,
        bucket: "soon",
        rank: 3,
        atMs: overdueAt,
        routine,
        reason: "overdue",
      });
    } else if (routine.lastRun?.status === "failed") {
      items.push({
        triage: null,
        decideBy: null,
        snoozedUntil: null,
        kind: "routine",
        id: `routine:${routine.id}:failed`,
        companyId: input.companyId,
        bucket: "soon",
        rank: 3,
        atMs: epochMs(routine.lastRun.completedAt ?? routine.lastRun.triggeredAt),
        routine,
        reason: "failed",
      });
    }
  }

  return items;
}

/**
 * Which way the age tiebreaker runs once severity has had its say. Severity —
 * the bucket, then the rank inside it — always wins; this only decides which
 * of two equally urgent items you see first.
 */
export type TicklerQueueSort = "oldest" | "newest";

export const TICKLER_QUEUE_SORT_STORAGE_KEY = "tickler.queueSort";

export function normalizeQueueSort(value: string | null | undefined): TicklerQueueSort {
  return value === "newest" ? "newest" : "oldest";
}

/** Bucket, then rank, then age in `sort` order (unknown ages last either way). */
export function compareQueueItems(a: TicklerQueueItem, b: TicklerQueueItem, sort: TicklerQueueSort = "oldest"): number {
  const byBucket = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
  if (byBucket !== 0) return byBucket;
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.atMs === null && b.atMs === null) return 0;
  if (a.atMs === null) return 1;
  if (b.atMs === null) return -1;
  return sort === "newest" ? b.atMs - a.atMs : a.atMs - b.atMs;
}

export function queueItemAgeMinutes(item: { atMs: number | null }, nowMs: number): number | null {
  if (item.atMs === null) return null;
  const mins = Math.round((nowMs - item.atMs) / 60_000);
  return Number.isFinite(mins) && mins >= 0 ? mins : null;
}

export interface TicklerQueueSummary {
  now: number;
  soon: number;
  later: number;
  total: number;
  /** Age of the oldest Now/Soon item in minutes, or null when those are empty. */
  oldestMins: number | null;
}

export function summarizeQueue(items: ReadonlyArray<TicklerQueueItem>, nowMs: number): TicklerQueueSummary {
  const ages = items
    .filter((item) => item.bucket !== "later")
    .map((item) => queueItemAgeMinutes(item, nowMs))
    .filter((mins): mins is number => mins !== null);
  return {
    now: items.filter((item) => item.bucket === "now").length,
    soon: items.filter((item) => item.bucket === "soon").length,
    later: items.filter((item) => item.bucket === "later").length,
    total: items.length,
    oldestMins: ages.length ? Math.max(...ages) : null,
  };
}

export type TicklerQueueGrouping = "decide" | "severity" | "company" | "kind" | "project" | "age";

export const TICKLER_QUEUE_GROUPINGS: ReadonlyArray<{ grouping: TicklerQueueGrouping; label: string }> = [
  { grouping: "decide", label: "Decide by" },
  { grouping: "severity", label: "Severity" },
  { grouping: "company", label: "Org" },
  { grouping: "kind", label: "Kind" },
  { grouping: "project", label: "Project" },
  { grouping: "age", label: "Age" },
];

export const TICKLER_QUEUE_GROUPING_STORAGE_KEY = "tickler.queueGrouping";

export function normalizeQueueGrouping(value: string | null | undefined): TicklerQueueGrouping {
  return TICKLER_QUEUE_GROUPINGS.some((entry) => entry.grouping === value) ? (value as TicklerQueueGrouping) : "decide";
}

/** What sort of ask an item is — the "Kind" grouping and the row glyph. */
export type TicklerQueueKind =
  | "questions"
  | "confirmations"
  | "approvals"
  | "blockers"
  | "failed"
  | "heartbeats"
  | "routines"
  | "other";

const KIND_ORDER: ReadonlyArray<{ kind: TicklerQueueKind; label: string }> = [
  { kind: "questions", label: "Questions" },
  { kind: "confirmations", label: "Confirmations" },
  { kind: "approvals", label: "Approvals" },
  { kind: "heartbeats", label: "Heartbeats" },
  { kind: "failed", label: "Failed runs" },
  { kind: "routines", label: "Routines" },
  { kind: "blockers", label: "Blockers" },
  { kind: "other", label: "Other" },
];

export function queueItemKind(item: TicklerQueueItem): TicklerQueueKind {
  switch (item.kind) {
    case "approval":
      return "approvals";
    case "heartbeat":
      return "heartbeats";
    case "routine":
      return "routines";
    default: {
      const source = item.item.sourceKind;
      if (source === "issue_thread_interaction") {
        const kind = item.item.subject.metadata?.kind;
        return kind === "ask_user_questions" ? "questions" : "confirmations";
      }
      if (source === "blocker_attention") return "blockers";
      if (source === "failed_run" || source === "agent_error_alert") return "failed";
      return "other";
    }
  }
}

// ---------------------------------------------------------------------------
// Decide-by lanes
// ---------------------------------------------------------------------------

/**
 * When you have said you will decide something, from Paperclip's decision
 * triage — the same `decideBy` / `snoozedUntil` the host's Decisions page
 * reads and writes, so the two can never disagree.
 *
 *   today    — "today", or a date that is today or already past (overdue)
 *   unsorted — nothing set yet: new, waiting for you to give it a day
 *   week     — "this_week", or a date before the week is out
 *   alerts   — conditions Tickler derives (heartbeat, routine); no triage row,
 *              they clear themselves when the condition does
 *   whenever — "whenever", or a date beyond this week
 *   snoozed  — snoozed until a time still ahead; hidden from other groupings
 *
 * Dates compare in local calendar days — "today" means the reader's today.
 * Weeks end on Sunday.
 */
export type TicklerDecideLane = "today" | "unsorted" | "week" | "alerts" | "whenever" | "snoozed";

export const TICKLER_DECIDE_LANES: ReadonlyArray<{ lane: TicklerDecideLane; label: string; folded: boolean }> = [
  { lane: "today", label: "Today", folded: false },
  { lane: "unsorted", label: "Unsorted", folded: false },
  { lane: "week", label: "This week", folded: false },
  { lane: "alerts", label: "Alerts", folded: false },
  { lane: "whenever", label: "Whenever", folded: true },
  { lane: "snoozed", label: "Snoozed", folded: true },
];

/** Local YYYY-MM-DD for an epoch. */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Local YYYY-MM-DD of the Sunday that closes the week containing `ms`. */
function endOfWeekKey(ms: number): string {
  const d = new Date(ms);
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  return localDateKey(d.getTime());
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isSnoozed(item: Pick<TicklerQueueItem, "snoozedUntil">, nowMs: number): boolean {
  const until = epochMs(item.snoozedUntil);
  return until !== null && until > nowMs;
}

/** A decide-by date that has already passed (a preset never goes overdue). */
export function isDecideOverdue(item: Pick<TicklerQueueItem, "decideBy">, nowMs: number): boolean {
  return !!item.decideBy && DATE_KEY.test(item.decideBy) && item.decideBy < localDateKey(nowMs);
}

export function decideLane(item: TicklerQueueItem, nowMs: number): TicklerDecideLane {
  if (isSnoozed(item, nowMs)) return "snoozed";
  if (!item.triage) return "alerts";
  const decideBy = item.decideBy;
  if (!decideBy) return "unsorted";
  if (decideBy === "today") return "today";
  if (decideBy === "this_week") return "week";
  if (decideBy === "whenever") return "whenever";
  if (DATE_KEY.test(decideBy)) {
    if (decideBy <= localDateKey(nowMs)) return "today";
    if (decideBy <= endOfWeekKey(nowMs)) return "week";
    return "whenever";
  }
  // An unrecognised value is still a decision someone made; do not call it unsorted.
  return "whenever";
}

/** "Today", "This week", "Whenever", "Fri 26 Sep", or null when unset. */
export function decideByLabel(decideBy: string | null): string | null {
  if (!decideBy) return null;
  if (decideBy === "today") return "Today";
  if (decideBy === "this_week") return "This week";
  if (decideBy === "whenever") return "Whenever";
  if (DATE_KEY.test(decideBy)) {
    const date = new Date(`${decideBy}T12:00:00`);
    if (Number.isFinite(date.getTime())) {
      return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
    }
  }
  return decideBy;
}

/** Snooze presets, matching the host's DecisionTriageStrip; resolved at click time. */
export const TICKLER_SNOOZE_PRESETS: ReadonlyArray<{ label: string; resolve: (nowMs: number) => string }> = [
  { label: "1 hour", resolve: (nowMs) => new Date(nowMs + 60 * 60_000).toISOString() },
  { label: "4 hours", resolve: (nowMs) => new Date(nowMs + 4 * 60 * 60_000).toISOString() },
  {
    label: "Tomorrow 9:00",
    resolve: (nowMs) => {
      const d = new Date(nowMs);
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    },
  },
  { label: "Next week", resolve: (nowMs) => new Date(nowMs + 7 * 24 * 60 * 60_000).toISOString() },
];

export interface TicklerDecideSummary {
  today: number;
  overdue: number;
  unsorted: number;
  snoozed: number;
}

export function summarizeDecide(items: ReadonlyArray<TicklerQueueItem>, nowMs: number): TicklerDecideSummary {
  const summary: TicklerDecideSummary = { today: 0, overdue: 0, unsorted: 0, snoozed: 0 };
  for (const item of items) {
    const lane = decideLane(item, nowMs);
    if (lane === "today") summary.today += 1;
    if (lane === "unsorted") summary.unsorted += 1;
    if (lane === "snoozed") summary.snoozed += 1;
    if (lane !== "snoozed" && isDecideOverdue(item, nowMs)) summary.overdue += 1;
  }
  return summary;
}

/**
 * Age buckets, in calendar days rather than rolling hours.
 *
 * "Yesterday" has to mean yesterday — an item raised at 9pm last night is
 * yesterday's at 8am today, even though it is eleven hours old. A rolling
 * 24-hour window would file it under "today" and the filter would lie. Every
 * boundary is therefore local midnight, which is also what the reader means
 * when they say "last week".
 *
 * The same buckets drive the Age grouping and the rail's filter chips, so the
 * two can never disagree about which pile an item is in.
 */
export type TicklerQueueAge = "today" | "yesterday" | "week" | "old";

const AGE_ORDER: ReadonlyArray<{ age: TicklerQueueAge; label: string }> = [
  { age: "old", label: "Older than a week" },
  { age: "week", label: "Last week" },
  { age: "yesterday", label: "Yesterday" },
  { age: "today", label: "Today" },
];

/** Local midnight opening the day `ms` falls in. */
function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function queueItemAge(item: { atMs: number | null }, nowMs: number): TicklerQueueAge {
  // An item with no timestamp is not evidence of age; filing it under "old"
  // would bury it behind a filter nobody opens, so it reads as today's.
  if (item.atMs === null) return "today";
  const today = startOfDay(nowMs);
  if (item.atMs >= today) return "today";
  if (item.atMs >= today - 86_400_000) return "yesterday";
  if (item.atMs >= today - 7 * 86_400_000) return "week";
  return "old";
}

/**
 * The rail's filter: the four buckets plus "all".
 *
 * A filter, not a grouping — the point is to make a 137-item rail readable by
 * putting three quarters of it out of sight, which grouping alone cannot do
 * because every group is still on the page.
 */
export type TicklerQueueAgeFilter = TicklerQueueAge | "all";

export const TICKLER_QUEUE_AGE_FILTERS: ReadonlyArray<{ filter: TicklerQueueAgeFilter; label: string }> = [
  { filter: "all", label: "All" },
  { filter: "today", label: "Today" },
  { filter: "yesterday", label: "Yesterday" },
  { filter: "week", label: "Last week" },
  { filter: "old", label: "Old" },
];

export const TICKLER_QUEUE_AGE_FILTER_STORAGE_KEY = "tickler.queueAgeFilter";

export function normalizeQueueAgeFilter(value: string | null | undefined): TicklerQueueAgeFilter {
  return TICKLER_QUEUE_AGE_FILTERS.some((entry) => entry.filter === value)
    ? (value as TicklerQueueAgeFilter)
    : "all";
}

export function filterQueueByAge(
  items: ReadonlyArray<TicklerQueueItem>,
  filter: TicklerQueueAgeFilter,
  nowMs: number,
): TicklerQueueItem[] {
  return filter === "all" ? [...items] : items.filter((item) => queueItemAge(item, nowMs) === filter);
}

/** How many items sit in each bucket, so a chip can carry its own count. */
export function countQueueByAge(
  items: ReadonlyArray<TicklerQueueItem>,
  nowMs: number,
): Record<TicklerQueueAgeFilter, number> {
  const counts: Record<TicklerQueueAgeFilter, number> = { all: items.length, today: 0, yesterday: 0, week: 0, old: 0 };
  for (const item of items) counts[queueItemAge(item, nowMs)] += 1;
  return counts;
}

/** Grey until a week, amber to a month, red after — the ramp on the age label. */
export function ageTone(minutes: number | null): "fresh" | "aging" | "stale" {
  if (minutes === null || minutes < 7 * 24 * 60) return "fresh";
  return minutes >= 30 * 24 * 60 ? "stale" : "aging";
}

export interface TicklerQueueGroup {
  key: string;
  label: string;
  bucket: TicklerQueueBucket | null;
  company: Company | null;
  items: TicklerQueueItem[];
  /** Starts folded (Later, Whenever, Snoozed): a count you can open. */
  folded?: boolean;
  /** Set on decide-by groups. */
  lane?: TicklerDecideLane;
}

/**
 * Severity grouping = the three buckets (empty ones omitted). Company grouping
 * keeps the given company order — the page passes its hot-first/manual order —
 * and omits companies with nothing in the queue. Items inside a group are
 * always in compareQueueItems order, with `context.sort` picking which way the
 * age tiebreaker runs.
 */
export function groupQueue(
  items: ReadonlyArray<TicklerQueueItem>,
  grouping: TicklerQueueGrouping,
  companies: ReadonlyArray<Company>,
  context: { projects?: ReadonlyArray<Project>; nowMs?: number; sort?: TicklerQueueSort } = {},
): TicklerQueueGroup[] {
  const sort = context.sort ?? "oldest";
  const sorted = [...items].sort((a, b) => compareQueueItems(a, b, sort));
  const groupsOf = <K extends string>(
    order: ReadonlyArray<{ key: K; label: string }>,
    keyOf: (item: TicklerQueueItem) => K,
  ): TicklerQueueGroup[] =>
    order
      .map(({ key, label }) => ({
        key,
        label,
        bucket: null,
        company: null,
        items: sorted.filter((item) => keyOf(item) === key),
      }))
      .filter((group) => group.items.length > 0);

  switch (grouping) {
    case "decide": {
      const nowMs = context.nowMs ?? Date.now();
      return TICKLER_DECIDE_LANES.map(({ lane, label, folded }) => ({
        key: `decide:${lane}`,
        label,
        bucket: null,
        company: null,
        lane,
        folded,
        items: sorted.filter((item) => decideLane(item, nowMs) === lane),
      })).filter((group) => group.items.length > 0);
    }
    case "company":
      return companies
        .map((company) => ({
          key: company.id,
          label: company.name,
          bucket: null,
          company,
          items: sorted.filter((item) => item.companyId === company.id),
        }))
        .filter((group) => group.items.length > 0);
    case "kind":
      return groupsOf(KIND_ORDER.map(({ kind, label }) => ({ key: kind, label })), queueItemKind);
    case "age": {
      const nowMs = context.nowMs ?? Date.now();
      return groupsOf(AGE_ORDER.map(({ age, label }) => ({ key: age, label })), (item) => queueItemAge(item, nowMs));
    }
    case "project": {
      // Projects in the order they first appear in the sorted queue, so the
      // project holding the most urgent item leads; no-project items last.
      const projectName = new Map((context.projects ?? []).map((project) => [project.id, project.name]));
      const projectOf = (item: TicklerQueueItem): string =>
        item.kind === "attention" && item.issue?.projectId ? item.issue.projectId : "";
      const order: Array<{ key: string; label: string }> = [];
      for (const item of sorted) {
        const key = projectOf(item);
        if (key && !order.some((entry) => entry.key === key)) {
          order.push({ key, label: projectName.get(key) ?? "Project" });
        }
      }
      order.push({ key: "", label: "No project" });
      return groupsOf(order, projectOf);
    }
    case "severity":
    default:
      return TICKLER_QUEUE_BUCKETS.map(({ bucket, label }) => ({
        key: bucket,
        label,
        bucket,
        folded: bucket === "later",
        company: null,
        items: sorted.filter((item) => item.bucket === bucket),
      })).filter((group) => group.items.length > 0);
  }
}

// ---------------------------------------------------------------------------
// Cross-company live runs and upcoming routines (the two lists under the board)
// ---------------------------------------------------------------------------

export interface TicklerLiveEntry {
  company: Company;
  run: LiveRunForIssue;
  issue: Issue | undefined;
  startedMs: number;
  /** Working = an agent is on it; queued = waiting for a runner. */
  phase: RunPhase;
}

/**
 * Every queued/running run across companies. Runs actually being worked come
 * first (longest-running first), then the queue behind them (longest-waiting
 * first) — a run waiting on a runner is a different thing to look at than a
 * run burning time on a ticket, so the two never interleave.
 */
export function flattenLiveRuns(
  entries: ReadonlyArray<{ company: Company; runs: ReadonlyArray<LiveRunForIssue>; issues: ReadonlyArray<Issue> }>,
): TicklerLiveEntry[] {
  const out: TicklerLiveEntry[] = [];
  for (const { company, runs, issues } of entries) {
    const issueById = new Map(issues.map((issue) => [issue.id, issue]));
    for (const run of runs) {
      if (!isRunActive(run)) continue;
      out.push({
        company,
        run,
        issue: run.issueId ? issueById.get(run.issueId) : undefined,
        startedMs: epochMs(run.startedAt ?? run.createdAt) ?? 0,
        phase: runPhase(run),
      });
    }
  }
  return out.sort(
    (a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || a.startedMs - b.startedMs,
  );
}

// ---------------------------------------------------------------------------
// Recent tasks (the rail's list of what the fleet is on)
// ---------------------------------------------------------------------------

export interface TicklerRecentTask {
  /** Stable per row: the ticket it is about, or the run when there is no ticket. */
  key: string;
  company: Company;
  /** The ticket. Absent only for a run triggered without one. */
  issue: Issue | undefined;
  /** The run in flight on this task, when there is one. */
  run: LiveRunForIssue | undefined;
  /** working/queued while a run is in flight; null for a task merely touched recently. */
  phase: RunPhase | null;
  /** What the row is sorted and dated by: the run's start, or the last touch. */
  atMs: number;
}

export interface TicklerRecentTasks {
  items: TicklerRecentTask[];
  /** Live counts, taken before the cap — every live run is always a row. */
  working: number;
  queued: number;
  /** Tasks touched inside the window that the cap left out. */
  hidden: number;
  /**
   * Queued tasks past {@link TICKLER_RECENT_QUEUED_ROWS}, longest-waiting
   * last. Not in `items`: the pane folds them into one line that names them on
   * hover, so `queued` still agrees with what the pane accounts for.
   */
  queuedOverflow: TicklerRecentTask[];
}

/**
 * Queued rows the list draws before it folds the rest into one line.
 *
 * Live rows used to be uncapped on the reasoning that a run in flight is the
 * row most worth seeing. That holds for working runs, which are bounded by the
 * fleet. It does not hold for queued ones: a routine fan-out queues a run on
 * every ticket it touches, and seventeen of them took every row the list had —
 * nothing touched today was left, and the queue the board exists for sat under
 * a pane of identical waiting rows (PLI-274). A queued run has no agent on it,
 * so past the first few it is a count, not a row.
 */
export const TICKLER_RECENT_QUEUED_ROWS = 3;

/**
 * How many rows the list draws before it starts holding tasks back. Comfortably
 * more than the pane's capped height shows, because the pane scrolls: the cap is
 * here to bound the work, and a list that ended exactly where the fold is would
 * have nothing to scroll to.
 */
export const TICKLER_RECENT_LIMIT = 16;

/**
 * What the cap becomes with Recent expanded: twice the rows, so twice the list.
 *
 * The pane is given roughly double the rail's height when Portfolio and
 * Routines fold (see `railPanes`), and a doubled pane fed the same sixteen
 * rows would simply run out of list halfway down its new height.
 */
export const TICKLER_RECENT_EXPANDED_LIMIT = TICKLER_RECENT_LIMIT * 2;

/**
 * Which rail panes the reader has expanded.
 *
 * A flag per pane, not one slot. It was one slot until PLI-287, on the grounds
 * that both panes would be asking for the same freed height — and the price of
 * that was that pressing Recent's toggle with Orgs expanded collapsed Orgs, so
 * the Recent header the reader was pointing at jumped up the rail by however
 * many org rows had just gone. A press should change the page from where the
 * pointer is, and never move the thing under it.
 *
 * So each press does only its own job. Either one folds Portfolio and Routines.
 * With both, Orgs keeps exactly the height it had, and Recent switches to the
 * week and grows only into what is below it — Routines, then Portfolio, leave
 * the rail to pay for it — never into Orgs, above the pointer. See `railPanes`
 * for how that is spelled.
 *
 * Only these two are expandable. Queue is not in the rail; Portfolio and
 * Routines are the panes that get folded, and both already stop at an ideal they
 * reach on any ordinary screen — there is nothing under their fold to expand
 * into.
 */
export interface TicklerExpandedPanes {
  orgs: boolean;
  recent: boolean;
}

export const TICKLER_NO_EXPANDED_PANES: TicklerExpandedPanes = { orgs: false, recent: false };

/**
 * Which panes are expanded. Per browser, like every other board preference.
 *
 * Holds "orgs", "recent", "orgs,recent" or "none". The first two are what 0.12
 * through 0.17 wrote, so they read back unchanged; a version from before
 * PLI-287 reading "orgs,recent" sees nothing it knows and expands nothing.
 */
export const TICKLER_EXPANDED_PANE_STORAGE_KEY = "tickler.expandedPane";

/**
 * Whether Recent is expanded — 0.11's key, read once and only as a fallback.
 *
 * Superseded by {@link TICKLER_EXPANDED_PANE_STORAGE_KEY}, which can say "orgs"
 * as well. Still read so that a reader who expanded Recent before this version
 * opens with it expanded rather than having the preference silently dropped.
 */
export const TICKLER_RECENT_EXPANDED_STORAGE_KEY = "tickler.recentExpanded";

/**
 * Nothing expanded unless the reader has said otherwise.
 *
 * Anything unrecognised is nothing — including the name of a pane that is in the
 * rail but not expandable, and the name of one a later version dropped.
 */
export function normalizeExpandedPanes(
  value: string | null | undefined,
  legacyRecent?: string | null | undefined,
): TicklerExpandedPanes {
  // Only when the new key has never been written: an explicit "none" there is
  // the reader collapsing the pane, and must not be undone by the stale "on"
  // that the press left behind under the old key.
  if (value === null || value === undefined) return { orgs: false, recent: legacyRecent === "on" };
  const panes = new Set(value.split(","));
  return { orgs: panes.has("orgs"), recent: panes.has("recent") };
}

/** The stored form of {@link normalizeExpandedPanes}'s answer. */
export function serializeExpandedPanes(panes: TicklerExpandedPanes): string {
  const names = [panes.orgs && "orgs", panes.recent && "recent"].filter(Boolean);
  return names.length > 0 ? names.join(",") : "none";
}

/** How far back "recent" reaches for a task with no run on it. */
export const TICKLER_RECENT_WINDOW_MS = 24 * 60 * 60_000;

/**
 * How far back it reaches expanded, which is the whole of what expanding means.
 *
 * The first cut of the expand toggle doubled the pane's height and the row cap
 * and left this at a day, on the assumption that the cap was what bounded the
 * list. On a real board it is not: a day of activity is three or four tasks, so
 * Recent was already drawing every row it had, and a pane twice as tall drew
 * the same four rows against twice as much nothing — while the height the fold
 * freed went to the pane next to it. That was the whole of the bug behind
 * "expand only expands the orgs list".
 *
 * A week, because that is the next unit anybody thinks in and it is what makes
 * the list long enough to be worth the fold: the same board that has four
 * tasks in a day has twenty-eight in a week. The cap above is then what bounds
 * it again, which is where it belongs.
 */
export const TICKLER_RECENT_EXPANDED_WINDOW_MS = 7 * TICKLER_RECENT_WINDOW_MS;

/**
 * What the fleet is on, newest first: every live run, then the tasks touched
 * most recently behind them.
 *
 * Three ordering rules, in this order:
 *
 *   1. Live before idle. A run in flight is the only row that can change while
 *      you are looking at it.
 *   2. Working before queued. A run waiting on a runner has no agent on it yet,
 *      so it is a different thing to look at.
 *   3. Newest first inside each of those. "What just started" is the question
 *      this list answers; the queue answers "what has waited longest".
 *
 * One row per task, not per run: a retry queued behind a run still finishing is
 * one thing happening, and the working attempt is the one worth showing.
 * Working rows are never capped away — the header counts them, and a count
 * that disagreed with the list would be worse than a longer list. Queued rows
 * past {@link TICKLER_RECENT_QUEUED_ROWS} go to `queuedOverflow`, which the
 * pane draws as one counted line.
 */
export function recentTasks(
  entries: ReadonlyArray<{ company: Company; runs: ReadonlyArray<LiveRunForIssue>; issues: ReadonlyArray<Issue> }>,
  options: { nowMs: number; limit?: number; windowMs?: number },
): TicklerRecentTasks {
  const limit = options.limit ?? TICKLER_RECENT_LIMIT;
  const windowMs = options.windowMs ?? TICKLER_RECENT_WINDOW_MS;

  // Collapse the runs to one per task first, so a ticket with two active runs
  // takes one row and the phase counts describe rows rather than runs.
  const byTask = new Map<string, TicklerLiveEntry>();
  const unticketed: TicklerLiveEntry[] = [];
  for (const entry of flattenLiveRuns(entries)) {
    if (!entry.run.issueId) {
      unticketed.push(entry);
      continue;
    }
    const key = `${entry.company.id}:${entry.run.issueId}`;
    const held = byTask.get(key);
    // Working wins over queued; between two of the same phase, the latest
    // attempt is the one still moving.
    const phases = held ? PHASE_ORDER[entry.phase] - PHASE_ORDER[held.phase] : 0;
    if (!held || phases < 0 || (phases === 0 && entry.startedMs > held.startedMs)) {
      byTask.set(key, entry);
    }
  }
  const live = [...byTask.values(), ...unticketed].sort(
    (a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || b.startedMs - a.startedMs,
  );
  const liveTasks: TicklerRecentTask[] = live.map((entry) => ({
    key: entry.run.issueId ? `${entry.company.id}:${entry.run.issueId}` : entry.run.id,
    company: entry.company,
    issue: entry.issue,
    run: entry.run,
    phase: entry.phase,
    atMs: entry.startedMs,
  }));
  const working = live.filter((entry) => entry.phase === "working").length;
  const queued = live.length - working;
  const liveKeys = new Set(liveTasks.map((item) => item.key));
  // Working rows are all kept; queued ones past the first few fold away.
  const items = liveTasks.slice(0, working + TICKLER_RECENT_QUEUED_ROWS);
  const queuedOverflow = liveTasks.slice(working + TICKLER_RECENT_QUEUED_ROWS);

  // Everything else touched inside the window, newest first. A ticket with a
  // run on it is already a row above, so it is not repeated here.
  const idle: TicklerRecentTask[] = [];
  for (const { company, issues } of entries) {
    for (const issue of issues) {
      if (issue.hiddenAt || issue.archivedAt) continue;
      const key = `${company.id}:${issue.id}`;
      if (liveKeys.has(key)) continue;
      const atMs = epochMs(issue.lastActivityAt ?? issue.updatedAt);
      if (atMs === null || options.nowMs - atMs > windowMs) continue;
      idle.push({ key, company, issue, run: undefined, phase: null, atMs });
    }
  }
  idle.sort((a, b) => b.atMs - a.atMs);
  const room = Math.max(0, limit - items.length);
  return {
    items: [...items, ...idle.slice(0, room)],
    working,
    queued,
    hidden: Math.max(0, idle.length - room),
    queuedOverflow,
  };
}

export interface TicklerUpcomingRoutine {
  company: Company;
  routine: RoutineListItem;
  /** The enabled trigger that fires soonest. */
  trigger: RoutineListItem["triggers"][number];
  /** When it fires (epoch ms). */
  atMs: number;
  state: "overdue" | "failed" | "scheduled";
}

/**
 * One line per active routine with an enabled, scheduled trigger: the ones
 * that are late first (latest-overdue at the top), then everything else by
 * soonest. A routine whose last run failed keeps its place in time but is
 * marked, so the failure is visible without pushing it above things that are
 * actually late.
 */
export function upcomingRoutines(
  entries: ReadonlyArray<{ company: Company; routines: ReadonlyArray<RoutineListItem> }>,
  nowMs: number,
): TicklerUpcomingRoutine[] {
  const out: TicklerUpcomingRoutine[] = [];
  for (const { company, routines } of entries) {
    for (const routine of routines) {
      if (routine.status !== "active") continue;
      const soonest = (routine.triggers ?? [])
        .filter((trigger) => trigger.enabled && trigger.nextRunAt)
        .map((trigger) => ({ trigger, atMs: epochMs(trigger.nextRunAt as unknown as string) }))
        .filter((entry): entry is { trigger: typeof entry.trigger; atMs: number } => entry.atMs !== null)
        .sort((a, b) => a.atMs - b.atMs)[0];
      if (!soonest) continue;
      const { trigger, atMs } = soonest;
      const state: TicklerUpcomingRoutine["state"] =
        atMs < nowMs - TICKLER_ROUTINE_OVERDUE_GRACE_MS
          ? "overdue"
          : routine.lastRun?.status === "failed"
            ? "failed"
            : "scheduled";
      out.push({ company, routine, trigger, atMs, state });
    }
  }
  // Calendar order, Sunday through Saturday, then time of day — the rail reads
  // like a week's schedule rather than a countdown queue. Urgency has not been
  // lost: it moved into each row's colour and each company's summary line.
  out.sort((a, b) => {
    const aAt = new Date(a.atMs);
    const bAt = new Date(b.atMs);
    return (
      aAt.getDay() - bAt.getDay() ||
      aAt.getHours() * 60 + aAt.getMinutes() - (bAt.getHours() * 60 + bAt.getMinutes()) ||
      a.routine.title.localeCompare(b.routine.title)
    );
  });
  return out;
}

// ---------------------------------------------------------------------------
// Cron → cadence
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A wall-clock time the way the reader's locale writes one — "9:00 AM" rather
 * than the cron's own "09:00". The date is a throwaway carrier for the time.
 */
function clock(hour: number, minute: number): string {
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayList(field: string): string | null {
  if (field === "1-5") return "weekdays";
  if (field === "0,6" || field === "6,0") return "weekends";
  const days = field.split(",").map((part) => Number(part));
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 7)) return null;
  return days.map((day) => DAY_NAMES[day % 7]).join(", ");
}

/**
 * The common cron shapes in plain words — "daily 8:00 AM", "weekdays 9:30 AM",
 * "every 30m", "Mon 7:00 AM". Anything fancier returns null and the caller
 * falls back to the trigger's own label or the raw expression.
 */
export function describeCron(expression: string | null | undefined): string | null {
  if (!expression) return null;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  const every = (field: string) => (field.startsWith("*/") ? Number(field.slice(2)) : null);
  const num = (field: string) => (/^\d+$/.test(field) ? Number(field) : null);

  if (dom === "*" && mon === "*") {
    const everyMin = every(min);
    if (everyMin && hour === "*" && dow === "*") return `every ${everyMin}m`;
    const everyHour = every(hour);
    const minute = num(min);
    if (everyHour && minute !== null && dow === "*") return everyHour === 1 ? "hourly" : `every ${everyHour}h`;
    if (min === "*" && hour === "*" && dow === "*") return "every minute";
    if (hour === "*" && minute !== null && dow === "*") return "hourly";
    const hourNum = num(hour);
    if (minute !== null && hourNum !== null) {
      const time = clock(hourNum, minute);
      if (dow === "*") return `daily ${time}`;
      const days = dayList(dow);
      if (days) return `${days} ${time}`;
    }
  }
  if (mon === "*" && dow === "*") {
    const minute = num(min);
    const hourNum = num(hour);
    const day = num(dom);
    if (minute !== null && hourNum !== null && day !== null) return `monthly on the ${day} at ${clock(hourNum, minute)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cross-company projects (the third list on the left)
// ---------------------------------------------------------------------------

export interface TicklerProjectEntry {
  company: Company;
  project: Project;
  open: number;
  inProgress: number;
  blocked: number;
  /** Target date at local midnight (epoch ms), or null when the project has none. */
  dueMs: number | null;
  overdue: boolean;
}

function targetDateMs(targetDate: string | null): number | null {
  if (!targetDate) return null;
  // Date-only strings parse as UTC midnight; anchor to local midnight so
  // "due today" is today in the viewer's timezone.
  const [year, month, day] = targetDate.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day).getTime();
}

/**
 * Every unarchived project with open work, across companies: nearest target
 * date first (overdue leading), undated ones after by open count. Paused /
 * completed projects are skipped — they are not "what's in flight".
 */
export function upcomingProjects(
  entries: ReadonlyArray<{ company: Company; projects: ReadonlyArray<Project>; issues: ReadonlyArray<Issue> }>,
  nowMs: number,
): TicklerProjectEntry[] {
  const all: TicklerProjectEntry[] = [];
  for (const { company, projects, issues } of entries) {
    const counts = new Map<string, { open: number; inProgress: number; blocked: number }>();
    for (const issue of issues) {
      if (!issue.projectId || issue.status === "done" || issue.status === "cancelled") continue;
      const count = counts.get(issue.projectId) ?? { open: 0, inProgress: 0, blocked: 0 };
      count.open += 1;
      if (issue.status === "in_progress" || issue.status === "in_review") count.inProgress += 1;
      if (issue.status === "blocked") count.blocked += 1;
      counts.set(issue.projectId, count);
    }
    for (const project of projects) {
      if (project.archivedAt || project.status === "completed" || project.status === "cancelled") continue;
      const count = counts.get(project.id);
      if (!count) continue;
      const dueMs = targetDateMs(project.targetDate);
      all.push({ company, project, ...count, dueMs, overdue: dueMs !== null && dueMs < nowMs });
    }
  }
  all.sort((a, b) => {
    if (a.dueMs !== null && b.dueMs !== null && a.dueMs !== b.dueMs) return a.dueMs - b.dueMs;
    if ((a.dueMs === null) !== (b.dueMs === null)) return a.dueMs === null ? 1 : -1;
    return b.open - a.open || a.project.name.localeCompare(b.project.name);
  });
  return all;
}


// ---------------------------------------------------------------------------
// Portfolio: the projects rail as one chart rather than a list
// ---------------------------------------------------------------------------

/**
 * A project entry with its bar already split into the three segments the eye
 * reads, worst-first across every company.
 *
 * The list this replaces was never clicked — its value was always the bar. So
 * the bar is the row now: no folds, no per-company grouping, no deep links to
 * chase. `waiting` is the remainder, the work nobody has picked up, which the
 * old two-segment bar left as bare track and therefore never named.
 */
export interface TicklerPortfolioEntry extends TicklerProjectEntry {
  /** Open work that is neither moving nor blocked — untouched, not stuck. */
  waiting: number;
  /** How many days late, or null when the project is not overdue. */
  lateDays: number | null;
}

export interface TicklerPortfolio {
  entries: TicklerPortfolioEntry[];
  open: number;
  blocked: number;
  overdue: number;
}

/**
 * Trouble first: overdue projects by how late they are, then by how much of
 * the project is stuck, then by sheer size.
 *
 * Deliberately not the deadline order `upcomingProjects` returns. A chart read
 * at a glance must put the worst bar under the eye first; a list you scan for
 * a specific project wants chronology. This is now a chart.
 */
export function comparePortfolioEntries(a: TicklerPortfolioEntry, b: TicklerPortfolioEntry): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.overdue && b.overdue && a.lateDays !== b.lateDays) return (b.lateDays ?? 0) - (a.lateDays ?? 0);
  const stuck = (entry: TicklerPortfolioEntry) => (entry.open > 0 ? entry.blocked / entry.open : 0);
  if (stuck(a) !== stuck(b)) return stuck(b) - stuck(a);
  return b.open - a.open || a.project.name.localeCompare(b.project.name);
}

/**
 * Which question the chart is answering.
 *
 * "Trouble" is the chart's own reading — worst bar first, wherever it lives.
 * "Company" keeps the board's company order, which is the only way to read the
 * portfolio as a set of businesses rather than one undifferentiated backlog:
 * with the bars gathered, a company whose every project is stuck is visible as
 * a block of amber, which trouble-order scatters down the column.
 */
export type TicklerPortfolioSort = "trouble" | "company";

export const TICKLER_PORTFOLIO_SORT_STORAGE_KEY = "tickler.portfolioSort";

export function normalizePortfolioSort(value: string | null | undefined): TicklerPortfolioSort {
  return value === "company" ? "company" : "trouble";
}

export function derivePortfolio(
  items: ReadonlyArray<TicklerProjectEntry>,
  nowMs: number,
  context: { sort?: TicklerPortfolioSort; companies?: ReadonlyArray<Company> } = {},
): TicklerPortfolio {
  const sort = context.sort ?? "trouble";
  // The board's own order — watched first, then hot-first or the user's
  // sidebar order — so a company sits in the same place here as in the ledger.
  const rank = new Map((context.companies ?? []).map((company, index) => [company.id, index]));
  const entries = items
    .map((entry) => ({
      ...entry,
      // Clamped: in_review counts as in progress, so a stale snapshot can
      // briefly report more moving+blocked than open. A negative segment
      // would render as a bar wider than its track.
      waiting: Math.max(0, entry.open - entry.inProgress - entry.blocked),
      lateDays: entry.overdue && entry.dueMs !== null ? Math.floor((nowMs - entry.dueMs) / 86_400_000) : null,
    }))
    // Company order only decides which block a bar sits in; inside a company
    // the worst project still leads, so the chart reads the same way at both
    // scales.
    .sort((a, b) => {
      if (sort === "company") {
        const byCompany =
          (rank.get(a.company.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.company.id) ?? Number.MAX_SAFE_INTEGER);
        if (byCompany !== 0) return byCompany;
      }
      return comparePortfolioEntries(a, b);
    });
  return {
    entries,
    open: entries.reduce((sum, entry) => sum + entry.open, 0),
    blocked: entries.reduce((sum, entry) => sum + entry.blocked, 0),
    overdue: entries.filter((entry) => entry.overdue).length,
  };
}


/**
 * One group per company.
 *
 * `order` is the board's own company order — watched first, then hot-first or
 * the user's sidebar order — and the rails follow it so the same company sits
 * in the same place in every list on the page. Without it the rails would
 * order themselves by whichever company happened to hold the most urgent item,
 * and the three lists would disagree with the board and with each other.
 *
 * Companies absent from `order` keep their first-appearance position at the
 * end rather than being dropped.
 */
export interface TicklerCompanyGroup<T> {
  company: Company;
  items: T[];
}

export function groupByCompany<T extends { company: Company }>(
  items: ReadonlyArray<T>,
  order: ReadonlyArray<Company> = [],
): TicklerCompanyGroup<T>[] {
  const groups = new Map<string, TicklerCompanyGroup<T>>();
  for (const item of items) {
    const group = groups.get(item.company.id);
    if (group) group.items.push(item);
    else groups.set(item.company.id, { company: item.company, items: [item] });
  }
  const rank = new Map(order.map((company, index) => [company.id, index]));
  return [...groups.values()].sort(
    (a, b) => (rank.get(a.company.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.company.id) ?? Number.MAX_SAFE_INTEGER),
  );
}


// ---------------------------------------------------------------------------
// Routine cycle heat
// ---------------------------------------------------------------------------

/** A routine is "live" for the hour after it fires. */
export const TICKLER_ROUTINE_LIVE_MS = 60 * 60_000;
/** How far out a routine starts warming toward live. */
export const TICKLER_ROUTINE_APPROACH_MS = 24 * 60 * 60_000;
/** Approaching never quite reaches live, so a running routine still stands out. */
const APPROACH_CEILING = 0.85;

export type TicklerRoutinePhase = "running" | "overdue" | "approaching" | "resting";

export interface TicklerRoutineHeat {
  phase: TicklerRoutinePhase;
  /** 0 = at rest (muted grey), 1 = live. Drives the row's colour mix. */
  intensity: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Where a routine sits in its own cycle, as a single 0–1 number.
 *
 * The rail colours every row by this, so the *shape* of the week is visible
 * before any text is read: rows brighten toward live blue over the day before
 * they fire, burn full blue for the hour they run, then drop straight back to
 * muted grey.
 *
 * The drop is deliberately hard rather than a fade. A routine that has just
 * finished is finished — how it *went* is carried by its outcome mark, which
 * is a fact rather than a temperature, and a lingering glow would compete
 * with the rows that are genuinely about to fire.
 */
export function routineHeat(input: {
  nextAtMs: number | null;
  lastFiredAtMs: number | null;
  nowMs: number;
}): TicklerRoutineHeat {
  const { nextAtMs, lastFiredAtMs, nowMs } = input;

  const sinceFired = lastFiredAtMs === null ? null : nowMs - lastFiredAtMs;
  if (sinceFired !== null && sinceFired >= 0 && sinceFired < TICKLER_ROUTINE_LIVE_MS) {
    return { phase: "running", intensity: 1 };
  }

  const untilNext = nextAtMs === null ? null : nextAtMs - nowMs;
  // A schedule that should already have fired is the loudest thing this rail
  // reports. Without this it scores as "resting" — the dimmest row on screen —
  // because its next run is in the past and nothing is approaching.
  if (untilNext !== null && untilNext < -TICKLER_ROUTINE_OVERDUE_GRACE_MS) {
    return { phase: "overdue", intensity: 1 };
  }
  const approaching = untilNext !== null && untilNext >= 0 && untilNext < TICKLER_ROUTINE_APPROACH_MS
    ? clamp01(1 - untilNext / TICKLER_ROUTINE_APPROACH_MS) * APPROACH_CEILING
    : 0;

  return approaching === 0 ? { phase: "resting", intensity: 0 } : { phase: "approaching", intensity: approaching };
}

// ---------------------------------------------------------------------------
// Routine outcome
// ---------------------------------------------------------------------------

/**
 * How the routine's last run ended, as one mark the rail can render.
 *
 * `ok` is the quiet, colourless case — a tick and nothing more. The rest are
 * reasons to look, and each carries the issue to open so the mark is a way in
 * rather than just a verdict.
 */
export type TicklerRoutineOutcomeState = "ok" | "failed" | "blocked" | "working" | "skipped" | "never";

/**
 * The issue fields the outcome mark needs. Declared structurally because
 * `RoutineIssueSummary` is not re-exported from the shared package index;
 * this is the subset both `lastRun.linkedIssue` and `activeIssue` carry.
 */
export interface TicklerOutcomeIssue {
  id: string;
  identifier: string | null;
  title: string;
  status: string;
}

export interface TicklerRoutineOutcome {
  state: TicklerRoutineOutcomeState;
  /** Plain-language reading, used as the mark's tooltip. */
  label: string;
  /** The issue the run produced or stalled on, when there is one to open. */
  issue: TicklerOutcomeIssue | null;
}

const CLOSED = new Set(["done", "cancelled"]);

export function routineOutcome(routine: RoutineListItem): TicklerRoutineOutcome {
  const run = routine.lastRun;
  // The run's own linked issue first; `activeIssue` is the routine's current
  // one, which is the right fallback when the run only recorded an id.
  const issue = run?.linkedIssue ?? routine.activeIssue ?? null;
  if (!run) return { state: "never", label: "has not run yet", issue: null };

  switch (run.status) {
    case "failed":
      return {
        state: "failed",
        label: run.failureReason?.trim() ? `last run failed — ${run.failureReason.trim()}` : "last run failed",
        issue,
      };
    case "skipped":
    case "coalesced":
      return { state: "skipped", label: `last run ${run.status}`, issue };
    case "received":
      return { state: "working", label: "run received, not finished yet", issue };
    case "issue_created":
    case "completed":
    default: {
      if (issue && issue.status === "blocked") {
        return { state: "blocked", label: `blocked on ${issue.identifier ?? issue.title}`, issue };
      }
      if (run.status === "completed" || (issue && CLOSED.has(issue.status))) {
        return { state: "ok", label: "last run completed", issue };
      }
      return {
        state: "working",
        label: issue ? `working on ${issue.identifier ?? issue.title}` : "run in progress",
        issue,
      };
    }
  }
}


/**
 * The cadence with no day in it: a clock time, or an interval.
 *
 * The rail already has a weekday column, so this column must never also talk
 * about days — otherwise some rows read "Mon 9:00 AM" and others "9:00 AM"
 * and the column means two different things down its own length. Every row
 * answers exactly one question here: at what time, or how often.
 */
export function describeCronClock(expression: string | null | undefined): string | null {
  if (!expression) return null;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour] = parts;
  const every = (field: string) => (field.startsWith("*/") ? Number(field.slice(2)) : null);
  const num = (field: string) => (/^\d+$/.test(field) ? Number(field) : null);

  const everyMin = every(min);
  if (everyMin && hour === "*") return `every ${everyMin}m`;
  const everyHour = every(hour);
  if (everyHour) return everyHour === 1 ? "hourly" : `every ${everyHour}h`;
  // `* * * * *` is every minute, not hourly — only a fixed minute past each
  // hour is hourly.
  if (hour === "*") return min === "*" ? "every minute" : "hourly";

  const minute = num(min);
  const hourNum = num(hour);
  return minute !== null && hourNum !== null ? clock(hourNum, minute) : null;
}

/**
 * A trigger label worth showing beside the routine's own title.
 *
 * Trigger labels are often prose restating the routine ("Series release" under
 * "Series Content Release"), which reads as the row saying the same thing
 * twice. Only a label that adds something survives.
 */
export function distinctLabel(label: string | null | undefined, title: string): string | null {
  const text = label?.trim();
  if (!text) return null;
  const words = (value: string) =>
    new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const a = words(text);
  const b = words(title);
  if (a.size === 0) return null;
  // Word-subset, not substring: "Series release" is not a substring of
  // "Series Content Release" but says nothing the title has not already said.
  const subset = (small: Set<string>, large: Set<string>) => [...small].every((word) => large.has(word));
  return subset(a, b) || subset(b, a) ? null : text;
}


// ---------------------------------------------------------------------------
// Routine exceptions: the only routines worth a line
// ---------------------------------------------------------------------------

export type TicklerRoutineExceptionKind = "failed" | "overdue" | "blocked";

export interface TicklerRoutineException {
  item: TicklerUpcomingRoutine;
  kind: TicklerRoutineExceptionKind;
  /** Plain-language reading of what went wrong, from the run itself. */
  label: string;
  /** How late, in ms, for an overdue routine; null otherwise. */
  lateMs: number | null;
  issue: TicklerOutcomeIssue | null;
}

export interface TicklerRoutineExceptions {
  items: TicklerRoutineException[];
  /** Routines doing exactly what they should — counted, never listed. */
  healthy: number;
}

const EXCEPTION_ORDER: Record<TicklerRoutineExceptionKind, number> = { failed: 0, blocked: 1, overdue: 2 };

/**
 * Only the routines that want something: the last run failed, the run is
 * wedged on a blocked issue, or the trigger is past due and has not fired.
 *
 * A schedule you can predict is not information. The list this replaces spent
 * its whole height telling you that twenty routines will fire on time, which
 * is the one thing you already knew — and buried the two that broke. Healthy
 * routines are a number here, and when everything is healthy the block has
 * nothing to draw.
 */
export function routineExceptions(
  items: ReadonlyArray<TicklerUpcomingRoutine>,
  nowMs: number,
): TicklerRoutineExceptions {
  const out: TicklerRoutineException[] = [];
  for (const item of items) {
    const outcome = routineOutcome(item.routine);
    // Failure outranks lateness: a routine that failed an hour ago and is now
    // also overdue has one problem, not two, and the failure is the one that
    // says why.
    const kind: TicklerRoutineExceptionKind | null =
      outcome.state === "failed"
        ? "failed"
        : outcome.state === "blocked"
          ? "blocked"
          : item.state === "overdue"
            ? "overdue"
            : null;
    if (kind === null) continue;
    out.push({
      item,
      kind,
      label: outcome.label,
      lateMs: item.state === "overdue" ? Math.max(0, nowMs - item.atMs) : null,
      issue: outcome.issue,
    });
  }
  out.sort(
    (a, b) =>
      EXCEPTION_ORDER[a.kind] - EXCEPTION_ORDER[b.kind] ||
      (b.lateMs ?? 0) - (a.lateMs ?? 0) ||
      a.item.routine.title.localeCompare(b.item.routine.title),
  );
  return { items: out, healthy: items.length - out.length };
}
