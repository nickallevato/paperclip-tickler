// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicklerHud } from "./TicklerHud";

const mockCompaniesApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockDashboardApi = vi.hoisted(() => ({ summary: vi.fn() }));

vi.mock("./host/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host/api")>()),
  companiesApi: mockCompaniesApi,
  dashboardApi: mockDashboardApi,
}));
vi.mock("./host/shims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host/shims")>()),
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));
vi.mock("./components/TicklerCompanySlot", () => ({
  TicklerCompanySlot: ({ company }: { company: { name: string } }) => (
    <tr data-company-slot>
      <td>row:{company.name}</td>
    </tr>
  ),
}));
vi.mock("./components/TicklerBriefing", () => ({
  TicklerBriefing: ({ since }: { since: string }) => <div data-testid="briefing">briefing since {since}</div>,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const summaryFor = (companyId: string, running: number, pendingApprovals: number) => ({
  companyId,
  agents: { active: 5, running, paused: 0, error: 0 },
  tasks: { open: 1, inProgress: 1, blocked: 0, done: 1 },
  costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 },
  pendingApprovals,
  budgets: { activeIncidents: 0, pendingApprovals, pausedAgents: 0, pausedProjects: 0 },
  runActivity: [],
});

describe("TicklerHud", () => {
  let container: HTMLDivElement;

  function render() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <TicklerHud />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    return root;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    localStorage.clear();
    mockCompaniesApi.list.mockResolvedValue([
      { id: "c1", name: "Acme", status: "active", issuePrefix: "ACM" },
      { id: "c2", name: "Globex", status: "active", issuePrefix: "GLO" },
      { id: "c3", name: "Gone", status: "archived", issuePrefix: "GON" },
    ]);
    mockDashboardApi.summary.mockImplementation((companyId: string) =>
      Promise.resolve(companyId === "c1" ? summaryFor("c1", 2, 1) : summaryFor("c2", 1, 0)),
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("renders the board: one slot row per active company and the queue rail, with no header totals", async () => {
    const root = render();
    await vi.waitFor(() => {
      expect(container.querySelectorAll("[data-company-slot]").length).toBe(2);
    });
    expect(container.textContent).toContain("row:Acme");
    expect(container.textContent).toContain("row:Globex");
    expect(container.textContent).not.toContain("row:Gone");
    expect(container.querySelector('[data-view="board"]')).not.toBeNull();
    // The page titles itself with the brand mark, not with a stock icon.
    expect(container.querySelector("[data-tickler-mark]")).not.toBeNull();
    expect(container.querySelector("[data-tickler-queue]")).not.toBeNull();
    expect(container.textContent).toContain("Needs you");
    // The header no longer carries its own company/running/spend readout: the
    // board's columns and totals row say all of it, and computing it cost a
    // second per-company summary fan-out.
    expect(container.textContent).not.toContain("2 companies");
    expect(container.textContent).not.toContain("3 running");
    // No classic chrome survives.
    expect(container.querySelector('[aria-label="View mode"]')).toBeNull();
    expect(container.querySelector('[aria-label="Layout columns"]')).toBeNull();
    expect(container.querySelector("[data-tickler-bar]")).toBeNull();
    act(() => root.unmount());
  });

  it("requests fullscreen on the kiosk button (jsdom lacks the real fullscreen API, so it's stubbed)", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Element.prototype as any).requestFullscreen = requestFullscreen;
    const root = render();
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Enter kiosk mode"]')).not.toBeNull();
    });
    await act(async () => {
      (container.querySelector('[aria-label="Enter kiosk mode"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("toggles alerts on and persists the choice", async () => {
    const root = render();
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Enable alerts"]')).not.toBeNull();
    });
    await act(async () => {
      (container.querySelector('[aria-label="Enable alerts"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(localStorage.getItem("tickler.alerts")).toBe("on");
    expect(container.querySelector('[aria-label="Disable alerts"]')).not.toBeNull();
    act(() => root.unmount());
  });

  it("persists the pane-order mode from the board header", async () => {
    const root = render();
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Org order"]')).not.toBeNull();
    });
    const hotButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Hot first");
    await act(async () => {
      hotButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(localStorage.getItem("tickler.sort")).toBe("hot");
    act(() => root.unmount());
  });

  it("opens the version row alongside the token panel from the gear", async () => {
    // The gear's panel answers "which Tickler am I on, and is there a newer
    // one" as well as the thresholds it started as.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(
          JSON.stringify(
            url.startsWith("https://registry.npmjs.org")
              ? { version: "99.0.0" }
              : { version: "0.0.1", packagePath: null },
          ),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const root = render();
    await vi.waitFor(() => {
      expect(container.querySelector('[aria-label="Token thresholds"]')).not.toBeNull();
    });
    await act(async () => {
      (container.querySelector('[aria-label="Token thresholds"]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(container.querySelector("[data-self-update]")).not.toBeNull();
    expect(container.querySelector("[data-token-settings]")).not.toBeNull();
    // And the update it found is offered in the header, without opening anything.
    await vi.waitFor(() => {
      expect(container.textContent).toContain("Update to 99.0.0");
    });
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("shows the briefing as the rail footer when the last visit is old, and not otherwise", async () => {
    localStorage.setItem("tickler.lastVisit", new Date(Date.now() - 60 * 60_000).toISOString());
    let root = render();
    await vi.waitFor(() => {
      expect(container.querySelector('[data-testid="briefing"]')).not.toBeNull();
    });
    expect(container.querySelector("[data-tickler-queue] [data-testid='briefing']")).not.toBeNull();
    act(() => root.unmount());

    localStorage.removeItem("tickler.lastVisit");
    root = render();
    await vi.waitFor(() => {
      expect(container.textContent).toContain("row:Acme");
    });
    expect(container.querySelector('[data-testid="briefing"]')).toBeNull();
    act(() => root.unmount());
  });
});
