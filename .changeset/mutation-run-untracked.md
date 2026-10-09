---
"@thomasfosterau/effect-svelte": patch
---

`useReactiveMutation`'s `run()` and `useMutation`'s `mutate()` now run untracked, so calling them from an `$effect` no longer makes that effect depend on the state the mutation reads. Previously the caller's `$effect` re-ran (and so started the mutation again) whenever state changed that was read by the `keys` / `effect` thunks, by `fn`, by the Effect before its first async step, by the `onMutate` / `onSuccess` / `onError` / `onSettled` callbacks or `invalidates` thunk when the Effect settled synchronously, or by the queries a synchronous success re-ran through invalidation. This matches `useInvalidateKeys`, which already invalidates untracked.
