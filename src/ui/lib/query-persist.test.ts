import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  MAX_AGE_MS,
  SNAPSHOT_VERSION,
  WRITE_INTERVAL_MS,
  persistTicklerCache,
  restoreTicklerCache,
  shouldKeepQuery,
  snapshotOf,
  type SnapshotStore,
  type TicklerCacheSnapshot,
} from "./query-persist";

function memoryStore(initial?: TicklerCacheSnapshot) {
  let held = initial;
  const store: SnapshotStore & { held: () => TicklerCacheSnapshot | undefined } = {
    read: vi.fn(async () => held),
    write: vi.fn(async (snapshot: TicklerCacheSnapshot) => {
      held = snapshot;
    }),
    clear: vi.fn(async () => {
      held = undefined;
    }),
    held: () => held,
  };
  return store;
}

const NOW = Date.parse("2026-11-20T12:00:00Z");

function boardClient() {
  const client = new QueryClient();
  client.setQueryData(["companies"], { companies: [{ id: "c1" }], unauthorized: false }, { updatedAt: NOW - 60_000 });
  client.setQueryData(["tickler", "issues", "c1"], [{ id: "i1" }], { updatedAt: NOW - 60_000 });
  client.setQueryData(["tickler", "plugin-self"], { version: "0.23.1" }, { updatedAt: NOW - 60_000 });
  return client;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("shouldKeepQuery", () => {
  it("keeps the board's data", () => {
    expect(shouldKeepQuery(["companies"])).toBe(true);
    expect(shouldKeepQuery(["tickler", "issues", "c1"])).toBe(true);
    expect(shouldKeepQuery(["tickler", "question-state", "c1", "i1", "stamp"])).toBe(true);
    expect(shouldKeepQuery(["tickler-usage", "c1"])).toBe(true);
    expect(shouldKeepQuery(["sidebar-preferences", "company-order", "u1"])).toBe(true);
  });

  it("leaves out the session and the update checks", () => {
    expect(shouldKeepQuery(["auth", "session"])).toBe(false);
    expect(shouldKeepQuery(["tickler", "plugin-self"])).toBe(false);
    expect(shouldKeepQuery(["tickler", "npm-packument"])).toBe(false);
  });
});

describe("restoreTicklerCache", () => {
  it("puts the last board back, keeping when it was fetched so it refetches on mount", async () => {
    const store = memoryStore(snapshotOf(boardClient(), "u1", NOW - 5_000));
    const client = new QueryClient();
    await expect(restoreTicklerCache(client, store, "u1", NOW)).resolves.toBe(true);
    expect(client.getQueryData(["tickler", "issues", "c1"])).toEqual([{ id: "i1" }]);
    expect(client.getQueryState(["tickler", "issues", "c1"])?.dataUpdatedAt).toBe(NOW - 60_000);
    expect(client.getQueryData(["tickler", "plugin-self"])).toBeUndefined();
  });

  it("throws away another user's board rather than showing it", async () => {
    const store = memoryStore(snapshotOf(boardClient(), "u1", NOW - 5_000));
    const client = new QueryClient();
    await expect(restoreTicklerCache(client, store, "u2", NOW)).resolves.toBe(false);
    expect(client.getQueryData(["companies"])).toBeUndefined();
    expect(store.held()).toBeUndefined();
  });

  it("throws away a board that is too old, or from another version", async () => {
    const old = memoryStore(snapshotOf(boardClient(), "u1", NOW - MAX_AGE_MS - 1));
    await expect(restoreTicklerCache(new QueryClient(), old, "u1", NOW)).resolves.toBe(false);
    expect(old.held()).toBeUndefined();

    const other = memoryStore({ ...snapshotOf(boardClient(), "u1", NOW), version: SNAPSHOT_VERSION + 1 });
    await expect(restoreTicklerCache(new QueryClient(), other, "u1", NOW)).resolves.toBe(false);
  });

  it("does not overwrite data the cache already has newer", async () => {
    const store = memoryStore(snapshotOf(boardClient(), "u1", NOW - 5_000));
    const client = new QueryClient();
    client.setQueryData(["tickler", "issues", "c1"], [{ id: "fresh" }], { updatedAt: NOW });
    await restoreTicklerCache(client, store, "u1", NOW);
    expect(client.getQueryData(["tickler", "issues", "c1"])).toEqual([{ id: "fresh" }]);
  });

  it("is a cold load, not an error, when the store cannot be read", async () => {
    const store = memoryStore();
    store.read = vi.fn(async () => {
      throw new Error("blocked");
    });
    await expect(restoreTicklerCache(new QueryClient(), store, "u1", NOW)).resolves.toBe(false);
  });
});

describe("persistTicklerCache", () => {
  it("writes at most once per interval while queries land", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const store = memoryStore();
    const stop = persistTicklerCache(client, store, "u1", { now: () => NOW });

    client.setQueryData(["tickler", "summary", "c1"], { ok: 1 });
    client.setQueryData(["tickler", "summary", "c1"], { ok: 2 });
    expect(store.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(WRITE_INTERVAL_MS);
    expect(store.write).toHaveBeenCalledTimes(1);
    expect(store.held()?.userId).toBe("u1");
    expect(store.held()?.state.queries.map((query) => query.queryKey)).toEqual([["tickler", "summary", "c1"]]);
    stop();
  });

  it("ignores queries it does not keep", () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const store = memoryStore();
    const stop = persistTicklerCache(client, store, "u1");
    client.setQueryData(["tickler", "plugin-self"], { version: "x" });
    vi.advanceTimersByTime(WRITE_INTERVAL_MS);
    stop();
    expect(store.write).not.toHaveBeenCalled();
  });

  it("writes straight away when the page is left", () => {
    const client = new QueryClient();
    const store = memoryStore();
    const stop = persistTicklerCache(client, store, "u1");
    client.setQueryData(["tickler", "summary", "c1"], { ok: 1 });
    window.dispatchEvent(new Event("pagehide"));
    expect(store.write).toHaveBeenCalledTimes(1);
    stop();
  });

  it("writes nothing while paused (demo mode)", () => {
    const client = new QueryClient();
    const store = memoryStore();
    const stop = persistTicklerCache(client, store, "u1", { paused: () => true });
    client.setQueryData(["tickler", "summary", "c1"], { demo: true });
    stop();
    expect(store.write).not.toHaveBeenCalled();
  });
});
