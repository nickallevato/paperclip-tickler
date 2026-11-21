import { PLUGIN_ID } from "../../plugin-id";

/**
 * Deciding whether demo mode is on, before a single real byte is rendered.
 *
 * Two switches, in priority order:
 *
 * 1. `?demo=1` / `?demo=0` on the Tickler URL. Costs no network at all and
 *    sticks for the browser session, which is what you actually want mid
 *    walkthrough — flip it in the address bar and every later navigation
 *    inside the app stays in demo.
 * 2. The `demoMode` box on the host's plugin settings page. This is the
 *    durable, discoverable setting, but Paperclip stores plugin config per
 *    company while Tickler is a cross-company page — so reading it costs one
 *    `/api/companies` call to learn which config row to ask for. That call is
 *    made with a bare `fetch` (not `host/api`), returns only ids, and nothing
 *    it returns is ever rendered.
 *
 * The URL parameter is remembered in `sessionStorage`, because it is an
 * explicit choice that has to survive a route hop: Tickler's cross-company links
 * do a full document load, so an override that lasted only as long as the
 * query string would evaporate the moment you clicked anything.
 *
 * But it is remembered *conditionally*, and that condition is the whole point
 * of this module. A remembered override is stored alongside the configured
 * value it was overriding. On the next mount the config is read again, and:
 *
 *   - config unchanged → the override still stands (you said `?demo=0`, and
 *     nobody has touched the setting since, so you stay out of demo);
 *   - config changed   → the override is dropped (someone has since ticked or
 *     unticked the box, which is a more recent instruction than your URL).
 *
 * The earlier version stored the override unconditionally, which meant a
 * single `?demo=0` — the exact thing this file's own error message tells you
 * to use — silently disabled the settings checkbox for the rest of the tab's
 * session, with nothing on screen to say why. Config is therefore read on
 * every mount, unconditionally; the requests are small and the alternative is
 * a setting that cannot be trusted to do anything.
 */

const SESSION_KEY = "tickler.demo";

/**
 * A remembered `?demo=` choice, plus the configured value it was overriding —
 * which is what lets a later change to the setting supersede it.
 */
interface StoredOverride {
  enabled: boolean;
  configWas: boolean;
}

function readOverride(): StoredOverride | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredOverride>;
    if (typeof parsed?.enabled !== "boolean" || typeof parsed?.configWas !== "boolean") return null;
    return { enabled: parsed.enabled, configWas: parsed.configWas };
  } catch {
    // Unparseable or unavailable — treat as no override rather than guessing.
    return null;
  }
}

/** Only ever called for an explicit `?demo=` choice — see `resolveDemoMode`. */
function writeOverride(override: StoredOverride): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(override));
  } catch {
    // Storage unavailable (private mode) — the choice still applies for this render.
  }
}

function clearOverride(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // nothing to clear
  }
}

/** `?demo=1` / `?demo=0`, or null when the parameter is absent or unparseable. */
export function demoParam(search: string): boolean | null {
  const value = new URLSearchParams(search).get("demo");
  if (value === null) return null;
  if (value === "1" || value === "true" || value === "on" || value === "") return true;
  if (value === "0" || value === "false" || value === "off") return false;
  return null;
}

/**
 * Ask the host whether `demoMode` is set for any company this user can see.
 *
 * "Any" rather than "the current one" is deliberate. The config row is
 * company-scoped but the page it configures is not, so requiring the operator
 * to tick the box for every company to demo a cross-company HUD would be a
 * trap. One box ticked anywhere turns the whole page into a demo.
 *
 * Every failure — signed out, no plugin row, config endpoint refused — is
 * answered `false`. Demo mode is opt-in; an unreachable setting must not
 * silently blank out a working HUD.
 */
async function readConfiguredDemoMode(): Promise<boolean> {
  const get = async (path: string): Promise<unknown> => {
    const res = await fetch(path, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  };

  const companies = (await get("/api/companies")) as Array<{ id?: unknown }> | null;
  if (!Array.isArray(companies) || companies.length === 0) return false;

  // All at once, not one after another: the page shows nothing until this
  // settles, and in turn it cost one round trip per org before the board could
  // start loading (PLI-371). One org's lookup failing does not hide another's.
  const rows = await Promise.all(
    companies.flatMap((entry) =>
      typeof entry?.id === "string"
        ? [get(`/api/plugins/${encodeURIComponent(PLUGIN_ID)}/config?companyId=${encodeURIComponent(entry.id)}`).catch(() => null)]
        : [],
    ),
  );
  return rows.some((row) => (row as { configJson?: Record<string, unknown> } | null)?.configJson?.demoMode === true);
}

export interface DemoModeDecision {
  enabled: boolean;
  /** Where the answer came from, for the badge tooltip and for tests. */
  source: "url" | "session" | "config";
  /** Fixture override from plugin config, when one is set. */
  dataUrl?: string;
}

/**
 * Resolve demo mode once, at page mount. Callers must not render real data
 * until this settles.
 */
export async function resolveDemoMode(search: string): Promise<DemoModeDecision> {
  // Read first, always. Every branch below needs to know the current setting —
  // even the URL branch, which records it so a later change can supersede it.
  let configured = false;
  try {
    configured = await readConfiguredDemoMode();
  } catch {
    configured = false;
  }

  const fromUrl = demoParam(search);
  if (fromUrl !== null) {
    writeOverride({ enabled: fromUrl, configWas: configured });
    return { enabled: fromUrl, source: "url" };
  }

  const stored = readOverride();
  if (stored) {
    if (stored.configWas === configured) {
      return { enabled: stored.enabled, source: "session" };
    }
    // The setting has moved since the override was recorded, so the operator
    // has spoken more recently than the URL did. Drop it.
    clearOverride();
  }

  return { enabled: configured, source: "config" };
}

/** Drop any remembered `?demo=` override, so the setting alone decides. */
export function forgetDemoModeChoice(): void {
  clearOverride();
}
