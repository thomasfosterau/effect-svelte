---
"@thomasfosterau/effect-sveltekit": minor
---

Add automatic per-request spans to all server handler wrappers (#46).

Every `serverLoad`, `action`, `endpoint`, `handle`, and `handleFetch` call now
creates an OpenTelemetry-compatible span via `Effect.withSpan`. Span names
encode both the handler type and the SvelteKit route pattern:

- `serverLoad /items/[id]`
- `action /checkout`
- `GET /api/items` (HTTP method + route for endpoints)
- `handle /items/[id]`

All spans have `kind: "server"`. Routes with no ID (e.g. standalone endpoints
without a route) fall back to `(unknown)`.

Spans are transparent without an exporter — `Effect.withSpan` uses the
`Tracer` reference, which defaults to an in-memory no-op. Wire up an OTLP
or Jaeger exporter in your application layer to observe them.
