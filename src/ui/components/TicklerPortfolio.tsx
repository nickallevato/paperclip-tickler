import { Fragment } from "react";
import { FolderKanban } from "lucide-react";
import type { Company } from "@paperclipai/shared";
import { CompanyPatternIcon } from "../host/ui-kit";
import { cn } from "../host/util";
import {
  derivePortfolio,
  type TicklerPortfolioEntry,
  type TicklerPortfolioSort,
  type TicklerProjectEntry,
} from "../lib/queue";
import type { TicklerRailPaneBudget } from "../lib/rail-budget";
import { TicklerLink } from "./TicklerLink";
import { railPaneBox, TicklerRailMore } from "./TicklerRailPane";
import { TicklerSegmented } from "./TicklerSegmented";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";

/** Same two-button shape the board header uses for its own order. */
const PORTFOLIO_SORTS = [
  { sort: "trouble" as const, label: "Trouble" },
  { sort: "company" as const, label: "Org" },
] as const;

/** The deadline, in as few characters as a right-aligned column can hold. */
function dueLabel(entry: TicklerPortfolioEntry, nowMs: number): string | null {
  if (entry.dueMs === null) return null;
  if (entry.lateDays !== null) return entry.lateDays === 0 ? "late" : `${entry.lateDays}d late`;
  const days = Math.round((entry.dueMs - nowMs) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 14) return `${days}d`;
  return `${Math.round(days / 7)}w`;
}

/**
 * One project's bar: moving, waiting, blocked, in that order along the track.
 *
 * The order is the story — work enters on the right and leaves on the left,
 * so a healthy project's bar is green-heavy and a stuck one grows an amber
 * tail. Because every bar is scaled to the widest project rather than to its
 * own total, the lengths are comparable down the column: a 40-issue project
 * looks four times the size of a 10-issue one, which is the whole reason to
 * draw them together.
 */
function Bar({ entry, scale }: { entry: TicklerPortfolioEntry; scale: number }) {
  const width = (count: number) => `${(count / scale) * 100}%`;
  return (
    <span
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/50"
      role="img"
      aria-label={`${entry.inProgress} moving, ${entry.waiting} waiting, ${entry.blocked} blocked, of ${entry.open} open`}
      title={`${entry.inProgress} moving · ${entry.waiting} waiting · ${entry.blocked} blocked`}
    >
      <span className="bg-tickler-ok/70" style={{ width: width(entry.inProgress) }} />
      <span className="bg-muted-foreground/35" style={{ width: width(entry.waiting) }} />
      <span className="bg-tickler-wait/80" style={{ width: width(entry.blocked) }} />
    </span>
  );
}

interface CompanyTotals {
  open: number;
  blocked: number;
  late: number;
}

/**
 * The company's own line above its block of bars: who, and the same three
 * figures the pane header carries, scoped to them.
 *
 * Sticky, because the block can be taller than the pane — scrolling past the
 * name would leave a run of bars with nothing saying whose they are, which is
 * the one thing this ordering exists to answer.
 */
function CompanyHeader({ company, totals }: { company: Company; totals: CompanyTotals }) {
  const { open, blocked, late } = totals;
  return (
    <li
      data-portfolio-company={company.id}
      data-rail-row
      className={cn(
        "sticky top-0 z-10 -mx-3 flex items-center gap-1.5 border-b bg-card px-3 pb-1 pt-2 first:pt-0",
        MICRO,
      )}
    >
      <CompanyPatternIcon
        companyName={company.name}
        logoUrl={company.logoUrl}
        className="size-4 shrink-0 rounded text-[7px]"
      />
      <span className="min-w-0 truncate font-semibold text-foreground">{company.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
        <span>{open}</span>
        {blocked > 0 && <span className="text-tickler-wait">{blocked} blocked</span>}
        {late > 0 && <span className="text-tickler-alarm">{late} late</span>}
      </span>
    </li>
  );
}

/**
 * Portfolio: every project with open work, across every company, as one chart.
 *
 * This replaced a foldable list whose rows were never clicked. What people
 * actually read off it was the shape of the bars — how much is moving, how
 * much is stuck — so the bars are the whole component now, ordered worst
 * first (see `comparePortfolioEntries`) rather than by deadline. The project
 * name is still a link, but it is no longer the point of the row.
 */
export function TicklerPortfolio({
  items,
  nowMs,
  companies = [],
  sort = "trouble",
  onSort,
  budget,
  className,
}: {
  items: TicklerProjectEntry[];
  nowMs: number;
  /** The board's company order, so a company sits in the same place in both. */
  companies?: Company[];
  sort?: TicklerPortfolioSort;
  onSort?: (sort: TicklerPortfolioSort) => void;
  budget?: TicklerRailPaneBudget;
  className?: string;
}) {
  const { entries, open, blocked, overdue } = derivePortfolio(items, nowMs, { sort, companies });
  const grouped = sort === "company";
  // Rolled up once rather than rescanned per header — the headers are rendered
  // inside the row loop, so a filter there would be a pass over every entry
  // for every company.
  const totalsByCompany = new Map<string, CompanyTotals>();
  for (const entry of entries) {
    const totals = totalsByCompany.get(entry.company.id) ?? { open: 0, blocked: 0, late: 0 };
    totals.open += entry.open;
    totals.blocked += entry.blocked;
    totals.late += entry.overdue ? 1 : 0;
    totalsByCompany.set(entry.company.id, totals);
  }
  // One shared scale across every bar; a floor of 1 keeps an all-empty
  // portfolio from dividing by zero.
  const scale = Math.max(1, ...entries.map((entry) => entry.open));
  const box = railPaneBox(budget);

  return (
    <section
      data-tickler-portfolio
      data-rail-pane="portfolio"
      style={box.style}
      className={cn("flex min-h-0 flex-col rounded-lg border bg-card", className, box.className)}
    >
      <h3
        data-rail-head
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 pt-3 font-semibold uppercase tracking-(--tracking-label) text-muted-foreground",
          MICRO,
        )}
      >
        <FolderKanban className="h-3 w-3" />
        Portfolio
        {onSort && entries.length > 0 && (
          <TicklerSegmented
            label="Portfolio order"
            options={PORTFOLIO_SORTS.map(({ sort: value, label }) => ({ value, label }))}
            value={sort}
            onChange={onSort}
            optionProps={(value) => ({ "data-portfolio-sort": value })}
          />
        )}
        {entries.length > 0 && (
          <span className="ml-auto flex items-center gap-2 font-normal normal-case tracking-normal tabular-nums">
            <span>{open} open</span>
            {blocked > 0 && <span className="text-tickler-wait">{blocked} blocked</span>}
            {overdue > 0 && <span className="text-tickler-alarm">{overdue} late</span>}
          </span>
        )}
        <TicklerRailMore budget={budget} />
      </h3>

      {entries.length === 0 ? (
        <p data-rail-foot className={cn("px-3 pb-3 italic text-muted-foreground", MICRO)}>
          no open project work
        </p>
      ) : budget?.demoted ? (
        // Bars are only worth drawing against each other, and three of eleven
        // are not a portfolio. The header keeps open, blocked and late.
        null
      ) : (
        <>
          <ul data-rail-scroll className="min-h-0 flex-1 overflow-y-auto px-3">
            {entries.map((entry, index) => {
              const due = dueLabel(entry, nowMs);
              // Grouped order only: in trouble order consecutive bars belong to
              // whoever happens to be in trouble, so a name above them would be
              // a heading over an arbitrary run of one.
              const startsCompany = grouped && entry.company.id !== entries[index - 1]?.company.id;
              return (
                <Fragment key={`${entry.company.id}:${entry.project.id}`}>
                  {startsCompany && (
                    <CompanyHeader company={entry.company} totals={totalsByCompany.get(entry.company.id)!} />
                  )}
                <li
                  data-portfolio-project={entry.project.id}
                  data-rail-row
                  className="flex flex-col gap-1 py-1.5"
                >
                  <span className={cn("flex items-center gap-1.5", MICRO)}>
                    {/* The group header already says whose this is. */}
                    {!grouped && (
                      <CompanyPatternIcon
                        companyName={entry.company.name}
                        logoUrl={entry.company.logoUrl}
                        className="size-3.5 shrink-0 rounded text-[7px]"
                      />
                    )}
                    <TicklerLink
                      to={`/${entry.company.issuePrefix}/projects/${entry.project.urlKey ?? entry.project.id}`}
                      companyId={entry.company.id}
                      className="min-w-0 flex-1 truncate text-[length:var(--tickler-fs-body,14px)] leading-[1.45] text-foreground hover:underline decoration-dotted underline-offset-2"
                      title={`${entry.project.name} · ${entry.company.name}`}
                    >
                      {entry.project.name}
                    </TicklerLink>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{entry.open}</span>
                    {due && (
                      <span
                        className={cn(
                          "w-14 shrink-0 text-right tabular-nums",
                          entry.overdue ? "font-semibold text-tickler-alarm" : "text-muted-foreground",
                        )}
                        title={new Date(entry.dueMs as number).toLocaleDateString()}
                      >
                        {due}
                      </span>
                    )}
                    {!due && <span className="w-14 shrink-0" aria-hidden="true" />}
                  </span>
                  <Bar entry={entry} scale={scale} />
                </li>
                </Fragment>
              );
            })}
          </ul>
          <p
            data-rail-foot
            className={cn("flex shrink-0 items-center gap-3 border-t px-3 py-1.5 text-muted-foreground", MICRO)}
          >
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full bg-tickler-ok/70" /> moving
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full bg-muted-foreground/35" /> waiting
            </span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-full bg-tickler-wait/80" /> blocked
            </span>
          </p>
        </>
      )}
    </section>
  );
}
