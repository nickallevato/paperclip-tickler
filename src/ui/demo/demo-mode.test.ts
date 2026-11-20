import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoParam, forgetDemoModeChoice, resolveDemoMode } from "./demo-mode";

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  forgetDemoModeChoice();
});

describe("demoParam", () => {
  it("reads the affirmative spellings", () => {
    for (const search of ["?demo=1", "?demo=true", "?demo=on", "?demo="]) {
      expect(demoParam(search)).toBe(true);
    }
  });

  it("reads the negative spellings", () => {
    for (const search of ["?demo=0", "?demo=false", "?demo=off"]) {
      expect(demoParam(search)).toBe(false);
    }
  });

  it("is null when absent or unrecognised", () => {
    expect(demoParam("")).toBeNull();
    expect(demoParam("?other=1")).toBeNull();
    expect(demoParam("?demo=maybe")).toBeNull();
  });
});

describe("resolveDemoMode", () => {
  /** Stub the two config calls; `configured` is read fresh on every call. */
  function stubConfig(read: () => boolean) {
    const mock = vi.fn(async (url: string) =>
      url === "/api/companies"
        ? { ok: true, json: async () => [{ id: "c1" }] }
        : { ok: true, json: async () => ({ configJson: { demoMode: read() } }) },
    );
    vi.stubGlobal("fetch", mock as unknown as typeof fetch);
    return mock;
  }

  it("takes the URL parameter over the setting", async () => {
    stubConfig(() => false);
    await expect(resolveDemoMode("?demo=1")).resolves.toEqual({ enabled: true, source: "url" });
    stubConfig(() => true);
    await expect(resolveDemoMode("?demo=0")).resolves.toEqual({ enabled: false, source: "url" });
  });

  it("remembers the override across a route hop", async () => {
    stubConfig(() => false);
    await resolveDemoMode("?demo=1");
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "session" });
  });

  it("lets a later change to the setting supersede a remembered override", async () => {
    // The reported bug: `?demo=0` is what the UI tells you to use to leave
    // demo mode, and it used to disable the settings checkbox for the rest of
    // the tab's session.
    let configured = true;
    stubConfig(() => configured);
    await resolveDemoMode("?demo=0");
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: false, source: "session" });

    configured = false; // operator unticks
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: false, source: "config" });

    configured = true; // ...and ticks again: the box must win
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "config" });
  });

  it("works the same way for an override in the other direction", async () => {
    let configured = false;
    stubConfig(() => configured);
    await resolveDemoMode("?demo=1");
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "session" });

    configured = true; // operator ticks the box, matching what the URL asked for
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "config" });

    configured = false; // and unticks: demo must end
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: false, source: "config" });
  });

  it("re-reads the setting on every mount", async () => {
    let configured = false;
    stubConfig(() => configured);
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: false, source: "config" });
    configured = true;
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "config" });
  });

  it("takes one company with the box ticked as enough", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/companies") {
        return { ok: true, json: async () => [{ id: "c1" }, { id: "c2" }] };
      }
      return { ok: true, json: async () => ({ configJson: { demoMode: url.includes("companyId=c2") } }) };
    }) as unknown as typeof fetch);
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "config" });
  });

  it("asks every company's config at once rather than one after another", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/companies") {
        return { ok: true, json: async () => [{ id: "c1" }, { id: "c2" }, { id: "c3" }] };
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, json: async () => ({ configJson: { demoMode: false } }) };
    }) as unknown as typeof fetch);
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: false, source: "config" });
    expect(peak).toBe(3);
  });

  it("still finds the box when another company's lookup fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "/api/companies") return { ok: true, json: async () => [{ id: "c1" }, { id: "c2" }] };
      if (url.includes("companyId=c1")) throw new Error("offline");
      return { ok: true, json: async () => ({ configJson: { demoMode: true } }) };
    }) as unknown as typeof fetch);
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "config" });
  });

  it("stays off — not stuck — when the config lookup fails outright", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: false, source: "config" });
  });

  it("ignores a corrupt stored override rather than guessing", async () => {
    sessionStorage.setItem("tickler.demo", "not json");
    stubConfig(() => true);
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "config" });
  });

  it("forgetDemoModeChoice hands control back to the setting", async () => {
    stubConfig(() => true);
    await resolveDemoMode("?demo=0");
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: false, source: "session" });
    forgetDemoModeChoice();
    await expect(resolveDemoMode("")).resolves.toEqual({ enabled: true, source: "config" });
  });
});
