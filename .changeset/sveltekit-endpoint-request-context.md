---
"@thomasfosterau/effect-sveltekit": minor
---

`Endpoint.fromApi` / `Endpoint.fromRouter` now accept a per-request `context`
hook, so session-aware, request-scoped services can be provided per dispatch
while the platform layer stays build-once.

```ts
Endpoint.fromApi(api, ApiLive, {
  prefix: "/api",
  // Resolve the request-scoped services the API groups require, per request.
  // May return a Context or an Effect producing one.
  context: (request) => Context.make(CurrentUser, userFor(request)),
});
```

The build-once platform layer (`HttpPlatform` / `FileSystem` / `Path` / `Etag`)
remains shared; only the request slice is merged for each request — the change
needed to serve a session-aware, request-pooled API on Cloudflare Workers
without rebuilding the platform layer. Backward compatible: omitting `context`
keeps today's behaviour.
