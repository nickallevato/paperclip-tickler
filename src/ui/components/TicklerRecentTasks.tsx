import { ChevronsUpDown } from "lucide-react";
import {
  CompanyPatternIcon,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  IssueStatusBadge,
  StatusGlyph,
} from "../host/ui-kit";
import { cn } from "../host/util";
import { formatAgeMinutes } from "../lib/tickler";
import type { TicklerRecentTask, TicklerRecentTasks as TicklerRecentTasksModel } from "../lib/queue";
import type { TicklerRailPaneBudget } from "../lib/rail-budget";
import { elapsedLabel, humanStatus, isStartingUp, runNarration } from "../lib/runs";
import { LiveDot, QueuedDot } from "./LiveDot";
import { TicklerLink } from "./TicklerLink";
import { railPaneBox, TicklerRailMore } from "./TicklerRailPane";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

/**
 * Rows this pane draws when the board is one column.
 *
 * Everywhere else the rail's height budget is what bounds this pane, and narrow
 * it cannot run at all: the rail is `display: contents`, so it has no box to
 * share out and every pane sizes itself. Recent is the one pane that grows with
 * the fleet, so left unbounded it drew all sixteen rows — ~520px measured on the
 * demo fixture — and on a 390px screen the queue the board exists for sat under
 * the fold behind it (PLI-260).
 *
 * Four rows and a count line is the same trade `distributeRailHeight` makes on a
 * rail too short for everyone, and roughly its 180px. It is a number rather than
 * a measurement because there is nothing to measure against here — no rail
 * height to divide, and no answer from the one column but "all of it".
 */
const NARROW_ROWS = 4;

/**
 * And expanded, narrow: double, for the same reason the wide pane doubles.
 *
 * Narrow the fold cannot buy the height back — the rail is `display: contents`
 * and the panes below are not competing for anything — so this is the one thing
 * expanding can still mean down here. The page scrolls, so the cost is the
 * queue sitting four rows further down rather than off a fixed column.
 */
const NARROW_ROWS_EXPANDED = NARROW_ROWS * 2;

/** Markdown emphasis/headings/code marks read as noise in a four-line excerpt. */
function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The hover detail: the agent's own last words (the human-readable summary the
 * host shows in the thread), with the terse status line only as a fallback. No
 * tool names or runtime plumbing.
 *
 * A row has space for a ticket, a title and an age, so this is the only place
 * the narration lives — and the only reason a row can be a single line.
 */
function TaskDetail({ company, issue, run, phase, atMs, nowMs }: TicklerRecentTask & { nowMs: number }) {
  const queued = phase === "queued";
  const summary = run && !queued ? (humanStatus(run) ?? run.nextAction?.trim() ?? null) : null;
  const startingUp = !summary && run !== undefined && isStartingUp(run);
  return (
    <div className={cn("flex flex-col gap-2", BODY)}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {issue?.identifier && <span className={cn("mr-1.5 font-mono text-muted-foreground", MICRO)}>{issue.identifier}</span>}
          <span className="font-medium">{issue?.title ?? run?.triggerDetail ?? run?.invocationSource}</span>
        </div>
        {issue?.status && <IssueStatusBadge status={issue.status} />}
      </div>
      {summary ? (
        <p className="whitespace-pre-line">{summary}</p>
      ) : (
        <>
          {run && (
            <p className="italic text-muted-foreground">
              {queued
                ? "queued — waiting for a runner, no agent on it yet"
                : startingUp
                  ? "starting up — nothing to report yet"
                  : "working — nothing reported yet"}
            </p>
          )}
          {issue?.description?.trim() && <p className="line-clamp-4 text-muted-foreground">{plainText(issue.description)}</p>}
        </>
      )}
      <p className={cn("text-muted-foreground", MICRO)}>
        {run ? `${run.agentName} · ` : ""}
        {company.name} ·{" "}
        {run
          ? queued
            ? `queued ${elapsedLabel(run, nowMs)}`
            : elapsedLabel(run, nowMs)
          : `touched ${formatAgeMinutes(ageMinutes(atMs, nowMs))} ago`}
      </p>
    </div>
  );
}

function ageMinutes(atMs: number, nowMs: number): number {
  return Math.max(0, Math.round((nowMs - atMs) / 60_000));
}

/**
 * One task as a line: whose it is, what state it is in, which ticket, how long.
 *
 * Deliberately one line and no more. This list sits in the rail above Portfolio,
 * so a row that could wrap would move everything under it every time an agent
 * changed what it was saying.
 */
function TaskRow({ task, nowMs }: { task: TicklerRecentTask; nowMs: number }) {
  const { company, issue, run, phase, atMs } = task;
  // A run without a ticket has no title to show, so it borrows the narration
  // the strip used to put on its pill.
  const title = issue?.title ?? (run ? runNarration(run, undefined) : "");
  const body = (
    <span className="flex min-w-0 items-center gap-2">
      <CompanyPatternIcon
        companyName={company.name}
        logoUrl={company.logoUrl}
        className="size-4 shrink-0 rounded text-[7px]"
      />
      {/* One slot, three meanings: a pulsing dot for a run being worked, a
          still ring for one waiting on a runner, and the task's own status
          glyph when nothing is running — so the live rows are the only ones
          that move. */}
      {phase === "working" ? (
        <LiveDot />
      ) : phase === "queued" ? (
        <QueuedDot />
      ) : (
        <StatusGlyph status={issue?.status ?? "backlog"} size="sm" className="h-3.5 w-3.5" />
      )}
      {issue?.identifier && <span className={cn("shrink-0 font-mono font-medium text-foreground", MICRO)}>{issue.identifier}</span>}
      <span className={cn("min-w-0 flex-1 truncate", phase === null && "text-muted-foreground")}>{title}</span>
      <span className={cn("shrink-0 tabular-nums text-muted-foreground", MICRO)}>
        {run ? elapsedLabel(run, nowMs) : formatAgeMinutes(ageMinutes(atMs, nowMs))}
      </span>
    </span>
  );
  return (
    <li data-recent-task={phase ?? "idle"} data-rail-row className={cn("flex items-center", BODY)}>
      <HoverCard>
        {/* The trigger's child is a plain span, not the link: `asChild` clones
            its child with a ref and a data-slot, and TicklerLink accepts a fixed
            prop set that would silently drop both. */}
        <HoverCardTrigger asChild>
          <span className="block min-w-0 flex-1 py-1">
            {issue ? (
              <TicklerLink
                to={`/${company.issuePrefix}/issues/${issue.identifier ?? issue.id}`}
                companyId={company.id}
                className="block min-w-0"
                title={`${title} · ${company.name}`}
              >
                {body}
              </TicklerLink>
            ) : (
              body
            )}
          </span>
        </HoverCardTrigger>
        <HoverCardContent data-recent-detail>
          <TaskDetail {...task} nowMs={nowMs} />
        </HoverCardContent>
      </HoverCard>
    </li>
  );
}

/**
 * Recent, in the rail: what the fleet is on, live rows first and newest first.
 *
 * It replaces the full-width "Live now" strip, which could only say that a run
 * existed — a pill had room for a ticket key, an agent and a clock, and nothing
 * else. The questions actually being asked of that strip were "what is
 * happening" and "what just happened", and the second one it could not answer at
 * all: the moment a run finished, its pill vanished and the work left no trace
 * on the page.
 *
 * A rail list answers both. A row is as wide as the column, so the ticket title
 * fits; the tasks that just finished stay in place under the live ones; and the
 * same live dot the strip used still marks the rows an agent is on right now.
 *
 * The strip's one real virtue was a height that could not change — it was moved
 * out of the rail in the first place because a pane that grew with the fleet
 * shoved Portfolio and Routines down the page. That is kept here, but by the
 * rail's height budget rather than by a 256px cap of its own: the list scrolls
 * inside the height it was given, so a run starting can move rows within this
 * pane and nothing outside it.
 *
 * Narrow there is no rail to do that, so the pane bounds itself — see
 * {@link NARROW_ROWS}.
 */
export function TicklerRecentTasks({
  tasks,
  nowMs,
  budget,
  narrow,
  expanded = false,
  onExpanded,
  className,
}: {
  tasks: TicklerRecentTasksModel;
  nowMs: number;
  budget?: TicklerRailPaneBudget;
  /** One column: no rail height, so the pane caps its own rows. */
  narrow?: boolean;
  /** The reader has traded Portfolio and Routines for twice this list. */
  expanded?: boolean;
  /** Absent hides the toggle — the pane is then exactly what it was. */
  onExpanded?: (expanded: boolean) => void;
  className?: string;
}) {
  const { items, working, queued, hidden } = tasks;
  const box = railPaneBox(budget);
  // Wide, this is every row and the model's own count — the budget scrolls the
  // pane rather than dropping rows, and that path is untouched.
  const rows = narrow ? items.slice(0, expanded ? NARROW_ROWS_EXPANDED : NARROW_ROWS) : items;
  const withheld = hidden + (items.length - rows.length);
  return (
    <section
      data-tickler-recent
      data-rail-pane="recent"
      aria-label="Recent tasks"
      style={box.style}
      className={cn("flex min-h-0 shrink-0 flex-col rounded-lg border bg-card", className, box.className)}
    >
      <h3
        data-rail-head
        className={cn(
          "flex shrink-0 items-center gap-2 px-3 pb-2 pt-3 font-semibold uppercase tracking-(--tracking-label) text-muted-foreground",
          MICRO,
        )}
      >
        {working > 0 ? <LiveDot /> : <QueuedDot />}
        Recent
        <span className="ml-auto flex items-center gap-2 font-normal normal-case tracking-normal tabular-nums">
          {working > 0 ? <span>{working} working</span> : <span className="italic">nothing running</span>}
          {queued > 0 && (
            <span className="flex items-center gap-1">
              <QueuedDot />
              {queued} queued
            </span>
          )}
        </span>
        <TicklerRailMore budget={budget} />
        {onExpanded && (
          /* Last in the header, past the counts and the "+N more" those counts
             qualify: it is the one thing here that changes the page rather than
             describing it. `aria-pressed` rather than two labels doing the same
             job — the title says what the press costs, which is the part that is
             not obvious from the icon. */
          <button
            type="button"
            data-recent-expand
            aria-pressed={expanded}
            aria-label={expanded ? "Collapse Recent" : "Expand Recent"}
            title={
              expanded
                ? "Collapse Recent — gives Portfolio and Routines their rows back"
                : "Expand Recent — twice the list, with Portfolio and Routines folded to their headers"
            }
            onClick={() => onExpanded(!expanded)}
            className={cn(
              "-my-0.5 shrink-0 rounded border p-0.5",
              expanded ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {/* One icon in both states, like the header's own toggles: the
                obvious second icon is `ChevronsDownUp`, and at 12px inside a
                bordered square it reads as a close button. The pressed
                background is what says which state this is. */}
            <ChevronsUpDown className="h-3 w-3" />
          </button>
        )}
      </h3>

      {items.length === 0 ? (
        <p data-rail-foot className={cn("px-3 pb-3 italic text-muted-foreground", MICRO)}>
          nothing has moved today
        </p>
      ) : budget?.demoted ? (
        // Too short a rail to draw even three rows. The header above already
        // says how many are working and how many are queued, which is the whole
        // of what three clipped rows would have told anyone.
        null
      ) : (
        <>
          {/* Scrolled inside the height the rail budgeted, so this pane's height
              does not track the size of the fleet. */}
          <ul className="min-h-0 flex-1 overflow-y-auto px-3">
            {rows.map((task) => (
              <TaskRow key={task.key} task={task} nowMs={nowMs} />
            ))}
          </ul>
          {withheld > 0 && (
            <p data-rail-foot className={cn("shrink-0 border-t px-3 py-1.5 text-muted-foreground", MICRO)}>
              {withheld} more touched today
            </p>
          )}
        </>
      )}
    </section>
  );
}
