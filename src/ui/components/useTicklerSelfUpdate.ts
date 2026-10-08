import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, npmRegistryApi, pluginSelfApi } from "../host/api";
import { isDemoActive } from "../demo/demo-runtime";
import {
  PUBLISHING_POLL_MS,
  checkSelfUpdate,
  needsTarballCheck,
  type SelfUpdateCheck,
} from "../lib/self-update";

/**
 * The state behind Tickler's update-to-latest button, shared by the header chip
 * and the row in the settings panel so both read one registration and one
 * registry answer.
 *
 * Both reads are allowed to fail and both are quiet about it — see
 * `lib/self-update`. The registration is the same query key the reload badge
 * uses, so the two chips cost one request between them.
 */
export function useTicklerSelfUpdate({ onUpdated, check: injected }: {
  /** What to do once the host has re-registered. Defaults to a page reload. */
  onUpdated?: () => void;
  /** Injectable for tests and for a reviewer wanting to see a given state. */
  check?: SelfUpdateCheck;
} = {}) {
  const queryClient = useQueryClient();
  const live = injected === undefined;

  const installed = useQuery({
    queryKey: ["tickler", "plugin-self"],
    queryFn: pluginSelfApi.get,
    enabled: live,
    staleTime: Infinity,
    retry: false,
  });

  const latest = useQuery({
    queryKey: ["tickler", "npm-latest"],
    queryFn: npmRegistryApi.latestVersion,
    // Demo mode never reaches the network, and a fixture has no npm registry to
    // speak of. Nothing to check, so nothing is offered.
    enabled: live && !isDemoActive(),
    // Releases are not frequent enough to be worth re-asking npm within a
    // sitting, and this is a cross-origin request on a page that stays open.
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });

  // npm's `latest` can name a version whose tarball is still 404ing, and the
  // upgrade would fail on it — see `lib/self-update`. Ask about the file itself,
  // and keep asking while it is not there, so the chip turns into a button on
  // its own once the release lands.
  const latestVersion = latest.data;
  const tarballWanted = needsTarballCheck(installed.data, latestVersion);
  const tarball = useQuery({
    queryKey: ["tickler", "npm-tarball", latestVersion],
    queryFn: () => npmRegistryApi.tarballReady(latestVersion as string),
    enabled: live && tarballWanted,
    staleTime: (query) => (query.state.data === true ? Infinity : 0),
    refetchInterval: (query) => (query.state.data === false ? PUBLISHING_POLL_MS : false),
    retry: false,
  });

  const check = injected ?? checkSelfUpdate(installed.data, latestVersion, tarball.data);

  const update = useMutation({
    mutationFn: () =>
      pluginSelfApi.upgrade(check.status === "available" ? check.latest : undefined),
    onSuccess:
      onUpdated ??
      (() => {
        // The host bumps the registration's updatedAt, which is the cache key on
        // the bundle URL, so a plain reload fetches the new build. Drop the
        // registration from the cache first, so a `reload` that a browser serves
        // from memory cache still re-reads it.
        void queryClient.invalidateQueries({ queryKey: ["tickler", "plugin-self"] });
        window.location.reload();
      }),
  });

  return {
    check,
    /** Never both checking and a definite answer: checking means unknown so far. */
    isChecking:
      live && (installed.isPending || latest.isPending || (tarballWanted && tarball.isPending)),
    isUpdating: update.isPending,
    error: describeUpgradeError(update.error),
    /** Ask npm again now, for the "Check again" affordance in the panel. */
    recheck: () => {
      void queryClient.invalidateQueries({ queryKey: ["tickler", "npm-latest"] });
      void queryClient.invalidateQueries({ queryKey: ["tickler", "npm-tarball"] });
      void queryClient.invalidateQueries({ queryKey: ["tickler", "plugin-self"] });
    },
    start: () => update.mutate(),
  };
}

/**
 * The failures worth naming, because each has a different remedy and the host's
 * own wording does not make that obvious.
 *
 * A 403 is the common one and is not the reader's mistake to fix: Paperclip's
 * upgrade route is instance-admin only, and a board member reading the HUD sees
 * the same chip. The capability refusal is the other predictable one — Paperclip
 * grants capabilities at install and refuses an upgrade that declares a new one
 * (plugin-loader, `upgradePlugin`), and there the only way forward really is a
 * reinstall.
 */
export function describeUpgradeError(
  error: unknown,
  /** The rollback (PLI-286) runs through the same route and reads the same refusals. */
  verb: "update" | "roll back" | "install" = "update",
): string | null {
  if (!error) return null;
  if (error instanceof ApiError && error.status === 403) {
    return `Only an instance admin can ${verb} Tickler.`;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/capabilit/i.test(message)) {
    return (
      "This version asks for a permission Paperclip only grants at install. " +
      "Uninstall and reinstall Tickler from the Plugin Manager to take it."
    );
  }
  const label = verb === "update" ? "Update" : verb === "roll back" ? "Rollback" : "Install";
  return `${label} failed: ${message}`;
}
