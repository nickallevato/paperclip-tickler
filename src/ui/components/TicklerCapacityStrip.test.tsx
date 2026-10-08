import { describe, expect, it, afterEach } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Agent, Company, Issue } from "@paperclipai/shared";
import type { LiveRunForIssue } from "../host/api";
import { TICKLER_STALL_MS } from "../lib/capacity";
import { TicklerCapacityStrip } from "./TicklerCapacityStrip";

const NOW = Date.UTC(2026, 7, 25, 12);
const agoIso = (ms: number) => new Date(NOW - ms).toISOString();
const company = { id: "c1", name: "Acme", issuePrefix: "ACM" } as Company;
const agent = (
  id: string,
  name: string,
  status = "idle",
  extra: { role?: string; reportsTo?: string | null } = {},
) => ({ id, name, status, role: extra.role ?? "worker", reportsTo: extra.reportsTo ?? null }) as Agent;
const run = (over: Partial<LiveRunForIssue> & { agentId: string }) =>
  ({
    id: `run-${over.agentId}`,
    status: "running",
    invocationSource: "manual",
    triggerDetail: null,
    startedAt: agoIso(60_000),
    finishedAt: null,
    createdAt: agoIso(120_000),
    agentName: "Agent",
    adapterType: "claude",
    ...over,
  }) as LiveRunForIssue;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

const states = () =>
  Array.from(container.querySelectorAll("[data-square-state]")).map((node) => node.getAttribute("data-square-state"));

describe("TicklerCapacityStrip", () => {
  it("draws one square per agent, working and idle told apart", () => {
    render(
      <TicklerCapacityStrip
        agents={[agent("a", "Al"), agent("b", "Bo")]}
        liveRuns={[run({ agentId: "a" })]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
      />,
    );
    expect(states()).toEqual(["working", "idle"]);
  });

  it("shows a silent run as stalled rather than working", () => {
    render(
      <TicklerCapacityStrip
        agents={[agent("a", "Al")]}
        liveRuns={[run({ agentId: "a", lastUsefulActionAt: agoIso(TICKLER_STALL_MS + 60_000) })]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
      />,
    );
    expect(states()).toEqual(["stalled"]);
  });

  it("shows a run past its agent's time limit as over limit, and says so to screen readers", () => {
    const limited = { ...agent("a", "Al"), adapterConfig: { timeoutSec: 7200 } } as Agent;
    render(
      <TicklerCapacityStrip
        agents={[limited, agent("b", "Bo")]}
        liveRuns={[
          run({ agentId: "a", startedAt: agoIso(227 * 60_000), lastUsefulActionAt: agoIso(107 * 60_000) }),
          run({ agentId: "b", startedAt: agoIso(227 * 60_000), lastUsefulActionAt: agoIso(107 * 60_000) }),
        ]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
      />,
    );
    // Bo has no limit configured, so the same silence is only "stalled".
    expect(states()).toEqual(["over_limit", "stalled"]);
    expect(container.querySelector(".sr-only")?.textContent).toContain("1 over time limit · 1 silent");
  });

  it("says so plainly when a company has no agents, rather than drawing nothing", () => {
    render(<TicklerCapacityStrip agents={[]} liveRuns={[]} issues={[] as Issue[]} company={company} nowMs={NOW} />);
    expect(states()).toEqual([]);
    expect(container.textContent).toContain("no agents");
  });

  it("caps the strip and counts the rest", () => {
    const many = Array.from({ length: 11 }, (_, index) => agent(`a${index}`, `A${index}`));
    render(<TicklerCapacityStrip agents={many} liveRuns={[]} issues={[] as Issue[]} company={company} nowMs={NOW} />);
    expect(states()).toHaveLength(8);
    expect(container.textContent).toContain("+3");
  });

  it("carries a plain-language summary for assistive tech", () => {
    render(
      <TicklerCapacityStrip
        agents={[agent("a", "Al"), agent("b", "Bo"), agent("c", "Cy", "error")]}
        liveRuns={[run({ agentId: "a" })]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
      />,
    );
    // The summary rides in an sr-only span rather than an aria-label, so the
    // squares stay reachable as their own hover targets.
    const label = container.querySelector("[data-capacity-strip] .sr-only")?.textContent ?? "";
    expect(label).toContain("1 working");
    expect(label).toContain("of 3 agents");
    expect(label).toContain("1 in error");
  });

  it("renders a dash for an unreachable company instead of an empty strip", () => {
    render(
      <TicklerCapacityStrip
        agents={[agent("a", "Al")]}
        liveRuns={[]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
        unavailable
      />,
    );
    expect(states()).toEqual([]);
    expect(container.textContent).toBe("—");
  });
});

describe("TicklerCapacityStrip lead ordering", () => {
  const order = () =>
    Array.from(container.querySelectorAll("[data-square-state], [data-capacity-lead]")).map((node) =>
      node.hasAttribute("data-capacity-lead") ? "lead" : node.getAttribute("data-square-state"),
    );

  it("puts the lead's own square before the callout and the team after it", () => {
    render(
      <TicklerCapacityStrip
        agents={[
          agent("chief", "Chief", "idle", { role: "ceo" }),
          agent("a", "Al"),
          agent("b", "Bo"),
        ]}
        liveRuns={[run({ agentId: "chief" })]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
        leadAgentId="chief"
        lead={<span>callout</span>}
      />,
    );
    // chief's square, then who they are, then everyone else.
    expect(order()).toEqual(["working", "lead", "idle", "idle"]);
  });

  it("leads with the callout when the chief has no square of their own", () => {
    render(
      <TicklerCapacityStrip
        agents={[agent("chief", "Chief", "paused", { role: "ceo" }), agent("a", "Al")]}
        liveRuns={[]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
        leadAgentId="chief"
        lead={<span>callout</span>}
      />,
    );
    // A paused chief is not capacity, so nothing is pulled out of the strip.
    expect(order()).toEqual(["lead", "idle"]);
  });

  it("keeps the whole strip together when there is no lead at all", () => {
    render(
      <TicklerCapacityStrip
        agents={[agent("a", "Al"), agent("b", "Bo")]}
        liveRuns={[]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
      />,
    );
    expect(order()).toEqual(["idle", "idle"]);
  });

  it("still caps the strip once the lead has taken a slot", () => {
    const many = Array.from({ length: 12 }, (_, index) => agent(`a${index}`, `A${index}`));
    render(
      <TicklerCapacityStrip
        agents={[agent("chief", "Chief", "idle", { role: "ceo" }), ...many]}
        liveRuns={[]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
        leadAgentId="chief"
        lead={<span>callout</span>}
      />,
    );
    expect(container.querySelectorAll("[data-square-state]")).toHaveLength(8);
    expect(container.textContent).toContain("+5");
  });
});

describe("TicklerCapacityStrip alignment", () => {
  it("gives the lead block a fixed width so team squares line up across rows", () => {
    render(
      <TicklerCapacityStrip
        agents={[agent("chief", "Chief", "idle", { role: "ceo" }), agent("a", "Al")]}
        liveRuns={[]}
        issues={[] as Issue[]}
        company={company}
        nowMs={NOW}
        leadAgentId="chief"
        lead={<span>a very long chief name that would otherwise push the team right</span>}
      />,
    );
    const slot = container.querySelector("[data-capacity-lead]");
    // Fixed width + truncate: a long name cannot shove the squares out of column.
    expect(slot?.className).toMatch(/w-\[[\d.]+rem\]/);
    expect(slot?.className).toContain("truncate");
    expect(slot?.className).toContain("shrink-0");
  });
});
