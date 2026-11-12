# `@thomasfosterau/effect-svelte` reference

The hooks, runtimes and interop helpers of `@thomasfosterau/effect-svelte`. Install instructions and a first example are in the [package README](../packages/svelte/README.md); longer recipes are in the [cookbook](cookbook.md). Each export's own doc comment (shown on hover) has the full detail for that export.

- [Exports](#exports)
- [Hook naming](#hook-naming)
- [Results and `.current`](#results-and-current)
- [Absence is an `Option`](#absence-is-an-option)
- [Runtimes](#runtimes)
- [Typed runtime contexts](#typed-runtime-contexts)
- [Live queries with `useLiveStream`](#live-queries-with-uselivestream)
- [Atoms](#atoms)
- [Debounced search with `useDebouncedSearch`](#debounced-search-with-usedebouncedsearch)
- [Store interop](#store-interop)
- [Linting with `@enfect/oxlint`](#linting-with-enfectoxlint)
- [Deprecated aliases](#deprecated-aliases)

## Exports

The package has one entry point.

| Export                                                                                                                                    | Purpose                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `provideRuntime` / `getRuntime`, `SvelteRuntime`, `defaultSvelteRuntime`, `RuntimeNotFoundError`                                          | The ambient runtime the hooks run on                                                                     |
| `createRuntimeContext`                                                                                                                    | A dedicated, service-typed runtime context for a library                                                 |
| `useScope` / `useScopeCallback`, `ScopeRef`                                                                                               | A `Scope` tied to the component lifecycle                                                                |
| `useEffect`, `useQuery`, `useDerived`, `useMutation`, `useQueryPromise`                                                                   | Run an Effect and expose its `AsyncResult` via `.current`                                                |
| `useStream`, `useLiveStream`, `useSubscriptionRef`, `usePubSub`, `useWritableRef`                                                         | Expose a `Stream`, `SubscriptionRef` or `PubSub` as runes                                                |
| `useReactiveQuery`, `useReactiveStream`, `useReactiveMutation`, `useInvalidateKeys`                                                       | Keyed invalidation through `effect/reactivity`'s `Reactivity`                                            |
| `useAtom`, `useAtomResult`, `invalidateAtomKeys`, `makeAtomRegistry`, `provideAtomRegistry`, `getAtomRegistry`, `AtomRegistryUnavailable` | The Svelte binding for Effect's atoms (and the error raised when no registry is reachable on the server) |
| `useDebouncedSearch`                                                                                                                      | Debounced, latest-wins, interruptible typeahead                                                          |
| `Store`, `SignalEmitter`                                                                                                                  | Interop with Svelte stores and `$state`                                                                  |
| `AsyncResult`                                                                                                                             | Effect's native `AsyncResult` namespace, re-exported                                                     |

## Hook naming

Every hook is named `useX` and is called during component initialisation. A hook that runs Effects reads the ambient runtime (the atom hooks read the atom registry instead) unless given one, and every hook ties its work to the component's lifecycle. The `useReactive*` hooks (`useReactiveQuery`, `useReactiveStream`, `useReactiveMutation`) are the ones that take `Reactivity` keys: a query or stream re-runs whenever one of its keys is invalidated, and a mutation invalidates its keys when it succeeds. `useInvalidateKeys` invalidates keys by hand. Their runtime must provide `Reactivity.layer` from `effect/reactivity`.

Option and handle types are named after their hook: `useDerived` takes `UseDerivedOptions` and returns `UseDerivedReturn`, `useQuery` takes `UseQueryOptions` and returns `UseQueryReturn`, and so on. Hooks that share a family share its types: the `useReactive*` hooks take `UseReactiveOptions` and return `UseReactiveQueryReturn`, `UseReactiveStreamReturn` and `UseReactiveMutationReturn` (`useInvalidateKeys` also takes `UseReactiveOptions` and returns a plain function), and `useAtom` and `useAtomResult` take `UseAtomOptions` and return `UseAtomReturn` (`UseWritableAtomReturn` for a writable atom).

## Results and `.current`

Every result-producing hook exposes the current state through a `.current` property (the Svelte 5 convention, matching `MediaQuery` and `fromStore`), typed as Effect's native `AsyncResult` (`effect/reactivity/AsyncResult`).

The hooks (`useEffect`, `useQuery`, `useDerived`, `useStream`, `useLiveStream`, `useSubscriptionRef`, `usePubSub`, `useReactiveQuery`, `useReactiveStream`, `useReactiveMutation`) all return a handle with `.current` (plus `values`/`latest`/`run`/`refetch`/`promise` where relevant). `AsyncResult` and its combinators (`match`, `isSuccess`, `isWaiting`, `getOrElse`, ...) are re-exported from the package root.

A re-run keeps the previous value: `waiting` is `true` on a `Success` that is being re-fetched, so a template can keep showing the previous value instead of a spinner (stale-while-revalidate).

## Absence is an `Option`

Absence is an `Option` (`effect/Option`), never `null` or `undefined`:

| Where                                                                 | Type                | `None` means                      |
| --------------------------------------------------------------------- | ------------------- | --------------------------------- |
| `latest` of `useStream`, `usePubSub`, `useReactiveStream`             | `Option<A>`         | nothing has been emitted yet      |
| `previous` passed to a `setData` updater (`useEffect`, `useQuery`)    | `Option<A>`         | the result holds no value yet     |
| `context` passed to `useMutation`'s `onSuccess`/`onError`/`onSettled` | `Option<C>`         | no `onMutate` was given           |
| `useScope().current`                                                  | `Option<Closeable>` | the component has not mounted yet |

```svelte
<script lang="ts">
  import { useQuery, useStream } from "@thomasfosterau/effect-svelte";
  import { Option } from "effect";

  const ticks = useStream(tickStream);
  const todos = useQuery(loadTodos);
  const add = (todo: Todo) =>
    todos.setData((previous) => [...Option.getOrElse(previous, () => []), todo]);
</script>

{#if Option.isSome(ticks.latest)}<p>Tick {ticks.latest.value}</p>{/if}
```

An option a caller has no value for is omitted, not passed as `undefined` (`{ runtime: undefined }` is a type error under `exactOptionalPropertyTypes`).

## Runtimes

Provide a runtime once at the root of your app with `provideRuntime()`, then run Effects from any component below it. Called with no argument it provides `defaultSvelteRuntime`; pass a `ManagedRuntime` (for example `SvelteRuntime.extend(layer)`) or a `Context` to provide your own services. `getRuntime()` returns the provided runtime and throws a `RuntimeNotFoundError` when no parent component called `provideRuntime()`.

Every hook also accepts `options.runtime` to run against an explicit runtime instead of the ambient context. Unlike the shared `provideRuntime`/`getRuntime` context (which is untyped — `RuntimeLike<never>`), passing `options.runtime` constrains the effect's `R` to exactly what that runtime provides:

```svelte
<script lang="ts">
  import { useQuery } from "@thomasfosterau/effect-svelte";
  import { myClientRuntime } from "./runtime.js"; // ManagedRuntime<ClientView, never>

  // `R` is checked against the runtime — an effect needing a service the
  // runtime does not provide is a compile error.
  const posts = useQuery(loadPosts, { runtime: myClientRuntime });
</script>
```

With the shared context nothing checks `R`: the runtime given to `provideRuntime` must provide every service the Effects run on it need, and an Effect that asks for a missing one dies with Effect's "Service not found" defect.

## Typed runtime contexts

For libraries built around a service-typed runtime, `createRuntimeContext<R>()` mints a dedicated, fully-typed context (one instance per call, built on Svelte's `createContext`) that never collides with the default context or other libraries:

```ts
// context.ts
import { createRuntimeContext } from "@thomasfosterau/effect-svelte";
import type { ClientView } from "./client.js";

export const ClientContext = createRuntimeContext<ClientView>("@my/lib client");
```

```svelte
<script lang="ts">
  // Root.svelte — provide once, like setContext (component init only).
  import { ClientContext } from "./context.js";
  ClientContext.provide(myClientRuntime);
</script>
```

```ts
// anywhere below — `get()` returns the precise RuntimeLike<ClientView>,
// throwing a RuntimeNotFoundError (whose message names the context) if no
// ancestor provided it.
const runtime = ClientContext.get();
const posts = useQuery(loadPosts, { runtime });
```

## Live queries with `useLiveStream`

`useLiveStream` subscribes to a live `Stream` and tracks its **latest emission** (each emission replaces the previous — live queries emit whole result sets). The stream thunk runs inside `$effect`, so any reactive input it reads (e.g. a cursor) is dependency-tracked; on change the previous subscription is interrupted and a new one starts, keeping the previous value visible as a waiting `Success` (stale-while-revalidate). Interruption from teardown/re-subscribe never surfaces as a `Failure`.

It also exposes a reactive `promise` for `{#await}`-free async templates (`experimental.async` + `<svelte:boundary>`): pending until the first emission, replaced with an already-resolved promise on every subsequent emission (no pending flash), rejecting on failure. Pass `initial` to seed a synchronous `Success` (and a pre-resolved `promise`) — the SSR seam that avoids a hydration-mismatching empty first paint.

```svelte
<script lang="ts">
  import { useLiveStream } from "@thomasfosterau/effect-svelte";

  let cursor = $state(0);
  const todos = useLiveStream(() => liveTodos(cursor), { initial: seededTodos });
</script>

<svelte:boundary>
  <ul>{#each await todos.promise as todo}<li>{todo.title}</li>{/each}</ul>
</svelte:boundary>
```

## Atoms

Effect v4 ships atoms, the registry behind them and keyed invalidation in core (`effect/reactivity`); this package is the Svelte 5 binding (until an official `@effect/atom-svelte` lands — see [#23](https://github.com/thomasfosterau/effect-svelte/issues/23)). `useAtomResult` reads a query atom's `AsyncResult` — `AtomHttpApi` queries, `Atom.make(effect)` — with stale-while-revalidate `waiting`, and `invalidateAtomKeys` re-runs every mounted atom registered against the keys a mutation names. `useAtom` reads (and, for a writable atom, `set`s) any atom. The atom argument is a thunk, so a `$state`-keyed request re-subscribes to the new atom.

```svelte
<script lang="ts">
  // +layout.svelte — optional: one registry for the app, keeping a query's
  // value for 30s after its last reader unmounts.
  import { makeAtomRegistry, provideAtomRegistry } from "@thomasfosterau/effect-svelte";

  provideAtomRegistry(makeAtomRegistry({ defaultIdleTTL: 30_000 }));
</script>
```

```svelte
<script lang="ts">
  import { invalidateAtomKeys, useAtomResult } from "@thomasfosterau/effect-svelte";

  let { postId } = $props();
  const comments = useAtomResult(() => commentsAtom(postId)); // e.g. Atom.withReactivity(["comments", postId])

  async function post(body: string) {
    await addComment(postId, body);
    invalidateAtomKeys(["comments", postId]); // every reader re-fetches; the list stays on screen meanwhile
  }
</script>
```

Atoms are browser state: during SSR `useAtomResult` renders `AsyncResult.initial(true)` without evaluating the atom (so no request whose value would be discarded is issued), and the implicit registry throws a tagged `AtomRegistryUnavailable` if reached on the server.

The cookbook has a recipe for [loading and error chrome around an atom query](cookbook.md#loading-and-error-chrome-around-an-atom-query-useatomresult).

## Debounced search with `useDebouncedSearch`

`useDebouncedSearch({ search, debounce })` is a typeahead controller on `useStream`: query changes are buffered through a `Queue`, `debounce`d, and `switchMap`ped into your interruptible `search` Effect, so a superseded request is interrupted (an `HttpClient` fetch is aborted) and a late result can never clobber a newer one. Previous results stay visible while the next search is `pending`; an empty query resets.

```svelte
<script lang="ts">
  import { useDebouncedSearch } from "@thomasfosterau/effect-svelte";

  let query = $state("");
  const search = useDebouncedSearch({ search: searchUsers, debounce: "200 millis" });
  $effect(() => search.emit(query));
</script>

<input bind:value={query} />
<ul aria-busy={search.current.pending}>
  {#each search.current.results as user (user.id)}<li>{user.name}</li>{/each}
</ul>
{#if search.current.error}<p role="alert">{search.current.error}</p>{/if}
```

The cookbook has a [combobox built on it](cookbook.md#typeahead--combobox-search-usedebouncedsearch).

## Store interop

For Svelte → Effect, `Store.toStream(store)` turns any Svelte readable store into a `Stream`, and `SignalEmitter` bridges reactive `$state` into a `Stream`: call `emit` from a `$effect`, and every running consumer of `emitter.stream` receives each value; the latest value emitted when no consumer is connected is buffered for the next one to connect (`new SignalEmitter({ bufferSize })` keeps more). The `Store` namespace also exposes the reverse direction (`Store.fromStream`, `Store.fromSubscriptionRef`, `Store.fromPubSub`, `Store.fromQueue`, `Store.fromRef`) for surfacing Effect sources as Svelte stores.

The cookbook shows [a `MediaQuery` as an Effect `Stream`](cookbook.md#a-mediaquery-as-an-effect-stream) through `Store.toStream`.

## Linting with `@enfect/oxlint`

`useEffect` is this package's Svelte hook, not React's. If you lint with [`@enfect/oxlint`](https://www.npmjs.com/package/@enfect/oxlint), its `effect/avoid-react-hooks` rule matches the call by name, so turn that rule off in an app that has no React:

```ts
// vite.config.ts (Vite+) or your oxlint config
rules: { "effect/avoid-react-hooks": "off" }
```

## Deprecated aliases

`reactiveQuery`, `reactiveStream` and `reactiveMutation` are deprecated aliases of the `useReactive*` hooks, and `ReactiveOptions`, `ReactiveQueryReturn`, `ReactiveStreamReturn`, `ReactiveMutationReturn` and `DerivedReturn` are deprecated aliases of `UseReactiveOptions`, `UseReactiveQueryReturn`, `UseReactiveStreamReturn`, `UseReactiveMutationReturn` and `UseDerivedReturn`. All of them are kept for one minor release and removed in the next.
