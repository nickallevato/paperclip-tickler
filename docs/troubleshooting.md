# Troubleshooting

## The whole app is stuck in its mobile layout

Sidebars collapsed, desktop-only elements missing, everything in one column —
across the whole of Paperclip, not just the Tickler page.

Tickler injects its own Tailwind sheet after the host's. Tailwind emits every
class it scans, including ones Paperclip already defines, and a duplicate that
lands later wins on document order. A stray `.hidden{display:none}` beats
Paperclip's `@media(min-width:40rem){.sm\:flex{…}}`, which is exactly the
`hidden sm:flex` idiom the host's responsive layout is built on.

Tickler prevents this by subtracting, in the browser, every class selector the
host's stylesheets already define before its own sheet takes effect. That is
done against whatever the page has actually loaded, so a Paperclip upgrade does
not cause this, and rebuilding Tickler will not fix it. If you see it anyway, the
subtraction could not see the rule it needed to remove. The ways that happens:

- **The host's stylesheet is unreadable to scripts.** Browsers hide the rules
  of a cross-origin stylesheet from the page, and Tickler skips any sheet it
  cannot read. A stock Paperclip serves its CSS from its own origin; a CDN, a
  reverse proxy that rewrites asset URLs to another host, or a stylesheet
  served without the CORS headers a `crossorigin` link needs will hide it. In
  DevTools, `document.styleSheets[i].cssRules` throwing a `SecurityError` on
  the host's `index-*.css` is the tell. Serve it from the app's own origin.
- **Tickler's styles went in before the host's.** The subtraction runs once, when
  Tickler's bundle loads and injects its `<style id="tickler-plugin-styles">`,
  against the stylesheets present at that moment. A host stylesheet that arrives later — a
  lazily loaded route chunk's CSS, or a proxy or extension that injects one — is
  not subtracted against. Reloading the page usually settles the order; if it
  reproduces on a clean reload, open an issue with the Paperclip version.
- **An old Tickler.** Versions before runtime subtraction did it at build time
  and went stale on every Paperclip upgrade. Upgrade Tickler
  ([Install](install.md#upgrading-an-npm-install)).

To check whether the subtraction ran, ask Tickler's sheet whether it still holds
the `.hidden` rule the host also defines — in a DevTools console on any
Paperclip page (Tickler's bundle loads with its toolbar launcher, so every page has
the sheet):

```js
const has = (rules) => [...rules].some((r) => r.selectorText === ".hidden" || (r.cssRules && has(r.cssRules)));
has(document.getElementById("tickler-plugin-styles").sheet.cssRules);
```

`false` is correct: the duplicate was removed. `true` means one of the causes
above.

Disabling Tickler (`paperclipai plugin disable nickallevato.plugin-tickler`) and
reloading confirms whether Tickler is the cause at all.

## The Tickler page is blank

Work through, in order:

1. **Is the plugin loaded?**
   ```bash
   paperclipai plugin inspect nickallevato.plugin-tickler
   ```
   Anything other than `status=ready` prints the last error.

2. **Has it been built?** (From-source installs only — the npm package ships
   built.) `dist/ui/index.js` must exist. A fresh clone has no `dist` until
   `pnpm build` runs.

3. **Is the URL right?** The route is `/<COMPANY-PREFIX>/tickler`, where the
   prefix is a company's issue prefix (`ACME`, not the company's name or id).

4. **Anything in the browser console?** A failed chunk load usually means the
   installed path moved, or `dist` was deleted after install.

## A pane or the page shows an error notice

Tickler catches its own errors, so a crash costs only the part that hit it:
one org's line in **Orgs**, one pane (Recent, Portfolio, Routines, Needs you),
or — if nothing smaller contains it — the page. The notice shows the error
message and offers:

- **Try again** — draws that part again. Enough when the cause was a passing
  bad response.
- **Copy details** — copies the Tickler version, the error and where it
  happened, ready to paste into a bug report.
- **Report on GitHub** — opens a new issue on Tickler's repo with those
  details prefilled. Nothing is sent until you submit it there.
- **Roll back to x.y.z** — appears when a newer version broke something that
  worked before. Tickler remembers, per browser, which versions drew the page
  without an error; this reinstalls the newest of them from npm, in place,
  keeps your settings, and reloads. Instance admins only, and only for an npm
  install (a local checkout rolls back with git).

If no earlier version has worked in this browser yet, the notice says so
instead: open the gear → **Install an earlier version** and pick one.

None of this can appear if the bundle fails before Tickler's own code runs;
the host then shows its placeholder instead — see
[the next section](#the-page-shows-tickler-tickler-where-the-board-should-be).

## The page shows "Tickler: Tickler" where the board should be

That string is the host's slot placeholder: the bundle was fetched and then
failed to import, so there is no component to put in the slot. The browser
console has one `slots.tsx` error and nothing else.

Two causes, both in how the bundle asks for the host's React:

- **A named import the host's shim does not export.** The host does not let a
  plugin import React itself — it marks `react` and `react-dom` external and
  rewrites those specifiers to small shim modules, and the `react-dom` one
  exports five names: `default`, `createRoot`, `hydrateRoot`, `createPortal`,
  `flushSync`. A dependency importing a sixth (`@dnd-kit/core` wants
  `unstable_batchedUpdates`) is an ES module *link* error, which happens before
  any code runs. `src/ui/react-dom-compat.ts` is the answer, and
  `esbuild.config.mjs` routes every `react-dom` import through it; if a new
  dependency needs a name from `react`, it needs the same treatment.
  `src/bundle.test.ts` fails when the bundle asks `react-dom` for a name again.

- **Whitespace minification.** The host's rewrite is a literal replace of
  ` from "react"`, with the leading space. `minifyWhitespace` emits
  `from"react"` and the rewrite misses it. It is off for this reason, and the
  same test guards it.

## "Demo data" badge when you did not ask for it

Two ways it turns on, and either is enough:

- `?demo=1` was used at some point in this browser session. It sticks for the
  session. Load the page with `?demo=0` to leave.
- The **Demo mode** checkbox is ticked on the plugin settings page — for *any*
  company. Host plugin config is per company; Tickler is not. Check each company's
  settings page, or clear it with:
  ```bash
  paperclipai plugin config:set <plugin id> \
    --company-id <company id> --payload-json '{"demoMode":false}'
  ```

Changing the checkbox drops the session override, so the setting always wins
last.

## Demo mode shows an error instead of data

Demo mode fails closed on purpose — it will not fall back to your real instance.
The fixture is fetched from the plugin's own asset directory, so an error there
means `dist/ui/demo-data.json` is missing. From source, run `pnpm build`; an npm
install ships it, so reinstall the package.

## "polling degraded" in the header

At least one company's poll is erroring while still holding older data. Tickler
keeps showing the last good figures and says so rather than blanking the row.

Usually a transient server error or a permission gap on one endpoint. Check the
instance's logs for that company. If a company's poll fails outright with no
data at all, its row is marked unavailable instead, and its numbers are blanked
rather than drawn as zeroes.

## No update button, though a newer Tickler is published

The gear panel's first row says which of these it is.

- **"Could not check npm for a newer version."** The check is a browser request
  to `registry.npmjs.org/paperclip-plugin-tickler/latest`, so an instance behind
  a proxy that does not allow it, or with no route out at all, cannot answer.
  Upgrade from the CLI instead
  ([Install](install.md#upgrading-an-npm-install)). Tickler deliberately offers
  nothing rather than a button whose version it had to guess.
- **"Installed from a local checkout."** This install's updates come from its
  own `dist`, not from npm — `git pull && pnpm build`, then the **Reload** chip
  ([Install](install.md#upgrading-tickler)).
- **"Up to date", with a version you know is behind.** Paperclip's registration
  is what Tickler compares, and a registration can lag the files on disk. That
  is the **Reload** case above.

And if the button is there but refuses: **"Only an instance admin can update
Tickler"** is Paperclip's rule, not Tickler's — the upgrade route is
admin-only.

## A company shows no token figure

Token spend comes from a permission-gated costs endpoint. A viewer without cost
access sees the column blank rather than zero — an unknown is not a nought.

## Agents show as idle when you know they are running

Capacity state is derived from the live-run list. If an agent is genuinely
running but drawn idle, its run is not in that list — check that the run started
against the company you are looking at.

A **stalled** (amber) square is different: the run is live, but nothing has come
out of it for 20 minutes. That is the case worth chasing, because nothing else
alerts on it.

## Clicking through to another company leaves the sidebar on the old one

This is a known Paperclip core defect, not a Tickler bug. After any manual company
switch, an in-app navigation to a different company prefix does not re-sync the
host's selected company.

Tickler works around it by doing a full page load for every cross-company hop, so
you should not hit it from the queue's Open links. If you do hit it elsewhere,
reload the page.

## `pnpm test` fails on a fresh clone

`src/ui/styles.test.ts` fails to resolve `./tickler.generated.css`. That file is a
build artifact and is gitignored. Run `pnpm build` first.

The same applies to the pre-commit hook and to any CI job that tests a clean
checkout.

## "Not implemented" errors during a passing test run

Expected noise. Tests run in jsdom, which implements neither
`HTMLCanvasElement.getContext` (used to draw company avatars) nor navigation.
Both log stack traces during a run that passes. Read the summary line, not the
output.

## `pnpm install` cannot resolve `@paperclipai/shared`

The two `@paperclipai/*` dev dependencies are `link:` references at
`../../paperclip/packages/...`, relative to this repo. They only resolve if the
Paperclip checkout is two directories above it. See
[Install → where the checkout has to live](install.md#where-the-checkout-has-to-live).

## The plugin installed into the wrong instance

The CLI targets whatever `PAPERCLIP_API_URL` points at, which is easy to inherit
from a shell you have forgotten about. It prints the target before installing:

```bash
paperclipai plugin target
```

Run that first if you are not certain.

## Something else

Ask in the **Tickler thread** on the
[Paperclip Discord](https://discord.com/channels/1478750559191302299/1532477301004959846) — the
same link sits behind the **?** in the Tickler page header. Tickler is a
community plugin, not an officially supported part of Paperclip, so its rough
edges belong there rather than in Paperclip's own issues.

If it is reproducible, open an issue at
<https://github.com/nickallevato/paperclip-tickler/issues>. Include the Paperclip
version (`paperclipai plugin target` prints it), Tickler's version, and whether
the Demo data badge was on.
