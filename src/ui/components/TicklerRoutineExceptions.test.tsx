// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { upcomingRoutines, type TicklerUpcomingRoutine } from "../lib/queue";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TicklerPinnedRoutineEntry } from "../lib/pinned-routines";
import { TicklerRoutineExceptions } from "./TicklerRoutineExceptions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 7, 21, 12);
const company = { id: "c1", name: "Acme", issuePrefix: "ACM", logoUrl: null } as never;
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();
const inMins = (mins: number) => new Date(NOW + mins * 60_000).toISOString();

const upcoming = (id: string, title: string, nextRunAt: string, lastRun?: Record<string, unknown>) =>
  upcomingRoutines(
    [
      {
        company,
        routines: [
          {
            id,
            title,
            status: "active",
            lastRun: lastRun ?? null,
            activeIssue: null,
            triggers: [{ id: "t", kind: "cron", enabled: true, nextRunAt, label: null, cronExpression: "0 9 * * *" }],
          } as never,
        ],
      },
    ],
    NOW,
  )[0];

function render(items: TicklerUpcomingRoutine[], pinned: TicklerPinnedRoutineEntry[] = []): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <TicklerRoutineExceptions items={items} nowMs={NOW} pinned={pinned} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  return container;
}

describe("TicklerRoutineExceptions", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists only the broken routines and counts the healthy ones away", () => {
    const container = render([
      upcoming("ok1", "Nightly backup", inMins(60), { status: "completed" }),
      upcoming("ok2", "Weekly digest", inMins(120), { status: "completed" }),
      upcoming("bad", "Upgrade check", inMins(90), { status: "failed" }),
    ]);
    const rows = [...container.querySelectorAll("[data-routine-exception]")];
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Upgrade check");
    expect(container.textContent).not.toContain("Nightly backup");
    expect(container.textContent).toContain("2 healthy routines not shown");
    expect(container.querySelector("h3")?.textContent).toContain("1 needs attention");
  });

  it("says how late an overdue routine is", () => {
    const container = render([upcoming("late", "Hive report", at(2 * 24 * 60))]);
    const row = container.querySelector('[data-routine-exception="overdue"]') as HTMLElement;
    expect(row.textContent).toContain("overdue 2d");
  });

  it("opens the wedged issue rather than the routine when there is one", () => {
    const container = render([
      upcoming("wedged", "Inbox sweep", inMins(60), {
        status: "issue_created",
        linkedIssue: { id: "i1", identifier: "ACM-9", title: "Wedged", status: "blocked" },
      }),
    ]);
    expect(container.querySelector('[data-routine-exception="blocked"] a')?.getAttribute("href")).toBe(
      "/ACM/issues/ACM-9",
    );
  });

  it("draws nothing but a reassurance when every routine is healthy", () => {
    const container = render([upcoming("ok", "Nightly backup", inMins(60), { status: "completed" })]);
    expect(container.querySelectorAll("[data-routine-exception]")).toHaveLength(0);
    expect(container.textContent).toContain("all 1 routines healthy");
  });

  it("distinguishes having no routines from having no broken ones", () => {
    expect(render([]).textContent).toContain("nothing scheduled");
  });

  it("puts a pinned routine on top, and a broken pinned one there only once", () => {
    const ok = upcoming("ok", "Nightly backup", inMins(60), { status: "completed" });
    const bad = upcoming("bad", "Upgrade check", inMins(90), { status: "failed" });
    const container = render([ok, bad], [
      { company, routine: ok.routine, when: "next 13:00" },
      { company, routine: bad.routine, when: "next 13:30" },
    ]);
    const pinnedRows = [...container.querySelectorAll("[data-tickler-pinned-routines] li")];
    expect(pinnedRows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Nightly backup"),
      expect.stringContaining("Upgrade check"),
    ]);
    expect(pinnedRows[1].textContent).toContain("failed");
    expect(container.querySelectorAll("[data-routine-exception]")).toHaveLength(0);
    expect(container.querySelector("h3")?.textContent).toContain("1 needs attention");
    expect(container.textContent).not.toContain("routines healthy");
  });
});
