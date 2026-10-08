---
"@thomasfosterau/effect-svelte": patch
---

Fix `useEffect(effect, { immediate: true })`, `useQuery`, `useDerived` and `reactiveQuery` re-running in a loop until Svelte throws `effect_update_depth_exceeded`. Starting or settling a run read the hook's own result state inside its `$effect`, so every transition re-ran the effect; those reads are now untracked. `immediate: true` now starts the run untracked, like a `run()` from an event handler, so state the Effect reads synchronously no longer restarts it, and `setData` can be called from an `$effect`.
