import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NPM_LATEST_URL,
  NPM_PACKAGE,
  checkSelfUpdate,
  needsTarballCheck,
  npmTarballUrl,
} from "./self-update";

const npm = (version: string) => ({ version, packagePath: null });

describe("checkSelfUpdate", () => {
  it("offers the published version when it is newer than the registration", () => {
    expect(checkSelfUpdate(npm("0.6.0"), "0.7.1", true)).toEqual({
      status: "available",
      installed: "0.6.0",
      latest: "0.7.1",
    });
  });

  it("is publishing, not available, while npm cannot serve the tarball (PLI-279)", () => {
    // `latest` moves minutes before the tarball does; an upgrade in that window
    // runs `npm install` against a 404.
    expect(checkSelfUpdate(npm("0.6.0"), "0.7.1", false)).toEqual({
      status: "publishing",
      installed: "0.6.0",
      latest: "0.7.1",
    });
  });

  it("offers nothing until the tarball has been asked about", () => {
    expect(checkSelfUpdate(npm("0.6.0"), "0.7.1")).toEqual({ status: "unknown" });
    expect(checkSelfUpdate(npm("0.6.0"), "0.7.1", null)).toEqual({ status: "unknown" });
  });

  it("asks about the tarball only when npm names a newer npm-installed version", () => {
    expect(needsTarballCheck(npm("0.6.0"), "0.7.1")).toBe(true);
    expect(needsTarballCheck(npm("0.7.1"), "0.7.1")).toBe(false);
    expect(needsTarballCheck({ version: "0.6.0", packagePath: "/srv/tickler" }, "0.7.1")).toBe(false);
    expect(needsTarballCheck(npm("0.6.0"), null)).toBe(false);
  });

  it("points at npm's tarball path for an unscoped package", () => {
    expect(npmTarballUrl("0.7.1")).toBe(
      `https://registry.npmjs.org/${NPM_PACKAGE}/-/${NPM_PACKAGE}-0.7.1.tgz`,
    );
  });

  it("says nothing to do when the registration is the published version", () => {
    expect(checkSelfUpdate(npm("0.7.1"), "0.7.1")).toEqual({ status: "current", installed: "0.7.1" });
  });

  it("does not offer to go backwards when npm is behind the registration", () => {
    // A prerelease installed by hand, or a version unpublished from the registry.
    expect(checkSelfUpdate(npm("0.8.0"), "0.7.1")).toEqual({ status: "current", installed: "0.8.0" });
  });

  it("stands down for a local-path install, whatever npm says", () => {
    // The host's upgrade endpoint re-reads that directory rather than fetching
    // from npm, so a published version is not this install's source of truth.
    expect(checkSelfUpdate({ version: "0.6.0", packagePath: "/srv/tickler" }, "0.7.1")).toEqual({
      status: "local",
      installed: "0.6.0",
    });
  });

  it("is unknown, not current, when npm could not be read", () => {
    expect(checkSelfUpdate(npm("0.7.1"), null)).toEqual({ status: "unknown" });
    expect(checkSelfUpdate(npm("0.7.1"), undefined)).toEqual({ status: "unknown" });
  });

  it("is unknown when there is no registration to compare against", () => {
    expect(checkSelfUpdate(null, "0.7.1")).toEqual({ status: "unknown" });
    expect(checkSelfUpdate({ version: null }, "0.7.1")).toEqual({ status: "unknown" });
  });

  it("reads the registry endpoint that answers with CORS", () => {
    // `/-/package/<pkg>/dist-tags` is smaller but sends no CORS header, so it
    // is unreadable from the page. Keep this on `/<pkg>/latest`.
    expect(NPM_LATEST_URL).toBe(`https://registry.npmjs.org/${NPM_PACKAGE}/latest`);
  });

  it("names the package this repository actually publishes", () => {
    // The Plica → Tickler rename moved this string once already. A stale name
    // here checks a package nobody installs, and the button never appears.
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../../package.json"), "utf8"));
    expect(NPM_PACKAGE).toBe(pkg.name);
  });
});
