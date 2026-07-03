---
"@thomasfosterau/effect-svelte": minor
---

Add typed runtime contexts and a live-stream hook.

- `createRuntimeContext<R>(name?)` mints a dedicated, fully-typed runtime
  context (built on Svelte's `createContext`, one instance per call) so
  libraries with a service-typed `ManagedRuntime` can expose their own context
  without colliding with the default context or each other. `get()` returns the
  precise `RuntimeLike<R>` and throws an actionable error when unset.
- Every hook now accepts `options.runtime`, taking precedence over the ambient
  context and constraining the effect's `R` to what that runtime provides. The
  existing untyped default context keeps working unchanged.
- `useLiveStream(stream, options?)` subscribes to a live `Stream`, tracking the
  latest emission (replace, not append) with reactive re-subscription
  (stale-while-revalidate) when the thunk's reactive inputs change. Teardown
  interruption never surfaces as a `Failure`. It exposes a reactive `promise`
  for `experimental.async` + `<svelte:boundary>` templates, and an `initial`
  seed for a synchronous, SSR-safe first render.

The Svelte peer dependency moves to `>=5.40` (required for `createContext`).
