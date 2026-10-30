# Contributing to effect-svelte

This monorepo publishes `@thomasfosterau/effect-svelte` (`packages/svelte`) and `@thomasfosterau/effect-sveltekit` (`packages/sveltekit`). Conventions are in [AGENTS.md](AGENTS.md); this file is the human setup, the hooks and the individual checks.

## Development setup

- Node.js 22 or later (the root `engines.node`; each published package's own `engines` states its floor); CI runs the latest stable Node (`node-version: latest`).
- [pnpm](https://pnpm.io) 11 — the repo pins a version in the `packageManager` field, so `corepack enable` provisions the right one.
- Optionally the global [Vite+](https://viteplus.dev) CLI (`curl -fsSL https://vite.plus | bash`). Without it, run `./node_modules/.bin/vp`.

```bash
pnpm install --frozen-lockfile   # dependencies + the Vite+ git hooks
vp check                         # format + lint
vp run check                     # type gate (svelte-check)
vp run -r test:unit              # every package's Vitest suite
vp run -r build                  # every package's dist/
```

In an agent session the committed SessionStart hook ([.claude/hooks/session-start.sh](.claude/hooks/session-start.sh)) does the install and puts `vp` and `fallow` on PATH; the devcontainer's `postCreateCommand` runs the same file.

## Branches

Branch off `trunk`, rebase rather than merge, squash-merge with a conventional prefix: see [AGENTS.md](AGENTS.md#branches-and-pull-requests).

## Git hooks

Hooks are managed by Vite+ (`vp config`, run by the root `prepare`); the editable [.vite-hooks/pre-commit](.vite-hooks/pre-commit) is committed. **pre-commit** runs `vp staged` (format + lint on staged files). There is no pre-push hook.

## Testing

- Tests live in each package's `tests/` directory and import from `vite-plus/test`.
- `packages/svelte` splits its suite into three Vitest projects: `tests/dom/` mounts components under happy-dom, `tests/ssr/` renders them with `svelte/server`, and everything else in `tests/` runs in plain Node.
- `packages/sveltekit` has two projects: `tests/client/` runs rune-backed client code (with `$app/*` stand-ins) under happy-dom and the Svelte plugin, and everything else in `tests/` runs in plain Node.

## Running individual checks

```sh
vp lint                                        # oxlint (with the @enfect/oxlint Effect preset)
vp fmt                                         # oxfmt
vp check --fix                                 # apply format and lint fixes
vp run check                                   # the whole type gate
vp run --filter ./packages/svelte check        # one package's type gate
vp run -r test:unit                            # unit tests
vp test run tests/some.test.ts                 # single file (from inside the package)
vp run -r build                                # emit dist/
vp run test:coverage                           # one Istanbul map for fallow
vp run fallow                                  # dead code, dependencies, boundaries
vp run fallow:audit                            # change-set review (not a CI gate)
```

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs one job, `ci`, on the latest stable Node for every push to and pull request against `trunk`: the gates in [AGENTS.md § Verification](AGENTS.md#verification), in that order, after a `pnpm install --frozen-lockfile` (the composite action in `.github/actions/setup`). [release.yml](.github/workflows/release.yml) runs the Changesets action on `trunk` under the protected `release` environment ([PUBLISHING.md](PUBLISHING.md)).

The workflows are hardened for Dependabot PRs: `permissions: {}` at the top with per-job grants, every action pinned to a commit SHA, `persist-credentials: false` except where the Changesets action pushes, no secrets or OIDC in anything a PR can trigger (the release job also skips `dependabot[bot]`), and `uvx zizmor --offline .github` clean (its config is `.github/zizmor.yml`). CI calls the dev bins through `pnpm exec` instead of writing to `GITHUB_PATH`.

## Changesets

If your change affects a published package, add a changeset (`pnpm changeset`) and commit it with the change; `pnpm changeset status` previews pending releases. Releases happen when the owner merges the "chore: version packages" PR.

## Pre-PR checklist

1. Every gate in [AGENTS.md § Verification](AGENTS.md#verification), each with its final pass/fail in the PR body.
2. A changeset where [AGENTS.md § Branches and pull requests](AGENTS.md#branches-and-pull-requests) requires one.
3. `git fetch origin trunk && git rebase origin/trunk` — never merge `trunk` into your branch.
4. Docs: the package `README.md` (the npm API reference) for any exported change; the package `CLAUDE.md` for a new invariant or entry.

## Commit messages

Use a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`) and reference the issue number where there is one.
