# Contributing to effect-svelte

This monorepo publishes `@thomasfosterau/effect-svelte` (`packages/svelte`) and `@thomasfosterau/effect-sveltekit` (`packages/sveltekit`); `examples/*` are private apps built against the packages' `dist/`. Conventions are in [AGENTS.md](AGENTS.md); this file is the setup, the commands and the checklists.

## Development setup

### Prerequisites

- Node.js `^20.19.0 || >=22.12.0` (`engines.node`); CI runs 22.x.
- [pnpm](https://pnpm.io) 10 — the repo pins a version in the `packageManager` field, so `corepack enable` provisions the right one.
- Optionally the global [Vite+](https://viteplus.dev) CLI (`curl -fsSL https://vite.plus | bash`). Without it, run `./node_modules/.bin/vp`, or the root scripts (`pnpm run check`, `pnpm run test`, `pnpm run build`).

### Getting started

```bash
pnpm install --frozen-lockfile
vp check          # format, lint and type-check the whole workspace
vp run -r test    # every package's Vitest suite
vp run -r build   # every package's dist/, then the example apps
```

In an agent session the committed SessionStart hook ([.claude/hooks/session-start.sh](.claude/hooks/session-start.sh)) does the install and puts `vp` on PATH; the devcontainer's `postCreateCommand` runs the same file.

## Development workflow

| Command                                 | Description                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp check`                              | Format check (Oxfmt), lint (Oxlint) and type-check (tsgolint), configured in the root `vite.config.ts`. `vp check --fix` applies the fixes. There is no separate `vp run check` task. |
| `vp fmt` / `vp lint`                    | Either half on its own.                                                                                                                                                               |
| `vp run -r test`                        | Every package's Vitest suite. `vp test` inside a package for one suite; `vp test run tests/<file>.test.ts` for one file.                                                              |
| `vp run -r build`                       | `vp pack` (tsdown) into each package's `dist/`, then the example apps' `vp build`.                                                                                                    |
| `vp run --filter "example-*" typecheck` | svelte-check every example app. Needs the packages' `dist/`, so build first.                                                                                                          |
| `vp run --filter "example-*" build`     | Build every example app.                                                                                                                                                              |
| `pnpm changeset`                        | Add a changeset (see below).                                                                                                                                                          |

Lint and format are configured once at the workspace root (`vite.config.ts`, which excludes `examples/**` from the type-aware lint because the examples only resolve after a build); each package's own `vite.config.ts` holds its `pack` and `test` config.

## Testing

- Tests live in each package's `tests/` directory and import from `vite-plus/test`.
- `packages/svelte` splits its suite into three Vitest projects: `tests/dom/` mounts components under happy-dom, `tests/ssr/` renders them with `svelte/server`, and everything else in `tests/` runs in plain Node.
- Add tests for new behaviour; to exercise the published shape, add or extend an example app and its row in [examples/README.md](examples/README.md).

## Changesets

This project uses [Changesets](https://github.com/changesets/changesets). If your change affects a published package, add a changeset describing it:

```bash
pnpm changeset          # pick the package(s) and a patch / minor / major bump
pnpm changeset status   # preview pending releases
```

The changeset file is committed with your change. Releases happen when the owner merges the "Version Packages" PR; see [docs/RELEASING.md](docs/RELEASING.md) for the pipeline and the one-time setup.

## CI expectations

[ci.yml](.github/workflows/ci.yml) runs one job on Node 22.x for every push to and pull request against `main`: the gates listed in [AGENTS.md § Verification](AGENTS.md#verification), in that order, after a `pnpm install --frozen-lockfile` (the composite action in `.github/actions/setup`). [release.yml](.github/workflows/release.yml) runs the Changesets action on `main` under the protected `release` environment.

## Pre-PR checklist

1. Run every gate in [AGENTS.md § Verification](AGENTS.md#verification) and note each result in the PR body.
2. Add a changeset (`pnpm changeset`) for every change to a published package.
3. `git fetch origin main && git rebase origin/main` — never merge `main` into your branch.
4. Update the docs: the package `README.md` (the npm API reference) for any exported change, `examples/README.md` if an example's coverage changed, `AGENTS.md` for a new invariant.

## Commit messages

Use a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`) and reference the issue number where there is one.
