/**
 * Pinned routines (PLI-275): the routines a user wants in the Routines pane
 * whatever their health, each with a Run button.
 *
 * ## Where pins are stored
 *
 * `localStorage`, per browser — the same limit and the same reason as the
 * watched orgs and the pane order (see `lib/pane-order`): a plugin's UI has no
 * server-side preference store it can write, and adding one would be a core
 * change. Routine ids are UUIDs, unique across companies, so the list is a
 * flat array of ids.
 */
import type { Company, RoutineListItem, RoutineVariable } from "@paperclipai/shared";
import type { TicklerUpcomingRoutine } from "./queue";
import { formatAgeMinutes } from "./tickler";

export const TICKLER_PINNED_ROUTINES_STORAGE_KEY = "tickler.pinnedRoutines";

/** A stored value that is not a list of strings is no pins, not a crash. */
export function normalizePinnedRoutineIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))];
  } catch {
    return [];
  }
}

export function togglePinnedRoutineId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export interface TicklerPinnedRoutineEntry {
  company: Company;
  routine: RoutineListItem;
  /** "next 14:00" / "next Tue 09:00" / "ran 2h ago" / "manual". */
  when: string;
}

function formatNext(atMs: number, nowMs: number): string {
  const at = new Date(atMs);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (new Date(nowMs).toDateString() === at.toDateString()) return `next ${time}`;
  return `next ${at.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/**
 * The pinned rows, in pin order. A pin whose routine is not loaded (an org
 * that is hidden, or a routine since deleted) is skipped rather than dropped
 * from storage, so it comes back when the org does.
 */
export function pinnedRoutineEntries(
  pinnedIds: readonly string[],
  entries: ReadonlyArray<{ company: Company; routines: ReadonlyArray<RoutineListItem> }>,
  upcoming: readonly TicklerUpcomingRoutine[],
  nowMs: number,
): TicklerPinnedRoutineEntry[] {
  const byId = new Map<string, { company: Company; routine: RoutineListItem }>();
  for (const { company, routines } of entries) {
    for (const routine of routines) byId.set(routine.id, { company, routine });
  }
  const nextById = new Map(upcoming.map((u) => [u.routine.id, u.atMs] as const));
  return pinnedIds.flatMap((id) => {
    const found = byId.get(id);
    if (!found) return [];
    const nextMs = nextById.get(id);
    const lastMs = found.routine.lastRun ? Date.parse(String(found.routine.lastRun.triggeredAt)) : NaN;
    const when =
      nextMs !== undefined && nextMs >= nowMs
        ? formatNext(nextMs, nowMs)
        : Number.isFinite(lastMs)
          ? `ran ${formatAgeMinutes(Math.max(0, Math.round((nowMs - lastMs) / 60_000)))} ago`
          : "manual";
    return [{ ...found, when }];
  });
}

/** The host's own test (RoutineRunVariablesDialog): null or blank is missing. */
export function isMissingVariableValue(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim().length === 0);
}

/** A required variable with no default: the routine cannot run on one press. */
export function routineNeedsInput(routine: Pick<RoutineListItem, "variables">): boolean {
  return (routine.variables ?? []).some((v) => v.required && isMissingVariableValue(v.defaultValue));
}

export type RoutineVariableDraft = Record<string, string>;

/** The form's starting values: each variable's default, as text. */
export function initialVariableDraft(variables: readonly RoutineVariable[]): RoutineVariableDraft {
  return Object.fromEntries(variables.map((v) => [v.name, v.defaultValue == null ? "" : String(v.defaultValue)]));
}

/** Labels of the required variables the draft leaves blank. */
export function missingRequiredVariables(variables: readonly RoutineVariable[], draft: RoutineVariableDraft): string[] {
  return variables.filter((v) => v.required && isMissingVariableValue(draft[v.name])).map((v) => v.label || v.name);
}

/**
 * The `variables` body for `POST /routines/:id/run`, typed the way the host's
 * dialog types them: blanks are left out (the server falls back to defaults),
 * numbers become numbers, booleans become booleans.
 */
export function variablesForRun(
  variables: readonly RoutineVariable[],
  draft: RoutineVariableDraft,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const v of variables) {
    const raw = draft[v.name];
    if (isMissingVariableValue(raw)) continue;
    if (v.type === "number") out[v.name] = Number(raw);
    else if (v.type === "boolean") out[v.name] = raw === "true";
    else out[v.name] = raw;
  }
  return out;
}
