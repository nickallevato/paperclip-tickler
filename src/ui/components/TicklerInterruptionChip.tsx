import { cn } from "../host/util";
import type { TicklerInterruptionClass } from "../lib/interruption";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";

/**
 * A task's interruption, in a few words. Work stopped until you act gets a
 * chip in the waiting colour; the host retrying on its own (or having given
 * up) is plain muted text, because there is nothing for you to do here — the
 * recovery actions are on the task page.
 */
export function TicklerInterruptionChip({
  interruption,
  className,
}: {
  interruption: TicklerInterruptionClass;
  className?: string;
}) {
  const loud = interruption.kind === "needs_you";
  return (
    <span
      data-interruption={interruption.kind}
      title={interruption.title}
      className={cn(
        "shrink-0 whitespace-nowrap",
        MICRO,
        loud ? "rounded-full border border-tickler-wait/40 px-1.5 font-medium text-tickler-wait" : "text-muted-foreground",
        className,
      )}
    >
      {interruption.chip}
    </span>
  );
}
