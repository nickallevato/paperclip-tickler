# How Tickler is built

Tickler is UI-only. It contributes one page (mounted at `/:companyPrefix/tickler`)
and a toolbar launcher that navigates there. Its worker is a deliberate no-op.

## Layout

```
src/
  manifest.ts              plugin id, capabilities, entrypoints
  worker.ts                no-op
  ui/
    TicklerHud.tsx           root: owns the roster, sort mode, pins, token settings
    TicklerPage.tsx          host-mounted page slot
    TicklerToolbarButton.tsx toolbar launcher, with its Today count
    components/            company lines, queue, recent tasks, portfolio, briefing
    lib/                   capacity, queue grouping, run derivation, drafts
    host/                  vendored Paperclip internals (read-only)
    styles.ts              injects the compiled sheet, minus host duplicates, idempotently
scripts/
  build-css.mjs            Tailwind compile (host duplicates are subtracted at runtime)
  capture-screenshots.mjs  the images in docs/, from a running instance
  gen-demo-data.mjs        the demo fixture
  check-plugin-surface.mjs the no-core-changes guardrail
docs/                      the documentation set
```

## Why Tickler subtracts the host's selectors

Tickler compiles its own Tailwind sheet and injects it via `<style>` appended to `<head>` — after
the host's. Tailwind emits every class it scans, including ones Paperclip already defines, and a
duplicate that lands later wins on document order. A stray `.hidden{display:none}` is enough to
beat Paperclip's `@media(min-width:40rem){.sm\:flex{...}}` and pin the whole app — not just the
Tickler page — in its mobile layout.

Ordering cannot fix this, in either direction. Appended last, Tickler's duplicates beat the host's
responsive variants. Inserted first, Tickler's `@layer` declarations come before the host's, which
pushes the host's `base`/`components` layers after `utilities` and breaks spacing app-wide.
Subtraction is the only approach that works.

So at injection, `src/ui/styles.ts` walks the document's other stylesheets through the CSSOM,
collects every selector they define, and deletes each of Tickler's class rules the host already
has — trimming shared selector lists and dropping `@media`/`@layer`/`@supports` groups left
empty (`src/ui/lib/host-subtract.ts`). Against Paperclip's real sheet that drops about 480
selectors; Tickler-only classes are untouched. Cross-origin sheets, which the browser will not let
a page read, are skipped — they are web-font CSS, not host utilities.

This used to be done once, at build time, against whichever Paperclip UI build was on the
builder's disk — which went stale on every Paperclip upgrade and meant rebuilding Tickler after
each one. Subtracting against the sheets the page actually loaded leaves nothing to go stale: a
Paperclip upgrade needs no Tickler rebuild, the build needs no Paperclip UI build, and one
published package fits whichever Paperclip stylesheet it lands next to.

## Vendored host components

`src/ui/host/` holds read-only copies of Paperclip internals Tickler depends on — the ui-kit
primitives, `useCompanyOrder`, API client shapes. They are copies rather than imports because
Paperclip does not export them to plugins.

Keep them byte-identical to their upstream originals apart from import paths. Three documented
exceptions:

- `ui-kit/dialog.tsx` — plain Tailwind positioning, since the host's version leans on theme-only
  CSS variables the plugin sheet does not carry.
- `useCompanyOrder.ts` — read path only; the host's mutation and `persistOrder` are omitted
  because Tickler never reorders.
- `ui-kit/hover-card.tsx` — a Tickler original, not a copy. The host ships no HoverCard component,
  so there is nothing upstream to keep it identical to.

Anything else that drifts is a bug. `CompanyPatternIcon.tsx` in particular must match exactly:
Paperclip draws company avatars with its own copy, so any change here gives one company two
different identities on screen.

`pnpm check:vendored` compares every whole-file copy (and the route-root sets in `util.ts`)
against the Paperclip checkout, ignoring imports. Run it after each Paperclip upgrade;
`--diff` prints what moved.

## Development

```bash
pnpm dev             # esbuild watch + CSS rebuild
pnpm test            # vitest — needs a prior `pnpm build` on a fresh clone
pnpm typecheck       # tsc --noEmit
pnpm build           # CSS then bundle
pnpm check:surface   # the no-core-changes guardrail
pnpm check:vendored  # the host copies in src/ui/host/ still match the checkout
pnpm check:branch    # the branch name CI insists on
pnpm demo:data       # regenerate the demo fixture
pnpm hooks:install   # pre-commit: surface check, typecheck, test
```

Tests run in jsdom, which implements neither `HTMLCanvasElement.getContext` nor navigation. Both
log "Not implemented" errors during a passing run. That output is expected noise, not failure —
check the summary line.
