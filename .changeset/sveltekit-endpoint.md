---
"@thomasfosterau/effect-sveltekit": minor
---

Add an `Endpoint` server namespace for creating SvelteKit `+server.ts` endpoints
backed by Effect. Each helper returns a SvelteKit `RequestHandler` (assign it to
`fallback` on a catch-all route) with a `dispose()` for the backing layer's
scope:

- `Endpoint.fromApi(api, layer, options?)` — serve an Effect `HttpApi`. The
  platform services an `HttpApi` needs (`HttpPlatform`, `FileSystem`, `Path`,
  `Etag`) are provided for you; pass a layer that implements the API's groups.
- `Endpoint.fromRouter(layer, options?)` — serve an `HttpRouter`.
- `Endpoint.fromHttpEffect(effect, options?)` — serve a single HTTP route effect
  (optionally with a layer of services).

A `prefix` option strips the SvelteKit mount path so the route's own paths line
up. The backing layer is built once on the first request and shared across
requests.
