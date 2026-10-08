/**
 * Repairs the host's per-company "last page" memory for the Tickler route.
 *
 * Paperclip remembers the last page visited in each company under
 * `localStorage["paperclip.companyPaths"]` and, on a company switch, navigates
 * to `/${prefix}${remembered}`. It makes the remembered path company-relative
 * with `toCompanyRelativePath`, which strips the prefix only for the board
 * routes it knows about — and plugin pages are not among them. So `/PLA/tickler`
 * is stored as-is, and the next switch into PLA lands on `/PLA/PLA/tickler`,
 * Paperclip's not-found page (GH#79).
 *
 * Until the host learns about plugin routes, Tickler rewrites those entries to
 * `/tickler…`, which the host's own sanitizer keeps and prefixes correctly.
 * Nothing else in the map is touched.
 */
import { useEffect } from "react";

export const COMPANY_PATHS_STORAGE_KEY = "paperclip.companyPaths";

// The prefix can repeat: each switch into a broken entry saves the 404 URL it
// landed on, so `/PLA/tickler` becomes `/PLA/PLA/tickler`, then three deep.
const PREFIXED_TICKLER_PATH = /^\/([^/?#]+)(?:\/\1)*(\/tickler(?:[/?#].*)?)$/i;

// Mirrors the host's GLOBAL_ROUTE_ROOTS: a first segment that is not a company.
const GLOBAL_ROOTS = new Set(["auth", "invite", "board-claim", "cli-auth", "docs", "instance", "tickler"]);

/** `/<PREFIX>[/<PREFIX>…]/tickler…` → `/tickler…`; any other path comes back unchanged. */
export function stripTicklerCompanyPrefix(path: string): string {
  const match = PREFIXED_TICKLER_PATH.exec(path);
  if (!match) return path;
  const first = path.slice(1).split("/")[0]!.toLowerCase();
  if (GLOBAL_ROOTS.has(first)) return path;
  return match[2]!;
}

/**
 * Rewrites every prefixed Tickler entry in the host's map. Returns true when it
 * wrote. Missing storage, unparseable JSON and non-string values are left alone.
 */
export function repairRememberedTicklerPaths(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined = safeLocalStorage(),
): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(COMPANY_PATHS_STORAGE_KEY);
    if (!raw) return false;
    const paths: unknown = JSON.parse(raw);
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) return false;
    let changed = false;
    const record = paths as Record<string, unknown>;
    for (const [companyId, path] of Object.entries(record)) {
      if (typeof path !== "string") continue;
      const repaired = stripTicklerCompanyPrefix(path);
      if (repaired !== path) {
        record[companyId] = repaired;
        changed = true;
      }
    }
    if (changed) storage.setItem(COMPANY_PATHS_STORAGE_KEY, JSON.stringify(record));
    return changed;
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Keeps the map repaired while the Tickler page is mounted.
 *
 * The host saves the path from an effect in its layout, which runs after this
 * page's effects and again whenever the company list settles, so a single
 * repair on mount can be overwritten. A switch always starts with a pointer or
 * key press, though, so repairing in the capture phase of those — before the
 * switcher's own handler — guarantees the map is clean when the host reads it.
 * The deferred repair on mount covers the entry this page's own visit wrote.
 */
export function useRepairRememberedTicklerPaths(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const repair = () => {
      repairRememberedTicklerPaths();
    };
    const timer = window.setTimeout(repair, 0);
    window.addEventListener("pointerdown", repair, true);
    window.addEventListener("keydown", repair, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", repair, true);
      window.removeEventListener("keydown", repair, true);
    };
  }, []);
}
