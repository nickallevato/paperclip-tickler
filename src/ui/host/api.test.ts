import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  agentsApi,
  approvalsApi,
  attentionApi,
  authApi,
  dashboardApi,
  heartbeatsApi,
  issuesApi,
  npmRegistryApi,
  pluginSelfApi,
  projectsApi,
  sidebarBadgesApi,
  workTimelineApi,
} from "./api";
import { NPM_LATEST_URL, npmTarballUrl } from "../lib/self-update";

function mockJson(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

function lastCall() {
  const mock = globalThis.fetch as unknown as { mock: { calls: [string, RequestInit][] } };
  return mock.mock.calls[mock.mock.calls.length - 1]!;
}

describe("host/api", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockJson([]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("request plumbing", () => {
    it("prefixes /api and sends credentials so the session cookie rides along", async () => {
      await projectsApi.list("c1");
      const [url, init] = lastCall();
      expect(url).toBe("/api/companies/c1/projects");
      expect(init.credentials).toBe("include");
    });

    it("sets a JSON content type for bodies", async () => {
      vi.stubGlobal("fetch", mockJson({ id: "i1" }));
      await issuesApi.create("c1", { title: "x" });
      const [, init] = lastCall();
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ title: "x" }));
    });

    it("throws ApiError carrying the status and server message", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(
        JSON.stringify({ error: "nope" }),
        { status: 500, headers: { "content-type": "application/json" } },
      )));
      await expect(projectsApi.list("c1")).rejects.toBeInstanceOf(ApiError);
      await expect(projectsApi.list("c1")).rejects.toThrow("nope");
    });

    it("falls back to a status message when the error body is not JSON", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 503 })));
      await expect(projectsApi.list("c1")).rejects.toThrow("503");
    });

    it("returns undefined for 204 responses", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
      await expect(issuesApi.update("i1", { status: "done" })).resolves.toBeUndefined();
    });
  });

  describe("endpoint paths", () => {
    it("builds company-scoped read paths", async () => {
      await agentsApi.list("c1");
      expect(lastCall()[0]).toBe("/api/companies/c1/agents");

      await dashboardApi.summary("c1");
      expect(lastCall()[0]).toBe("/api/companies/c1/dashboard");

      await sidebarBadgesApi.get("c1");
      expect(lastCall()[0]).toBe("/api/companies/c1/sidebar-badges");

      await attentionApi.list("c1");
      expect(lastCall()[0]).toBe("/api/companies/c1/attention");
    });

    it("addresses Tickler's own plugin record by its key", async () => {
      await pluginSelfApi.get();
      expect(lastCall()[0]).toBe("/api/plugins/nickallevato.plugin-tickler");

      await pluginSelfApi.upgrade();
      expect(lastCall()[0]).toBe("/api/plugins/nickallevato.plugin-tickler/upgrade");
      expect(lastCall()[1].method).toBe("POST");
      expect(lastCall()[1].body).toBe("{}");

      // A named version is what makes the update the one the button offered,
      // rather than whatever npm's `latest` has become since the check.
      await pluginSelfApi.upgrade("0.7.1");
      expect(lastCall()[1].body).toBe(JSON.stringify({ version: "0.7.1" }));
    });

    it("adds includeDismissed only when requested", async () => {
      await attentionApi.list("c1", { includeDismissed: true });
      expect(lastCall()[0]).toBe("/api/companies/c1/attention?includeDismissed=true");
    });

    it("encodes the approvals status filter", async () => {
      await approvalsApi.list("c1", "pending review");
      expect(lastCall()[0]).toBe("/api/companies/c1/approvals?status=pending%20review");
    });

    it("omits the approvals query string when no status is given", async () => {
      await approvalsApi.list("c1");
      expect(lastCall()[0]).toBe("/api/companies/c1/approvals");
    });

    it("routes approval decisions to their action endpoints", async () => {
      vi.stubGlobal("fetch", mockJson({ id: "a1" }));
      await approvalsApi.approve("a1", "looks good");
      expect(lastCall()[0]).toBe("/api/approvals/a1/approve");
      expect(lastCall()[1].body).toBe(JSON.stringify({ decisionNote: "looks good" }));

      await approvalsApi.reject("a1");
      expect(lastCall()[0]).toBe("/api/approvals/a1/reject");

      await approvalsApi.listIssues("a1");
      expect(lastCall()[0]).toBe("/api/approvals/a1/issues");
    });

    it("builds issue paths", async () => {
      vi.stubGlobal("fetch", mockJson({ id: "i1" }));
      await issuesApi.get("i1");
      expect(lastCall()[0]).toBe("/api/issues/i1");

      await issuesApi.update("i1", { status: "done" });
      expect(lastCall()[1].method).toBe("PATCH");

      await issuesApi.addComment("i1", "hello");
      expect(lastCall()[0]).toBe("/api/issues/i1/comments");
      expect(lastCall()[1].body).toBe(JSON.stringify({ body: "hello" }));
    });

    it("includes optional comment flags only when provided", async () => {
      vi.stubGlobal("fetch", mockJson({ id: "cm1" }));
      await issuesApi.addComment("i1", "hi", true);
      expect(lastCall()[1].body).toBe(JSON.stringify({ body: "hi", reopen: true }));
    });

    it("serializes the issue list filters Tickler uses", async () => {
      await issuesApi.list("c1", { status: "done,blocked", limit: 200 });
      expect(lastCall()[0]).toBe("/api/companies/c1/issues?status=done%2Cblocked&limit=200");
    });

    it("omits the issue list query string when no filters are given", async () => {
      await issuesApi.list("c1");
      expect(lastCall()[0]).toBe("/api/companies/c1/issues");
    });

    it("accepts a numeric shorthand for live runs minCount", async () => {
      await heartbeatsApi.liveRunsForCompany("c1", 2);
      expect(lastCall()[0]).toBe("/api/companies/c1/live-runs?minCount=2");
    });

    it("accepts an options object for live runs", async () => {
      await heartbeatsApi.liveRunsForCompany("c1", { limit: 5 });
      expect(lastCall()[0]).toBe("/api/companies/c1/live-runs?limit=5");
    });

    it("serializes the work timeline params Tickler uses", async () => {
      await workTimelineApi.get("c1", { from: "2026-08-01T00:00:00.000Z", limit: 200 });
      expect(lastCall()[0]).toBe(
        "/api/companies/c1/timeline?from=2026-08-01T00%3A00%3A00.000Z&limit=200",
      );
    });

    it("omits the timeline query string when no params are given", async () => {
      await workTimelineApi.get("c1");
      expect(lastCall()[0]).toBe("/api/companies/c1/timeline");
    });
  });

  describe("authApi.getSession", () => {
    it("returns null when unauthenticated rather than throwing", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
      await expect(authApi.getSession()).resolves.toBeNull();
    });

    it("returns the session payload when authenticated", async () => {
      vi.stubGlobal("fetch", mockJson({ user: { id: "u1" } }));
      await expect(authApi.getSession()).resolves.toEqual({ user: { id: "u1" } });
    });
  });

  describe("npmRegistryApi.latestVersion", () => {
    it("reads the published version cross-origin, without the session cookie", async () => {
      vi.stubGlobal("fetch", mockJson({ name: "paperclip-plugin-tickler", version: "0.7.1" }));
      await expect(npmRegistryApi.latestVersion()).resolves.toBe("0.7.1");
      const [url, init] = lastCall();
      expect(url).toBe(NPM_LATEST_URL);
      // A third party has no business receiving Paperclip's cookies.
      expect(init.credentials).toBe("omit");
    });

    it("raises when the registry cannot be reached, so the caller says 'don't know'", async () => {
      vi.stubGlobal("fetch", mockJson({ error: "not found" }, 404));
      await expect(npmRegistryApi.latestVersion()).rejects.toBeInstanceOf(ApiError);
    });

    it("returns null for a body without a version rather than inventing one", async () => {
      vi.stubGlobal("fetch", mockJson({}));
      await expect(npmRegistryApi.latestVersion()).resolves.toBeNull();
    });
  });

  describe("npmRegistryApi.tarballReady", () => {
    const head = (status: number) => vi.fn(async () => new Response(null, { status }));

    it("is true once npm serves the tarball, asked uncached and without cookies", async () => {
      vi.stubGlobal("fetch", head(200));
      await expect(npmRegistryApi.tarballReady("0.7.1")).resolves.toBe(true);
      const [url, init] = lastCall();
      expect(url).toBe(npmTarballUrl("0.7.1"));
      expect(init).toMatchObject({ method: "HEAD", credentials: "omit", cache: "no-store" });
    });

    it("is false on a 404 — the window right after a release", async () => {
      vi.stubGlobal("fetch", head(404));
      await expect(npmRegistryApi.tarballReady("0.7.1")).resolves.toBe(false);
    });

    it("raises on anything else, so the caller says 'don't know'", async () => {
      vi.stubGlobal("fetch", head(503));
      await expect(npmRegistryApi.tarballReady("0.7.1")).rejects.toBeInstanceOf(ApiError);
    });
  });
});
