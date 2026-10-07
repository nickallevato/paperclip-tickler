import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { bucketUsage } from "../lib/usage";
import { TicklerUsageStrip } from "./TicklerUsageStrip";

const NOW = Date.UTC(2026, 9, 7, 14, 20);
const HOUR = 3_600_000;

describe("TicklerUsageStrip", () => {
  it("draws one slot per hour and a bar only where tokens were used", () => {
    const series = bucketUsage(
      [
        { atMs: NOW - 1, fresh: 1_000, cached: 0 },
        { atMs: NOW - 5 * HOUR, fresh: 10, cached: 0 },
      ],
      NOW,
      24,
    );
    const { container } = render(<TicklerUsageStrip series={series} scale={1_000} />);
    expect(container.querySelectorAll("[data-usage-hour]")).toHaveLength(24);
    const bars = container.querySelectorAll("[data-usage-bar]");
    expect(bars).toHaveLength(2);
    // The busiest hour fills the strip.
    expect(bars[1].getAttribute("height")).toBe("20");
  });

  it("keeps a visible floor under a tiny hour next to a huge spike", () => {
    const series = bucketUsage([{ atMs: NOW - 1, fresh: 1, cached: 0 }], NOW, 8);
    const { container } = render(<TicklerUsageStrip series={series} scale={8_000_000} />);
    const bar = container.querySelector("[data-usage-bar]");
    expect(Number(bar?.getAttribute("height"))).toBeGreaterThanOrEqual(2);
  });

  it("draws no bars at all for an org that used nothing", () => {
    const { container } = render(<TicklerUsageStrip series={bucketUsage([], NOW, 8)} scale={500} />);
    expect(container.querySelectorAll("[data-usage-bar]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-usage-hour]")).toHaveLength(8);
  });
});
