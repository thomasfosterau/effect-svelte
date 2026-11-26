# Contributing

## Workflow

- Branch off `trunk` and open a pull request into `trunk`; never commit to `trunk` directly. Open a draft PR as soon as you start, and keep one PR per change, however large. Squash-merge with a conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `ci:`). Rebase onto `origin/trunk` rather than merging it in.
- File an issue for anything you notice that is out of scope, and keep issue bodies evergreen: edit the body as understanding improves rather than appending comments.
- Dependabot keeps dependencies current. It can't make the moves below: make them in a PR from a new branch started from its head (never push to a `dependabot/*` branch, which stops it rebasing), and it closes its own PR once yours merges:
  - **toolchain** (`vite-plus`): run `vp dlx --package=vite-plus@<v> vp migrate --no-interactive`, drop the `minimumReleaseAgeExclude` entries it adds, restore the bare `vite` / `vitest` override keys, set `@vitest/coverage-istanbul` to the new `vitest`, and bump the devcontainer image tag.
  - **typescript** is an npm alias (`@typescript/typescript6`), moved by hand.
  - **security floors** under `overrides` are raised or dropped as their advisories move.

## Toolchain

[Vite+](https://viteplus.dev) (`vp`) manages Node and pnpm and runs every task. `vp install` installs dependencies and the git hooks; the pre-commit hook runs `vp staged` (format and lint) and then `vp run fallow:audit`.

| Command               | What it does                                                                           |
| --------------------- | -------------------------------------------------------------------------------------- |
| `vp check`            | Format (Oxfmt) and lint (Oxlint with the Effect preset, type-aware)                    |
| `vp run check`        | Type gate: svelte-check over every package, `.svelte` files included                   |
| `vp run -r test:unit` | Every package's tests; `vp test run <file>` from inside a package for one              |
| `vp run -r build`     | `vp pack` → each package's `dist/`                                                     |
| `vp run ci`           | Everything CI runs, in order (`pnpm audit` needs the network)                          |
| `vp run fallow:audit` | [Fallow](https://docs.fallow.tools) on your change (dead code, boundaries, complexity) |

Fallow is a guide, not dogma: use it to polish your work. Before deleting "unused" code, trace it (`vp exec fallow dead-code --trace <file>:<export>`). Every external version lives in the `pnpm-workspace.yaml` catalog; never edit one in a `package.json`.

## Coding guidelines

- **Effect.** Use Effect (v4) idioms throughout, and strongly prefer Effect's own modules (`Option`, `Array`, `Match`, `Schema`, `effect/http`, `effect/reactivity`, …) over hand-rolled equivalents; convert existing code where practical. Exceptions: Svelte component code, non-Effect APIs adapted at the edge (Svelte and SvelteKit callbacks), and hot paths where measured performance needs plain code. Read the installed `node_modules/effect` (its `AGENTS.md`, `ai-docs/`, typings) rather than guessing an API.
- Import Effect modules by path as namespaces (`import * as Effect from "effect/Effect"`; `Arr`, `P`, `R`, `Str`, `Eq`, `Bool` for the helper modules). Relative imports use `.js`.
- Exports follow Effect's layout: `index.ts` re-exports PascalCase module namespaces (`export * as Runtime from "./Runtime.js"`), and each module is also importable from a PascalCase subpath (`"./Runtime"`).
- Absence is `Option`. `exactOptionalPropertyTypes` is on: options-bag members are `readonly x?: T`, optional parameters `x?: T`.
- Fix lint findings in code; a rule is relaxed only in `vite.config.ts`, with its reason. Type assertions live only in `packages/sveltekit/src/internal/unchecked.ts`, each with a `// SAFETY:` comment.
- **Comments.** A short file header only where it adds context. Doc comments on exports where they add to IntelliSense (and name the error channel); inline comments only for the non-obvious. No references to issues, PRs or history.
- **Tests** check logic and edge cases, not what the type system or a lint already checks. Import from `vite-plus/test`; an Effect test uses `@effect/vitest`'s `it.effect` (or `it.live` on real time) and never calls `Effect.run*`. `packages/svelte` runs `tests/dom/` under happy-dom and `tests/ssr/` through `svelte/server`; `packages/sveltekit` runs `tests/client/` under happy-dom with `$app/*` stand-ins.

## Before pushing

Run `vp run ci`, or each of `vp check`, `vp run check`, `vp run -r test:unit`, `vp run -r build`. Say in the PR body which gates couldn't run.

CI ([ci.yml](../.github/workflows/ci.yml)) runs `vp run ci` on Node `lts` and `latest`, with no secrets. Workflows pin actions by exact tag, locked to commits by `.github/workflows/actions.lock`: run `gh actions-lock` after changing a `uses:`. `uvx zizmor --offline .github` audits the workflows.

## Dependencies

Dependabot ([dependabot.yml](../.github/dependabot.yml)) opens every update weekly, on Wednesday morning Melbourne time: the named runtime sets (`effect` and the like) each in one PR, and every other development dependency in the single `toolchain` group. Security updates skip the schedule and open as soon as an advisory lands, one PR each. Vite+ selects Node.js from `.node-version` and pnpm from `packageManager`; pnpm's own switching is off (`runtimeOnFail` / `pmOnFail`), so one version of each is installed and used.

## Changesets

Every change to a published package's behaviour, its `.d.ts` (doc comments included, as a `patch`) or its README needs a changeset: `vp exec changeset`. CI-, tooling- and guidance-only changes need none. Never version or publish by hand: the Release workflow opens the `chore: version packages` PR, and merging it publishes. See [PUBLISHING.md](PUBLISHING.md).
