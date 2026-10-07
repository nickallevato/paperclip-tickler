import type {
  Agent,
  Approval,
  AttentionFeed,
  Company,
  CostByAgent,
  DashboardSummary,
  Issue,
  IssueThreadInteraction,
  Project,
  RoutineListItem,
  SidebarBadges,
  WorkTimelineResult,
} from "@paperclipai/shared";
import type { HeartbeatRunUsageRow, LiveRunForIssue } from "../host/api";

/**
 * Everything one company's panes need, mirroring the eight queries in
 * `useTicklerCompanyData` plus the two the briefing and board rows fetch on
 * demand. Field names match the API method that serves them, so the router in
 * `demo-runtime.ts` reads as a lookup table rather than a translation layer.
 */
export interface DemoCompanyData {
  dashboard: DashboardSummary;
  liveRuns: LiveRunForIssue[];
  /** Finished runs with token usage, for the Orgs pane's hourly strip. */
  heartbeatRuns: HeartbeatRunUsageRow[];
  projects: Project[];
  issues: Issue[];
  agents: Agent[];
  approvals: Approval[];
  attention: AttentionFeed;
  routines: RoutineListItem[];
  costsByAgent: CostByAgent[];
  timeline: WorkTimelineResult;
  sidebarBadges: SidebarBadges;
}

export interface DemoFixture {
  /** Bumped when the shape changes, so a stale cached file fails loudly. */
  version: 1;
  session: {
    user: { id: string; name: string; email: string };
    session: { userId: string };
  };
  /** Company ids in the order the panes should appear. */
  companyOrder: string[];
  companies: Company[];
  byCompany: Record<string, DemoCompanyData>;
  interactionsByIssue: Record<string, IssueThreadInteraction[]>;
  issuesByApproval: Record<string, Issue[]>;
}
