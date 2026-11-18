#!/usr/bin/env node
/**
 * Shoots a standalone `docs/mockups/*.html` study, one image per layout ×
 * screen-size pair.
 *
 * The mockups are plain files with no server behind them, so unlike
 * `capture-screenshots.mjs` this needs no running Paperclip — it opens the
 * file over `file://`, clicks the study's own toggles, and crops to the
 * simulated screen. Playwright is resolved the same way, from the host
 * checkout, so this repo still installs nothing.
 *
 * Usage:
 *   node scripts/capture-mockup.mjs sidebar-v3
 *   node scripts/capture-mockup.mjs sidebar-v3 --only budget,tabs
 *
 * Environment:
 *   TICKLER_PLAYWRIGHT  package root to resolve `playwright` from
 *   TICKLER_CHROME      browser executable (default /usr/bin/google-chrome)
 *   TICKLER_SHOT_OUT    output directory (default docs/mockups/<name>)
 */

import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const name = process.argv[2];
if (!name) {
  console.error("usage: capture-mockup.mjs <mockup-name> [--only a,b]");
  process.exit(2);
}
const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(",")) : null;

const page = join(root, "docs", "mockups", `${name}.html`);
if (!existsSync(page)) throw new Error(`no mockup at ${page}`);
const outDir = process.env.TICKLER_SHOT_OUT
  ? resolve(process.env.TICKLER_SHOT_OUT)
  : join(root, "docs", "mockups", name);
mkdirSync(outDir, { recursive: true });

const chrome = process.env.TICKLER_CHROME ?? "/usr/bin/google-chrome";
const require_ = createRequire(join(process.env.TICKLER_PLAYWRIGHT ?? join(homedir(), "paperclip"), "noop.js"));
const { chromium } = require_("playwright");

/** sidebar-v3: layout × screen × org-count triples worth a picture; the rest is one click away. */
const SIDEBAR_SHOTS = [
  { layout: "current", screen: "1440x900" },
  { layout: "current", screen: "1512x790" },
  { layout: "current", screen: "1512x790", orgs: 12 },
  { layout: "budget", screen: "1440x900" },
  { layout: "budget", screen: "1512x790" },
  { layout: "budget", screen: "1512x790", orgs: 12 },
  { layout: "budget", screen: "2560x1400" },
  { layout: "budget", screen: "1180x600", orgs: 12 },
  { layout: "tabs", screen: "1440x900", orgs: 12 },
  { layout: "custom", screen: "1440x900" },
  { layout: "strip", screen: "1280x720" },
];

/** toolbar-badge: every variant is on screen at once, so a shot is a state × width × theme. */
const BADGE_SHOTS = [
  { state: "new", width: "wide", theme: "dark" },
  { state: "today", width: "wide", theme: "dark" },
  { state: "overdue", width: "wide", theme: "dark" },
  { state: "many", width: "wide", theme: "dark" },
  { state: "overdue", width: "narrow", theme: "dark" },
  { state: "overdue", width: "wide", theme: "light" },
];

/** Each study's shots, as the toggles to click and the file name to write. */
const STUDIES = {
  "sidebar-v3": SIDEBAR_SHOTS.map((shot) => {
    const orgs = shot.orgs ?? 4;
    return {
      id: `${shot.layout}-${shot.screen}${orgs === 4 ? "" : `-${orgs}orgs`}`,
      keys: [shot.layout],
      clicks: [`[data-orgs="${orgs}"]`, `[data-screen="${shot.screen}"]`, `[data-layout="${shot.layout}"]`],
    };
  }),
  "toolbar-badge": BADGE_SHOTS.map((shot) => ({
    id: `${shot.state}-${shot.width}-${shot.theme}`,
    keys: [shot.state, shot.width, shot.theme],
    clicks: [`[data-state="${shot.state}"]`, `[data-width="${shot.width}"]`, `[data-theme-btn="${shot.theme}"]`],
  })),
};
const SHOTS = STUDIES[name];
if (!SHOTS) throw new Error(`no shot list for ${name}; add one to STUDIES`);

const browser = await chromium.launch({ executablePath: chrome });
const ctx = await browser.newContext({
  viewport: { width: 1700, height: 1200 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const tab = await ctx.newPage();
await tab.goto(pathToFileURL(page).href);

for (const { id, keys, clicks } of SHOTS) {
  if (only && !keys.some((key) => only.has(key)) && !only.has(id)) continue;
  for (const selector of clicks) await tab.click(selector);
  // The sidebar's budget pass runs in a rAF after the rail has a height; give it a frame.
  await tab.waitForTimeout(200);
  const file = join(outDir, `${id}.png`);
  await tab.locator("#screen").screenshot({ path: file });
  console.log(`wrote ${file}`);
}

await browser.close();
