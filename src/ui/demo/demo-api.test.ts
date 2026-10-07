import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixtureJson from "./demo-data.json";
import { deactivateDemoMode, installDemoFixture } from "./demo-runtime";
import type { DemoFixture } from "./demo-types";
import {
  agentsApi,
  approvalsApi,
  attentionApi,
  authApi,
  companiesApi,
  costsApi,
  dashboardApi,
  heartbeatsApi,
  issuesApi,
  projectsApi,
  routinesApi,
  sidebarPreferencesApi,
  workTimelineApi,
} from "../host/api";

const FIXTURE = fixtureJson as unknown as DemoFixture;
const COMPANY = FIXTURE.companyOrder[0];

/**
 * The point of these tests is the negative: with demo mode armed, no call in
 * `host/api` may reach `fetch`. That is the whole anti-disclosure guarantee —
 * everything else about demo mode is cosmetic if a single read slips past.
 */
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => {
    throw new Error("demo mode must not reach the network");
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  installDemoFixture(structuredClone(FIXTURE));
});

afterEach(() => {
  deactivateDemoMode();
  vi.unstubAllGlobals();
});

describe("host/api under demo mode", () => {
  it("serves every read from the fixture without a network call", async () => {
    await expect(companiesApi.list()).resolves.toHaveLength(FIXTURE.companies.length);
    await expect(sidebarPreferencesApi.getCompanyOrder()).resolves.toMatchObject({
      orderedIds: FIXTURE.companyOrder,
    });
    await expect(authApi.getSession()).resolves.toEqual(FIXTURE.session);
    await expect(dashboardApi.summary(COMPANY)).resolves.toMatchObject({ companyId: COMPANY });
    await expect(heartbeatsApi.liveRunsForCompany(COMPANY, { limit: 100 })).resolves.toBeInstanceOf(Array);
    await expect(projectsApi.list(COMPANY)).resolves.toBeInstanceOf(Array);
    await expect(issuesApi.list(COMPANY, { limit: 200 })).resolves.toBeInstanceOf(Array);
    await expect(agentsApi.list(COMPANY)).resolves.toBeInstanceOf(Array);
    await expect(approvalsApi.list(COMPANY, "pending")).resolves.toBeInstanceOf(Array);
    await expect(attentionApi.list(COMPANY)).resolves.toMatchObject({ companyId: COMPANY });
    await expect(routinesApi.list(COMPANY)).resolves.toBeInstanceOf(Array);
    await expect(costsApi.byAgent(COMPANY, "2026-09-01", "2026-09-30")).resolves.toBeInstanceOf(Array);
    await expect(workTimelineApi.get(COMPANY, { from: "x", limit: 200 })).resolves.toMatchObject({
      spans: expect.any(Array),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps writes local too", async () => {
    const withApproval = FIXTURE.companyOrder.find(
      (id) => FIXTURE.byCompany[id].approvals.length > 0,
    )!;
    const approvalId = FIXTURE.byCompany[withApproval].approvals[0].id;
    await expect(approvalsApi.approve(approvalId, "looks good")).resolves.toMatchObject({
      status: "approved",
      decisionNote: "looks good",
    });

    const issueId = FIXTURE.byCompany[COMPANY].issues[0].id;
    await expect(issuesApi.addComment(issueId, "shipping it")).resolves.toMatchObject({
      body: "shipping it",
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("goes back to the network the moment demo mode is off", async () => {
    deactivateDemoMode();
    await expect(companiesApi.list()).rejects.toThrow(/must not reach the network/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs a routine into a new demo issue the row can link", async () => {
    const routine = FIXTURE.byCompany[COMPANY].routines[0];
    const run = await routinesApi.run(routine.id);
    expect(run).toMatchObject({ routineId: routine.id, status: "issue_created" });
    await expect(issuesApi.get(run.linkedIssueId!)).resolves.toMatchObject({ title: routine.title });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
