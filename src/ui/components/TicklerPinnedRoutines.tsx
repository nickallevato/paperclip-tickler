import { Check, Loader2, Pin, PinOff, Play, Plus, Search, TriangleAlert } from "lucide-react";
import type { Company, RoutineListItem } from "@paperclipai/shared";
import { cn } from "../host/util";
import { CompanyPatternIcon, Popover, PopoverContent, PopoverTrigger } from "../host/ui-kit";
import { TicklerLink } from "./TicklerLink";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

/**
 * PLI-275 PROTOTYPE — mock only, not wired to the run endpoint yet.
 *
 * Pinned routines sit at the top of the Routines pane whatever their health,
 * each with a run button. Pressing it arms the button ("Run?"), a second press
 * within a few seconds fires `POST /api/routines/:id/run`, and the row then
 * links the issue that run created. A routine with a required variable that
 * has no default cannot fire blind, so its button opens a small form instead.
 */
export type TicklerPinnedRunState =
  | { kind: "idle" }
  | { kind: "armed" }
  | { kind: "running" }
  | { kind: "started"; issueIdentifier: string }
  | { kind: "error"; message: string }
  | { kind: "input" };

export interface TicklerPinnedRoutine {
  company: Company;
  routine: RoutineListItem;
  /** "next 14:00" / "last ran 2h ago" — whatever the schedule says. */
  when: string;
  /** Set when the routine is also failing/blocked/overdue: shown here, not twice. */
  alert?: "failed" | "blocked" | "overdue";
  run: TicklerPinnedRunState;
}

export function needsInput(routine: Pick<RoutineListItem, "variables">): boolean {
  return (routine.variables ?? []).some((v) => v.required && (v.defaultValue === null || v.defaultValue === ""));
}

export function TicklerPinnedRoutineRows({
  items,
  onRun,
  onUnpin,
}: {
  items: TicklerPinnedRoutine[];
  onRun?: (item: TicklerPinnedRoutine) => void;
  onUnpin?: (item: TicklerPinnedRoutine) => void;
}) {
  return (
    <ul data-tickler-pinned-routines className="px-3">
      {items.map((item) => (
        <PinnedRow key={`${item.company.id}:${item.routine.id}`} item={item} onRun={onRun} onUnpin={onUnpin} />
      ))}
    </ul>
  );
}

function PinnedRow({
  item,
  onRun,
  onUnpin,
}: {
  item: TicklerPinnedRoutine;
  onRun?: (item: TicklerPinnedRoutine) => void;
  onUnpin?: (item: TicklerPinnedRoutine) => void;
}) {
  const { company, routine, run, when, alert } = item;
  return (
    <li data-pinned-routine={run.kind} data-rail-row className="group py-1">
      <div className={cn("flex items-center gap-2", BODY)}>
        <Pin className="h-3.5 w-3.5 shrink-0 text-tickler-wait" aria-hidden="true" />
        <CompanyPatternIcon companyName={company.name} logoUrl={company.logoUrl} className="size-4 shrink-0 rounded text-[7px]" />
        <TicklerLink
          to={`/${company.issuePrefix}/routines/${routine.id}`}
          companyId={company.id}
          className="min-w-0 flex-1 truncate hover:underline decoration-dotted underline-offset-2"
          title={`${routine.title} · ${company.name}`}
        >
          {routine.title}
        </TicklerLink>
        <RunStatus run={run} when={alert ?? when} alert={alert !== undefined} company={company} />
        <button
          type="button"
          onClick={() => onUnpin?.(item)}
          aria-label={`Unpin ${routine.title}`}
          title="Unpin"
          className="hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block"
        >
          <PinOff className="h-3 w-3" />
        </button>
        <RunButton run={run} title={routine.title} input={needsInput(routine)} onClick={() => onRun?.(item)} />
      </div>
      {run.kind === "input" && <VariableForm routine={routine} />}
    </li>
  );
}

function RunStatus({
  run,
  when,
  alert,
  company,
}: {
  run: TicklerPinnedRunState;
  when: string;
  alert: boolean;
  company: Company;
}) {
  if (run.kind === "started") {
    return (
      <TicklerLink
        to={`/${company.issuePrefix}/issues/${run.issueIdentifier}`}
        companyId={company.id}
        className={cn(MICRO, "shrink-0 tabular-nums text-tickler-ok hover:underline")}
        title="The issue this run created"
      >
        started · {run.issueIdentifier}
      </TicklerLink>
    );
  }
  if (run.kind === "error") {
    return (
      <span className={cn(MICRO, "flex shrink-0 items-center gap-1 text-tickler-alarm")} title={run.message}>
        <TriangleAlert className="h-3 w-3" aria-hidden="true" />
        {run.message}
      </span>
    );
  }
  return <span className={cn(MICRO, "shrink-0 tabular-nums", alert ? "text-tickler-alarm" : "text-muted-foreground")}>{when}</span>;
}

function RunButton({
  run,
  title,
  input,
  onClick,
}: {
  run: TicklerPinnedRunState;
  title: string;
  input: boolean;
  onClick: () => void;
}) {
  const base = cn(MICRO, "flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 font-medium");
  if (run.kind === "armed") {
    return (
      <button type="button" onClick={onClick} className={cn(base, "border-tickler-live bg-tickler-live text-white")}>
        <Play className="h-3 w-3 fill-current" aria-hidden="true" />
        Run?
      </button>
    );
  }
  if (run.kind === "running") {
    return (
      <span className={cn(base, "text-muted-foreground")} aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      </span>
    );
  }
  if (run.kind === "started") {
    return (
      <span className={cn(base, "border-transparent text-tickler-ok")}>
        <Check className="h-3 w-3" aria-hidden="true" />
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={input ? `Run ${title} — needs input` : `Run ${title}`}
      title={input ? "Needs input before it can run" : "Run now — press twice"}
      className={cn(base, "text-muted-foreground hover:border-foreground/40 hover:text-foreground")}
    >
      <Play className="h-3 w-3" aria-hidden="true" />
      {input ? "…" : null}
    </button>
  );
}

function VariableForm({ routine }: { routine: RoutineListItem }) {
  return (
    <form className="mt-1 ml-[1.375rem] flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2" onSubmit={(e) => e.preventDefault()}>
      {(routine.variables ?? []).map((v) => (
        <label key={v.name} className={cn(MICRO, "flex items-center gap-2")}>
          <span className="w-20 shrink-0 truncate text-muted-foreground">
            {v.label ?? v.name}
            {v.required ? " *" : ""}
          </span>
          {v.options.length > 0 ? (
            <select className="h-6 min-w-0 flex-1 rounded border bg-background px-1" defaultValue={String(v.defaultValue ?? "")}>
              {v.options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5"
              placeholder={v.defaultValue === null ? "" : String(v.defaultValue)}
            />
          )}
        </label>
      ))}
      <div className="flex justify-end gap-1.5">
        <button type="button" className={cn(MICRO, "rounded-md px-2 py-0.5 text-muted-foreground hover:text-foreground")}>
          Cancel
        </button>
        <button type="submit" className={cn(MICRO, "flex items-center gap-1 rounded-md bg-tickler-live px-2 py-0.5 font-medium text-white")}>
          <Play className="h-3 w-3 fill-current" aria-hidden="true" />
          Run
        </button>
      </div>
    </form>
  );
}

/** The "+" in the Routines header: every routine across companies, pin toggles. */
export function TicklerPinRoutinePicker({
  entries,
  pinned,
  open,
  onOpenChange,
  onToggle,
}: {
  entries: ReadonlyArray<{ company: Company; routines: ReadonlyArray<RoutineListItem> }>;
  pinned: ReadonlySet<string>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onToggle?: (routineId: string) => void;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Pin a routine"
          title="Pin a routine — it stays in this pane with a Run button"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0 font-normal normal-case tracking-normal text-foreground"
        disablePortal
      >
        <div className={cn("flex items-center gap-2 border-b px-3 py-2 text-muted-foreground", BODY)}>
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="italic">Find a routine…</span>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {entries.map(({ company, routines }) => (
            <div key={company.id}>
              <div className={cn(MICRO, "flex items-center gap-1.5 px-3 pt-2 pb-1 font-semibold uppercase tracking-(--tracking-label) text-muted-foreground")}>
                <CompanyPatternIcon companyName={company.name} logoUrl={company.logoUrl} className="size-3.5 rounded text-[6px]" />
                {company.name}
              </div>
              {routines.map((routine) => {
                const on = pinned.has(routine.id);
                return (
                  <button
                    key={routine.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle?.(routine.id)}
                    className={cn(BODY, "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent")}
                  >
                    <Pin className={cn("h-3.5 w-3.5 shrink-0", on ? "text-tickler-wait" : "text-muted-foreground/40")} />
                    <span className="min-w-0 flex-1 truncate">{routine.title}</span>
                    {needsInput(routine) && <span className={cn(MICRO, "text-muted-foreground")}>needs input</span>}
                    {routine.status !== "active" && <span className={cn(MICRO, "text-muted-foreground")}>{routine.status}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
