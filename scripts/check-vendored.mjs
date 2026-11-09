#!/usr/bin/env node
/**
 * Reports drift between `src/ui/host/` and the Paperclip checkout it copies.
 *
 * The README's rule is that vendored host files stay byte-identical to their
 * upstream originals apart from import paths, and that anything else drifting
 * is a bug. Nothing enforced it, so a Paperclip upgrade could change a host
 * component (v2026.916.0 replaced the in-progress status glyph) and Tickler
 * would keep drawing the old one with nothing to say so. Run this after every
 * Paperclip upgrade, beside `pnpm build`.
 *
 * Import lines are ignored — those are the one sanctioned difference. The
 * documented exceptions (README, "Vendored host components") are listed with
 * the reason they are skipped; widen that list only alongside the README.
 *
 * Read-only against the checkout, like build-css.mjs. Exits 1 on drift.
 *
 * Usage:
 *   node scripts/check-vendored.mjs            # summary
 *   node scripts/check-vendored.mjs --diff     # plus a diff per drifted file
 *
 * Environment:
 *   TICKLER_PAPERCLIP   Paperclip checkout (default ~/paperclip)
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paperclip = resolve(process.env.TICKLER_PAPERCLIP ?? join(homedir(), "paperclip"));
const showDiff = process.argv.includes("--diff");

/** Tickler copy → upstream original, relative to the Paperclip checkout. */
const VENDORED = {
  "src/ui/host/status-colors.ts": "ui/src/lib/status-colors.ts",
  "src/ui/host/ui-kit/CompanyPatternIcon.tsx": "ui/src/components/CompanyPatternIcon.tsx",
  "src/ui/host/ui-kit/StatusBadge.tsx": "ui/src/components/StatusBadge.tsx",
  "src/ui/host/ui-kit/StatusGlyph.tsx": "ui/src/components/StatusGlyph.tsx",
  "src/ui/host/ui-kit/badge.tsx": "ui/src/components/ui/badge.tsx",
  "src/ui/host/ui-kit/button.tsx": "ui/src/components/ui/button.tsx",
  "src/ui/host/ui-kit/card.tsx": "ui/src/components/ui/card.tsx",
  "src/ui/host/ui-kit/dropdown-menu.tsx": "ui/src/components/ui/dropdown-menu.tsx",
  "src/ui/host/ui-kit/flyout-appearance.tsx": "ui/src/components/ui/flyout-appearance.tsx",
  "src/ui/host/ui-kit/popover.tsx": "ui/src/components/ui/popover.tsx",
  "src/ui/host/ui-kit/textarea.tsx": "ui/src/components/ui/textarea.tsx",
};

/**
 * Documented exceptions, and the partial copies that are not whole files.
 * These are not compared; they are listed so the report says why.
 */
const SKIPPED = {
  "src/ui/host/ui-kit/dialog.tsx": "documented exception: plain Tailwind positioning",
  "src/ui/host/useCompanyOrder.ts": "documented exception: read path only",
  "src/ui/host/ui-kit/hover-card.tsx": "documented exception: a Tickler original",
  "src/ui/host/companies-query.ts": "a reshaped subset of ui/src/api/companies-query.ts",
  "src/ui/host/api.ts": "a subset of ui/src/api/client.ts plus Tickler's own endpoints",
  "src/ui/host/util.ts": "several host modules; BOARD_ROUTE_ROOTS is compared below",
};

/** Import statements, which may span lines, are the sanctioned difference. */
function withoutImports(source) {
  return source
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^import\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** The set literal named `name`, whitespace-normalised. */
function setLiteral(source, name) {
  const match = source.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

if (!existsSync(join(paperclip, "ui", "src"))) {
  console.error(`check-vendored: no Paperclip checkout at ${paperclip}. Set TICKLER_PAPERCLIP.`);
  process.exit(2);
}

const drifted = [];
for (const [copy, original] of Object.entries(VENDORED)) {
  const upstreamPath = join(paperclip, original);
  if (!existsSync(upstreamPath)) {
    drifted.push({ copy, original, reason: "upstream file is gone" });
    continue;
  }
  const ours = withoutImports(readFileSync(join(root, copy), "utf8"));
  const theirs = withoutImports(readFileSync(upstreamPath, "utf8"));
  if (ours !== theirs) drifted.push({ copy, original, reason: "content differs" });
}

const util = readFileSync(join(root, "src/ui/host/util.ts"), "utf8");
const routes = join(paperclip, "ui/src/lib/company-routes.ts");
if (existsSync(routes)) {
  const upstream = readFileSync(routes, "utf8");
  for (const name of ["BOARD_ROUTE_ROOTS", "GLOBAL_ROUTE_ROOTS"]) {
    if (setLiteral(util, name) !== setLiteral(upstream, name)) {
      drifted.push({ copy: `src/ui/host/util.ts (${name})`, original: "ui/src/lib/company-routes.ts", reason: "route roots differ" });
    }
  }
}

for (const [copy, why] of Object.entries(SKIPPED)) console.log(`  skip   ${copy} — ${why}`);
for (const { copy, original, reason } of drifted) {
  console.log(`  DRIFT  ${copy} ← ${original} (${reason})`);
  if (showDiff && reason === "content differs") {
    spawnSync("diff", ["-u", join(paperclip, original), join(root, copy)], { stdio: "inherit" });
  }
}
const checked = Object.keys(VENDORED).length + 2;
if (drifted.length === 0) {
  console.log(`check-vendored: ${checked} vendored copies match ${paperclip}.`);
} else {
  console.log(`check-vendored: ${drifted.length} of ${checked} drifted from ${paperclip}. Re-copy them (import paths excepted).`);
  process.exit(1);
}
