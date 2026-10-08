import type { ReactNode } from "react";
import type { Agent, Company, Issue } from "@paperclipai/shared";
import { intervalLabel } from "../lib/tickler";
import type { LiveRunForIssue } from "../host/api";
import { HoverCard, HoverCardContent, HoverCardTrigger, IssueStatusBadge } from "../host/ui-kit";
import { cn } from "../host/util";
import {
  agentProfile,
  countCapacity,
  deriveCapacity,
  durationLabel,
  limitLabel,
  type TicklerSquare,
  type TicklerSquareState,
} from "../lib/capacity";
import { elapsedLabel, humanStatus, isStartingUp, runNarration } from "../lib/runs";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

/** Beyond this the strip stops being scannable and starts being a bar chart. */
const MAX_SQUARES = 8;

/**
 * One square per state. Only `working` moves, and slowly — a board of a dozen
 * companies breathing at full tailwind-pulse speed drowns out the alert
 * channel this dashboard exists to keep clear.
 */
const SQUARE_CLASS: Record<TicklerSquareState, string> = {
  working: "bg-tickler-live animate-[pulse_3s_ease-in-out_infinite] motion-reduce:animate-none",
  queued: "border border-tickler-live bg-transparent",
  stalled: "border border-tickler-wait bg-tickler-wait/20",
  // Brick like an error, but hollow: the agent is fine, one of its runs is not.
  over_limit: "border border-tickler-alarm bg-tickler-alarm/20",
  error: "bg-tickler-alarm",
  idle: "bg-muted-foreground/25",
};

const STATE_LABEL: Record<TicklerSquareState, string> = {
  working: "working",
  queued: "queued — no runner yet",
  stalled: "live but silent",
  over_limit: "over its time limit",
  error: "agent error",
  idle: "idle",
};

/** A short spec line: model, effort, and the limits the agent runs under. */
function specLine(agent: Agent | undefined): string | null {
  if (!agent) return null;
  const profile = agentProfile(agent);
  const parts: string[] = [];
  if (profile.model) parts.push(profile.model);
  if (profile.effort) parts.push(profile.effort);
  if (profile.maxConcurrentRuns) parts.push(`${profile.maxConcurrentRuns} run${profile.maxConcurrentRuns === 1 ? "" : "s"} at once`);
  if (profile.maxTurnsPerRun) parts.push(`${profile.maxTurnsPerRun} turns`);
  const beat = intervalLabel(profile.heartbeatSec);
  if (beat) parts.push(`beats ${beat}`);
  return parts.length ? parts.join(" · ") : null;
}

function SquareDetail({
  square,
  agent,
  issue,
  company,
}: {
  square: TicklerSquare;
  agent: Agent | undefined;
  issue: Issue | undefined;
  company: Company;
}) {
  const { run } = square;
  const profile = agent ? agentProfile(agent) : null;
  const spec = specLine(agent);
  return (
    <div className={cn("flex flex-col gap-2", BODY)}>
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{square.agentName}</span>
          {profile?.title && <span className="text-muted-foreground"> · {profile.title}</span>}
          <span className="text-muted-foreground"> — {STATE_LABEL[square.state]}</span>
        </span>
        {issue?.status && <IssueStatusBadge status={issue.status} />}
      </div>
      {spec && <p className={cn("text-muted-foreground", MICRO)}>{spec}</p>}
      {profile && profile.skills.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {profile.skills.slice(0, 6).map((skill) => (
            <span
              key={skill}
              className={cn(MICRO, "rounded-sm border px-1.5 py-px text-muted-foreground")}
            >
              {skill}
            </span>
          ))}
          {profile.skills.length > 6 && (
            <span className={cn(MICRO, "text-muted-foreground/70")}>+{profile.skills.length - 6}</span>
          )}
        </span>
      )}
      {run ? (
        <>
          <p className="min-w-0">
            {issue?.identifier && <span className={cn("mr-1.5 font-mono text-muted-foreground", MICRO)}>{issue.identifier}</span>}
            {issue?.title ?? runNarration(run, issue)}
          </p>
          <p className="whitespace-pre-line text-muted-foreground">
            {square.state === "over_limit"
              ? `Past its own time limit — Paperclip has stopped waiting on it, but the run was never closed. It still holds a runner; cancel it to free the slot.`
              : square.state === "stalled"
              ? `Nothing reported for ${square.silentMins}m — still holding a runner.`
              : square.state === "queued"
                ? "Waiting for a runner; no agent is on it yet."
                : (humanStatus(run) ?? (isStartingUp(run) ? "Starting up — nothing to report yet." : "Working — nothing reported yet."))}
          </p>
          <p className={cn("text-muted-foreground", MICRO)}>
            {company.name} ·{" "}
            {square.state === "over_limit" && square.runningMins !== null && square.limitSec !== null
              ? `${durationLabel(square.runningMins)} · limit ${limitLabel(square.limitSec)}`
              : square.state === "queued"
                ? `queued ${elapsedLabel(run)}`
                : elapsedLabel(run)}
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">
          {square.state === "error"
            ? "This agent is in an error state and is not picking up work."
            : "Staffed, with nothing assigned right now."}
        </p>
      )}
    </div>
  );
}

/**
 * A company's agents as a row of small squares: dim when idle, live when
 * working, hollow when queued, ochre when a run has gone quiet, brick-edged
 * when a run has outlived its agent's time limit, brick when an agent has
 * failed.
 *
 * This replaces the old "0 / 4" count, which could not tell idle-and-staffed
 * apart from having no agents at all, and had no way at all to show a run that
 * is holding a runner while reporting nothing.
 */
export function TicklerCapacityStrip({
  agents,
  liveRuns,
  issues,
  company,
  nowMs,
  unavailable = false,
  leadAgentId = null,
  lead,
}: {
  agents: Agent[];
  liveRuns: LiveRunForIssue[];
  issues: Issue[];
  company: Company;
  nowMs: number;
  unavailable?: boolean;
  /**
   * The company's top-level agent. Its square is pulled out of the strip and
   * placed before {@link lead}, so the chief's own state sits immediately
   * beside their name and the team follows.
   */
  leadAgentId?: string | null;
  /** The lead agent's callout, rendered between their square and the team's. */
  lead?: ReactNode;
}) {
  if (unavailable) return <span className="text-muted-foreground/50">—</span>;
  const squares = deriveCapacity(agents, liveRuns, nowMs);
  if (squares.length === 0) {
    return <span className={cn(MICRO, "text-muted-foreground/50")}>no agents</span>;
  }
  const counts = countCapacity(squares);
  // The lead's square leaves the run and sits ahead of the callout. When the
  // lead has no square — no CEO, or one that is paused and so not capacity —
  // nothing is pulled out and the callout simply leads the whole strip.
  const leadIndex = leadAgentId ? squares.findIndex((square) => square.agentId === leadAgentId) : -1;
  const leadSquare = leadIndex >= 0 ? squares[leadIndex] : null;
  const team = leadIndex >= 0 ? squares.filter((_, index) => index !== leadIndex) : squares;
  const shown = team.slice(0, MAX_SQUARES - (leadSquare ? 1 : 0));
  const overflow = team.length - shown.length;
  const issuesById = new Map(issues.map((issue) => [issue.id, issue]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  const renderSquare = (square: (typeof squares)[number]) => {
    const issue = square.run?.issueId ? issuesById.get(square.run.issueId) : undefined;
    return (
      <HoverCard key={square.agentId}>
        <HoverCardTrigger asChild>
          <span
            data-square-state={square.state}
            title={`${square.agentName} — ${STATE_LABEL[square.state]}`}
            className={cn("size-2.5 shrink-0 rounded-[2px]", SQUARE_CLASS[square.state])}
          />
        </HoverCardTrigger>
        <HoverCardContent data-capacity-detail>
          <SquareDetail square={square} agent={agentsById.get(square.agentId)} issue={issue} company={company} />
        </HoverCardContent>
      </HoverCard>
    );
  };

  const summary =
    `${counts.working} working, ${counts.queued} queued, ${counts.idle} idle of ${counts.total} agents` +
    (counts.over_limit > 0 ? ` · ${counts.over_limit} over time limit` : "") +
    (counts.stalled > 0 ? ` · ${counts.stalled} silent` : "") +
    (counts.error > 0 ? ` · ${counts.error} in error` : "");

  return (
    <span data-capacity-strip className="inline-flex items-center gap-[3px]">
      {/* Not role="img": the squares are hover targets and `lead` holds a link,
          and an img role would make the whole subtree presentational. The
          summary rides alongside them instead. */}
      <span className="sr-only">{summary}</span>
      {leadSquare && renderSquare(leadSquare)}
      {/* The lead block is a fixed width so the team's squares start at the
          same x on every row — they stay beside the chief, but they tab out
          into a column you can read straight down. */}
      {lead && (
        <span data-capacity-lead className="ml-1.5 mr-2 w-[7.5rem] min-w-0 shrink-0 truncate">
          {lead}
        </span>
      )}
      <span className="inline-flex items-center gap-[3px]">{shown.map(renderSquare)}</span>
      {overflow > 0 && <span className={cn(MICRO, "ml-0.5 tabular-nums text-muted-foreground")}>+{overflow}</span>}
    </span>
  );
}
