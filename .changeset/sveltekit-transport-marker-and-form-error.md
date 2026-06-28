---
"@thomasfosterau/effect-sveltekit": patch
---

Two opt-in extensions to the remote/transport surface:

- `Hooks.markerTransporter({ guard, make })` builds a deliberately-lossy
  `transport` entry for a non-POJO wrapper whose contents should not round-trip:
  `encode` emits a truthy marker for matching values, `decode` reconstructs a
  fresh value. `Hooks.transport` now accepts either an Effect `Schema.Codec` or a
  ready `Transporter`, so round-tripping and marker-style entries can be mixed.
- `RemoteFunction.withRuntime(provider, { formError })` adds a form-error interop
  hook: a remote form's failure path can map a structured/nested error shape into
  SvelteKit's field issues (via the `issue` helper / `invalid()`) for field-level
  invalidation, instead of falling back to `translateError`.
