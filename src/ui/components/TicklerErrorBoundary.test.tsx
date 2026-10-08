import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import manifest from "../../manifest";
import { TicklerErrorBoundary, crashReport, describeCaughtError } from "./TicklerErrorBoundary";

let shouldThrow = true;

function Bomb() {
  if (shouldThrow) throw new TypeError("Cannot read properties of undefined (reading 'map')");
  return <p>drawn</p>;
}

beforeEach(() => {
  shouldThrow = true;
  // React and the boundary both log a caught throw; the test asserts on the screen.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("TicklerErrorBoundary", () => {
  it("renders its children untouched when nothing throws", () => {
    shouldThrow = false;
    const { container } = render(
      <TicklerErrorBoundary area="Recent">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    expect(container.innerHTML).toBe("<p>drawn</p>");
  });

  it("names the area and the error instead of the host's bare 'failed to render'", () => {
    render(
      <TicklerErrorBoundary area="Recent">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Recent could not be drawn.");
    expect(screen.getByText("TypeError: Cannot read properties of undefined (reading 'map')")).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith(
      "Tickler: Recent failed to render",
      expect.any(TypeError),
      expect.any(String),
    );
  });

  it("puts the version that threw in the page fallback", () => {
    render(
      <TicklerErrorBoundary area="Tickler page" variant="page">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      `Tickler ${manifest.version} hit an error and stopped drawing this page.`,
    );
  });

  it("keeps the pane's layout class on the fallback", () => {
    render(
      <TicklerErrorBoundary area="Portfolio" className="order-3 min-w-0">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveClass("order-3", "min-w-0");
  });

  it("draws an org's line as a list item, so the Orgs list stays a list", () => {
    render(
      <ul>
        <TicklerErrorBoundary area="Lion Peak IT" variant="row">
          <Bomb />
        </TicklerErrorBoundary>
      </ul>,
    );
    const alert = screen.getByRole("alert");
    expect(alert.tagName).toBe("LI");
    expect(alert).toHaveTextContent("Lion Peak IT: could not draw");
  });

  it("shrinks to a warning chip in the toolbar, with the error in its title", () => {
    render(
      <TicklerErrorBoundary area="Toolbar button" variant="chip">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    const chip = screen.getByRole("alert");
    expect(chip).toHaveAttribute("data-tickler-error", "chip");
    expect(chip.getAttribute("title")).toContain("reading 'map'");
  });

  it("draws the children again on Try again once they stop throwing", () => {
    render(
      <TicklerErrorBoundary area="Recent">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("drawn")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("copies a report with the version, the error and the component stack", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <TicklerErrorBoundary area="Needs you">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
    const report = writeText.mock.calls[0]![0] as string;
    expect(report).toContain(`Tickler ${manifest.version} — Needs you failed to render`);
    expect(report).toContain("TypeError: Cannot read properties of undefined (reading 'map')");
    expect(report).toContain("Component stack:");
    expect(report).toContain("Bomb");
  });

  it("says so when there is no clipboard to copy to", () => {
    vi.stubGlobal("navigator", {});
    render(
      <TicklerErrorBoundary area="Recent">
        <Bomb />
      </TicklerErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }));
    expect(screen.getByRole("button", { name: "Copy failed" })).toBeInTheDocument();
  });
});

describe("crashReport", () => {
  it("reads without a stack when the throw was not an Error", () => {
    const caught = { ...describeCaughtError("Routines", "boom"), at: "2026-10-08T17:00:00.000Z" };
    expect(crashReport(caught)).toBe(
      `Tickler ${manifest.version} — Routines failed to render\nat 2026-10-08T17:00:00.000Z\n\nboom`,
    );
  });
});
