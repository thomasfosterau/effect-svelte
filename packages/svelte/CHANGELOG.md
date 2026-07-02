# @thomasfosterau/effect-svelte

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
