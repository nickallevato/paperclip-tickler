import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pin, PinOff, Play, Plus, Search, TriangleAlert } from "lucide-react";
import type { Company, RoutineListItem, RoutineVariable } from "@paperclipai/shared";
import { issuesApi, routinesApi } from "../host/api";
import { cn, queryKeys } from "../host/util";
import { CompanyPatternIcon, Popover, PopoverContent, PopoverTrigger } from "../host/ui-kit";
import {
  initialVariableDraft,
  missingRequiredVariables,
  routineNeedsInput,
  variablesForRun,
  type RoutineVariableDraft,
  type TicklerPinnedRoutineEntry,
} from "../lib/pinned-routines";
import type { TicklerRoutineExceptionKind } from "../lib/queue";
import { TicklerLink } from "./TicklerLink";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

/** How long "Run?" stays armed before a second press stops counting. */
export const TICKLER_RUN_ARM_MS = 3_000;

/**
 * Pinned routines sit at the top of the Routines pane whatever their health,
 * each with a run button. Pressing it arms the button ("Run?"); a second press
 * within a few seconds fires `POST /api/routines/:id/run`, and the row then
 * links the issue that run created. A routine with a required variable that
 * has no default cannot fire blind, so its button opens a small form instead —
 * the form's own Run is the second press.
 */
export type TicklerPinnedRunState =
  | { kind: "idle" }
  | { kind: "armed" }
  | { kind: "input" }
  | { kind: "running" }
  | { kind: "started"; issueLabel: string; issueRef: string; coalesced: boolean }
  | { kind: "error"; message: string };

export interface TicklerPinnedRoutine extends TicklerPinnedRoutineEntry {
  /** Set when the routine is also failing/blocked/overdue: shown here, not twice. */
  alert?: TicklerRoutineExceptionKind;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Run failed";
}

export function TicklerPinnedRoutineRows({
  items,
  onUnpin,
}: {
  items: TicklerPinnedRoutine[];
  onUnpin?: (routineId: string) => void;
}) {
  return (
    <ul data-tickler-pinned-routines className="px-3">
      {items.map((item) => (
        <PinnedRow key={`${item.company.id}:${item.routine.id}`} item={item} onUnpin={onUnpin} />
      ))}
    </ul>
  );
}

function PinnedRow({ item, onUnpin }: { item: TicklerPinnedRoutine; onUnpin?: (routineId: string) => void }) {
  const { company, routine, when, alert } = item;
  const queryClient = useQueryClient();
  const [run, setRun] = useState<TicklerPinnedRunState>({ kind: "idle" });
  const input = routineNeedsInput(routine);

  // An armed button that is not pressed again goes back to sleep.
  useEffect(() => {
    if (run.kind !== "armed") return;
    const timer = setTimeout(() => setRun((current) => (current.kind === "armed" ? { kind: "idle" } : current)), TICKLER_RUN_ARM_MS);
    return () => clearTimeout(timer);
  }, [run.kind]);

  const fire = async (variables?: Record<string, string | number | boolean>) => {
    setRun({ kind: "running" });
    try {
      const result = await routinesApi.run(routine.id, variables);
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickler.routines(company.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tickler.issues(company.id) });
      if (!result.linkedIssueId) {
        // Skipped (e.g. a concurrency policy) — the host says why, or at least what.
        setRun({ kind: "error", message: result.failureReason ?? result.status });
        return;
      }
      // The run carries the issue's id; the row wants the identifier people say.
      const issue = await issuesApi.get(result.linkedIssueId).catch(() => null);
      setRun({
        kind: "started",
        issueLabel: issue?.identifier ?? "issue",
        issueRef: issue?.identifier ?? result.linkedIssueId,
        coalesced: result.status === "coalesced",
      });
    } catch (error) {
      setRun({ kind: "error", message: errorMessage(error) });
    }
  };

  const press = () => {
    if (run.kind === "armed") void fire();
    else if (run.kind === "input") setRun({ kind: "idle" });
    else if (input) setRun({ kind: "input" });
    else setRun({ kind: "armed" });
  };

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
        {onUnpin && (
          <button
            type="button"
            onClick={() => onUnpin(routine.id)}
            aria-label={`Unpin ${routine.title}`}
            title="Unpin"
            className="hidden rounded p-0.5 text-muted-foreground hover:text-foreground group-hover:block group-focus-within:block"
          >
            <PinOff className="h-3 w-3" />
          </button>
        )}
        <RunButton run={run} title={routine.title} input={input} onClick={press} />
      </div>
      {run.kind === "input" && (
        <VariableForm
          variables={routine.variables ?? []}
          onCancel={() => setRun({ kind: "idle" })}
          onSubmit={(draft) => void fire(variablesForRun(routine.variables ?? [], draft))}
        />
      )}
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
        to={`/${company.issuePrefix}/issues/${run.issueRef}`}
        companyId={company.id}
        className={cn(MICRO, "shrink-0 tabular-nums text-tickler-ok hover:underline")}
        title={run.coalesced ? "Already running — the open issue this run joined" : "The issue this run created"}
      >
        {run.coalesced ? "already open" : "started"} · {run.issueLabel}
      </TicklerLink>
    );
  }
  if (run.kind === "error") {
    return (
      <span
        role="alert"
        className={cn(MICRO, "flex min-w-0 max-w-[50%] shrink items-center gap-1 text-tickler-alarm")}
        title={run.message}
      >
        <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{run.message}</span>
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
      <button
        type="button"
        onClick={onClick}
        aria-label={`Confirm: run ${title}`}
        className={cn(base, "border-tickler-live bg-tickler-live text-white")}
      >
        <Play className="h-3 w-3 fill-current" aria-hidden="true" />
        Run?
      </button>
    );
  }
  if (run.kind === "running") {
    return (
      <span className={cn(base, "text-muted-foreground")} aria-live="polite" aria-label={`Starting ${title}`}>
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      </span>
    );
  }
  if (run.kind === "started") {
    // Still a button: pressing it arms another run, same two presses as before.
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Run ${title} again`}
        title="Run again — press twice"
        className={cn(base, "border-transparent text-tickler-ok hover:border-foreground/40")}
      >
        <Check className="h-3 w-3" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={input ? run.kind === "input" : undefined}
      aria-label={input ? `Run ${title} — needs input` : `Run ${title}`}
      title={input ? "Needs input before it can run" : "Run now — press twice"}
      className={cn(base, "text-muted-foreground hover:border-foreground/40 hover:text-foreground")}
    >
      <Play className="h-3 w-3" aria-hidden="true" />
      {input ? "…" : null}
    </button>
  );
}

const FIELD = "h-6 min-w-0 flex-1 rounded border bg-background px-1.5";

function VariableField({
  variable,
  value,
  onChange,
}: {
  variable: RoutineVariable;
  value: string;
  onChange: (value: string) => void;
}) {
  const label = `${variable.label || variable.name}${variable.required ? " (required)" : ""}`;
  if (variable.type === "select" || variable.type === "boolean") {
    const options = variable.type === "boolean" ? ["true", "false"] : variable.options;
    return (
      <select aria-label={label} className={cn(FIELD, "px-1")} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No value</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label={label}
      className={FIELD}
      type={variable.type === "number" ? "number" : variable.type === "date" ? "date" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function VariableForm({
  variables,
  onCancel,
  onSubmit,
}: {
  variables: readonly RoutineVariable[];
  onCancel: () => void;
  onSubmit: (draft: RoutineVariableDraft) => void;
}) {
  const [draft, setDraft] = useState<RoutineVariableDraft>(() => initialVariableDraft(variables));
  const missing = missingRequiredVariables(variables, draft);
  return (
    <form
      data-pinned-routine-form
      className="mt-1 ml-[1.375rem] flex flex-col gap-1.5 rounded-md border bg-muted/40 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing.length === 0) onSubmit(draft);
      }}
    >
      {variables.map((v) => (
        <label key={v.name} className={cn(MICRO, "flex items-center gap-2")}>
          <span className="w-20 shrink-0 truncate text-muted-foreground" title={v.label || v.name}>
            {v.label || v.name}
            {v.required ? " *" : ""}
          </span>
          <VariableField variable={v} value={draft[v.name] ?? ""} onChange={(value) => setDraft((d) => ({ ...d, [v.name]: value }))} />
        </label>
      ))}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className={cn(MICRO, "rounded-md px-2 py-0.5 text-muted-foreground hover:text-foreground")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={missing.length > 0}
          title={missing.length > 0 ? `Needs ${missing.join(", ")}` : undefined}
          className={cn(
            MICRO,
            "flex items-center gap-1 rounded-md bg-tickler-live px-2 py-0.5 font-medium text-white disabled:opacity-50",
          )}
        >
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
  onToggle,
}: {
  entries: ReadonlyArray<{ company: Company; routines: ReadonlyArray<RoutineListItem> }>;
  pinned: ReadonlySet<string>;
  onToggle: (routineId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries
      .map(({ company, routines }) => ({
        company,
        routines: routines.filter(
          (r) => r.status !== "archived" && (!needle || r.title.toLowerCase().includes(needle)),
        ),
      }))
      .filter((g) => g.routines.length > 0);
  }, [entries, query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
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
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
      >
        <div className={cn("flex items-center gap-2 border-b px-3 py-2 text-muted-foreground", BODY)}>
          <Search className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Find a routine"
            placeholder="Find a routine…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:italic placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {groups.length === 0 && (
            <p className={cn(MICRO, "px-3 py-2 italic text-muted-foreground")}>
              {query ? "No routine matches." : "No routines in these orgs."}
            </p>
          )}
          {groups.map(({ company, routines }) => (
            <div key={company.id}>
              <div className={cn(MICRO, "flex items-center gap-1.5 px-3 pt-2 pb-1 font-semibold uppercase tracking-(--tracking-label) text-muted-foreground")}>
                <CompanyPatternIcon companyName={company.name} logoUrl={company.logoUrl} className="size-4 rounded text-[7px]" />
                {company.name}
              </div>
              {routines.map((routine) => {
                const on = pinned.has(routine.id);
                return (
                  <button
                    key={routine.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => onToggle(routine.id)}
                    className={cn(BODY, "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent")}
                  >
                    <Pin className={cn("h-3.5 w-3.5 shrink-0", on ? "text-tickler-wait" : "text-muted-foreground/40")} />
                    <span className="min-w-0 flex-1 truncate">{routine.title}</span>
                    {routineNeedsInput(routine) && <span className={cn(MICRO, "text-muted-foreground")}>needs input</span>}
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
