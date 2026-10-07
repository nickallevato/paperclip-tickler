import { AlertTriangle, CalendarClock, CircleSlash, Timer } from "lucide-react";
import { cn } from "../host/util";
import { CompanyPatternIcon } from "../host/ui-kit";
import { formatAgeMinutes } from "../lib/tickler";
import { routineExceptions, type TicklerRoutineExceptionKind, type TicklerUpcomingRoutine } from "../lib/queue";
import type { TicklerRailPaneBudget } from "../lib/rail-budget";
import { TicklerLink } from "./TicklerLink";
import { railPaneBox, TicklerRailMore } from "./TicklerRailPane";
import type { ReactNode } from "react";
import { TicklerPinnedRoutineRows, type TicklerPinnedRoutine } from "./TicklerPinnedRoutines";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

const KIND_ICON: Record<TicklerRoutineExceptionKind, typeof AlertTriangle> = {
  failed: AlertTriangle,
  blocked: CircleSlash,
  overdue: Timer,
};

const KIND_TONE: Record<TicklerRoutineExceptionKind, string> = {
  failed: "text-tickler-alarm",
  blocked: "text-tickler-wait",
  overdue: "text-tickler-wait",
};

/**
 * Routines, but only the broken ones.
 *
 * The list this replaced drew every scheduled routine in weekday order — a
 * week's timetable that told you nothing you did not already know, and gave
 * the two that had actually failed the same weight as the eighteen that were
 * fine. Here a healthy routine is a number in the header and nothing else, so
 * the block is two lines tall on a good day and empty on a perfect one.
 */
export function TicklerRoutineExceptions({
  items,
  nowMs,
  budget,
  className,
  pinned = [],
  picker,
}: {
  items: TicklerUpcomingRoutine[];
  /** PLI-275 prototype: pinned routines, drawn above the exceptions. */
  pinned?: TicklerPinnedRoutine[];
  /** PLI-275 prototype: the "+" that opens the pin picker. */
  picker?: ReactNode;
  nowMs: number;
  budget?: TicklerRailPaneBudget;
  className?: string;
}) {
  const all = routineExceptions(items, nowMs);
  // A pinned routine that is also broken says so in its pinned row, once.
  const pinnedIds = new Set(pinned.map((p) => p.routine.id));
  const exceptions = all.items.filter((e) => !pinnedIds.has(e.item.routine.id));
  const healthy = all.healthy;
  const alerts = new Map(all.items.map((e) => [e.item.routine.id, e.kind] as const));
  pinned = pinned.map((p) => (alerts.has(p.routine.id) ? { ...p, alert: alerts.get(p.routine.id) } : p));
  const box = railPaneBox(budget);

  return (
    <section
      data-tickler-routines
      data-rail-pane="routines"
      style={box.style}
      className={cn("flex min-h-0 shrink-0 flex-col rounded-lg border bg-card", className, box.className)}
    >
      <h3
        data-rail-head
        className={cn(
          "flex shrink-0 items-center gap-2 px-3 pb-2 pt-3 font-semibold uppercase tracking-(--tracking-label) text-muted-foreground",
          MICRO,
        )}
      >
        <CalendarClock className="h-3 w-3" />
        Routines
        {all.items.length > 0 && (
          <span className="ml-auto font-normal normal-case tracking-normal tabular-nums text-tickler-alarm">
            {all.items.length} need{all.items.length === 1 ? "s" : ""} attention
          </span>
        )}
        <TicklerRailMore budget={budget} />
        {picker && <span className={all.items.length > 0 ? "" : "ml-auto"}>{picker}</span>}
      </h3>
      {pinned.length > 0 && (
        <div className={cn("shrink-0", exceptions.length > 0 && "border-b pb-1 mb-1")}>
          <TicklerPinnedRoutineRows items={pinned} />
        </div>
      )}

      {exceptions.length === 0 ? (
        <p data-rail-foot className={cn("px-3 pb-3 italic text-muted-foreground", MICRO)}>
          {healthy === 0 ? "nothing scheduled" : `all ${healthy} routines healthy`}
        </p>
      ) : budget?.demoted ? (
        // The header's own "3 need attention" is the digest, and it is a link
        // away from the routines themselves; two clipped rows would not be.
        null
      ) : (
        <>
          {/* The rail's budget decides how many of these fit, and it gives this
              pane two rows before it gives Portfolio its fourth. */}
          <ul className="min-h-0 flex-1 overflow-y-auto px-3">
            {exceptions.map(({ item, kind, label, lateMs, issue }) => {
              const { company, routine } = item;
              const Icon = KIND_ICON[kind];
              return (
                <li
                  key={`${company.id}:${routine.id}`}
                  data-routine-exception={kind}
                  data-rail-row
                  className={cn("flex items-center gap-2 py-1", BODY)}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", KIND_TONE[kind])} aria-hidden="true" />
                  <CompanyPatternIcon
                    companyName={company.name}
                    logoUrl={company.logoUrl}
                    className="size-4 shrink-0 rounded text-[7px]"
                  />
                  <TicklerLink
                    to={
                      issue
                        ? `/${company.issuePrefix}/issues/${issue.identifier ?? issue.id}`
                        : `/${company.issuePrefix}/routines/${routine.id}`
                    }
                    companyId={company.id}
                    className="min-w-0 flex-1 truncate hover:underline decoration-dotted underline-offset-2"
                    title={`${routine.title} · ${company.name} — ${label}`}
                  >
                    {routine.title}
                  </TicklerLink>
                  <span className={cn("shrink-0 tabular-nums", MICRO, KIND_TONE[kind])}>
                    {kind === "overdue" && lateMs !== null
                      ? `overdue ${formatAgeMinutes(Math.round(lateMs / 60_000))}`
                      : kind}
                  </span>
                </li>
              );
            })}
          </ul>
          {healthy > 0 && (
            <p data-rail-foot className={cn("shrink-0 border-t px-3 py-1.5 text-muted-foreground", MICRO)}>
              {healthy} healthy routine{healthy === 1 ? "" : "s"} not shown
            </p>
          )}
        </>
      )}
    </section>
  );
}
