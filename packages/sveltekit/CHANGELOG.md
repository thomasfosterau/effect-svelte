# @thomasfosterau/effect-sveltekit

## 0.8.0

### Minor Changes

- 344a860: The root entry now also exports the members of its `Hooks` and `Remote` namespaces by name: `reroute`, `transport`, `transporter`, `markerTransporter` and `responseHeadersTransporter` (with the `MarkerTransporterOptions` and `TransportEntry` types), and `callQuery`, `callCommand`, `callCommandWithUpdates`, `callPrerender`, `submitForm`, `submitFormWithUpdates` and `liveQueryStream` (with the `RemoteSubmit` type). The namespaces are unchanged.

  Prefer the named imports in a universal `src/hooks.ts`. The published build turns each namespace into a single object, so `Hooks.transport({ ResponseHeaders: Hooks.responseHeadersTransporter })` also kept `Hooks.reroute` and the default universal runtime (with Effect's `HttpClient`, `Stream` and `ManagedRuntime`) in the client bundle. `import { transport, responseHeadersTransporter }` keeps only `response-headers.js` and `transport.js`. The README recipes now use the named imports.

## 0.7.0

### Minor Changes

- b5fd599: Tighten the public API to the Effect lint preset (#185). Breaking changes:

  **effect-svelte**

  - `getRuntime()` and `RuntimeContext.get()` throw the new exported `RuntimeNotFoundError` (a `Schema.TaggedError`, `_tag: "RuntimeNotFoundError"`, same `message`) instead of a plain `Error`.
  - `useScope()` returns the new exported `ScopeRef` interface (`{ readonly current: Scope.Closeable | null }`).

  **effect-sveltekit**

  - The public error classes are now `Schema.TaggedError`s: `NavigationError`, `ApplyActionError`, `EventSourceError`, `WebSocketError`, `UpdateCheckError` and `ParseError`. Their `_tag`s, fields and constructors are unchanged; each now carries a schema (`cause` fields are `Schema.Defect()`), and constructing one validates its fields (`NavigationError`'s `operation` must be one of the listed operations).
  - The `RemoteFunction` factories throw the new exported `RemoteFunctionUsageError` (same messages) instead of a plain `Error` when called with a schema but no handler, or when the installed SvelteKit lacks `query.live`.
  - `QueryLiveFn` (and so `RemoteFunction.query.live` / `queryLive`) now returns SvelteKit's `RemoteLiveQueryFunction` instead of `RemoteQueryFunction`. The new type is what kit 3's `query.live` actually returns; the old one was wrong.
  - `KitError.body` and `SvelteKit.error(status, body)` take the new exported `KitErrorBody`: a message string, or your app's `App.Error` with `status` optional (the body SvelteKit's own `error()` accepts) instead of any `Record<string, unknown>`. Declare extra fields on `App.Error` in `src/app.d.ts`.
  - `KitActionFailure<T>`'s type parameter is unconstrained and defaults to `undefined`, as SvelteKit's `fail()`.
  - `Errors.AnyTagged` is removed. `Errors.toSvelteKit` without a type argument now types its callbacks' error as `Tagged` (only `_tag`); pass your error union (`Errors.toSvelteKit<AppError>(…)`) to read its fields.
  - `State`'s `CurrentPageShape` is renamed `CurrentPageService`, and `ReadonlyPage.data` is `App.PageData`.
  - `useRemoteQuery` returns the new exported `RemoteQueryResult<T>` interface.
  - `Remote.RemoteSubmit` and `Remote.submitForm` take SvelteKit 3's `submit()`, which resolves with a `boolean`.
  - `TestRequestEvent`'s `locals` option is typed `App.Locals` and `platform` `App.Platform`.
  - The adapter: `AssetSource.fileSystem` / `makeHandler`'s `prerendered` option accepts any `Iterable<string>` (the build's `Set` still works). A rejected SvelteKit `server.init` / `server.respond` or Cloudflare assets `fetch` is still a defect, now wrapping the rejection in the exported `SvelteKitServerError` / `AssetFetchError` (the original value is its `cause`).
  - `Endpoint.fromStream`'s default `data:` encoder is Effect's JSON schema encoder; an element JSON cannot represent (such as a `bigint`) ends the stream with a defect.
  - The endpoint error log (`Endpoint error: …`) is written through Effect's `Console` service; with the default `Console`, the output is unchanged.

  The `effect-sveltekit` README now says why it lists `effect-svelte` as a dependency, and that an app importing `effect-svelte` itself must list it too (#186).

### Patch Changes

- b0c3462: Declare `"sideEffects": false`, so a bundler drops the modules a consumer's imports do not reach. A universal `src/hooks.ts` that imports only `ResponseHeaders` from `@thomasfosterau/effect-sveltekit` now adds `response-headers.js` and `transport.js` to the client entry instead of the whole root entry (the default runtime, `HttpClient`, `Stream` and the remote-function helpers). Every published module only declares at load; a test in each package guards both that and the tree-shaking. Reaching a member through a namespace export (`Hooks.responseHeadersTransporter`, `Remote.*`, …) still keeps every module that namespace reaches; #191 tracks that.
- 8a739b2: Internal cleanup from adopting the Effect lint preset, with no change to the public API:

  - `dist/` imports Effect modules by path (`effect/Effect`, `effect/Layer`, …) instead of from the `effect` barrel.
  - Type assertions that remain carry a documented invariant, and loops, `typeof` checks and `try` / `catch` blocks are rewritten with `effect/Array`, `effect/Record`, `effect/Predicate` and `Result`, preserving behaviour.
  - `effect-sveltekit`: query-string and form-data objects built by the request parsers now keep a `__proto__` key as an own property rather than dropping it; `causeToThrowable`'s return type is narrowed to `Redirect | HttpError | EffectCauseError`.
  - Package `homepage` links point at the `trunk` branch.

- Updated dependencies [b5fd599]
- Updated dependencies [b0c3462]
- Updated dependencies [8a739b2]
  - @thomasfosterau/effect-svelte@0.6.0

## 0.6.0

### Minor Changes

- 9911190: `State` (in `./client`) now bridges all of `$app/state`, not just `page`. `State.navigating()` streams the in-flight navigation as an `Option<NavigatingSnapshot>` (`None` when idle), `State.updated()` streams `updated.current`, and `State.checkForUpdate()` runs `updated.check()` as an Effect that fails with the new `UpdateCheckError` if the check rejects. `State.CurrentPage` is a `Context` service that lets any client Effect read the current page (`get`) or follow it (`changes`, which also emits on shallow routing and form results); provide it with `State.CurrentPage.layer`. These watch `$app/state` through a root `$effect`, so unlike `State.page()` they can be called anywhere on the client, not only during component initialization. `PageSnapshot` (and so every `State.page()` emission) now also carries SvelteKit 3's `shallow` field.
- 49776fa: The `effect` peer range is now `>=4.0.2` (was `>=4.0.0-rc.118`), and `effect-sveltekit`'s optional `@effect/platform-node` peer is `>=4.0.2` too. 4.0.2 is the release both packages are built and tested against, so the published floor is now a tested version. If your app is on an `effect` 4.0 release candidate, 4.0.0 or 4.0.1, upgrade `effect` (and every `@effect/*` package, which must stay on the same version as `effect`) to 4.0.2 or later; the install commands in the READMEs no longer use the `rc` dist-tag, which still points at `4.0.0-rc.118`.
- e4293d9: `Forms.enhance` (in `./client`) calls `onSubmit`, `onResult` and `onError` as methods of the handlers object, so `this` in a handler written as a method is that object. 0.5.0 did so for `onSubmit` only (it called `onResult` detached and had no `onError`).
- ee167fb: `Forms.enhance` (in `./client`) now accepts `onSubmit` / `onResult` handlers that fail, and a new `onError` handler beside them: `Forms.enhance({ onSubmit, onResult, onError }, { runtime })`. `onError` receives the error a handler failed with, typed as the union of the handlers' error types, and runs on the same runtime as the handlers (it must not fail itself). Write it after the other handlers: written before one whose parameters are not annotated (such as `onResult: ({ result }) => ...`), it still type-checks, but its `error` parameter is `unknown`; an annotated `onError` must accept every error the handlers fail with, in either order. A failed `onSubmit` also cancels the submission, and a failed `onResult` does not fall back to SvelteKit's default behaviour. Without `onError`, a failure rejects the promise SvelteKit awaits with the error itself, as a defect does (and as `Effect.orDie` did), and defects and interruptions still take that path even when `onError` is given. So `onResult: ({ result }) => Forms.applyAction(result)` type-checks, its `ApplyActionError` going to `onError` when one is given. `EnhanceHandlers` gains `ESubmit` / `EResult` type parameters (defaulting to `never`, so handlers that cannot fail behave as before) and an `E` parameter for `onError`'s error (defaulting to their union).
- c4da963: `Forms.enhance` (in `./client`) now requires its `{ runtime }` option, typed to provide every service the handlers require, whenever `onSubmit`, `onResult` or `onError` requires a service. Before, such a call type-checked without a runtime and the handler died with a missing-service defect when it ran; it is now a type error. This is a type-only change: calls whose handlers require no services keep the options optional, calls that already pass a runtime providing those services are unchanged, and the code it rejects is code that dies with a missing-service defect once a handler reaches the service it requires (or that passes an options object whose type leaves `runtime` optional). `onSubmit` and `onResult` (and `runtime`) are now declared `?: … | undefined`, so a handler or runtime forwarded as `undefined` (for example by spreading `{ onResult: undefined }`) type-checks under `exactOptionalPropertyTypes`. Each handler's requirements are inferred separately, so handlers that require different services (say `onSubmit` one service and `onResult` or `onError` another) type-check with a runtime that provides all of them, and a runtime missing any of them is still rejected. A missing runtime is reported on the `Forms.enhance` call, and a runtime that lacks a service on the runtime, never on a handler (even when an `onError` passed by name requires a service and another handler's parameters are not annotated). A function that wraps `Forms.enhance` for a generic `R` forwards its options as `...options: EnhanceOptionsArgs<R>` (newly exported from `./client`), or takes a required `{ runtime: EnhanceRuntime<R> }`; forwarding an `EnhanceOptions<R>`, whose `runtime` is optional, no longer type-checks. An effect typed as requiring `any` or `unknown` is treated as requiring no services, so no runtime is demanded: such a type names no service a runtime could be checked against, so a handler (or `onError`) annotated, say, `Effect.Effect<void, never, any>` still type-checks without a runtime.
- b2ed330: `Navigation.goto`, `Navigation.invalidate`, `Navigation.invalidateAll`, `Navigation.refreshAll`, `Navigation.preloadData`, `Navigation.preloadCode` and `Forms.applyAction` (in `./client`) now fail on the Effect error channel when SvelteKit rejects or throws, instead of dying with a defect. The `Navigation` wrappers fail with the new `Navigation.NavigationError` (`operation` names the wrapper, `cause` is SvelteKit's original reason) and `Forms.applyAction` with the new `Forms.ApplyActionError` (`cause`). SvelteKit 3 rejects, for example, `goto` to a URL outside the app (external, or matching no route), `preloadData` for an `href` outside the app, and a navigation whose `beforeNavigate` / `onNavigate` callback throws, and each of these functions throws when called during server rendering. Their types change from `Effect<void>` to `Effect<void, NavigationError>` / `Effect<void, ApplyActionError>` (`preloadData` keeps its success type). Code that recovered from these failures with `Effect.catchCause` / `Effect.catchDefect` should now handle them as failures, for example with `Effect.catchTag("NavigationError", ...)`. An `onResult` that returns `Forms.applyAction(result)` still type-checks, since `Forms.enhance`'s handlers may now fail (see its new `onError` handler).
- a9e4263: `Realtime.fromEventSource` and `Realtime.fromWebSocket` now fail with `EventSourceError` / `WebSocketError` when the `EventSource` / `WebSocket` constructor throws (for example a `SyntaxError` for an invalid URL, or for an invalid `WebSocket` protocol list). Both errors gain an optional `cause` field holding the thrown value. Previously the throw was lost: on `effect` 4.0.1 and earlier the stream hung without emitting, ending or failing, and on 4.0.2 it died with a defect. Nothing is left to close when construction fails.
- 6fdd74b: `Remote.callQuery`, `Remote.callCommand`, `Remote.callCommandWithUpdates`, `Remote.callPrerender`, `Remote.submitForm` and `Remote.submitFormWithUpdates` now fail on the Effect error channel when the remote call rejects (or the remote function throws synchronously), with the original rejection reason (`unknown`; on the client a server-side `error()` arrives as SvelteKit's `HttpError`, while a `redirect()` from a query, prerender or form still navigates rather than failing). Previously the rejection became a defect despite the declared `unknown` error type, so `Effect.catch` never saw it. Code that recovered from a rejected remote call with `Effect.catchCause` / `Effect.catchDefect` should now handle it as a failure (for example with `Effect.catch`); the SvelteKit boundaries in this package still rethrow a `Redirect` / `HttpError` whether it arrives as a failure or a defect.

### Patch Changes

- 7417b5a: The README no longer labels the `effectKit()` Vite plugin "(recommended)". It now presents the explicit wrappers (`serverLoad`, `actions`, `endpoint`, the app-wide runtime's methods) first and the plugin afterwards as an optional convenience, and notes that SvelteKit's generated `$types` cannot see through the plugin's rewrite. The plugin itself is unchanged and stays supported.
- 116475b: `State`'s TSDoc now spells out the server-side edge cases: consuming a watched stream (`navigating`, `updated`, `CurrentPage.changes`) during server rendering hangs rather than failing, and `CurrentPage.get` dies with a defect on the server outside synchronous component rendering.
- 497421f: Fix the `Stream.callback` helpers written against Effect v3's cleanup contract. Effect v4's `Stream.callback` runs the Effect its callback returns as the stream's setup, so the cleanup now goes in a finalizer on the stream's scope:

  - `Store.toStream` no longer unsubscribes from the store as soon as the stream starts; it delivers every later update and unsubscribes when the stream ends or is interrupted.
  - `SignalEmitter` no longer drops every `emit()` after the stream starts; `emit()` feeds the running stream and disconnects when it ends or is interrupted.
  - `Realtime.fromEventSource` and `Realtime.fromWebSocket` now close the `EventSource` / `WebSocket` when the stream ends or is interrupted, instead of leaving it open.

- Updated dependencies [061dac3]
- Updated dependencies [49776fa]
- Updated dependencies [d2bf610]
- Updated dependencies [8178da4]
- Updated dependencies [08213ef]
- Updated dependencies [497421f]
- Updated dependencies [6a1a634]
- Updated dependencies [b563378]
  - @thomasfosterau/effect-svelte@0.5.0

## 0.5.0

### Minor Changes

- 0527a63: **Breaking:** require SvelteKit 3. The `@sveltejs/kit` peer range moves from `^2.0.0 || ^3.0.0-next.0` to `^3.0.0`, so apps on SvelteKit 2 or a `3.0.0-next` prerelease must upgrade `@sveltejs/kit` first (Kit 3 itself needs Node 22.17, Vite 8, `@sveltejs/vite-plugin-svelte` 7 and Svelte 5.57.1). The published types now import SvelteKit's types from their Kit 3 homes (`@sveltejs/kit/hooks`, `$app/server`, `$app/navigation`, `$app/state`, `$app/forms`).

  - Adapter: the generated `build/server.js` exports the SvelteKit `server` instance (from `builder.generateServerInstance`), and `build/manifest.js` now exports `prerendered`, `base` and `appPath` instead of the SSR manifest. `makeHandler` / `makeHandlerWith` (`./adapter/handler`) take that `server` instead of the `Server` class and `manifest`, and `makeHandler` takes `appPath`. Configure the adapter in `vite.config.ts` (`sveltekit({ adapter: adapter() })`); Kit 3 no longer reads `svelte.config.js`.
  - `Navigation.preloadCode` takes a route ID (e.g. `/blog/[slug]`), as Kit 3's `preloadCode` does. `Navigation.invalidateAll` is deprecated in favour of `Navigation.refreshAll`, following Kit 3.
  - `Hooks.handleError` (server and client) passes Kit 3's `handleError` input through unchanged: it carries `kind` (`"app"`, `"framework"`, `"unknown"`, or `"validation"` on the server) and no longer `status` / `message`.
  - Docs: examples import app modules through `#lib/…` (Kit 3 replaced the `$lib` alias), including the `effectKit({ serverRuntime })` specifier.

### Patch Changes

- f0474d8: `SvelteKit.translate` and `Errors.toSvelteKit` no longer call SvelteKit 3's deprecated `error(status, body)` overload, so they stop triggering Kit's `error_body_deprecated` warning in development. An object body (a `KitError` body, or an `App.Error` returned by a catalogue entry's `message`) is now passed as `error(status, message, properties)`; the resulting `HttpError` is unchanged for every body that fits `App.Error` (a non-string `message` field now yields Kit's default `Error: <status>` message).
- 4d2b3be: Raise `engines.node` from `^20.19.0 || >=22.12.0` to `>=22.17`, matching SvelteKit 3's own requirement.

  Docs: the adapter section of the README notes that the optional `@effect/platform-node` peer pulls in `undici`, which needs Node `>=22.19`.

- Updated dependencies [4d2b3be]
  - @thomasfosterau/effect-svelte@0.4.2

## 0.4.1

### Patch Changes

- d8b1fc7: Docs: every exported option and return type now has a TSDoc summary, the `Remote.call*` / `submitForm*` helpers and the standalone remote-function exports (`query`, `form`, `command`, `prerender`, `requested`, `RemoteFunction`) are documented, including that a rejected remote call surfaces as a defect (#101), and the `effect-svelte` module header describes the package.
- 3ad9c87: Tested against effect 4.0.0 (and `@effect/platform-node` 4.0.0); peer floor unchanged at `>=4.0.0-rc.118`. README: the version guidance now says to keep `effect` and its companions on the same exact version rather than the same `4.0.0-rc.x` one.
- 52734ab: Docs: the package README is now the full API reference (moved from the monorepo README), including every published entry point (`./testing`, `./adapter/handler`, `./adapter/serve`) and the hooks the summary had left out.
- Updated dependencies [d8b1fc7]
- Updated dependencies [3ad9c87]
- Updated dependencies [52734ab]
  - @thomasfosterau/effect-svelte@0.4.1

## 0.4.0

### Minor Changes

- 7a385e3: **Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/platform-node@>=4.0.0-rc.118` for `@thomasfosterau/effect-sveltekit`). The peer ranges move from `^4.0.0-beta.75`, so consumers on any beta, or on rc.112 through rc.117, fall outside the range and must upgrade `effect` and every `@effect/*` package together.

  The published code now imports `effect/<module>` instead of the removed `effect/unstable/<module>` paths (`effect/http/*`, `effect/http-api/*`, `effect/reactivity/*`), so the built `dist` cannot load against an earlier `effect`. The public `.d.ts` of `apiClient` / `fromApi` changes: `Groups` is now constrained by `HttpApiGroup.Constraint` (was `HttpApiGroup.Any`) and `HttpApi` is invariant in `Groups`.

- 2dea5b4: Add `Errors.toSvelteKit(catalogue)` (on `./server`): build a `translateError` from a tag-keyed error catalogue — a status, `{ status, message }`, `"status"`, `"redirect"` or a function per tag, with `SvelteKit.translate` (or `Errors.rethrowSquashed`) as the fallback. Add `ResponseHeaders`, a response-headers buffer that can be returned from `load`, with `Hooks.responseHeadersTransporter` as its `transport` entry and `appendTo` to copy it onto the response.
- bbd3b69: Build on the shared library toolchain: Vite+ 0.3.0 (vitest 4.1.11), the TypeScript 6/7 alias split (declarations are now emitted by the TypeScript 6 compiler instead of `@typescript/native-preview`), a strict pnpm catalog (peer ranges are unchanged, now published from `catalog:peers`), and Changesets CLI v3. No API changes.

### Patch Changes

- ba6e2e3: Document behaviour inherited from Effect rc.118. `ConfigProvider.fromEnv` treats an empty string as a missing value, so `sveltekitConfigProvider`, `sveltekitConfig`, `readConfig` and the adapter's `*_ORIGIN`, `*_XFF_DEPTH`, `*_HOST` and `*_PORT` variables now fail (`Config.String`), take their `withDefault` (including `Config.Int`, which used to fail) or become `None` (`Config.option`) on `""`; tests now pin this. The Atom runtime memo map is now per registry, so layers are no longer shared across separate atom registries. The install docs now say `effect@rc` and `@effect/platform-node@rc`, and a `Stream.scan` JSDoc example uses the lazy seed.
- Updated dependencies [7a385e3]
- Updated dependencies [ba6e2e3]
- Updated dependencies [6df0358]
- Updated dependencies [bbd3b69]
  - @thomasfosterau/effect-svelte@0.4.0

## 0.3.1

### Patch Changes

- 6e764f2: Fix SvelteKit v3 remote-functions validation rejecting the built package.

  SvelteKit `3.0.0-next.11` broadened its remote-module matcher from
  `endsWith(".remote" + ext)` to the regex `/[/.]remote(\.[^/]+)+$/`
  (`@sveltejs/kit` `src/exports/vite/utils.js`). That regex matches
  `dist/remote.server.js`, so kit began treating this package's internal
  remote-function **factory** module as a consumer remote module and validated,
  at build/import time, that every export is a remote function — failing every
  production build during the postbuild `analyse` phase with:

  ```
  `RemoteFunction` exported from .../dist/remote.server.js is invalid —
  all exports from this file must be remote functions
  ```

  The module exports factories/types (`RemoteFunction`, `withRuntime`, `query`,
  `form`, …), not remote functions, so it must never carry a name kit classifies
  as a remote module. It is renamed `remote.server.ts` → `remote-functions.ts`
  (built to `dist/remote-functions.js`), which no longer matches the matcher. The
  public API is unchanged: `RemoteFunction` is still exported from
  `@thomasfosterau/effect-sveltekit/server`, and no package export subpath
  changes. A regression test guards against any published module being named such
  that kit would treat it as a remote module.

## 0.3.0

### Minor Changes

- 5bc862d: Widen the `@sveltejs/kit` peer dependency range to `^2.0.0 || ^3.0.0-next.0`, allowing installation against the SvelteKit v3.0.0 prereleases published under the `next` tag (and eventual v3 stable) in addition to v2.

## 0.2.1

### Patch Changes

- Updated dependencies [16c5a17]
  - @thomasfosterau/effect-svelte@0.3.0

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
