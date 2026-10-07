// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Company, RoutineListItem } from "@paperclipai/shared";
import { ApiError } from "../host/api";
import { TICKLER_RUN_ARM_MS, TicklerPinRoutinePicker, TicklerPinnedRoutineRows, type TicklerPinnedRoutine } from "./TicklerPinnedRoutines";

const mockRoutinesApi = vi.hoisted(() => ({ run: vi.fn() }));
const mockIssuesApi = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../host/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/api")>()),
  routinesApi: mockRoutinesApi,
  issuesApi: mockIssuesApi,
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const company = { id: "c1", name: "Acme", issuePrefix: "ACM", logoUrl: null } as unknown as Company;

function routine(id: string, title: string, extra: Partial<RoutineListItem> = {}): RoutineListItem {
  return { id, title, status: "active", variables: [], triggers: [], lastRun: null, activeIssue: null, ...extra } as unknown as RoutineListItem;
}

const pinned = (r: RoutineListItem, extra: Partial<TicklerPinnedRoutine> = {}): TicklerPinnedRoutine => ({
  company,
  routine: r,
  when: "manual",
  ...extra,
});

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

function render(node: React.ReactNode): HTMLDivElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return container;
}

const click = (el: Element | null) => {
  if (!el) throw new Error("missing element");
  act(() => (el as HTMLElement).click());
};
const runButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("li button:last-of-type");

describe("TicklerPinnedRoutineRows", () => {
  beforeEach(() => {
    mockRoutinesApi.run.mockReset();
    mockIssuesApi.get.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("arms on the first press and runs on the second, then links the new issue", async () => {
    mockRoutinesApi.run.mockResolvedValue({ status: "issue_created", linkedIssueId: "i-1" });
    mockIssuesApi.get.mockResolvedValue({ id: "i-1", identifier: "ACM-42" });
    const c = render(<TicklerPinnedRoutineRows items={[pinned(routine("r1", "Nightly backup"))]} />);

    click(runButton(c));
    expect(c.querySelector("li")?.getAttribute("data-pinned-routine")).toBe("armed");
    expect(c.textContent).toContain("Run?");
    expect(mockRoutinesApi.run).not.toHaveBeenCalled();

    click(runButton(c));
    await flush();
    expect(mockRoutinesApi.run).toHaveBeenCalledWith("r1", undefined);
    expect(c.textContent).toContain("started · ACM-42");
    expect(c.querySelector('a[href*="/ACM/issues/ACM-42"]')).not.toBeNull();
  });

  it("disarms when the second press does not come", () => {
    vi.useFakeTimers();
    const c = render(<TicklerPinnedRoutineRows items={[pinned(routine("r1", "Nightly backup"))]} />);
    click(runButton(c));
    expect(c.querySelector("li")?.getAttribute("data-pinned-routine")).toBe("armed");
    act(() => vi.advanceTimersByTime(TICKLER_RUN_ARM_MS + 1));
    expect(c.querySelector("li")?.getAttribute("data-pinned-routine")).toBe("idle");
    expect(mockRoutinesApi.run).not.toHaveBeenCalled();
  });

  it("shows the host's error inline", async () => {
    mockRoutinesApi.run.mockRejectedValue(new ApiError("Default agent required", 422, null));
    const c = render(<TicklerPinnedRoutineRows items={[pinned(routine("r1", "Nightly backup"))]} />);
    click(runButton(c));
    click(runButton(c));
    await flush();
    expect(c.querySelector('[role="alert"]')?.textContent).toContain("Default agent required");
  });

  it("asks for a required variable with no default, then sends it typed", async () => {
    mockRoutinesApi.run.mockResolvedValue({ status: "issue_created", linkedIssueId: "i-2" });
    mockIssuesApi.get.mockResolvedValue({ id: "i-2", identifier: "ACM-43" });
    const r = routine("r2", "Cut a release", {
      variables: [
        { name: "version", label: "Version", type: "text", defaultValue: null, required: true, options: [] },
        { name: "count", label: null, type: "number", defaultValue: 3, required: false, options: [] },
      ],
    } as Partial<RoutineListItem>);
    const c = render(<TicklerPinnedRoutineRows items={[pinned(r)]} />);

    click(runButton(c));
    const form = c.querySelector("form[data-pinned-routine-form]");
    expect(form).not.toBeNull();
    const submit = form!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);

    const input = form!.querySelector<HTMLInputElement>('input[aria-label="Version (required)"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "1.2.0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(submit.disabled).toBe(false);
    click(submit);
    await flush();
    expect(mockRoutinesApi.run).toHaveBeenCalledWith("r2", { version: "1.2.0", count: 3 });
    expect(c.textContent).toContain("started · ACM-43");
  });

  it("shows a pinned routine's alarm in place of its schedule", () => {
    const c = render(<TicklerPinnedRoutineRows items={[pinned(routine("r1", "Nightly backup"), { alert: "failed" })]} />);
    expect(c.textContent).toContain("failed");
    expect(c.textContent).not.toContain("manual");
  });

  it("unpins from the row", () => {
    const onUnpin = vi.fn();
    const c = render(<TicklerPinnedRoutineRows items={[pinned(routine("r1", "Nightly backup"))]} onUnpin={onUnpin} />);
    click(c.querySelector('button[aria-label="Unpin Nightly backup"]'));
    expect(onUnpin).toHaveBeenCalledWith("r1");
  });
});

describe("TicklerPinRoutinePicker", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists routines by org, filters as you type, hides archived, and toggles a pin", () => {
    const onToggle = vi.fn();
    const c = render(
      <TicklerPinRoutinePicker
        entries={[
          {
            company,
            routines: [
              routine("r1", "Nightly backup"),
              routine("r2", "Weekly digest"),
              routine("r3", "Old thing", { status: "archived" } as Partial<RoutineListItem>),
            ],
          },
        ]}
        pinned={new Set(["r1"])}
        onToggle={onToggle}
      />,
    );
    click(c.querySelector('button[aria-label="Pin a routine"]'));
    const items = () => [...c.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
    expect(items().map((b) => b.textContent)).toEqual(["Nightly backup", "Weekly digest"]);
    expect(items()[0].getAttribute("aria-pressed")).toBe("true");

    const search = c.querySelector<HTMLInputElement>('input[aria-label="Find a routine"]')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "dig");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(items().map((b) => b.textContent)).toEqual(["Weekly digest"]);
    click(items()[0]);
    expect(onToggle).toHaveBeenCalledWith("r2");
  });
});
