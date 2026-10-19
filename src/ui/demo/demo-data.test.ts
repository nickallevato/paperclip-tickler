import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import fixtureJson from "./demo-data.json";
import type { DemoFixture } from "./demo-types";

const FIXTURE = fixtureJson as unknown as DemoFixture;
const ROOT = path.resolve(__dirname, "../../..");

describe("demo fixture integrity", () => {
  it("has data for every company it orders, and orders every company it has", () => {
    expect(Object.keys(FIXTURE.byCompany).sort()).toEqual([...FIXTURE.companyOrder].sort());
    expect(FIXTURE.companies.map((company) => company.id).sort()).toEqual(
      [...FIXTURE.companyOrder].sort(),
    );
  });

  it("is big enough to look like a real instance", () => {
    // A HUD demoed on three tickets reads as a prototype. These floors are the
    // point of the fixture, not incidental.
    expect(FIXTURE.companies.length).toBeGreaterThanOrEqual(3);
    const totals = Object.values(FIXTURE.byCompany).reduce(
      (acc, data) => ({
        issues: acc.issues + data.issues.length,
        agents: acc.agents + data.agents.length,
        runs: acc.runs + data.liveRuns.length,
      }),
      { issues: 0, agents: 0, runs: 0 },
    );
    expect(totals.issues).toBeGreaterThanOrEqual(30);
    expect(totals.agents).toBeGreaterThanOrEqual(15);
    expect(totals.runs).toBeGreaterThanOrEqual(5);
  });

  it("shows every pane health, so a demo is not all-green", () => {
    const healths = Object.values(FIXTURE.byCompany).map((data) =>
      data.dashboard.budgets.activeIncidents > 0 || data.dashboard.agents.error > 0
        ? "red"
        : data.dashboard.pendingApprovals > 0
          ? "amber"
          : "green",
    );
    expect(new Set(healths)).toEqual(new Set(["red", "amber", "green"]));
  });

  it("points every cross-reference at something that exists", () => {
    for (const [companyId, data] of Object.entries(FIXTURE.byCompany)) {
      const agentIds = new Set(data.agents.map((agent) => agent.id));
      const issueIds = new Set(data.issues.map((issue) => issue.id));
      const projectIds = new Set(data.projects.map((project) => project.id));
      const approvalIds = new Set(data.approvals.map((approval) => approval.id));

      for (const issue of data.issues) {
        expect(projectIds).toContain(issue.projectId);
      }
      for (const run of data.liveRuns) {
        expect(agentIds).toContain(run.agentId);
        expect(issueIds).toContain(run.issueId);
      }
      for (const item of data.attention.items) {
        expect(item.companyId).toBe(companyId);
        if (item.relatedIssue) expect(issueIds).toContain(item.relatedIssue.id);
        if (item.sourceKind === "approval") expect(approvalIds).toContain(item.subject.id);
      }
      for (const cost of data.costsByAgent) {
        expect(agentIds).toContain(cost.agentId);
      }
    }
  });

  it("attaches every interaction to an issue the fixture holds", () => {
    const allIssueIds = new Set(
      Object.values(FIXTURE.byCompany).flatMap((data) => data.issues.map((issue) => issue.id)),
    );
    for (const [issueId, interactions] of Object.entries(FIXTURE.interactionsByIssue)) {
      expect(allIssueIds).toContain(issueId);
      expect(interactions.length).toBeGreaterThan(0);
    }
  });

  it("points every interaction row at a card the dialog can load", () => {
    // The queue offers an inline Answer only when the row carries the kind, and
    // the dialog matches on the subject id — a mismatch reads as "no longer
    // pending" in the demo, and the queue-question screenshot has nothing to show.
    const rows = Object.values(FIXTURE.byCompany).flatMap((data) =>
      data.attention.items.filter((item) => item.sourceKind === "issue_thread_interaction"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const issueId = row.subject.metadata?.issueId as string;
      const card = FIXTURE.interactionsByIssue[issueId]?.find((entry) => entry.id === row.subject.id);
      expect(card, row.id).toBeDefined();
      expect(row.subject.metadata?.kind).toBe(card?.kind);
    }
  });

  it("dates every row with a relative token, so it never reads as stale", () => {
    // A literal ISO timestamp anywhere means someone hand-edited the JSON and
    // the fixture will age. Tokens are resolved at load; see demo-time.ts.
    const literals = JSON.stringify(FIXTURE).match(/"\d{4}-\d{2}-\d{2}T[\d:.]+Z"/g) ?? [];
    expect(literals).toEqual([]);
  });

  it("matches what the generator produces, so edits go in the generator", () => {
    execFileSync("node", ["./scripts/gen-demo-data.mjs"], { cwd: ROOT, stdio: "pipe" });
    const regenerated = readFileSync(path.join(ROOT, "src/ui/demo/demo-data.json"), "utf8");
    expect(JSON.parse(regenerated)).toEqual(FIXTURE);
  });
});
