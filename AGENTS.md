# AGENTS.md

Read [README.md](README.md) and [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) first; this file adds only what is specific to agents. Each package's `AGENTS.md` states its boundary and invariants: read it before changing that package.

## Process

- You may open pull requests in this repository (GitHub MCP tools or `gh`, whichever is available). GitHub writes go to `thomasfosterau/effect-svelte` only.
- When you spot work outside your task, file an issue and move on.
- Write idiomatic Effect (see docs/CONTRIBUTING.md). Non-idiomatic code you find: fix it if trivial, otherwise file an issue naming the sites and the idiomatic replacement.
- Before reporting work as done, run the gates in docs/CONTRIBUTING.md and say which passed and which couldn't run.

## Pitfalls

- **Boundaries.** `packages/svelte` never imports `@sveltejs/kit`, `$app/*` or `$env/*`. The `effect-sveltekit` root entry is universal: `$app/*` value imports belong under `./server` or `./client`, `node:` under `./adapter*`; a type-only `$app/*` import is fine anywhere. Lint and fallow zones enforce both.
- **`.svelte.ts` modules keep their name in `dist/`** (`pack.unbundle`), so the consumer's Svelte compiler processes their runes.
- **`typescript` is TS6** (`@typescript/typescript6`): svelte-check and the declaration bundler need its JS API. Every workspace package lists `typescript: "catalog:"`, or svelte-check crashes on a second instance.
- **Runtime edge.** Only `src/internal/run.ts` in each package calls `Effect.run*`; don't add another.
- **`useEffect`** is effect-svelte's own hook, so `effect/avoid-react-hooks` is off.

## Pull requests

- **Write the PR body with the `pr` skill** from Matt Pocock's skills (`mattpocock-skills:pr`), filling in the repository's pull request template where there is one.
- **Resolve merge conflicts before you hand a PR over.** Rebase onto `origin/trunk` and push; a PR that conflicts with `trunk` isn't finished.
- **Mark the PR ready for review as soon as the initial draft is finished.** Don't wait for CI to run, for reviews, or for the owner to do it. Keep fixing CI failures and review findings on the ready PR.

## Fallow

- `vp install` links the `fallow` skill into `.claude/skills/fallow` from the installed package (approved under `permissions` in `pnpm-workspace.yaml`); the repository's own fallow rules are in [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
