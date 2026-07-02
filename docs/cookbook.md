# Cookbook

Recipes that combine `@thomasfosterau/effect-sveltekit` with Effect's own APIs.

## Consume an `Endpoint.fromApi` with a typed client (`apiClient`)

`Endpoint.fromApi` serves an Effect [`HttpApi`](https://effect.website) from a
`+server.ts` route. `apiClient` closes the loop from the other side: it derives
a typed client from the _same_ `HttpApi` definition and provides the
`HttpClient` for you (via `FetchHttpClient`), so a browser or a universal `load`
can call the same-origin API with full end-to-end types.

Share the `HttpApi` definition between server and client:

```ts
// src/lib/api.ts — imported by both the endpoint and the client
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
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
import { api } from "$lib/api";
import { ApiLive } from "$lib/server/handlers";

export const fallback = Endpoint.fromApi(api, ApiLive, { prefix: "/api" });
```

Consume it with `apiClient`. Point `baseUrl` at the mount prefix; in a `load`
pass `event.fetch` so the call joins SvelteKit's SSR fetch (relative URLs,
credentials, dedupe):

```ts
// src/routes/users/[id]/+page.ts — a universal load
import { apiClient } from "@thomasfosterau/effect-sveltekit";
import { Effect } from "effect";
import { api } from "$lib/api";

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
    apiUrl: Config.string("PUBLIC_API_URL"),
    analytics: Config.string("PUBLIC_ANALYTICS_KEY").pipe(Config.withDefault("")),
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
import { Database } from "$lib/server/database";

// Database.layer reads Config.string("DATABASE_URL"), now backed by $env
export const runtime = makeServerRuntime(Database.layer.pipe(Layer.provide(sveltekitConfig(env))));
```

`ConfigProvider.fromEnv` splits nested keys on `_`, so
`Config.string("URL").pipe(Config.nested("DATABASE"))` resolves `DATABASE_URL`
from the record — matching how it behaves against `process.env`.
