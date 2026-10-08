import { ArrowUpCircle, RefreshCw } from "lucide-react";
import manifest from "../../manifest";
import type { SelfUpdateCheck } from "../lib/self-update";
import { useTicklerSelfUpdate } from "./useTicklerSelfUpdate";

const CHIP =
  "inline-flex items-center gap-1 rounded-full border border-tickler-wait/40 bg-tickler-wait/10 px-2 py-0.5 text-[length:var(--tickler-fs-micro,11px)] leading-[1.45] font-semibold uppercase tracking-(--tracking-label) text-tickler-wait";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";

/**
 * The header chip: "Update to 0.7.2", "Publishing 0.7.2…" while npm cannot
 * serve that version's tarball yet, and nothing at all otherwise.
 *
 * Silent unless a newer version is definitely published — a chip that appears
 * whenever npm is slow or unreachable teaches people to ignore it. The settings
 * panel below carries the version and the check's outcome for the times
 * somebody wants to go and look. See `lib/self-update`.
 */
export function TicklerUpdateChip({ check: injected, onUpdated }: {
  check?: SelfUpdateCheck;
  onUpdated?: () => void;
} = {}) {
  const { check, isUpdating, error, start } = useTicklerSelfUpdate({ check: injected, onUpdated });

  if (check.status === "publishing") {
    const waiting =
      `Tickler ${check.latest} is being published to npm, and npm cannot serve it yet. ` +
      `This usually takes a few minutes; the update button appears here when it can.`;
    return (
      <span data-self-update-publishing title={waiting} className={`${CHIP} opacity-80`}>
        <RefreshCw className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        {`Publishing ${check.latest}…`}
        <span className="sr-only">{waiting}</span>
      </span>
    );
  }

  if (check.status !== "available") return null;

  const detail =
    `Tickler ${check.latest} is published; this instance is running ${check.installed}. ` +
    `Updating re-registers the plugin in place — settings are kept, and no uninstall is needed.`;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        title={detail}
        disabled={isUpdating}
        onClick={start}
        className={`${CHIP} hover:bg-tickler-wait/20 disabled:opacity-60`}
      >
        {isUpdating ? (
          <RefreshCw className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <ArrowUpCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        {isUpdating ? "Updating…" : `Update to ${check.latest}`}
        <span className="sr-only">{detail}</span>
      </button>
      {error && (
        <span role="alert" className={`${MICRO} text-tickler-wait`}>
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * The settings-panel row: which Tickler is installed, whether a newer one is
 * published, and the same in-place update.
 *
 * Unlike the chip this always renders, because the question it answers — "am I
 * on the current version?" — is one people come to a settings panel to ask, and
 * a blank space is not an answer. The headline version comes from the bundle
 * this page is running, so it is there even when the registration read fails.
 */
export function TicklerSelfUpdatePanel({ check: injected, onUpdated }: {
  check?: SelfUpdateCheck;
  onUpdated?: () => void;
} = {}) {
  const { check, isChecking, isUpdating, error, recheck, start } = useTicklerSelfUpdate({
    check: injected,
    onUpdated,
  });

  const installed = "installed" in check ? check.installed : manifest.version;

  return (
    <div data-self-update className="space-y-1 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--tickler-fs-body,14px)] leading-[1.45] font-semibold">
          Tickler {installed}
        </span>
        <span className={`${MICRO} text-muted-foreground`}>{summary(check, isChecking)}</span>
        {check.status === "available" && (
          <button
            type="button"
            disabled={isUpdating}
            onClick={start}
            className={`ml-auto inline-flex items-center gap-1 rounded-md border border-tickler-wait/40 bg-tickler-wait/10 px-2 py-0.5 ${MICRO} font-medium text-tickler-wait hover:bg-tickler-wait/20 disabled:opacity-60`}
          >
            <RefreshCw
              className={`h-3 w-3 shrink-0${isUpdating ? " animate-spin" : ""}`}
              aria-hidden="true"
            />
            {isUpdating ? "Updating…" : `Update to ${check.latest}`}
          </button>
        )}
        {check.status === "publishing" && (
          <span
            className={`ml-auto inline-flex items-center gap-1 ${MICRO} font-medium text-tickler-wait`}
          >
            <RefreshCw className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
            Publishing…
          </span>
        )}
        {check.status !== "available" && check.status !== "publishing" && check.status !== "local" && (
          <button
            type="button"
            disabled={isChecking}
            onClick={recheck}
            className={`ml-auto rounded-md border px-2 py-0.5 ${MICRO} text-muted-foreground hover:text-foreground disabled:opacity-60`}
          >
            Check again
          </button>
        )}
      </div>
      {check.status === "available" && (
        <p className={`${MICRO} text-muted-foreground`}>
          Updates in place from npm. Your settings and token thresholds are kept, and the page
          reloads when the host has taken the new version. Instance admins only.
        </p>
      )}
      {check.status === "publishing" && (
        <p className={`${MICRO} text-muted-foreground`}>
          npm has the new version listed but cannot serve it yet, so updating now would fail. This
          usually takes a few minutes, and the update button appears on its own.
        </p>
      )}
      {error && (
        <p role="alert" className={`${MICRO} text-tickler-wait`}>
          {error}
        </p>
      )}
    </div>
  );
}

function summary(check: SelfUpdateCheck, isChecking: boolean): string {
  switch (check.status) {
    case "available":
      return `${check.latest} is available`;
    case "publishing":
      return `${check.latest} is publishing on npm`;
    case "current":
      return "Up to date";
    case "local":
      return "Installed from a local checkout — rebuild on disk to update";
    case "unknown":
      return isChecking ? "Checking npm…" : "Could not check npm for a newer version";
  }
}
