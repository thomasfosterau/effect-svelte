# Cookbook

Recipes that combine `@thomasfosterau/effect-sveltekit` with Effect's own APIs.
These use APIs that already exist upstream, so they are documented here rather
than re-wrapped.

## Consume an `Endpoint.fromApi` with a typed `HttpApiClient`

`Endpoint.fromApi` serves an Effect [`HttpApi`](https://effect.website) from a
`+server.ts` route. To call it back from the browser (or a `load` function) with
full end-to-end types, use Effect's own `HttpApiClient` — it derives a typed
client from the same `HttpApi` definition, so the serve↔consume loop is closed
without any extra wrapper.

Share the `HttpApi` definition between server and client:

```ts
// src/lib/api.ts — imported by both the endpoint and the client
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { Schema } from "effect";

export const api = HttpApi.make("app").add(
  HttpApiGroup.make("users").add(
    HttpApiEndpoint.get("get", "/users/:id").addSuccess(
      Schema.Struct({ id: Schema.String, name: Schema.String }),
    ),
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

Consume it with a typed client. Point `baseUrl` at the same origin and the mount
prefix; `client.fetch` is provided by SvelteKit's `event.fetch` in a `load`, or
the global `fetch` in the browser:

```ts
// anywhere on the client, or in a universal `load`
import { HttpApiClient } from "effect/unstable/httpapi";
import { FetchHttpClient } from "effect/unstable/http";
import { Effect } from "effect";
import { api } from "$lib/api";

const program = Effect.gen(function* () {
  const client = yield* HttpApiClient.make(api, { baseUrl: "/api" });
  return yield* client.users.get({ path: { id: "1" } });
}).pipe(Effect.provide(FetchHttpClient.layer));
```

The response is typed as the endpoint's success schema (`{ id, name }`), and
schema decoding happens automatically. Because `HttpApiClient` already targets a
same-origin `baseUrl`, no SvelteKit-specific client is needed.

## Build-time vs runtime config with `sveltekitConfig`

`sveltekitConfig(env)` turns any SvelteKit env record into an Effect
`ConfigProvider`, so `Config.string("...")` reads resolve from it. Which `$env`
module you pass determines _when_ the value is read — this is the important
distinction:

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

Feed whichever you need to `sveltekitConfig`:

```ts
// Runtime private config (server) — e.g. rotating credentials per deploy
import { env } from "$env/dynamic/private";
import { sveltekitConfig, makeServerRuntime } from "@thomasfosterau/effect-sveltekit/server";
import { Layer } from "effect";
import { Database } from "$lib/server/database";

export const runtime = makeServerRuntime(Database.layer.pipe(Layer.provide(sveltekitConfig(env))));
```

```ts
// Build-time public config (usable on the client) — e.g. an analytics key
import { env } from "$env/static/public";
import { sveltekitConfig } from "@thomasfosterau/effect-sveltekit";
import { Config, Effect } from "effect";

const analyticsKey = Effect.gen(function* () {
  return yield* Config.string("PUBLIC_ANALYTICS_KEY");
}).pipe(Effect.provide(sveltekitConfig(env)));
```

`ConfigProvider.fromEnv` splits nested keys on `_`, so
`Config.string("URL").pipe(Config.nested("DATABASE"))` resolves `DATABASE_URL`
from the record — matching how it behaves against `process.env`.
