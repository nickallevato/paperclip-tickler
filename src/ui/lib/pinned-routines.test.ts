import { describe, expect, it } from "vitest";
import type { Company, RoutineListItem, RoutineVariable } from "@paperclipai/shared";
import {
  initialVariableDraft,
  missingRequiredVariables,
  normalizePinnedRoutineIds,
  pinnedRoutineEntries,
  routineNeedsInput,
  togglePinnedRoutineId,
  variablesForRun,
} from "./pinned-routines";
import type { TicklerUpcomingRoutine } from "./queue";

const NOW = new Date(2026, 9, 7, 10, 0).getTime();
const company = { id: "c1", name: "Acme" } as Company;
const routine = (id: string, extra: Record<string, unknown> = {}) => ({ id, title: id, lastRun: null, ...extra }) as unknown as RoutineListItem;
const variable = (v: Partial<RoutineVariable>): RoutineVariable =>
  ({ name: "v", label: null, type: "text", defaultValue: null, required: false, options: [], ...v }) as RoutineVariable;

describe("pinned routine ids", () => {
  it("reads garbage as no pins and drops duplicates", () => {
    expect(normalizePinnedRoutineIds(null)).toEqual([]);
    expect(normalizePinnedRoutineIds("{")).toEqual([]);
    expect(normalizePinnedRoutineIds('{"a":1}')).toEqual([]);
    expect(normalizePinnedRoutineIds('["a", 3, "", "a", "b"]')).toEqual(["a", "b"]);
  });

  it("toggles", () => {
    expect(togglePinnedRoutineId(["a"], "b")).toEqual(["a", "b"]);
    expect(togglePinnedRoutineId(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("pinnedRoutineEntries", () => {
  it("keeps pin order, skips routines not loaded, and says when each runs", () => {
    const entries = [
      {
        company,
        routines: [
          routine("sched"),
          routine("ran", { lastRun: { triggeredAt: new Date(NOW - 2 * 3_600_000).toISOString() } }),
          routine("never"),
        ],
      },
    ];
    const upcoming = [{ routine: { id: "sched" }, atMs: NOW + 4 * 3_600_000 } as unknown as TicklerUpcomingRoutine];
    const out = pinnedRoutineEntries(["never", "gone", "ran", "sched"], entries, upcoming, NOW);
    expect(out.map((e) => e.routine.id)).toEqual(["never", "ran", "sched"]);
    expect(out[0].when).toBe("manual");
    expect(out[1].when).toBe("ran 2h ago");
    expect(out[2].when).toMatch(/^next 0?2:00|^next 14:00/);
  });

  it("names the weekday for a run that is not today", () => {
    const upcoming = [{ routine: { id: "r" }, atMs: NOW + 2 * 86_400_000 } as unknown as TicklerUpcomingRoutine];
    const [entry] = pinnedRoutineEntries(["r"], [{ company, routines: [routine("r")] }], upcoming, NOW);
    expect(entry.when).toMatch(/^next \S+ /);
  });
});

describe("routine variables", () => {
  it("needs input only for a required variable with no default", () => {
    expect(routineNeedsInput({ variables: [variable({ required: true, defaultValue: "x" })] })).toBe(false);
    expect(routineNeedsInput({ variables: [variable({ required: false })] })).toBe(false);
    expect(routineNeedsInput({ variables: [variable({ required: true, defaultValue: "  " })] })).toBe(true);
    expect(routineNeedsInput({ variables: [variable({ required: true })] })).toBe(true);
  });

  it("drafts from defaults, reports missing required ones, and types the run body", () => {
    const vars = [
      variable({ name: "version", label: "Version", required: true }),
      variable({ name: "count", type: "number", defaultValue: 3 }),
      variable({ name: "dry", type: "boolean", defaultValue: false }),
      variable({ name: "note" }),
    ];
    const draft = initialVariableDraft(vars);
    expect(draft).toEqual({ version: "", count: "3", dry: "false", note: "" });
    expect(missingRequiredVariables(vars, draft)).toEqual(["Version"]);
    expect(variablesForRun(vars, { ...draft, version: "1.2.0" })).toEqual({ version: "1.2.0", count: 3, dry: false });
  });
});
