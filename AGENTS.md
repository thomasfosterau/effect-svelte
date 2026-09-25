# Agent Instructions

`CLAUDE.md` is a symlink to this file; edit `AGENTS.md`.

## Repository Workflow

This repository is a pnpm workspace managed by [Vite+](https://viteplus.dev),
publishing two npm packages:

- `packages/svelte` — `@thomasfosterau/effect-svelte`, the Svelte 5 runes integration
- `packages/sveltekit` — `@thomasfosterau/effect-sveltekit`, the SvelteKit helpers

`examples/*` are private example apps (never published) built against the
packages' `dist/`.

- `vp install` - install dependencies (delegates to pnpm); CI installs with `--frozen-lockfile`
- `vp check` - format (Oxfmt), lint (Oxlint), and type-check (tsgolint); use `--fix` to autofix
- `vp run -r test` - run every package's Vitest suite (`vp test` inside one package)
- `vp run -r build` - build the packages with tsdown (`vp pack`) into `dist/`
- `vp run --filter "example-*" typecheck` - svelte-check the example apps (after a build)

In an agent session, `.claude/hooks/session-start.sh` installs the dependencies
and puts a `vp` shim on PATH. Use `./node_modules/.bin/vp` if `vp` is still
missing.

### Dependencies

Every external version lives in the `catalog:` of `pnpm-workspace.yaml`
(`catalogMode: strict`); package.json files reference only `catalog:`,
`catalog:peers` (the published peer ranges) or `workspace:`. After changing the
catalog, run `pnpm install` and commit the regenerated `pnpm-lock.yaml`.

TypeScript is split 6/7: `typescript` is an alias for TS6 (the JS API, used by
svelte-check, the language service and `vp pack`'s declaration emit) and
`@typescript/native` is TS7 (bin `tsc`). Every workspace package lists
`typescript: "catalog:"` so peers resolve to the alias.

### Changes and releases

Every change to a published package ships with a changeset (`pnpm changeset`).
Never publish or version by hand: the Release workflow opens a "Version
Packages" PR that the owner merges; see `docs/RELEASING.md`.

<!-- effect-solutions:start -->

## Effect Best Practices

**IMPORTANT:** Always consult effect-solutions before writing Effect code.

1. Run `effect-solutions list` to see available guides
2. Run `effect-solutions show <topic>...` for relevant patterns (supports multiple topics)
3. Search `~/.local/share/effect-solutions/effect` for real implementations

Topics: quick-start, project-setup, tsconfig, basics, services-and-layers, data-modeling, error-handling, config, testing, cli.

Never guess at Effect patterns - check the guide first.

If `effect-solutions` is not installed, run `.claude/hooks/session-start.sh`
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
