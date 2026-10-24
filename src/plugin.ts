import { definePlugin } from "@paperclipai/plugin-sdk";

/**
 * Tickler's worker lifecycle.
 *
 * Tickler is a UI-only plugin: the HUD calls core Paperclip HTTP APIs directly
 * from the browser (PLUGIN_SPEC.md §24), so there is no worker-side data path
 * and no tools, jobs, or API routes to register. The host still starts a worker
 * process per installed plugin and probes its health, so this exists to satisfy
 * that contract.
 *
 * Kept separate from `worker.ts` so it can be imported by tests without
 * `runWorker()` taking over stdio and starting the JSON-RPC host.
 */
export const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Tickler plugin worker ready (UI-only; no worker-side data path)");
  },

  async onHealth() {
    return {
      status: "ok" as const,
      message: "Tickler plugin worker is running",
      details: { surfaces: ["page", "sidebar"] },
    };
  },

  /**
   * Hosts that park idle instances ask each worker whether it holds background
   * work, and a worker without this hook blocks sleep. Tickler's worker has no
   * timers, sockets or jobs — everything runs in the browser — so it never
   * does. Hosts and SDKs that predate the hook ignore it.
   */
  async onIdleDrain() {
    return "none" as const;
  },
});

export default plugin;
