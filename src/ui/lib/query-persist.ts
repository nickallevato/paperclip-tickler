import { dehydrate, hydrate, type DehydratedState, type QueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Keeps the last board you saw, so the next load paints it at once and
 * refreshes in place rather than starting from "Loading…" (PLI-371).
 *
 * Every org on the board costs about ten requests, and the issue list alone is
 * close to a megabyte, so a cold load spent seconds on blank rows. Most loads
 * are not cold in any real sense: Tickler's cross-company links do a full
 * document load, so the same board was being fetched again from nothing a few
 * seconds after it was last on screen.
 *
 * What is kept is react-query's own cache, written to IndexedDB. A restored
 * query keeps the time it was really fetched, so every one of them is already
 * past its `staleTime` and refetches as soon as the board mounts — the restored
 * copy only stands in until the fresh one lands. localStorage is too small:
 * one busy org's issue list is most of its quota.
 *
 * Three things keep it from showing what it should not:
 *
 * - **Demo mode.** The caller restores only once demo mode is known to be off,
 *   and nothing is written while it is on, so a demo never shows a real name
 *   and a real board never shows a demo one.
 * - **Who is signed in.** A snapshot belongs to the user who was signed in when
 *   it was written, and is thrown away rather than restored for anyone else.
 * - **Age.** A snapshot older than `MAX_AGE_MS` is thrown away; a board that
 *   old would mislead for the moment it was up, and a cold load is honest.
 */

/** Bump when a cached shape changes, so an older snapshot is not restored into it. */
export const SNAPSHOT_VERSION = 1;
export const MAX_AGE_MS = 12 * 3_600_000;
/** At most one write per this long while queries keep landing. */
export const WRITE_INTERVAL_MS = 30_000;

export interface TicklerCacheSnapshot {
  version: number;
  userId: string;
  savedAt: number;
  state: DehydratedState;
}

export interface SnapshotStore {
  read(): Promise<TicklerCacheSnapshot | undefined>;
  write(snapshot: TicklerCacheSnapshot): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The board's data, and nothing else. Plugin-version and npm lookups are left
 * out (a stale answer there would offer the wrong update), as is the session,
 * which is what decides whether a snapshot may be restored at all.
 */
const KEPT_TICKLER_KINDS = new Set([
  "summary",
  "live-runs",
  "projects",
  "issues",
  "run-issue",
  "question-state",
  "agents",
  "approvals",
  "attention",
  "routines",
  "tokens",
  "timeline",
  "briefing-issues",
]);

export function shouldKeepQuery(queryKey: QueryKey): boolean {
  const [root, kind] = queryKey;
  if (root === "companies" || root === "tickler-usage") return true;
  if (root === "sidebar-preferences") return kind === "company-order";
  return root === "tickler" && typeof kind === "string" && KEPT_TICKLER_KINDS.has(kind);
}

export function snapshotOf(client: QueryClient, userId: string, nowMs: number): TicklerCacheSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    userId,
    savedAt: nowMs,
    state: dehydrate(client, {
      shouldDehydrateQuery: (query) => query.state.status === "success" && shouldKeepQuery(query.queryKey),
      shouldDehydrateMutation: () => false,
    }),
  };
}

/**
 * Puts the stored board into `client` if it is this user's and recent enough,
 * and drops it otherwise. True when something was restored.
 *
 * Never throws: a snapshot that cannot be read just means a cold load.
 */
export async function restoreTicklerCache(
  client: QueryClient,
  store: SnapshotStore,
  userId: string,
  nowMs: number,
): Promise<boolean> {
  let snapshot: TicklerCacheSnapshot | undefined;
  try {
    snapshot = await store.read();
  } catch {
    return false;
  }
  if (!snapshot) return false;
  const usable =
    snapshot.version === SNAPSHOT_VERSION &&
    snapshot.userId === userId &&
    nowMs - snapshot.savedAt >= 0 &&
    nowMs - snapshot.savedAt <= MAX_AGE_MS;
  if (!usable) {
    await store.clear().catch(() => undefined);
    return false;
  }
  // `hydrate` leaves alone any query the client already holds newer data for.
  hydrate(client, snapshot.state);
  return true;
}

/**
 * Writes the board to `store` as queries land, at most once per
 * `WRITE_INTERVAL_MS`, and once more when the page is hidden or left — which is
 * the moment a cross-company link is about to reload it. Returns the stop
 * function.
 *
 * `paused` is asked before every write; while it answers true (demo mode)
 * nothing is written.
 */
export function persistTicklerCache(
  client: QueryClient,
  store: SnapshotStore,
  userId: string,
  { paused = () => false, now = () => Date.now() }: { paused?: () => boolean; now?: () => number } = {},
): () => void {
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty || paused()) return;
    dirty = false;
    void store.write(snapshotOf(client, userId, now())).catch(() => undefined);
  };

  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (!shouldKeepQuery(event.query.queryKey)) return;
    dirty = true;
    if (!timer) timer = setTimeout(flush, WRITE_INTERVAL_MS);
  });

  const onHide = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", flush);

  return () => {
    flush();
    unsubscribe();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", flush);
  };
}

const DB_NAME = "tickler-cache";
const DB_STORE = "snapshots";
const DB_KEY = "board";

/** The browser's IndexedDB, or null where there is none (tests, locked-down browsers). */
export function indexedDbSnapshotStore(): SnapshotStore | null {
  if (typeof indexedDB === "undefined") return null;

  let opened: Promise<IDBDatabase> | null = null;
  const db = () => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // A failed open is not cached, so the next call tries again.
    opened.catch(() => {
      opened = null;
    });
    return opened;
  };

  const run = async <T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const database = await db();
    return new Promise<T>((resolve, reject) => {
      const request = act(database.transaction(DB_STORE, mode).objectStore(DB_STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  };

  return {
    read: () => run<TicklerCacheSnapshot | undefined>("readonly", (store) => store.get(DB_KEY)),
    write: (snapshot) => run<void>("readwrite", (store) => store.put(snapshot, DB_KEY)),
    clear: () => run<void>("readwrite", (store) => store.delete(DB_KEY)),
  };
}
