# Contributing to effect-svelte

This monorepo publishes `@thomasfosterau/effect-svelte` (`packages/svelte`) and `@thomasfosterau/effect-sveltekit` (`packages/sveltekit`). What the packages are is in [README.md](README.md); the conventions, pitfalls and the pre-merge gates are in [AGENTS.md](AGENTS.md). This file is the setup, the commands, the hooks and CI.

## Development setup

- Node.js 22 or later (the root `engines.node`; each published package's own `engines` states its floor); CI runs the latest stable Node ([setup-vp](https://github.com/voidzero-dev/setup-vp) with `node-version: "*"`, a semver range, which never matches a pre-release; `latest` would take whatever heads nodejs.org's dist index, pre-releases included).
- [pnpm](https://pnpm.io) 11 — the repo pins a version in the `packageManager` field, so `corepack enable` provisions the right one.
- Optionally the global [Vite+](https://viteplus.dev) CLI (`curl -fsSL https://vite.plus | bash`). Without it, run `./node_modules/.bin/vp`.

```bash
pnpm install --frozen-lockfile   # dependencies + the Vite+ git hooks
vp check                         # format + lint
vp run check                     # type gate (svelte-check)
vp run -r test:unit              # every package's Vitest suite
vp run -r build                  # every package's dist/
```

In an agent session the committed SessionStart hook ([.claude/hooks/session-start.sh](.claude/hooks/session-start.sh)) installs the global Vite+ CLI at the catalog's `vite-plus` pin (it needs `vite.plus` and `viteplus.dev` reachable), links `vp` and `vpx` onto PATH and does the install; fallow then runs as `vp exec fallow`. The devcontainer's `postCreateCommand` runs the same file.

Open in a Codespace or Dev Container: `.devcontainer/` provisions it with the same hook as agent sessions. The `Dev Container` workflow (`.github/workflows/devcontainer.yml`) builds it in CI whenever its inputs change; to try a change locally, `pnpm dlx @devcontainers/cli@0.89.0 up --workspace-folder .` (needs Docker).

## Branches

Branch off `trunk`, rebase rather than merge, squash-merge with a conventional prefix: see [AGENTS.md](AGENTS.md#branches-and-pull-requests).

## Git hooks

Hooks are managed by Vite+ (`vp config`, run by the root `prepare`); the editable [.vite-hooks/pre-commit](.vite-hooks/pre-commit) is committed. **pre-commit** runs `vp staged` (format + lint on staged files). There is no pre-push hook: run the gates yourself.

## Testing

- Tests live in each package's `tests/` directory and import from `vite-plus/test`; a test that runs an Effect takes `it` from `@effect/vitest` (`it.effect`, or `it.live` on real time).
- `packages/svelte` splits its suite into three Vitest projects: `tests/dom/` mounts components under happy-dom, `tests/ssr/` renders them with `svelte/server`, and everything else in `tests/` runs in plain Node.
- `packages/sveltekit` has two projects: `tests/client/` runs rune-backed client code (with `$app/*` stand-ins) under happy-dom and the Svelte plugin, and everything else in `tests/` runs in plain Node.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (`prepare` runs `vp config`).
- `vp check` — format + lint (Oxfmt + Oxlint); lint is type-aware through vite-plus's bundled oxlint-tsgolint (`typeAware` and `typeCheck` in `vite.config.ts`, so it also reports TypeScript errors in `.ts` files); `--fix` autofixes.
- `vp run check` — the type gate: svelte-check over every package's `src`, `tests` and `.svelte` fixtures.
- `vp run -r test:unit` — every package's Vitest suite; `vp test run` inside one package.
- `vp run -r build` — `vp pack` (tsdown) into each package's `dist/`.
- `vp run test:coverage` — every package's suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores.
- `vp exec fallow dead-code` / `vp exec fallow audit` (also `vp run fallow` / `vp run fallow:audit`) — unused code and dependencies, boundaries, and the change-set gate (not a CI step).
- `pnpm changeset` — add a changeset.

Single checks:

```sh
vp lint                                        # oxlint (with the @enfect/oxlint Effect preset)
vp fmt                                         # oxfmt
vp check --fix                                 # apply format and lint fixes
vp run --filter ./packages/svelte check        # one package's type gate
vp test run tests/some.test.ts                 # single file (from inside the package)
```

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs one job, `ci`, on the latest stable Node for every push to and pull request against `trunk`: the gates in [AGENTS.md § Verification](AGENTS.md#verification), in that order, after a `vp install --frozen-lockfile` (the composite action in `.github/actions/setup`). [release.yml](.github/workflows/release.yml) runs the Changesets action on `trunk` under the protected `release` environment ([PUBLISHING.md](PUBLISHING.md)).

The workflows are hardened for Dependabot PRs: `permissions: {}` at the top with per-job grants, every action pinned to a commit SHA (setup-vp to an exact release tag, as its README asks; the Actions lockfile in #250 pins its commit), `persist-credentials: false` on every checkout (the Release workflow pushes through the GitHub API), no secrets or OIDC in anything a PR can trigger (the release job also skips `dependabot[bot]`), and `uvx zizmor --offline .github` clean (its config is `.github/zizmor.yml`). setup-vp installs Vite+ at the catalog's `vite-plus` pin with the Node.js and pnpm it manages, and puts `vp` on PATH, so no workflow step writes to `GITHUB_PATH`.

## Changesets

If your change affects a published package, add a changeset (`pnpm changeset`) and commit it with the change; `pnpm changeset status` previews pending releases. Releases happen when the owner merges the "chore: version packages" PR.

## Pre-PR checklist

1. Every gate in [AGENTS.md § Verification](AGENTS.md#verification), each with its final pass/fail in the PR body.
2. A changeset where [AGENTS.md § Branches and pull requests](AGENTS.md#branches-and-pull-requests) requires one.
3. `git fetch origin trunk && git rebase origin/trunk` — never merge `trunk` into your branch.
4. Docs: the package `README.md` (the npm API reference) for any exported change; the package `AGENTS.md` for a new invariant or entry.

## Commit messages

Use a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`) and reference the issue number where there is one.
