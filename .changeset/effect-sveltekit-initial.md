---
"@thomasfosterau/effect-sveltekit": minor
---

Initial release of `@thomasfosterau/effect-sveltekit` — an Effect v4-native
integration for SvelteKit. Depends on `@thomasfosterau/effect-svelte`.

- Write `load`, `actions`, `endpoint`, `handle`, and the universal `reroute`
  hook as Effects — via explicit wrappers, app-wide runtimes
  (`makeServerRuntime` / `makeUniversalRuntime`, services built once per
  process), or the `effectKit()` Vite plugin that auto-wraps bare-Effect route
  exports.
- Remote functions: define them as Effects with `RemoteFunction.query` /
  `.form` / `.command` / `.prerender` / `query.live` (server), and consume them
  via the `Remote` namespace (`Remote.callQuery`, `Remote.callCommand`,
  `Remote.submitForm`, `Remote.liveQueryStream`, …). `useRemoteQuery` bridges a
  reactive remote resource to an `AsyncResult`.
- Client-side `$app/navigation` / `$app/state` interop, exposed as Effect-style
  namespaces from `@thomasfosterau/effect-sveltekit/client`: `Navigation`
  (`goto`, `invalidate`, `preloadData`, … plus `beforeNavigate` /
  `afterNavigate` / `onNavigate` as Effect `Stream`s / effects) and `State`
  (`page` as a `Stream` of page snapshots).
- `transport` ⇄ Effect Schema: move custom types (`Option`, `DateTime`, branded
  types, `Schema.Class` instances, tagged errors) across the server/client
  boundary.
- `$env` ⇄ Effect `Config` (`sveltekitConfig`).
- An Effect HTTP deployment adapter (`effect/unstable/http` +
  `@effect/platform-node`) with `Config`-based configuration, request tracing
  spans, and graceful shutdown.
