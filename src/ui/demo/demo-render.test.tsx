// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtureJson from "./demo-data.json";
import { deactivateDemoMode, installDemoFixture } from "./demo-runtime";
import type { DemoFixture } from "./demo-types";
import { TicklerHud } from "../TicklerHud";

vi.mock("../host/shims", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../host/shims")>()),
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

const FIXTURE = fixtureJson as unknown as DemoFixture;

/**
 * End-to-end proof that the fixture actually drives the real HUD: no component
 * is mocked here beyond the host breadcrumb shim. If a field the board reads
 * goes missing from the fixture, this fails — which is the failure the unit
 * tests on the router alone would miss.
 */
describe("TicklerHud on demo data", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("demo mode must not reach the network");
    }) as unknown as typeof fetch);
    installDemoFixture(structuredClone(FIXTURE));
  });

  afterEach(() => {
    deactivateDemoMode();
    vi.unstubAllGlobals();
  });

  function renderHud() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TicklerHud demo />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it("draws a row for every demo company", async () => {
    renderHud();
    for (const company of FIXTURE.companies) {
      expect(await screen.findByText(company.name)).toBeInTheDocument();
    }
  });

  it("fills Recent from the fixture, live rows before the rest", async () => {
    renderHud();
    const pane = await screen.findByLabelText("Recent tasks");
    await waitFor(() => expect(pane.querySelectorAll("li").length).toBeGreaterThan(0));
    const phases = Array.from(pane.querySelectorAll("li")).map((row) => row.getAttribute("data-recent-task"));
    expect(phases).toContain("working");
    // Nothing live may appear below something idle: that ordering is the whole
    // reason the pane replaced a strip that only ever showed the live runs.
    expect(phases.lastIndexOf("working")).toBeLessThan(
      phases.includes("idle") ? phases.indexOf("idle") : phases.length,
    );
  });

  /**
   * PLI-202: at phone width the rail's wrapper is `display: contents`, so every
   * panel is a grid item of the board's single `auto` column — and that track
   * cannot shrink below the widest panel's min-content size. Recent's rows are
   * as wide as their untruncated ticket titles until something gives them a
   * width, so without `min-w-0` the column grew past the viewport and clipped
   * every pane in it (Orgs lost its runs/day and Need-you figures).
   *
   * jsdom has no layout, so the measurement lives in the screenshot capture;
   * what is guarded here is the one declaration the layout rests on.
   */
  it("gives every board panel min-w-0 so no pane can widen the page", async () => {
    const { container } = renderHud();
    await screen.findByLabelText("Recent tasks");
    const grid = container.querySelector("[data-view='board'] > div");
    expect(grid).not.toBeNull();
    // The rail wrapper is `display: contents` when narrow; its panels are the
    // real grid items, so look through it.
    const items = Array.from(grid!.children).flatMap((child) =>
      child.classList.contains("contents") ? Array.from(child.children) : [child],
    );
    expect(items.length).toBeGreaterThan(1);
    for (const item of items) {
      expect(item.className.split(/\s+/)).toContain("min-w-0");
    }
  });

  /**
   * PLI-273: the Orgs header carries the same expand toggle Recent has, wired to
   * the same one-pane-at-a-time state. Checked through the real HUD rather than
   * against the board page alone, because the wiring is the part that can be
   * wrong — the button's own behaviour is covered on Recent.
   */
  it("offers the expand toggle in the Orgs header, and in Recent's", async () => {
    const { container } = renderHud();
    await screen.findByLabelText("Recent tasks");
    const orgs = container.querySelector<HTMLButtonElement>("[data-rail-expand='orgs']");
    expect(orgs).not.toBeNull();
    expect(orgs!.getAttribute("aria-label")).toBe("Expand Orgs");
    // It is in the Orgs header, not loose in the pane: the header is the whole
    // of a folded pane, so a toggle anywhere else could not be pressed to
    // unfold it.
    expect(orgs!.closest("[data-rail-head]")).not.toBeNull();
    expect(container.querySelector("[data-rail-expand='recent']")).not.toBeNull();
    // jsdom measures every box as zero, so the rail is unbudgeted and Orgs is
    // holding nothing back — which is the state the button is meant to disable
    // itself in rather than fold three panes for a list already complete.
    expect(orgs!.disabled).toBe(true);
    expect(orgs!.getAttribute("title")).toContain("Nothing to expand");
  });

  it("labels itself as demo data so a screenshot cannot be mistaken", async () => {
    renderHud();
    expect(await screen.findByText("Demo data")).toBeInTheDocument();
  });

  it("renders without any request escaping to the network", async () => {
    renderHud();
    await screen.findByText(FIXTURE.companies[0].name);
    await waitFor(() => {
      expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    });
  });
});
