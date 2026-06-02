---
"@thomasfosterau/effect-svelte": minor
---

Fix runtime execution and reactivity across the Svelte hooks and SvelteKit helpers.

Svelte hooks:

- Hooks now work with both `Runtime.Runtime` and `ManagedRuntime` values.
  Previously the default `SvelteRuntime.defaultRuntime` (a `ManagedRuntime`)
  was passed to `Runtime.runFork`/`Runtime.runSync`, which crashed at runtime.
  `provideRuntime`/`getRuntime` now accept either kind via the new
  `RuntimeLike` type.
- `derived` and `reactiveQuery` results are now updated by mutating the
  returned `$state` proxy in place (untracked) instead of reassigning it, so
  the `AsyncResult` reference returned to callers stays reactive and the
  hooks' own effects do not loop.
- `useSubscriptionRef` now returns `{ readonly current: A }` instead of the
  raw value, since a returned primitive can never update reactively.
- `invalidateKeys(keys)` is replaced by `useInvalidateKeys(): (keys) => void`.
  The old form read Svelte context at call time, which throws when invoked
  from event handlers (its documented usage).
- Fibers are interrupted in the background (`unsafeInterruptAsFork`) instead
  of with `runSync(Fiber.interrupt(...))`, which threw when interrupting
  fibers suspended on async operations.
- `useScopeCallback` runs its callback untracked; `useEffect().interrupt()`
  resets the result to `initial`; `usePubSub`/`reactiveQuery` subscriptions
  are properly scoped and released on unmount.
- svelte peer dependency raised to `^5.40.0` (`createContext` requirement).

SvelteKit helpers:

- `serverLoad`, `action`, `actions`, `handle`, and `endpoint` now accept
  effects that require `HttpClient` / `SvelteKitRequestEvent` (the services
  the runtime actually provides). Previously they required `R = never`.
- `redirect()` and `error()` raised inside an effect are rethrown so
  SvelteKit handles them as control flow, instead of surfacing as 500s.
- Universal `load` (and the Vite plugin's universal wrapper) now provides
  `HttpClient` on the client too, backed by the load event's `fetch`. New
  `SvelteKitRuntime.forFetch(fetch)` constructor supports this.
- `RemoteFunction.query/form/command/prerender` now correctly detect Standard
  Schema validators that are callable values (such as Effect's
  `Schema.standardSchemaV1`), instead of mistaking them for handler functions.
