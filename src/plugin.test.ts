import { describe, expect, it, vi } from "vitest";
import { plugin } from "./plugin";

/**
 * The worker entrypoint is split into `plugin.ts` (lifecycle) and `worker.ts`
 * (the `runWorker` call) precisely so this suite can import the lifecycle
 * without `runWorker` taking over stdio.
 *
 * The install failed once with "Worker process exited (code=0, signal=null)"
 * because the original worker exported a bare object and never called
 * `runWorker`, so the process ran to completion instead of serving JSON-RPC.
 */
describe("plugin worker lifecycle", () => {
  // definePlugin returns a sealed object exposing the original handlers under
  // `.definition` rather than on the instance itself.
  it("reports healthy", async () => {
    const health = await plugin.definition.onHealth?.();
    expect(health).toMatchObject({ status: "ok" });
  });

  it("never holds an instance awake: the worker has no background work", async () => {
    // Without the hook the host counts the worker as busy and blocks idle sleep.
    await expect(plugin.definition.onIdleDrain?.(new AbortController().signal)).resolves.toBe("none");
  });

  it("logs on setup without throwing", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await expect(
      plugin.definition.setup?.({ logger } as never),
    ).resolves.not.toThrow();
    expect(logger.info).toHaveBeenCalled();
  });
});
