---
"@thomasfosterau/effect-svelte": minor
---

Add a Svelte 5 binding for `effect/unstable/reactivity` atoms — `useAtomResult` (SSR-safe `AsyncResult` reads with stale-while-revalidate), `useAtom` (read / write any atom), `invalidateAtomKeys` (keyed invalidation through the registry's own `Reactivity` instance) and `makeAtomRegistry` / `provideAtomRegistry` / `getAtomRegistry` — plus `useDebouncedSearch`, a debounced, latest-wins, interruptible typeahead controller built on `useStream`.
