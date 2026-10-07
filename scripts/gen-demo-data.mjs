/**
 * Generates `src/ui/demo/demo-data.json` — the fixture Tickler serves when demo
 * mode is on.
 *
 * Written as a generator rather than hand-typed JSON because the fixture has
 * to be *complete*: every pane reads eight endpoints, and a HUD demoed with
 * three issues and one agent looks like a prototype. Building it from tables
 * keeps the volume plausible (four companies, ~20 agents, ~70 tickets) while
 * the interesting states — a stalled run, an overdue routine, a critical
 * blocker, a red company — stay explicit and deliberate rather than emergent.
 *
 * Nothing here is derived from any real instance. Timestamps are relative
 * tokens (see `src/ui/demo/demo-time.ts`) so the fixture never goes stale.
 *
 *   node ./scripts/gen-demo-data.mjs
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/ui/demo/demo-data.json",
);

/** Deterministic ids keep diffs of the generated file readable. */
const id = (kind, key) => `demo-${kind}-${key}`;
const t = (offset) => `@t:${offset}`;
const d = (days) => `@d:${days}`;

/**
 * Decide-by and snooze per attention item, by the start of its subject title,
 * so the Decide-by grouping has something in every lane: one overdue item,
 * two due today, a working week, a couple of whenevers, two snoozed, and the
 * interactions left unsorted. Values follow the server's shape — a preset or
 * a calendar date for decideBy, an instant for snoozedUntil.
 */
const TRIAGE = [
  ["Ledger reconciliation drifts", { decideBy: d(-1) }],
  ["Quill needs sign-off", { decideBy: "today" }],
  ["Payout rails is at 99%", { decideBy: "today" }],
  ["Pickers drop their route", { decideBy: "this_week" }],
  ["Warehouse cost attribution", { decideBy: "this_week" }],
  ["Settlement file parser", { decideBy: "this_week" }],
  ["Pick path regression harness", { decideBy: "whenever" }],
  ["Export to CSV truncates", { decideBy: "whenever" }],
  ["Nightly telemetry rollup", { snoozedUntil: t("+18h") }],
  ["Weekly pricing review", { snoozedUntil: t("+72h") }],
];
function triageFor(title) {
  const found = TRIAGE.find(([prefix]) => (title ?? "").startsWith(prefix))?.[1] ?? {};
  return { decideBy: found.decideBy ?? null, snoozedUntil: found.snoozedUntil ?? null };
}

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const COMPANIES = [
  {
    key: "acme",
    name: "Acme Robotics",
    prefix: "ACME",
    description: "Warehouse automation — pickers, routing, fleet telemetry.",
    budgetCents: 400_000,
    spentCents: 231_400,
  },
  {
    key: "globex",
    name: "Globex Analytics",
    prefix: "GLBX",
    description: "Customer data platform and reporting suite.",
    budgetCents: 250_000,
    spentCents: 188_900,
  },
  {
    key: "initech",
    name: "Initech Payments",
    prefix: "INIT",
    description: "Merchant payouts, ledger, and reconciliation.",
    budgetCents: 300_000,
    spentCents: 297_500,
  },
  {
    key: "umbra",
    name: "Umbra Logistics",
    prefix: "UMBR",
    description: "Freight brokerage and lane pricing.",
    budgetCents: 150_000,
    spentCents: 41_200,
  },
];

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

const AGENTS = {
  acme: [
    ["Ada", "ceo", "Chief Executive", "active"],
    ["Boris", "cto", "Chief Technology Officer", "active"],
    ["Cleo", "engineer", "Staff Engineer, Fleet", "running"],
    ["Dev", "engineer", "Engineer, Routing", "running"],
    ["Esme", "qa", "QA Lead", "running"],
    ["Fitz", "devops", "Platform Engineer", "idle"],
    ["Gwen", "pm", "Product Manager", "active"],
  ],
  globex: [
    ["Hollis", "ceo", "Chief Executive", "active"],
    ["Iris", "cto", "Chief Technology Officer", "active"],
    ["Jonas", "engineer", "Engineer, Ingest", "running"],
    ["Kira", "designer", "Product Designer", "idle"],
    ["Lorne", "researcher", "Data Researcher", "running"],
    ["Mabel", "qa", "QA Engineer", "idle"],
  ],
  initech: [
    ["Nadia", "ceo", "Chief Executive", "active"],
    ["Otto", "cto", "Chief Technology Officer", "active"],
    ["Prim", "engineer", "Engineer, Ledger", "error"],
    ["Quill", "engineer", "Engineer, Payouts", "running"],
    ["Rune", "security", "Security Engineer", "running"],
    ["Sable", "devops", "Platform Engineer", "paused"],
  ],
  umbra: [
    ["Tamsin", "ceo", "Chief Executive", "active"],
    ["Ulric", "engineer", "Engineer, Pricing", "idle"],
    ["Vera", "pm", "Product Manager", "active"],
  ],
};

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

const PROJECTS = {
  acme: [
    ["Fleet Telemetry", "in_progress", "#4f9cf9"],
    ["Pick Path Optimizer", "in_progress", "#f97316"],
    ["Warehouse Onboarding", "planned", "#22c55e"],
  ],
  globex: [
    ["Ingest Pipeline v3", "in_progress", "#a855f7"],
    ["Report Builder", "in_progress", "#06b6d4"],
  ],
  initech: [
    ["Ledger Reconciliation", "in_progress", "#ef4444"],
    ["Payout Rails", "in_progress", "#eab308"],
    ["PCI Readiness", "planned", "#64748b"],
  ],
  umbra: [
    ["Lane Pricing Model", "in_progress", "#14b8a6"],
  ],
};

// ---------------------------------------------------------------------------
// Issues — [title, status, priority, projectIndex, agentIndex, updatedOffset]
// ---------------------------------------------------------------------------

const ISSUES = {
  acme: [
    ["Backfill telemetry gaps for the Denver fleet", "in_progress", "high", 0, 2, "-6m"],
    ["Pickers drop their route when the dock scanner reconnects", "blocked", "critical", 1, 3, "-22m"],
    ["Add p95 latency panel to the fleet dashboard", "in_progress", "medium", 0, 2, "-48m"],
    ["Route solver times out above 400 stops", "in_progress", "high", 1, 3, "-14m"],
    ["Nightly telemetry rollup is running twice", "todo", "medium", 0, 5, "-3h"],
    ["Document the onboarding checklist for new sites", "in_review", "low", 2, 6, "-5h"],
    ["Flaky test: dock handoff integration suite", "in_progress", "medium", 1, 4, "-11m"],
    ["Retire the legacy telemetry ingest endpoint", "backlog", "low", 0, 1, "-2d"],
    ["Charging bay allocation ignores maintenance holds", "todo", "high", 1, 3, "-7h"],
    ["Fleet map renders stale positions after a tab sleep", "done", "medium", 0, 2, "-90m"],
    ["Add alerting for scanner firmware drift", "todo", "medium", 2, 5, "-1d"],
    ["Warehouse 12 site survey write-up", "done", "low", 2, 6, "-4h"],
    ["Pick path regression harness", "in_review", "high", 1, 4, "-35m"],
    ["Telemetry retention policy needs a decision", "blocked", "medium", 0, 1, "-9h"],
  ],
  globex: [
    ["Ingest v3 dedupe drops late-arriving rows", "in_progress", "critical", 0, 2, "-9m"],
    ["Report builder: saved views lose their filters", "in_progress", "high", 1, 4, "-27m"],
    ["Schema drift detector for partner feeds", "todo", "medium", 0, 2, "-2h"],
    ["Export to CSV truncates at 65k rows", "in_review", "high", 1, 5, "-1h"],
    ["Warehouse cost attribution is off by tenant", "blocked", "high", 0, 4, "-6h"],
    ["Dark mode contrast pass on the report canvas", "todo", "low", 1, 3, "-3d"],
    ["Backfill partner feed for Q2", "in_progress", "medium", 0, 2, "-52m"],
    ["Retire the v1 ingest shim", "backlog", "low", 0, 1, "-5d"],
    ["Add row-level lineage to the report builder", "todo", "medium", 1, 3, "-2d"],
    ["Ingest worker OOMs on wide partner schemas", "in_progress", "critical", 0, 4, "-18m"],
    ["Quarterly data quality review", "done", "medium", 0, 5, "-8h"],
  ],
  initech: [
    ["Ledger reconciliation drifts on multi-currency payouts", "blocked", "critical", 0, 2, "-31m"],
    ["Payout retries double-charge on a partial failure", "in_progress", "critical", 1, 3, "-4m"],
    ["Settlement file parser rejects the new bank format", "in_progress", "high", 0, 3, "-17m"],
    ["Rotate the payout signing keys", "todo", "high", 2, 4, "-1d"],
    ["Reconciliation report is unreadable above 10k rows", "todo", "medium", 0, 2, "-3h"],
    ["Audit log retention for PCI", "in_review", "high", 2, 4, "-2h"],
    ["Merchant onboarding webhook drops retries", "in_progress", "medium", 1, 3, "-44m"],
    ["Ledger snapshot job needs a dead-letter queue", "todo", "medium", 0, 5, "-6h"],
    ["Decide on the ledger partitioning strategy", "blocked", "high", 0, 1, "-12h"],
    ["Payout rails runbook", "done", "low", 1, 3, "-7h"],
    ["Sandbox merchant data reset script", "backlog", "low", 2, 4, "-4d"],
  ],
  umbra: [
    ["Lane pricing model overfits on short hauls", "in_progress", "high", 0, 1, "-2h"],
    ["Broker portal quote expiry is off by a timezone", "todo", "medium", 0, 1, "-1d"],
    ["Weekly pricing review write-up", "done", "low", 0, 2, "-20h"],
    ["Backhaul lane coverage gaps", "backlog", "medium", 0, 1, "-6d"],
  ],
};

// ---------------------------------------------------------------------------
// Live runs — [agentIndex, issueIndex, status, narration, lastSignOffset]
// ---------------------------------------------------------------------------

const RUNS = {
  acme: [
    [2, 0, "running", "Backfilling 14 of 31 telemetry partitions — Denver is the slow one.", "-40s"],
    [3, 3, "running", "Profiling the solver; the blowup starts around 380 stops.", "-2m"],
    [4, 6, "running", "Re-running the dock handoff suite for the fifth time to catch the flake.", "-25m"],
    [3, 1, "queued", null, null],
  ],
  globex: [
    [2, 0, "running", "Reproduced the drop with a 90-second late arrival window.", "-15s"],
    [4, 9, "running", "Heap dump captured. The wide-schema path allocates per row.", "-4m"],
  ],
  initech: [
    [3, 1, "running", "Adding an idempotency key to the payout retry path.", "-55s"],
    [4, 5, "running", "Drafting the audit log retention policy against the PCI checklist.", "-8m"],
    [3, 2, "queued", null, null],
    [2, 0, "running", null, "-38m"],
  ],
  umbra: [],
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const companyId = (key) => id("company", key);
const agentId = (key, i) => id("agent", `${key}-${i}`);
const projectId = (key, i) => id("project", `${key}-${i}`);
const issueId = (key, i) => id("issue", `${key}-${i}`);

function buildCompany(spec) {
  return {
    id: companyId(spec.key),
    name: spec.name,
    description: spec.description,
    status: "active",
    pauseReason: null,
    pausedAt: null,
    issuePrefix: spec.prefix,
    issueCounter: (ISSUES[spec.key] ?? []).length,
    budgetMonthlyCents: spec.budgetCents,
    spentMonthlyCents: spec.spentCents,
    defaultResponsibleUserId: null,
    requireBoardApprovalForNewAgents: false,
    interactionResolverGovernance: "agents_and_humans",
    feedbackDataSharingEnabled: false,
    feedbackDataSharingConsentAt: null,
    feedbackDataSharingConsentByUserId: null,
    feedbackDataSharingTermsVersion: null,
    logoAssetId: null,
    logoUrl: null,
    createdAt: t("-400d"),
    updatedAt: t("-2h"),
  };
}

function buildAgents(key) {
  return (AGENTS[key] ?? []).map(([name, role, title, status], i) => ({
    id: agentId(key, i),
    companyId: companyId(key),
    name,
    urlKey: name.toLowerCase(),
    role,
    title,
    icon: null,
    status,
    reportsTo: i === 0 ? null : agentId(key, 0),
    capabilities: null,
    adapterType: "claude_local",
    adapterConfig: {},
    // Only the CEO carries a heartbeat: it is the one Tickler watches, and the
    // fixture keeps Initech's stale so the "CEO overdue" row has something to
    // render in a walkthrough.
    runtimeConfig:
      role === "ceo" ? { heartbeat: { enabled: true, intervalSec: 3600 } } : {},
    defaultEnvironmentId: null,
    budgetMonthlyCents: 50_000,
    spentMonthlyCents: 12_000 + i * 3_100,
    pauseReason: status === "paused" ? "manual" : null,
    pausedAt: status === "paused" ? t("-3d") : null,
    errorReason: status === "error" ? "Adapter login expired" : null,
    permissions: {},
    lastHeartbeatAt:
      role === "ceo" ? (key === "initech" ? t("-190m") : t("-12m")) : null,
    metadata: null,
    createdAt: t("-380d"),
    updatedAt: t("-30m"),
  }));
}

function buildProjects(key) {
  return (PROJECTS[key] ?? []).map(([name, status, color], i) => ({
    id: projectId(key, i),
    companyId: companyId(key),
    urlKey: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    goalId: null,
    goalIds: [],
    goals: [],
    name,
    description: null,
    status,
    leadAgentId: agentId(key, 1),
    targetDate: d(21 + i * 14),
    color,
    icon: null,
    env: null,
    pauseReason: null,
    pausedAt: null,
    executionWorkspacePolicy: null,
    codebase: { kind: "none" },
    workspaces: [],
    primaryWorkspace: null,
    taskCount: (ISSUES[key] ?? []).filter((issue) => issue[3] === i).length,
    budget: null,
    archivedAt: null,
    createdAt: t("-200d"),
    updatedAt: t("-4h"),
  }));
}

function buildIssues(key, prefix) {
  return (ISSUES[key] ?? []).map(([title, status, priority, projectIdx, agentIdx, updated], i) => ({
    id: issueId(key, i),
    companyId: companyId(key),
    identifier: `${prefix}-${100 + i}`,
    title,
    description: null,
    status,
    priority,
    projectId: projectId(key, projectIdx),
    assigneeAgentId: agentId(key, agentIdx),
    creatorAgentId: agentId(key, 0),
    creatorUserId: null,
    parentIssueId: null,
    estimate: null,
    dueDate: null,
    labels: [],
    workMode: "standard",
    reviewPolicy: "anyone",
    startedAt: status === "backlog" || status === "todo" ? null : t("-2d"),
    completedAt: status === "done" ? t(updated) : null,
    createdAt: t(`-${3 + i}d`),
    updatedAt: t(updated),
  }));
}

function buildRuns(key) {
  return (RUNS[key] ?? []).map(([agentIdx, issueIdx, status, narration, lastSign], i) => ({
    id: id("run", `${key}-${i}`),
    status,
    invocationSource: "assignment",
    triggerDetail: null,
    contextCommentId: null,
    contextWakeCommentId: null,
    startedAt: status === "queued" ? null : t(lastSign === "-38m" ? "-72m" : "-26m"),
    finishedAt: null,
    createdAt: t("-80m"),
    agentId: agentId(key, agentIdx),
    agentName: AGENTS[key][agentIdx][0],
    adapterType: "claude_local",
    logBytes: 48_120,
    lastOutputBytes: 2_140,
    issueId: issueId(key, issueIdx),
    livenessReason: null,
    continuationAttempt: 0,
    // A run with no recent sign of life is what the capacity strip draws as
    // "stalled"; Acme's flaky-test run and Initech's ledger run are the two
    // deliberately quiet ones.
    lastUsefulActionAt: lastSign ? t(lastSign) : null,
    nextAction: null,
    currentStatusMessage: narration ? null : "startup step: acp.handshake (1788ms)",
    currentStatusUpdatedAt: lastSign ? t(lastSign) : null,
    currentToolName: narration ? "Edit" : null,
    lastAssistantSnippet: narration,
    lastEventAt: lastSign ? t(lastSign) : null,
  }));
}

/** Seven days of run activity, shaped so the sparkline has a visible story. */
function buildRunActivity(shape) {
  return shape.map(([succeeded, failed], i) => ({
    date: d(i - 6),
    succeeded,
    failed,
    recovered: 0,
    other: 0,
    total: succeeded + failed,
    failedByErrorCode: failed ? { provider_quota: failed } : {},
  }));
}

const RUN_ACTIVITY = {
  acme: [[18, 1], [24, 0], [21, 2], [29, 1], [26, 0], [31, 1], [17, 0]],
  globex: [[12, 0], [9, 1], [14, 0], [11, 3], [16, 1], [13, 0], [8, 1]],
  initech: [[22, 2], [19, 4], [25, 3], [14, 9], [18, 6], [21, 5], [12, 7]],
  umbra: [[4, 0], [3, 0], [5, 0], [2, 0], [6, 0], [4, 0], [3, 0]],
};

// ---------------------------------------------------------------------------
// Approvals + attention
// ---------------------------------------------------------------------------

const APPROVALS = {
  acme: [],
  globex: [
    ["hire_agent", "Hire a second ingest engineer to clear the partner feed backlog.", "-3h"],
  ],
  initech: [
    ["budget_override_required", "Payout rails is at 99% of its monthly budget with 6 days left.", "-40m"],
    ["approve_ceo_strategy", "Q3 plan: pause PCI Readiness until reconciliation is stable.", "-5h"],
  ],
  umbra: [],
};

function buildApprovals(key) {
  return (APPROVALS[key] ?? []).map(([type, summary, at], i) => ({
    id: id("approval", `${key}-${i}`),
    companyId: companyId(key),
    type,
    requestedByAgentId: agentId(key, 0),
    requestedByUserId: null,
    status: "pending",
    payload: { summary },
    decisionNote: null,
    decidedByUserId: null,
    decidedAt: null,
    createdAt: t(at),
    updatedAt: t(at),
  }));
}

/**
 * Attention rows — [sourceKind, severity, whyNow, issueIndex|null, at].
 *
 * These drive the Need-you columns, the queue buckets and pane health, so the
 * mix per company is chosen rather than random: Initech carries the criticals
 * that make it read red, Umbra carries none so a green pane is also on show.
 */
const ATTENTION = {
  acme: [
    ["issue_thread_interaction", "high", "Cleo asked which retention window to apply before backfilling.", 0, "-6m"],
    ["blocker_attention", "critical", "Pickers drop routes on scanner reconnect — blocked for 3 days.", 1, "-22m"],
    ["review", "medium", "Pick path regression harness is waiting on review.", 12, "-35m"],
    ["decision", "medium", "Telemetry retention policy needs a decision to unblock two tickets.", 13, "-9h"],
    ["failed_run", "low", "Nightly telemetry rollup failed once overnight.", 4, "-7h"],
  ],
  globex: [
    ["approval", "high", "Hiring approval is waiting on you.", null, "-3h"],
    ["issue_thread_interaction", "high", "Jonas needs a call on how to treat late-arriving duplicates.", 0, "-9m"],
    ["blocker_attention", "high", "Cost attribution is blocked on a tenant mapping you own.", 4, "-6h"],
    ["review", "medium", "CSV export fix is ready for review.", 3, "-1h"],
  ],
  initech: [
    ["approval", "critical", "Budget override needed — payout rails is at 99%.", null, "-40m"],
    ["approval", "high", "CEO strategy change is waiting on board approval.", null, "-5h"],
    ["blocker_attention", "critical", "Multi-currency reconciliation drift is blocking the close.", 0, "-31m"],
    ["issue_thread_interaction", "critical", "Quill needs sign-off before shipping the retry idempotency fix.", 1, "-4m"],
    ["agent_error_alert", "high", "Prim's adapter login expired — no work is moving on the ledger.", null, "-2h"],
    ["failed_run", "high", "Settlement parser failed 4 times in a row.", 2, "-17m"],
    ["decision", "medium", "Ledger partitioning strategy is still undecided.", 8, "-12h"],
  ],
  umbra: [
    ["review", "low", "Weekly pricing review is ready to read.", 2, "-20h"],
  ],
};

function buildAttention(key, prefix) {
  const issues = ISSUES[key] ?? [];
  const approvals = APPROVALS[key] ?? [];
  let approvalCursor = 0;
  const items = (ATTENTION[key] ?? []).map((row, i) => {
    const [sourceKind, severity, whyNow, issueIdx, at] = row;
    const relatedIssue =
      issueIdx === null
        ? null
        : {
            kind: "issue",
            id: issueId(key, issueIdx),
            companyId: companyId(key),
            title: issues[issueIdx][0],
            identifier: `${prefix}-${100 + issueIdx}`,
            status: issues[issueIdx][1],
            href: null,
          };
    const subject =
      sourceKind === "approval"
        ? {
            kind: "approval",
            id: id("approval", `${key}-${approvalCursor++}`),
            companyId: companyId(key),
            title: approvals[approvalCursor - 1]?.[1] ?? "Approval",
            identifier: null,
            status: "pending",
            href: null,
          }
        : sourceKind === "issue_thread_interaction"
          ? {
              kind: "interaction",
              id: id("interaction", `${key}-${i}`),
              companyId: companyId(key),
              title: whyNow,
              identifier: null,
              status: "pending",
              href: null,
              metadata: { issueId: relatedIssue?.id },
            }
          : (relatedIssue ?? {
              kind: "agent",
              id: agentId(key, 2),
              companyId: companyId(key),
              title: whyNow,
              identifier: null,
              status: "error",
              href: null,
            });

    return {
      id: id("attention", `${key}-${i}`),
      companyId: companyId(key),
      sourceKind,
      subject,
      whyNow,
      decisionVerbs: [],
      inlineResolvable: sourceKind === "issue_thread_interaction",
      entryRule: "demo",
      exitRule: "demo",
      dedupKey: `demo:${key}:${i}`,
      dismissalKey: `demo:${key}:${i}`,
      dismissal: null,
      severity,
      rank: i,
      activityAt: t(at),
      createdAt: t(at),
      updatedAt: t(at),
      relatedIssue,
      project: null,
      workspace: null,
      expiresAt: null,
      ruleKey: null,
      originAgentName: AGENTS[key][Math.min(2, AGENTS[key].length - 1)][0],
      queues: [],
      shelf: false,
      retentionDays: 30,
      keep: false,
      archivedAt: null,
      retentionVersion: 1,
      decideBy: triageFor(subject.title).decideBy,
      decideByAttribution: null,
      snoozedUntil: triageFor(subject.title).snoozedUntil,
      detail: null,
      trainingExampleId: null,
    };
  });

  const countsBySourceKind = {};
  for (const item of items) {
    countsBySourceKind[item.sourceKind] = (countsBySourceKind[item.sourceKind] ?? 0) + 1;
  }

  return {
    companyId: companyId(key),
    generatedAt: t("0"),
    totalCount: items.length,
    deskBadgeCount: items.filter((item) => item.severity === "critical" || item.severity === "high").length,
    nextCursor: null,
    countsBySourceKind,
    items,
  };
}

// ---------------------------------------------------------------------------
// Routines — [title, nextRunOffset, lastResult, lastRunStatus]
// ---------------------------------------------------------------------------

const ROUTINES = {
  acme: [
    ["Nightly telemetry rollup", "+7h", "ok", "succeeded"],
    ["Weekly fleet health digest", "+3d", "ok", "succeeded"],
  ],
  globex: [
    ["Partner feed freshness check", "+35m", "ok", "succeeded"],
    ["Daily data quality sweep", "+14h", "error", "failed"],
  ],
  initech: [
    // Deliberately in the past: this is what an overdue routine looks like,
    // and it is the only way that row in the queue can be demonstrated.
    ["Hourly ledger snapshot", "-95m", "error", "failed"],
    ["Daily settlement import", "+5h", "ok", "succeeded"],
  ],
  umbra: [
    ["Weekly lane pricing refresh", "+2d", "ok", "succeeded"],
  ],
};

function buildRoutines(key, prefix) {
  const issues = ISSUES[key] ?? [];
  return (ROUTINES[key] ?? []).map(([title, next, lastResult, lastStatus], i) => ({
    id: id("routine", `${key}-${i}`),
    companyId: companyId(key),
    title,
    description: null,
    status: "active",
    projectId: projectId(key, 0),
    assigneeAgentId: agentId(key, 1),
    parentIssueId: null,
    createdAt: t("-120d"),
    updatedAt: t("-1d"),
    triggers: [
      {
        id: id("trigger", `${key}-${i}`),
        kind: "schedule",
        label: "Schedule",
        enabled: true,
        cronExpression: "0 * * * *",
        timezone: "UTC",
        nextRunAt: t(next),
        lastFiredAt: t("-2h"),
        lastResult,
      },
    ],
    lastRun: {
      id: id("routine-run", `${key}-${i}`),
      companyId: companyId(key),
      routineId: id("routine", `${key}-${i}`),
      triggerId: id("trigger", `${key}-${i}`),
      source: "schedule",
      status: lastStatus,
      triggeredAt: t("-2h"),
      idempotencyKey: null,
      triggerPayload: null,
      dispatchFingerprint: null,
      linkedIssueId: null,
      coalescedIntoRunId: null,
      failureReason: lastStatus === "failed" ? "Upstream export was not ready" : null,
      completedAt: t("-115m"),
      createdAt: t("-2h"),
      updatedAt: t("-115m"),
      linkedIssue:
        issues.length > 4
          ? { id: issueId(key, 4), identifier: `${prefix}-104`, title: issues[4][0], status: issues[4][1] }
          : null,
      trigger: { id: id("trigger", `${key}-${i}`), kind: "schedule", label: "Schedule" },
    },
    activeIssue: null,
  }));
}

// ---------------------------------------------------------------------------
// Finished runs with token usage — the Orgs pane's hourly strip (PLI-278)
// ---------------------------------------------------------------------------

/**
 * Fresh tokens (thousands) per hour, oldest first, last 24h. Shaped so the
 * strip has something to say: Acme is steady, Globex had one big spike
 * overnight, Initech trickles, Umbra has used nothing at all.
 */
const USAGE_SHAPE = {
  acme: [0, 0, 120, 80, 0, 0, 0, 0, 60, 140, 210, 180, 90, 0, 150, 160, 0, 0, 70, 0, 110, 95, 40, 30],
  globex: [0, 40, 1900, 4200, 900, 0, 0, 0, 0, 0, 0, 80, 0, 0, 0, 0, 120, 0, 0, 0, 0, 0, 60, 0],
  initech: [0, 0, 0, 0, 0, 0, 30, 0, 0, 0, 0, 0, 45, 0, 0, 0, 0, 0, 0, 25, 0, 0, 0, 0],
  umbra: [],
};

function buildUsageRuns(key) {
  const runs = [];
  (USAGE_SHAPE[key] ?? []).forEach((thousands, index) => {
    if (thousands === 0) return;
    // Mid-hour, so the run lands in the same bar whatever minute the demo opens.
    const minutesAgo = (23 - index) * 60 + 30;
    const fresh = thousands * 1_000;
    runs.push({
      id: id("usage-run", `${key}-${index}`),
      createdAt: t(`-${minutesAgo + 6}m`),
      startedAt: t(`-${minutesAgo + 6}m`),
      finishedAt: t(`-${minutesAgo}m`),
      status: "succeeded",
      usageJson: {
        inputTokens: Math.round(fresh * 0.82),
        outputTokens: Math.round(fresh * 0.18),
        cachedInputTokens: fresh * 15,
        billingType: "subscription_included",
        costUsd: 0,
      },
    });
  });
  // Newest first, like the endpoint.
  return runs.reverse();
}

// ---------------------------------------------------------------------------
// Costs + dashboard + timeline
// ---------------------------------------------------------------------------

function buildCosts(key) {
  return (AGENTS[key] ?? []).map(([name], i) => ({
    agentId: agentId(key, i),
    agentName: name,
    agentStatus: AGENTS[key][i][3],
    costCents: 4_100 + i * 2_350,
    inputTokens: 1_840_000 + i * 610_000,
    cachedInputTokens: 920_000 + i * 240_000,
    outputTokens: 128_000 + i * 41_000,
    apiRunCount: 44 + i * 12,
    subscriptionRunCount: 0,
    subscriptionCachedInputTokens: 0,
    subscriptionInputTokens: 0,
    subscriptionOutputTokens: 0,
  }));
}

function buildDashboard(key, spec, agents, issues, approvals) {
  const byStatus = (status) => issues.filter((issue) => issue.status === status).length;
  return {
    companyId: companyId(key),
    agents: {
      active: agents.filter((agent) => agent.status !== "terminated" && agent.status !== "paused").length,
      running: agents.filter((agent) => agent.status === "running").length,
      paused: agents.filter((agent) => agent.status === "paused").length,
      error: agents.filter((agent) => agent.status === "error").length,
    },
    tasks: {
      open: byStatus("todo") + byStatus("backlog"),
      inProgress: byStatus("in_progress") + byStatus("in_review"),
      blocked: byStatus("blocked"),
      done: byStatus("done"),
    },
    costs: {
      monthSpendCents: spec.spentCents,
      monthBudgetCents: spec.budgetCents,
      monthUtilizationPercent: Math.round((spec.spentCents / spec.budgetCents) * 100),
    },
    pendingApprovals: approvals.length,
    budgets: {
      // Initech is the fixture's unhealthy company: an active incident is what
      // pushes its pane to red regardless of severity mix.
      activeIncidents: key === "initech" ? 1 : 0,
      pendingApprovals: approvals.length,
      pausedAgents: agents.filter((agent) => agent.status === "paused").length,
      pausedProjects: 0,
    },
    runActivity: buildRunActivity(RUN_ACTIVITY[key]),
  };
}

/** The briefing only reads `spans[].status`, so the timeline stays minimal. */
function buildTimeline(key) {
  const failed = key === "initech" ? 3 : key === "globex" ? 1 : 0;
  return {
    actors: [],
    spans: Array.from({ length: failed }, (_, i) => ({
      id: id("span", `${key}-${i}`),
      status: "failed",
    })),
    events: [],
    edges: [],
    pagination: { limit: 200, offset: 0, totalIssues: (ISSUES[key] ?? []).length, hasMore: false },
    window: { from: t("-24h"), to: t("0"), capped: false },
  };
}

// ---------------------------------------------------------------------------
// Interactions — the inline question cards the queue can answer
// ---------------------------------------------------------------------------

const INTERACTIONS = {
  acme: [
    [0, "Which retention window should the backfill apply?", ["90 days (current policy)", "180 days", "Keep everything"]],
  ],
  globex: [
    [0, "How should late-arriving duplicates be treated?", ["Last write wins", "First write wins", "Flag for review"]],
  ],
  initech: [
    [1, "Ship the retry idempotency fix straight to production?", ["Ship it", "Stage first", "Hold for review"]],
  ],
  umbra: [],
};

function buildInteractions(key) {
  const out = {};
  (INTERACTIONS[key] ?? []).forEach(([issueIdx, question, options], i) => {
    const interactionId = id("interaction", `${key}-${i}`);
    out[issueId(key, issueIdx)] = [
      {
        id: interactionId,
        issueId: issueId(key, issueIdx),
        companyId: companyId(key),
        kind: "ask_user_questions",
        status: "pending",
        createdByAgentId: agentId(key, 2),
        createdByUserId: null,
        summaryMarkdown: null,
        payload: {
          questions: [
            {
              id: `${interactionId}-q1`,
              prompt: question,
              options: options.map((label, oi) => ({ id: `${interactionId}-o${oi}`, label })),
              multiSelect: false,
            },
          ],
        },
        createdAt: t("-6m"),
        updatedAt: t("-6m"),
        resolvedAt: null,
      },
    ];
  });
  return out;
}

// ---------------------------------------------------------------------------
// Assemble
// ---------------------------------------------------------------------------

const fixture = {
  version: 1,
  session: {
    user: { id: id("user", "demo"), name: "Dana Reyes", email: "dana@example.com" },
    session: { userId: id("user", "demo") },
  },
  companyOrder: COMPANIES.map((spec) => companyId(spec.key)),
  companies: COMPANIES.map(buildCompany),
  byCompany: {},
  interactionsByIssue: {},
  issuesByApproval: {},
};

for (const spec of COMPANIES) {
  const { key, prefix } = { key: spec.key, prefix: spec.prefix };
  const agents = buildAgents(key);
  const issues = buildIssues(key, prefix);
  const approvals = buildApprovals(key);
  const attention = buildAttention(key, prefix);

  fixture.byCompany[companyId(key)] = {
    dashboard: buildDashboard(key, spec, agents, issues, approvals),
    liveRuns: buildRuns(key),
    heartbeatRuns: buildUsageRuns(key),
    projects: buildProjects(key),
    issues,
    agents,
    approvals,
    attention,
    routines: buildRoutines(key, prefix),
    costsByAgent: buildCosts(key),
    timeline: buildTimeline(key),
    sidebarBadges: {
      inbox: attention.items.length,
      approvals: approvals.length,
      failedRuns: key === "initech" ? 4 : 0,
      joinRequests: 0,
    },
  };

  Object.assign(fixture.interactionsByIssue, buildInteractions(key));
  approvals.forEach((approval, i) => {
    fixture.issuesByApproval[approval.id] = issues.slice(i, i + 2);
  });
}

writeFileSync(OUT, `${JSON.stringify(fixture, null, 2)}\n`);
console.log(
  `wrote ${path.relative(process.cwd(), OUT)} — ` +
    `${fixture.companies.length} companies, ` +
    `${Object.values(fixture.byCompany).reduce((n, c) => n + c.issues.length, 0)} issues, ` +
    `${Object.values(fixture.byCompany).reduce((n, c) => n + c.agents.length, 0)} agents`,
);
