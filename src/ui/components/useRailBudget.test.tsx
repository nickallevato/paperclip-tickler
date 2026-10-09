// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TicklerRailPaneSpec } from "../lib/rail-budget";
import { railPaneBox } from "./TicklerRailPane";
import { useRailBudget } from "./useRailBudget";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const PANES: TicklerRailPaneSpec[] = [
  { key: "orgs", minRows: 3, idealRows: Infinity, priority: 1 },
  { key: "portfolio", minRows: 3, idealRows: 11, priority: 2 },
];

/**
 * A rail the hook can measure.
 *
 * jsdom lays nothing out, so every rect it reports is zero — which is exactly
 * the unmeasured case the hook already has to survive. To exercise the measured
 * case, geometry is stubbed onto the element prototypes by the `data-*` markers
 * the panes carry: 28px headers, 20px footers, 32px rows, and a scrolling box
 * of whatever height the test asks for. The rail gets that height less a 16px
 * gutter top and bottom, which is the hook's own arithmetic.
 *
 * Rects rather than `offsetHeight`, because that is what the hook reads now:
 * `offsetHeight` is an integer and a rail row rarely is, and a budget built
 * from the floor of its own rows is a pane that scrolls by the fraction it was
 * docked (PLI-263). `rowHeight` is therefore a parameter — a test can hand it
 * 32.375 and ask what the pane was pinned to.
 *
 * `tail` is what the layout puts *under* the rail — the board's padding, in the
 * app. The hook finds it by stretching the rail until its column owns the
 * scrolling box's `scrollHeight`, so the stub answers that the way a layout
 * engine would: whatever the rail has been given, plus what it starts below,
 * plus the tail.
 */
function stubGeometry(portHeight: number, railTop = 0, rowHeight = 32, tail = 16, stuck = 0): () => void {
  const height = (node: HTMLElement): number => {
    // A header that wraps to a second line while its pane holds rows back —
    // the "+N more" it gains is what wraps it, at kiosk's type scale (GH#84).
    if (node.dataset.railHead !== undefined) return node.dataset.wraps === "true" ? 56 : 28;
    if (node.dataset.railFoot !== undefined) return 20;
    if (node.dataset.railRow !== undefined) return rowHeight;
    return 0;
  };
  const rect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
  const client = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      return { height: height(this), width: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 } as DOMRect;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.dataset.rail === "port" ? portHeight : 0;
    },
  });
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.rail !== "port") return 0;
      const rail = this.querySelector<HTMLElement>("[data-rail='rail']");
      const given = Number.parseFloat(rail?.style.height ?? "");
      return railTop + (Number.isFinite(given) ? given : 0) + tail;
    },
  });
  // What the rail starts below inside the scrolling box — the board's own
  // header, in the app. jsdom reports every `offsetTop` as zero, which is the
  // pinned case; a test asks for the resting one by passing a height. `stuck`
  // is how far a scrolled page has pushed the pinned rail down, which a real
  // browser adds to `offsetTop` unless the rail is `static` (GH#85).
  const top = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetTop");
  Object.defineProperty(HTMLElement.prototype, "offsetTop", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.rail !== "rail") return 0;
      return railTop + (this.style.position === "static" ? 0 : stuck);
    },
  });
  return () => {
    if (rect) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", rect);
    if (client) Object.defineProperty(HTMLElement.prototype, "clientHeight", client);
    if (top) Object.defineProperty(HTMLElement.prototype, "offsetTop", top);
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scroll);
  };
}

function Rail({
  orgRows,
  projectRows,
  contents,
  wraps,
}: {
  orgRows: number;
  projectRows: number;
  contents?: boolean;
  wraps?: boolean;
}) {
  const { railRef, budget, narrow } = useRailBudget(PANES);
  const pane = (key: string, rows: number) => {
    const box = railPaneBox(budget[key]);
    return (
      <section
        data-rail-pane={key}
        data-demoted={budget[key]?.demoted}
        data-rows={budget[key]?.rows}
        // The 2px of frame the pane's height has to carry, written as the
        // border it is in the app: the hook reads it off the computed style
        // rather than as `offsetHeight - clientHeight`, which is two roundings.
        style={{ borderTopWidth: "1px", borderBottomWidth: "1px", ...box.style }}
        className={box.className}
      >
        <div data-rail-head data-wraps={Boolean(wraps && (budget[key]?.hidden ?? 0) > 0)}>
          {key}
        </div>
        {!budget[key]?.demoted && (
          <ul>
            {Array.from({ length: rows }, (_, index) => (
              <li key={index} data-rail-row />
            ))}
          </ul>
        )}
        <p data-rail-foot />
      </section>
    );
  };
  return (
    // The host's scrolling box, which is what the hook measures the rail
    // against — not the window.
    <div data-rail="port" style={{ overflowY: "auto" }}>
      <div
        ref={railRef}
        data-rail="rail"
        data-narrow={narrow}
        // The narrow layout, where the panes are grid items of the page and the
        // rail is not a box at all. In the app this comes from the container
        // query on the class; here it is asked for outright.
        style={contents ? { display: "contents" } : undefined}
      >
        {pane("orgs", orgRows)}
        {pane("portfolio", projectRows)}
      </div>
    </div>
  );
}

let teardown: (() => void)[] = [];

/** `portHeight` is the scrolling box; the rail gets 32px less than it. */
function render(
  portHeight: number,
  rows: { orgRows: number; projectRows: number; contents?: boolean; wraps?: boolean } = { orgRows: 12, projectRows: 11 },
  railTop = 0,
  rowHeight = 32,
  tail = 16,
  stuck = 0,
): HTMLDivElement {
  teardown.push(stubGeometry(portHeight, railTop, rowHeight, tail, stuck));
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<Rail {...rows} />);
  });
  teardown.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

afterEach(() => {
  for (const undo of teardown.reverse()) undo();
  teardown = [];
});

const pane = (container: HTMLElement, key: string) =>
  container.querySelector<HTMLElement>(`[data-rail-pane="${key}"]`)!;

describe("useRailBudget", () => {
  it("gives the rail the band it is pinned inside, not the window", () => {
    const container = render(632);
    expect(container.querySelector<HTMLElement>("[data-rail='rail']")!.style.height).toBe("600px");
  });

  it("leaves out what the rail starts below, so the last pane is above the fold", () => {
    // The page opens at the top, where the rail begins under the board's own
    // header rather than at the top of the scrolling box. A rail given the
    // whole band there is that much taller than the screen, and the bottom
    // pane hangs off it: 632 less a 118px header and one 16px gutter, not
    // less two gutters.
    const container = render(632, { orgRows: 12, projectRows: 11 }, 118);
    expect(container.querySelector<HTMLElement>("[data-rail='rail']")!.style.height).toBe("498px");
  });

  // PLI-263, one level out from the panes: the rail kept a fixed 16px under
  // itself while the board's padding is 24, so the rail's column was 8px taller
  // than the box it scrolls inside and the *page* grew a scrollbar that
  // scrolled 8px over nothing. Invisible while the queue was the taller column,
  // which is why it survived the first fix; on a quiet board the rail is the
  // tallest thing on the page.
  it("leaves room for what the layout puts under the rail, not a fixed gutter", () => {
    const container = render(632, { orgRows: 12, projectRows: 11 }, 118, 32, 24);
    const rail = container.querySelector<HTMLElement>("[data-rail='rail']")!;
    expect(rail.style.height).toBe("490px");
    // The point of the number: the rail's column has to fit the band it is in.
    expect(118 + Number.parseInt(rail.style.height, 10) + 24).toBeLessThanOrEqual(632);
  });

  // GH#85: a long queue scrolled down pins the rail 900px below where it was
  // laid out, and a browser counts that in `offsetTop`. Read that way, the band
  // measured nothing, every pane demoted, and the rail grew back on the way up.
  it("keeps the same height when the page is scrolled and the rail is pinned", () => {
    const resting = render(632, { orgRows: 12, projectRows: 11 }, 118, 32, 24);
    const scrolled = render(632, { orgRows: 12, projectRows: 11 }, 118, 32, 24, 900);
    const rail = scrolled.querySelector<HTMLElement>("[data-rail='rail']")!;
    expect(rail.style.height).toBe(resting.querySelector<HTMLElement>("[data-rail='rail']")!.style.height);
    expect(pane(scrolled, "portfolio").dataset.demoted).toBe("false");
    // Unstuck only for the read: the class's `sticky` is back in charge after.
    expect(rail.style.position).toBe("");
  });

  it("pins each pane to a header plus whole rows", () => {
    const container = render(632);
    // 600px, less two 2px borders, two 28px headers, two 20px footers and one
    // 16px gap, leaves 484px for 32px rows: fifteen of them, handed out
    // round-robin from each pane's minimum of three — eight and seven.
    expect(pane(container, "orgs").style.height).toBe("306px");
    expect(pane(container, "portfolio").style.height).toBe("274px");
    for (const key of ["orgs", "portfolio"]) {
      const height = Number.parseInt(pane(container, key).style.height, 10);
      expect((height - 2 - 28 - 20) % 32, key).toBe(0);
    }
  });

  // PLI-263: the rows were measured with `offsetHeight`, so a 28.375px row was
  // budgeted 28 and a pane showing three of them was pinned a pixel short of
  // its own contents — a scrollbar on a pane whose header says it is holding
  // nothing back. Pinned to no less than the rows need, and to a whole pixel.
  it("never pins a pane below the rows it is showing, however they measure", () => {
    const container = render(632, { orgRows: 12, projectRows: 11 }, 0, 32.375);
    for (const key of ["orgs", "portfolio"]) {
      const height = Number.parseInt(pane(container, key).style.height, 10);
      const rows = Number.parseInt(pane(container, key).dataset.rows!, 10);
      expect(height, key).toBeGreaterThanOrEqual(2 + 28 + 20 + rows * 32.375);
      expect(height, key).toBe(Math.ceil(height));
    }
  });

  it("gives a taller rail's height away instead of holding a cap", () => {
    const short = render(632);
    const tall = render(1032);
    expect(Number.parseInt(pane(tall, "portfolio").style.height, 10)).toBeGreaterThan(
      Number.parseInt(pane(short, "portfolio").style.height, 10),
    );
  });

  it("demotes a pane it cannot seat, and can measure it again once demoted", () => {
    const container = render(252);
    expect(pane(container, "orgs").dataset.demoted).toBe("false");
    expect(pane(container, "portfolio").dataset.demoted).toBe("true");
    expect(pane(container, "portfolio").style.height).toBe("");
    // The demoted pane has no rows left on the page. Its remembered row height
    // is what keeps a re-measure from reading it as unmeasured and dropping the
    // whole budget — which would un-pin the pane above it too.
    expect(pane(container, "orgs").style.height).not.toBe("");
  });

  it("reports the narrow layout, and tells it apart from an unmeasured rail", () => {
    const narrow = render(632, { orgRows: 12, projectRows: 11, contents: true });
    const rail = narrow.querySelector<HTMLElement>("[data-rail='rail']")!;
    // No height written and no pane pinned: `display: contents` means the panes
    // are grid items of the page and anything written here is ignored.
    expect(rail.dataset.narrow).toBe("true");
    expect(rail.style.height).toBe("");
    expect(pane(narrow, "orgs").style.height).toBe("");
    // A rail with a box is not narrow even when there is nothing to measure —
    // that one is over at the next frame, and a pane capping itself for it
    // would cap itself on every host without a ResizeObserver.
    expect(render(0).querySelector<HTMLElement>("[data-rail='rail']")!.dataset.narrow).toBe("false");
  });

  // GH#84: the header the budget measures is the one its last answer drew, and
  // at 368px with four orgs the two never agree. Orgs whole leaves Portfolio
  // demoted, wrapped under its "+11 more"; the taller Portfolio header hands
  // Orgs' fourth row to Portfolio's floor; now Orgs wraps, Portfolio cannot
  // afford its floor, and round it goes — every commit, until React gives up
  // with #185 and the page goes with it. Measured at its tallest, it settles.
  it("settles when a pane's header wraps only while it holds rows back", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const container = render(368, { orgRows: 4, projectRows: 11, wraps: true });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
    // Settled, and still honest: every pane pinned is pinned to what it draws.
    for (const key of ["orgs", "portfolio"]) {
      const box = pane(container, key);
      if (box.dataset.demoted === "true") continue;
      const head = box.querySelector<HTMLElement>("[data-rail-head]")!.dataset.wraps === "true" ? 56 : 28;
      const rows = Number.parseInt(box.dataset.rows!, 10);
      expect(Number.parseInt(box.style.height, 10), key).toBeGreaterThanOrEqual(2 + head + 20 + rows * 32);
    }
  });

  it("leaves the panes alone when nothing can be measured", () => {
    const container = render(0);
    expect(pane(container, "orgs").style.height).toBe("");
    expect(pane(container, "orgs").dataset.demoted).toBe("false");
    expect(pane(container, "portfolio").style.height).toBe("");
  });
});
