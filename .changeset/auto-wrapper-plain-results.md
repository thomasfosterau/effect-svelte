---
"@thomasfosterau/effect-sveltekit": patch
---

The wrappers the `effectKit()` plugin generates calls to (`@thomasfosterau/effect-sveltekit/internal/auto`: `wrapLoad`, `wrapServerLoad`, `wrapAction`, `wrapActions`, `wrapHandle`, `wrapHandleFetch`, `wrapHandleError`, `wrapEndpoint`, `wrapReroute`, `wrapInit`) now type the function form of an export as returning an Effect or what SvelteKit's own signature for that export returns (a `Response` for `handle`, a pathname for `reroute`, and so on) rather than `unknown`. Nothing changes at runtime or for the code the plugin generates; a hand-written call that passes a function returning anything else no longer type-checks.
