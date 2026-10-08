# @thomasfosterau/effect-svelte

Effect integration for Svelte 5 runes.

For SvelteKit, add
[`@thomasfosterau/effect-sveltekit`](https://www.npmjs.com/package/@thomasfosterau/effect-sveltekit),
which builds on this package.

## Install

```bash
pnpm add @thomasfosterau/effect-svelte effect@rc svelte
```

`effect` (`>=4.0.0-rc.118`) and `svelte` (`^5.40.0`) are required peers. Keep a
single copy of `effect` in your app — two copies break `Context` / `Layer` /
`Schema` identity — and keep every `@effect/*` package on the same
exact version as `effect`.

## Usage

Provide a runtime once at the root of your app, then run Effects from any
component. Every result-producing hook exposes the current state through a
`.current` property (the idiomatic Svelte 5 convention, matching `MediaQuery`
and `fromStore`), typed as Effect's native
[`AsyncResult`](https://effect.website) (`effect/reactivity/AsyncResult`):

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

## API

| Export                                                                                                                                    | Purpose                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `provideRuntime` / `getRuntime`, `SvelteRuntime`, `defaultSvelteRuntime`                                                                  | The ambient runtime the hooks run on                                                                     |
| `createRuntimeContext`                                                                                                                    | A dedicated, service-typed runtime context for a library                                                 |
| `useScope` / `useScopeCallback`                                                                                                           | A `Scope` tied to the component lifecycle                                                                |
| `useEffect`, `useQuery`, `useDerived`, `useMutation`, `useQueryPromise`                                                                   | Run an Effect and expose its `AsyncResult` via `.current`                                                |
| `useStream`, `useLiveStream`, `useSubscriptionRef`, `usePubSub`, `useWritableRef`                                                         | Expose a `Stream`, `SubscriptionRef` or `PubSub` as runes                                                |
| `reactiveQuery`, `reactiveStream`, `reactiveMutation`, `useInvalidateKeys`                                                                | Keyed invalidation through `effect/reactivity`'s `Reactivity`                                            |
| `useAtom`, `useAtomResult`, `invalidateAtomKeys`, `makeAtomRegistry`, `provideAtomRegistry`, `getAtomRegistry`, `AtomRegistryUnavailable` | The Svelte binding for Effect's atoms (and the error raised when no registry is reachable on the server) |
| `useDebouncedSearch`                                                                                                                      | Debounced, latest-wins, interruptible typeahead                                                          |
| `Store`, `SignalEmitter`                                                                                                                  | Interop with Svelte stores and `$state`                                                                  |
| `AsyncResult`                                                                                                                             | Effect's native `AsyncResult` namespace, re-exported                                                     |

### Hooks and explicit runtimes

The hooks (`useEffect`, `useQuery`, `useDerived`, `useStream`, `useLiveStream`,
`useSubscriptionRef`, `usePubSub`, `reactiveQuery`, `reactiveStream`,
`reactiveMutation`) all return a handle with `.current` (plus
`values`/`latest`/`run`/`refetch`/`promise` where relevant). `AsyncResult` and
its combinators (`match`, `isSuccess`, `isWaiting`, `getOrElse`, ...) are
re-exported from the package root.

Every hook also accepts `options.runtime` to run against an explicit runtime
instead of the ambient context. Unlike the shared `provideRuntime`/`getRuntime`
context (which is untyped — `RuntimeLike<never>`), passing `options.runtime`
constrains the effect's `R` to exactly what that runtime provides:

```svelte
<script lang="ts">
  import { useQuery } from "@thomasfosterau/effect-svelte";
  import { myClientRuntime } from "./runtime.js"; // ManagedRuntime<ClientView, never>

  // `R` is checked against the runtime — an effect needing a service the
  // runtime does not provide is a compile error.
  const posts = useQuery(loadPosts, { runtime: myClientRuntime });
</script>
```

### Typed runtime contexts

For libraries built around a service-typed runtime, `createRuntimeContext<R>()`
mints a dedicated, fully-typed context (one instance per call, built on Svelte's
`createContext`) that never collides with the default context or other
libraries:

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
// throwing an actionable error if no ancestor provided it.
const runtime = ClientContext.get();
const posts = useQuery(loadPosts, { runtime });
```

### Live queries with `useLiveStream`

`useLiveStream` subscribes to a live `Stream` and tracks its **latest emission**
(each emission replaces the previous — live queries emit whole result sets). The
stream thunk runs inside `$effect`, so any reactive input it reads (e.g. a
cursor) is dependency-tracked; on change the previous subscription is interrupted
and a new one starts, keeping the previous value visible as a waiting `Success`
(stale-while-revalidate). Interruption from teardown/re-subscribe never surfaces
as a `Failure`.

It also exposes a reactive `promise` for `{#await}`-free async templates
(`experimental.async` + `<svelte:boundary>`): pending until the first emission,
replaced with an already-resolved promise on every subsequent emission (no
pending flash), rejecting on failure. Pass `initial` to seed a synchronous
`Success` (and a pre-resolved `promise`) — the SSR seam that avoids a
hydration-mismatching empty first paint.

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

### Atoms (`effect/reactivity`)

Effect v4 ships atoms, the registry behind them and keyed invalidation in core;
this package is the Svelte 5 binding (until an official `@effect/atom-svelte`
lands — see [#23](https://github.com/thomasfosterau/effect-svelte/issues/23)). `useAtomResult` reads a query atom's `AsyncResult` —
`AtomHttpApi` queries, `Atom.make(effect)` — with stale-while-revalidate
`waiting`, and `invalidateAtomKeys` re-runs every mounted atom registered against
the keys a mutation names. `useAtom` reads (and, for a writable atom, `set`s) any
atom. The atom argument is a thunk, so a `$state`-keyed request re-subscribes to
the new atom.

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

Atoms are browser state: during SSR `useAtomResult` renders
`AsyncResult.initial(true)` without evaluating the atom (so no request whose
value would be discarded is issued), and the implicit registry throws a tagged
`AtomRegistryUnavailable` if reached on the server.

### Debounced search with `useDebouncedSearch`

`useDebouncedSearch({ search, debounce })` is a typeahead controller on
`useStream`: query changes are buffered through a `Queue`, `debounce`d, and
`switchMap`ped into your interruptible `search` Effect, so a superseded request
is interrupted (an `HttpClient` fetch is aborted) and a late result can never
clobber a newer one. Previous results stay visible while the next search is
`pending`; an empty query resets.

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

### Store interop

For Svelte → Effect, `Store.toStream(store)` turns any
Svelte readable store into a `Stream`, and `SignalEmitter` bridges reactive
`$state` into a `Stream`: call `emit` from a `$effect`, and every running
consumer of `emitter.stream` receives each value, while values emitted before
any consumer has connected are buffered for the first one. The `Store` namespace also exposes the reverse
direction (`Store.fromStream`, `Store.fromSubscriptionRef`, `Store.fromPubSub`,
`Store.fromQueue`, `Store.fromRef`) for surfacing Effect sources as Svelte
stores.

## Recipes

See the [cookbook](../../docs/cookbook.md) for longer recipes, including loading/error chrome around an atom query and a typeahead on `useDebouncedSearch`.

## License

MIT
