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
- Remote functions as Effects (`RemoteFunction.query`/`form`/`command`/
  `prerender`/`query.live`), call helpers (`callQuery`, `callCommand`,
  `submitForm`, ...), `liveQueryStream` (a `query.live(...)` as an Effect
  `Stream`), and `useRemoteQuery` (a reactive remote resource as an
  `AsyncResult`).
- `transport` ⇄ Effect Schema: move custom types (`Option`, `DateTime`, branded
  types, `Schema.Class` instances, tagged errors) across the server/client
  boundary.
- `$env` ⇄ Effect `Config` (`sveltekitConfig`), and Effect wrappers for
  `$app/navigation` (`goto`, `invalidate`, `preloadData`, ...).
- An Effect HTTP deployment adapter (`effect/unstable/http` +
  `@effect/platform-node`) with `Config`-based configuration, request tracing
  spans, and graceful shutdown.
