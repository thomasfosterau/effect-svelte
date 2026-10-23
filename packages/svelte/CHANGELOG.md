# @thomasfosterau/effect-svelte

## 0.6.0

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

## 0.5.0

### Minor Changes

- 49776fa: The `effect` peer range is now `>=4.0.2` (was `>=4.0.0-rc.118`), and `effect-sveltekit`'s optional `@effect/platform-node` peer is `>=4.0.2` too. 4.0.2 is the release both packages are built and tested against, so the published floor is now a tested version. If your app is on an `effect` 4.0 release candidate, 4.0.0 or 4.0.1, upgrade `effect` (and every `@effect/*` package, which must stay on the same version as `effect`) to 4.0.2 or later; the install commands in the READMEs no longer use the `rc` dist-tag, which still points at `4.0.0-rc.118`.
- 08213ef: `SignalEmitter` now buffers and multicasts, backed by a `PubSub`. Values emitted while no run of `emitter.stream` is connected are buffered and delivered first to the next run that connects, so the initial `emit` from a `$effect` (which usually runs before `useStream`'s run has connected) is no longer lost. Every run connected at once receives every value emitted while it is connected, where previously only the most recently started run did. By default the buffer keeps only the latest value, since the emitter bridges state; the new `SignalEmitterOptions` (`new SignalEmitter({ bufferSize })`) keeps more, and `bufferSize: 0` restores the old behaviour of dropping values emitted while no run is connected. `bufferSize` is rounded down to an integer (a negative size counts as `0`), and a non-finite one makes the constructor throw a `RangeError`. It limits only the buffer kept while no run is connected: a connected run that falls behind queues values without bound. Buffered values go only to the run that takes them: a run that connects while another is already connected starts with the next emitted value.
- b563378: Rename the keyed-`Reactivity` hooks to follow the package's `useX` hook naming: `reactiveQuery` is now `useReactiveQuery`, `reactiveStream` is now `useReactiveStream` and `reactiveMutation` is now `useReactiveMutation`. Their signatures and behaviour are unchanged. The old names stay exported as `@deprecated` aliases of the same functions for this minor release and will be removed in the next one, so replace `reactiveQuery(` with `useReactiveQuery(` (and likewise for the other two) when you upgrade. Their option and handle types are renamed to match: `ReactiveOptions` is now `UseReactiveOptions`, and `ReactiveQueryReturn`, `ReactiveStreamReturn` and `ReactiveMutationReturn` are now `UseReactiveQueryReturn`, `UseReactiveStreamReturn` and `UseReactiveMutationReturn`. `useDerived`'s handle type `DerivedReturn` is renamed to `UseDerivedReturn` to match the other hooks' `UseXReturn` types. The old type names stay exported as `@deprecated` type aliases for the same release. `useReactiveMutation`'s TSDoc now documents its error channel, and that it invalidates its keys only when the mutation succeeds. The README describes the naming rule: every hook is `useX`, option and handle types are named after their hook or hook family (`UseXOptions`, `UseXReturn`; the `useReactive*` and atom hooks share their family's types), and the `useReactive*` hooks are the ones that take `Reactivity` keys.

### Patch Changes

- 061dac3: `useDerived` and `useReactiveQuery` now track only the reactive state their thunks read (`useDerived`'s `fn`, `useReactiveQuery`'s `keys` and `effectFn`), matching `useEffect(effect, { immediate: true })`. The Effect is started untracked, so state it reads while running no longer restarts it, even when that read happens synchronously (inside `Effect.sync`, or an `Effect.gen` before its first async step). Previously such a read became a dependency only when it happened before the Effect's first async boundary, so whether a change restarted the run depended on timing. If a run should restart when some state changes, read that state in the thunk, as in `useDerived(() => search(query))`.
- d2bf610: `useReactiveMutation`'s `run()` and `useMutation`'s `mutate()` now run untracked, so calling them from an `$effect` no longer makes that effect depend on the state the mutation reads. Previously the caller's `$effect` re-ran (and so started the mutation again) whenever state changed that was read by the `keys` / `effect` thunks, by `fn`, by the Effect before its first async step, by the `onMutate` / `onSuccess` / `onError` / `onSettled` callbacks or `invalidates` thunk when the Effect settled synchronously, or by the queries a synchronous success re-ran through invalidation. This matches `useInvalidateKeys`, which already invalidates untracked.
- 8178da4: `useReactiveStream` now restarts when the reactive state its `keys` or `effect` thunk reads changes, as its TSDoc promised and as `useReactiveQuery` does: the running stream is interrupted and a new one starts with the new keys and Effect, its `values` empty again. Previously the thunks were read only when the stream first started (Svelte runs a `createSubscriber` start callback untracked), so a change such as a new `userId` was ignored. As with `useReactiveQuery`, only the thunks' reads are dependencies: state the Effect reads while running does not restart the stream. `useInvalidateKeys`'s invalidator now runs untracked, so calling it from an `$effect` no longer makes that effect depend on the state the re-run queries read synchronously.
- 497421f: Fix the `Stream.callback` helpers written against Effect v3's cleanup contract. Effect v4's `Stream.callback` runs the Effect its callback returns as the stream's setup, so the cleanup now goes in a finalizer on the stream's scope:

  - `Store.toStream` no longer unsubscribes from the store as soon as the stream starts; it delivers every later update and unsubscribes when the stream ends or is interrupted.
  - `SignalEmitter` no longer drops every `emit()` after the stream starts; `emit()` feeds the running stream and disconnects when it ends or is interrupted.
  - `Realtime.fromEventSource` and `Realtime.fromWebSocket` now close the `EventSource` / `WebSocket` when the stream ends or is interrupted, instead of leaving it open.

- 6a1a634: Fix `useEffect(effect, { immediate: true })`, `useQuery`, `useDerived` and `useReactiveQuery` re-running in a loop until Svelte throws `effect_update_depth_exceeded`. Starting or settling a run read the hook's own result state inside its `$effect`, so every transition re-ran the effect; those reads are now untracked. `immediate: true` now starts the run untracked, like a `run()` from an event handler, so state the Effect reads synchronously no longer restarts it, and `setData` can be called from an `$effect`.

## 0.4.2

### Patch Changes

- 4d2b3be: Docs: the `useDebouncedSearch` and `useAtomResult` TSDoc examples import app modules through `#lib/…` (SvelteKit 3 replaced the `$lib` alias).

## 0.4.1

### Patch Changes

- d8b1fc7: Docs: every exported option and return type now has a TSDoc summary, the `Remote.call*` / `submitForm*` helpers and the standalone remote-function exports (`query`, `form`, `command`, `prerender`, `requested`, `RemoteFunction`) are documented, including that a rejected remote call surfaces as a defect (#101), and the `effect-svelte` module header describes the package.
- 3ad9c87: Tested against effect 4.0.0 (and `@effect/platform-node` 4.0.0); peer floor unchanged at `>=4.0.0-rc.118`. README: the version guidance now says to keep `effect` and its companions on the same exact version rather than the same `4.0.0-rc.x` one.
- 52734ab: Docs: the package README is now the full API reference (moved from the monorepo README), including every published entry point (`./testing`, `./adapter/handler`, `./adapter/serve`) and the hooks the summary had left out.

## 0.4.0

### Minor Changes

- 7a385e3: **Breaking:** require `effect@>=4.0.0-rc.118` (and `@effect/platform-node@>=4.0.0-rc.118` for `@thomasfosterau/effect-sveltekit`). The peer ranges move from `^4.0.0-beta.75`, so consumers on any beta, or on rc.112 through rc.117, fall outside the range and must upgrade `effect` and every `@effect/*` package together.

  The published code now imports `effect/<module>` instead of the removed `effect/unstable/<module>` paths (`effect/http/*`, `effect/http-api/*`, `effect/reactivity/*`), so the built `dist` cannot load against an earlier `effect`. The public `.d.ts` of `apiClient` / `fromApi` changes: `Groups` is now constrained by `HttpApiGroup.Constraint` (was `HttpApiGroup.Any`) and `HttpApi` is invariant in `Groups`.

- 6df0358: Add a Svelte 5 binding for `effect/reactivity` atoms — `useAtomResult` (SSR-safe `AsyncResult` reads with stale-while-revalidate), `useAtom` (read / write any atom), `invalidateAtomKeys` (keyed invalidation through the registry's own `Reactivity` instance) and `makeAtomRegistry` / `provideAtomRegistry` / `getAtomRegistry` — plus `useDebouncedSearch`, a debounced, latest-wins, interruptible typeahead controller built on `useStream`.
- bbd3b69: Build on the shared library toolchain: Vite+ 0.3.0 (vitest 4.1.11), the TypeScript 6/7 alias split (declarations are now emitted by the TypeScript 6 compiler instead of `@typescript/native-preview`), a strict pnpm catalog (peer ranges are unchanged, now published from `catalog:peers`), and Changesets CLI v3. No API changes.

### Patch Changes

- ba6e2e3: Document behaviour inherited from Effect rc.118. `ConfigProvider.fromEnv` treats an empty string as a missing value, so `sveltekitConfigProvider`, `sveltekitConfig`, `readConfig` and the adapter's `*_ORIGIN`, `*_XFF_DEPTH`, `*_HOST` and `*_PORT` variables now fail (`Config.String`), take their `withDefault` (including `Config.Int`, which used to fail) or become `None` (`Config.option`) on `""`; tests now pin this. The Atom runtime memo map is now per registry, so layers are no longer shared across separate atom registries. The install docs now say `effect@rc` and `@effect/platform-node@rc`, and a `Stream.scan` JSDoc example uses the lazy seed.

## 0.3.2

### Patch Changes

- 9d46d99: Add a `svelte` export condition to `package.json` (pointing at the same ESM
  files as `import`), so bundlers detect this package as a Svelte library.
  Without it, Vite prebundles the package with its own copy of Svelte's context
  internals (every `setContext` throws `lifecycle_outside_component`), and
  Vitest resolves Svelte's server runtime in jsdom projects — consumers no
  longer need `optimizeDeps.exclude` / `server.deps.inline` workarounds for this
  package.

## 0.3.1

### Patch Changes

- 6126100: Fix `useLiveStream` re-subscribing on every emission.

  `startWaiting()` read the previous result inside the hook's `$effect`,
  registering the result state itself as a dependency; every emission then wrote
  that state, invalidating the effect and interrupting/re-subscribing the stream
  for its whole lifetime. Symptoms: `current.waiting` never cleared after the
  first emission, and the stream thunk re-ran roughly once per emission instead
  of once per reactive-input change. The previous-value read is now untracked.

## 0.3.0

### Minor Changes

- 16c5a17: Add typed runtime contexts and a live-stream hook.
  - `createRuntimeContext<R>(name?)` mints a dedicated, fully-typed runtime
    context (built on Svelte's `createContext`, one instance per call) so
    libraries with a service-typed `ManagedRuntime` can expose their own context
    without colliding with the default context or each other. `get()` returns the
    precise `RuntimeLike<R>` and throws an actionable error when unset.
  - Every hook now accepts `options.runtime`, taking precedence over the ambient
    context and constraining the effect's `R` to what that runtime provides. The
    existing untyped default context keeps working unchanged.
  - `useLiveStream(stream, options?)` subscribes to a live `Stream`, tracking the
    latest emission (replace, not append) with reactive re-subscription
    (stale-while-revalidate) when the thunk's reactive inputs change. Teardown
    interruption never surfaces as a `Failure`. It exposes a reactive `promise`
    for `experimental.async` + `<svelte:boundary>` templates, and an `initial`
    seed for a synchronous, SSR-safe first render.

  The Svelte peer dependency moves to `>=5.40` (required for `createContext`).

## 0.2.0

### Minor Changes

- 1e07c24: Add a Svelte 5 async bridge and debounced reactive queries: `useQueryPromise(effect)` exposes a `promise` for `{#await}` / `<svelte:boundary>`, and `useDerived` gains a `{ debounce }` option to coalesce rapid dependency changes (e.g. debounced search) (#50).
- afb28d7: Add `useMutation` — a TanStack-Query-shaped mutation hook (`current`, `mutate(input)`, `reset()`) with `onMutate` / `onSuccess` / `onError` / `onSettled` callbacks, optimistic-update context threading, and reactivity-key `invalidates`. Enrich `useQuery` (and `useEffect`) with `setData` (optimistic local write) and `isStale` (#49).
- 0e2f004: Add `useWritableRef` — a two-way binding between an Effect `SubscriptionRef` and Svelte runes. Reading `current` tracks the ref reactively and assigning writes back, so it works directly with `bind:value`; `set` / `update` are also provided for imperative writes (#48).

## 0.1.0

### Minor Changes

- c15519f: Initial release of `@thomasfosterau/effect-svelte` — an Effect v4-native
  integration for Svelte 5 runes.
  - Runtime context (`provideRuntime` / `getRuntime`, `SvelteRuntime`) and
    component-lifecycle scopes (`useScope` / `useScopeCallback`).
  - Reactive hooks that expose Effect's native
    `AsyncResult` (`effect/unstable/reactivity/AsyncResult`) via a `.current`
    accessor, with stale-while-revalidate `waiting` semantics: `useEffect`,
    `useQuery`, `useDerived`, `useStream`, `useSubscriptionRef`, `usePubSub`, and the
    keyed-reactivity hooks `reactiveQuery` / `reactiveStream` / `reactiveMutation`
    / `useInvalidateKeys`. The subscription hooks are built on Svelte's
    `createSubscriber`.
  - Svelte store interop via the `Store` namespace: `Store.toStream` (a Svelte
    readable store as a `Stream`) for the Svelte → Effect direction, and
    `Store.fromStream` / `Store.fromSubscriptionRef` / `Store.fromPubSub` /
    `Store.fromQueue` / `Store.fromRef` for surfacing Effect sources as Svelte
    readable stores. `SignalEmitter` bridges reactive `$state` into a `Stream`.
