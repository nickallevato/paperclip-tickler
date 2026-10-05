// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { TicklerRecentTask, TicklerRecentTasks as TicklerRecentTasksModel } from "../lib/queue";
import type { TicklerRailPaneBudget } from "../lib/rail-budget";
import { TicklerRecentTasks } from "./TicklerRecentTasks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 7, 21, 12);
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const company = { id: "c1", name: "Acme", issuePrefix: "ACM", logoUrl: null } as never;
const run = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "r1",
    status: "running",
    createdAt: at(10),
    startedAt: at(9),
    agentName: "Quill",
    issueId: "i-1",
    currentStatusMessage: "Drafting section 2",
    nextAction: null,
    triggerDetail: null,
    invocationSource: "schedule",
    ...overrides,
  }) as never;
const issue = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "i-1",
    identifier: "ACM-7",
    title: "Write the quarterly report",
    status: "in_progress",
    updatedAt: at(9),
    ...overrides,
  }) as never;

const tasks = (items: TicklerRecentTask[], counts: Partial<TicklerRecentTasksModel> = {}): TicklerRecentTasksModel => ({
  items,
  working: items.filter((item) => item.phase === "working").length,
  queued: items.filter((item) => item.phase === "queued").length,
  hidden: 0,
  ...counts,
});

describe("TicklerRecentTasks", () => {
  let container: HTMLDivElement;
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function render(
    model: TicklerRecentTasksModel,
    budget?: TicklerRailPaneBudget,
    narrow?: boolean,
    expand?: { expanded?: boolean; expandable?: boolean; onExpanded?: (expanded: boolean) => void },
  ) {
    container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <TicklerRecentTasks
            tasks={model}
            nowMs={NOW}
            budget={budget}
            narrow={narrow}
            expanded={expand?.expanded}
            expandable={expand?.expandable}
            onExpanded={expand?.onExpanded}
          />
        </MemoryRouter>,
      );
    });
    return root;
  }

  const many = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      key: `c1:i-${index}`,
      company,
      issue: issue({ id: `i-${index}`, identifier: `ACM-${index}` }),
      run: run({ id: `r${index}`, issueId: `i-${index}` }),
      phase: "working" as const,
      atMs: NOW - index * 60_000,
    }));

  it("puts the ticket, its title and the elapsed time on one row, with the narration behind a hover", () => {
    const root = render(
      tasks([{ key: "c1:i-1", company, issue: issue(), run: run(), phase: "working", atMs: NOW - 9 * 60_000 }]),
    );
    const row = container.querySelector("li") as HTMLElement;
    expect(row.textContent).toContain("ACM-7");
    // The whole point of the rail column: the title fits on the row now.
    expect(row.textContent).toContain("Write the quarterly report");
    expect(row.textContent).toContain("9m");
    // The narration is the hover's job — a second line here would make the
    // pane's height track what the agent happens to be saying.
    expect(row.textContent).not.toContain("Drafting section 2");
    expect(row.querySelector("a")?.getAttribute("href")).toBe("/ACM/issues/ACM-7");
    expect(row.querySelector("[data-slot='hover-card-trigger']")).not.toBeNull();
    act(() => root.unmount());
  });

  it("marks live rows with the live icons and idle ones with the task's own status glyph", () => {
    const root = render(
      tasks([
        { key: "c1:i-1", company, issue: issue(), run: run(), phase: "working", atMs: NOW - 9 * 60_000 },
        {
          key: "c1:i-2",
          company,
          issue: issue({ id: "i-2", identifier: "ACM-8", status: "in_review" }),
          run: run({ id: "r2", status: "queued", startedAt: null, issueId: "i-2" }),
          phase: "queued",
          atMs: NOW - 60_000,
        },
        {
          key: "c1:i-3",
          company,
          issue: issue({ id: "i-3", identifier: "ACM-9", status: "done" }),
          run: undefined,
          phase: null,
          atMs: NOW - 4 * 60_000,
        },
      ]),
    );
    const rows = Array.from(container.querySelectorAll("li")) as HTMLElement[];
    expect(rows.map((row) => row.getAttribute("data-recent-task"))).toEqual(["working", "queued", "idle"]);
    expect(rows[0].querySelector("[data-live-dot]")).not.toBeNull();
    expect(rows[1].querySelector("[data-queued-dot]")).not.toBeNull();
    expect(rows[1].querySelector("[data-live-dot]")).toBeNull();
    // Nothing is running on the third, so it shows what state it is in instead.
    expect(rows[2].querySelector("[data-live-dot]")).toBeNull();
    expect(rows[2].querySelector("svg")).not.toBeNull();
    expect(rows[2].textContent).toContain("4m");
    expect(container.querySelector("h3")?.textContent).toContain("1 working");
    expect(container.querySelector("h3")?.textContent).toContain("1 queued");
    act(() => root.unmount());
  });

  it("scrolls inside the height the rail gave it rather than growing with the fleet", () => {
    const root = render(tasks(many(12), { hidden: 5 }), { rows: 4, height: 180, hidden: 8, demoted: false });
    // Every row is on the page — the pane scrolls to them rather than the page
    // growing to fit them — and the header owns up to the ones under the fold.
    expect(container.querySelectorAll("li")).toHaveLength(12);
    const list = container.querySelector("ul")?.className ?? "";
    expect(list).toContain("overflow-y-auto");
    expect(list).not.toContain("max-h-");
    const pane = container.querySelector<HTMLElement>("[data-rail-pane='recent']")!;
    expect(pane.style.height).toBe("180px");
    expect(pane.querySelector("[data-rail-more]")?.textContent).toBe("+8 more");
    expect(container.textContent).toContain("5 more touched today");
    act(() => root.unmount());
  });

  it("keeps its own height, and no rail markers to measure, when the rail is not budgeting", () => {
    const root = render(tasks([{ key: "c1:i-1", company, issue: issue(), run: run(), phase: "working", atMs: NOW }]));
    const pane = container.querySelector<HTMLElement>("[data-rail-pane='recent']")!;
    expect(pane.style.height).toBe("");
    expect(pane.querySelector("[data-rail-more]")).toBeNull();
    expect(pane.querySelectorAll("[data-rail-row]")).toHaveLength(1);
    act(() => root.unmount());
  });

  it("falls back to its header when the rail cannot seat even three rows", () => {
    const root = render(tasks(many(9)), { rows: 0, height: null, hidden: 9, demoted: true });
    // Nine clipped rows would say less than the header does, and the pane it
    // would have pushed off the bottom of the rail says nothing at all.
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector("h3")?.textContent).toContain("9 working");
    expect(container.querySelector("[data-rail-more]")?.textContent).toBe("+9 more");
    act(() => root.unmount());
  });

  it("caps itself at four rows and a count when the board is one column", () => {
    const root = render(tasks(many(12), { hidden: 5 }), undefined, true);
    // Narrow there is no budget to scroll the pane inside, so the rows it is
    // not going to show are not on the page at all — sixteen of them here is
    // ~520px of a phone's first screen, ahead of the queue.
    expect(container.querySelectorAll("li")).toHaveLength(4);
    // One count, not two: the eight rows dropped here plus the five the model
    // never handed over.
    expect(container.textContent).toContain("13 more touched today");
    expect(container.textContent).not.toContain("5 more touched today");
    // The header still counts every live run, capped away or not — which is the
    // same thing it does for a demoted pane.
    expect(container.querySelector("h3")?.textContent).toContain("12 working");
    act(() => root.unmount());
  });

  it("leaves the list alone when narrow and the whole of it fits", () => {
    const root = render(tasks(many(3)), undefined, true);
    expect(container.querySelectorAll("li")).toHaveLength(3);
    expect(container.querySelector("[data-rail-foot]")).toBeNull();
    act(() => root.unmount());
  });

  it("has no expand button at all unless it is given somewhere to report the press", () => {
    const root = render(tasks(many(3)));
    expect(container.querySelector("[data-recent-expand]")).toBeNull();
    act(() => root.unmount());
  });

  it("reports the press, and says which state it is in", () => {
    const pressed: boolean[] = [];
    const root = render(tasks(many(3)), undefined, false, { expanded: false, onExpanded: (next) => pressed.push(next) });
    const button = container.querySelector<HTMLButtonElement>("[data-recent-expand]")!;
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.getAttribute("aria-label")).toBe("Expand Recent");
    act(() => button.click());
    expect(pressed).toEqual([true]);
    act(() => root.unmount());
  });

  it("offers the way back out when it is expanded", () => {
    const pressed: boolean[] = [];
    const root = render(tasks(many(3)), undefined, false, { expanded: true, onExpanded: (next) => pressed.push(next) });
    const button = container.querySelector<HTMLButtonElement>("[data-recent-expand]")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Collapse Recent");
    act(() => button.click());
    expect(pressed).toEqual([false]);
    act(() => root.unmount());
  });

  it("doubles its own cap when it is expanded and the board is one column", () => {
    // Narrow there is no rail height for the fold below to free up, so this is
    // the whole of what expanding can mean: eight rows instead of four.
    const root = render(tasks(many(12), { hidden: 5 }), undefined, true, { expanded: true, onExpanded: () => {} });
    expect(container.querySelectorAll("li")).toHaveLength(8);
    expect(container.textContent).toContain("9 more touched this week");
    act(() => root.unmount());
  });

  // PLI-271 came back: expanding doubled the pane and the row cap and left the
  // list a day deep, so on a board with four tasks in a day it folded two panes
  // to seat rows that did not exist. The pane says which window it is on, and
  // the toggle refuses the trade when a week holds no more than a day.
  it("says it is on the week once it is expanded", () => {
    const root = render(tasks(many(20)), undefined, false, { expanded: true, onExpanded: () => {} });
    expect(container.querySelector("[data-recent-window]")?.textContent).toBe("7 days");
    act(() => root.unmount());
  });

  it("does not claim the week while it is collapsed", () => {
    const root = render(tasks(many(20)), undefined, false, { expanded: false, onExpanded: () => {} });
    expect(container.querySelector("[data-recent-window]")).toBeNull();
    act(() => root.unmount());
  });

  it("refuses the press when a week would show no more than the day already does", () => {
    const pressed: boolean[] = [];
    const root = render(tasks(many(3)), undefined, false, {
      expanded: false,
      expandable: false,
      onExpanded: (next) => pressed.push(next),
    });
    const button = container.querySelector<HTMLButtonElement>("[data-recent-expand]")!;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toContain("Nothing to expand");
    act(() => button.click());
    expect(pressed).toEqual([]);
    act(() => root.unmount());
  });

  it("still collapses when it is expanded and the board has since gone quiet", () => {
    const pressed: boolean[] = [];
    const root = render(tasks(many(3)), undefined, false, {
      expanded: true,
      expandable: false,
      onExpanded: (next) => pressed.push(next),
    });
    const button = container.querySelector<HTMLButtonElement>("[data-recent-expand]")!;
    expect(button.disabled).toBe(false);
    act(() => button.click());
    expect(pressed).toEqual([false]);
    act(() => root.unmount());
  });

  it("keeps the button reachable while it is demoted to its header", () => {
    // The pane the rail could not seat is exactly the one somebody wants to
    // expand, so the toggle lives in the header rather than with the rows.
    const root = render(tasks(many(9)), { rows: 0, height: null, hidden: 9, demoted: true }, false, {
      expanded: false,
      onExpanded: () => {},
    });
    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.querySelector("[data-recent-expand]")).not.toBeNull();
    act(() => root.unmount());
  });

  it("says so when nothing is running and nothing has moved", () => {
    const root = render(tasks([]));
    expect(container.textContent).toContain("nothing running");
    expect(container.textContent).toContain("nothing has moved today");
    expect(container.querySelector("li")).toBeNull();
    act(() => root.unmount());
  });
});
