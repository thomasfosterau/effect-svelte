---
"@thomasfosterau/effect-sveltekit": minor
---

Add a general, Effect-idiomatic seam for _how the per-request execution context
is obtained_, plus pluggable boundary error translation. This lets a consumer
that owns its own per-request `ManagedRuntime` (e.g. a SvelteKit app on
Cloudflare Workers, rebuilding the runtime mid-request and disposing it after
the response) drive `serverLoad` / `action` / `actions` / `endpoint` and remote
functions with its own service catalogue and its own error mapping.

- `RequestRuntime` constructs a `RequestRuntimeProvider`:
  - `fromLocals(get)` — adopt a runtime the consumer stashed on the event
    (resolved at call time, so a mid-request rebuild is honoured); accepts a
    `ManagedRuntime` or a built service `Context`.
  - `fromLayerPerRequest(layer, { afterResponse })` — let the package build and
    dispose a `ManagedRuntime` per request, optionally deferring disposal to
    after the response (Workers `ctx.waitUntil`).
  - `fromManagedRuntime(rt)` / `fromLayer(layer)` — the existing
    build-once-per-process model, expressed as a provider.
- `makeRuntimeAdapter(provider, { translateError })` binds the server wrappers
  to a provider. The handler effect's requirement channel `R` is the provider's
  services — your own application catalogue — not the fixed `SvelteKitServices`.
- `RemoteFunction.withRuntime(provider, { translateError })` gives remote
  functions (`query` / `form` / `command` / `prerender`) the same seam.
- `translateError?: (cause: Cause.Cause<unknown>) => never` is accepted by
  `makeRuntimeAdapter`, `makeServerRuntime`, and `RemoteFunction.withRuntime`,
  and may throw `redirect()` / `error()` (and, for remote forms, call
  `invalid()`), so a domain error catalogue surfaces as SvelteKit control flow
  instead of a 500. Defaults to the existing passthrough.

Backward compatible: existing exports and defaults are unchanged. The
per-request runtime interface previously exported from `…/server` as
`RequestRuntime` is now exported as `ScopedRequestRuntime` (the `RequestRuntime`
name is the new provider-constructor namespace).
