import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import type { LiveRunForIssue } from "../host/api";
import {
  agentProfile,
  countCapacity,
  countOverLimitRuns,
  deriveCapacity,
  durationLabel,
  limitLabel,
  TICKLER_OVER_LIMIT_SLACK_MS,
  TICKLER_STALL_MS,
} from "./capacity";

const NOW = Date.UTC(2026, 7, 25, 12);
const agoIso = (ms: number) => new Date(NOW - ms).toISOString();

const agent = (
  id: string,
  name: string,
  status = "idle",
  extra: { role?: string; reportsTo?: string | null; adapterConfig?: Record<string, unknown> } = {},
): Agent =>
  ({ id, name, status, role: extra.role ?? "worker", reportsTo: extra.reportsTo ?? null, adapterConfig: extra.adapterConfig ?? {} }) as never;

const HOUR = 60 * 60_000;
/** An opencode-style agent with the two-hour limit from GH#72. */
const limited = (id: string, adapterConfig: Record<string, unknown> = { timeoutSec: 7200 }) =>
  agent(id, id.toUpperCase(), "running", { adapterConfig });

const run = (over: Partial<LiveRunForIssue> & { agentId: string }): LiveRunForIssue =>
  ({
    id: `run-${over.agentId}`,
    status: "running",
    invocationSource: "manual",
    triggerDetail: null,
    startedAt: agoIso(5 * 60_000),
    finishedAt: null,
    createdAt: agoIso(6 * 60_000),
    agentName: "Agent",
    adapterType: "claude",
    ...over,
  }) as LiveRunForIssue;

describe("deriveCapacity", () => {
  it("gives one square per agent, in a stable order so the strip never reshuffles", () => {
    const squares = deriveCapacity([agent("c", "Cy"), agent("a", "Al"), agent("b", "Bo")], [], NOW);
    expect(squares.map((square) => square.agentId)).toEqual(["a", "b", "c"]);
    expect(squares.every((square) => square.state === "idle")).toBe(true);
  });

  it("puts the company's chief first, whatever they are named", () => {
    const squares = deriveCapacity(
      [agent("z", "Zeb"), agent("m", "Marlow", "idle", { role: "ceo" }), agent("a", "Al")],
      [],
      NOW,
    );
    expect(squares[0].agentName).toBe("Marlow");
  });

  it("walks the org chart: each manager is followed by their own reports", () => {
    const squares = deriveCapacity(
      [
        agent("ceo", "Chief", "idle", { role: "ceo" }),
        agent("eng", "Eng Lead", "idle", { reportsTo: "ceo" }),
        agent("ops", "Ops Lead", "idle", { reportsTo: "ceo" }),
        agent("dev", "Dev", "idle", { reportsTo: "eng" }),
        agent("sre", "SRE", "idle", { reportsTo: "eng" }),
      ],
      [],
      NOW,
    );
    expect(squares.map((square) => square.agentId)).toEqual(["ceo", "eng", "dev", "sre", "ops"]);
  });

  it("treats an agent whose manager is missing as top level rather than losing it", () => {
    const squares = deriveCapacity(
      [agent("a", "Al", "idle", { reportsTo: "gone" }), agent("b", "Bo")],
      [],
      NOW,
    );
    expect(squares.map((square) => square.agentId)).toEqual(["a", "b"]);
  });

  it("survives a reporting cycle instead of hanging, keeping every agent", () => {
    const squares = deriveCapacity(
      [agent("a", "Al", "idle", { reportsTo: "b" }), agent("b", "Bo", "idle", { reportsTo: "a" })],
      [],
      NOW,
    );
    expect(squares.map((square) => square.agentId).sort()).toEqual(["a", "b"]);
  });

  it("keeps a report visible when its manager is filtered out as non-capacity", () => {
    const squares = deriveCapacity(
      [agent("boss", "Boss", "paused"), agent("kid", "Kid", "idle", { reportsTo: "boss" })],
      [],
      NOW,
    );
    expect(squares.map((square) => square.agentId)).toEqual(["kid"]);
  });

  it("marks a staffed agent with no run idle, not absent", () => {
    const squares = deriveCapacity([agent("a", "Al")], [], NOW);
    expect(squares).toHaveLength(1);
    expect(squares[0]).toMatchObject({ state: "idle", run: null });
  });

  it("separates working from queued runs", () => {
    const squares = deriveCapacity(
      [agent("a", "Al"), agent("b", "Bo")],
      [run({ agentId: "a" }), run({ agentId: "b", status: "queued", startedAt: null })],
      NOW,
    );
    expect(squares.map((square) => square.state)).toEqual(["working", "queued"]);
  });

  it("calls a working run stalled once it has been silent past the threshold", () => {
    const quiet = run({ agentId: "a", lastUsefulActionAt: agoIso(TICKLER_STALL_MS + 60_000) });
    const [square] = deriveCapacity([agent("a", "Al")], [quiet], NOW);
    expect(square.state).toBe("stalled");
    expect(square.silentMins).toBe(21);
  });

  it("keeps a run working while any signal is recent", () => {
    const chatty = run({
      agentId: "a",
      lastUsefulActionAt: agoIso(TICKLER_STALL_MS + 60_000),
      lastEventAt: agoIso(60_000),
    });
    expect(deriveCapacity([agent("a", "Al")], [chatty], NOW)[0].state).toBe("working");
  });

  it("never calls a queued run stalled, however long it has waited", () => {
    const waiting = run({ agentId: "a", status: "queued", startedAt: null, createdAt: agoIso(4 * TICKLER_STALL_MS) });
    expect(deriveCapacity([agent("a", "Al")], [waiting], NOW)[0].state).toBe("queued");
  });

  it("shows an errored agent as error even when a run is attached", () => {
    const squares = deriveCapacity([agent("a", "Al", "error")], [run({ agentId: "a" })], NOW);
    expect(squares[0].state).toBe("error");
  });

  it("drops agents that cannot take work rather than drawing them idle", () => {
    const squares = deriveCapacity(
      [
        agent("a", "Al"),
        agent("b", "Bo", "paused"),
        agent("c", "Cy", "terminated"),
        agent("d", "Di", "pending_approval"),
      ],
      [],
      NOW,
    );
    // A terminated agent drawn as an idle square claims the company has staff
    // standing by when it has none.
    expect(squares.map((square) => square.agentId)).toEqual(["a"]);
  });

  it("shows the most alarming state when one agent holds several runs", () => {
    const squares = deriveCapacity(
      [agent("a", "Al")],
      [run({ agentId: "a", id: "r1" }), run({ agentId: "a", id: "r2", lastUsefulActionAt: agoIso(2 * TICKLER_STALL_MS) })],
      NOW,
    );
    expect(squares[0].state).toBe("stalled");
  });

  describe("over limit", () => {
    // GH#72: output stopped at the 2h mark and the run was never closed.
    const hung = (startedMsAgo: number, id = "r1") =>
      run({ agentId: "a", id, startedAt: agoIso(startedMsAgo), lastUsefulActionAt: agoIso(startedMsAgo - 2 * HOUR) });

    it("flags a run still running past its agent's timeoutSec, with how long it has run", () => {
      const [square] = deriveCapacity([limited("a")], [hung(3 * HOUR + 47 * 60_000)], NOW);
      expect(square).toMatchObject({ state: "over_limit", runningMins: 227, limitSec: 7200, silentMins: null });
    });

    it("outranks stalled, since a run past its limit is silent too", () => {
      const [square] = deriveCapacity([limited("a")], [hung(3 * HOUR)], NOW);
      expect(square.state).toBe("over_limit");
    });

    it("picks the over-limit run when the agent holds a stalled one as well", () => {
      const quiet = run({ agentId: "a", id: "r2", lastUsefulActionAt: agoIso(2 * TICKLER_STALL_MS) });
      const [square] = deriveCapacity([limited("a")], [quiet, hung(3 * HOUR)], NOW);
      expect(square.state).toBe("over_limit");
      expect(square.run?.id).toBe("r1");
    });

    it("waits out the host's grace period and one poll before calling it", () => {
      const config = { timeoutSec: 7200, graceSec: 30 };
      const atEdge = 2 * HOUR + 30_000 + TICKLER_OVER_LIMIT_SLACK_MS;
      expect(deriveCapacity([limited("a", config)], [hung(atEdge - 1_000)], NOW)[0].state).not.toBe("over_limit");
      expect(deriveCapacity([limited("a", config)], [hung(atEdge)], NOW)[0].state).toBe("over_limit");
    });

    it.each([
      ["0 (no limit)", { timeoutSec: 0 }],
      ["missing", {}],
      ["not a number", { timeoutSec: "7200" }],
    ])("never applies when timeoutSec is %s — the square behaves as before", (_label, config) => {
      const [square] = deriveCapacity([limited("a", config)], [hung(10 * HOUR)], NOW);
      expect(square.state).toBe("stalled");
      expect(square).toMatchObject({ runningMins: null, limitSec: null });
    });

    it("never applies to a queued run, which has not started its clock", () => {
      const waiting = run({ agentId: "a", status: "queued", startedAt: null, createdAt: agoIso(5 * HOUR) });
      expect(deriveCapacity([limited("a")], [waiting], NOW)[0].state).toBe("queued");
    });

    it("counts runs, not agents, so a multi-slot agent's hung runs each count", () => {
      const runs = [hung(3 * HOUR, "r1"), hung(4 * HOUR, "r2"), run({ agentId: "b" })];
      expect(countOverLimitRuns([limited("a"), limited("b")], runs, NOW)).toBe(2);
      expect(countOverLimitRuns([limited("a", {})], runs, NOW)).toBe(0);
    });
  });

  it("ignores runs belonging to agents it was not given", () => {
    const squares = deriveCapacity([agent("a", "Al")], [run({ agentId: "ghost" })], NOW);
    expect(squares[0].state).toBe("idle");
  });
});

describe("durationLabel / limitLabel", () => {
  it("reads like the issue asked: 3h 47m · limit 2h", () => {
    expect(durationLabel(227)).toBe("3h 47m");
    expect(durationLabel(47)).toBe("47m");
    expect(limitLabel(7200)).toBe("2h");
    expect(limitLabel(5400)).toBe("1h 30m");
    expect(limitLabel(45)).toBe("45s");
  });
});

describe("countCapacity", () => {
  it("tallies each state and the total", () => {
    const squares = deriveCapacity(
      [agent("a", "Al"), agent("b", "Bo"), agent("c", "Cy", "error"), agent("d", "Di")],
      [run({ agentId: "a" }), run({ agentId: "b", status: "queued", startedAt: null })],
      NOW,
    );
    expect(countCapacity(squares)).toEqual({ working: 1, over_limit: 0, stalled: 0, queued: 1, error: 1, idle: 1, total: 4 });
  });
});

describe("agentProfile", () => {
  const configured = {
    id: "a",
    name: "Comms",
    role: "worker",
    title: "Inbound triage",
    adapterConfig: {
      model: "claude-sonnet-5",
      modelReasoningEffort: "high",
      maxTurnsPerRun: 1000,
      paperclipSkillSync: {
        desiredSkills: ["paperclipai/paperclip/paperclip", "paperclipai/paperclip/paperclip-board"],
      },
    },
    runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300, maxConcurrentRuns: 1 } },
  } as never as Agent;

  it("reads model, effort, limits and heartbeat out of the loose config blobs", () => {
    expect(agentProfile(configured)).toMatchObject({
      name: "Comms",
      title: "Inbound triage",
      model: "claude-sonnet-5",
      effort: "high",
      maxConcurrentRuns: 1,
      maxTurnsPerRun: 1000,
      heartbeatSec: 300,
    });
  });

  it("trims skill refs down to their name", () => {
    expect(agentProfile(configured).skills).toEqual(["paperclip", "paperclip-board"]);
  });

  it("reports no heartbeat cadence when the heartbeat is disabled", () => {
    const off = { ...configured, runtimeConfig: { heartbeat: { enabled: false, intervalSec: 300 } } } as never as Agent;
    expect(agentProfile(off).heartbeatSec).toBeNull();
  });

  it("falls back to the role when an agent has no title", () => {
    const untitled = { ...configured, title: null, role: "ceo" } as never as Agent;
    expect(agentProfile(untitled).title).toBe("ceo");
  });

  it("survives agents with empty or junk config rather than throwing", () => {
    const bare = { id: "b", name: "Bare", role: "worker", adapterConfig: {}, runtimeConfig: {} } as never as Agent;
    expect(agentProfile(bare)).toMatchObject({ model: null, effort: null, maxConcurrentRuns: null, skills: [] });

    const junk = {
      id: "c",
      name: "Junk",
      role: "worker",
      adapterConfig: { model: 42, paperclipSkillSync: "nope", maxTurnsPerRun: -3 },
      runtimeConfig: { heartbeat: [] },
    } as never as Agent;
    expect(agentProfile(junk)).toMatchObject({ model: null, maxTurnsPerRun: null, heartbeatSec: null, skills: [] });
  });
});
