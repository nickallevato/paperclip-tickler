import { ExternalLink, Pin } from "lucide-react";
import type { Company } from "@paperclipai/shared";
import { CompanyPatternIcon, HoverCard, HoverCardContent, HoverCardTrigger } from "../host/ui-kit";
import { cn } from "../host/util";
import {
  deriveNeedsBreakdown,
  deriveThroughput,
  formatAgeMinutes,
  formatTokensMillions,
  selectCeo,
  tokenState,
  type TicklerActionable,
  type TicklerCompanyStats,
  type TicklerTokenThresholds,
} from "../lib/tickler";
import { TicklerCapacityStrip } from "./TicklerCapacityStrip";
import { TicklerCeoStrip } from "./TicklerCeoStrip";
import { TicklerLink } from "./TicklerLink";
import { TicklerSparkline } from "./TicklerSparkline";
import type { TicklerCompanyData } from "./useTicklerCompanyData";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";
/** A zero is quieter than muted text: a clear company should read as empty field. */
const ZERO = "text-muted-foreground/40";

/**
 * One company as a single line of the Companies list.
 *
 * The board used to give each company a wide ledger row — Need you, Questions,
 * Blocked, Review, Open, Runs/d, Tokens — which took the page's main column and
 * pushed the queue under it. The queue is where the work happens, so it now
 * owns that column, and a company is reduced to what you scan for: who it is,
 * who is working, how much waits on you, and how busy it is. Everything else
 * is one hover away on the name, so nothing the ledger showed is gone.
 *
 * Colour still marks one thing per line: the Need-you count, ochre when
 * something waits and brick when it is critical or high.
 */
export function TicklerCompanyLine({
  company,
  data,
  stats,
  actionable,
  thresholds,
  pulse = false,
  pinned = false,
  onTogglePin,
  onFocusNeeds,
  needsFocused = false,
  nowMs,
}: {
  company: Company;
  data: TicklerCompanyData;
  stats: TicklerCompanyStats;
  actionable: TicklerActionable;
  thresholds: TicklerTokenThresholds;
  /** Alert ring (useTicklerAlerts) — throbs the line without dimming its text. */
  pulse?: boolean;
  /** Watched companies sort to the top. */
  pinned?: boolean;
  onTogglePin?: () => void;
  /** Filters the queue to this company (toggle). */
  onFocusNeeds?: () => void;
  needsFocused?: boolean;
  nowMs: number;
}) {
  const loading = data.isLoading && !data.unavailable && data.summary === undefined;
  const blind = loading || data.unavailable;
  const throughput = deriveThroughput(data.summary?.runActivity ?? []);
  const ceo = selectCeo(data.agents);
  const needsTone =
    actionable.count === 0 ? ZERO : actionable.criticalOrHigh ? "text-tickler-alarm" : "text-tickler-wait";
  const focusTitle = needsFocused
    ? "Showing only this org in the queue — click to show all"
    : "Click to filter the queue to this org";

  return (
    <li
      data-company-line={company.id}
      data-pulse={pulse}
      data-rail-row
      aria-pressed={onFocusNeeds ? needsFocused : undefined}
      onClick={
        onFocusNeeds
          ? (event) => {
              // The whole line filters the queue, except where a control
              // (pin, link, a capacity square) already owns the click.
              if ((event.target as HTMLElement).closest("button, a, input, [role=button], [data-no-row-click]")) return;
              onFocusNeeds();
            }
          : undefined
      }
      title={onFocusNeeds ? focusTitle : undefined}
      className={cn(
        "flex items-center gap-2.5 border-t px-3 py-2 first:border-t-0 hover:bg-muted/30",
        onFocusNeeds && "cursor-pointer",
        needsFocused && "bg-muted/40 shadow-[inset_2px_0_0_var(--foreground)]",
        pulse && "animate-[pulse_3s_ease-in-out_infinite] bg-tickler-alarm/10 motion-reduce:animate-none",
      )}
    >
      <CompanyPatternIcon
        companyName={company.name}
        logoUrl={company.logoUrl}
        className="size-6 shrink-0 rounded-md text-(length:--text-nano)"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <HoverCard>
            <HoverCardTrigger asChild>
              <button
                type="button"
                onClick={onFocusNeeds}
                aria-pressed={needsFocused}
                data-company-filter
                className={cn(BODY, "min-w-0 truncate text-left font-semibold hover:underline decoration-dotted underline-offset-4")}
              >
                {company.name}
              </button>
            </HoverCardTrigger>
            <HoverCardContent data-company-detail className="w-72">
              <CompanyDetail
                company={company}
                data={data}
                stats={stats}
                actionable={actionable}
                thresholds={thresholds}
                blind={blind}
                pinned={pinned}
                onTogglePin={onTogglePin}
              />
            </HoverCardContent>
          </HoverCard>
          {pinned && <Pin className="h-3 w-3 shrink-0 text-tickler-wait" aria-label="Watched" />}
          {data.unavailable && (
            <span className={cn(MICRO, "rounded-sm border border-tickler-alarm/40 bg-tickler-alarm/10 px-1.5 text-tickler-alarm")}>
              unreachable
            </span>
          )}
          {!data.unavailable && data.staleSince !== null && (
            <span className={cn(MICRO, "rounded-sm border border-tickler-wait/40 bg-tickler-wait/10 px-1.5 text-tickler-wait")}>
              stale
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center" data-no-row-click>
          <TicklerCapacityStrip
            agents={data.agents}
            liveRuns={data.liveRuns}
            issues={data.runIssues.length > 0 ? [...data.issues, ...data.runIssues] : data.issues}
            company={company}
            nowMs={nowMs}
            unavailable={data.unavailable}
            leadAgentId={ceo?.id ?? null}
          />
        </div>
      </div>
      <span
        className={cn(MICRO, "w-12 shrink-0 text-right tabular-nums text-muted-foreground", throughput.total === 0 && ZERO)}
        title={`${throughput.total} run${throughput.total === 1 ? "" : "s"} over 7 days`}
      >
        {blind ? "—" : `${throughput.perDay}/d`}
      </span>
      <span
        data-needs-count
        className={cn(
          "w-8 shrink-0 text-right text-[length:var(--tickler-fs-stat,16px)] leading-[1.15] font-semibold tabular-nums",
          blind ? "text-muted-foreground/50" : needsTone,
        )}
        title={
          actionable.count === 0
            ? "Nothing waiting on you"
            : `${actionable.count} waiting on you${stats.oldestMins !== null ? ` · oldest ${formatAgeMinutes(stats.oldestMins)}` : ""}`
        }
      >
        {blind ? "—" : actionable.count}
      </span>
    </li>
  );
}

/** Everything the old ledger row carried, for the hover card on a company's name. */
function CompanyDetail({
  company,
  data,
  stats,
  actionable,
  thresholds,
  blind,
  pinned,
  onTogglePin,
}: {
  company: Company;
  data: TicklerCompanyData;
  stats: TicklerCompanyStats;
  actionable: TicklerActionable;
  thresholds: TicklerTokenThresholds;
  blind: boolean;
  pinned: boolean;
  onTogglePin?: () => void;
}) {
  const needs = deriveNeedsBreakdown(data.attention);
  const throughput = deriveThroughput(data.summary?.runActivity ?? []);
  const tokenTone = stats.tokens === undefined ? "ok" : tokenState(stats.tokens, thresholds);
  const figures: Array<{ label: string; value: string | number; tone?: string; title?: string }> = [
    { label: "Need you", value: actionable.count, tone: actionable.count === 0 ? ZERO : undefined },
    { label: "Questions", value: needs.questions, tone: needs.questions === 0 ? ZERO : undefined },
    {
      label: "Blocked",
      value: needs.blocked,
      tone: needs.blocked === 0 ? ZERO : undefined,
      title: `${stats.tasksBlocked} issue${stats.tasksBlocked === 1 ? "" : "s"} blocked in total`,
    },
    { label: "Review", value: needs.review, tone: needs.review === 0 ? ZERO : undefined },
    {
      label: "Open",
      value: stats.tasksOpen,
      tone: stats.tasksOpen === 0 ? ZERO : undefined,
      title: `${stats.tasksInProgress} in progress · ${stats.tasksBlocked} blocked`,
    },
    {
      label: "Tokens",
      value: stats.tokens === undefined ? "—" : `${formatTokensMillions(stats.tokens)}M`,
      tone: tokenTone === "crit" ? "text-tickler-alarm" : tokenTone === "warn" ? "text-tickler-wait" : undefined,
      title:
        tokenTone === "crit"
          ? `over your ${formatTokensMillions(thresholds.crit)}M critical line`
          : tokenTone === "warn"
            ? `over your ${formatTokensMillions(thresholds.warn)}M warning line`
            : `under your ${formatTokensMillions(thresholds.warn)}M warning line`,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <CompanyPatternIcon
          companyName={company.name}
          logoUrl={company.logoUrl}
          className="size-5 shrink-0 rounded text-(length:--text-nano)"
        />
        <span className={cn(BODY, "min-w-0 flex-1 truncate font-semibold")}>{company.name}</span>
        {onTogglePin && (
          <button
            type="button"
            onClick={onTogglePin}
            aria-pressed={pinned}
            aria-label={pinned ? `Stop watching ${company.name}` : `Watch ${company.name}`}
            title={pinned ? "Watched — sorts to the top" : "Watch — sort to the top"}
            className={cn("rounded-md p-1", pinned ? "text-tickler-wait" : "text-muted-foreground hover:text-foreground")}
          >
            <Pin className="h-3.5 w-3.5" />
          </button>
        )}
        <TicklerLink
          to={`/${company.issuePrefix}/dashboard`}
          companyId={company.id}
          title={`Open ${company.name}`}
          aria-label={`Open ${company.name}`}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </TicklerLink>
      </div>
      {blind ? (
        <p className={cn(MICRO, "text-muted-foreground")}>{data.unavailable ? "Unreachable." : "Loading…"}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
            {figures.map((figure) => (
              <div key={figure.label} className="flex flex-col" title={figure.title}>
                <dt className={cn(MICRO, "text-muted-foreground")}>{figure.label}</dt>
                <dd className={cn("m-0 text-[length:var(--tickler-fs-stat,16px)] leading-[1.15] font-medium tabular-nums", figure.tone)}>
                  {figure.value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="flex items-center gap-2" title={`${throughput.succeeded} succeeded, ${throughput.failed} failed over 7 days`}>
            <span className={cn(MICRO, "text-muted-foreground")}>Runs</span>
            <span
              className={cn(
                BODY,
                "font-medium tabular-nums",
                throughput.failRatePct !== null && throughput.failRatePct >= 20 && "text-tickler-alarm",
              )}
            >
              {throughput.perDay}/d
            </span>
            <TicklerSparkline runActivity={data.summary?.runActivity ?? []} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className={cn(MICRO, "text-muted-foreground")}>Lead</span>
            <TicklerCeoStrip agents={data.agents} company={company} />
          </div>
        </>
      )}
    </div>
  );
}
