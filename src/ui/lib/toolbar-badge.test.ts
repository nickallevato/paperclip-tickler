import { describe, expect, it } from "vitest";
import type { AttentionFeed } from "@paperclipai/shared";
import { localDateKey } from "./queue";
import {
  countToolbarToday,
  normalizeToolbarBadgeSetting,
  toolbarBadgeLabel,
  toolbarBadgeText,
} from "./toolbar-badge";

// Thursday 17 September 2026, 12:00 local.
const NOW = new Date(2026, 8, 17, 12).getTime();
const dayKey = (offset: number) => localDateKey(NOW + offset * 24 * 60 * 60_000);

const row = (overrides: Record<string, unknown> = {}) => ({
  id: `a-${Math.random()}`,
  sourceKind: "blocker_attention",
  subject: { id: "issue-1" },
  severity: "high",
  decideBy: null,
  snoozedUntil: null,
  dismissal: null,
  ...overrides,
});
const feed = (...items: Array<Record<string, unknown>>) => ({ items }) as unknown as AttentionFeed;

describe("countToolbarToday", () => {
  it("counts the Today lane across every feed: decide-by today, or a date today or earlier", () => {
    const count = countToolbarToday(
      [
        feed(row({ decideBy: "today" }), row({ decideBy: dayKey(0) }), row({ decideBy: "this_week" })),
        feed(row({ decideBy: dayKey(-2) }), row(), row({ decideBy: dayKey(5) })),
      ],
      NOW,
    );
    expect(count).toEqual({ today: 3, overdue: 1 });
  });

  it("leaves out snoozed and dismissed items, but not a lapsed snooze", () => {
    const later = new Date(NOW + 60 * 60_000).toISOString();
    const earlier = new Date(NOW - 60 * 60_000).toISOString();
    const count = countToolbarToday(
      [
        feed(
          row({ decideBy: dayKey(-1), snoozedUntil: later }),
          row({ decideBy: "today", dismissal: { dismissedAt: earlier } }),
          row({ decideBy: "today", snoozedUntil: earlier }),
        ),
      ],
      NOW,
    );
    expect(count).toEqual({ today: 1, overdue: 0 });
  });

  it("counts an approval through its attention twin, as the queue does", () => {
    const count = countToolbarToday(
      [feed(row({ sourceKind: "approval", subject: { id: "approval-1" }, decideBy: dayKey(-1), dismissal: {} }))],
      NOW,
    );
    expect(count).toEqual({ today: 1, overdue: 1 });
  });

  it("is zero with no orgs", () => {
    expect(countToolbarToday([], NOW)).toEqual({ today: 0, overdue: 0 });
  });
});

describe("toolbar badge text", () => {
  it("caps the pill at 9+", () => {
    expect(toolbarBadgeText(1)).toBe("1");
    expect(toolbarBadgeText(9)).toBe("9");
    expect(toolbarBadgeText(10)).toBe("9+");
  });

  it("puts the full count in the label, and says nothing extra at zero", () => {
    expect(toolbarBadgeLabel(null)).toBe("Tickler — all orgs");
    expect(toolbarBadgeLabel({ today: 0, overdue: 0 })).toBe("Tickler — all orgs");
    expect(toolbarBadgeLabel({ today: 12, overdue: 0 })).toBe("Tickler — 12 to decide today");
    expect(toolbarBadgeLabel({ today: 3, overdue: 1 })).toBe("Tickler — 3 to decide today (1 overdue)");
  });

  it("defaults the setting on, and only an explicit off turns it off", () => {
    expect(normalizeToolbarBadgeSetting(null)).toBe("today");
    expect(normalizeToolbarBadgeSetting("junk")).toBe("today");
    expect(normalizeToolbarBadgeSetting("off")).toBe("off");
  });
});
