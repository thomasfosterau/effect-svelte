---
"@thomasfosterau/effect-sveltekit": patch
---

The standalone `endpoint` wrapper logs an unrecognised failure (`Endpoint error: …`) as part of the request's own Effect, so the line goes through the runtime's `Console` rather than a second, nested run; `redirect()` / `error()` are still not logged. The adapter's `toWebHandler` builds the app together with its layer through `HttpEffect.toWebHandlerLayerWith`, still once and on the first request. `Navigation.onNavigate`'s documentation no longer names `Effect.runPromise` as the default runner: the default runs the Effect with no services, as before.
