// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company } from "@paperclipai/shared";
import { TicklerQueue } from "./TicklerQueue";
import {
  countQueueByAge,
  deriveQueueItems,
  filterQueueByAge,
  groupQueue,
  summarizeQueue,
  type TicklerQueueAgeFilter,
} from "../lib/queue";

const mockApprovalsApi = vi.hoisted(() => ({ approve: vi.fn(), reject: vi.fn(), listIssues: vi.fn() }));
const mockIssuesApi = vi.hoisted(() => ({ acceptInteraction: vi.fn(), rejectInteraction: vi.fn(), listInteractions: vi.fn() }));
vi.mock("../host/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/api")>()),
  approvalsApi: mockApprovalsApi,
  issuesApi: mockIssuesApi,
}));
vi.mock("../host/shims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/shims")>()),
  useToastActions: () => ({ pushToast: vi.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.UTC(2026, 7, 21, 12);
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();

const acme = { id: "c1", name: "Acme", issuePrefix: "ACM", status: "active" } as never as Company;
const globex = { id: "c2", name: "Globex", issuePrefix: "GLO", status: "active" } as never as Company;

function buildItems() {
  return [
    ...deriveQueueItems({
      companyId: "c1",
      approvals: [{ id: "ap-1", type: "budget_increase", createdAt: new Date(at(12)), payload: {} }] as never,
      attention: {
        items: [
          {
            id: "blk",
            severity: "critical",
            sourceKind: "blocker_attention",
            activityAt: at(60),
            dismissal: null,
            subject: { kind: "issue", id: "i-1", title: "Deploy blocked", identifier: "ACM-212", href: "/ACM/issues/ACM-212" },
            whyNow: "blocked",
            detail: null,
          },
          {
            id: "ask",
            severity: "medium",
            sourceKind: "issue_thread_interaction",
            activityAt: at(30),
            dismissal: null,
            subject: {
              kind: "interaction",
              id: "int-1",
              title: "Questions need answers",
              identifier: null,
              status: "pending",
              href: "/ACM/issues/ACM-77#interaction-int-1",
              metadata: { kind: "ask_user_questions", issueId: "i-77" },
            },
            whyNow: "Questions need answers on an issue thread.",
            detail: { kind: "questions", questionCount: 3, firstQuestionText: "Which class do you select for the fall term?", images: [] },
          },
          {
            id: "confirm",
            severity: "medium",
            sourceKind: "issue_thread_interaction",
            activityAt: at(10 * 24 * 60),
            dismissal: null,
            subject: {
              kind: "interaction",
              id: "int-2",
              title: "Confirmation requested",
              identifier: null,
              status: "pending",
              href: "/ACM/issues/ACM-77#interaction-int-2",
              metadata: { kind: "request_confirmation", issueId: "i-77" },
            },
            whyNow: "Confirmation requested on an issue thread.",
            detail: { kind: "confirmation", promptExcerpt: "Ship the release?", isPlanTarget: false, images: [] },
            decisionVerbs: [
              { id: "accept", label: "Ship it", description: "" },
              { id: "reject", label: "Hold", description: "" },
            ],
          },
          {
            id: "low",
            severity: "low",
            sourceKind: "review",
            activityAt: at(900),
            dismissal: null,
            subject: { kind: "issue", id: "i-2", title: "Tidy the README", identifier: "ACM-9", href: null },
            whyNow: "review",
            detail: null,
          },
        ],
      } as never,
      agents: [],
      routines: [],
      issues: [{ id: "i-77", identifier: "ACM-77", title: "Fall class registration", status: "in_review" }] as never,
      nowMs: NOW,
    }),
    ...deriveQueueItems({
      companyId: "c2",
      approvals: [],
      attention: undefined,
      agents: [
        {
          id: "ceo-2",
          name: "Atlas",
          role: "ceo",
          status: "active",
          lastHeartbeatAt: new Date(at(130)),
          runtimeConfig: { heartbeat: { enabled: true, intervalSec: 900 } },
        } as never,
      ],
      routines: [],
      nowMs: NOW,
    }),
  ];
}

describe("TicklerQueue", () => {
  let container: HTMLDivElement;
  const onActed = vi.fn();
  const onGrouping = vi.fn();
  const onSort = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    mockApprovalsApi.approve.mockResolvedValue({ id: "ap-1", status: "approved" });
    onActed.mockReset();
    onGrouping.mockReset();
    onSort.mockReset();
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const onClearFilter = vi.fn();
  const onAgeFilter = vi.fn();

  function render(
    grouping: "severity" | "company" = "severity",
    filterCompany: Company | null = null,
    ageFilter: TicklerQueueAgeFilter = "all",
  ) {
    const all = buildItems().filter((item) => !filterCompany || item.companyId === filterCompany.id);
    // The page filters before it groups, so the harness has to as well —
    // otherwise the chips would be tested against a rail nobody renders.
    const items = filterQueueByAge(all, ageFilter, NOW);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <TicklerQueue
              groups={groupQueue(items, grouping, [acme, globex])}
              summary={summarizeQueue(items, NOW)}
              grouping={grouping}
              onGrouping={onGrouping}
              sort="oldest"
              onSort={onSort}
              ageFilter={ageFilter}
              onAgeFilter={onAgeFilter}
              ageCounts={countQueueByAge(all, NOW)}
              companiesById={{ c1: acme, c2: globex }}
              nowMs={NOW}
              onActed={onActed}
              footer={<span data-testid="footer">since you last looked</span>}
              filterCompany={filterCompany}
              onClearFilter={onClearFilter}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    return root;
  }

  it("lists Now items in order with their actions and folds Later behind a count", () => {
    const root = render();
    const rows = Array.from(container.querySelectorAll("[data-queue-item]")).map((row) => row.getAttribute("data-queue-item"));
    // Now bucket: critical first, then rank ties (heartbeat, approval) oldest first; Later is folded.
    expect(rows).toEqual(["attention:blk", "heartbeat:ceo-2", "approval:ap-1"]);
    expect(container.textContent).toContain("ACM-212");
    expect(container.textContent).toContain("Deploy blocked");
    expect(container.textContent).toContain("Atlas heartbeat overdue");
    expect(container.querySelector('[aria-label="Approve"]')).not.toBeNull();
    expect(container.querySelector('[data-queue-item="heartbeat:ceo-2"] a')).not.toBeNull();
    // Later is folded: the low item is counted, not listed.
    expect(container.textContent).toContain("3 low-priority notices");
    expect(container.querySelector('[data-queue-item="attention:low"]')).toBeNull();
    // header: 3 urgent, oldest is the 130m-old heartbeat
    expect(container.textContent).toContain("oldest 2h");
    expect(container.querySelector('[data-testid="footer"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("expands Later on demand", async () => {
    const root = render();
    const later = container.querySelector('[data-queue-group="later"] button[aria-expanded]') as HTMLButtonElement;
    expect(later.textContent).toContain("Later");
    await act(async () => {
      later.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-queue-item="attention:low"]')).not.toBeNull();
    expect(container.textContent).toContain("Tidy the README");
    act(() => root.unmount());
  });

  it("names the issue behind a thread interaction and shows the ask itself", async () => {
    const root = render();
    await act(async () => {
      (container.querySelector('[data-queue-group="later"] button[aria-expanded]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const row = container.querySelector('[data-queue-item="attention:ask"]') as HTMLElement;
    expect(row.textContent).toContain("ACM-77");
    expect(row.textContent).toContain("Fall class registration");
    expect(row.textContent).not.toContain("Questions need answers");
    expect(row.querySelector("[data-queue-ask]")?.textContent).toContain("3 questions · Which class do you select for the fall term?");
    expect(row.textContent).toContain("questions");
    expect(row.querySelector('[aria-label="Answer"], a:not([title])')?.textContent).toContain("Answer");
    act(() => root.unmount());
  });

  it("confirms a plain confirmation inline with the server's verb and refetches", async () => {
    mockIssuesApi.acceptInteraction.mockResolvedValue({ id: "int-2", status: "accepted" });
    const root = render();
    await act(async () => {
      (container.querySelector('[data-queue-group="later"] button[aria-expanded]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    const row = container.querySelector('[data-queue-item="attention:confirm"]') as HTMLElement;
    // 10 days old → amber ramp
    expect(row.querySelector("[data-age-tone]")?.getAttribute("data-age-tone")).toBe("aging");
    const accept = row.querySelector('[aria-label="Ship it"]') as HTMLButtonElement;
    expect(row.querySelector('[aria-label="Hold"]')).not.toBeNull();
    await act(async () => {
      accept.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockIssuesApi.acceptInteraction).toHaveBeenCalledWith("i-77", "int-2");
    expect(onActed).toHaveBeenCalledWith("c1");
    act(() => root.unmount());
  });

  it("groups by kind in a fixed order", () => {
    const items = buildItems();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <TicklerQueue
              groups={groupQueue(items, "kind", [acme, globex])}
              summary={summarizeQueue(items, NOW)}
              grouping="kind"
              onGrouping={onGrouping}
              sort="oldest"
              onSort={onSort}
              ageFilter="all"
              onAgeFilter={onAgeFilter}
              ageCounts={countQueueByAge(items, NOW)}
              companiesById={{ c1: acme, c2: globex }}
              nowMs={NOW}
              onActed={onActed}
              onClearFilter={onClearFilter}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    // kind grouping: questions, confirmations, approvals, heartbeats, blockers, other(review)
    const headers = Array.from(container.querySelectorAll("[data-queue-group]")).map((group) => group.getAttribute("data-queue-group"));
    expect(headers).toEqual(["questions", "confirmations", "approvals", "heartbeats", "blockers", "other"]);
    act(() => root.unmount());
  });

  it("groups by company when asked, in the given company order", () => {
    const root = render("company");
    const headers = Array.from(container.querySelectorAll("[data-queue-group]")).map((group) => group.getAttribute("data-queue-group"));
    expect(headers).toEqual(["c1", "c2"]);
    const grouping = Array.from(container.querySelectorAll('[aria-label="Queue grouping"] button'));
    // Decide by, Severity, Company, Kind, Project, Age.
    expect(grouping.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false", "false", "false"]);
    act(() => {
      grouping[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onGrouping).toHaveBeenCalledWith("severity");
    act(() => root.unmount());
  });

  it("folds any group from its header, with Later starting shut", () => {
    const root = render();
    const now = container.querySelector('[data-queue-group="now"]') as HTMLElement;
    const later = container.querySelector('[data-queue-group="later"]') as HTMLElement;
    expect(now.getAttribute("data-open")).toBe("true");
    expect(later.getAttribute("data-open")).toBe("false");
    expect(now.querySelectorAll("li").length).toBeGreaterThan(0);

    act(() => {
      (now.querySelector("button") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      (later.querySelector("button") as HTMLButtonElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector('[data-queue-group="now"]')?.getAttribute("data-open")).toBe("false");
    expect(container.querySelector('[data-queue-group="now"]')?.querySelectorAll("li").length).toBe(0);
    expect(container.querySelector('[data-queue-group="later"]')?.getAttribute("data-open")).toBe("true");
    act(() => root.unmount());
  });

  it("flips the age sort from the header toggle", () => {
    const root = render();
    const toggle = container.querySelector('[aria-label="Sort newest first"]') as HTMLButtonElement;
    expect(toggle.textContent).toContain("oldest");
    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSort).toHaveBeenCalledWith("newest");
    act(() => root.unmount());
  });

  it("approves from the rail and tells the owning company to refetch", async () => {
    const root = render();
    const approve = container.querySelector('[aria-label="Approve"]') as HTMLButtonElement;
    await act(async () => {
      approve.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(mockApprovalsApi.approve).toHaveBeenCalledWith("ap-1", undefined);
    expect(onActed).toHaveBeenCalledWith("c1");
    act(() => root.unmount());
  });

  it("opens an approval from its title or a labelled Open that sits away from Reject", () => {
    const root = render();
    const row = container.querySelector('[data-queue-item="approval:ap-1"]') as HTMLElement;
    const title = row.querySelector("a[title]") as HTMLAnchorElement;
    expect(title.getAttribute("href")).toBe("/ACM/approvals/ap-1");
    const controls = [...row.querySelectorAll("a:not([title]), button[aria-label]")].map(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim(),
    );
    expect(controls.slice(0, 3)).toEqual(["Open", "Approve", "Reject"]);
    act(() => root.unmount());
  });

  it("rejects only on a second tap, and a lapsed first tap disarms", async () => {
    vi.useFakeTimers();
    mockApprovalsApi.reject.mockResolvedValue({ id: "ap-1", status: "rejected" });
    const root = render();
    const reject = () =>
      container.querySelector('[data-queue-item="approval:ap-1"] [aria-label$="eject"]') as HTMLButtonElement;
    act(() => reject().click());
    expect(mockApprovalsApi.reject).not.toHaveBeenCalled();
    expect(reject().textContent).toContain("Confirm reject");
    act(() => vi.advanceTimersByTime(4000));
    expect(reject().textContent).not.toContain("Confirm");
    act(() => reject().click());
    await act(async () => {
      reject().click();
      await vi.runAllTimersAsync();
    });
    expect(mockApprovalsApi.reject).toHaveBeenCalledWith("ap-1", undefined);
    vi.useRealTimers();
    act(() => root.unmount());
  });

  it("shows a clearable chip while filtered to one company", () => {
    const root = render("severity", globex);
    expect(container.textContent).toContain("Only Globex");
    const rows = Array.from(container.querySelectorAll("[data-queue-item]")).map((row) => row.getAttribute("data-queue-item"));
    expect(rows).toEqual(["heartbeat:ceo-2"]);
    act(() => {
      (container.querySelector('[aria-label="Show all orgs"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onClearFilter).toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe("TicklerQueue age chips", () => {
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  const onAgeFilter = vi.fn();

  function renderChips(ageFilter: TicklerQueueAgeFilter = "all") {
    const all = buildItems();
    const items = filterQueueByAge(all, ageFilter, NOW);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <TicklerQueue
              groups={groupQueue(items, "severity", [acme, globex])}
              summary={summarizeQueue(items, NOW)}
              grouping="severity"
              onGrouping={vi.fn()}
              sort="oldest"
              onSort={vi.fn()}
              ageFilter={ageFilter}
              onAgeFilter={onAgeFilter}
              ageCounts={countQueueByAge(all, NOW)}
              companiesById={{ c1: acme, c2: globex }}
              nowMs={NOW}
              onActed={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    return root;
  }

  const chip = (filter: string) => container.querySelector(`[data-age-chip="${filter}"]`) as HTMLButtonElement;

  it("offers all five buckets, each carrying its own count", () => {
    const root = renderChips();
    const chips = [...container.querySelectorAll("[data-age-chip]")].map((node) => node.getAttribute("data-age-chip"));
    expect(chips).toEqual(["all", "today", "yesterday", "week", "old"]);
    // The fixture spans the buckets: four raised today, one yesterday, one
    // from well over a week ago, and nothing in between.
    expect(chip("all").textContent).toContain("6");
    expect(chip("today").textContent).toContain("4");
    expect(chip("yesterday").textContent).toContain("1");
    expect(chip("week").textContent).toContain("0");
    expect(chip("old").textContent).toContain("1");
    act(() => root.unmount());
  });

  it("narrows the rail to the chosen bucket, opening Later so the slice is not hidden", () => {
    // The one item older than a week is a low-priority notice, which normally
    // sits folded. Asking for "Old" and being shown an apparently empty rail
    // would be the filter lying about what it found.
    const root = renderChips("old");
    expect(container.querySelectorAll("[data-queue-item]")).toHaveLength(1);
    act(() => root.unmount());
  });

  it("counts the whole queue, not the slice on screen, so a chip says what it is holding", () => {
    // Standing in Today must not zero out the other chips — the counts are the
    // only way to tell an empty bucket from a hidden one.
    const root = renderChips("today");
    expect(chip("all").textContent).toContain("6");
    expect(chip("old").textContent).toContain("1");
    expect(chip("today").getAttribute("aria-pressed")).toBe("true");
    expect(chip("all").getAttribute("aria-pressed")).toBe("false");
    act(() => root.unmount());
  });

  it("disables an empty bucket rather than removing it, so the chips never move", () => {
    const root = renderChips();
    expect(chip("week").disabled).toBe(true);
    expect(chip("today").disabled).toBe(false);
    expect(chip("old").disabled).toBe(false);
    act(() => root.unmount());
  });

  it("reports the chosen bucket upward", () => {
    const root = renderChips();
    act(() => {
      chip("yesterday").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onAgeFilter).toHaveBeenCalledWith("yesterday");
    act(() => root.unmount());
  });

  it("names the bucket you are standing in when it turns out to be empty", () => {
    const root = renderChips("week");
    expect(container.querySelectorAll("[data-queue-item]")).toHaveLength(0);
    expect(container.textContent).toContain("Nothing here from the last week");
    act(() => root.unmount());
  });
});
