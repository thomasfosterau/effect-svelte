---
"@thomasfosterau/effect-svelte": minor
---

Initial release of `@thomasfosterau/effect-svelte` — an Effect v4-native
integration for Svelte 5 runes.

- Runtime context (`provideRuntime` / `getRuntime`, `SvelteRuntime`) and
  component-lifecycle scopes (`useScope` / `useScopeCallback`).
- Reactive hooks that expose Effect's native
  `AsyncResult` (`effect/unstable/reactivity/AsyncResult`) via a `.current`
  accessor, with stale-while-revalidate `waiting` semantics: `useEffect`,
  `useQuery`, `derived`, `useStream`, `useSubscriptionRef`, `usePubSub`, and the
  keyed-reactivity hooks `reactiveQuery` / `reactiveStream` / `reactiveMutation`
  / `useInvalidateKeys`. The subscription hooks are built on Svelte's
  `createSubscriber`.
- Svelte → Effect bridges: `streamFromStore` (a Svelte readable store as a
  `Stream`) and `SignalEmitter`.
