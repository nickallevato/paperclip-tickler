import type { Agent } from "@paperclipai/shared";
import type { LiveRunForIssue } from "../host/api";
import { runPhase } from "./runs";

/**
 * How long a run may go without saying anything before the board treats it as
 * stalled rather than working. A run that holds a runner but reports nothing
 * is the failure mode a glance-level dashboard exists to catch, and it is
 * invisible in a bare "3 running" count.
 */
export const TICKLER_STALL_MS = 20 * 60_000;

/**
 * Slack past an agent's `timeoutSec` + `graceSec` before a run is called over
 * its limit. The host closes a timed-out run itself once the grace period is
 * up, and the board only sees that on its next poll — without this margin a
 * run that ended on time would flash "over limit" for one refresh.
 */
export const TICKLER_OVER_LIMIT_SLACK_MS = 60_000;

/**
 * One square in a company's capacity strip.
 *
 * `working` and `queued` mirror {@link runPhase}; `stalled` is a working run
 * that has gone quiet; `over_limit` is a run still marked running after its
 * agent's own `timeoutSec` — the host has already given up on it and nothing
 * will close it, so unlike `stalled` it cannot recover by itself and someone
 * has to cancel it; `error` is an agent the host has marked failed; `idle`
 * is an agent that is staffed with nothing on it. The distinction between
 * `idle` and *no agent at all* is the whole point — "0 / 4" renders those two
 * states identically today.
 */
export type TicklerSquareState = "working" | "over_limit" | "stalled" | "queued" | "error" | "idle";

export interface TicklerSquare {
  agentId: string;
  agentName: string;
  state: TicklerSquareState;
  /** The run behind a working/stalled/queued square, when there is one. */
  run: LiveRunForIssue | null;
  /** Minutes since the run last did anything useful — only set when stalled. */
  silentMins: number | null;
  /** Minutes since the run started — only set when over its limit. */
  runningMins: number | null;
  /** The agent's `timeoutSec` — only set when over its limit. */
  limitSec: number | null;
}

/**
 * Agents that are not capacity and must not occupy a square.
 *
 * `paused` and `terminated` cannot pick up work, and `pending_approval` has
 * not been hired yet — drawing any of them as an idle square would claim the
 * company has staff standing by when it does not.
 */
const NOT_CAPACITY = new Set(["paused", "terminated", "pending_approval"]);

/** The most alarming state wins when one agent somehow has several runs. */
const RANK: Record<TicklerSquareState, number> = { error: 0, over_limit: 1, stalled: 2, working: 3, queued: 4, idle: 5 };

/**
 * The last moment a run demonstrably did something.
 *
 * Any genuine sign of life counts — a useful action, an event, a status
 * update — so the most recent of those three wins; a long tool call that keeps
 * emitting events is working, not stalled. `startedAt` is only a fallback for
 * a run that has reported nothing at all, and deliberately does not compete
 * with the activity signals: a run whose last useful action is older than its
 * own start timestamp is inconsistent data, and the older signal is the
 * conservative read.
 */
function lastSignAtMs(run: LiveRunForIssue): number | null {
  const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : Number.NaN);
  const activity = [run.lastUsefulActionAt, run.lastEventAt, run.currentStatusUpdatedAt]
    .map(ms)
    .filter((value) => Number.isFinite(value));
  if (activity.length) return Math.max(...activity);
  const started = ms(run.startedAt);
  return Number.isFinite(started) ? started : null;
}

/**
 * The agent's own run time limit, from the adapter config the board already
 * reads. `timeoutSec` of 0 or absent means no limit, and such an agent is
 * never over it. `graceSec` is the host's wait between the stop signal and the
 * kill, so a run inside it is still being shut down on schedule.
 */
export function agentRunLimit(agent: Agent | undefined): { timeoutSec: number; graceSec: number } | null {
  const adapter = record(agent?.adapterConfig) ?? {};
  const timeoutSec = positive(adapter.timeoutSec);
  if (timeoutSec === null) return null;
  return { timeoutSec, graceSec: positive(adapter.graceSec) ?? 0 };
}

type RunVerdict = Pick<TicklerSquare, "state" | "silentMins" | "runningMins" | "limitSec">;

function stateForRun(run: LiveRunForIssue, nowMs: number, agent?: Agent): RunVerdict {
  const plain = { silentMins: null, runningMins: null, limitSec: null };
  if (runPhase(run) === "queued") return { state: "queued", ...plain };
  const limit = agentRunLimit(agent);
  const started = run.startedAt ? new Date(run.startedAt).getTime() : Number.NaN;
  if (limit && Number.isFinite(started)) {
    const runningMs = nowMs - started;
    if (runningMs >= (limit.timeoutSec + limit.graceSec) * 1000 + TICKLER_OVER_LIMIT_SLACK_MS) {
      return { state: "over_limit", silentMins: null, runningMins: Math.floor(runningMs / 60_000), limitSec: limit.timeoutSec };
    }
  }
  const lastSign = lastSignAtMs(run);
  if (lastSign === null) return { state: "working", ...plain };
  const silentMs = nowMs - lastSign;
  if (silentMs >= TICKLER_STALL_MS) return { state: "stalled", ...plain, silentMins: Math.round(silentMs / 60_000) };
  return { state: "working", ...plain };
}

/** `47m`, `2h`, `3h 47m` — a run's age or an agent's limit at a glance. */
export function durationLabel(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** An agent's `timeoutSec` in the same form, keeping seconds when it is under a minute. */
export function limitLabel(limitSec: number): string {
  return limitSec < 60 ? `${limitSec}s` : durationLabel(Math.round(limitSec / 60));
}


/**
 * Agents in org order: the CEO first, then each agent immediately followed by
 * the people who report to them, depth first.
 *
 * Reading the strip left to right therefore walks the org chart, so the first
 * square is always the company's top-level agent and a manager sits beside
 * their own reports. Siblings are sorted by name (ties by id) so the order is
 * stable across polls — the strip must only ever change when the org does,
 * never because a fetch came back in a different order.
 *
 * Anyone whose manager is missing from `agents` — filtered out as
 * non-capacity, or simply not loaded — is treated as top level rather than
 * dropped, so the strip never silently loses a working agent.
 */
function orgOrder(agents: ReadonlyArray<Agent>): Agent[] {
  const present = new Set(agents.map((agent) => agent.id));
  const reportsByManager = new Map<string, Agent[]>();
  for (const agent of agents) {
    const manager = agent.reportsTo && present.has(agent.reportsTo) && agent.reportsTo !== agent.id
      ? agent.reportsTo
      : "";
    const siblings = reportsByManager.get(manager);
    if (siblings) siblings.push(agent);
    else reportsByManager.set(manager, [agent]);
  }
  for (const siblings of reportsByManager.values()) {
    siblings.sort((a, b) => {
      // The chief sits first among equals whatever they are called.
      if ((a.role === "ceo") !== (b.role === "ceo")) return a.role === "ceo" ? -1 : 1;
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
  }

  const ordered: Agent[] = [];
  const seen = new Set<string>();
  // Iterative, and guarded by `seen`: a reportsTo cycle must not hang the HUD.
  const walk = (agent: Agent) => {
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    ordered.push(agent);
    for (const report of reportsByManager.get(agent.id) ?? []) walk(report);
  };
  for (const root of reportsByManager.get("") ?? []) walk(root);
  // Anything left is inside a reporting cycle; append it rather than lose it.
  for (const agent of agents) if (!seen.has(agent.id)) ordered.push(agent);
  return ordered;
}

/**
 * One square per agent in org order (see {@link orgOrder}): the top-level
 * agent first, each manager followed by their reports. Stable across polls —
 * only the squares' states change. Agents that cannot take work are dropped
 * rather than drawn idle, which would overstate the company's capacity.
 */
export function deriveCapacity(
  agents: ReadonlyArray<Agent>,
  liveRuns: ReadonlyArray<LiveRunForIssue>,
  nowMs: number,
): TicklerSquare[] {
  const runsByAgent = new Map<string, LiveRunForIssue[]>();
  for (const run of liveRuns) {
    const list = runsByAgent.get(run.agentId);
    if (list) list.push(run);
    else runsByAgent.set(run.agentId, [run]);
  }

  return orgOrder(agents.filter((agent) => !NOT_CAPACITY.has(agent.status)))
    .map((agent) => {
      const plain = { run: null, silentMins: null, runningMins: null, limitSec: null };
      if (agent.status === "error") {
        return { agentId: agent.id, agentName: agent.name, state: "error" as const, ...plain };
      }
      const runs = runsByAgent.get(agent.id) ?? [];
      if (runs.length === 0) {
        return { agentId: agent.id, agentName: agent.name, state: "idle" as const, ...plain };
      }
      const scored = runs
        .map((run) => ({ run, ...stateForRun(run, nowMs, agent) }))
        .sort((a, b) => RANK[a.state] - RANK[b.state]);
      return { agentId: agent.id, agentName: agent.name, ...scored[0] };
    });
}

/**
 * Live runs past their agent's own time limit, counted per run rather than per
 * square: an agent allowed several runs at once can hold more than one, and
 * each is a slot nobody will free.
 */
export function countOverLimitRuns(
  agents: ReadonlyArray<Agent>,
  liveRuns: ReadonlyArray<LiveRunForIssue>,
  nowMs: number,
): number {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  let count = 0;
  for (const run of liveRuns) {
    const agent = agentsById.get(run.agentId);
    if (agent && stateForRun(run, nowMs, agent).state === "over_limit") count += 1;
  }
  return count;
}

export interface TicklerCapacityCounts {
  working: number;
  over_limit: number;
  stalled: number;
  queued: number;
  error: number;
  idle: number;
  total: number;
}

export function countCapacity(squares: ReadonlyArray<TicklerSquare>): TicklerCapacityCounts {
  const counts: TicklerCapacityCounts = { working: 0, over_limit: 0, stalled: 0, queued: 0, error: 0, idle: 0, total: squares.length };
  for (const square of squares) counts[square.state] += 1;
  return counts;
}

/**
 * The parts of an agent worth reading on hover.
 *
 * Everything here is dug out of `adapterConfig` / `runtimeConfig`, which are
 * loosely typed `Record<string, unknown>` on this codebase generation — so
 * each field is narrowed defensively and simply goes missing rather than
 * throwing when a company's agents are configured differently.
 */
export interface TicklerAgentProfile {
  name: string;
  /** Job title, falling back to the role. */
  title: string | null;
  model: string | null;
  /** Reasoning effort or adapter variant, when set. */
  effort: string | null;
  maxConcurrentRuns: number | null;
  maxTurnsPerRun: number | null;
  /** Heartbeat cadence in seconds, or null when heartbeat is off. */
  heartbeatSec: number | null;
  /** Skill names, already trimmed of their `owner/repo/` prefix. */
  skills: string[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/** `paperclipai/paperclip/paperclip-board` reads as `paperclip-board`. */
function skillName(ref: string): string {
  const parts = ref.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? ref;
}

export function agentProfile(agent: Agent): TicklerAgentProfile {
  const adapter = record(agent.adapterConfig) ?? {};
  const runtime = record(agent.runtimeConfig) ?? {};
  const heartbeat = record(runtime.heartbeat) ?? {};
  const skillSync = record(adapter.paperclipSkillSync) ?? {};
  const desired = Array.isArray(skillSync.desiredSkills) ? skillSync.desiredSkills : [];

  return {
    name: agent.name,
    title: text(agent.title) ?? text(agent.role),
    model: text(adapter.model),
    effort: text(adapter.modelReasoningEffort) ?? text(adapter.effort) ?? text(adapter.variant),
    maxConcurrentRuns: positive(heartbeat.maxConcurrentRuns),
    maxTurnsPerRun: positive(adapter.maxTurnsPerRun),
    heartbeatSec: heartbeat.enabled === true ? positive(heartbeat.intervalSec) : null,
    skills: desired.filter((ref): ref is string => typeof ref === "string").map(skillName),
  };
}
