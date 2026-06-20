---
"@thomasfosterau/effect-sveltekit": minor
---

Add an `HttpApp` server namespace for exposing an Effect HTTP application as a
SvelteKit `+server.ts` endpoint:

- `HttpApp.fromApi(api, layer, options?)` — serve an Effect `HttpApi`. The
  platform services an `HttpApi` needs (`HttpPlatform`, `FileSystem`, `Path`,
  `Etag`) are provided for you; pass a layer that implements the API's groups.
- `HttpApp.fromRouter(layer, options?)` — serve an `HttpRouter`.
- `HttpApp.fromHttpEffect(effect, options?)` — serve a single HTTP route effect
  (optionally with a layer of services).
- `HttpApp.fromWebHandler(handler, options?)` — adapt any Web `fetch` handler.

Each returns a SvelteKit endpoint handler (assign it to `fallback` on a
catch-all route) with a `dispose()` for the backing layer's scope. A `prefix`
option strips the SvelteKit mount path so the app's own routes line up. The
backing layer is built once on the first request and shared across requests.
