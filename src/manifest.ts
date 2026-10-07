import type { PaperclipPluginManifestV1 } from "@paperclipai/shared";
import { PLUGIN_ID } from "./plugin-id";

export { PLUGIN_ID };

/**
 * Tickler is a UI-only plugin.
 *
 * It contributes one page slot (mounted by the host at `/:companyPrefix/tickler`)
 * and one sidebar launcher that navigates there.
 *
 * The declared capabilities describe the company data the HUD surfaces. They
 * do not gate its reads: capabilities gate worker-side host RPC, and plugin UI
 * may call ordinary Paperclip HTTP APIs directly (PLUGIN_SPEC.md, "Current
 * implementation caveats" — not a numbered section; §24 is Operator UX). Tickler's
 * worker is a no-op, so nothing here is exercised at runtime — the list stands
 * as an honest declaration of what the page displays, and the schema requires
 * at least one entry.
 */
const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: "0.13.0",
  displayName: "Tickler",
  description: "Cross-company HUD: company panes, triage, approvals, attention, and briefing.",
  // The manifest schema has no homepage/repository fields — `author` is a plain
  // string — so the links ride inline here, and also live in package.json.
  author: "nickallevato (https://allevato.io · https://github.com/nickallevato)",
  categories: ["ui"],
  capabilities: [
    // Required to register the UI surfaces below. The host validates these
    // separately from the zod schema, in plugin-capability-validator.ts:
    // a `page` slot requires ui.page.register, and a `globalToolbarButton`
    // slot requires ui.action.register.
    "ui.page.register",
    "ui.action.register",
    // Company data the HUD surfaces.
    "companies.read",
    "projects.read",
    "issues.read",
    "agents.read",
    "approvals.read",
    "activity.read",
  ],
  /**
   * Demo mode, rendered by the host as a form on the plugin's settings page
   * (ui/src/pages/PluginSettings.tsx auto-generates it from this schema).
   *
   * With `demoMode` on, Tickler serves every read from a static fixture instead
   * of the instance's real API, so the HUD can be screenshotted or demoed
   * without exposing real company names, tickets, or agent chatter. Writes
   * (approve, reject, comment) mutate the in-memory fixture and never reach
   * the server.
   *
   * Host plugin config is stored per company, and Tickler is a cross-company
   * page — so reading this costs one `/api/companies` call to learn which
   * config row to ask for. Nothing real is rendered while that resolves, and
   * the `?demo=1` URL parameter skips the lookup entirely (see
   * `src/ui/demo/demo-mode.ts`), which is the switch to reach for mid-demo.
   */
  instanceConfigSchema: {
    type: "object",
    properties: {
      demoMode: {
        type: "boolean",
        title: "Demo mode",
        description:
          "Serve the HUD from bundled dummy data instead of this instance's real companies. For screenshots and demos.",
        default: false,
      },
      demoDataUrl: {
        type: "string",
        title: "Demo data URL",
        description:
          "Override where the fixture is fetched from. Defaults to the demo-data.json shipped with the plugin.",
      },
    },
    additionalProperties: true,
  },
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui",
  },
  ui: {
    slots: [
      {
        type: "page",
        id: "tickler-page",
        displayName: "Tickler",
        exportName: "TicklerPage",
        routePath: "tickler",
      },
      {
        // The BreadcrumbBar zone, which Layout renders above every page — the
        // only outlet outside a company's sidebar, which suits a view that
        // spans companies.
        //
        // A slot rather than a launcher: launcher declarations carry no icon
        // field, so a launcher here would render a bare label. Slot components
        // draw their own markup, which is how the Tickler mark survives
        // (src/ui/components/TicklerMark.tsx).
        type: "globalToolbarButton",
        id: "tickler-toolbar-button",
        displayName: "Tickler",
        exportName: "TicklerToolbarButton",
      },
    ],
  },
};

export default manifest;
