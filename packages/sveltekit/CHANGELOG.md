# @thomasfosterau/effect-sveltekit

## 0.2.0

### Minor Changes

- 3a6f6cc: Add `apiClient(api, options?)` — a typed client for an `Endpoint.fromApi`, wrapping Effect's `HttpApiClient.make` with `FetchHttpClient` provided (pass `event.fetch` in a `load` for SSR fetch). Add `readConfig(env, config)` — read a typed Effect `Config` from a SvelteKit `$env` record in one call. Promotes the two remaining #51 items from cookbook recipes to real APIs.
- 633acb7: Add Effect-native SvelteKit control-flow error catalogue and default translator (#42).

  **New exports from `@thomasfosterau/effect-sveltekit/server`:**
  - `SvelteKit.redirect(status, location)` — yield a typed redirect failure instead of throwing
  - `SvelteKit.error(status, body?)` — yield a typed HTTP error failure
  - `SvelteKit.fail(status, data)` — yield a typed form-action failure
  - `SvelteKit.translate` — the turnkey `ErrorTranslator` that maps the above to `redirect()` / `error()` / `fail()` at the request boundary
  - `SvelteKit.makeTranslator([...cases])` — compose `translate` with your own domain-error matchers (consumer cases run first)
  - `KitRedirect`, `KitError`, `KitActionFailure` — the exported tagged error classes (use with `Effect.catchTag`, `instanceof`, etc.)
  - `KitTranslatorCase`, `KitErrorTranslator` — companion types

  **Breaking (minor):** `SvelteKit.translate` is now the default `translateError` for `makeRuntimeAdapter`, `makeServerRuntime`, and `RemoteFunction.withRuntime`. The previous default was the "passthrough" translator (`causeToThrowable`) which converted any non-SvelteKit error to an `EffectCauseError`. The new default adds handling for `KitRedirect` / `KitError` / `KitActionFailure` before falling back to the same passthrough. Existing code that does not produce these new error types is unaffected.

- dd61634: Add a `Forms` bridge for native form actions (`@thomasfosterau/effect-sveltekit/client`): `Forms.enhance({ onSubmit, onResult })` builds an Effect-based `use:enhance` `SubmitFunction`, and `Forms.applyAction` / `Forms.deserialize` wrap `$app/forms`. Also adds a cookbook covering the typed `HttpApiClient` ↔ `Endpoint.fromApi` loop and build-time-vs-runtime `$env` config guidance (#51).
- 419cae7: Add automatic per-request spans to all server handler wrappers (#46).

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

- 093582d: Add a realtime bridge between Effect `Stream`s and SSE / WebSocket. Server: `Endpoint.fromStream(stream, { event, id, retry, heartbeat })` serves a `Stream` as a `text/event-stream` response. Client: the `Realtime` namespace adds `fromEventSource(url)` and `fromWebSocket(url)`, each consuming a source as an Effect `Stream` (#44).
- a2f83e4: Add schema-driven request parsing helpers (`decodeParams`, `decodeSearchParams`, `decodeJson`, `decodeFormData`) and `ParseError` (#45-A).
- 8af81f5: Add `SvelteKitCookies`, `SvelteKitResponseHeaders`, and `SvelteKitLocals` as tagged Effect services (#47).

  All three are provided automatically as part of `SvelteKitServices` in every server handler effect — no extra setup required. Each can be replaced with a `Layer.succeed` stub in unit tests without needing a real `RequestEvent`.
  - `yield* SvelteKitCookies` — Effect-wrapped cookies API (`get`, `getAll`, `set`, `delete`, `serialize`)
  - `yield* SvelteKitResponseHeaders` — Effect-wrapped `event.setHeaders` (`set`)
  - `yield* SvelteKitLocals` — the live `App.Locals` reference for the current request
  - `requestServicesLayer` — merges all three `.layer` statics; exported for custom runtime setups

- 136e188: Add `defer` helper for SvelteKit streamed (deferred-promise) load data (#45-B).
- 4721253: feat(sveltekit): add `/testing` subpath with framework-agnostic test utilities (#43)

  Adds `@thomasfosterau/effect-sveltekit/testing` — a new subpath export with
  plain-async helpers for unit-testing Effect-based SvelteKit handlers without
  mocking `$app/server` or the SvelteKit module graph.

  ## New exports

  ### `TestRequestEvent(opts?)`

  Creates a minimal `RequestEvent` for use in tests. Cookies are backed by an
  in-memory `Map`; all fields are optional with sensible defaults:

  ```ts
  const event = TestRequestEvent({
    url: "http://localhost/items/42",
    params: { id: "42" },
    locals: { user },
    cookies: { session: "tok_test" },
    method: "POST",
    headers: { "content-type": "application/json" },
    fetch: myMockFetch,
  });
  ```

  ### `runServerLoad(fn, event, opts?)`

  Run an Effect-based server `load` function under test, providing services via
  `opts.layer`. Error translation defaults to `SvelteKit.translate`.

  ```ts
  const data = await runServerLoad(
    (event) =>
      Effect.gen(function* () {
        const db = yield* Database;
        return { items: yield* db.list() };
      }),
    event,
    { layer: TestDatabase.layer },
  );
  ```

  ### `runAction(fn, event, opts?)`

  Run an Effect-based form action handler.

  ### `runEndpoint(fn, event, opts?)`

  Run an Effect-based `+server.ts` endpoint handler, returning the `Response`.

  ### `runRemote(event, opts?)`

  Build a `{ run, runForm }` pair for directly invoking remote-function Effect
  handlers without going through `$app/server.getRequestEvent()`:

  ```ts
  const { run } = runRemote(event, { layer: TestDatabase.layer });
  const items = await run(listItemsEffect());
  ```

  ## Exported types

  `TestRequestEventOptions`, `TestRunOptions<R>`, `RunRemoteOptions<R>`,
  `RunHelpers`, `FormErrorMapper`.

### Patch Changes

- Updated dependencies [1e07c24]
- Updated dependencies [afb28d7]
- Updated dependencies [0e2f004]
  - @thomasfosterau/effect-svelte@0.2.0

## 0.1.1

### Patch Changes

- 3fba291: Widen route-param generics so partial (layout) params annotate cleanly.

  The server/universal wrappers (`serverLoad`, `action`, `actions`, `endpoint`,
  the universal `load`, and the `RuntimeAdapter` / `ServerRuntime` /
  `UniversalRuntime` equivalents) hardcoded `Params extends Record<string, string>
= any`. That was both more restrictive than SvelteKit's own handler types — whose
  base param constraint is the generated `LayoutParams<'/'>`, a partial record for a
  root `+layout` (e.g. `{ type?: string; id?: string }`) — and defaulted `Params`
  to `any`, dropping param typing. As a result a partial-param root
  `+layout.server.ts` could not be given an explicit `: LayoutServerLoad`
  annotation, and consumers kept a local type-shim.

  The wrappers now mirror SvelteKit's base param constraint, so they accept exactly
  what SvelteKit accepts: a root-layout `: LayoutServerLoad` annotation type-checks,
  and concrete-param routes (`[id]`) still infer precisely.

  This is type-only and backward compatible; runtime behaviour is unchanged.

- 7f31765: Allow remote-function validators to accept schemas with optional fields.

  `form` (and the validated `query`, `query.batch`, `query.live`, `command`, and
  `prerender` helpers) no longer constrain a schema's encoded/input type to
  `extend RemoteFormInput`. An optional Effect-Schema field encodes to
  `T | undefined`, which is not assignable to `RemoteFormInput`'s index
  signature, so the previous constraint rejected most real forms (e.g. an
  optional `redirectTo` text input). The form helpers now accept any schema and
  intersect its encoded/input type with `RemoteFormInput` in the produced
  `RemoteForm`, so SvelteKit still sees a form-input-shaped input while optional
  fields are allowed. The handler's `data` remains the precise decoded type.

  This is type-only and backward compatible; runtime behaviour is unchanged.

## 0.1.0

### Minor Changes

- c15519f: Initial release of `@thomasfosterau/effect-sveltekit` — an Effect v4-native
  integration for SvelteKit. Depends on `@thomasfosterau/effect-svelte`.
  - Write `load`, `actions`, `endpoint`, and the SvelteKit hooks (the `Hooks`
    namespace: `handle`, `handleFetch`, `handleError`, `init`, `reroute`) as
    Effects — via explicit wrappers, app-wide runtimes (`makeServerRuntime` /
    `makeUniversalRuntime`, services built once per process), or the `effectKit()`
    Vite plugin that auto-wraps bare-Effect route exports.
  - Remote functions: define them as Effects with `RemoteFunction.query` /
    `.form` / `.command` / `.prerender` / `query.live` (server), and consume them
    via the `Remote` namespace (`Remote.callQuery`, `Remote.callCommand`,
    `Remote.submitForm`, `Remote.liveQueryStream`, …). `useRemoteQuery` bridges a
    reactive remote resource to an `AsyncResult`.
  - Client-side `$app/navigation` / `$app/state` interop, exposed as Effect-style
    namespaces from `@thomasfosterau/effect-sveltekit/client`: `Navigation`
    (`goto`, `invalidate`, `preloadData`, … plus `beforeNavigate` /
    `afterNavigate` / `onNavigate` as Effect `Stream`s / effects) and `State`
    (`page` as a `Stream` of page snapshots).
  - `Hooks.transport` ⇄ Effect Schema: move custom types (`Option`, `DateTime`,
    branded types, `Schema.Class` instances, tagged errors) across the
    server/client boundary.
  - `$env` ⇄ Effect `Config` (`sveltekitConfig`).
  - An Effect HTTP deployment adapter (`effect/unstable/http` +
    `@effect/platform-node`) with `Config`-based configuration, request tracing
    spans, and graceful shutdown.

- 578fc9a: `Endpoint.fromApi` / `Endpoint.fromRouter` now accept a per-request `context`
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

- fd4db18: Add an `Endpoint` server namespace for creating SvelteKit `+server.ts` endpoints
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

- 8ef700a: Group the SvelteKit hook helpers into a `Hooks` namespace, one per hook file,
  and complete the set so every hook can be written as an Effect:
  - `@thomasfosterau/effect-sveltekit` → `Hooks.reroute`, `Hooks.transport`,
    `Hooks.transporter` (universal `hooks.ts`).
  - `@thomasfosterau/effect-sveltekit/server` → `Hooks.handle`,
    `Hooks.handleFetch`, `Hooks.handleError`, `Hooks.init` (`hooks.server.ts`).
  - `@thomasfosterau/effect-sveltekit/client` → `Hooks.handleError`, `Hooks.init`
    (`hooks.client.ts`).

  `handleFetch`, `handleError`, and `init` are new (previously only the
  `effectKit()` auto-wrap path covered them); the matching `ServerRuntime`
  methods (`handleFetch`/`handleError`/`init`) make them available with an
  app-wide layer's services.

  The previously flat `handle`, `reroute`, `transport`, and `transporter` exports
  now live under `Hooks` (e.g. `Hooks.handle`, `Hooks.transport`).

- a08d481: `ServerRuntime` now creates a per-request runtime in its `handle` hook and shares
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

- c89d507: The deployment adapter now produces a platform-neutral Effect `HttpApp` with
  pluggable asset serving, so the same SvelteKit app can run on a Node HTTP server
  or as a Cloudflare Workers `fetch` handler.
  - `makeHandlerWith(options)` is the platform-neutral SSR core: it takes an
    injected `AssetSource` (where static assets come from) and a `read` capability
    (how to read server assets), instead of reading the file system directly.
    `makeHandler` is unchanged — it's now `makeHandlerWith` wired to
    `AssetSource.fileSystem` and a FileSystem-backed `read` (the Node default).
  - `AssetSource` ships several sources as equals: `AssetSource.fileSystem(...)`
    (Node, requires `FileSystem` / `Path` / `HttpPlatform`),
    `AssetSource.cloudflareAssets(env.ASSETS)` (Workers, requires nothing), or any
    custom `AssetSource` (R2, KV, a CDN passthrough). A source returns
    `Option.none()` for non-assets so the SSR core continues to render.
  - `toWebHandler(app, layer)` converts a SvelteKit `HttpApp` to a Web `fetch`
    handler (via `HttpEffect.toWebHandlerLayer`), for a Workers `fetch` export or
    any Web-platform runtime.
  - `effectAdapter({ target: "fetch" })` emits a Cloudflare Workers entry
    (`build/index.js` exporting `default { fetch }`) that serves assets from the
    `ASSETS` binding; `target: "node"` (default) keeps the Node server entry. Both
    targets still write `build/handler.js` (the `HttpApp`). The `fetch` target
    reports `read()` from `$app/server` as unsupported.

  Backward compatible: `makeHandler`, the Node `serve`, and the default adapter
  behaviour are unchanged.

- 30ff246: Add a general, Effect-idiomatic seam for _how the per-request execution context
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

### Patch Changes

- 2e84885: `RemoteFunction.*` (`query` / `query.batch` / `query.live` / `form` / `command`
  / `prerender`) now accept a bare Effect `Schema` as the validator argument: it is
  detected and wrapped with `Schema.toStandardSchemaV1` automatically, so you no
  longer have to pre-wrap it. Passing a Standard Schema or `"unchecked"` is
  unchanged.
- 0cc72db: Two opt-in extensions to the remote/transport surface:
  - `Hooks.markerTransporter({ guard, make })` builds a deliberately-lossy
    `transport` entry for a non-POJO wrapper whose contents should not round-trip:
    `encode` emits a truthy marker for matching values, `decode` reconstructs a
    fresh value. `Hooks.transport` now accepts either an Effect `Schema.Codec` or a
    ready `Transporter`, so round-tripping and marker-style entries can be mixed.
  - `RemoteFunction.withRuntime(provider, { formError })` adds a form-error interop
    hook: a remote form's failure path can map a structured/nested error shape into
    SvelteKit's field issues (via the `issue` helper / `invalid()`) for field-level
    invalidation, instead of falling back to `translateError`.

- Updated dependencies [c15519f]
  - @thomasfosterau/effect-svelte@0.1.0
