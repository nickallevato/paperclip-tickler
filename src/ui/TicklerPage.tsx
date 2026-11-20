import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TicklerHud } from "./TicklerHud";
import { TicklerErrorBoundary } from "./components/TicklerErrorBoundary";
import { LastGoodVersionRecorder } from "./components/TicklerRollback";
import { useRepairRememberedTicklerPaths } from "./host/company-path-memory";
import { activateDemoMode, deactivateDemoMode, isDemoActive } from "./demo/demo-runtime";
import { resolveDemoMode } from "./demo/demo-mode";
import { indexedDbSnapshotStore, persistTicklerCache, restoreTicklerCache } from "./lib/query-persist";

/**
 * Root of the Tickler plugin page.
 *
 * The host bridge shares only React with plugin bundles, so Tickler owns its own
 * react-query client and cache. That cache is deliberately independent of the
 * host's: Tickler polls its own cross-company aggregates and never needs to
 * invalidate host queries.
 *
 * The client lives as long as the document, not the page component, so a hop
 * to another host page and back serves the board from cache and refreshes it
 * in place (PLI-371). A full reload starts from the snapshot in
 * `lib/query-persist` instead.
 *
 * It also owns the demo-mode gate. Demo mode has to be settled *before* the
 * HUD mounts, because the HUD starts polling on its first render — so this
 * component renders nothing but a placeholder until the decision is in, and
 * only then hands over. Rendering the HUD first and swapping data later would
 * put real company names on screen for a frame, which is the one thing demo
 * mode exists to prevent.
 */
type GateState =
  | { phase: "resolving" }
  | { phase: "ready"; demo: boolean }
  | { phase: "failed"; message: string };

const client = new QueryClient({
  defaultOptions: {
    // Half an hour of cache for a board nobody is looking at: long enough to
    // cover a trip to another host page and back.
    queries: { refetchOnWindowFocus: false, retry: 1, gcTime: 30 * 60_000 },
  },
});
const snapshotStore = indexedDbSnapshotStore();
/** Which board the cache holds — demo or real — so a switch between them starts empty. */
let cachedDemo: boolean | null = null;
/** The user whose snapshot this document has restored and is writing. */
let persistingFor: { userId: string; stop: () => void } | null = null;

/**
 * Who is signed in, read with a bare fetch: `authApi` answers from demo data
 * whenever demo mode is still armed from an earlier mount, and the snapshot
 * must be matched against the real user. Null when signed out or unreachable.
 */
async function signedInUserId(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/get-session", { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { id?: unknown } | null; session?: { userId?: unknown } | null } | null;
    const id = body?.user?.id ?? body?.session?.userId;
    return typeof id === "string" ? id : null;
  } catch {
    return null;
  }
}

/** Puts this user's last board in the cache, once per document, and keeps it written. */
async function restoreBoard(userIdRead: Promise<string | null>): Promise<void> {
  if (!snapshotStore) return;
  const userId = await userIdRead;
  if (!userId || persistingFor?.userId === userId) return;
  persistingFor?.stop();
  persistingFor = null;
  await restoreTicklerCache(client, snapshotStore, userId, Date.now());
  persistingFor = { userId, stop: persistTicklerCache(client, snapshotStore, userId, { paused: isDemoActive }) };
}

export function TicklerPage() {
  const [gate, setGate] = useState<GateState>({ phase: "resolving" });
  useRepairRememberedTicklerPaths();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Started alongside the demo check, not after it, so the snapshot costs
      // the gate no round trip of its own. Only used once demo mode is off.
      const userIdRead = snapshotStore ? signedInUserId() : Promise.resolve(null);
      const decision = await resolveDemoMode(
        typeof window === "undefined" ? "" : window.location.search,
      );
      if (cancelled) return;
      if (cachedDemo !== null && cachedDemo !== decision.enabled) {
        // Written out before the clear, while the cache still holds the real board.
        persistingFor?.stop();
        persistingFor = null;
        client.clear();
      }
      cachedDemo = decision.enabled;
      if (!decision.enabled) {
        deactivateDemoMode();
        await restoreBoard(userIdRead);
        if (!cancelled) setGate({ phase: "ready", demo: false });
        return;
      }
      try {
        await activateDemoMode(decision.dataUrl);
        if (!cancelled) setGate({ phase: "ready", demo: true });
      } catch (error) {
        // Fail closed: demo mode was asked for and could not be served, so the
        // page says so rather than quietly falling back to the real instance.
        if (!cancelled) {
          setGate({
            phase: "failed",
            message: error instanceof Error ? error.message : "Demo data could not be loaded.",
          });
        }
      }
    })();
    return () => {
      // Deliberately does not call `deactivateDemoMode()`. Demo mode is armed
      // module-wide in `host/api`, and react-query can still have polls in
      // flight as this unmounts — disarming here would send those to the real
      // server. The only other reader of `host/api` is the toolbar button's
      // Today count, which skips its fetch while demo mode is armed, so leaving
      // it armed costs nothing and the next mount re-resolves it anyway.
      cancelled = true;
    };
  }, []);

  if (gate.phase === "resolving") {
    return <div className="p-6 text-[length:var(--tickler-fs-body,14px)] leading-[1.45] text-muted-foreground">Loading Tickler…</div>;
  }

  if (gate.phase === "failed") {
    return (
      <div className="p-6 text-[length:var(--tickler-fs-body,14px)] leading-[1.45]">
        <p className="font-medium">Demo mode is on, but the demo data could not be loaded.</p>
        <p className="mt-1 text-muted-foreground">{gate.message}</p>
        <p className="mt-3 text-muted-foreground">
          Real data is not shown while demo mode is requested. Add <code>?demo=0</code> to the URL
          to leave demo mode.
        </p>
      </div>
    );
  }

  return (
    <QueryClientProvider client={client}>
      <TicklerErrorBoundary area="Tickler page" variant="page">
        <TicklerHud demo={gate.demo} />
        <LastGoodVersionRecorder />
      </TicklerErrorBoundary>
    </QueryClientProvider>
  );
}
