import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import manifest from "../../manifest";
import {
  GOOD_AFTER_MS,
  noteCrash,
  readGoodVersions,
  recordGoodVersion,
  resetCrashFlag,
} from "../lib/rollback";
import { TicklerErrorBoundary } from "./TicklerErrorBoundary";
import { LastGoodVersionRecorder, RollbackButton, TicklerEarlierVersionPicker } from "./TicklerRollback";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mockFetch(routes: { self?: unknown; upgrade?: { status: number; body: unknown }; versions?: string[] }) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith("https://registry.npmjs.org")) {
      return json(200, { versions: Object.fromEntries((routes.versions ?? []).map((v) => [v, {}])) });
    }
    if (url.endsWith("/upgrade")) return json(routes.upgrade?.status ?? 200, routes.upgrade?.body ?? {});
    return json(200, routes.self ?? {});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function upgradeBodies(fn: ReturnType<typeof mockFetch>) {
  return fn.mock.calls
    .filter(([url]) => url.endsWith("/upgrade"))
    .map(([, init]) => JSON.parse(String(init?.body)));
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  localStorage.clear();
  resetCrashFlag();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LastGoodVersionRecorder", () => {
  it("records the running version once the page has stayed up", () => {
    vi.useFakeTimers();
    render(<LastGoodVersionRecorder />);
    act(() => vi.advanceTimersByTime(GOOD_AFTER_MS - 1));
    expect(readGoodVersions()).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(readGoodVersions()).toEqual([manifest.version]);
  });

  it("does not vouch for a load in which any boundary caught an error", () => {
    vi.useFakeTimers();
    render(<LastGoodVersionRecorder />);
    noteCrash();
    act(() => vi.advanceTimersByTime(GOOD_AFTER_MS));
    expect(readGoodVersions()).toEqual([]);
  });
});

describe("RollbackButton", () => {
  it("rolls back to the newest older version that worked here, then hands off", async () => {
    recordGoodVersion("0.14.3");
    recordGoodVersion("0.15.0");
    const fetchFn = mockFetch({ self: { version: "0.16.0", packagePath: null } });
    const onDone = vi.fn();
    render(<RollbackButton running="0.16.0" onDone={onDone} />);

    fireEvent.click(await screen.findByRole("button", { name: /Roll back to 0\.15\.0/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(upgradeBodies(fetchFn)).toEqual([{ version: "0.15.0" }]);
  });

  it("says plainly when the reader is not an instance admin", async () => {
    recordGoodVersion("0.15.0");
    mockFetch({ self: { version: "0.16.0" }, upgrade: { status: 403, body: { error: "Forbidden" } } });
    render(<RollbackButton running="0.16.0" onDone={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Roll back to 0\.15\.0/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only an instance admin can roll back Tickler.");
  });

  it("offers nothing without an older version that worked here", async () => {
    recordGoodVersion("0.16.0");
    const fetchFn = mockFetch({ self: { version: "0.16.0" } });
    render(<RollbackButton running="0.16.0" />);
    await Promise.resolve();
    expect(screen.queryByRole("button")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("offers nothing for a local-path install, which the route re-reads from disk", async () => {
    recordGoodVersion("0.15.0");
    const fetchFn = mockFetch({ self: { version: "0.16.0", packagePath: "/src/tickler" } });
    render(<RollbackButton running="0.16.0" />);
    await waitFor(() => expect(fetchFn).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("appears in the page fallback when the page crashes", async () => {
    recordGoodVersion("0.0.1");
    mockFetch({ self: { version: manifest.version } });
    function Bomb(): never {
      throw new Error("boom");
    }
    render(
      <TicklerErrorBoundary area="Tickler page" variant="page">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    expect(await screen.findByRole("button", { name: /Roll back to 0\.0\.1/ })).toBeInTheDocument();
  });
});

describe("TicklerEarlierVersionPicker", () => {
  it("asks npm only once opened, then installs the chosen older version", async () => {
    recordGoodVersion("0.14.3");
    const fetchFn = mockFetch({ versions: ["0.14.3", "0.15.0", "0.16.0", "0.17.0"] });
    const onDone = vi.fn();
    const { container } = wrap(<TicklerEarlierVersionPicker running="0.16.0" onDone={onDone} />);
    expect(fetchFn).not.toHaveBeenCalled();

    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    const select = await screen.findByRole("combobox", { name: "Earlier Tickler version" });
    expect([...(select as HTMLSelectElement).options].map((o) => o.text)).toEqual([
      "0.15.0",
      "0.14.3 — worked here",
    ]);
    fireEvent.change(select, { target: { value: "0.14.3" } });
    fireEvent.click(screen.getByRole("button", { name: /Install 0\.14\.3/ }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(upgradeBodies(fetchFn)).toEqual([{ version: "0.14.3" }]);
  });
});
