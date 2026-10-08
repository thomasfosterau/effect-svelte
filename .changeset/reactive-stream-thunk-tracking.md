---
"@thomasfosterau/effect-svelte": patch
---

`useReactiveStream` now restarts when the reactive state its `keys` or `effect` thunk reads changes, as its TSDoc promised and as `useReactiveQuery` does: the running stream is interrupted and a new one starts with the new keys and Effect, its `values` empty again. Previously the thunks were read only when the stream first started (Svelte runs a `createSubscriber` start callback untracked), so a change such as a new `userId` was ignored. As with `useReactiveQuery`, only the thunks' reads are dependencies: state the Effect reads while running does not restart the stream. `useInvalidateKeys`'s invalidator now runs untracked, so calling it from an `$effect` no longer makes that effect depend on the state the re-run queries read synchronously.
