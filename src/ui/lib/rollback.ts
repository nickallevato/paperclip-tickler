/**
 * Which earlier Tickler a crashed page can go back to (PLI-286).
 *
 * The rollback itself is the update chip's mechanism run the other way: the
 * host's `POST /api/plugins/:id/upgrade` takes `{ version }` and hands it to
 * `npm install` with no check that it is newer (plugin-lifecycle `upgrade`,
 * plugin-loader `upgradePlugin`), so an older version installs exactly like an
 * update. What this module adds is the target.
 *
 * ## "Worked in this browser" is the evidence
 *
 * Each time the page has stayed up for `GOOD_AFTER_MS` with nothing caught by
 * a Tickler error boundary, the running version is written to localStorage.
 * After an update that crashes, the newest recorded version older than the one
 * running is the one to offer. It is per browser on purpose: it says "this
 * worked here", which npm's version list cannot.
 *
 * ## What cannot be rolled back from here
 *
 * A bundle that fails to import never runs this code, and the host shows only
 * its own placeholder. That case needs a host-side action and is out of scope.
 *
 * Tickler declares no database namespace or migrations, so a downgrade cannot
 * strand plugin state. What it does change is the registration's capability
 * list, which becomes the older version's: moving forward again to a version
 * that adds a capability then needs a reinstall, and the update chip says so.
 */
import { compareVersions } from "./plugin-reload";

export const LAST_GOOD_STORAGE_KEY = "tickler.lastGoodVersions";

/** How long the page has to stay up before its version counts as working. */
export const GOOD_AFTER_MS = 10_000;

/** Distinct versions kept, newest-recorded first. A rollback rarely goes further back. */
const KEEP = 5;

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

let crashedThisLoad = false;

/**
 * Called by every Tickler error boundary. A load that caught anything does not
 * vouch for its version, even if the page around the crash is still drawing.
 */
export function noteCrash(): void {
  crashedThisLoad = true;
}

export function hasCrashedThisLoad(): boolean {
  return crashedThisLoad;
}

/** Test seam: module state outlives a test otherwise. */
export function resetCrashFlag(): void {
  crashedThisLoad = false;
}

export function readGoodVersions(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LAST_GOOD_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string" && VERSION.test(v))
      : [];
  } catch {
    return [];
  }
}

export function recordGoodVersion(version: string): void {
  if (!VERSION.test(version)) return;
  const next = [version, ...readGoodVersions().filter((v) => v !== version)].slice(0, KEEP);
  try {
    localStorage.setItem(LAST_GOOD_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode or a full quota: no target is offered, nothing else breaks.
  }
}

/** The newest version that worked here and is older than the one running, if any. */
export function rollbackTarget(running: string, good: readonly string[]): string | null {
  const older = good.filter((v) => compareVersions(v, running) < 0);
  if (older.length === 0) return null;
  return older.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/** The slice of npm's abbreviated packument this reads. */
export interface NpmPackument {
  versions?: Record<string, { deprecated?: unknown } | undefined> | null;
}

/**
 * Published versions older than `running`, newest first, for the settings
 * panel's picker. Pre-releases and deprecated versions are left out: neither is
 * something to fall back to.
 */
export function earlierVersions(packument: NpmPackument | null | undefined, running: string): string[] {
  const versions = packument?.versions ?? {};
  return Object.keys(versions)
    .filter((v) => VERSION.test(v) && !v.includes("-") && !versions[v]?.deprecated)
    .filter((v) => compareVersions(v, running) < 0)
    .sort((a, b) => compareVersions(b, a));
}
