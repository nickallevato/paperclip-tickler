import type { TicklerToolbarBadgeSetting } from "../lib/toolbar-badge";
import { TicklerSegmented } from "./TicklerSegmented";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

const OPTIONS: ReadonlyArray<{ value: TicklerToolbarBadgeSetting; label: string }> = [
  { value: "off", label: "Off" },
  { value: "today", label: "Today count" },
];

/**
 * Whether the toolbar button carries the Today count (PLI-367). Lives in the
 * gear's panel with the other per-browser settings. Off stops the button's
 * polling, not just the number.
 */
export function TicklerToolbarBadgeSettingPanel({
  value,
  onChange,
}: {
  value: TicklerToolbarBadgeSetting;
  onChange: (value: TicklerToolbarBadgeSetting) => void;
}) {
  return (
    <div data-toolbar-badge-setting className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3">
      <span className={`${BODY} font-semibold`}>Toolbar badge</span>
      <TicklerSegmented
        label="Toolbar badge"
        options={OPTIONS}
        value={value}
        onChange={onChange}
        optionProps={(option) => ({ "data-toolbar-badge": option })}
      />
      <span className={`${MICRO} text-muted-foreground`}>
        How many items are in Today across your shown orgs. Red when one is overdue. Saved in this browser only.
      </span>
    </div>
  );
}
