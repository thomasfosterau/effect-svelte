# @thomasfosterau/effect-svelte

Effect v4-native integration for **Svelte 5 runes**. Run Effects from
components and bridge Effect's reactive primitives to runes — results are
exposed as Effect's native
[`AsyncResult`](https://effect.website) (`effect/reactivity/AsyncResult`)
with stale-while-revalidate `waiting` semantics.

Part of the [`effect-svelte`](https://github.com/thomasfosterau/effect-svelte)
monorepo. For the SvelteKit integration, see
[`@thomasfosterau/effect-sveltekit`](https://www.npmjs.com/package/@thomasfosterau/effect-sveltekit).

## Installation

```bash
npm install @thomasfosterau/effect-svelte effect@rc svelte
```

## Usage

```svelte
<script lang="ts">
  import { provideRuntime, useDerived, AsyncResult } from "@thomasfosterau/effect-svelte";
  import { Effect } from "effect";

  provideRuntime();

  let userId = $state(1);
  const user = useDerived(() => fetchUser(userId));
</script>

<button onclick={() => userId++}>Next</button>

{#if AsyncResult.isSuccess(user.current)}
  <!-- `waiting` stays true while re-fetching, so the previous value is kept -->
  <p class:stale={user.current.waiting}>{user.current.value.name}</p>
{/if}
```

## What's included

- **Runtime context** — `provideRuntime` / `getRuntime`, `SvelteRuntime`, and
  component-lifecycle scopes (`useScope` / `useScopeCallback`).
- **Reactive hooks** (all expose a `.current` `AsyncResult`): `useEffect`,
  `useQuery`, `useDerived`, `useStream`, `useSubscriptionRef`, `usePubSub`, and
  the keyed-reactivity hooks `reactiveQuery` / `reactiveStream` /
  `reactiveMutation` / `useInvalidateKeys`.
- **Atoms** (`effect/reactivity`) — `useAtomResult` / `useAtom`, keyed
  invalidation with `invalidateAtomKeys`, and `makeAtomRegistry` /
  `provideAtomRegistry` for a configured (e.g. `defaultIdleTTL`) registry.
- **Typeahead** — `useDebouncedSearch`: debounced, latest-wins, interruptible
  search on `useStream`.
- **Store interop** — the `Store` namespace (`Store.toStream` for
  Svelte → Effect; `Store.fromStream` / `fromSubscriptionRef` / `fromPubSub` /
  `fromQueue` / `fromRef` for Effect → Svelte stores), plus `SignalEmitter`.
- The native `AsyncResult` namespace is re-exported from the package root.

See the [monorepo README](https://github.com/thomasfosterau/effect-svelte#readme)
for the full API and runnable examples.

## License

MIT
