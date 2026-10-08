# Screenshots

Almost every image in this directory is produced by
`scripts/capture-screenshots.mjs` against a real running Paperclip with Tickler
installed, in **demo mode**. The exceptions are listed under
[Hand-captured](#hand-captured).

They are shot in **dark mode**. `TICKLER_SHOT_THEME=light` shoots the light theme
instead, for a one-off comparison; commit the dark ones.

```bash
node scripts/capture-screenshots.mjs           # all of them
node scripts/capture-screenshots.mjs --list    # what each one is
node scripts/capture-screenshots.mjs --only board,queue-by-company
```

Refresh them whenever a UI change makes one wrong. A stale screenshot is the
documentation defect nobody files a bug for.

`panes/` is the same kind of thing for the narrow stack's order (PLI-262): the
Pane order menu as it opens, a drag in flight, the stack a reload later, and the
wide board under a deliberately scrambled stored order — the shot that shows
`@[64rem]/board:order-none` doing its job and the button withheld, since the
claim being evidenced is that nothing changed. Kept as that change's evidence,
not refreshed with the rest. They come from a throwaway instance the same way
the rest do; there is no `--only` for them.

`rail/` is the exception, and comes from `scripts/capture-rail.mjs` instead.
Those are whole screens rather than crops, because the question they answer —
does the bottom of the rail fit above the fold — is a question about the fold,
which a crop has already thrown away. They come in `-before`/`-after` pairs and
are kept as the evidence for one change rather than refreshed with the rest.

## The instance it needs

Do **not** point this at your working instance: it drives the browser, and in
demo mode it will happily click Approve on the fixture, which is confusing to
watch even though nothing reaches the server.

Stand up a throwaway one instead. Paperclip's `local_trusted` deployment mode
runs without authentication on loopback, which is what makes an unattended
capture possible at all:

```bash
export SHOT_HOME=$(mktemp -d)

# 1. A throwaway instance on its own port, with its own data directory.
cd ~/dev/paperclip
PAPERCLIP_HOME=$SHOT_HOME \
PAPERCLIP_INSTANCE_ID=tickler-shots \
PAPERCLIP_CONFIG=$SHOT_HOME/instances/tickler-shots/config.json \
PAPERCLIP_BIND=loopback \
PAPERCLIP_DEPLOYMENT_MODE=local_trusted \
PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
PORT=3199 \
  pnpm paperclipai onboard --yes --run

# 2. One company, so the /:companyPrefix/tickler route has a prefix to mount under.
#    Demo mode replaces its data entirely; only the prefix is used.
curl -s -X POST -H 'content-type: application/json' \
  -d '{"name":"Demo Co"}' http://127.0.0.1:3199/api/companies

# 3. Install Tickler into it. Note the explicit target — the CLI otherwise
#    installs into whatever PAPERCLIP_API_URL points at.
PAPERCLIP_API_URL=http://127.0.0.1:3199 \
  pnpm paperclipai plugin install /abs/path/to/paperclip-tickler --local

# 4. Capture.
cd /abs/path/to/paperclip-tickler
node scripts/capture-screenshots.mjs
```

Delete `$SHOT_HOME` afterwards.

### If `pnpm paperclipai` will not run

The CLI needs the checkout's workspace dependencies installed. If they are not —
a pruned `node_modules`, a checkout you are only borrowing — you do not have to
install 1.3 GB to take a screenshot. The server's own `dist` plus the `tsx`
loader under `server/node_modules` is enough, and the two CLI steps above each
have a plain API equivalent:

```bash
export SHOT_HOME=$(mktemp -d)

# 1. Boot the server directly, the way the systemd unit does. The tsx loader is
#    not optional: workspace packages export TypeScript from `src/`, so without
#    it `@paperclipai/db` fails to resolve at import time.
cd ~/dev/paperclip/server
PAPERCLIP_HOME=$SHOT_HOME \
PAPERCLIP_INSTANCE_ID=tickler-shots \
PAPERCLIP_CONFIG=$SHOT_HOME/instances/tickler-shots/config.json \
PAPERCLIP_BIND=loopback \
PAPERCLIP_DEPLOYMENT_MODE=local_trusted \
PAPERCLIP_DEPLOYMENT_EXPOSURE=private \
PORT=3199 HOST=127.0.0.1 SERVE_UI=true \
NODE_OPTIONS=--import=$PWD/node_modules/tsx/dist/loader.mjs \
  node dist/index.js

# 2. Same as above.
curl -s -X POST -H 'content-type: application/json' \
  -d '{"name":"Demo Co"}' http://127.0.0.1:3199/api/companies

# 3. Install Tickler over the API instead of through the CLI.
curl -s -X POST -H 'content-type: application/json' \
  -d '{"packageName":"/abs/path/to/paperclip-tickler","isLocalPath":true}' \
  http://127.0.0.1:3199/api/plugins/install
```

Unset `PAPERCLIP_RUN_ID`, `PAPERCLIP_API_KEY` and `PAPERCLIP_API_URL` in that
shell first if you are running under an agent harness — they point at a
different instance and the install step will follow them there.

The instance it boots writes only under `$SHOT_HOME`; the checkout is untouched.
Then capture as in step 4 above.

If the CLI's post-install step fails on an `activity_log` insert, check that
`PAPERCLIP_RUN_ID` is not set in your shell — it is written to the log row and
will not resolve against a fresh database. The plugin itself installs fine;
`paperclipai plugin list` will show it as `ready`.

## Knobs

| Variable | Default | |
| --- | --- | --- |
| `TICKLER_SHOT_URL` | `http://127.0.0.1:3199` | The instance to drive. |
| `TICKLER_SHOT_PREFIX` | first active company | Company prefix for the route. |
| `TICKLER_SHOT_PLUGIN_ID` | looked up from `/api/plugins` | Plugin row UUID, for the settings-page shot. |
| `TICKLER_PLAYWRIGHT` | `~/paperclip` | Package root to resolve `playwright` from. |
| `TICKLER_CHROME` | `/usr/bin/google-chrome` | Browser executable. |
| `TICKLER_SHOT_OUT` | `docs/screenshots` | Where the PNGs go. |
| `TICKLER_SHOT_SCREENS` | a 13" laptop and a 27" monitor | `capture-rail.mjs` only: `WxH` or `WxH@scale`, comma-separated, e.g. `390x844@3,820x1180@2`. |

Playwright is deliberately **not** a dependency of this repo. Adding it plus a
browser download would cost every contributor a couple of hundred megabytes for
a script most of them never run, and a `link:` dependency on the Paperclip
checkout is not allowed. It is resolved at runtime from the checkout that
already has it, read-only.

## Why the shots are the size they are

The viewport is 1600 × 1800 at 2× device scale. The height is not cosmetic: the
host scrolls an inner `<main>` rather than the document, so a `fullPage`
screenshot captures only what is painted, and anything below the fold is missing
rather than scrolled to. A viewport taller than the content is what gets the
queue and the rail's footer into one frame.

Crops are computed from element bounding boxes rather than fixed pixel
rectangles, so a layout change produces a taller image instead of a cut-off one.

## Hand-captured

These were taken by hand at 1× and are not regenerated by the script. Replace
them by hand when the UI they show changes.

| File | Source |
| --- | --- |
| `queue-confirmation.png` | Tickler's own development org (live) |
| `queue-question.png` | Tickler's own development org (live) |

The README's own images — `hero`, `needs-you`, `left-rail`, `recent-hover` —
and `portfolio-by-org` were on this list until PLI-288 and are scripted now.
`hero` and `left-rail` are shot at a 1600 × 1150 window rather than the tall
documentation viewport, so the rail shows what it budgets to a real screen.
