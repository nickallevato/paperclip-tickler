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

const at = (offsetHours: number) => new Date(NOW + offsetHours * 60 * 60_000).toISOString();
const row = (overrides: Record<string, unknown> = {}) => ({
  id: `a-${Math.random()}`,
  sourceKind: "blocker_attention",
  subject: { id: "issue-1" },
  severity: "high",
  activityAt: at(-1),
  decideBy: null,
  snoozedUntil: null,
  dismissal: null,
  ...overrides,
});
const feed = (...items: Array<Record<string, unknown>>) => ({ items }) as unknown as AttentionFeed;

describe("countToolbarToday", () => {
  it("counts what arrived since local midnight across every feed, decide-by or not", () => {
    const count = countToolbarToday(
      [
        // 00:30 today, an hour ago, and 23:00 last night: the last is yesterday's.
        feed(row({ activityAt: at(-11.5) }), row({ decideBy: "this_week" }), row({ activityAt: at(-13) })),
        feed(row(), row({ activityAt: at(-5 * 24) })),
      ],
      NOW,
    );
    expect(count).toEqual({ today: 3, overdue: 0 });
  });

  it("reads an item with no timestamp as today's, as the age chip does", () => {
    expect(countToolbarToday([feed(row({ activityAt: null }))], NOW)).toEqual({ today: 1, overdue: 0 });
  });

  it("is red for anything overdue, whenever it arrived", () => {
    const count = countToolbarToday(
      [feed(row({ activityAt: at(-5 * 24), decideBy: dayKey(-2) }), row({ decideBy: "today" }))],
      NOW,
    );
    expect(count).toEqual({ today: 1, overdue: 1 });
  });

  it("leaves out snoozed and dismissed items, but not a lapsed snooze", () => {
    const count = countToolbarToday(
      [
        feed(
          row({ decideBy: dayKey(-1), snoozedUntil: at(1) }),
          row({ dismissal: { dismissedAt: at(-0.5) } }),
          row({ snoozedUntil: at(-0.5) }),
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
    expect(toolbarBadgeLabel({ today: 12, overdue: 0 })).toBe("Tickler — 12 new today");
    expect(toolbarBadgeLabel({ today: 3, overdue: 1 })).toBe("Tickler — 3 new today (1 overdue)");
  });

  it("defaults the setting on, and only an explicit off turns it off", () => {
    expect(normalizeToolbarBadgeSetting(null)).toBe("today");
    expect(normalizeToolbarBadgeSetting("junk")).toBe("today");
    expect(normalizeToolbarBadgeSetting("off")).toBe("off");
  });
});
