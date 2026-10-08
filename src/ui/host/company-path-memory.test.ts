import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_PATHS_STORAGE_KEY,
  repairRememberedTicklerPaths,
  stripTicklerCompanyPrefix,
  useRepairRememberedTicklerPaths,
} from "./company-path-memory";

function stored(): Record<string, string> {
  return JSON.parse(localStorage.getItem(COMPANY_PATHS_STORAGE_KEY) ?? "{}");
}

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("stripTicklerCompanyPrefix", () => {
  it("strips the company prefix from a Tickler path, keeping the rest", () => {
    expect(stripTicklerCompanyPrefix("/PLA/tickler")).toBe("/tickler");
    expect(stripTicklerCompanyPrefix("/PLA/tickler?demo=1")).toBe("/tickler?demo=1");
    expect(stripTicklerCompanyPrefix("/PLA/tickler/sub#x")).toBe("/tickler/sub#x");
  });

  it("strips a prefix that earlier broken switches repeated", () => {
    expect(stripTicklerCompanyPrefix("/PLA/PLA/tickler")).toBe("/tickler");
    expect(stripTicklerCompanyPrefix("/ALP/alp/ALP/tickler?x=1")).toBe("/tickler?x=1");
    expect(stripTicklerCompanyPrefix("/ALP/BRA/tickler")).toBe("/ALP/BRA/tickler");
  });

  it("leaves unprefixed, global and non-Tickler paths alone", () => {
    expect(stripTicklerCompanyPrefix("/tickler")).toBe("/tickler");
    expect(stripTicklerCompanyPrefix("/instance/tickler")).toBe("/instance/tickler");
    expect(stripTicklerCompanyPrefix("/issues/PLA-1")).toBe("/issues/PLA-1");
    expect(stripTicklerCompanyPrefix("/PLA/ticklers")).toBe("/PLA/ticklers");
    expect(stripTicklerCompanyPrefix("/PLA/other/tickler")).toBe("/PLA/other/tickler");
  });
});

describe("repairRememberedTicklerPaths", () => {
  it("rewrites prefixed Tickler entries and nothing else", () => {
    localStorage.setItem(
      COMPANY_PATHS_STORAGE_KEY,
      JSON.stringify({ a: "/PLA/tickler", b: "/tickler", c: "/issues/ACME-4", d: "/ACME/tickler?x=1" }),
    );
    expect(repairRememberedTicklerPaths()).toBe(true);
    expect(stored()).toEqual({ a: "/tickler", b: "/tickler", c: "/issues/ACME-4", d: "/tickler?x=1" });
  });

  it("does not write when nothing needs repair", () => {
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEY, JSON.stringify({ a: "/dashboard" }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    expect(repairRememberedTicklerPaths()).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("tolerates bad JSON, odd shapes and missing storage", () => {
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEY, "{not json");
    expect(repairRememberedTicklerPaths()).toBe(false);
    expect(localStorage.getItem(COMPANY_PATHS_STORAGE_KEY)).toBe("{not json");

    localStorage.setItem(COMPANY_PATHS_STORAGE_KEY, JSON.stringify(["/PLA/tickler"]));
    expect(repairRememberedTicklerPaths()).toBe(false);

    localStorage.setItem(COMPANY_PATHS_STORAGE_KEY, JSON.stringify({ a: 7, b: "/PLA/tickler" }));
    expect(repairRememberedTicklerPaths()).toBe(true);
    expect(JSON.parse(localStorage.getItem(COMPANY_PATHS_STORAGE_KEY)!)).toEqual({ a: 7, b: "/tickler" });

    expect(repairRememberedTicklerPaths(null)).toBe(false);
    const throwing = { getItem: () => { throw new Error("denied"); }, setItem: () => {} };
    expect(repairRememberedTicklerPaths(throwing)).toBe(false);
  });
});

describe("useRepairRememberedTicklerPaths", () => {
  it("repairs after the host's save effect and again before a switch click", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useRepairRememberedTicklerPaths());

    // The host layout's effect writes after the page's effects have run.
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEY, JSON.stringify({ a: "/PLA/tickler" }));
    vi.runAllTimers();
    expect(stored()).toEqual({ a: "/tickler" });

    // A late re-save (company list settling) is caught by the next press.
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEY, JSON.stringify({ a: "/PLA/tickler" }));
    window.dispatchEvent(new Event("pointerdown"));
    expect(stored()).toEqual({ a: "/tickler" });

    unmount();
    localStorage.setItem(COMPANY_PATHS_STORAGE_KEY, JSON.stringify({ a: "/PLA/tickler" }));
    window.dispatchEvent(new Event("pointerdown"));
    expect(stored()).toEqual({ a: "/PLA/tickler" });
  });
});
