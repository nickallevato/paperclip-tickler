import { describe, expect, it } from "vitest";
import type { Agent, AttentionFeed, AttentionItem, Issue } from "@paperclipai/shared";
import { classifyInterruption, deriveUserInterruptions, readInterruption } from "./interruption";
import { decideLane, deriveQueueItems, queueItemKind } from "./queue";
import { deriveActionable } from "./tickler";

const issue = (id: string, interruption: unknown, status = "in_progress"): Issue =>
  ({ id, status, title: `Task ${id}`, identifier: id.toUpperCase(), updatedAt: "2026-11-09T10:00:00.000Z", interruption }) as never;
const waiting = (userAction: string | null) => ({
  responsibility: "user",
  state: "waiting_for_user",
  userAction,
  nextRetryAt: null,
  canRetry: false,
  intentId: null,
  sourceRunIds: [],
  observedRunId: null,
});
const system = (state: string, nextRetryAt: string | null = null) => ({ ...waiting(null), responsibility: "system", state, nextRetryAt });
const feed = (items: AttentionItem[]): AttentionFeed =>
  ({ companyId: "c1", generatedAt: "", totalCount: items.length, countsBySourceKind: {}, items }) as never;
const question = (issueId: string, dismissal: unknown = null): AttentionItem =>
  ({
    id: `att-${issueId}`,
    sourceKind: "issue_thread_interaction",
    severity: "high",
    dismissal,
    subject: { kind: "interaction", id: `int-${issueId}`, metadata: { issueId } },
  }) as never;

describe("classifyInterruption", () => {
  it("says what you have to do when the work waits on you", () => {
    const cases: Array<[string | null, string]> = [
      ["reconnect", "Interrupted · reconnect"],
      ["choose_model", "Interrupted · choose model"],
      ["assign_agent", "Interrupted · assign agent"],
      ["approval", "Interrupted · approval"],
      ["budget", "Interrupted · budget"],
      ["resume", "Interrupted · resume"],
      [null, "Interrupted · resume"],
    ];
    for (const [action, chip] of cases) {
      expect(classifyInterruption(issue("a", waiting(action))), String(action)).toMatchObject({ kind: "needs_you", chip });
    }
    expect(classifyInterruption(issue("a", waiting("reconnect")))?.title).toContain("Reconnect account");
  });

  it("keeps the host's own recovery quiet, with the next try in the tooltip", () => {
    const retrying = classifyInterruption(issue("a", system("retry_scheduled", "2026-11-09T10:04:00.000Z")));
    expect(retrying).toMatchObject({ kind: "recovering", chip: "Recovering" });
    expect(retrying?.title).toMatch(/Next try/);
    expect(classifyInterruption(issue("a", system("failed")))).toMatchObject({ kind: "recovery_failed", chip: "Recovery failed" });
  });

  it("shows nothing for a resolved interruption, a closed task, or a host without the field", () => {
    expect(classifyInterruption(issue("a", { ...waiting("reconnect"), state: "resolved" }))).toBeNull();
    expect(classifyInterruption(issue("a", system("resolved")))).toBeNull();
    // The host presents every run in progress as system/working, recovery or not.
    expect(classifyInterruption(issue("a", system("working")))).toBeNull();
    expect(classifyInterruption(issue("a", waiting("reconnect"), "done"))).toBeNull();
    expect(classifyInterruption(issue("a", waiting("reconnect"), "cancelled"))).toBeNull();
    expect(classifyInterruption(issue("a", null))).toBeNull();
    expect(classifyInterruption({ id: "a", status: "todo" } as Issue)).toBeNull();
    expect(readInterruption(issue("a", { responsibility: "nobody", state: "working" }))).toBeNull();
  });
});

describe("deriveUserInterruptions", () => {
  const issues = [
    issue("reconnect", waiting("reconnect")),
    issue("asked", waiting("choose_model")),
    issue("snoozed-ask", waiting("budget")),
    issue("retrying", system("retry_scheduled")),
    issue("fine", null),
  ];

  it("counts each task waiting on you once, leaving out those the feed already holds", () => {
    const found = deriveUserInterruptions(issues, feed([question("asked"), question("snoozed-ask", { kind: "dismiss" })]));
    expect(found.map(({ issue: entry }) => entry.id)).toEqual(["reconnect", "snoozed-ask"]);
  });

  it("adds them to Need-you, as high", () => {
    const attention = feed([question("asked")]);
    const interrupted = deriveUserInterruptions(issues, attention).length;
    expect(interrupted).toBe(2);
    expect(deriveActionable({ approvals: [], attention, ceoOverdue: false, interrupted })).toEqual({ criticalOrHigh: true, count: 3 });
    expect(deriveActionable({ approvals: [], attention: feed([]), ceoOverdue: false, interrupted: 1 })).toEqual({ criticalOrHigh: true, count: 1 });
    expect(deriveActionable({ approvals: [], attention: feed([]), ceoOverdue: false })).toEqual({ criticalOrHigh: false, count: 0 });
  });

  it("queues them under Interrupted, in the alerts lane, linked to their task", () => {
    const items = deriveQueueItems({
      companyId: "c1",
      approvals: [],
      attention: feed([question("asked")]),
      agents: [] as Agent[],
      routines: [],
      issues,
      nowMs: Date.parse("2026-11-09T12:00:00.000Z"),
    });
    const interrupted = items.filter((item) => item.kind === "interruption");
    expect(interrupted.map((item) => item.id)).toEqual(["interruption:reconnect", "interruption:snoozed-ask"]);
    const first = interrupted[0];
    expect(first).toMatchObject({ bucket: "soon", triage: null, interruption: { chip: "Interrupted · reconnect" } });
    expect(queueItemKind(first)).toBe("interrupted");
    expect(decideLane(first, Date.now())).toBe("alerts");
    // The question on "asked" stays a question row; it is not queued twice.
    expect(items.filter((item) => item.id.includes("asked"))).toHaveLength(1);
  });
});
