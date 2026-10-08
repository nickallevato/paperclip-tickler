/**
 * Decides whether a newer Tickler than the installed one has been published to
 * npm, so the page can offer to update to it.
 *
 * Why this exists: Paperclip's plugin manager installs from npm and has no
 * "update" button, so the only way to move from 0.6.0 to 0.7.1 was uninstall
 * and reinstall — which drops the plugin's config row and its per-company
 * settings on the floor. The host does have the right primitive:
 * `POST /api/plugins/:id/upgrade` re-runs `npm install <pkg>@<version>` into
 * the managed plugin directory, re-reads the manifest and re-registers in
 * place, keeping config. Nothing in Paperclip's UI calls it, so Tickler carries
 * the button.
 *
 * This is the npm half of the same question `lib/plugin-reload` asks about a
 * local build. The two are mutually exclusive, and `packagePath` is what tells
 * them apart: the host stores it only for a local-path install (plugin-loader,
 * `installPlugin` — `packagePath: source === "local-filesystem" ? … :
 * undefined`), and for those the upgrade endpoint re-reads that directory
 * rather than fetching from npm. A published version is not that install's
 * source of truth, so this check stands down and the reload badge owns it.
 *
 * ## It fails open, deliberately
 *
 * A self-hosted instance may have no route to registry.npmjs.org, and npm may
 * answer slowly or not at all. Anything this cannot answer is `"unknown"`, and
 * an unknown never renders an update affordance: a button that 400s because the
 * version behind it was a guess is worse than no button.
 *
 * ## `latest` moves before the tarball does
 *
 * Right after a release, npm's `/<pkg>/latest` already names the new version
 * while its tarball still 404s, for about five minutes. The host's upgrade runs
 * `npm install`, which needs the tarball, so a button offered in that window
 * fails (PLI-279). The check therefore also asks whether the tarball is there,
 * and until it is the version is `"publishing"`: shown, but not offered.
 */
import { compareVersions, type InstalledPluginRecord } from "./plugin-reload";

/** Tickler's npm package. The manifest id is a different string by design. */
export const NPM_PACKAGE = "paperclip-plugin-tickler";

/**
 * The registry's metadata for the `latest` dist-tag.
 *
 * Read from the browser, so it has to be an endpoint npm serves with CORS:
 * `/<pkg>/latest` answers `access-control-allow-origin: *`, while the smaller
 * `/-/package/<pkg>/dist-tags` sends no CORS header at all and is unreadable
 * from a page.
 */
export const NPM_LATEST_URL = `https://registry.npmjs.org/${NPM_PACKAGE}/latest`;

/**
 * Every published version, for "Install an earlier version" (PLI-286). The
 * full document answers with `access-control-allow-origin: *` like `/latest`.
 */
export const NPM_PACKUMENT_URL = `https://registry.npmjs.org/${NPM_PACKAGE}`;

/**
 * Where npm serves a version's tarball — the file `npm install` actually needs.
 * Its 404 answers with `access-control-allow-origin: *` too, so a `HEAD` from
 * the page can tell "not there yet" from "unreachable".
 */
export function npmTarballUrl(version: string): string {
  return `https://registry.npmjs.org/${NPM_PACKAGE}/-/${NPM_PACKAGE}-${version}.tgz`;
}

/** How often to look again while a version is publishing. */
export const PUBLISHING_POLL_MS = 30_000;

export type SelfUpdateCheck =
  /** No registration, no answer from npm, or an unreadable one. Renders nothing. */
  | { status: "unknown" }
  /** Installed from a local path; `lib/plugin-reload` owns this install's updates. */
  | { status: "local"; installed: string }
  | { status: "current"; installed: string }
  /** npm names a newer version but cannot serve its tarball yet. Not installable. */
  | { status: "publishing"; installed: string; latest: string }
  /** A newer version is published and the host can take it in place. */
  | { status: "available"; installed: string; latest: string };

/**
 * `tarballReady` is whether npm serves `latest`'s tarball: `false` while it is
 * publishing, and `undefined` when that is not known — not asked yet, or the
 * registry did not answer. Only a definite `true` offers the update.
 */
export function checkSelfUpdate(
  installed: InstalledPluginRecord | null | undefined,
  latest: string | null | undefined,
  tarballReady?: boolean | null,
): SelfUpdateCheck {
  const installedVersion = installed?.version;
  if (!installedVersion) return { status: "unknown" };
  if (installed?.packagePath) return { status: "local", installed: installedVersion };
  if (!latest) return { status: "unknown" };
  if (compareVersions(latest, installedVersion) <= 0) {
    return { status: "current", installed: installedVersion };
  }
  if (tarballReady === true) return { status: "available", installed: installedVersion, latest };
  if (tarballReady === false) return { status: "publishing", installed: installedVersion, latest };
  return { status: "unknown" };
}

/** Whether the check needs the tarball answer: npm names a newer version. */
export function needsTarballCheck(
  installed: InstalledPluginRecord | null | undefined,
  latest: string | null | undefined,
): latest is string {
  return checkSelfUpdate(installed, latest, true).status === "available";
}
