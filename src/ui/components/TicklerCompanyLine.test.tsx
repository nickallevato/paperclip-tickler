import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { Agent, Company } from "@paperclipai/shared";
import { TicklerCompanyLine } from "./TicklerCompanyLine";
import type { TicklerCompanyData } from "./useTicklerCompanyData";

const NOW = Date.UTC(2026, 9, 24, 12);
const company = { id: "c1", name: "Acme", issuePrefix: "ACM" } as Company;
const agent = (id: string, name: string, extra: Partial<Agent> = {}) =>
  ({ id, name, urlKey: name.toLowerCase(), status: "idle", role: "worker", reportsTo: null, adapterConfig: {}, ...extra }) as Agent;

const data = (agents: Agent[], over: Partial<TicklerCompanyData> = {}) =>
  ({
    summary: undefined,
    liveRuns: [],
    issues: [],
    runIssues: [],
    agents,
    approvals: [],
    attention: undefined,
    routines: [],
    needsBreakdown: undefined,
    tokens: undefined,
    isLoading: false,
    unavailable: false,
    staleSince: null,
    invalidate: async () => {},
    ...over,
  }) as unknown as TicklerCompanyData;

function line(agents: Agent[], over: Partial<TicklerCompanyData> = {}) {
  return render(
    <ul>
      <TicklerCompanyLine
        company={company}
        data={data(agents, over)}
        stats={{ tasksOpen: 0, tasksInProgress: 0, tasksBlocked: 0, oldestMins: null } as never}
        actionable={{ count: 0, criticalOrHigh: false } as never}
        thresholds={{ warn: 1, crit: 2 } as never}
        nowMs={NOW}
      />
    </ul>,
  ).container;
}

describe("TicklerCompanyLine setup failures (PLI-331)", () => {
  it("shows an agent that failed setup as its own row, linked to the agent", () => {
    const container = line([
      agent("a", "Al"),
      agent("b", "Bo", { lifecycleState: "verifying", lifecycleError: "workspace clone failed" }),
    ]);
    const row = container.querySelector('[data-setup-failed="b"]');
    expect(row?.textContent).toBe("Bo failed setup: workspace clone failed");
    expect(row?.querySelector("a")?.getAttribute("href")).toBe("/ACM/agents/bo");
    // Not counted: only Al has a square.
    expect(container.querySelectorAll("[data-square-state]")).toHaveLength(1);
  });

  it("shows no row when every agent is ready", () => {
    const container = line([agent("a", "Al", { lifecycleState: "ready" })]);
    expect(container.querySelector("[data-setup-failed]")).toBeNull();
  });

  it("shows no row for an unreachable company, whose agent list is not current", () => {
    const container = line(
      [agent("b", "Bo", { lifecycleState: "preparing", lifecycleError: "boom" })],
      { unavailable: true },
    );
    expect(container.querySelector("[data-setup-failed]")).toBeNull();
  });
});
