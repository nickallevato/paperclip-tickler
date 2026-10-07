/**
 * Vendored copies of the small Paperclip UI utilities Tickler depends on.
 *
 * Plugin bundles cannot import from the host's `@/lib/*`, so these are copied
 * rather than referenced. Only what Tickler actually uses is vendored — copying
 * the host's full `utils.ts` would drag in `@paperclipai/shared` and create a
 * drift liability for code Tickler never calls.
 *
 * Sources (paperclip @ canary/v2026.807.0-canary.13):
 *   ui/src/lib/utils.ts          → cn
 *   ui/src/lib/status-colors.ts  → priorityColor, priorityColorDefault
 *   ui/src/lib/queryKeys.ts      → the tickler + auth branches
 *   ui/src/lib/company-routes.ts → toCompanyRelativePath and its helpers
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------------------
// Status / priority tokens
// ---------------------------------------------------------------------------

// `status-colors.ts` is vendored wholesale (it is self-contained and has no
// imports), so it stays the single source for these tokens rather than this
// module keeping a second copy that could drift from the one the vendored
// StatusBadge/StatusGlyph render against.
export { priorityColor, priorityColorDefault } from "./status-colors";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

/**
 * Tickler owns its own QueryClient, so these keys only need to be internally
 * consistent — they never have to match the host's cache.
 */
export const queryKeys = {
  tickler: {
    summary: (companyId: string) => ["tickler", "summary", companyId] as const,
    badges: (companyId: string) => ["tickler", "badges", companyId] as const,
    attention: (companyId: string) => ["tickler", "attention", companyId] as const,
    routines: (companyId: string) => ["tickler", "routines", companyId] as const,
    tokens: (companyId: string, from: string, to: string) =>
      ["tickler", "tokens", companyId, from, to] as const,
    activity: (companyId: string) => ["tickler", "activity", companyId] as const,
    // Outside the "tickler" root on purpose: a company's `invalidate()` refetches
    // everything under it after every approve or snooze, and this is the
    // heaviest payload on the page for a figure no click changes.
    usage: (companyId: string) => ["tickler-usage", companyId] as const,
    liveRuns: (companyId: string) => ["tickler", "live-runs", companyId] as const,
    projects: (companyId: string) => ["tickler", "projects", companyId] as const,
    issues: (companyId: string) => ["tickler", "issues", companyId] as const,
    runIssue: (companyId: string, issueId: string) => ["tickler", "run-issue", companyId, issueId] as const,
    approvals: (companyId: string) => ["tickler", "approvals", companyId] as const,
    agents: (companyId: string) => ["tickler", "agents", companyId] as const,
    company: (companyId: string) => ["tickler", "company", companyId] as const,
    timeline: (companyId: string) => ["tickler", "timeline", companyId] as const,
    briefingIssues: (companyId: string) => ["tickler", "briefing-issues", companyId] as const,
  },
  auth: {
    session: ["auth", "session"] as const,
  },
} as const;

// ---------------------------------------------------------------------------
// Company-relative routing
// ---------------------------------------------------------------------------

const BOARD_ROUTE_ROOTS = new Set([
  "dashboard",
  "companies",
  "company",
  "skills",
  "teams-catalog",
  "org",
  "agents",
  "chats",
  "apps",
  "projects",
  "workspaces",
  "execution-workspaces",
  "issues",
  "tasks",
  "routines",
  "goals",
  "artifacts",
  "tools",
  "approvals",
  "costs",
  "usage",
  "activity",
  "audit",
  "decisions",
  "inbox",
  "board-chat",
  "artifacts",
  "u",
  "design-guide",
  "search",
  "settings",
  "timeline",
]);

/**
 * Tracks upstream deliberately.
 *
 * The v4 customization added "tickler" to this set because /tickler was a
 * root-level global route. As a plugin page Tickler lives at /:prefix/tickler and
 * is company-scoped like any other board route, so the entry is omitted.
 */
const GLOBAL_ROUTE_ROOTS = new Set(["auth", "invite", "board-claim", "cli-auth", "docs", "instance"]);

export function normalizeCompanyPrefix(prefix: string): string {
  return prefix.trim().toUpperCase();
}

function splitPath(path: string): { pathname: string; search: string; hash: string } {
  const match = path.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return {
    pathname: match?.[1] ?? path,
    search: match?.[2] ?? "",
    hash: match?.[3] ?? "",
  };
}

export function toCompanyRelativePath(path: string): string {
  const { pathname, search, hash } = splitPath(path);
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length >= 2) {
    const second = segments[1]!.toLowerCase();
    if (!GLOBAL_ROUTE_ROOTS.has(segments[0]!.toLowerCase()) && BOARD_ROUTE_ROOTS.has(second)) {
      return `/${segments.slice(1).join("/")}${search}${hash}`;
    }
  }

  return `${pathname}${search}${hash}`;
}
