import { describe, expect, it } from "vitest";
import {
  bucketUsage,
  formatTokensCompact,
  normalizeUsageWindow,
  runUsages,
  sumUsageSeries,
  usageScale,
  usageSeriesTitle,
} from "./usage";

const HOUR = 3_600_000;
// 14:20 UTC, so the current clock hour started 20 minutes ago.
const NOW = Date.UTC(2026, 9, 7, 14, 20);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

describe("runUsages", () => {
  it("counts input + output as fresh and keeps cache reads apart", () => {
    const [usage] = runUsages([
      {
        createdAt: ago(30),
        finishedAt: ago(10),
        usageJson: { inputTokens: 1_000, outputTokens: 250, cachedInputTokens: 15_000, costUsd: 0 },
      },
    ]);
    expect(usage).toEqual({ atMs: NOW - 10 * 60_000, fresh: 1_250, cached: 15_000 });
  });

  it("drops runs with no usage yet, and runs that used nothing", () => {
    expect(
      runUsages([
        { createdAt: ago(5), finishedAt: null, usageJson: null },
        { createdAt: ago(5), finishedAt: ago(1), usageJson: { inputTokens: 0, outputTokens: 0 } },
      ]),
    ).toEqual([]);
  });

  it("falls back to the start, then the creation time, when a run has no finish", () => {
    const [usage] = runUsages([{ createdAt: ago(50), startedAt: ago(40), usageJson: { outputTokens: 7 } }]);
    expect(usage.atMs).toBe(NOW - 40 * 60_000);
  });

  it("ignores junk token values rather than poisoning the sum", () => {
    const [usage] = runUsages([
      { createdAt: ago(1), usageJson: { inputTokens: "12", outputTokens: -4, cachedInputTokens: Number.NaN } },
      { createdAt: ago(1), usageJson: { inputTokens: 3 } },
    ]);
    expect(usage.fresh).toBe(3);
  });
});

describe("bucketUsage", () => {
  it("draws the trailing clock hours with the current one last", () => {
    const series = bucketUsage([], NOW, 24);
    expect(series.hours).toHaveLength(24);
    expect(series.hours[23].startMs).toBe(Date.UTC(2026, 9, 7, 14));
    expect(series.hours[0].startMs).toBe(Date.UTC(2026, 9, 6, 15));
  });

  it("puts each run in the hour it finished, and totals the window", () => {
    const series = bucketUsage(
      [
        { atMs: NOW - 5 * 60_000, fresh: 100, cached: 1_000 }, // this hour
        { atMs: NOW - 15 * 60_000, fresh: 50, cached: 0 }, // this hour
        { atMs: NOW - 30 * 60_000, fresh: 10, cached: 5 }, // 13:50, the hour before
      ],
      NOW,
      8,
    );
    expect(series.hours[7]).toMatchObject({ fresh: 150, cached: 1_000, runs: 2 });
    expect(series.hours[6]).toMatchObject({ fresh: 10, runs: 1 });
    expect(series).toMatchObject({ fresh: 160, cached: 1_005, runs: 3 });
  });

  it("leaves out anything older than the window — 8h is a slice of the same runs", () => {
    const usages = [
      { atMs: NOW - 2 * HOUR, fresh: 1, cached: 0 },
      { atMs: NOW - 10 * HOUR, fresh: 1_000, cached: 0 },
    ];
    expect(bucketUsage(usages, NOW, 8).fresh).toBe(1);
    expect(bucketUsage(usages, NOW, 24).fresh).toBe(1_001);
  });

  it("drops a run stamped in the future rather than wrapping it into a bar", () => {
    expect(bucketUsage([{ atMs: NOW + 2 * HOUR, fresh: 9, cached: 0 }], NOW, 24).fresh).toBe(0);
  });
});

describe("sumUsageSeries and usageScale", () => {
  const a = bucketUsage([{ atMs: NOW - 1, fresh: 300, cached: 0 }], NOW, 8);
  const b = bucketUsage(
    [
      { atMs: NOW - 1, fresh: 200, cached: 7 },
      { atMs: NOW - 3 * HOUR, fresh: 900, cached: 0 },
    ],
    NOW,
    8,
  );

  it("adds the orgs hour by hour", () => {
    const all = sumUsageSeries([a, b], NOW, 8);
    expect(all.hours[7].fresh).toBe(500);
    expect(all.hours[4].fresh).toBe(900);
    expect(all).toMatchObject({ fresh: 1_400, cached: 7, runs: 3 });
  });

  it("scales every row to the busiest single hour of any org", () => {
    expect(usageScale([a, b])).toBe(900);
    expect(usageScale([])).toBe(0);
  });
});

describe("formatTokensCompact", () => {
  it.each([
    [0, "0"],
    [-5, "0"],
    [950, "950"],
    [1_200, "1.2k"],
    [5_000, "5k"],
    [452_000, "452k"],
    [999_600, "1.0M"],
    [1_400_000, "1.4M"],
    [8_040_000, "8.0M"],
    [12_400_000, "12M"],
  ])("%d → %s", (tokens, label) => {
    expect(formatTokensCompact(tokens)).toBe(label);
  });
});

describe("normalizeUsageWindow", () => {
  it("reads 8 back and defaults everything else to 24", () => {
    expect(normalizeUsageWindow("8")).toBe(8);
    expect(normalizeUsageWindow("24")).toBe(24);
    expect(normalizeUsageWindow(null)).toBe(24);
    expect(normalizeUsageWindow("12")).toBe(24);
  });
});

describe("usageSeriesTitle", () => {
  it("says plainly when an org used nothing", () => {
    expect(usageSeriesTitle(bucketUsage([], NOW, 8), 8)).toBe("No tokens used in the last 8h");
  });
});
