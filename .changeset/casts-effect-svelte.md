---
"@thomasfosterau/effect-svelte": patch
---

`getRuntime()`, and every hook called without a `runtime` option, now throws the documented `RuntimeNotFoundError` when no ancestor called `provideRuntime()`; it threw Svelte's own `missing_context` error before, because the lookup failed before the package's check ran. Nothing else changes at runtime: the hooks read the shared runtime context through one typed lookup instead of a type assertion each, and a `useMutation` with `invalidates` on a runtime without `Reactivity` still dies with Effect's "Service not found" defect.
