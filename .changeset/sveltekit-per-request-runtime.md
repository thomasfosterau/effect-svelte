---
"@thomasfosterau/effect-sveltekit": minor
---

`ServerRuntime` now creates a per-request runtime in its `handle` hook and shares
it across the whole request.

When `handle` (explicit or auto-wrapped by the Vite plugin) runs, it builds a
`RequestRuntime` — the application layer's services plus the request's
`HttpClient` / `SvelteKitRequestEvent`, built once and sharing a single request
scope — and stores it on `event.locals`. Every other wrapper for that runtime
(`serverLoad`, `action`, `actions`, `endpoint`, `handleFetch`, `handleError`)
then runs the request's effects on it, rather than rebuilding the request
services for each call.

- `ServerRuntime.requestRuntime(event)` returns the per-request `RequestRuntime`
  (or `undefined` when `handle` was not used), so you can run your own effects on
  the same runtime — for example to populate `event.locals` from another hook.
- Backward compatible: a different runtime's wrappers, and requests without
  `handle` wired, fall back to building the request services per call.
