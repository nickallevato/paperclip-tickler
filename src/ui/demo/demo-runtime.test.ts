import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtureJson from "./demo-data.json";
import {
  DEMO_DATA_URL,
  DemoRouteError,
  deactivateDemoMode,
  demoRespond,
  installDemoFixture,
  isDemoActive,
  resolveDemoDataUrl,
} from "./demo-runtime";
import type { DemoFixture } from "./demo-types";

const FIXTURE = fixtureJson as unknown as DemoFixture;
const COMPANY = FIXTURE.companyOrder[0];

beforeEach(() => {
  // Re-installed per test: the router mutates the fixture on writes, and a
  // shared instance would let one test's approval leak into the next.
  installDemoFixture(structuredClone(FIXTURE));
});

afterEach(() => {
  deactivateDemoMode();
});

describe("activation", () => {
  it("is inert until a fixture is installed", () => {
    deactivateDemoMode();
    expect(isDemoActive()).toBe(false);
    expect(() => demoRespond("GET", "/companies")).toThrow(DemoRouteError);
  });
});

describe("reads", () => {
  it("serves every endpoint useTicklerCompanyData polls", () => {
    for (const path of [
      "dashboard",
      "live-runs?limit=100",
      "projects",
      "issues?limit=200",
      "agents",
      "approvals?status=pending",
      "attention",
      "routines",
      "costs/by-agent?from=2026-09-01&to=2026-09-30",
      "timeline?from=x&limit=200",
    ]) {
      expect(demoRespond("GET", `/companies/${COMPANY}/${path}`)).toBeDefined();
    }
  });

  it("serves the cross-company reads the HUD opens with", () => {
    expect(demoRespond("GET", "/companies")).toHaveLength(FIXTURE.companies.length);
    expect(demoRespond("GET", "/sidebar-preferences/me")).toEqual({
      orderedIds: FIXTURE.companyOrder,
      updatedAt: null,
    });
    expect(demoRespond("GET", "/auth/get-session")).toEqual(FIXTURE.session);
  });

  it("filters the approvals list to pending, the way the endpoint does", () => {
    const withApprovals = FIXTURE.companyOrder.find(
      (id) => FIXTURE.byCompany[id].approvals.length > 0,
    )!;
    const before = demoRespond("GET", `/companies/${withApprovals}/approvals`) as unknown[];
    expect(before.length).toBeGreaterThan(0);
    demoRespond("POST", `/approvals/${FIXTURE.byCompany[withApprovals].approvals[0].id}/approve`);
    const after = demoRespond("GET", `/companies/${withApprovals}/approvals`) as unknown[];
    expect(after).toHaveLength(before.length - 1);
  });

  it("raises rather than falling through for an unmapped path", () => {
    expect(() => demoRespond("GET", "/companies/nope/dashboard")).toThrow(DemoRouteError);
    expect(() => demoRespond("GET", "/some/unknown/route")).toThrow(DemoRouteError);
    expect(() => demoRespond("DELETE", `/companies/${COMPANY}/issues`)).toThrow(DemoRouteError);
  });
});

describe("writes", () => {
  const companyWithApproval = () =>
    FIXTURE.companyOrder.find((id) => FIXTURE.byCompany[id].approvals.length > 0)!;

  it("clears an approved item from the attention feed and the pane counts", () => {
    const company = companyWithApproval();
    const approvalId = FIXTURE.byCompany[company].approvals[0].id;
    const pendingBefore = (
      demoRespond("GET", `/companies/${company}/dashboard`) as { pendingApprovals: number }
    ).pendingApprovals;

    demoRespond("POST", `/approvals/${approvalId}/approve`, { decisionNote: "ok" });

    const feed = demoRespond("GET", `/companies/${company}/attention`) as {
      items: Array<{ subject: { id: string } }>;
    };
    expect(feed.items.some((item) => item.subject.id === approvalId)).toBe(false);
    expect(
      (demoRespond("GET", `/companies/${company}/dashboard`) as { pendingApprovals: number })
        .pendingApprovals,
    ).toBe(pendingBefore - 1);
  });

  it("sets decide-by and snooze on the fixture's attention row, and archives it", () => {
    const company = FIXTURE.companyOrder[0];
    const target = FIXTURE.byCompany[company].attention.items[0];
    const base = `/companies/${company}/decision-triage/${target.sourceKind}/${target.subject.id}`;
    type Feed = { items: Array<{ subject: { id: string }; sourceKind: string; decideBy: string | null; snoozedUntil: string | null }> };
    const row = () =>
      (demoRespond("GET", `/companies/${company}/attention`) as Feed).items.find(
        (item) => item.subject.id === target.subject.id && item.sourceKind === target.sourceKind,
      );

    demoRespond("PUT", base, { decideBy: "whenever" });
    expect(row()?.decideBy).toBe("whenever");
    demoRespond("PUT", base, { snoozedUntil: "2030-01-01T09:00:00.000Z" });
    // Only the field sent changes.
    expect(row()).toMatchObject({ decideBy: "whenever", snoozedUntil: "2030-01-01T09:00:00.000Z" });

    demoRespond("POST", `/companies/${company}/decision-retention/${target.sourceKind}/${target.subject.id}/archive`);
    expect(row()).toBeUndefined();
  });

  it("resolves an interaction and drops its attention row", () => {
    const issueId = Object.keys(FIXTURE.interactionsByIssue)[0];
    const interaction = FIXTURE.interactionsByIssue[issueId][0];
    demoRespond("POST", `/issues/${issueId}/interactions/${interaction.id}/accept`, {
      selectedOptionIds: ["x"],
    });
    expect(demoRespond("GET", `/issues/${issueId}/interactions`)).toEqual([]);
  });

  it("dismisses a request as the host does: still pending, still in the feed, newer", () => {
    const [issueId, list] = Object.entries(FIXTURE.interactionsByIssue).find(([, entries]) => !entries[0].dismissedAt)!;
    const interaction = list[0];
    const companyId = interaction.companyId;
    const row = () =>
      (demoRespond("GET", `/companies/${companyId}/attention`) as DemoFixture["byCompany"][string]["attention"]).items.find(
        (item) => item.subject.id === interaction.id,
      );
    const before = row()!.updatedAt;
    const dismissed = demoRespond("POST", `/issues/${issueId}/interactions/${interaction.id}/dismiss`) as typeof interaction;
    expect(dismissed).toMatchObject({ status: "pending", dismissedByUserId: FIXTURE.session.user.id });
    expect(dismissed.dismissedAt).toBeTruthy();
    expect(row()).toBeDefined();
    expect(row()!.updatedAt).not.toBe(before);
    expect(demoRespond("GET", `/issues/${issueId}/interactions`)).toEqual([dismissed]);
    // Idempotent, like the host: a second dismiss changes nothing.
    const stamp = row()!.updatedAt;
    expect(demoRespond("POST", `/issues/${issueId}/interactions/${interaction.id}/dismiss`)).toEqual(dismissed);
    expect(row()!.updatedAt).toBe(stamp);
  });

  it("accepts a comment and a status patch without touching the network", () => {
    const issue = FIXTURE.byCompany[COMPANY].issues[0];
    expect(demoRespond("POST", `/issues/${issue.id}/comments`, { body: "hi" })).toMatchObject({
      body: "hi",
    });
    expect(demoRespond("PATCH", `/issues/${issue.id}`, { status: "done" })).toMatchObject({
      status: "done",
    });
  });
});

describe("resolveDemoDataUrl", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("addresses the fixture by the plugin's row UUID", async () => {
    // The asset route only accepts the UUID: its key fallback is unreachable
    // because the guard around getById inspects `error.code` while drizzle
    // puts the Postgres 22P02 on `error.cause`, so a key 500s. See the note on
    // demoDataUrlFor.
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [
        { id: "not-tickler", pluginKey: "example.other-plugin" },
        { id: "217cec6e-20a7-4837-a6b0-bef9882b9679", pluginKey: "nickallevato.plugin-tickler" },
      ],
    })) as unknown as typeof fetch);
    await expect(resolveDemoDataUrl()).resolves.toBe(
      "/_plugins/217cec6e-20a7-4837-a6b0-bef9882b9679/ui/demo-data.json",
    );
  });

  it("falls back to the key form when the listing cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => null })) as unknown as typeof fetch);
    await expect(resolveDemoDataUrl()).resolves.toBe(DEMO_DATA_URL);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    await expect(resolveDemoDataUrl()).resolves.toBe(DEMO_DATA_URL);
  });

  it("falls back when the plugin is not in the listing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => [{ id: "x", pluginKey: "example.other-plugin" }],
    })) as unknown as typeof fetch);
    await expect(resolveDemoDataUrl()).resolves.toBe(DEMO_DATA_URL);
  });
});
