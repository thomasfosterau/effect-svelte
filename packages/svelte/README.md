# @thomasfosterau/effect-svelte

[Effect](https://effect.website) v4 for Svelte 5 runes: an ambient runtime, and hooks that run an Effect or a `Stream` for a component and expose the result as an `AsyncResult` through `.current`. It works in any Svelte 5 app and has no SvelteKit dependency; for SvelteKit loads, actions, remote functions and a deployment adapter, add [`@thomasfosterau/effect-sveltekit`](https://www.npmjs.com/package/@thomasfosterau/effect-sveltekit), which builds on this package.

## Install

```bash
pnpm add @thomasfosterau/effect-svelte effect svelte
```

`effect` (`^4.0.0`) and `svelte` (`^5.40.0`) are required peers. Keep a single copy of `effect` in your app — two copies break `Context` / `Layer` / `Schema` identity — and keep every `@effect/*` package on the same exact version as `effect`.

## Example

Provide a runtime once at the root of your app, then run Effects from any component:

```svelte
<script lang="ts">
  import { provideRuntime, useDerived, AsyncResult } from "@thomasfosterau/effect-svelte";
  import { Effect } from "effect";

  // Stand-in for a real request: any Effect works here.
  const fetchUser = (id: number) =>
    Effect.succeed({ id, name: `User ${id}` }).pipe(Effect.delay("200 millis"));

  provideRuntime();

  let userId = $state(1);
  const user = useDerived(() => fetchUser(userId));
</script>

<button onclick={() => userId++}>Next</button>

{#if AsyncResult.isSuccess(user.current)}
  <!-- `waiting` stays true while re-fetching, so the previous user is shown
       instead of flashing a spinner (stale-while-revalidate) -->
  <p class:stale={user.current.waiting}>{user.current.value.name}</p>
{:else if AsyncResult.isFailure(user.current)}
  <p>Failed to load</p>
{/if}
```

Absence is an `Option` (`effect/Option`), never `null` or `undefined`: for example `Option.isSome(stream.latest)` for the latest value of `useStream`.

## Entry point

The package has one entry, `@thomasfosterau/effect-svelte`. Every hook is named `useX` and is called during component initialisation.

| Exports                                                                                     | Purpose                                                               |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `provideRuntime`, `getRuntime`, `SvelteRuntime`, `createRuntimeContext`                     | The runtime the hooks run on: ambient, or a typed context of your own |
| `useEffect`, `useQuery`, `useDerived`, `useMutation`, `useQueryPromise`                     | Run an Effect and expose its `AsyncResult` via `.current`             |
| `useStream`, `useLiveStream`, `useSubscriptionRef`, `usePubSub`, `useWritableRef`           | Expose a `Stream`, `SubscriptionRef` or `PubSub` as runes             |
| `useReactiveQuery`, `useReactiveStream`, `useReactiveMutation`, `useInvalidateKeys`         | Keyed invalidation through `effect/reactivity`'s `Reactivity`         |
| `useAtom`, `useAtomResult`, `invalidateAtomKeys`, `makeAtomRegistry`, `provideAtomRegistry` | The Svelte binding for Effect's atoms                                 |
| `useDebouncedSearch`                                                                        | Debounced, latest-wins, interruptible typeahead                       |
| `useScope`, `useScopeCallback`                                                              | A `Scope` tied to the component lifecycle                             |
| `Store`, `SignalEmitter`                                                                    | Interop with Svelte stores and `$state`                               |
| `AsyncResult`                                                                               | Effect's native `AsyncResult` namespace, re-exported                  |

The [reference](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/effect-svelte.md) lists every export and covers each group; each export's doc comment has the detail for that export.

## Lint

`useEffect` is this package's Svelte hook, not React's. If you lint with [`@enfect/oxlint`](https://www.npmjs.com/package/@enfect/oxlint), its `effect/avoid-react-hooks` rule matches the call by name, so turn that rule off in an app that has no React:

```ts
// vite.config.ts (Vite+) or your oxlint config
rules: { "effect/avoid-react-hooks": "off" }
```

## Links

- [Reference](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/effect-svelte.md): hook naming, runtimes and typed runtime contexts, where absence is an `Option`, live streams, atoms, debounced search, store interop, deprecated aliases.
- [Cookbook](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/cookbook.md): longer recipes, including loading/error chrome around an atom query and a typeahead on `useDebouncedSearch`.
- [Changelog](https://github.com/thomasfosterau/effect-svelte/blob/trunk/packages/svelte/CHANGELOG.md)
- [Repository](https://github.com/thomasfosterau/effect-svelte) and [issues](https://github.com/thomasfosterau/effect-svelte/issues)

## License

MIT
