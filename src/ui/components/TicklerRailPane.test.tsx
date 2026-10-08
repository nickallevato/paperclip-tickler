// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TicklerRailPaneBudget } from "../lib/rail-budget";
import { TicklerRailMore } from "./TicklerRailPane";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Rows 40px tall in a 120px scroller: three in view, the rest out of it. */
const ROW = 40;
const VIEW = 120;

interface Row {
  name: string;
  needs: number;
}

let container: HTMLDivElement;
let root: Root;
let scrollTop = 0;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute("data-rail-scroll")) return rect(0, VIEW);
    const index = Number(this.dataset.index ?? 0);
    const top = index * ROW - scrollTop;
    return rect(top, top + ROW);
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-rail-scroll") ? VIEW : 0;
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

function render(rows: Row[], budget: TicklerRailPaneBudget) {
  root = createRoot(container);
  act(() =>
    root.render(
      <section data-rail-pane="orgs">
        <h2>
          <TicklerRailMore budget={budget} />
        </h2>
        <ul data-rail-scroll>
          {rows.map((row, index) => (
            <li key={row.name} data-rail-row data-index={index} data-rail-needs={row.needs} data-rail-label={row.name}>
              {row.name}
            </li>
          ))}
        </ul>
      </section>,
    ),
  );
}

const chip = () => container.querySelector<HTMLButtonElement>("[data-rail-more]");
const scroller = () => container.querySelector<HTMLElement>("[data-rail-scroll]")!;

function scrollTo(top: number) {
  scrollTop = top;
  act(() => {
    scroller().dispatchEvent(new Event("scroll"));
  });
}

const budget = (hidden: number): TicklerRailPaneBudget => ({ rows: 3, height: VIEW, hidden, demoted: false });

describe("TicklerRailMore", () => {
  it("names the quiet rows under the fold and points at them", () => {
    render(
      [
        { name: "Lion Peak IT", needs: 4 },
        { name: "Tickler", needs: 2 },
        { name: "Blog", needs: 1 },
        { name: "Bora Rental", needs: 0 },
        { name: "bozeman bee", needs: 0 },
      ],
      budget(2),
    );
    expect(chip()?.textContent).toBe("2 more");
    expect(chip()?.getAttribute("data-rail-more")).toBe("below");
    expect(chip()?.hasAttribute("data-rail-more-needs")).toBe(false);
    expect(chip()?.title).toContain("2 below: Bora Rental, bozeman bee");
  });

  it("says when a row it hides needs you", () => {
    render(
      [
        { name: "A", needs: 0 },
        { name: "B", needs: 0 },
        { name: "C", needs: 0 },
        { name: "D", needs: 3 },
      ],
      budget(1),
    );
    expect(chip()?.textContent).toBe("1 more · 3 need you");
    expect(chip()?.getAttribute("data-rail-more-needs")).toBe("3");
    expect(chip()?.className).toContain("text-tickler-wait");
  });

  it("scrolls down to the hidden rows, then counts the ones left above", () => {
    const rows = ["A", "B", "C", "D", "E"].map((name) => ({ name, needs: name === "A" ? 2 : 0 }));
    render(rows, budget(2));
    const scrollBy = vi.fn();
    scroller().scrollBy = scrollBy;
    act(() => chip()!.click());
    // Two rows of 40px to the bottom of E.
    expect(scrollBy).toHaveBeenCalledWith({ top: 2 * ROW, behavior: "smooth" });

    scrollTo(2 * ROW);
    expect(chip()?.getAttribute("data-rail-more")).toBe("above");
    expect(chip()?.textContent).toBe("2 more · 2 need you");
    expect(chip()?.title).toContain("2 above: A, B");

    act(() => chip()!.click());
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -2 * ROW, behavior: "smooth" });
  });

  it("steps a page at a time through a long list", () => {
    render(
      Array.from({ length: 12 }, (_, index) => ({ name: `R${index}`, needs: 0 })),
      budget(9),
    );
    expect(chip()?.textContent).toBe("9 more");
    const scrollBy = vi.fn();
    scroller().scrollBy = scrollBy;
    act(() => chip()!.click());
    expect(scrollBy).toHaveBeenCalledWith({ top: VIEW, behavior: "smooth" });
  });

  it("keeps the plain count, and no button, on a pane folded to its header", () => {
    render([], { rows: 0, height: null, hidden: 6, demoted: true });
    expect(chip()?.tagName).toBe("SPAN");
    expect(chip()?.textContent).toBe("+6 more");
  });

  it("draws nothing when every row is in view", () => {
    render([{ name: "A", needs: 1 }], budget(0));
    expect(chip()).toBeNull();
  });

  // The budget guessed rows were hidden, but the pane laid out with room for
  // all of them. Drawing nothing used to drop the chip's ref, so the next read
  // found no pane, fell back on the budget, drew the chip, read 0 again — and
  // React gave up with error #185 (PLI-286).
  it("draws nothing, and settles, when the budget hides rows the pane has room for", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      [
        { name: "A", needs: 0 },
        { name: "B", needs: 0 },
      ],
      budget(1),
    );
    expect(chip()).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });
});
