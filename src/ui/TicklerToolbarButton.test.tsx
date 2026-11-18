import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TicklerToolbarButton } from "./TicklerToolbarButton";
import { installTestBridge } from "../test/bridge";
import { notifyToolbarBadge } from "./lib/toolbar-badge";

const mockCompaniesApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockAttentionApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./host/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./host/api")>()),
  companiesApi: mockCompaniesApi,
  attentionApi: mockAttentionApi,
}));

const company = (id: string, status = "active") => ({ id, name: id, status });
const NEW = new Date().toISOString();
const OLD = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();
const row = (decideBy: string | null, activityAt = NEW) => ({
  id: `a-${Math.random()}`,
  activityAt,
  sourceKind: "blocker_attention",
  subject: { id: "issue-1" },
  severity: "high",
  decideBy,
  snoozedUntil: null,
  dismissal: null,
});

beforeEach(() => {
  localStorage.clear();
  mockCompaniesApi.list.mockReset().mockResolvedValue([]);
  mockAttentionApi.list.mockReset().mockResolvedValue({ items: [] });
});

describe("TicklerToolbarButton", () => {
  it("links to the company-prefixed tickler route", () => {
    render(<TicklerToolbarButton context={{ companyPrefix: "LIOA" }} />);
    expect(screen.getByRole("link", { name: /Tickler/ })).toHaveAttribute("href", "/LIOA/tickler");
  });

  it("carries the brand mark, which stays out of the accessible name", () => {
    const { container } = render(<TicklerToolbarButton context={{ companyPrefix: "LIOA" }} />);
    expect(container.querySelector("[data-tickler-mark]")).not.toBeNull();
    // The link is labelled once, by its own aria-label.
    expect(screen.getByRole("link", { name: "Tickler — all orgs" })).toBeInTheDocument();
  });

  it("falls back to the host context prefix when the slot passes none", () => {
    render(<TicklerToolbarButton />);
    // installTestBridge defaults companyPrefix to ACME.
    expect(screen.getByRole("link", { name: /Tickler/ })).toHaveAttribute("href", "/ACME/tickler");
  });

  it("navigates in-app, since tickler is always same-company", async () => {
    const { navigate } = installTestBridge();
    render(<TicklerToolbarButton context={{ companyPrefix: "LIOA" }} />);
    await userEvent.click(screen.getByRole("link", { name: /Tickler/ }));
    expect(navigate).toHaveBeenCalledWith("/LIOA/tickler");
  });
});

describe("TicklerToolbarButton arrived-today count", () => {
  const feeds: Record<string, unknown[]> = {
    c1: [row(null), row("this_week", OLD)],
    c2: [row("today"), row(null, OLD)],
  };
  beforeEach(() => {
    mockCompaniesApi.list.mockResolvedValue([company("c1"), company("c2"), company("c3", "archived")]);
    mockAttentionApi.list.mockImplementation(async (id: string) => ({ items: feeds[id] ?? [] }));
  });

  it("counts what arrived today across the orgs the board shows, decide-by or not, and names it in the label", async () => {
    const { container } = render(<TicklerToolbarButton context={{ companyPrefix: "LIOA" }} />);
    await screen.findByRole("link", { name: "Tickler — 2 new today" });
    const pill = container.querySelector("[data-tickler-today]");
    expect(pill).toHaveTextContent("2");
    expect(pill).not.toHaveAttribute("data-overdue");
    // Archived orgs are never fetched, as on the board.
    expect(mockAttentionApi.list.mock.calls.map(([id]) => id).sort()).toEqual(["c1", "c2"]);
  });

  it("turns alarm-coloured when anything is overdue, whenever it arrived", async () => {
    feeds.c2 = [row("2000-01-01", OLD)];
    const { container } = render(<TicklerToolbarButton />);
    await screen.findByRole("link", { name: "Tickler — 1 new today (1 overdue)" });
    expect(container.querySelector("[data-tickler-today]")).toHaveAttribute("data-overdue", "true");
    feeds.c2 = [row("today"), row(null, OLD)];
  });

  it("skips hidden orgs", async () => {
    localStorage.setItem("tickler.hidden", JSON.stringify(["c2"]));
    render(<TicklerToolbarButton />);
    await screen.findByRole("link", { name: "Tickler — 1 new today" });
    expect(mockAttentionApi.list).toHaveBeenCalledTimes(1);
  });

  it("shows no number rather than a low one when an org's feed fails", async () => {
    mockAttentionApi.list.mockImplementation(async (id: string) => {
      if (id === "c2") throw new Error("boom");
      return { items: feeds[id] ?? [] };
    });
    const { container } = render(<TicklerToolbarButton />);
    await waitFor(() => expect(mockAttentionApi.list).toHaveBeenCalledWith("c2"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector("[data-tickler-today]")).toBeNull();
    expect(screen.getByRole("link", { name: "Tickler — all orgs" })).toBeInTheDocument();
  });

  it("fetches nothing when turned off, and follows the setting as the page changes it", async () => {
    localStorage.setItem("tickler.toolbarBadge", "off");
    const { container } = render(<TicklerToolbarButton />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockCompaniesApi.list).not.toHaveBeenCalled();
    expect(mockAttentionApi.list).not.toHaveBeenCalled();
    expect(container.querySelector("[data-tickler-today]")).toBeNull();

    act(() => {
      localStorage.setItem("tickler.toolbarBadge", "today");
      notifyToolbarBadge();
    });
    await screen.findByRole("link", { name: "Tickler — 2 new today" });
  });
});
