# Release notes

One page per version, written for someone deciding whether to upgrade: what
changed, what it means for them, and anything they have to do by hand.

- [0.17.1](0.17.1.md) — expanding Recent no longer collapses Orgs.
- [0.17.0](0.17.0.md) — a version that crashes can be rolled back from the crash itself; crash notices can be reported on GitHub.
- [0.16.1](0.16.1.md) — the Tickler page no longer crashes at some window heights.
- [0.16.0](0.16.0.md) — approval rows are safer to work on a phone, suggested by [@naeemakhtar110](https://github.com/naeemakhtar110).
- [0.15.1](0.15.1.md) — a crash inside Tickler now says what broke, and costs only that part.
- [0.15.0](0.15.0.md) — runs past their agent's time limit get their own square, suggested by [@naeemakhtar110](https://github.com/naeemakhtar110).
- [0.14.3](0.14.3.md) — the update chip waits until npm can serve the new version.
- [0.14.2](0.14.2.md) — "+2 more" now tells you something.
- [0.14.1](0.14.1.md) — the Orgs header stays on one line.
- [0.14.0](0.14.0.md) — see which org used tokens, hour by hour.
- [0.13.1](0.13.1.md) — pinned routines no longer give the left rail a scrollbar.
- [0.13.0](0.13.0.md) — pin routines and run them from Tickler.
- [0.12.2](0.12.2.md)
- [0.12.1](0.12.1.md) — expanding Orgs no longer folds Recent.
- [0.12.0](0.12.0.md) — orgs can be expanded too, and the three panes under it fold to pay for it.
- [0.11.1](0.11.1.md) — expanding Recent now actually lengthens Recent.
- [0.11.0](0.11.0.md)
- [0.10.0](0.10.0.md)
- [0.9.2](0.9.2.md) — the board page no longer scrolls 8px over nothing.
- [0.9.1](0.9.1.md) — a rail pane with nothing left to show no longer scrolls.
- [0.9.0](0.9.0.md) — the narrow board's panes are yours to order.
- [0.8.2](0.8.2.md) — a merge to `main` releases itself; the README is half the length; the docs say what the header does, and every link resolves.
- [0.8.1](0.8.1.md) — docs only: a new lead image on the README, so npm's package
  page shows one screenful instead of the top of a tall one.
- [0.8.0](0.8.0.md) — Tickler updates itself from a button, and the board's left
  rail spends the height it has.
- [0.7.1](0.7.1.md) — the board's left column is no longer cut off at the bottom.
- [0.7.0](0.7.0.md) — Plica is now Tickler: new package name, plugin id and route.
- [0.6.0](0.6.0.md) — no plugin change: the first release published by pushing a
  tag, not by hand.
- [0.5.0](0.5.0.md) — on npm: install from the Plugin Manager by name, and no more
  rebuilding after a Paperclip upgrade. Recent replaces the live strip.
- [0.4.0](0.4.0.md) — the queue owns the page: decide-by lanes backed by
  Paperclip's decision triage, the Orgs list, a calmer board.
- [0.3.0](0.3.0.md) — demo mode, the live strip, the portfolio chart, routine
  exceptions, queue age filters.
- 0.2.0 — the board. See the [changelog](../../CHANGELOG.md#020).
- 0.1.0 — initial release.

The [changelog](../../CHANGELOG.md) is the short form and covers every version.

## Cutting a release

**A merge to `main` is the release.** There is nothing to do after one, and
nothing to remember before one. Write the change, title the pull request as a
conventional commit, put its entries under **Unreleased** in the changelog, and
merge; the version is picked, written, tagged and published from that merge.

That is a deliberate answer to a specific failure. The self-update button
([0.8.0](0.8.0.md)) was finished and on `main` for days before anyone released
it, because landing a feature did not release it and nothing said a tag was due.
Publishing was already unattended — every step *before* the tag was not.

So, to release something:

1. **Title the pull request as a conventional commit.** The repository
   squash-merges, so the title becomes the one subject on `main`, and the type
   picks the bump:

   | title | what merging it publishes |
   | --- | --- |
   | `feat: …`, `feat(scope): …` | a minor version — `0.8.0` → `0.9.0` |
   | `fix: …`, `perf: …`, `revert: …` | a patch version — `0.8.0` → `0.8.1` |
   | `feat!: …`, or a `BREAKING CHANGE:` footer | a minor version, while Tickler is pre-1.0 |
   | `chore: …`, `docs: …`, `ci: …`, `test: …`, `build: …`, `style: …`, `refactor: …` | nothing at all |

   The last row is the point of the table: a tidy-up, a docs pass or a CI fix
   merges without spending a version number. Only a change a reader would want
   to hear about publishes one.

2. **Write the changelog entries under Unreleased, in that same pull request.**
   They are not decoration — the Unreleased body becomes
   `docs/releases/<version>.md` verbatim when the merge publishes. This is the
   last moment it is cheap to write, so the `release plan` CI job fails a
   releasing pull request that has no entry, and says which version it was
   about to publish with nothing to read.

3. **Refresh the screenshots if the UI moved:**
   `node scripts/capture-screenshots.mjs` (see
   [screenshots/README.md](../screenshots/README.md)).

4. **Merge.** The [`release` workflow](../../.github/workflows/release.yml) then,
   in one run:

   - `scripts/plan-release.mjs` reads the conventional subjects since the last
     `v*` tag and decides the bump. No releasing subject, no release, and the
     run stops here having done nothing.
   - `scripts/apply-release.mjs` writes the version into `package.json` and
     `src/manifest.ts`, renames the changelog's `Unreleased` heading and opens a
     fresh one, writes the release page from those entries, and links it in the
     list above.
   - `scripts/check-release.mjs` refuses the result if any of those four
     disagree — the same check as before, now checking a machine's work.
   - the workflow commits `chore(release): <version>` to `main`, tags
     `v<version>`, and publishes that tag.

Two things deserve knowing about that last step. The commit and the tag are
pushed **atomically**: a tag without its commit on `main` is a release nobody
can check out, and a commit without its tag never publishes. And the release
commit is itself a `chore(release):` subject, which by the table above releases
nothing — so the cut cannot trigger another cut.

`prepublishOnly` typechecks, builds and tests inside `npm publish` itself, so a
red build cannot reach the registry. A published version can never be reused —
a bad release is fixed by the next one, not by republishing.

### Seeing the plan before you merge

```bash
pnpm release:plan                                # what main would publish right now
pnpm release:plan --subject "feat: a thing"      # what merging that title would publish
pnpm release:apply --version 0.9.0 --dry-run     # which files a cut would write
```

`release:plan` is dependency-free and read-only, and the `release plan` CI job
on every pull request is the same command with the pull request's title.

### Rehearsing the publish

Run the workflow by hand from the Actions tab with **dry run** left on: it packs
the tarball and runs every check, and publishes nothing. A dispatch never plans
or cuts — it only exercises the publish half.

### When it is a person's job again

The automatic cut deliberately refuses three situations rather than guessing:

- **The tag already exists.** The version is spent; nothing can republish it.
- **`package.json` is at a prerelease.** A `0.9.0-rc.1` is a hand-cut state, and
  there is no one obvious number after it.
- **A pull request title that is not a conventional commit.** It releases
  nothing rather than release on a guess. Retitle and merge again, or cut by
  hand.

Cutting by hand is the same two scripts the workflow runs, so there is no second
procedure to keep working:

```bash
pnpm release:apply --version <version>
pnpm check:release
git commit -am "chore(release): <version>"
git tag -a v<version> -m "Tickler <version>"
git push --atomic origin HEAD:main v<version>
```

A `v*` tag push still publishes on its own, which is also how a failed publish
is retried — see the paragraph below.

### When the publish fails and the cut already landed

If the run fails before the registry accepted the tarball, the version is still
free and the tag is still correct — there is nothing to re-tag. Fix the cause,
then run the workflow by hand with the **tag** input set to `v<version>` and
**dry run** unchecked. Deleting and re-pushing the tag would work too, but it
rewrites a tag other checkouts may already have fetched.

This is now the shape of every partial failure, because `cut` runs before
`publish`: `main` and the tag are already on the new version and only the npm
publish is missing. Do not merge a fix expecting it to re-release — the next
merge plans from the new tag and would publish the version *after* this one,
leaving this one permanently unpublished. Re-dispatch the tag instead.

If `cut` is what failed — the push refused because another merge landed while it
ran — nothing was released and nothing is half-done. That merge's own run plans
again from the newer `main`.

## Publishing by hand

The workflow and a person run the same script, so this is the fallback when
Actions is unavailable, not a second procedure:

```bash
git fetch --tags && git checkout v<version>
pnpm install --frozen-lockfile
pnpm release:publish --tag v<version>          # add --dry-run to rehearse
```

It refuses the same things the workflow does, and authenticates with whatever
`npm login` left in `~/.npmrc` — or, for an agent, with the npm token bound to
it (see below); the script prints which.

## Publishing credentials

`scripts/publish-npm.mjs` takes a credential from one of three places, in this
order, and prints the name of the one it used:

1. **A token on the environment** — an npm [automation token][tokens], read
   from `NPM_TOKEN`, `NODE_AUTH_TOKEN`, or `NPM_TOKEN_90_DAY_EXP`, whichever is
   set first. Write-scoped to the registry and long-lived, so it is the thing
   worth not having. The script never writes it into the repository: it goes to
   a private temporary npm config that is deleted when the script exits.

   `NPM_TOKEN` is the repository Actions secret that `release.yml` passes to the
   publish step, and the one to set for CI releases. `NODE_AUTH_TOKEN` is the
   same thing under the name `actions/setup-node` uses. `NPM_TOKEN_90_DAY_EXP`
   is how Paperclip delivers the credential to an agent on a release task: its
   secrets arrive under the name they were stored as, so the script knows that
   name rather than an agent copying a token between variables. A Paperclip
   secret is bound to agents only — it does not reach GitHub Actions, so a tag
   push still needs the repository secret.
2. **Trusted publishing** — npm's [OIDC][trusted] link between the package and
   this workflow. No token exists anywhere: npm accepts the publish because
   GitHub attests that it came from `release.yml` on this repository. Set it up
   once under the package's **Settings → Trusted publishers** on npmjs.com
   (publisher: GitHub Actions, repository `nickallevato/paperclip-tickler`,
   workflow `release.yml`), and delete `NPM_TOKEN`. This is the preferred
   arrangement — there is no secret for an agent, a log, or a compromised
   runner to leak, and publishes stay attributable to a specific workflow run.
3. **`~/.npmrc`** — an interactive `npm login`. Local runs only; the script
   refuses to fall back to it unattended.

Either of the first two also gets the release [provenance][trusted]: npm
records which commit and which workflow run built the tarball, and shows it on
the package page.

### What npm's two credential errors actually mean

Both of these were hit trying to publish 0.6.0, and neither error says what is
wrong. `scripts/publish-npm.mjs` now prints the matching explanation after a
failed publish, but they are worth recognising:

- **`ENEEDAUTH` — "You need to authorize this machine using `npm adduser`"**, in
  a workflow run. Nothing is wrong with the machine. No `NPM_TOKEN` was set, so
  the job fell to trusted publishing, and npm only honours that once the package
  lists this workflow under **Trusted publishers**. Configure it there, or set
  the repository secret.

  The same error also means "the entry exists but does not match this run", and
  the two cases are indistinguishable — not only from `ENEEDAUTH`, but from the
  registry too: measured on 2026-09-28, the exchange answers `HTTP 404 OIDC
  token exchange error - package not found` for both. Do not read that 404 as
  "there is no entry". What the registry's answer *is* good for is its status
  and wording, which npm throws away, and the run's own OIDC claims. A failed
  publish on this path now prints both, and the probe can be run on its own:

  ```
  node scripts/diagnose-npm-oidc.mjs
  ```

  It needs a job with `id-token: write`;
  [`npm oidc diagnostic`](../../.github/workflows/npm-oidc-diagnostic.yml) is
  that job, dispatched by hand from the Actions tab, and it cannot publish. The
  script makes the same two requests `npm publish` does — mint an OIDC token,
  trade it for a publish credential — reports the registry's own status and
  message, prints the `repository`, `repository_owner`, `workflow_ref` and
  `environment` claims this run presents, and publishes nothing. Compare those
  claims with the npmjs.com entry field by field; that comparison, not the
  status code, is what tells the two cases apart. If it says npm *accepted* the
  token, trusted publishing is configured correctly and the refusal was
  something else.

  **A rename is the trap.** `nickallevato/paperclip-plica` →
  `nickallevato/paperclip-tickler` kept the same repository id, and GitHub
  redirects everything, but npm matches entries on the name — so the entry that
  published `paperclip-plugin-plica@0.6.0` silently stopped matching. Renaming
  the repository or the account means re-entering every trusted publisher.

  Failing that, or before re-reading the npm page, rule the workflow side out —
  every one of these was checked on the run that first hit it, and all of them
  held:

  | requirement | how to check it |
  | --- | --- |
  | npm CLI ≥ 11.5.1, Node ≥ 22.14 | the `setup-node` step prints both |
  | `id-token: write` on the job | `permissions:` in `release.yml` |
  | a GitHub-hosted runner | self-hosted runners cannot use OIDC at all |
  | `repository.url` matching the repo | `package.json` |

  On the npm side the entry is matched exactly and case-sensitively: the
  **workflow filename** is the bare name with its extension (`release.yml`, not
  a path), **environment** must be blank unless the job declares one, and
  **allowed actions** has to include `npm publish` — an entry limited to
  `npm stage publish` refuses an ordinary publish.
- **`E403` — "You may not perform that action with these credentials"**, with a
  token that works. The token authenticates (`npm whoami` answers, `npm access
  get status` answers) and is refused only on the write, which means it is
  read-only or read-scoped. Reissue it as an automation token, or a granular
  token with **read and write** on `paperclip-plugin-tickler`.

A version is only spent when the registry accepts the tarball, so neither of
these costs the version number: both failed after packing and the version stayed
free to publish once the credential was fixed.

[tokens]: https://docs.npmjs.com/about-access-tokens
[trusted]: https://docs.npmjs.com/trusted-publishers
