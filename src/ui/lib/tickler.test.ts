import { describe, expect, it } from "vitest";
import { ATTENTION_SOURCE_KINDS } from "@paperclipai/shared";
import type {
  Approval,
  AttentionFeed,
  AttentionItem,
  Company,
  DashboardRunActivityDay,
  DashboardSummary,
  Project,
  Issue,
} from "@paperclipai/shared";
import {
  TICKLER_TOKEN_DEFAULTS,
  attentionActionLabel,
  attentionAskText,
  attentionHeadline,
  attentionIssueId,
  attentionRowTitle,
  attentionSpecificText,
  currentMonthRange,
  deriveActionable,
  deriveBriefingLine,
  deriveCeoHeartbeat,
  deriveCompanyStats,
  derivePaneHealth,
  deriveRoutineHealth,
  detectAlertEdges,
  formatAgeMinutes,
  formatCents,
  formatCountdown,
  formatTokens,
  healthLabel,
  intervalLabel,
  issueStatusLabel,
  normalizePinnedIds,
  normalizeSortMode,
  normalizeTokenSettings,
  pruneClosedIssueAttention,
  partitionHotFirst,
  relativeTimeLabel,
  selectCeo,
  shouldShowBriefing,
  sparklineDays,
  sumAgentTokens,
  thresholdsFor,
  tokenState,
  type TicklerAlertSnapshot,
  deriveHeat,
  deriveThroughput,
  formatTokensMillions,
  TICKLER_HEAT_MAX,
  deriveNeedsBreakdown,
} from "./tickler";

function summaryWith(overrides: {
  errorAgents?: number;
  incidents?: number;
  pendingApprovals?: number;
}): DashboardSummary {
  return {
    companyId: "c1",
    agents: { active: 3, running: 1, paused: 0, error: overrides.errorAgents ?? 0 },
    tasks: { open: 4, inProgress: 2, blocked: 0, done: 10 },
    costs: { monthSpendCents: 500, monthBudgetCents: 10_000, monthUtilizationPercent: 5 },
    pendingApprovals: overrides.pendingApprovals ?? 0,
    budgets: {
      activeIncidents: overrides.incidents ?? 0,
      pendingApprovals: overrides.pendingApprovals ?? 0,
      pausedAgents: 0,
      pausedProjects: 0,
    },
    runActivity: [],
  };
}

describe("derivePaneHealth", () => {
  it("is green when nothing is wrong", () => {
    expect(derivePaneHealth(summaryWith({}))).toBe("green");
  });
  it("is amber when approvals are pending", () => {
    expect(derivePaneHealth(summaryWith({ pendingApprovals: 2 }))).toBe("amber");
  });
  it("is red on budget incident or errored agents, beating amber", () => {
    expect(derivePaneHealth(summaryWith({ incidents: 1, pendingApprovals: 2 }))).toBe("red");
    expect(derivePaneHealth(summaryWith({ errorAgents: 1 }))).toBe("red");
  });
  it("is green while summary is undefined (loading)", () => {
    expect(derivePaneHealth(undefined)).toBe("green");
  });
});


describe("formatCents", () => {
  it("formats cents as dollars", () => {
    expect(formatCents(12_345)).toBe("$123.45");
    expect(formatCents(500_00)).toBe("$500");
    expect(formatCents(0)).toBe("$0");
  });
});

describe("issueStatusLabel", () => {
  it("title-cases snake_case statuses", () => {
    expect(issueStatusLabel("in_progress")).toBe("In Progress");
    expect(issueStatusLabel("todo")).toBe("Todo");
  });
});

describe("deriveCeoHeartbeat", () => {
  const NOW = new Date("2026-07-28T12:00:00Z").getTime();
  const ceo = (overrides: Record<string, unknown>) =>
    ({
      id: "agent-ceo",
      role: "ceo",
      status: "active",
      lastHeartbeatAt: new Date("2026-07-28T11:50:00Z"),
      runtimeConfig: { heartbeat: { enabled: true, intervalSec: 1800 } },
      ...overrides,
    }) as never;

  it("is ok when the last beat is within 1.5x the interval", () => {
    expect(deriveCeoHeartbeat(ceo({}), NOW).state).toBe("ok");
  });

  it("is overdue when the last beat is older than 1.5x the interval", () => {
    const stale = ceo({ lastHeartbeatAt: new Date("2026-07-28T10:00:00Z") });
    expect(deriveCeoHeartbeat(stale, NOW).state).toBe("overdue");
  });

  it("is off when heartbeat is disabled, agent paused, missing config, or never beat", () => {
    expect(deriveCeoHeartbeat(ceo({ runtimeConfig: { heartbeat: { enabled: false, intervalSec: 1800 } } }), NOW).state).toBe("off");
    expect(deriveCeoHeartbeat(ceo({ status: "paused" }), NOW).state).toBe("off");
    expect(deriveCeoHeartbeat(ceo({ runtimeConfig: {} }), NOW).state).toBe("off");
    expect(deriveCeoHeartbeat(ceo({ lastHeartbeatAt: null }), NOW).state).toBe("off");
    expect(deriveCeoHeartbeat(undefined, NOW).state).toBe("off");
  });
});

describe("selectCeo", () => {
  it("returns the first agent with role ceo, or undefined", () => {
    const agents = [
      { id: "a1", role: "engineer" },
      { id: "a2", role: "ceo" },
      { id: "a3", role: "ceo" },
    ] as never[];
    expect((selectCeo(agents) as { id: string } | undefined)?.id).toBe("a2");
    expect(selectCeo([{ id: "a1", role: "engineer" }] as never[])).toBeUndefined();
  });
});


describe("healthLabel", () => {
  it("names the reason, not just the color", () => {
    const summary = {
      agents: { error: 2 },
      budgets: { activeIncidents: 1 },
      pendingApprovals: 3,
    } as never;
    expect(healthLabel("red", summary)).toBe("Health: red — 1 incident, 2 agent errors");
    expect(healthLabel("amber", summary)).toBe("Health: amber — 3 approvals pending");
    expect(healthLabel("green", summary)).toBe("Health: green — all clear");
    expect(healthLabel("red", undefined)).toBe("Health: red — unreachable");
  });
});


describe("pruneClosedIssueAttention", () => {
  const item = (id: string, subject: Record<string, unknown>): AttentionItem =>
    ({
      id,
      companyId: "c1",
      sourceKind: "issue_thread_interaction",
      severity: "medium",
      rank: 0,
      whyNow: "",
      dismissal: null,
      subject: { kind: "interaction", id, companyId: "c1", title: null, identifier: null, status: "pending", href: null, ...subject },
    }) as never;
  const feed = (items: AttentionItem[]): AttentionFeed =>
    ({ companyId: "c1", generatedAt: "", totalCount: items.length, countsBySourceKind: {}, items }) as never;
  const issues = [
    { id: "i-open", status: "in_review" },
    { id: "i-done", status: "done" },
    { id: "i-cancelled", status: "cancelled" },
  ] as Issue[];

  it("finds the issue behind a subject, whether it is the subject or in its metadata", () => {
    expect(attentionIssueId(item("a", { kind: "issue", id: "i-1" }))).toBe("i-1");
    expect(attentionIssueId(item("b", { metadata: { issueId: "i-2" } }))).toBe("i-2");
    expect(attentionIssueId(item("c", {}))).toBeNull();
    expect(attentionIssueId(item("d", { metadata: { issueId: 7 } }))).toBeNull();
  });

  it("drops interactions whose issue is done or cancelled and keeps the rest", () => {
    const pruned = pruneClosedIssueAttention(
      feed([
        item("open", { metadata: { issueId: "i-open" } }),
        item("done", { metadata: { issueId: "i-done" } }),
        item("cancelled", { kind: "issue", id: "i-cancelled" }),
        item("unknown", { metadata: { issueId: "i-not-listed" } }),
        item("none", {}),
      ]),
      issues,
    );
    expect(pruned?.items.map((entry) => entry.id)).toEqual(["open", "unknown", "none"]);
  });

  it("returns the same feed reference when nothing is pruned", () => {
    const untouched = feed([item("open", { metadata: { issueId: "i-open" } })]);
    expect(pruneClosedIssueAttention(untouched, issues)).toBe(untouched);
    expect(pruneClosedIssueAttention(untouched, [])).toBe(untouched);
    expect(pruneClosedIssueAttention(undefined, issues)).toBeUndefined();
  });
});

describe("attention headline / ask / action", () => {
  const interaction = (kind: string, title: string, detail: Record<string, unknown> | null): AttentionItem =>
    ({
      id: "x",
      companyId: "c1",
      sourceKind: "issue_thread_interaction",
      severity: "medium",
      rank: 0,
      whyNow: "",
      dismissal: null,
      subject: { kind: "interaction", id: "int", companyId: "c1", title, identifier: null, status: "pending", href: null, metadata: { kind, issueId: "i-1" } },
      detail,
    }) as never;
  const issue = { title: "Fall class registration" } as Issue;

  it("prefers the issue title over a generic interaction label, but keeps a specific one", () => {
    expect(attentionHeadline(interaction("ask_user_questions", "Questions need answers", null), issue)).toBe("Fall class registration");
    expect(attentionHeadline(interaction("ask_user_questions", "Questions need answers", null), null)).toBe("Questions need answers");
    expect(attentionHeadline(interaction("ask_user_questions", "Pick a fall class", null), issue)).toBe("Pick a fall class");
  });

  it("surfaces the question, the prompt, or the blocker as the ask line", () => {
    expect(attentionAskText(interaction("ask_user_questions", "t", { kind: "questions", questionCount: 3, firstQuestionText: "Which class?" }), "t")).toBe("3 questions · Which class?");
    expect(attentionAskText(interaction("ask_user_questions", "t", { kind: "questions", questionCount: 1, firstQuestionText: "Which class?" }), "t")).toBe("Which class?");
    expect(attentionAskText(interaction("request_confirmation", "t", { kind: "confirmation", promptExcerpt: "Ship it?" }), "t")).toBe("Ship it?");
    expect(attentionAskText(interaction("request_confirmation", "Ship it?", { kind: "confirmation", promptExcerpt: "Ship it?" }), "Ship it?")).toBeNull();
    expect(attentionAskText(interaction("x", "t", { kind: "blocker", blockingIssue: { identifier: "ACM-3", title: "CPA sign-off" } }), "t")).toBe("blocked by ACM-3 CPA sign-off");
    expect(attentionAskText(interaction("x", "t", null), "t")).toBeNull();
  });

  it("labels the link with the verb the interaction wants", () => {
    expect(attentionActionLabel(interaction("ask_user_questions", "t", null))).toBe("Answer");
    expect(attentionActionLabel(interaction("request_confirmation", "t", null))).toBe("Confirm");
    expect(attentionActionLabel(interaction("suggest_tasks", "t", null))).toBe("Decide");
    expect(attentionActionLabel(interaction("something_new", "t", null))).toBe("Reply");
    expect(attentionActionLabel({ ...interaction("x", "t", null), sourceKind: "blocker_attention" })).toBe("Open");
  });
});

describe("deriveActionable", () => {
  const attention = (items: Array<{ severity: string; dismissed?: boolean }>): AttentionFeed =>
    ({
      companyId: "c1",
      generatedAt: "",
      totalCount: items.length,
      countsBySourceKind: {},
      items: items.map((item, index) => ({
        id: `att-${index}`,
        companyId: "c1",
        sourceKind: "blocker_attention",
        severity: item.severity,
        rank: index,
        whyNow: "",
        dismissal: item.dismissed ? { dismissedAt: "2026-07-28T00:00:00Z" } : null,
        subject: { kind: "issue", id: `i${index}`, companyId: "c1", title: null, identifier: null, status: null, href: null },
      })),
    }) as never;

  it("counts approvals, undismissed attention items, and an overdue CEO", () => {
    const approvals = [{ id: "a1" }, { id: "a2" }] as Approval[];
    const result = deriveActionable({
      approvals,
      attention: attention([{ severity: "low" }, { severity: "medium", dismissed: true }]),
      ceoOverdue: true,
    });
    // 2 approvals + 1 undismissed attention item + 1 for the overdue CEO
    expect(result.count).toBe(4);
    expect(result.criticalOrHigh).toBe(false);
  });

  it("flags criticalOrHigh when any undismissed attention item is critical or high", () => {
    expect(
      deriveActionable({ approvals: [], attention: attention([{ severity: "critical" }]), ceoOverdue: false })
        .criticalOrHigh,
    ).toBe(true);
    expect(
      deriveActionable({ approvals: [], attention: attention([{ severity: "high" }]), ceoOverdue: false })
        .criticalOrHigh,
    ).toBe(true);
    expect(
      deriveActionable({
        approvals: [],
        attention: attention([{ severity: "critical", dismissed: true }]),
        ceoOverdue: false,
      }).criticalOrHigh,
    ).toBe(false);
  });

  it("is zero/false with no data", () => {
    expect(deriveActionable({ approvals: [], attention: undefined, ceoOverdue: false })).toEqual({
      criticalOrHigh: false,
      count: 0,
    });
  });
});


describe("labels", () => {
  const NOW = new Date("2026-07-28T12:00:00Z").getTime();
  it("renders relative time and interval labels", () => {
    expect(relativeTimeLabel("2026-07-28T11:48:00Z", NOW)).toBe("12m ago");
    expect(relativeTimeLabel("2026-07-28T09:00:00Z", NOW)).toBe("3h ago");
    expect(intervalLabel(1800)).toBe("every 30m");
    expect(intervalLabel(7200)).toBe("every 2h");
    expect(intervalLabel(null)).toBeNull();
  });
});


describe("sparklineDays", () => {
  const day = (date: string, succeeded: number, failed: number): DashboardRunActivityDay =>
    ({ date, succeeded, failed, recovered: 0, other: 0, total: succeeded + failed }) as DashboardRunActivityDay;

  it("keeps only the trailing `count` days", () => {
    const runActivity = Array.from({ length: 10 }, (_, i) => day(`2026-07-${10 + i}`, 1, 0));
    expect(sparklineDays(runActivity, 7)).toHaveLength(7);
    expect(sparklineDays(runActivity, 7)[0].date).toBe("2026-07-13");
  });

  it("scales bar heights to the busiest day in the window", () => {
    const runActivity = [day("2026-07-27", 5, 5), day("2026-07-28", 10, 0)];
    const [d1, d2] = sparklineDays(runActivity, 7);
    expect(d2.succeededHeightPct).toBe(100);
    expect(d1.succeededHeightPct).toBe(50);
    expect(d1.failedHeightPct).toBe(50);
  });

  it("marks a zero-activity day as no activity with zero heights", () => {
    const [d] = sparklineDays([day("2026-07-28", 0, 0)], 7);
    expect(d.hasActivity).toBe(false);
    expect(d.succeededHeightPct).toBe(0);
    expect(d.failedHeightPct).toBe(0);
  });

  it("builds the tooltip title text", () => {
    const [d] = sparklineDays([day("2026-07-28", 12, 1)], 7);
    expect(d.title).toBe(`${d.label}: 12 ok, 1 failed`);
    expect(d.title).toContain("12 ok, 1 failed");
  });
});

describe("detectAlertEdges", () => {
  const snap = (overrides: Partial<TicklerAlertSnapshot> = {}): TicklerAlertSnapshot => ({
    health: "green",
    criticalAttentionIds: [],
    ceoOverdue: false,
    ...overrides,
  });

  it("returns no events on the first (baseline) snapshot", () => {
    expect(detectAlertEdges(null, snap({ health: "red", ceoOverdue: true, criticalAttentionIds: ["a"] }))).toEqual(
      [],
    );
  });

  it("fires health_red only on the green/amber -> red transition", () => {
    expect(detectAlertEdges(snap({ health: "amber" }), snap({ health: "red" }))).toEqual([{ kind: "health_red" }]);
    // already red -> red is not a new transition
    expect(detectAlertEdges(snap({ health: "red" }), snap({ health: "red" }))).toEqual([]);
  });

  it("fires critical_attention only for newly appeared ids", () => {
    const prev = snap({ criticalAttentionIds: ["a"] });
    const next = snap({ criticalAttentionIds: ["a", "b", "c"] });
    expect(detectAlertEdges(prev, next)).toEqual([
      { kind: "critical_attention", detail: "b" },
      { kind: "critical_attention", detail: "c" },
    ]);
  });

  it("does not fire critical_attention for ids that disappear or stay", () => {
    const prev = snap({ criticalAttentionIds: ["a", "b"] });
    const next = snap({ criticalAttentionIds: ["a"] });
    expect(detectAlertEdges(prev, next)).toEqual([]);
  });

  it("fires ceo_overdue only on the transition to overdue", () => {
    expect(detectAlertEdges(snap({ ceoOverdue: false }), snap({ ceoOverdue: true }))).toEqual([
      { kind: "ceo_overdue" },
    ]);
    expect(detectAlertEdges(snap({ ceoOverdue: true }), snap({ ceoOverdue: true }))).toEqual([]);
  });

  it("can fire multiple edges in one comparison", () => {
    const prev = snap({ health: "green", criticalAttentionIds: [], ceoOverdue: false });
    const next = snap({ health: "red", criticalAttentionIds: ["x"], ceoOverdue: true });
    expect(detectAlertEdges(prev, next)).toEqual([
      { kind: "health_red" },
      { kind: "critical_attention", detail: "x" },
      { kind: "ceo_overdue" },
    ]);
  });
});

describe("shouldShowBriefing", () => {
  const now = new Date("2026-07-29T12:00:00.000Z").getTime();

  it("is false when there is no recorded last visit", () => {
    expect(shouldShowBriefing(null, now)).toBe(false);
  });

  it("is false when the last visit was under 30 minutes ago", () => {
    expect(shouldShowBriefing(new Date(now - 10 * 60_000).toISOString(), now)).toBe(false);
    expect(shouldShowBriefing(new Date(now - 29 * 60_000).toISOString(), now)).toBe(false);
  });

  it("is true when the last visit was more than 30 minutes ago", () => {
    expect(shouldShowBriefing(new Date(now - 31 * 60_000).toISOString(), now)).toBe(true);
    expect(shouldShowBriefing(new Date(now - 2 * 60 * 60_000).toISOString(), now)).toBe(true);
  });
});

describe("deriveBriefingLine", () => {
  const sinceIso = "2026-07-29T10:00:00.000Z";
  const before = "2026-07-29T09:00:00.000Z"; // before `since` — should not count
  const after = "2026-07-29T11:00:00.000Z"; // after `since` — should count

  it("returns all zeros for empty input", () => {
    expect(deriveBriefingLine({ sinceIso })).toEqual({ done: 0, blockers: 0, failedRuns: 0 });
    expect(deriveBriefingLine({ issues: [], timelineEntries: { spans: [] }, sinceIso })).toEqual({
      done: 0,
      blockers: 0,
      failedRuns: 0,
    });
  });

  it("counts failed and timed-out spans as failed runs, regardless of sinceIso", () => {
    const timelineEntries = {
      spans: [
        { status: "succeeded" },
        { status: "failed" },
        { status: "timed_out" },
        { status: "running" },
        { status: "cancelled" },
      ],
    };
    expect(deriveBriefingLine({ timelineEntries, sinceIso }).failedRuns).toBe(2);
  });

  it("counts issues currently done/blocked whose updatedAt is after sinceIso", () => {
    const issues = [
      { status: "done", updatedAt: after },
      { status: "done", updatedAt: after },
      { status: "blocked", updatedAt: after },
      { status: "done", updatedAt: before }, // stale — updated before the visit, doesn't count
      { status: "in_progress", updatedAt: after }, // wrong status — doesn't count
    ];
    expect(deriveBriefingLine({ issues, sinceIso })).toEqual({ done: 2, blockers: 1, failedRuns: 0 });
  });

  it("accepts updatedAt as either a Date or an ISO string", () => {
    const issues = [
      { status: "done", updatedAt: new Date(after) },
      { status: "blocked", updatedAt: after },
    ];
    expect(deriveBriefingLine({ issues, sinceIso })).toEqual({ done: 1, blockers: 1, failedRuns: 0 });
  });

  it("ignores issues with no updatedAt", () => {
    expect(deriveBriefingLine({ issues: [{ status: "done", updatedAt: undefined }], sinceIso })).toEqual({
      done: 0,
      blockers: 0,
      failedRuns: 0,
    });
  });

  it("treats an issue updated exactly at sinceIso as not-yet-changed (strictly after only)", () => {
    expect(deriveBriefingLine({ issues: [{ status: "done", updatedAt: sinceIso }], sinceIso })).toEqual({
      done: 0,
      blockers: 0,
      failedRuns: 0,
    });
  });

  it("combines issues and timeline spans in one summary", () => {
    const issues = [
      { status: "done", updatedAt: after },
      { status: "blocked", updatedAt: after },
    ];
    const timelineEntries = { spans: [{ status: "failed" }, { status: "failed" }] };
    expect(deriveBriefingLine({ issues, timelineEntries, sinceIso })).toEqual({ done: 1, blockers: 1, failedRuns: 2 });
  });
});

describe("pane ordering", () => {
  it("normalizes sort mode", () => {
    expect(normalizeSortMode("hot")).toBe("hot");
    expect(normalizeSortMode("junk")).toBe("manual");
    expect(normalizeSortMode(null)).toBe("manual");
  });

  it("partitions hot companies first, keeping relative order stable", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(partitionHotFirst(items, new Set(["c", "a"])).map((x) => x.id)).toEqual(["a", "c", "b", "d"]);
    expect(partitionHotFirst(items, new Set()).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });
});




describe("normalizePinnedIds", () => {
  it("round-trips a stored list", () => {
    expect(normalizePinnedIds(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("returns empty for junk, non-arrays, and absent values", () => {
    expect(normalizePinnedIds(null)).toEqual([]);
    expect(normalizePinnedIds("")).toEqual([]);
    expect(normalizePinnedIds("{oops")).toEqual([]);
    expect(normalizePinnedIds(JSON.stringify({ a: 1 }))).toEqual([]);
  });

  it("drops non-string entries rather than trusting the blob", () => {
    expect(normalizePinnedIds(JSON.stringify(["a", 3, null, "b"]))).toEqual(["a", "b"]);
  });
});




describe("sumAgentTokens", () => {
  it("returns 0 for missing or empty rows", () => {
    expect(sumAgentTokens(undefined)).toBe(0);
    expect(sumAgentTokens([])).toBe(0);
  });

  it("counts api and subscription columns together", () => {
    const rows = [
      {
        inputTokens: 10, cachedInputTokens: 5, outputTokens: 2,
        subscriptionInputTokens: 100, subscriptionCachedInputTokens: 50, subscriptionOutputTokens: 20,
      },
      { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 },
    ] as never;
    // 17 api + 170 subscription + 2 = 189
    expect(sumAgentTokens(rows)).toBe(189);
  });
});

describe("formatTokens", () => {
  it("scales to B/M/K and drops the decimal above 100M", () => {
    expect(formatTokens(1_190_000_000)).toBe("1.19B");
    expect(formatTokens(574_200_000)).toBe("574M");
    expect(formatTokens(99_300_000)).toBe("99.3M");
    expect(formatTokens(250_000)).toBe("250K");
    expect(formatTokens(42)).toBe("42");
  });

  it("treats absent or nonsense counts as zero rather than NaN", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(Number.NaN)).toBe("0");
  });
});

describe("tokenState", () => {
  const th = { warn: 250e6, crit: 500e6 };
  it("is exclusive at both bounds, so a threshold is a ceiling not a trigger", () => {
    expect(tokenState(250e6, th)).toBe("ok");
    expect(tokenState(250e6 + 1, th)).toBe("warn");
    expect(tokenState(500e6, th)).toBe("warn");
    expect(tokenState(500e6 + 1, th)).toBe("crit");
  });
});

describe("normalizeTokenSettings", () => {
  it("falls back to defaults for junk and absent values", () => {
    expect(normalizeTokenSettings(null)).toEqual({ defaults: TICKLER_TOKEN_DEFAULTS, overrides: {} });
    expect(normalizeTokenSettings("{oops")).toEqual({ defaults: TICKLER_TOKEN_DEFAULTS, overrides: {} });
  });

  it("round-trips defaults and overrides", () => {
    const raw = JSON.stringify({ defaults: { warn: 1, crit: 2 }, overrides: { c1: { warn: 3, crit: 4 } } });
    expect(normalizeTokenSettings(raw)).toEqual({ defaults: { warn: 1, crit: 2 }, overrides: { c1: { warn: 3, crit: 4 } } });
  });

  it("rejects thresholds that are not a usable pair", () => {
    // crit must sit above warn, and neither may be zero or negative
    const bad = JSON.stringify({
      defaults: { warn: 500, crit: 100 },
      overrides: { c1: { warn: 0, crit: 5 }, c2: { warn: "x", crit: 5 }, c3: { warn: 1, crit: 2 } },
    });
    const settings = normalizeTokenSettings(bad);
    expect(settings.defaults).toEqual(TICKLER_TOKEN_DEFAULTS);
    expect(settings.overrides).toEqual({ c3: { warn: 1, crit: 2 } });
  });
});

describe("thresholdsFor", () => {
  it("inherits the default when a company has no override", () => {
    const settings = { defaults: { warn: 1, crit: 2 }, overrides: { other: { warn: 9, crit: 10 } } };
    expect(thresholdsFor(settings, "c1")).toEqual({ warn: 1, crit: 2 });
    expect(thresholdsFor(settings, "other")).toEqual({ warn: 9, crit: 10 });
  });
});


describe("currentMonthRange", () => {
  it("runs from the first of the month to today", () => {
    expect(currentMonthRange(Date.UTC(2026, 7, 14, 9, 30))).toEqual({ from: "2026-08-01", to: "2026-08-14" });
  });
});

describe("deriveCompanyStats", () => {
  const now = Date.UTC(2026, 7, 14, 12, 0);
  const base = {
    summary: {
      agents: { active: 9, running: 6, paused: 0, error: 0 },
      tasks: { open: 30, inProgress: 23, blocked: 4, done: 0 },
    },
    tokens: 500,
    unavailable: false,
    nowMs: now,
  } as never;

  const feed = (items: Array<{ kind: string; severity: string; minsAgo?: number; dismissed?: boolean }>) =>
    ({
      items: items.map((item, index) => ({
        id: `a${index}`,
        sourceKind: item.kind,
        severity: item.severity,
        dismissal: item.dismissed ? { dismissedAt: "x" } : null,
        activityAt: item.minsAgo === undefined ? null : new Date(now - item.minsAgo * 60_000).toISOString(),
      })),
    }) as never;

  it("summarises agents, tasks, attention, criticals, failures and the oldest wait", () => {
    const stats = deriveCompanyStats({
      ...(base as object),
      attention: feed([
        { kind: "failed_run", severity: "critical", minsAgo: 41 },
        { kind: "failed_run", severity: "high", minsAgo: 12 },
        { kind: "approval", severity: "medium", minsAgo: 900 },
        { kind: "approval", severity: "critical", dismissed: true, minsAgo: 5 },
      ]),
    } as never);
    expect(stats).toMatchObject({
      running: 6, active: 9,
      tasksOpen: 30, tasksInProgress: 23, tasksBlocked: 4,
      needs: 3, critical: 1, failed: 2,
      oldestMins: 900, tokens: 500,
    });
  });

  it("reports no oldest wait when nothing is waiting", () => {
    expect(deriveCompanyStats({ ...(base as object), attention: feed([]) } as never).oldestMins).toBeNull();
  });

  it("ignores items with no timestamp rather than treating them as ancient", () => {
    const stats = deriveCompanyStats({
      ...(base as object),
      attention: feed([{ kind: "approval", severity: "low" }, { kind: "approval", severity: "low", minsAgo: 30 }]),
    } as never);
    expect(stats.needs).toBe(2);
    expect(stats.oldestMins).toBe(30);
  });
});

describe("formatAgeMinutes", () => {
  it("renders an em dash for nothing waiting, then m/h/d", () => {
    expect(formatAgeMinutes(null)).toBe("—");
    expect(formatAgeMinutes(18)).toBe("18m");
    expect(formatAgeMinutes(240)).toBe("4h");
    expect(formatAgeMinutes(2880)).toBe("2d");
  });
});









describe("deriveRoutineHealth", () => {
  const now = Date.UTC(2026, 7, 14, 12);
  const at = (mins: number) => new Date(now + mins * 60_000).toISOString();
  const routine = (over: Record<string, unknown> = {}) =>
    ({ id: "r", title: "Nightly report", status: "active", triggers: [], lastRun: null, ...over }) as never;

  it("counts nothing when a company has no routines", () => {
    expect(deriveRoutineHealth(undefined, now)).toMatchObject({ total: 0, active: 0, overdue: 0, nextRunAt: null });
  });

  it("separates active from paused and ignores archived entirely", () => {
    const health = deriveRoutineHealth(
      [routine(), routine({ status: "paused" }), routine({ status: "archived" })],
      now,
    );
    expect(health).toMatchObject({ total: 2, active: 1, paused: 1 });
  });

  it("reports the soonest upcoming run and which routine it belongs to", () => {
    const health = deriveRoutineHealth(
      [
        routine({ title: "Later", triggers: [{ enabled: true, nextRunAt: at(120) }] }),
        routine({ title: "Sooner", triggers: [{ enabled: true, nextRunAt: at(15) }] }),
      ],
      now,
    );
    expect(health.nextTitle).toBe("Sooner");
    expect(health.nextRunAt).toBe(at(15));
  });

  it("counts a trigger as overdue only once it is past the grace window", () => {
    const withinGrace = deriveRoutineHealth([routine({ triggers: [{ enabled: true, nextRunAt: at(-5) }] })], now);
    expect(withinGrace.overdue).toBe(0);
    // still counts as the next run, since it has not been written off yet
    expect(withinGrace.nextRunAt).toBe(at(-5));

    const past = deriveRoutineHealth([routine({ triggers: [{ enabled: true, nextRunAt: at(-45) }] })], now);
    expect(past.overdue).toBe(1);
    expect(past.nextRunAt).toBeNull();
  });

  it("ignores disabled triggers and paused routines when looking for overdue work", () => {
    const health = deriveRoutineHealth(
      [
        routine({ triggers: [{ enabled: false, nextRunAt: at(-500) }] }),
        routine({ status: "paused", triggers: [{ enabled: true, nextRunAt: at(-500) }] }),
      ],
      now,
    );
    expect(health.overdue).toBe(0);
  });

  it("counts a failed last run as failing", () => {
    const health = deriveRoutineHealth(
      [routine({ lastRun: { status: "failed" } }), routine({ lastRun: { status: "completed" } })],
      now,
    );
    expect(health.failing).toBe(1);
  });
});

describe("formatCountdown", () => {
  const now = Date.UTC(2026, 7, 14, 12);
  const at = (mins: number) => new Date(now + mins * 60_000).toISOString();

  it("renders an em dash when nothing is scheduled", () => {
    expect(formatCountdown(null, now)).toBe("—");
  });

  it("counts forward in m/h/d", () => {
    expect(formatCountdown(at(12), now)).toBe("in 12m");
    expect(formatCountdown(at(180), now)).toBe("in 3h");
    expect(formatCountdown(at(2880), now)).toBe("in 2d");
  });

  it("says now for anything already due", () => {
    expect(formatCountdown(at(0), now)).toBe("now");
    expect(formatCountdown(at(-5), now)).toBe("now");
  });
});





describe("attentionRowTitle", () => {
  const item = (over: Record<string, unknown>) =>
    ({ subject: { title: null }, whyNow: "questions need answers", detail: null, ...over }) as never;

  it("prefers the ticket title, the noun you recognise", () => {
    expect(attentionRowTitle(item({ subject: { title: "Migrate billing webhooks" } }))).toBe(
      "Migrate billing webhooks",
    );
  });

  it("falls back to the exact question rather than a count of them", () => {
    expect(
      attentionRowTitle(
        item({ detail: { kind: "questions", questionCount: 3, firstQuestionText: "Cap retry at 30s?" } }),
      ),
    ).toBe("Cap retry at 30s?");
  });

  it("uses the failure reason for a failed run", () => {
    expect(
      attentionRowTitle(item({ detail: { kind: "failed_run", failureReasonExcerpt: "OOM at 82%" } })),
    ).toBe("OOM at 82%");
  });

  it("names the blocking issue for a blocker", () => {
    expect(
      attentionRowTitle(item({ detail: { kind: "blocker", blockingIssue: { title: "Vendor creds" } } })),
    ).toBe("Vendor creds");
  });

  it("only reaches whyNow when the item carries nothing specific", () => {
    expect(attentionRowTitle(item({ detail: { kind: "questions", questionCount: 3, firstQuestionText: null } }))).toBe(
      "questions need answers",
    );
    expect(attentionRowTitle(item({}))).toBe("questions need answers");
  });

  it("treats a blank title or excerpt as absent rather than rendering emptiness", () => {
    expect(
      attentionRowTitle(
        item({ subject: { title: "   " }, detail: { kind: "questions", firstQuestionText: "  " } }),
      ),
    ).toBe("questions need answers");
  });
});


describe("deriveThroughput", () => {
  const day = (succeeded: number, failed: number, recovered = 0, other = 0) =>
    ({ date: "2026-08-01", succeeded, failed, recovered, other, total: succeeded + failed + recovered + other }) as never;

  it("reports runs a day over the window, with the failure split", () => {
    const result = deriveThroughput([day(3, 0), day(4, 1), day(2, 0), day(5, 2), day(1, 0), day(6, 1), day(0, 0)]);
    expect(result).toMatchObject({ succeeded: 21, failed: 4, total: 25, failRatePct: 16 });
    expect(result.perDay).toBeCloseTo(3.6, 5);
  });

  it("reads only the trailing window, however much history it is handed", () => {
    const days = Array.from({ length: 30 }, (_, index) => day(index, 0));
    expect(deriveThroughput(days).days).toHaveLength(7);
    // The last seven days are 23..29 — older history must not dilute the rate.
    expect(deriveThroughput(days).succeeded).toBe(23 + 24 + 25 + 26 + 27 + 28 + 29);
  });

  it("has no failure rate when nothing ran, rather than a misleading 0%", () => {
    expect(deriveThroughput([day(0, 0), day(0, 0)]).failRatePct).toBeNull();
    expect(deriveThroughput([]).failRatePct).toBeNull();
  });

  it("still divides by the full window when the company has less history than that", () => {
    expect(deriveThroughput([day(7, 0)]).perDay).toBeCloseTo(1, 5);
  });
});

describe("formatTokensMillions", () => {
  it("rounds millions for figures a person scans", () => {
    expect(formatTokensMillions(412_000_000)).toBe("412");
    expect(formatTokensMillions(1_500_000)).toBe("2");
  });

  it("keeps a decimal below a million so a quiet company does not read as zero", () => {
    expect(formatTokensMillions(400_000)).toBe("0.4");
  });

  it("treats nothing, negatives and junk as zero", () => {
    expect(formatTokensMillions(0)).toBe("0");
    expect(formatTokensMillions(-5)).toBe("0");
    expect(formatTokensMillions(Number.NaN)).toBe("0");
  });
});

describe("deriveHeat", () => {
  const calm: Parameters<typeof deriveHeat>[0] = {
    unavailable: false,
    criticalOrHigh: false,
    needs: 0,
    oldestMins: null,
    tasksBlocked: 0,
    stalled: 0,
    overLimit: 0,
    agentErrors: 0,
    decisionsOpen: 0,
    tokenState: "ok",
  };

  it("is zero for a company with nothing wrong", () => {
    expect(deriveHeat(calm)).toBe(0);
  });

  it("puts an unreachable company at the top even though it reports nothing else", () => {
    expect(deriveHeat({ ...calm, unavailable: true })).toBe(5);
  });

  it("ranks a company that is broken above one that is merely busy", () => {
    const broken = deriveHeat({ ...calm, agentErrors: 1 });
    const busy = deriveHeat({ ...calm, needs: 6 });
    expect(broken).toBeGreaterThan(busy);
  });

  it("ranks one long-ignored item above several fresh ones", () => {
    const stale = deriveHeat({ ...calm, needs: 1, oldestMins: 3 * 1440 });
    const fresh = deriveHeat({ ...calm, needs: 6, oldestMins: 5 });
    expect(stale).toBeGreaterThan(fresh);
  });

  it("counts a silent run, which no column on the board shows", () => {
    expect(deriveHeat({ ...calm, stalled: 2 })).toBeGreaterThan(0);
  });

  it("ranks a run past its time limit above a silent one", () => {
    expect(deriveHeat({ ...calm, overLimit: 1 })).toBeGreaterThan(deriveHeat({ ...calm, stalled: 1 }));
  });

  it("counts open decisions", () => {
    expect(deriveHeat({ ...calm, decisionsOpen: 1 })).toBeGreaterThan(0);
  });

  it("never exceeds the maximum however much is wrong at once", () => {
    expect(
      deriveHeat({
        unavailable: false,
        criticalOrHigh: true,
        needs: 20,
        oldestMins: 10 * 1440,
        tasksBlocked: 9,
        stalled: 4,
        overLimit: 2,
        agentErrors: 3,
        decisionsOpen: 2,
        tokenState: "crit",
      }),
    ).toBe(TICKLER_HEAT_MAX);
  });
});

describe("deriveNeedsBreakdown", () => {
  const feed = (items: Array<{ kind: string; dismissed?: boolean }>) =>
    ({
      items: items.map((item, index) => ({
        id: `d${index}`,
        sourceKind: item.kind,
        severity: "medium",
        dismissal: item.dismissed ? { dismissedAt: "x" } : null,
        activityAt: null,
      })),
    }) as never;

  it("splits the feed into the buckets the board has columns for", () => {
    expect(
      deriveNeedsBreakdown(
        feed([
          { kind: "issue_thread_interaction" },
          { kind: "issue_thread_interaction" },
          { kind: "blocker_attention" },
          { kind: "review" },
          { kind: "review" },
          { kind: "review" },
          { kind: "decision" },
          { kind: "failed_run" },
          { kind: "budget_alert" },
        ]),
      ),
    ).toEqual({ questions: 2, blocked: 1, review: 3, decisions: 1, other: 2 });
  });

  it("excludes approvals, which deriveActionable already counts", () => {
    const breakdown = deriveNeedsBreakdown(feed([{ kind: "approval" }, { kind: "approval" }, { kind: "review" }]));
    expect(breakdown.other).toBe(0);
    expect(breakdown.review).toBe(1);
  });

  it("ignores anything you have dismissed", () => {
    expect(
      deriveNeedsBreakdown(feed([{ kind: "review" }, { kind: "review", dismissed: true }])).review,
    ).toBe(1);
  });

  it("is all zeros, not a crash, with no feed at all", () => {
    expect(deriveNeedsBreakdown(undefined)).toEqual({ questions: 0, blocked: 0, review: 0, decisions: 0, other: 0 });
  });

  it("never totals more than the Need-you count it is a breakdown of", () => {
    // The columns are slices of Need-you: if these could exceed it, the board
    // would be showing more work than the rail says exists.
    const items = feed([
      { kind: "issue_thread_interaction" },
      { kind: "blocker_attention" },
      { kind: "review" },
      { kind: "decision" },
      { kind: "failed_run" },
      { kind: "approval" },
    ]);
    const breakdown = deriveNeedsBreakdown(items);
    const summed = breakdown.questions + breakdown.blocked + breakdown.review + breakdown.decisions + breakdown.other;
    const needs = deriveActionable({ approvals: [], attention: items, ceoOverdue: false });
    expect(summed).toBeLessThanOrEqual(needs.count);
  });
});

describe("deriveThroughput counts every run the day recorded", () => {
  const day = (succeeded: number, failed: number, recovered = 0, other = 0) =>
    ({ date: "2026-08-01", succeeded, failed, recovered, other, total: succeeded + failed + recovered + other }) as never;

  it("includes recovered and other, not just succeeded plus failed", () => {
    // A restart-killed run whose retry succeeded is real work; counting only
    // succeeded+failed would hide it and shrink the fail-rate denominator.
    const result = deriveThroughput([day(4, 1, 3, 2)]);
    expect(result.total).toBe(10);
    expect(result.failRatePct).toBe(10);
  });

  it("falls back to succeeded plus failed when a payload omits total", () => {
    const legacy = [{ date: "2026-08-01", succeeded: 3, failed: 1 }] as never;
    expect(deriveThroughput(legacy).total).toBe(4);
  });
});
