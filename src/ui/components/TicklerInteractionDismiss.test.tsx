// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AttentionFeed, AttentionItem } from "@paperclipai/shared";
import { TicklerInteractionActions } from "./TicklerInteractionActions";
import { useTicklerCompanyData, type TicklerCompanyData } from "./useTicklerCompanyData";

const mockIssuesApi = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  listInteractions: vi.fn(),
  dismissInteraction: vi.fn(),
  acceptInteraction: vi.fn(),
  rejectInteraction: vi.fn(),
}));
const mockAttentionApi = vi.hoisted(() => ({ list: vi.fn() }));
const pushToast = vi.hoisted(() => vi.fn());
vi.mock("../host/api", async (importOriginal) => {
  const empty = async () => [];
  return {
    ...(await importOriginal<typeof import("../host/api")>()),
    issuesApi: mockIssuesApi,
    attentionApi: mockAttentionApi,
    dashboardApi: { summary: async () => ({}) },
    heartbeatsApi: { liveRunsForCompany: empty },
    projectsApi: { list: empty },
    agentsApi: { list: empty },
    approvalsApi: { list: empty },
    routinesApi: { list: empty },
    costsApi: { byAgent: empty },
  };
});
vi.mock("../host/shims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/shims")>()),
  useToastActions: () => ({ pushToast }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const question = (kind: string, id = "int-1") =>
  ({
    id: `att-${id}`,
    companyId: "c1",
    severity: "high",
    sourceKind: "issue_thread_interaction",
    dismissal: null,
    updatedAt: "2026-11-09T10:00:00.000Z",
    subject: { kind: "interaction", id, title: "Release plan", metadata: { kind, issueId: "i-1" } },
  }) as never as AttentionItem;

const interaction = (dismissedAt: string | null) => ({
  id: "int-1",
  issueId: "i-1",
  kind: "ask_user_questions",
  status: "pending",
  dismissedAt,
  payload: { version: 1, questions: [{ id: "q", prompt: "Ship?", selectionMode: "single", options: [{ id: "y", label: "Yes" }] }] },
});

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
const flush = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
const button = (label: string) =>
  Array.from(container.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === label) as HTMLButtonElement | undefined;

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  });
  await flush();
}

beforeEach(() => {
  for (const fn of Object.values(mockIssuesApi)) fn.mockReset();
  mockAttentionApi.list.mockReset();
  pushToast.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  queryClient.clear();
});

describe("Dismiss on a queue row", () => {
  it("sits beside the answer controls for every inline kind", async () => {
    for (const kind of ["request_confirmation", "ask_user_questions", "request_checkbox_confirmation"]) {
      await mount(<TicklerInteractionActions key={kind} item={question(kind)} onActed={() => {}} />);
      expect(button("Dismiss"), kind).toBeDefined();
    }
    await mount(<TicklerInteractionActions item={question("suggest_tasks")} onActed={() => {}} />);
    expect(button("Dismiss")).toBeUndefined();
  });

  it("dismisses with no confirm step, then reads as dismissed with no answer controls", async () => {
    const onActed = vi.fn();
    mockIssuesApi.dismissInteraction.mockResolvedValue(interaction("2026-11-09T10:05:00.000Z"));
    await mount(<TicklerInteractionActions item={question("request_confirmation")} onActed={onActed} />);
    await act(async () => button("Dismiss")!.click());
    await flush();
    expect(mockIssuesApi.dismissInteraction).toHaveBeenCalledWith("i-1", "int-1");
    expect(onActed).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-interaction-dismissed]")?.textContent).toBe("Dismissed, in history");
    expect(container.querySelector("button")).toBeNull();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Dismissed", tone: "success" }));
  });

  it("keeps the controls and says so when the host refuses", async () => {
    const onActed = vi.fn();
    mockIssuesApi.dismissInteraction.mockRejectedValue(new Error("Board access required"));
    await mount(<TicklerInteractionActions item={question("request_confirmation")} onActed={onActed} />);
    await act(async () => button("Dismiss")!.click());
    await flush();
    expect(onActed).not.toHaveBeenCalled();
    expect(button("Dismiss")).toBeDefined();
    expect(pushToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not dismiss", body: "Board access required", tone: "error" }));
  });

  it("shows a request dismissed elsewhere as dismissed in the dialog, with no form", async () => {
    mockIssuesApi.listInteractions.mockResolvedValue([interaction("2026-11-09T10:05:00.000Z")]);
    await mount(<TicklerInteractionActions item={question("ask_user_questions")} onActed={() => {}} />);
    await act(async () => (container.querySelector('[aria-label="Answer"]') as HTMLButtonElement).click());
    await flush();
    const dialog = document.querySelector('[data-slot="dialog-content"]') as HTMLElement;
    expect(dialog.textContent).toContain("Dismissed, in history");
    expect(dialog.querySelector("form")).toBeNull();
  });
});

describe("useTicklerCompanyData and dismissed requests", () => {
  let latest: TicklerCompanyData | undefined;
  function Probe() {
    latest = useTicklerCompanyData("c1");
    return null;
  }
  const feed = (items: AttentionItem[]): AttentionFeed =>
    ({ companyId: "c1", generatedAt: "", totalCount: items.length, countsBySourceKind: {}, items }) as never;

  beforeEach(() => {
    latest = undefined;
    mockIssuesApi.list.mockResolvedValue([]);
    mockAttentionApi.list.mockResolvedValue(feed([question("ask_user_questions")]));
  });

  it("drops a request the lookup says was dismissed, from the feed and Need-you", async () => {
    mockIssuesApi.listInteractions.mockResolvedValue([interaction("2026-11-09T10:05:00.000Z")]);
    await mount(<Probe />);
    await flush();
    expect(mockIssuesApi.listInteractions).toHaveBeenCalledWith("i-1");
    expect(latest?.attention?.items).toEqual([]);
    expect(latest?.needsBreakdown?.questions).toBe(0);
  });

  it("keeps the request when the lookup fails", async () => {
    mockIssuesApi.listInteractions.mockRejectedValue(new Error("boom"));
    await mount(<Probe />);
    await flush();
    expect(latest?.attention?.items.map((item) => item.subject.id)).toEqual(["int-1"]);
    expect(latest?.needsBreakdown?.questions).toBe(1);
  });

  it("drops a request dismissed from a row as the click lands", async () => {
    mockIssuesApi.listInteractions.mockResolvedValue([interaction(null)]);
    mockIssuesApi.dismissInteraction.mockResolvedValue(interaction("2026-11-09T10:05:00.000Z"));
    await mount(
      <>
        <Probe />
        <TicklerInteractionActions item={question("request_confirmation")} onActed={() => {}} />
      </>,
    );
    expect(latest?.needsBreakdown?.questions).toBe(1);
    await act(async () => button("Dismiss")!.click());
    await flush();
    expect(latest?.needsBreakdown?.questions).toBe(0);
  });
});
