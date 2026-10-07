import type { Issue } from "@paperclipai/shared";
import { PLUGIN_ID } from "../../plugin-id";
import { resolveTimeTokens } from "./demo-time";
import type { DemoCompanyData, DemoFixture } from "./demo-types";

/**
 * Demo mode's data plane: a fixture held in memory and a router that answers
 * the same paths `host/api.ts` would otherwise fetch.
 *
 * The interception point is deliberately `host/api.ts` and nothing else.
 * Every read Tickler performs already funnels through that module's `request()`
 * helper (plus the one raw fetch in `authApi.getSession`), so a single seam
 * covers the whole HUD — no component knows demo mode exists, and no future
 * component can accidentally bypass it by rendering real data. The one rule
 * that keeps that true: this module must never import `host/api`, or the two
 * form an import cycle.
 *
 * Fail-closed is the point. If the fixture is missing or a path has no entry,
 * the router raises rather than falling through to the network — the whole
 * reason demo mode exists is that real data must not reach the screen, and a
 * silent fallback would defeat it at exactly the wrong moment.
 */

/**
 * Where the fixture lives, given the plugin's row id.
 *
 * The asset route is `/_plugins/:pluginId/ui/*`, and `:pluginId` has to be the
 * plugin's **UUID**, not its key. The route means to accept either — it calls
 * `getById` and falls back to `getByKey` — but the guard around that first
 * call reads `error.code` while drizzle wraps the Postgres error, so the
 * `22P02` ("invalid input syntax for type uuid") that a key produces sits on
 * `error.cause` instead, escapes the guard, and the route 500s before it ever
 * reaches the fallback. See `server/src/routes/plugin-ui-static.ts` (the
 * `getById` try/catch). Nothing upstream notices because the host builds this
 * URL from the UUID it already holds; the key form is simply broken today.
 */
export function demoDataUrlFor(pluginRowId: string): string {
  return `/_plugins/${encodeURIComponent(pluginRowId)}/ui/demo-data.json`;
}

/**
 * The key-based URL. Kept as a last resort: it is what will work if the
 * upstream guard is ever fixed, and it is better than giving up when the
 * plugin listing is unavailable.
 */
export const DEMO_DATA_URL = demoDataUrlFor(PLUGIN_ID);

/**
 * Ask the host for this plugin's row id, so the fixture URL can use the UUID
 * form the asset route actually accepts. Returns null when the listing cannot
 * be read, leaving the caller to fall back to the key form.
 */
export async function resolveDemoDataUrl(): Promise<string> {
  try {
    const res = await fetch("/api/plugins", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const rows = (await res.json()) as Array<{ id?: unknown; pluginKey?: unknown }>;
      const row = Array.isArray(rows)
        ? rows.find((entry) => entry?.pluginKey === PLUGIN_ID)
        : undefined;
      if (typeof row?.id === "string") return demoDataUrlFor(row.id);
    }
  } catch {
    // fall through to the key form
  }
  return DEMO_DATA_URL;
}

let fixture: DemoFixture | null = null;
let active = false;

export function isDemoActive(): boolean {
  return active;
}

/** The loaded fixture, for components that want to label the demo. */
export function demoFixture(): DemoFixture | null {
  return fixture;
}

/**
 * Fetch and install the fixture, arming the router.
 *
 * `active` is only set after the fixture is in hand: a failed load leaves
 * demo mode off with the caller free to surface the error, rather than
 * leaving the HUD armed with nothing to serve.
 */
export async function activateDemoMode(url?: string, nowMs = Date.now()): Promise<DemoFixture> {
  const target = url ?? (await resolveDemoDataUrl());
  const res = await fetch(target, { credentials: "include", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Demo data unavailable (${res.status}) at ${target}`);
  const raw = (await res.json()) as DemoFixture;
  if (raw?.version !== 1) {
    throw new Error(`Unsupported demo data version: ${String(raw?.version)}`);
  }
  fixture = resolveTimeTokens(raw, nowMs);
  active = true;
  return fixture;
}

/** Used by tests, and by the toggle when demo mode is switched back off. */
export function deactivateDemoMode(): void {
  fixture = null;
  active = false;
}

/** Install a fixture directly, without a fetch. Tests only. */
export function installDemoFixture(next: DemoFixture, nowMs = Date.now()): void {
  fixture = resolveTimeTokens(next, nowMs);
  active = true;
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * The host's entity types declare `createdAt` and friends as `Date`, but the
 * API serves JSON — a real `fetch` hands those back as ISO strings, and every
 * consumer in Tickler already treats them that way (`new Date(issue.updatedAt)`).
 * The fixture matches the wire, not the declared type, so rows it mints are
 * cast here rather than carrying fake `Date` objects the real API never sends.
 */
function asWire<T>(row: unknown): T {
  return row as T;
}

export class DemoRouteError extends Error {
  constructor(path: string) {
    super(`Demo mode has no fixture for ${path}`);
    this.name = "DemoRouteError";
  }
}

function company(id: string): DemoCompanyData {
  const data = fixture?.byCompany[id];
  if (!data) throw new DemoRouteError(`company ${id}`);
  return data;
}

/** Path without its query string, split into non-empty segments. */
function segments(path: string): string[] {
  const [pathname] = path.split("?");
  return pathname.split("/").filter(Boolean);
}

function findIssue(issueId: string) {
  for (const data of Object.values(fixture?.byCompany ?? {})) {
    const issue = data.issues.find((candidate) => candidate.id === issueId);
    if (issue) return { issue, data };
  }
  return null;
}

function findApproval(approvalId: string) {
  for (const data of Object.values(fixture?.byCompany ?? {})) {
    const approval = data.approvals.find((candidate) => candidate.id === approvalId);
    if (approval) return { approval, data };
  }
  return null;
}

/**
 * Drop the attention rows that hang off a thing the demo user just resolved.
 *
 * The real server recomputes the feed on the next poll; here the removal is
 * explicit so approving an item in a demo actually clears it from the queue,
 * the pane counts and the board row at once — the single most visible thing
 * anyone tries during a walkthrough.
 */
function dropAttentionFor(data: DemoCompanyData, subjectId: string): void {
  const items = data.attention.items.filter(
    (item) => item.subject.id !== subjectId && item.relatedIssue?.id !== subjectId,
  );
  data.attention = { ...data.attention, items, totalCount: items.length };
}

/**
 * Answer one request from the fixture.
 *
 * Reads return the stored slice; writes mutate the in-memory fixture so the
 * demo stays interactive (approve an approval and it leaves the queue) and
 * then return the mutated row, the way the real endpoints do. Nothing is
 * persisted — a reload restores the fixture as authored.
 *
 * @throws DemoRouteError when the path has no fixture entry.
 */
export function demoRespond(method: string, path: string, body?: unknown): unknown {
  if (!fixture) throw new DemoRouteError(path);
  const verb = method.toUpperCase();
  const parts = segments(path);

  if (parts[0] === "auth" && parts[1] === "get-session") return fixture.session;

  if (parts[0] === "sidebar-preferences" && parts[1] === "me") {
    return { orderedIds: fixture.companyOrder, updatedAt: null };
  }

  if (parts[0] === "companies") {
    if (parts.length === 1) {
      if (verb === "GET") return fixture.companies;
      throw new DemoRouteError(path);
    }
    const data = company(parts[1]);
    const rest = parts.slice(2);
    if (verb === "GET") {
      switch (rest.join("/")) {
        case "dashboard": return data.dashboard;
        case "live-runs": return data.liveRuns;
        case "projects": return data.projects;
        case "issues": return data.issues;
        case "agents": return data.agents;
        case "approvals": return data.approvals.filter((approval) => approval.status === "pending");
        case "attention": return data.attention;
        case "routines": return data.routines;
        case "costs/by-agent": return data.costsByAgent;
        case "timeline": return data.timeline;
        case "sidebar-badges": return data.sidebarBadges;
      }
    }
    // Decision triage: decide-by / snooze, and archive. Applied to the fixture's
    // attention row so the queue moves lanes exactly as it would live.
    // .../decision-triage/:sourceKind/:sourceId
    // .../decision-retention/:sourceKind/:sourceId/archive
    if ((rest[0] === "decision-triage" || rest[0] === "decision-retention") && rest[1] && rest[2]) {
      const matches = (item: (typeof data.attention.items)[number]) =>
        item.sourceKind === rest[1] && item.subject.id === rest[2];
      if (verb === "PUT" && rest[0] === "decision-triage") {
        const update = (body ?? {}) as { decideBy?: string | null; snoozedUntil?: string | null };
        const items = data.attention.items.map((item) =>
          matches(item)
            ? {
                ...item,
                ...(update.decideBy !== undefined ? { decideBy: update.decideBy } : {}),
                ...(update.snoozedUntil !== undefined ? { snoozedUntil: update.snoozedUntil } : {}),
              }
            : item,
        );
        data.attention = { ...data.attention, items };
        return { sourceKind: rest[1], sourceId: rest[2], ...update };
      }
      if (verb === "POST" && rest[0] === "decision-retention" && rest[3] === "archive") {
        const items = data.attention.items.filter((item) => !matches(item));
        data.attention = { ...data.attention, items, totalCount: items.length };
        // An archived approval leaves the queue too, the way the live feed drops it.
        if (rest[1] === "approval") data.approvals = data.approvals.filter((approval) => approval.id !== rest[2]);
        return { archived: true };
      }
    }
    // Issue creation is the only write scoped to a company; it is accepted so
    // a demo can show the flow, but the new row is local to this page load.
    if (verb === "POST" && rest.join("/") === "issues") {
      const draft = (body ?? {}) as Record<string, unknown>;
      const created = asWire<Issue>({
        ...data.issues[0],
        id: `demo-issue-${Date.now()}`,
        identifier: `${fixture.companies.find((c) => c.id === parts[1])?.issuePrefix ?? "DEMO"}-${data.issues.length + 1}`,
        title: typeof draft.title === "string" ? draft.title : "Untitled",
        description: typeof draft.description === "string" ? draft.description : null,
        status: "todo" as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      data.issues = [created, ...data.issues];
      return created;
    }
    throw new DemoRouteError(path);
  }

  if (parts[0] === "issues" && parts[1]) {
    const found = findIssue(parts[1]);
    if (!found) throw new DemoRouteError(path);
    const { issue, data } = found;
    const rest = parts.slice(2);

    if (verb === "GET" && rest.length === 0) return issue;
    if (verb === "GET" && rest.join("/") === "interactions") {
      return fixture.interactionsByIssue[issue.id] ?? [];
    }
    if (verb === "PATCH" && rest.length === 0) {
      Object.assign(issue, body as Record<string, unknown>, { updatedAt: new Date().toISOString() });
      return issue;
    }
    if (verb === "POST" && rest.join("/") === "comments") {
      const draft = (body ?? {}) as { body?: string };
      issue.updatedAt = asWire<Issue["updatedAt"]>(new Date().toISOString());
      return {
        id: `demo-comment-${Date.now()}`,
        issueId: issue.id,
        body: draft.body ?? "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    // .../interactions/:interactionId/(accept|reject|respond)
    if (verb === "POST" && rest[0] === "interactions" && rest[1] && rest[2]) {
      const list = fixture.interactionsByIssue[issue.id] ?? [];
      const interaction = list.find((candidate) => candidate.id === rest[1]);
      if (!interaction) throw new DemoRouteError(path);
      const status = rest[2] === "reject" ? "rejected" : "accepted";
      Object.assign(interaction, { status, resolvedAt: new Date().toISOString() });
      fixture.interactionsByIssue[issue.id] = list.filter(
        (candidate) => candidate.id !== interaction.id,
      );
      dropAttentionFor(data, interaction.id);
      return interaction;
    }
    throw new DemoRouteError(path);
  }

  if (parts[0] === "approvals" && parts[1]) {
    const found = findApproval(parts[1]);
    if (!found) throw new DemoRouteError(path);
    const { approval, data } = found;
    const action = parts[2];

    if (verb === "GET" && action === "issues") return fixture.issuesByApproval[approval.id] ?? [];
    if (verb === "POST" && (action === "approve" || action === "reject")) {
      const draft = (body ?? {}) as { decisionNote?: string };
      Object.assign(approval, {
        status: action === "approve" ? "approved" : "rejected",
        decisionNote: draft.decisionNote ?? null,
        decidedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      dropAttentionFor(data, approval.id);
      data.dashboard = {
        ...data.dashboard,
        pendingApprovals: Math.max(0, data.dashboard.pendingApprovals - 1),
      };
      return approval;
    }
  }

  // Run now: the run creates an issue, as it would live, so the row can link
  // it. The routine's own company owns both.
  if (verb === "POST" && parts[0] === "routines" && parts[1] && parts[2] === "run") {
    for (const [companyId, data] of Object.entries(fixture.byCompany)) {
      const routine = data.routines.find((candidate) => candidate.id === parts[1]);
      if (!routine) continue;
      const prefix = fixture.companies.find((c) => c.id === companyId)?.issuePrefix ?? "DEMO";
      const now = new Date().toISOString();
      const issue = asWire<Issue>({
        ...data.issues[0],
        id: `demo-issue-${Date.now()}`,
        identifier: `${prefix}-${data.issues.length + 1}`,
        title: routine.title,
        description: null,
        status: "todo" as const,
        createdAt: now,
        updatedAt: now,
      });
      data.issues = [issue, ...data.issues];
      return {
        id: `demo-routine-run-${Date.now()}`,
        companyId,
        routineId: routine.id,
        triggerId: null,
        source: "manual",
        status: "issue_created",
        triggeredAt: now,
        idempotencyKey: null,
        triggerPayload: (body as { variables?: Record<string, unknown> } | undefined)?.variables ?? null,
        dispatchFingerprint: null,
        linkedIssueId: issue.id,
        coalescedIntoRunId: null,
        failureReason: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    }
  }

  throw new DemoRouteError(path);
}
