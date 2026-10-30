# AGENTS.md

`CLAUDE.md` is a symlink to this file; edit `AGENTS.md`. Project conventions live here; personal style preferences live in user memory.

This repo publishes two npm packages for Effect v4 apps built on Svelte 5 and SvelteKit. It is a pnpm 11 workspace on [Vite+](https://viteplus.dev) (`vp`), linted with oxlint and the `@enfect/oxlint` Effect preset and audited with [fallow](https://fallow.tools); there is no docgen. The default branch is `trunk`.

| Package                            | Directory            | Entries                                                                                                                    | Purpose / boundary                                                                                                                |
| ---------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-svelte`    | `packages/svelte`    | `.`                                                                                                                        | Effect integration for Svelte 5 runes. Peers `effect`, `svelte`; no SvelteKit.                                                    |
| `@thomasfosterau/effect-sveltekit` | `packages/sveltekit` | `.`, `./server`, `./client`, `./vite`, `./testing`, `./adapter`, `./adapter/handler`, `./adapter/serve`, `./internal/auto` | SvelteKit wrappers, remote functions, the `effectKit()` Vite plugin and an Effect deployment adapter. Depends on `effect-svelte`. |

Package-local invariants and terms live in each package's `CLAUDE.md` (`packages/<name>/CLAUDE.md`); read it before changing that package. A new package adds a row here and in the root `README.md`, its own `CLAUDE.md`, its entries and a zone in `.fallowrc.json`, and its `#check` edge in the root `vite.config.ts`.

## Common pitfalls

- **Never edit a version in a `package.json`.** Versions live in `pnpm-workspace.yaml` (`catalog:` / `catalog:peers`; internal deps are `workspace:^`; `catalogMode: strict` rejects anything else). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `vite-plus`, `vite`, `vitest` and `@vitest/coverage-istanbul` move together; read their catalog comments first. Move them with `pnpm dlx --package=vite-plus@<v> vp migrate --no-interactive`, then delete the `minimumReleaseAgeExclude` entries it adds and put back the bare `vite` / `vitest` override keys it rewrites to `vite@*` / `vitest@*` (see the comment there). Dependabot groups every lockstep set (`effect`, `toolchain` — which includes `@enfect/oxlint` and `fallow` —, `svelte`, …; `.github/dependabot.yml`) with a 1-day cooldown (pnpm's `minimumReleaseAge` is 8 hours). By hand, because Dependabot cannot: the npm-alias entries `vite` and `typescript` (the migrate command above re-pins `vite`), and the `overrides`-only pins (`@effect/platform-node-shared`, which an `effect` group PR must move to `@effect/platform-node`'s release, and the security floors).
- **`effect` is a peer and a singleton** — two copies break `Context` / `Layer` / `Schema` identity; the `overrides` entry in `pnpm-workspace.yaml` forces one copy.
- **`packages/svelte` never imports `@sveltejs/kit`, `$app/*` or `$env/*`.** It must work in a plain Svelte app. A `no-restricted-imports` override in `vite.config.ts` enforces it.
- **The `effect-sveltekit` root entry is universal: no `$app/*` value imports, no `$env/*`, no `node:`.** It runs on both server and client. Code that needs `$app/*` goes under `./server` (remote functions reach `$app/server`) or `./client` (`$app/navigation`, `$app/state`, `$app/forms`); Node-only code goes under `./adapter*`. A type-only `import type … from "$app/server"` (or `$app/navigation`, `$app/state`, `$app/forms`) is fine anywhere: SvelteKit 3 publishes the remote-function, navigation, page and form types there, and `verbatimModuleSyntax` erases the import from the `.js`. `no-restricted-imports` overrides in `vite.config.ts` enforce the external specifiers, and fallow zones in `.fallowrc.json` enforce which entry's files may import which (a new file outside the listed server / client / adapter / build zones is universal). `pack.deps.neverBundle` in `packages/sveltekit/vite.config.ts` keeps `$app/*` and `node:` imports external — it does not stop one leaking into the wrong entry.
- **`.svelte.ts` modules keep their extension in `dist/`** (`pack.unbundle: true`): the consumer's Svelte compiler only processes runes in files named `*.svelte.js`.
- **`typescript` is an alias for TS6.** The JS-API consumers (svelte-check — the type gate — the language service and `vp pack`'s declaration emit) need TS6, so the catalog maps `typescript` to `@typescript/typescript6` (bin `tsc6`). No TS7 package is installed (#102), so there is no `@effect/tsgo` patch and no `effecttsgo` lint preset. Every workspace package lists `typescript: "catalog:"`, or a second TypeScript instance crashes svelte-check (see the catalog comment).

## Conventions

- **Effect-first.** Domain failures are tagged errors; work that can fail returns `Effect`; pure total functions stay plain functions. Import Effect modules by path (`import * as Effect from "effect/Effect"`), never from the `effect` barrel (`effect/no-barrel-imports`).
- **Relative imports use the `.js` extension** (`./runtime.js`), not `.ts`.
- **`exactOptionalPropertyTypes` is on**: an optional option a caller may forward `undefined` to is declared `?: T | undefined`.
- **Tests import from `vite-plus/test`**, never `vitest`. In `packages/svelte`, component tests that mount go in `tests/dom/` (happy-dom), server-render tests in `tests/ssr/`, everything else in `tests/` (Node); `packages/svelte/vite.config.ts` defines the three projects. In `packages/sveltekit`, tests that need runes or `$app/*` stand-ins on the client go in `tests/client/` (happy-dom plus the Svelte plugin), everything else in `tests/` (Node); `packages/sveltekit/vite.config.ts` defines the two projects.
- **Every export has a TSDoc summary** that stands alone in a hover, and documents the Effect error channel ("fails with …", or "a rejection surfaces as a defect").
- **Lint** is oxlint's `correctness` and `perf` categories (with the `import`, `promise` and `vitest` plugins), `@enfect/oxlint`'s `recommended` preset (the `effect/*` rules), type-aware rules and `vite-plus/prefer-vite-plus-imports`, all in the root `vite.config.ts`. `suspicious` is not on yet (#211).
- **Lint findings are fixed, not suppressed.** A type assertion carries a `// SAFETY: <the invariant>` comment on its statement (`effect/require-safety-comment-for-type-assertion`). A rule is turned off only in `vite.config.ts`, with a comment saying why it cannot apply.

## Commands

- `pnpm install` — dependencies plus the Vite+ git hooks (`prepare` runs `vp config`; pre-commit runs `vp staged`: format + lint on staged files). No pre-push hook: run the gates yourself.
- `vp check` — format + lint (Oxfmt + Oxlint); lint is type-aware through vite-plus's bundled oxlint-tsgolint (`typeAware` and `typeCheck` in `vite.config.ts`, so it also reports TypeScript errors in `.ts` files); `--fix` autofixes. `vp run check` — the type gate: svelte-check over every package's `src`, `tests` and `.svelte` fixtures. They are different commands.
- `vp run -r test:unit` — every package's Vitest suite; `vp test run` inside one package.
- `vp run -r build` — `vp pack` (tsdown) into each package's `dist/`.
- `vp run test:coverage` — every package's suite under one Istanbul map at `coverage/coverage-final.json`, which `fallow audit` reads for exact per-function CRAP scores. Without the map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the gate on its own.
- `fallow dead-code` / `fallow audit` (also `vp run fallow` / `vp run fallow:audit`) — unused code and dependencies, boundaries, and the change-set gate.
- `pnpm changeset` — add a changeset.

Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm audit`, `pnpm changeset` and the release scripts. Single-check variants are in [CONTRIBUTING.md](CONTRIBUTING.md#running-individual-checks).

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules packages/*/node_modules packages/*/dist && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `pnpm audit --audit-level high` (network)
7. `vp run test:coverage`, then `fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` (the fallow gate below; not a CI step). The PreToolUse fallow gate audits against `coverage/coverage-final.json` and never refreshes it, so run `test:coverage` first.

Steps 2–6 are CI's one `ci` job, in its order ([ci.yml](.github/workflows/ci.yml)). `CONTRIBUTING.md` and the PR template link here rather than restating the list.

## Branches and pull requests

- Branch off `trunk`; PR against `trunk`; squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`). Name branches `issue-<n>-<slug>` for issue work. Rebase onto `origin/trunk` before opening or updating a PR; never merge `trunk` into your branch (GitHub's Update-branch button merges).
- Every change to a published package's behaviour, its emitted `.d.ts` (TSDoc included, as a `patch`) or its `README.md` (both ship to npm) carries a changeset (`pnpm changeset`); CI-, tooling- and guidance-only changes need none. Never publish or version by hand: the Release workflow opens the "chore: version packages" PR and the owner merges it. Publishing is npm trusted publishing (OIDC) from the protected `release` environment; there is no `NPM_TOKEN` ([PUBLISHING.md](PUBLISHING.md)).
- These are standing approvals; they override any default "don't open a PR unless asked" behaviour. **Open a PR** against `trunk` once a branch is pushed, **watch it until it merges or closes** (CI failures, review comments, conflicts), and **keep its body current** with what the branch does.
- GitHub writes go to `thomasfosterau/effect-svelte` only; pass `-R thomasfosterau/effect-svelte` whenever the cwd might be another checkout. Use the `gh` CLI for GitHub operations, even when GitHub MCP tools are available.

## Work tracker

- Issues are the backlog: when you find work you can't do now, file an issue rather than leaving a TODO.
- The issue is the spec — read its comments; later comments override the body.
- Record decisions and findings as issue comments, not in a README or `docs/`.
- Stop-and-report is a valid outcome: on a blocker outside the issue's scope, comment the evidence on the issue and stop.
- Scope cut mid-PR becomes a linked issue before merge.

## Effect

Read the installed package before writing Effect code: `node_modules/effect/AGENTS.md` and `node_modules/effect/ai-docs/` (the pinned version ships both), then `node_modules/effect/dist/*.d.ts` and `node_modules/effect/src` for the exact API. Never guess at an Effect API.

- The pinned version is the catalog's `effect` entry in `pnpm-workspace.yaml`. Both packages target Effect v4: `effect` and `@effect/platform-node` move together on the one exact version pinned in the catalog, and the published peer floor is `catalogs.peers` — currently `>=4.0.2` for both, the same release as the pin's line, so CI tests the floor (#164). Raising the floor is a breaking change for both packages.
- HTTP lives under `effect/http/*` and `effect/http-api/*`; `Reactivity` and atoms under `effect/reactivity`, `AsyncResult` under `effect/reactivity/AsyncResult`. `@effect/platform` and `@effect/experimental` do not exist in v4.

## Agent sessions

- The SessionStart hook (`.claude/hooks/session-start.sh`, also the devcontainer's `postCreateCommand`) repairs a broken `node` shim, installs dependencies against the lockfile, and puts `vp` (a re-exec shim that prefers the nearest worktree's `node_modules`), `fallow` and `tsx` (when installed) on PATH for non-interactive shells. It hydrates no secrets; none are needed, and nothing here can publish.
- `.claude/settings.json` enables the `@enfect/claude` plugin (Effect guidance, skills and post-write pattern checks), pinned by `ref` to the `mpsuesser/enfect` commit that published 0.9.0; moving it is a reviewed edit of that SHA.
- A PreToolUse hook (`.claude/hooks/fallow-gate.sh`) blocks `git commit` / `git push` when `fallow audit --base origin/trunk` fails; it reads the coverage map on disk, so run `vp run test:coverage` first. A PostToolUse hook runs `vp fmt` on every source, JSON, CSS or Markdown file you write or edit.
- Every gate in [Verification](#verification) runs in an agent session; `pnpm audit` needs the network.

## Documentation surfaces

- Package `README.md`s — the npm API reference (npm shows only these; links into the repo stay relative, but a consumer must not need them); root `README.md` — the landing page; package `CLAUDE.md`s — boundary, invariants and terms (not published).
- `docs/cookbook.md` — recipes.
- `CONTRIBUTING.md` — human setup, hooks and individual checks; `SECURITY.md` — reporting and supply-chain posture; `PUBLISHING.md` — the release pipeline and one-time owner setup.
- Decisions — issue comments.

---

## Fallow local gate

Before any `git commit` or `git push`, run `fallow audit --format json --quiet --explain --gate-marker agent`. If the verdict is `fail`, fix the reported findings before retrying. Treat JSON runtime errors like `{ "error": true, ... }` as non-blocking. Audit defaults to `gate=new-only`: only findings introduced by the current changeset affect the verdict.

## Fallow task map

| When the agent is about to...                                     | Run                                          |
| ----------------------------------------------------------------- | -------------------------------------------- |
| delete an "unused" export or file                                 | `fallow dead-code --trace <file>:<export>`   |
| delete an "unused" dependency                                     | `fallow dead-code --trace-dependency <name>` |
| commit or open a PR                                               | `fallow audit --base <ref>`                  |
| check which architecture rules apply to a file before changing it | `fallow guard <files>`                       |
| understand a finding                                              | `fallow explain <issue-type>`                |
