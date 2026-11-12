# AGENTS.md

Guidance for coding agents: the conventions, pitfalls and gates of this repo (humans follow them too). What the packages are and how to install them is in [README.md](README.md); setup, commands and hooks are in [CONTRIBUTING.md](CONTRIBUTING.md). Claude Code reads [.claude/CLAUDE.md](.claude/CLAUDE.md), which imports all three and adds only what is specific to Claude Code. Project conventions live here; personal style preferences live in user memory.

The repo is a pnpm 11 workspace on [Vite+](https://viteplus.dev) (`vp`), linted with oxlint and the `@enfect/oxlint` Effect preset and audited with [fallow](https://fallow.tools); there is no docgen. The default branch is `trunk`. Its two published packages, and where each one's code may reach:

| Package                            | Directory            | Entries                                                                                                                    | Boundary                                                 |
| ---------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `@thomasfosterau/effect-svelte`    | `packages/svelte`    | `.`                                                                                                                        | Peers `effect`, `svelte`; no SvelteKit.                  |
| `@thomasfosterau/effect-sveltekit` | `packages/sveltekit` | `.`, `./server`, `./client`, `./vite`, `./testing`, `./adapter`, `./adapter/handler`, `./adapter/serve`, `./internal/auto` | Depends on `effect-svelte`; the root entry is universal. |

Package-local invariants and terms live in each package's `AGENTS.md` (`packages/<name>/AGENTS.md`; the `CLAUDE.md` beside it only imports it); read it before changing that package. A new package adds a row here and in the root `README.md`, its own `AGENTS.md` and `CLAUDE.md`, its entries and a zone in `.fallowrc.json`, and its `#check` edge in the root `vite.config.ts`.

## Common pitfalls

- **Never edit a version in a `package.json`.** Versions live in `pnpm-workspace.yaml` (`catalog:` / `catalog:peers`; internal deps are `workspace:^`; `catalogMode: strict` rejects anything else). After editing it, run `pnpm install` and commit `pnpm-lock.yaml`, or CI fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. `vite-plus`, `vite`, `vitest` and `@vitest/coverage-istanbul` move together; read their catalog comments first. Move them with `pnpm dlx --package=vite-plus@<v> vp migrate --no-interactive`, then delete the `minimumReleaseAgeExclude` entries it adds and put back the bare `vite` / `vitest` override keys it rewrites to `vite@*` / `vitest@*` (see the comment there). Dependabot groups only the lockstep sets (`effect`, `toolchain` — `vite-plus`, `vitest`, `@vitest/*` —, `svelte`; `.github/dependabot.yml`), and every other dependency gets its own PR, with a 1-day cooldown (pnpm's `minimumReleaseAge` is 8 hours). By hand, because Dependabot cannot: the npm-alias entries `vite` and `typescript` (the migrate command above re-pins `vite`), and the `overrides`-only pins (`@effect/platform-node-shared`, which an `effect` group PR must move to `@effect/platform-node`'s release, and the security floors).
- **`effect` is a peer and a singleton** — two copies break `Context` / `Layer` / `Schema` identity; the `overrides` entry in `pnpm-workspace.yaml` forces one copy.
- **`packages/svelte` never imports `@sveltejs/kit`, `$app/*` or `$env/*`.** It must work in a plain Svelte app. A `no-restricted-imports` override in `vite.config.ts` enforces it.
- **The `effect-sveltekit` root entry is universal: no `$app/*` value imports, no `$env/*`, no `node:`.** It runs on both server and client. Code that needs `$app/*` goes under `./server` (remote functions reach `$app/server`) or `./client` (`$app/navigation`, `$app/state`, `$app/forms`); Node-only code goes under `./adapter*`. A type-only `import type … from "$app/server"` (or `$app/navigation`, `$app/state`, `$app/forms`) is fine anywhere: SvelteKit 3 publishes the remote-function, navigation, page and form types there, and `verbatimModuleSyntax` erases the import from the `.js`. `no-restricted-imports` overrides in `vite.config.ts` enforce the external specifiers, and fallow zones in `.fallowrc.json` enforce which entry's files may import which (a new file outside the listed server / client / adapter / build zones is universal). `pack.deps.neverBundle` in `packages/sveltekit/vite.config.ts` keeps `$app/*` and `node:` imports external — it does not stop one leaking into the wrong entry.
- **`.svelte.ts` modules keep their extension in `dist/`** (`pack.unbundle: true`): the consumer's Svelte compiler only processes runes in files named `*.svelte.js`.
- **`typescript` is an alias for TS6.** The JS-API consumers (svelte-check — the type gate — the language service and `vp pack`'s declaration emit) need TS6, so the catalog maps `typescript` to `@typescript/typescript6` (bin `tsc6`). No TS7 package is installed (#102), so there is no `@effect/tsgo` patch and no `effecttsgo` lint preset. Every workspace package lists `typescript: "catalog:"`, or a second TypeScript instance crashes svelte-check (see the catalog comment).

## Conventions

- **Effect-first.** Domain failures are tagged errors; work that can fail returns `Effect`; pure total functions stay plain functions. Import Effect modules by path (`import * as Effect from "effect/Effect"`), never from the `effect` barrel (`effect/no-barrel-imports`). Six helper modules take the lint rule's short alias: `Arr` (`effect/Array`), `P` (`effect/Predicate`), `R` (`effect/Record`), `Str` (`effect/String`), `Eq` (`effect/Equal`), `Bool` (`effect/Boolean`) (`effect/prefer-namespace-imports`).
- **Relative imports use the `.js` extension** (`./runtime.js`), not `.ts`.
- **`exactOptionalPropertyTypes` is on**: an optional option a caller may forward `undefined` to is declared `?: T | undefined`.
- **Tests import from `vite-plus/test`**, never `vitest`. A test that runs an Effect takes `it` from `@effect/vitest` and is an `it.effect` (TestClock) or, when it depends on real time, an `it.live`; no test calls `Effect.runPromise` / `runSync` / `runFork` (`effect/effect-run-in-body`), and a helper that needs an Effect's result returns an Effect. Which directory a test goes in (each package's Vitest projects) is in [CONTRIBUTING.md § Testing](CONTRIBUTING.md#testing).
- **Every export has a TSDoc summary** that stands alone in a hover, and documents the Effect error channel ("fails with …", or "a rejection surfaces as a defect").
- **Lint** is oxlint's `correctness`, `perf` and `suspicious` categories (with the `import`, `promise` and `vitest` plugins), `@enfect/oxlint`'s `recommended` preset (the `effect/*` rules), type-aware rules and `vite-plus/prefer-vite-plus-imports`, all in the root `vite.config.ts`.
- **Lint findings are fixed, not suppressed.** A type assertion carries a `// SAFETY: <the invariant>` comment on its statement (`effect/require-safety-comment-for-type-assertion`). A rule is turned off only in `vite.config.ts`, with a comment saying why it cannot apply. `effect/avoid-react-hooks` is one such rule: it matches the name `useEffect`, which is effect-svelte's own hook (kept by owner decision, #213), so consuming apps need the same override.

## Commands

The commands are in [CONTRIBUTING.md § Commands](CONTRIBUTING.md#commands). Invoke everything through `vp` (`vp exec` instead of `npx`; `vp run <task>` instead of bare `pnpm`; `vpx <file>.ts` for scripts). The sanctioned non-`vp` invocations: `pnpm install` (and `pnpm install --frozen-lockfile` in CI), `pnpm audit`, `pnpm changeset` and the release scripts. `vp check` (format + lint) and `vp run check` (the type gate) are different commands.

## Verification

Before you report work as done, run the gates below in order and quote each command with its final pass/fail. If a gate can't run here, say which and why in the PR body; never imply it ran.

1. From a clean install, which is what CI sees: `rm -rf node_modules packages/*/node_modules packages/*/dist && pnpm install --frozen-lockfile`.
2. `vp check`
3. `vp run check`
4. `vp run -r test:unit`
5. `vp run -r build`
6. `pnpm audit --audit-level high` (network)
7. `vp run test:coverage`, then `vp exec fallow audit --format json --quiet --explain --gate-marker agent --base origin/trunk` (the fallow gate below; not a CI step). The audit reads the Istanbul map at `coverage/coverage-final.json` and never refreshes it, so run `test:coverage` first: without the map fallow scores every function as uncovered, and any function with cyclomatic complexity ≥ 5 fails the gate on its own.

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

- The pinned version is the catalog's `effect` entry in `pnpm-workspace.yaml`. Both packages target Effect v4: `effect`, `@effect/platform-node` and `@effect/vitest` (the test harness; dev-only) move together on the one exact version pinned in the catalog, and the published peers are `catalogs.peers`. The `effect` (and `@effect/platform-node`) peer is `^4.0.0`; raise it only when a dependency requires it, naming the dependency in the catalog comment. CI tests only the pin, not the floor (#164), so a change that relies on behaviour or an API newer than 4.0.0 is checked by re-running the gates with the catalog pin set to 4.0.0. Raising the floor is a breaking change for both packages.
- HTTP lives under `effect/http/*` and `effect/http-api/*`; `Reactivity` and atoms under `effect/reactivity`, `AsyncResult` under `effect/reactivity/AsyncResult`. `@effect/platform` and `@effect/experimental` do not exist in v4.

## Agent sessions

- Every gate in [Verification](#verification) runs in an agent session; `pnpm audit` needs the network. Nothing here needs a secret, and nothing in a session can publish.
- The session bootstrap is `.claude/hooks/session-start.sh` (Claude Code's SessionStart hook and the devcontainer's `postCreateCommand`; [CONTRIBUTING.md § Development setup](CONTRIBUTING.md#development-setup)). It puts `vp` and `vpx` on PATH and nothing else: fallow is `vp exec fallow`.
- One checkout per branch: work in a git worktree, and run `pnpm install --frozen-lockfile` in each new one.

## Documentation surfaces

- Package `README.md`s — the npm API reference (npm shows only these; links into the repo stay relative, but a consumer must not need them); root `README.md` — the landing page; package `AGENTS.md`s — boundary, invariants and terms (not published).
- `docs/cookbook.md` — recipes.
- `.claude/CLAUDE.md` and each package's `CLAUDE.md` — Claude Code's entry points: they import the `AGENTS.md` beside them (the root one also imports `CONTRIBUTING.md` and `README.md`) and hold only what is specific to Claude Code.
- `CONTRIBUTING.md` — setup, commands, hooks and CI; `SECURITY.md` — reporting and supply-chain posture; `PUBLISHING.md` — the release pipeline and one-time owner setup.
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
