# packages/svelte — `@thomasfosterau/effect-svelte`

Effect integration for Svelte 5 runes: an ambient runtime (`provideRuntime` / `getRuntime`), rune hooks that run Effects for a component (`useEffect`, `useDerived`, `useQuery`, `useMutation`, `useLiveStream`, …), bridges to `effect/reactivity` atoms and `Reactivity`, and `Store` / `emitter` adapters. One entry: `.` (`src/index.ts`). Read the root [AGENTS.md](../../AGENTS.md) first.

## Boundary

- **No SvelteKit.** Nothing under `src/` imports `@sveltejs/kit`, `$app/*` or `$env/*` (a `no-restricted-imports` override and the fallow `svelte` zone, which may import no other zone, enforce it). The package must run in a plain Vite + Svelte app; SvelteKit integration lives in `packages/sveltekit`.
- **Peers only.** `effect` and `svelte` are peers (`catalog:peers`); the package has no runtime dependencies.

## Invariants

- **Runes live in `*.svelte.ts`.** Any module that uses `$state` / `$derived` / `$effect` is named `*.svelte.ts`, and `pack.unbundle` keeps that name (`*.svelte.js`) in `dist/` so the consumer's Svelte compiler processes it.
- **Hooks expose `.current`**, typed as `AsyncResult` from `effect/reactivity/AsyncResult` for result-producing hooks — the Svelte 5 `MediaQuery` / `fromStore` convention.
- **A hook's fiber is scoped to its component.** Every hook interrupts its work when the component is destroyed (or its dependencies change); tests in `tests/dom/` pin this with `mount` / `unmount`.
- **This package is a runtime boundary.** Svelte calls in from non-Effect code, so `Effect.runFork` / `runPromise` / `runSync` here are the edge (the `effect/effect-run-in-body` lint rule is off for that reason). Rune-free orchestration lives in `src/internal/` so it can be tested in plain Node.

## Tests

`tests/` runs in Node; `tests/dom/` mounts components under happy-dom (`browser` condition); `tests/ssr/` renders through `svelte/server`. The `.svelte` fixtures are compiled with `svelte.config.js` (`experimental.async`), which svelte-check (`vp run check`) reads too.
