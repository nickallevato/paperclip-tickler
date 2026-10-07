import { describe, expect, it } from "vitest";
import { elapsedLabel, humanStatus, isRunActive, isRuntimeStatus, isStartingUp, runNarration } from "./runs";

const run = (overrides: Record<string, unknown>) =>
  ({
    id: "r1",
    status: "running",
    createdAt: "2026-08-21T11:00:00Z",
    startedAt: "2026-08-21T11:05:00Z",
    currentStatusMessage: null,
    lastAssistantSnippet: null,
    nextAction: null,
    triggerDetail: "trigger",
    invocationSource: "schedule",
    ...overrides,
  }) as never;

describe("run helpers", () => {
  it("prefers the live status message, then next action, then the issue title", () => {
    const issue = { title: "Write the report" } as never;
    expect(runNarration(run({ lastAssistantSnippet: "I've drafted section 2 and am checking the figures.", currentStatusMessage: "tool: read_file" }), issue)).toBe("I've drafted section 2 and am checking the figures.");
    expect(runNarration(run({ currentStatusMessage: "Drafting section 2" }), issue)).toBe("Drafting section 2");
    expect(runNarration(run({ nextAction: "Summarise findings" }), issue)).toBe("Summarise findings");
    expect(runNarration(run({}), issue)).toBe("Write the report");
    // The wake's plumbing ("system", "assignment") is never the narration.
    expect(runNarration(run({}), undefined)).toBe("Working");
    expect(runNarration(run({ status: "queued" }), undefined)).toBe("Waiting for a runner");
  });

  it("labels elapsed time from startedAt and knows which statuses are active", () => {
    const now = Date.parse("2026-08-21T12:30:00Z");
    expect(elapsedLabel(run({}), now)).toBe("1h 25m");
    expect(elapsedLabel(run({ startedAt: null, createdAt: "2026-08-21T12:20:00Z" }), now)).toBe("10m");
    expect(isRunActive(run({ status: "queued" }))).toBe(true);
    expect(isRunActive(run({ status: "completed" }))).toBe(false);
  });
});

describe("runtime status filtering", () => {
  it("recognises plumbing and keeps prose", () => {
    expect(isRuntimeStatus("startup step: acp.handshake (1788ms)")).toBe(true);
    expect(isRuntimeStatus("git_sync: fetching origin")).toBe(true);
    expect(isRuntimeStatus("phase: restore")).toBe(true);
    expect(isRuntimeStatus("Checking the Q3 figures against the ledger")).toBe(false);
    expect(isRuntimeStatus("Waiting on Nick: which vendor?")).toBe(false);
  });

  it("hides runtime lines from the narration and flags the run as starting up", () => {
    const starting = run({ currentStatusMessage: "startup step: acp.handshake (1788ms)" });
    expect(humanStatus(starting)).toBeNull();
    expect(isStartingUp(starting)).toBe(true);
    expect(runNarration(starting, { title: "Write the report" } as never)).toBe("Write the report");
    const talking = run({ currentStatusMessage: "startup step: acp.handshake (1788ms)", lastAssistantSnippet: "Drafting now." });
    expect(humanStatus(talking)).toBe("Drafting now.");
    expect(isStartingUp(talking)).toBe(false);
  });
});
