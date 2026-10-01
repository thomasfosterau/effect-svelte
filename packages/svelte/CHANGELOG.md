# @thomasfosterau/effect-svelte

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
