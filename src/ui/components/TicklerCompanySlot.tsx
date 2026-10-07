import { useEffect } from "react";
import type { Company } from "@paperclipai/shared";
import {
  deriveCeoHeartbeat,
  derivePaneHealth,
  selectCeo,
  deriveActionable,
  type TicklerActionable,
  type TicklerAlertSnapshot,
  TICKLER_TOKEN_DEFAULTS,
  deriveCompanyStats,
  type TicklerCompanyStats,
  type TicklerTokenThresholds,
} from "../lib/tickler";
import { TicklerCompanyLine } from "./TicklerCompanyLine";
import { useTicklerAlerts } from "./useTicklerAlerts";
import { useTicklerCompanyData, type TicklerCompanyData } from "./useTicklerCompanyData";
import type { TicklerUsageSeries } from "../lib/usage";

/**
 * One slot per company: owns the single useTicklerCompanyData(company.id) poll,
 * renders the company's line in the Companies list, and reports what the page needs from it
 * (stats, the actionable summary, the whole data bundle) upward — the page
 * derives the cross-company rail and lists from those reports rather than
 * polling again.
 */
export function TicklerCompanySlot({
  company,
  onActionable,
  alertsEnabled = false,
  onTogglePin,
  onStats,
  onData,
  tokenThresholds,
  pinned = false,
  onFocusNeeds,
  needsFocused = false,
  usage,
  usageScale,
}: {
  company: Company;
  onActionable?: (companyId: string, actionable: TicklerActionable) => void;
  alertsEnabled?: boolean;
  /** Watched companies sort to the top of the board. */
  onTogglePin?: () => void;
  onStats?: (companyId: string, stats: TicklerCompanyStats) => void;
  /**
   * Fires only when a query's data actually changes (react-query keeps
   * references stable across polls), never on every render.
   */
  onData?: (companyId: string, data: TicklerCompanyData) => void;
  tokenThresholds?: TicklerTokenThresholds;
  pinned?: boolean;
  /** Filter the queue rail to this company (toggle). */
  onFocusNeeds?: () => void;
  needsFocused?: boolean;
  /** This org's hourly tokens and the scale shared across orgs (PLI-278). */
  usage?: TicklerUsageSeries;
  usageScale?: number;
}) {
  const data = useTicklerCompanyData(company.id);
  const ceoOverdue = deriveCeoHeartbeat(selectCeo(data.agents), Date.now()).state === "overdue";
  const actionable = deriveActionable({ approvals: data.approvals, attention: data.attention, ceoOverdue });

  // An unavailable company must alert as red too (never alert an unreachable
  // company as healthy).
  const health = data.unavailable ? "red" : derivePaneHealth(data.summary, data.attention);
  const criticalAttentionIds = (data.attention?.items ?? [])
    .filter((item) => !item.dismissal && item.severity === "critical")
    .map((item) => item.id);
  // Withhold the snapshot until data has actually arrived — see useTicklerAlerts:
  // baselining a placeholder would turn every pre-existing red/critical/
  // overdue condition into a "new" edge on the first real poll.
  const dataReady = !data.isLoading && data.summary !== undefined;
  const alertSnapshot: TicklerAlertSnapshot | null = dataReady ? { health, criticalAttentionIds, ceoOverdue } : null;
  const pulse = useTicklerAlerts(company.name, alertsEnabled, alertSnapshot);

  const stats = deriveCompanyStats({
    summary: data.summary,
    attention: data.attention,
    tokens: data.tokens,
    routines: data.routines,
    unavailable: data.unavailable,
    nowMs: Date.now(),
  });

  // One effect, not three.
  //
  // React Router 7 wraps navigation in `startTransition`, and a transition
  // render can be interrupted indefinitely by higher-priority updates. Each
  // company slot used to push three separate parent setStates per poll, so a
  // dozen companies produced a steady drumbeat of commits into the same tree
  // the host router renders in — enough to starve a route transition so the
  // URL changes while the view never does.
  //
  // Reporting all three together lets React batch them into a single commit,
  // cutting this slot's commit rate to a third of what it was.
  useEffect(() => {
    onActionable?.(company.id, actionable);
    onStats?.(company.id, stats);
    onData?.(company.id, data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    company.id,
    actionable.criticalOrHigh, actionable.count,
    stats.running, stats.active, stats.tasksOpen, stats.tasksInProgress, stats.tasksBlocked, stats.needs,
    stats.critical, stats.failed, stats.oldestMins, stats.tokens, stats.unavailable,
    stats.routines, stats.routinesOverdue, stats.routinesFailing,
    data.summary, data.liveRuns, data.projects, data.issues, data.runIssues, data.agents, data.approvals,
    data.attention, data.routines, data.needsBreakdown, data.tokens,
    data.isLoading, data.unavailable, data.staleSince,
  ]);

  return (
    <TicklerCompanyLine
      company={company}
      data={data}
      stats={stats}
      actionable={actionable}
      thresholds={tokenThresholds ?? TICKLER_TOKEN_DEFAULTS}
      pulse={pulse}
      pinned={pinned}
      onTogglePin={onTogglePin}
      onFocusNeeds={onFocusNeeds}
      needsFocused={needsFocused}
      nowMs={Date.now()}
      usage={usage}
      usageScale={usageScale}
    />
  );
}
