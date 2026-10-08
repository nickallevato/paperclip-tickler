import { useQuery } from "@tanstack/react-query";
import { History, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import manifest from "../../manifest";
import { isDemoActive } from "../demo/demo-runtime";
import { npmRegistryApi, pluginSelfApi } from "../host/api";
import {
  GOOD_AFTER_MS,
  earlierVersions,
  hasCrashedThisLoad,
  readGoodVersions,
  recordGoodVersion,
  rollbackTarget,
} from "../lib/rollback";
import { describeUpgradeError } from "./useTicklerSelfUpdate";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";

/**
 * Renders nothing; once the page has stayed up for a while without a caught
 * error, notes this version as one that works here. See `lib/rollback`.
 */
export function LastGoodVersionRecorder() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!hasCrashedThisLoad()) recordGoodVersion(manifest.version);
    }, GOOD_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

/** Install `version` in place and reload onto it, as the update chip does. */
function useInstallVersion(verb: "roll back" | "install", onDone?: () => void) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const run = (version: string) => {
    setState({ busy: true, error: null });
    pluginSelfApi.upgrade(version).then(
      () => (onDone ? onDone() : window.location.reload()),
      (error: unknown) => setState({ busy: false, error: describeUpgradeError(error, verb) }),
    );
  };
  return { ...state, run };
}

/**
 * "Roll back to x.y.z" in the page and pane error fallbacks.
 *
 * Plain state rather than react-query: a crash is the wrong moment to depend on
 * more machinery than one fetch. It shows only when there is somewhere to go —
 * a version that worked in this browser and is older than the one that threw —
 * and only for an npm install, since the upgrade route re-reads a local
 * checkout from disk whatever version is asked for. With nothing recorded, an
 * npm install gets a pointer to the settings picker instead.
 */
export function RollbackButton({ running = manifest.version, onDone }: {
  running?: string;
  /** Replaces the reload, for tests. */
  onDone?: () => void;
} = {}) {
  const [target] = useState(() => rollbackTarget(running, readGoodVersions()));
  const [fromNpm, setFromNpm] = useState(false);
  const install = useInstallVersion("roll back", onDone);

  useEffect(() => {
    if (isDemoActive()) return;
    let cancelled = false;
    pluginSelfApi.get().then(
      (record) => {
        if (!cancelled) setFromNpm(!record?.packagePath);
      },
      // An unreadable registration offers nothing; a guess that 400s is worse.
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (!fromNpm) return null;
  if (!target) {
    return (
      <span data-error-rollback-hint className="basis-full text-muted-foreground">
        No earlier version has worked in this browser yet, so there is nothing to roll back to
        here. To pick one, open Tickler's settings → Install an earlier version.
      </span>
    );
  }

  const detail =
    `Tickler ${target} worked in this browser. Rolling back reinstalls it from npm in place — ` +
    `settings are kept — and reloads the page. Instance admins only.`;

  return (
    <>
      <button
        type="button"
        data-error-rollback
        title={detail}
        disabled={install.busy}
        onClick={() => install.run(target)}
        className="inline-flex items-center gap-1 rounded border border-tickler-alarm/40 px-1.5 py-0.5 font-medium text-tickler-alarm hover:bg-tickler-alarm/10 disabled:opacity-60"
      >
        {install.busy ? (
          <RefreshCw className="h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <History className="h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        {install.busy ? `Rolling back to ${target}…` : `Roll back to ${target}`}
        <span className="sr-only">{detail}</span>
      </button>
      {install.error && (
        <span role="alert" data-error-rollback-failed className="basis-full text-tickler-alarm">
          {install.error}
        </span>
      )}
    </>
  );
}

/**
 * Settings → "Install an earlier version": every published release older than
 * the one running, for when the crash came before any version was recorded as
 * good here. Collapsed by default, and npm is only asked once it is opened.
 */
export function TicklerEarlierVersionPicker({ running = manifest.version, onDone }: {
  running?: string;
  onDone?: () => void;
} = {}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const install = useInstallVersion("install", onDone);

  const packument = useQuery({
    queryKey: ["tickler", "npm-packument"],
    queryFn: npmRegistryApi.packument,
    enabled: open && !isDemoActive(),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  const versions = earlierVersions(packument.data, running);
  const good = new Set(readGoodVersions());
  const selected = choice || versions[0] || "";

  return (
    <details
      data-earlier-versions
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      className={`${MICRO} text-muted-foreground`}
    >
      <summary className="cursor-pointer select-none">Install an earlier version</summary>
      <div className="mt-1.5 space-y-1.5">
        {packument.isPending && open && <p>Asking npm for the published versions…</p>}
        {packument.isError && <p>Could not reach npm for the version list.</p>}
        {packument.isSuccess && versions.length === 0 && <p>No earlier version is published.</p>}
        {versions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Earlier Tickler version"
              value={selected}
              disabled={install.busy}
              onChange={(event) => setChoice(event.target.value)}
              className="rounded-md border bg-background px-1.5 py-0.5 text-foreground"
            >
              {versions.map((v) => (
                <option key={v} value={v}>
                  {good.has(v) ? `${v} — worked here` : v}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={install.busy || !selected}
              onClick={() => install.run(selected)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium text-foreground hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={`h-3 w-3 shrink-0${install.busy ? " animate-spin" : ""}`} aria-hidden="true" />
              {install.busy ? "Installing…" : `Install ${selected}`}
            </button>
          </div>
        )}
        <p>
          Reinstalls that version from npm in place: settings are kept and the page reloads.
          The update button offers the newest version again afterwards. If a later version
          asks for a new permission, taking it then needs a reinstall. Instance admins only.
        </p>
        {install.error && (
          <p role="alert" className="text-tickler-wait">
            {install.error}
          </p>
        )}
      </div>
    </details>
  );
}
