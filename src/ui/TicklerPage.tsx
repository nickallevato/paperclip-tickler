import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { TicklerHud } from "./TicklerHud";
import { TicklerErrorBoundary } from "./components/TicklerErrorBoundary";
import { LastGoodVersionRecorder } from "./components/TicklerRollback";
import { useRepairRememberedTicklerPaths } from "./host/company-path-memory";
import { activateDemoMode, deactivateDemoMode } from "./demo/demo-runtime";
import { resolveDemoMode } from "./demo/demo-mode";

/**
 * Root of the Tickler plugin page.
 *
 * The host bridge shares only React with plugin bundles, so Tickler owns its own
 * react-query client and cache. That cache is deliberately independent of the
 * host's: Tickler polls its own cross-company aggregates and never needs to
 * invalidate host queries.
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

export function TicklerPage() {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { refetchOnWindowFocus: false, retry: 1 },
    },
  }));
  const [gate, setGate] = useState<GateState>({ phase: "resolving" });
  useRepairRememberedTicklerPaths();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const decision = await resolveDemoMode(
        typeof window === "undefined" ? "" : window.location.search,
      );
      if (cancelled) return;
      if (!decision.enabled) {
        deactivateDemoMode();
        setGate({ phase: "ready", demo: false });
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
      // server. Nothing outside this page reads `host/api` (the toolbar button
      // fetches nothing), so leaving it armed costs nothing and the next mount
      // re-resolves it anyway.
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
