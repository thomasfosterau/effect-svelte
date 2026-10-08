---
"@thomasfosterau/effect-svelte": patch
---

`useDerived` and `useReactiveQuery` now track only the reactive state their thunks read (`useDerived`'s `fn`, `useReactiveQuery`'s `keys` and `effectFn`), matching `useEffect(effect, { immediate: true })`. The Effect is started untracked, so state it reads while running no longer restarts it, even when that read happens synchronously (inside `Effect.sync`, or an `Effect.gen` before its first async step). Previously such a read became a dependency only when it happened before the Effect's first async boundary, so whether a change restarted the run depended on timing. If a run should restart when some state changes, read that state in the thunk, as in `useDerived(() => search(query))`.
