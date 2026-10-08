import { afterEach, describe, expect, it } from "vitest";
import {
  LAST_GOOD_STORAGE_KEY,
  earlierVersions,
  readGoodVersions,
  recordGoodVersion,
  rollbackTarget,
} from "./rollback";

afterEach(() => localStorage.clear());

describe("recordGoodVersion", () => {
  it("keeps distinct versions, most recently recorded first, and only five", () => {
    for (const v of ["0.10.0", "0.11.0", "0.10.0", "0.12.0", "0.13.0", "0.14.0", "0.15.0"]) {
      recordGoodVersion(v);
    }
    expect(readGoodVersions()).toEqual(["0.15.0", "0.14.0", "0.13.0", "0.12.0", "0.10.0"]);
  });

  it("reads a corrupt or foreign value as nothing recorded", () => {
    localStorage.setItem(LAST_GOOD_STORAGE_KEY, "{not json");
    expect(readGoodVersions()).toEqual([]);
    localStorage.setItem(LAST_GOOD_STORAGE_KEY, JSON.stringify(["0.14.0", 7, "latest"]));
    expect(readGoodVersions()).toEqual(["0.14.0"]);
  });
});

describe("rollbackTarget", () => {
  it("is the newest recorded version older than the one running", () => {
    expect(rollbackTarget("0.16.0", ["0.16.0", "0.14.3", "0.15.0", "0.9.0"])).toBe("0.15.0");
  });

  it("offers nothing when this browser has no older version that worked", () => {
    expect(rollbackTarget("0.16.0", ["0.16.0"])).toBeNull();
    expect(rollbackTarget("0.16.0", [])).toBeNull();
  });

  it("does not offer a newer version as a rollback", () => {
    // Running an older build after a rollback: 0.16.0 is not "back".
    expect(rollbackTarget("0.15.0", ["0.16.0", "0.14.3"])).toBe("0.14.3");
  });
});

describe("earlierVersions", () => {
  it("lists older releases newest first, without pre-releases or deprecated ones", () => {
    const packument = {
      versions: {
        "0.9.0": {},
        "0.10.0": {},
        "0.14.3": { deprecated: "broken on Paperclip 2026.9" },
        "0.15.0": {},
        "0.15.1-beta.1": {},
        "0.16.0": {},
        "0.17.0": {},
      },
    };
    expect(earlierVersions(packument, "0.16.0")).toEqual(["0.15.0", "0.10.0", "0.9.0"]);
  });

  it("is empty for a missing or odd document", () => {
    expect(earlierVersions(null, "0.16.0")).toEqual([]);
    expect(earlierVersions({ versions: null }, "0.16.0")).toEqual([]);
  });
});
