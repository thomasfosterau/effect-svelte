# AGENTS.md

`CLAUDE.md` is a symlink to this file; edit `AGENTS.md`. This repo publishes two npm packages for Effect v4 apps built on Svelte 5 and SvelteKit; `examples/*` are private apps (never published) built against the packages' `dist/`. It is a pnpm workspace on [Vite+](https://viteplus.dev) (`vp`), with no fallow gate, no docgen and no Effect canary.

| Package                            | Directory            | Purpose / boundary                                                                                                                |
| ---------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-svelte`    | `packages/svelte`    | Effect integration for Svelte 5 runes. Peers `effect`, `svelte`; no SvelteKit.                                                    |
| `@thomasfosterau/effect-sveltekit` | `packages/sveltekit` | SvelteKit wrappers, remote functions, the `effectKit()` Vite plugin and an Effect deployment adapter. Depends on `effect-svelte`. |

## Common pitfalls

- **Never edit a version in a `package.json`.** Versions live in `pnpm-workspace.yaml` (`catalog:` / `catalog:peers`; internal deps are `workspace:^`). After editing it, run `pnpm install` and commit `pnpm-lock.yaml` — CI installs with `--frozen-lockfile`.
- **`effect` is a peer and a singleton** — two copies break `Context` / `Layer` / `Schema` identity; the `overrides` entry in `pnpm-workspace.yaml` forces one copy.
- **`packages/svelte` never imports `@sveltejs/kit`, `$app/*` or `$env/*`.** It must work in a plain Svelte app (the todomvc and realtime-dashboard examples are Vite-only).
- **The `effect-sveltekit` root entry is universal: no `$app/*`, no `$env/*`, no `node:`.** It runs on both server and client. Code that needs `$app/*` goes under `./server` (remote functions reach `$app/server`) or `./client` (`$app/navigation`, `$app/state`, `$app/forms`); Node-only code goes under `./adapter*`. `pack.deps.neverBundle` in `packages/sveltekit/vite.config.ts` keeps `$app/*` and `node:` imports external — it does not stop one leaking into the wrong entry.
- **`.svelte.ts` modules keep their extension in `dist/`** (`pack.unbundle: true`): the consumer's Svelte compiler only processes runes in files named `*.svelte.js`.
- **TypeScript is split 6/7.** `typescript` is an alias for TS6 (the JS API: svelte-check, the language service and `vp pack`'s declaration emit); `@typescript/native` is TS7 (bin `tsc`), which no script or workflow currently invokes (#102). Every workspace package lists `typescript: "catalog:"`, or a second TypeScript instance crashes svelte-check (see the catalog comment).

## Conventions

- **Relative imports use the `.js` extension** (`./runtime.js`), not `.ts`.
- **`exactOptionalPropertyTypes` is on**: an optional option a caller may forward `undefined` to is declared `?: T | undefined`.
- **Tests import from `vite-plus/test`.** In `packages/svelte`, component tests that mount go in `tests/dom/` (happy-dom), server-render tests in `tests/ssr/`, everything else in `tests/` (Node); `packages/svelte/vite.config.ts` defines the three projects.
- **Every export has a TSDoc summary** that stands alone in a hover, and documents the Effect error channel ("fails with …", or "a rejection surfaces as a defect").

## Commands

- `vp install` — dependencies (delegates to pnpm). Use `./node_modules/.bin/vp` if `vp` is not on PATH.
- `vp check` — format (Oxfmt), lint (Oxlint) and type-check (tsgolint); `--fix` autofixes. This repo has no `vp run check` task: `vp check` is the type gate too.
- `vp run -r test` — every package's Vitest suite; `vp test` inside one package. The task is `test`, not `test:unit`.
- `vp run -r build` — `vp pack` (tsdown) into each package's `dist/`, then the example apps.
- `vp run --filter "example-*" typecheck` / `build` — svelte-check / build the example apps; run after `vp run -r build`, because they consume `dist/`.
- `pnpm changeset` — add a changeset.

## Verification

Before you report work as done, run these in CI's order (`.github/workflows/ci.yml`) and quote each command with its final pass/fail:

1. `vp check`
2. `vp run -r test`
3. `vp run -r build`
4. `vp run --filter "example-*" typecheck`
5. `vp run --filter "example-*" build`

If a gate can't run here, say which and why in the PR body; never imply it ran.

## Branches and pull requests

- Branch off `main`; PR against `main`; squash-merge. Name branches `issue-<n>-<slug>` for issue work. Rebase onto `origin/main` before opening or updating a PR; never merge `main` into your branch (GitHub's Update-branch button merges).
- Every change to a published package's behaviour, TSDoc or `README.md` (both ship to npm) carries a changeset (`pnpm changeset`); docs-, CI-, tooling- and example-only changes elsewhere need none. Never publish or version by hand: the Release workflow opens the "Version Packages" PR and the owner merges it ([docs/RELEASING.md](docs/RELEASING.md)).
- Open a PR once a branch is pushed, watch it until it merges or closes (CI failures, review comments, conflicts), and keep its body current with what the branch does.
- GitHub writes go to `thomasfosterau/effect-svelte` only; pass `-R thomasfosterau/effect-svelte` whenever the cwd might be another checkout. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

Issues are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO. The issue is the spec — read its comments; later comments override the body. Record decisions and findings as issue comments, not in a README or `docs/`. Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop. Scope cut mid-PR becomes a linked issue before merge.

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

`effect-solutions` is a global CLI installed by the SessionStart hook, not a devDependency; `~/.local/share/effect-solutions/effect` is a clone of [Effect-TS/effect-smol](https://github.com/Effect-TS/effect-smol), with the v3 → v4 migration maps under `migration/` (start with `v3-to-v4.md`). If neither is available, read `node_modules/effect/dist/*.d.ts`.

Both packages target Effect v4: `effect` and `@effect/platform-node` move together on the one exact version pinned in the catalog, and the published peer floor is `catalogs.peers`. HTTP lives under `effect/http/*` and `effect/http-api/*`; `Reactivity` and atoms under `effect/reactivity`, `AsyncResult` under `effect/reactivity/AsyncResult`. `@effect/platform` and `@effect/experimental` do not exist in v4.

## Agent sessions

The SessionStart hook (`.claude/hooks/session-start.sh`, also the devcontainer's `postCreateCommand`) repairs a broken `node` shim, installs dependencies against the lockfile, puts `vp` on PATH for non-interactive shells, and installs effect-solutions plus the effect-smol clone (both need network; failure is non-fatal). It hydrates no secrets, and none are needed: every gate runs offline. Publishing runs only in the Release workflow (OIDC). `examples/hacker-news` calls the live Algolia HN API at runtime, so its `dev` server needs network; its typecheck and build do not.

## Documentation surfaces

- Package `README.md`s — the npm API reference (npm shows only these; links into the repo stay relative, but a consumer must not need them); root `README.md` — the landing page.
- `docs/cookbook.md` — recipes; `examples/README.md` — which export each example exercises.
- `CONTRIBUTING.md` — setup and the pre-PR checklist; `SECURITY.md` — reporting and supply-chain posture; `docs/RELEASING.md` — the release pipeline and one-time owner setup.
- Decisions — issue comments.
