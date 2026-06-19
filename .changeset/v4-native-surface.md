---
"@thomasfosterau/effect-svelte": minor
---

Make the Svelte/SvelteKit surface Effect v4-native, and close several SvelteKit
API gaps.

**Result type (breaking).** The bespoke `AsyncResult`
(`initial | pending | success | failure`) is replaced by Effect's native
`effect/unstable/reactivity/AsyncResult` (`Initial | Success | Failure`, each
carrying a `waiting` flag). Hooks now preserve the previous value while
refetching (stale-while-revalidate) instead of flashing back to a pending
state. The `AsyncResult` namespace (`match`, `isSuccess`, `isWaiting`,
`getOrElse`, ...) is re-exported from the package root; the previous flat
`match` / `isPending` helpers are removed.

- Every result-producing hook now exposes its state via a `.current` accessor
  (the idiomatic Svelte 5 convention). `derived` and `reactiveQuery` return a
  `{ current }` handle instead of the result directly.
- `useStream`, `usePubSub`, and `useSubscriptionRef` are rebuilt on Svelte's
  `createSubscriber`, so a single Effect fiber backs any number of readers and
  is interrupted automatically when the last reader is destroyed.
- New `streamFromStore(store)` turns any Svelte readable store into a `Stream`.

**SvelteKit.**

- `transport` / `transporter`: build SvelteKit's universal `transport` hook
  from Effect Schemas, so custom types (`Option`, `DateTime`, branded types,
  `Schema.Class` instances, tagged errors) round-trip across the server/client
  boundary.
- `sveltekitConfig` / `sveltekitConfigProvider`: back Effect `Config` with a
  SvelteKit `$env` record.
- `reroute`: an Effect wrapper for the universal `reroute` hook, plus
  `effectKit()` plugin coverage for a universal `hooks.ts` file kind.
- `kit/client` now provides Effect wrappers for `$app/navigation` (`goto`,
  `invalidate`, `invalidateAll`, `refreshAll`, `preloadData`, `preloadCode`)
  and `liveQueryStream` (consume a `query.live(...)` as an Effect `Stream`),
  replacing the previous placeholder export.
