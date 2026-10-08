#!/usr/bin/env node
/**
 * Captures the screenshots the docs embed, from a real running Paperclip with
 * Tickler installed.
 *
 * Every image under `docs/screenshots/` comes out of this script, so a UI
 * change is one command away from up-to-date pictures instead of a manual
 * session with a cropping tool. That matters more than it sounds: stale
 * screenshots are the documentation defect nobody files a bug for.
 *
 * The instance it drives is always in **demo mode** (`?demo=1`), so what lands
 * in `docs/` is Tickler's bundled fixture — invented companies, tickets and
 * agents. No real company name can reach a published image, and the shots stay
 * reproducible because the fixture does not change under us.
 *
 * Playwright is not a dependency of this repo. It is resolved at runtime from
 * the Paperclip checkout that already carries it, the same read-only-reference
 * relationship `build-css.mjs` has with the host stylesheet. Nothing is
 * installed, nothing upstream is written to.
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs
 *   node scripts/capture-screenshots.mjs --only board,queue-by-company
 *   node scripts/capture-screenshots.mjs --list
 *
 * Environment:
 *   TICKLER_SHOT_URL        base URL of the instance   (default http://127.0.0.1:3199)
 *   TICKLER_SHOT_PREFIX     company prefix for the route (default: first active company)
 *   TICKLER_SHOT_PLUGIN_ID  plugin row UUID, for the settings-page shot
 *                         (default: looked up from /api/plugins)
 *   TICKLER_PLAYWRIGHT      package root to resolve `playwright` from
 *                         (default: the Paperclip checkout under $HOME)
 *   TICKLER_CHROME          browser executable (default /usr/bin/google-chrome)
 *   TICKLER_SHOT_OUT        output directory (default docs/screenshots)
 *   TICKLER_SHOT_THEME      "dark" (default) or "light"
 *
 * See docs/screenshots/README.md for how to stand up the instance it needs.
 */

import { createRequire } from "node:module";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = process.env.TICKLER_SHOT_OUT
  ? resolve(process.env.TICKLER_SHOT_OUT)
  : join(root, "docs", "screenshots");

/**
 * The docs are shot in dark mode — the owner's choice, and the theme most of
 * Tickler's time is spent in. Both the browser's colour scheme and Paperclip's
 * own theme preference (`paperclip.theme` in localStorage) are set, so the
 * host chrome and the plugin can never disagree about which one they are in.
 */
const theme = process.env.TICKLER_SHOT_THEME === "light" ? "light" : "dark";

const baseUrl = (process.env.TICKLER_SHOT_URL ?? "http://127.0.0.1:3199").replace(/\/+$/, "");
const chrome = process.env.TICKLER_CHROME ?? "/usr/bin/google-chrome";

/**
 * The default is one machine's path. Say so here rather than letting Playwright
 * fail at launch, several seconds and one opaque spawn error later — the same
 * courtesy `loadPlaywright()` extends for its own default.
 */
function resolveChrome() {
  if (existsSync(chrome)) return chrome;
  throw new Error(
    `capture-screenshots: no browser at ${chrome}. Set TICKLER_CHROME to a Chrome or ` +
      `Chromium executable.`,
  );
}

/**
 * Wide enough that the board's columns and the queue sit side by side, and
 * tall enough that the whole HUD is on screen at once.
 *
 * The height is not cosmetic. The host scrolls an inner `<main>` rather than
 * the document, so `document.scrollHeight` always equals the viewport and a
 * `fullPage` screenshot captures exactly the visible area — anything below the
 * fold is not painted at all and a crop over it fails. Making the viewport
 * taller than the content is what puts the queue and the rail's footer inside
 * a single frame.
 */
const VIEWPORT = { width: 1600, height: 1800 };
/** Retina, so text in the docs is crisp at the width GitHub renders it. */
const SCALE = 2;
/** Padding around a computed crop, in CSS pixels. */
const PAD = 12;

/**
 * Where Playwright lives.
 *
 * A `link:` dependency on the checkout is forbidden (CONTRIBUTING.md), and
 * adding Playwright plus a browser download to this repo's install would cost
 * every contributor ~200 MB for a script most of them never run. Resolving it
 * from the host checkout keeps the read-only-reference relationship the build
 * already has.
 */
function playwrightRoot() {
  if (process.env.TICKLER_PLAYWRIGHT) return process.env.TICKLER_PLAYWRIGHT;
  return join(homedir(), "paperclip");
}

function loadPlaywright() {
  const from = playwrightRoot();
  const pkg = join(from, "package.json");
  if (!existsSync(pkg)) {
    throw new Error(
      `capture-screenshots: no package root at ${from}. Set TICKLER_PLAYWRIGHT to a ` +
        `directory whose node_modules carries playwright.`,
    );
  }
  try {
    return createRequire(pkg)("playwright");
  } catch (error) {
    throw new Error(
      `capture-screenshots: could not resolve playwright from ${from}. ` +
        `Set TICKLER_PLAYWRIGHT to a package root that has it installed. (${error.message})`,
    );
  }
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`GET ${path} → ${response.status}`);
  return response.json();
}

/**
 * The route is `/:companyPrefix/tickler`, and the host matches that segment
 * against a company's `issuePrefix`. Any active company will do — Tickler spans
 * all of them, and in demo mode none of the real ones are rendered anyway.
 */
async function resolvePrefix() {
  if (process.env.TICKLER_SHOT_PREFIX) return process.env.TICKLER_SHOT_PREFIX;
  const companies = await getJson("/api/companies");
  const active = companies.find((company) => company.status !== "archived");
  if (!active) {
    throw new Error(
      "capture-screenshots: the instance has no company, so there is no " +
        "/:companyPrefix to mount the page under. Create one first.",
    );
  }
  return active.issuePrefix;
}

/**
 * Paperclip (v2026.916.0+) floats a product announcement card over the
 * bottom-left of every page until the viewer dismisses it, and a full-page
 * shot then carries it into the docs. Dismissing it is a per-user preference
 * on the throwaway instance, so do that up front. Best effort: an instance
 * without the endpoint simply has nothing to dismiss.
 */
async function dismissAnnouncement() {
  try {
    const current = await fetch(`${baseUrl}/api/announcements/current`);
    if (!current.ok) return;
    const announcement = await current.json();
    if (!announcement?.id) return;
    const companies = await getJson("/api/companies");
    for (const company of companies) {
      await fetch(`${baseUrl}/api/announcements/${announcement.id}/dismiss`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: company.id }),
      });
    }
  } catch {
    // Nothing to dismiss is the common case; a failure here only costs a
    // stray card in a picture, which the reviewer will see.
  }
}

async function resolvePluginId() {
  if (process.env.TICKLER_SHOT_PLUGIN_ID) return process.env.TICKLER_SHOT_PLUGIN_ID;
  const plugins = await getJson("/api/plugins");
  const tickler = plugins.find((plugin) => plugin.pluginKey?.endsWith("plugin-tickler"));
  return tickler?.id ?? null;
}

/**
 * A crop rectangle covering every element in `selectors`, padded.
 *
 * Cropping to elements rather than fixed pixel boxes is what keeps the shots
 * stable across a layout change: a taller queue produces a taller image, not a
 * cut-off one.
 */
async function region(page, selectors, pad = PAD) {
  const boxes = [];
  for (const selector of [].concat(selectors)) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) throw new Error(`no element matches ${selector}`);
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${selector} has no layout box (is it visible?)`);
    boxes.push(box);
  }
  const left = Math.min(...boxes.map((b) => b.x)) - pad;
  const top = Math.min(...boxes.map((b) => b.y)) - pad;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return {
    x: Math.max(0, left),
    y: Math.max(0, top),
    width: right - Math.max(0, left),
    height: bottom - Math.max(0, top),
  };
}

/** The HUD, without the host's sidebar and breadcrumb chrome around it. */
const HUD_SELECTORS = ["[data-tickler-companies]", "[data-tickler-portfolio]", "[data-tickler-queue]"];

/**
 * The README's lead shots are taken at a real screen rather than the tall
 * documentation viewport, because they show what a reader will see on opening
 * the page: the rail budgets its panes to the fold, so at 1600 × 1800 Recent
 * and Portfolio run to their natural height and the picture is of no screen
 * anyone owns. 1150 tall is a desktop monitor's browser window — tall enough
 * that every pane in the rail shows rows; at a 900-tall laptop Routines folds
 * to its header and the lead image loses a pane.
 */
const SCREEN = { viewport: { width: 1600, height: 1150 }, deviceScaleFactor: SCALE };

/** `clip`, cut off at the bottom of the viewport — what is actually on screen. */
function onScreen(page, clip) {
  const { height } = page.viewportSize();
  return { ...clip, height: Math.min(clip.height, height - clip.y) };
}

/**
 * The README's lead image, its queue and its left column, and the two hover
 * cards. Once hand-captured at 1×; scripted since PLI-288 so a UI change
 * cannot leave the first thing a visitor sees out of date.
 */
const README_SHOTS = [
  {
    name: "hero",
    doc: "README lead: the whole page as it opens on a desktop monitor — rail at left, queue in the main column.",
    context: SCREEN,
    take: async (page) => ({ clip: onScreen(page, await region(page, [...HUD_SELECTORS, "h1"])) }),
  },
  {
    name: "needs-you",
    doc: "README queue section: the queue in its default grouping, down to the end of Unsorted.",
    context: { viewport: { width: 1280, height: 1800 }, deviceScaleFactor: SCALE },
    take: async (page) => {
      const queue = await region(page, ["[data-tickler-queue]"]);
      const unsorted = await region(page, ["[data-queue-group='decide:unsorted']"], 0);
      return { clip: { ...queue, height: unsorted.y + unsorted.height - queue.y + PAD } };
    },
  },
  {
    name: "left-rail",
    doc: "README left-column section: Orgs, Recent, Portfolio and Routines as the rail budgets them on that screen.",
    context: SCREEN,
    take: async (page) => ({
      clip: onScreen(page, await region(page, ["[data-tickler-companies]", "[data-tickler-routines]"])),
    }),
  },
  {
    name: "recent-hover",
    doc: "A Recent row's hover card: the ticket, its status, and the agent's last sentence.",
    context: SCREEN,
    before: async (page) => {
      await page.locator("[data-tickler-recent] [data-recent-task] > span").nth(2).hover();
      await page.waitForSelector("[data-recent-detail]", { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
    take: async (page) => ({ clip: await region(page, ["[data-tickler-recent]", "[data-recent-detail]"]) }),
  },
  {
    name: "portfolio-by-org",
    doc: "The portfolio ordered by org instead of by trouble.",
    before: async (page) => {
      await page.locator("[data-portfolio-sort='company']").first().click();
      await page.waitForTimeout(600);
    },
    take: async (page) => ({ clip: await region(page, ["[data-tickler-portfolio]"]) }),
  },
];

/**
 * The shots, in the order the docs introduce them.
 *
 * Each `take` runs against a page already loaded on the Tickler route in demo
 * mode, with the queue settled, in a context of its own — so a shot that
 * clicks a grouping cannot change what the next shot sees.
 */
const SHOTS = [
  ...README_SHOTS,
  {
    name: "tickler-page",
    doc: "The whole page: Orgs, portfolio and routines at left, the queue owning the main column.",
    take: async (page) => ({ clip: await region(page, [...HUD_SELECTORS, "h1"]) }),
  },
  {
    name: "toolbar-button",
    doc: "The Tickler mark the plugin adds to the host's breadcrumb bar.",
    take: async (page) => ({ clip: await region(page, ['a[aria-label="Tickler — all orgs"]'], 16) }),
  },
  {
    name: "board",
    doc: "The Orgs list: one line per org, capacity, and the totals line.",
    take: async (page) => ({ clip: await region(page, ["[data-tickler-companies]"]) }),
  },
  {
    name: "company-detail",
    doc: "An org's detail card: every figure the line leaves out.",
    before: async (page) => {
      await page.locator("[data-company-line] [data-company-filter]").nth(2).hover();
      await page.waitForSelector("[data-company-detail]", { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
    take: async (page) => ({ clip: await region(page, ["[data-tickler-companies]", "[data-company-detail]"]) }),
  },
  {
    name: "recent-tasks",
    doc: "Recent: one line per task, live rows first, scrolling inside the height the rail gave it.",
    take: async (page) => ({ clip: await region(page, ["[data-tickler-recent]"]) }),
  },
  {
    name: "capacity-hover",
    doc: "A capacity square's hover card: the agent, their ticket, what they are doing.",
    before: async (page) => {
      await page.locator("[data-capacity-strip] [data-square-state='working']").first().hover();
      await page.waitForSelector("[data-radix-popper-content-wrapper]", { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
    take: async (page) => ({
      clip: await region(page, ["[data-capacity-strip]", "[data-radix-popper-content-wrapper]"]),
    }),
  },
  {
    name: "phone",
    doc: "Tickler at phone width: the Orgs list, then the queue, each row's actions on a line of their own.",
    // Phone-sized, and scaled like the desktop shots so text stays crisp. The
    // host scrolls an inner <main>, so a tall viewport is what puts the Orgs
    // list and the head of the queue in one frame (see VIEWPORT above).
    context: {
      viewport: { width: 390, height: 1500 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
    take: async (page) => ({ clip: await region(page, ["[data-tickler-companies]", "[data-queue-group='decide:today']"]) }),
  },
  {
    name: "queue-by-decide",
    doc: "The queue in its default grouping: Today, Unsorted, This week, and the rest by when you said you'd decide.",
    take: async (page) => ({ clip: await region(page, ["[data-tickler-queue]"]) }),
  },
  {
    name: "queue-triage-menu",
    doc: "A row's triage menu: decide by, snooze, archive.",
    before: async (page) => {
      await page.locator("[data-queue-group='decide:unsorted'] [data-triage-menu]").first().click();
      await page.waitForSelector("[role='menu']", { timeout: 10_000 });
      await page.waitForTimeout(300);
    },
    take: async (page) => ({
      clip: await region(page, ["[data-queue-group='decide:unsorted'] [data-queue-item]:first-of-type", "[role='menu']"]),
    }),
  },
  {
    name: "queue-by-severity",
    doc: "The same queue grouped by severity: Now, Soon, Later.",
    before: async (page) => groupQueueBy(page, "Severity"),
    take: async (page) => ({ clip: await region(page, ["[data-tickler-queue]"]) }),
  },
  {
    name: "queue-by-company",
    doc: "The same queue grouped by org — a per-org worklist.",
    before: async (page) => groupQueueBy(page, "Org"),
    take: async (page) => ({ clip: await region(page, ["[data-tickler-queue]"]) }),
  },
  {
    name: "queue-by-project",
    doc: "The same queue grouped by project, which is how one noisy project shows up.",
    before: async (page) => groupQueueBy(page, "Project"),
    take: async (page) => ({ clip: await region(page, ["[data-tickler-queue]"]) }),
  },
  {
    name: "queue-controls",
    doc: "The queue's controls: grouping, sort, and the age filter chips.",
    // The full width of the queue, from its top edge down to the last age
    // chip — the two header rows, and nothing of the list below them.
    take: async (page) => {
      const queue = await region(page, ["[data-tickler-queue]"], 0);
      const chips = await region(page, ["[data-age-chip]"], 0);
      return {
        clip: {
          x: queue.x - PAD,
          y: queue.y - PAD,
          width: queue.width + PAD * 2,
          height: chips.y + chips.height - queue.y + PAD * 2,
        },
      };
    },
  },
  {
    name: "queue-actions",
    doc: "Inline Approve / Reject on an approval, without leaving the page.",
    take: async (page) => {
      const row = page
        .locator("[data-queue-item]")
        .filter({ has: page.getByRole("button", { name: "Approve" }) })
        .first();
      const box = await row.boundingBox();
      if (!box) throw new Error("no queue item with an Approve action");
      return {
        clip: { x: box.x - PAD, y: box.y - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 },
      };
    },
  },
  {
    name: "portfolio",
    doc: "The portfolio rail and the routine exceptions beneath it.",
    take: async (page) => ({ clip: await region(page, ["[data-tickler-portfolio]", "[data-tickler-routines]"]) }),
  },
  {
    name: "token-thresholds",
    doc: "Per-company token thresholds, with every company plotted against the bands.",
    before: async (page) => {
      await page.locator('button[aria-label="Token thresholds"]').click();
      await page.waitForSelector("[data-token-settings]", { timeout: 10_000 });
      await page.waitForTimeout(400);
    },
    take: async (page) => ({ clip: await region(page, ["[data-token-settings]"]) }),
  },
  {
    name: "briefing",
    doc: "The briefing strip: what changed since the last visit.",
    // The strip only renders when a previous visit was recorded more than 30
    // minutes ago, so seed one before the page mounts and reads the key.
    seed: (prefix) => ({
      "tickler.lastVisit": new Date(Date.now() - 6 * 60 * 60_000).toISOString(),
      __prefix: prefix,
    }),
    before: async (page) => {
      await page.waitForSelector('[data-testid="tickler-briefing"]', { timeout: 20_000 });
      await page.waitForTimeout(1500);
    },
    take: async (page) => ({ clip: await region(page, ['[data-testid="tickler-briefing"]']) }),
  },
  {
    name: "plugin-settings",
    doc: "The host's plugin settings page, generated from the manifest's instanceConfigSchema.",
    route: (ctx) =>
      ctx.pluginId ? `/${ctx.prefix}/company/settings/instance/plugins/${ctx.pluginId}` : null,
    before: async (page) => {
      await page.waitForSelector("text=Demo mode", { timeout: 30_000 });
      await page.waitForTimeout(800);
    },
    take: async (page) => ({ clip: await region(page, ["text=Demo mode"], 260) }),
  },
];

async function groupQueueBy(page, label) {
  const queue = page.locator("[data-tickler-queue]").first();
  await queue.scrollIntoViewIfNeeded();
  // Inside the queue: the Portfolio pane has an "Org" toggle of its own, earlier
  // in the document, and an unscoped lookup clicked that one instead.
  await queue.getByRole("button", { name: label, exact: true }).first().click();
  await page.waitForTimeout(600);
}

function parseArgs(argv) {
  const only = new Set();
  let list = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--list") list = true;
    else if (argv[i] === "--only") {
      for (const name of (argv[i + 1] ?? "").split(",")) if (name) only.add(name.trim());
      i += 1;
    }
  }
  return { only, list };
}

const { only, list } = parseArgs(process.argv.slice(2));

if (list) {
  for (const shot of SHOTS) console.log(`${shot.name.padEnd(20)} ${shot.doc}`);
  process.exit(0);
}

const { chromium } = loadPlaywright();
const prefix = await resolvePrefix();
const pluginId = await resolvePluginId();
await dismissAnnouncement();
const ticklerUrl = `${baseUrl}/${prefix}/tickler?demo=1`;

mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: resolveChrome(),
  // The capture runs unattended, often in a container without a user
  // namespace; there is no untrusted content here, only our own fixture.
  args: ["--no-sandbox", "--force-color-profile=srgb", "--font-render-hinting=none"],
});
/**
 * One browser context per shot, not one for the run.
 *
 * Tickler persists the queue's grouping, the age chip, the board sort and the
 * pins to `localStorage`. A shared context would carry the grouping a previous
 * shot clicked into every shot after it — which is how "group by project" (a
 * much taller queue) once pushed the briefing off the bottom of the viewport
 * and broke a crop three shots later. A fresh context is a fresh set of
 * defaults.
 */
const contextOptions = {
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  colorScheme: theme,
  // Fixed so relative timestamps in the fixture ("3h ago") and the locale of
  // every date label read the same on every machine that runs this.
  locale: "en-US",
  timeZoneId: "UTC",
  // Tickler's own animations are decorative; a pulsing row mid-capture is noise.
  reducedMotion: "reduce",
};

const failures = [];
let taken = 0;

try {
  for (const shot of SHOTS) {
    if (only.size > 0 && !only.has(shot.name)) continue;
    if (shot.route && !shot.route({ prefix, pluginId })) {
      failures.push(`${shot.name}: skipped, no plugin row found on the instance`);
      continue;
    }

    // A shot may override the context — the phone shot swaps the desktop
    // viewport for a phone-sized one with touch and a mobile user agent.
    const context = await browser.newContext({ ...contextOptions, ...(shot.context ?? {}) });
    const page = await context.newPage();
    try {
      // Always seed: the theme preference, plus whatever the shot needs.
      await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
      await page.evaluate((entries) => {
        for (const [key, value] of Object.entries(entries)) {
          if (key.startsWith("__")) continue;
          localStorage.setItem(key, value);
        }
      }, { "paperclip.theme": theme, ...(shot.seed ? shot.seed(prefix) : {}) });

      const url = shot.route ? `${baseUrl}${shot.route({ prefix, pluginId })}` : ticklerUrl;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!shot.route) {
        // The queue is the last thing to settle: it needs every company's poll
        // to have answered at least once.
        await page.waitForSelector("[data-tickler-queue] [data-queue-item]", { timeout: 60_000 });
        await page.waitForTimeout(2500);
      }
      if (shot.before) await shot.before(page);

      const options = await shot.take(page);
      // `fullPage` so a crop may reach below the fold — the queue and the
      // briefing both sit past the bottom of any sensible viewport, and a clip
      // outside the viewport is an error rather than a scroll.
      await page.screenshot({ path: join(outDir, `${shot.name}.png`), fullPage: true, ...options });
      taken += 1;
      console.log(`✓ ${shot.name}.png`);
    } catch (error) {
      failures.push(`${shot.name}: ${error.message.split("\n")[0]}`);
      console.error(`✗ ${shot.name}: ${error.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}

console.log(`\n${taken}/${SHOTS.length} captured into ${outDir}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failed:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
