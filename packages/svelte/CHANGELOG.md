# @thomasfosterau/effect-svelte

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
