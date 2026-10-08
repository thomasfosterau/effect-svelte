# Cookbook

Recipes that combine `@thomasfosterau/effect-svelte` / `@thomasfosterau/effect-sveltekit`
with Effect's own APIs.

## Consume an `Endpoint.fromApi` with a typed client (`apiClient`)

`Endpoint.fromApi` serves an Effect [`HttpApi`](https://effect.website) from a
`+server.ts` route. `apiClient` closes the loop from the other side: it derives
a typed client from the _same_ `HttpApi` definition and provides the
`HttpClient` for you (via `FetchHttpClient`), so a browser or a universal `load`
can call the same-origin API with full end-to-end types.

Share the `HttpApi` definition between server and client:

```ts
// src/lib/api.ts — imported by both the endpoint and the client
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Schema } from "effect";

const User = Schema.Struct({ id: Schema.String, name: Schema.String });

export const api = HttpApi.make("app").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id", { params: { id: Schema.String }, success: User }),
  ),
);
```

Serve it (see `Endpoint.fromApi`):

```ts
// src/routes/api/[...path]/+server.ts
import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
import { api } from "#lib/api.ts";
import { ApiLive } from "#lib/server/handlers.ts";

export const fallback = Endpoint.fromApi(api, ApiLive, { prefix: "/api" });
```

Consume it with `apiClient`. Point `baseUrl` at the mount prefix; in a `load`
pass `event.fetch` so the call joins SvelteKit's SSR fetch (relative URLs,
credentials, dedupe):

```ts
// src/routes/users/[id]/+page.ts — a universal load
import { apiClient } from "@thomasfosterau/effect-sveltekit";
import { Effect } from "effect";
import { api } from "#lib/api.ts";

export const load = (event) =>
  Effect.gen(function* () {
    const client = yield* apiClient(api, { baseUrl: "/api", fetch: event.fetch });
    return { user: yield* client.users.get({ params: { id: event.params.id } }) };
  });
```

The result is typed as the endpoint's success schema (`{ id, name }`), decoded
automatically. `apiClient` is a thin wrapper over Effect's `HttpApiClient.make`
— reach for `HttpApiClient` directly if you need `transformResponse` or a
custom `HttpClient` layer.

## Typed config from `$env`, build-time vs runtime (`readConfig` / `sveltekitConfig`)

Both helpers turn a SvelteKit env record into Effect `Config`. Which `$env`
module you pass decides _when_ the value is resolved:

| SvelteKit module       | Resolved     | Visibility      | Use for                                        |
| ---------------------- | ------------ | --------------- | ---------------------------------------------- |
| `$env/static/private`  | build time   | server only     | Secrets known at build (inlined, tree-shaken)  |
| `$env/static/public`   | build time   | client + server | `PUBLIC_`-prefixed values known at build       |
| `$env/dynamic/private` | request time | server only     | Secrets that vary per deploy without a rebuild |
| `$env/dynamic/public`  | request time | client + server | `PUBLIC_` values that vary per deploy          |

Static modules inline their values at build, so they cannot change without
rebuilding — but they are the fastest and are safe to reference in client
bundles (public only). Dynamic modules read from the process environment at
request time, so a value can change between deploys of the same build.

`readConfig(env, config)` decodes a typed `Config` in one call — ideal for
reading `$env/static/public` on the client:

```ts
import { env } from "$env/static/public";
import { readConfig } from "@thomasfosterau/effect-sveltekit";
import { Config, Effect } from "effect";

const settings = readConfig(
  env,
  Config.all({
    apiUrl: Config.String("PUBLIC_API_URL"),
    analytics: Config.String("PUBLIC_ANALYTICS_KEY").pipe(Config.withDefault("")),
  }),
);
// settings: Effect<{ apiUrl: string; analytics: string }, ConfigError>
```

For services that read `Config` internally, install the provider as a `Layer`
with `sveltekitConfig(env)` — typically the runtime private env on the server:

```ts
import { env } from "$env/dynamic/private";
import { sveltekitConfig, makeServerRuntime } from "@thomasfosterau/effect-sveltekit/server";
import { Layer } from "effect";
import { Database } from "#lib/server/database.ts";

// Database.layer reads Config.String("DATABASE_URL"), now backed by $env
export const runtime = makeServerRuntime(Database.layer.pipe(Layer.provide(sveltekitConfig(env))));
```

`ConfigProvider.fromEnv` splits nested keys on `_`, so
`Config.String("URL").pipe(Config.nested("DATABASE"))` resolves `DATABASE_URL`
from the record — matching how it behaves against `process.env`.

## Loading and error chrome around an atom query (`useAtomResult`)

An `AsyncResult` distinguishes "nothing has loaded yet" from "a write is
re-fetching" — which a `<svelte:boundary>` cannot — so render content from the
first success onwards and keep it through a re-fetch (`waiting`), showing chrome
only for a first read or a failure. That fits in a small headless component
wrapped around whatever loading/error visuals your design system provides:

```svelte
<!-- QueryBoundary.svelte -->
<script lang="ts" generics="A, E">
  import type { Snippet } from "svelte";
  import type { Cause } from "effect";
  import { AsyncResult } from "@thomasfosterau/effect-svelte";

  let {
    result,
    children,
    failed,
    loading,
  }: {
    result: AsyncResult.AsyncResult<A, E>;
    children: Snippet<[value: A, waiting: boolean]>;
    failed: Snippet<[cause: Cause.Cause<E>]>;
    loading: Snippet;
  } = $props();
</script>

{#if AsyncResult.isSuccess(result)}
  {@render children(result.value, result.waiting)}
{:else if AsyncResult.isFailure(result)}
  {@render failed(result.cause)}
{:else}
  {@render loading()}
{/if}
```

```svelte
<script lang="ts">
  import { useAtomResult } from "@thomasfosterau/effect-svelte";
  import QueryBoundary from "#lib/QueryBoundary.svelte";

  const proposals = useAtomResult(() => proposalsAtom({ page }));
</script>

<QueryBoundary result={proposals.current}>
  {#snippet children(list, waiting)}
    <ul class:opacity-60={waiting}>{#each list as p (p.id)}<li>{p.title}</li>{/each}</ul>
  {/snippet}
  {#snippet failed()}<p>Couldn't load proposals.</p>{/snippet}
  {#snippet loading()}<p>Loading…</p>{/snippet}
</QueryBoundary>
```

After a mutation, `invalidateAtomKeys(proposalKeys)` re-runs every mounted query
registered against those keys (`Atom.withReactivity(keys)`, or `AtomHttpApi`
queries given `reactivityKeys`); the list stays on screen, dimmed, until the new
value lands. If you `provideAtomRegistry(...)` a configured registry in the root
layout, it is also the one `invalidateAtomKeys` uses from non-component code.

## Typeahead / combobox search (`useDebouncedSearch`)

```svelte
<script lang="ts">
  import { useDebouncedSearch } from "@thomasfosterau/effect-svelte";
  import type { Effect } from "effect";

  let { onSearch }: { onSearch: (q: string) => Effect.Effect<ReadonlyArray<Option>> } = $props();

  let query = $state("");
  const search = useDebouncedSearch({
    search: (q) => onSearch(q),
    debounce: "150 millis",
    errorMessage: () => "Search failed — try again.",
  });
  $effect(() => search.emit(query));
</script>

<input role="combobox" aria-expanded={search.current.results.length > 0} bind:value={query} />
<ul role="listbox" aria-busy={search.current.pending}>
  {#each search.current.results as option (option.id)}
    <li role="option" aria-selected="false">{option.label}</li>
  {/each}
</ul>
```

- The `search` Effect must be interruptible: a newer query interrupts the
  in-flight one, which aborts an Effect `HttpClient` request rather than merely
  ignoring its response.
- Queries are buffered through a `Queue`, so an `emit` on any tick (every
  keystroke, long after mount) is delivered.
- Requires `provideRuntime()` in an ancestor, or pass `runtime`; the `search`
  Effect's requirements must be provided by that runtime.

## Svelte reactive collections and `MediaQuery` with Effect data (`useStream`)

`svelte/reactivity` ships reactive versions of the built-in collections
(`SvelteMap`, `SvelteSet`, `SvelteDate`) and a reactive `MediaQuery`. Both work
next to Effect data with no adapter beyond what this package already exports.

### `$state.raw`, or `SvelteMap` / `SvelteSet` / `SvelteDate`?

`$state` deep-proxies plain objects and arrays only. Any other instance — a
`Map`, `Set` or `Date`, and Effect's data types (`Option`, `Chunk`, `HashMap`,
`DateTime`, `Data.Class` and `Schema.Class` instances) — is stored as is, so
mutating it in place is invisible to Svelte; only reassigning the variable is
seen. That leaves two cases:

- **Each update produces a new value** (an Effect's result, a decoded response,
  the next `HashMap`): hold it in `$state.raw` and reassign. Effect values are
  immutable, so there is nothing to proxy, and a decoded `Schema.Struct` (a
  plain object `$state` _would_ proxy) keeps its reference identity.
- **Many small updates land in one collection** (entities by id from a stream
  of change events, the set of selected or in-flight ids, a clock advanced in
  place): use `SvelteMap`, `SvelteSet` or `SvelteDate`. Reading `get(key)` or
  `has(key)` for a present key re-runs only when that entry changes, `size`
  only when the count changes, and iteration on any change; nothing rebuilds a
  whole object per event.

```svelte
<script lang="ts">
  import { AsyncResult, useEffect } from "@thomasfosterau/effect-svelte";
  import { Effect, Stream } from "effect";
  import { SvelteMap } from "svelte/reactivity";
  import { orderUpdates, type Order } from "#lib/orders.ts"; // Stream<Order, OrderFeedError>

  // One entry per order id; an update replaces that entry only.
  const orders = new SvelteMap<string, Order>();

  // Drain the feed into the map for as long as the component is mounted.
  const feed = useEffect(
    Stream.runForEach(orderUpdates, (order) => Effect.sync(() => orders.set(order.id, order))),
    { immediate: true },
  );
</script>

<p>{orders.size} orders</p>
<ul>
  {#each [...orders.values()] as order (order.id)}
    <li>{order.id}: {order.status}</li>
  {/each}
</ul>
{#if AsyncResult.isFailure(feed.current)}<p>Live updates stopped.</p>{/if}
```

- Values in a `SvelteMap` / `SvelteSet` are not made deeply reactive: store
  immutable values and `set` a replacement (setting the same reference is a
  no-op).
- Keys compare with `SameValueZero`, like the native classes — not with
  Effect's `Equal`. Key by a primitive id; if you need structural keys, keep a
  `HashMap` in `$state.raw` instead.
- The map is the output, so the feed runs as one Effect: `Stream.runForEach`
  under `useEffect`, which starts it on mount and interrupts it on unmount.
  `feed.current` stays a waiting `Initial` while the feed is live and becomes
  a `Failure` if the stream fails. (`useLiveStream` with a `Stream.tap` works
  too, but also stores every order as its latest value, and suits a stream
  that should re-subscribe when reactive inputs change.) On the server the
  collections are the plain built-ins and the feed does not run.

### A `MediaQuery` as an Effect `Stream`

`MediaQuery` exposes its match through a `.current` getter, not the store
contract, so `Store.toStream` cannot take it directly. `toStore` from
`svelte/store` wraps any rune-tracked getter in a readable store, which
`Store.toStream` turns into a `Stream` for `useStream` to consume:

```svelte
<script lang="ts">
  import { AsyncResult, Store, useStream } from "@thomasfosterau/effect-svelte";
  import { Stream } from "effect";
  import { MediaQuery } from "svelte/reactivity";
  import { toStore } from "svelte/store";
  import { loadDashboard } from "#lib/dashboard.ts"; // ("full" | "compact") => Effect<Dashboard, DashboardError>

  const wide = new MediaQuery("min-width: 1024px", true);

  const dashboard = useStream(
    Store.toStream(toStore(() => wide.current)).pipe(
      Stream.switchMap((isWide) => Stream.fromEffect(loadDashboard(isWide ? "full" : "compact"))),
    ),
  );
</script>

{#if AsyncResult.isFailure(dashboard.current)}
  <p>Couldn't load the dashboard.</p>
{:else if dashboard.latest}
  <ul>{#each dashboard.latest.widgets as w (w.id)}<li>{w.title}</li>{/each}</ul>
{:else}
  <p>Loading…</p>
{/if}
```

- The store emits the current match when the stream starts, then each change
  (deduplicated, so `Stream.changes` is unnecessary). `useStream` starts the
  stream the first time the template reads `dashboard` and interrupts it on
  unmount, which unsubscribes the store and removes the `matchMedia` listener.
- `Stream.switchMap` interrupts an in-flight load when the breakpoint flips,
  which aborts an Effect `HttpClient` request rather than racing it.
- A failed load fails the whole stream: `dashboard.current` becomes a
  `Failure` and later breakpoint flips do nothing until the component remounts.
  To keep following the breakpoint, handle the error inside the `switchMap`,
  e.g. `Stream.fromEffect(loadDashboard(…).pipe(Effect.retry(…)))` or a
  `catch` that maps it to a fallback value.
- `useStream` keeps every emission in `values`; read `latest`. That is fine for
  a value that changes as rarely as a breakpoint.
- SSR: the server cannot know the viewport, so there `MediaQuery.current` is
  the fallback (`true` here), and `useStream` does not subscribe at all.
  `dashboard.latest` is `undefined` on the server and on the first client
  render, both render "Loading…", and hydration matches.
- A `SignalEmitter` fed from `$effect(() => emitter.emit(wide.current))`
  also works: the emitter buffers values emitted before its stream connects,
  so the initial match still arrives. `toStore` is simpler, though: it needs
  no `$effect`, and it hands the current value to every new subscriber,
  whereas the emitter's buffered values go only to the first run that
  connects. The same `toStore(() => …)` bridge turns any rune-tracked getter —
  a `$state` field, `orders.get(id)` — into a `Stream`.
- Requires `provideRuntime()` in an ancestor, or pass `runtime`.
