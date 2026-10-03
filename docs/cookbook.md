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
