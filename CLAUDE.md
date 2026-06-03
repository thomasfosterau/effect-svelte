# Agent Instructions

## Repository Workflow

This repository is managed by [Vite+](https://viteplus.dev): a single npm package
(`@thomasfosterau/effect-svelte`) with all tooling configured in `vite.config.ts`.

- `vp install` - install dependencies (delegates to pnpm)
- `vp check` - format (Oxfmt), lint (Oxlint), and type-check (tsgolint); use `--fix` to autofix
- `vp test` - run the Vitest test suite in `tests/`
- `vp pack` - build the library with tsdown into `dist/`

Use `./node_modules/.bin/vp` if the global `vp` CLI is not installed.

The Svelte runes integration lives in `src/`, and the SvelteKit helpers live in
`src/kit/` (published under the `./kit` subpath exports).

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

If `effect-solutions` is not installed, run `./scripts/setup-effect-solutions.sh`
(installs the CLI and clones the Effect reference repository).

<!-- effect-solutions:end -->

## Effect v4

This package targets **Effect v4 (beta)**: a single `effect` package plus
`@effect/platform-node`, pinned to the same `4.0.0-beta.x` version.

- `@effect/platform` does not exist in v4 — HTTP modules live under
  `effect/unstable/http/*`, and `FileSystem`/`Path` under `effect/*`.
- `@effect/experimental` does not exist in v4 — `Reactivity` lives under
  `effect/unstable/reactivity`.
- The v3 → v4 migration maps live in
  `~/.local/share/effect-solutions/effect/migration/` (start with `v3-to-v4.md`).

## Local Effect Source

The Effect v4 repository ([Effect-TS/effect-smol](https://github.com/Effect-TS/effect-smol))
is cloned to `~/.local/share/effect-solutions/effect` for reference. Use it to
explore APIs, find usage examples, and understand implementation details when
the documentation isn't enough.
