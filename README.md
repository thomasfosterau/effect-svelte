# effect-svelte

Effect integrations for Svelte 5 runes and SvelteKit, published as two packages
from this monorepo:

- **`@thomasfosterau/effect-svelte`** — Svelte 5 runes integration for Effect
  ([`packages/svelte`](./packages/svelte)).
- **`@thomasfosterau/effect-sveltekit`** — SvelteKit integration
  ([`packages/sveltekit`](./packages/sveltekit)), which depends on
  `@thomasfosterau/effect-svelte`. Subpaths:
  - `@thomasfosterau/effect-sveltekit` - universal helpers (`load`, remote-function calls)
  - `@thomasfosterau/effect-sveltekit/server` - server-only helpers
  - `@thomasfosterau/effect-sveltekit/client` - client-only helpers (`$app/navigation`, remote calls)
  - `@thomasfosterau/effect-sveltekit/vite` - the `effectKit()` Vite plugin
  - `@thomasfosterau/effect-sveltekit/adapter` - the Effect deployment adapter

## Installation

Both packages target **Effect v4 (beta)**. All Effect ecosystem packages share
a single version number in v4 — keep `effect` and `@effect/platform-node` on
the same `4.0.0-beta.x` version.

For a plain Svelte 5 app:

```bash
npm install @thomasfosterau/effect-svelte effect@beta svelte
```

For SvelteKit, install the SvelteKit package (it pulls in
`@thomasfosterau/effect-svelte` for the runes hooks). The HTTP modules that
previously lived in `@effect/platform` are part of `effect` itself in v4 (under
`effect/unstable/http`), so no extra package is needed:

```bash
npm install @thomasfosterau/effect-sveltekit effect@beta svelte @sveltejs/kit
```

If you use the Effect deployment adapter, you additionally need
`@effect/platform-node` (the production server runs on it):

```bash
npm install @effect/platform-node@beta
```

## Usage

### Svelte runtime and hooks

Provide a runtime once at the root of your app, then run Effects from any
component. Every result-producing hook exposes the current state through a
`.current` property (the idiomatic Svelte 5 convention, matching `MediaQuery`
and `fromStore`), typed as Effect's native
[`AsyncResult`](https://effect.website) (`effect/unstable/reactivity/AsyncResult`):

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
  <!-- `waiting` stays true while re-fetching, so the previous user is shown
       instead of flashing a spinner (stale-while-revalidate) -->
  <p class:stale={user.current.waiting}>{user.current.value.name}</p>
{:else if AsyncResult.isFailure(user.current)}
  <p>Failed to load</p>
{/if}
```

The hooks (`useEffect`, `useQuery`, `useDerived`, `useStream`, `useSubscriptionRef`,
`usePubSub`, `reactiveQuery`, `reactiveStream`, `reactiveMutation`) all return a
handle with `.current` (plus `values`/`latest`/`run`/`refetch` where relevant).
`AsyncResult` and its combinators (`match`, `isSuccess`, `isWaiting`,
`getOrElse`, ...) are re-exported from the package root.

To go the other way — Svelte → Effect — `Store.toStream(store)` turns any
Svelte readable store into a `Stream`, and `SignalEmitter` bridges reactive
`$state` into a `Stream`. The `Store` namespace also exposes the reverse
direction (`Store.fromStream`, `Store.fromSubscriptionRef`, `Store.fromPubSub`,
`Store.fromQueue`, `Store.fromRef`) for surfacing Effect sources as Svelte
stores.

### SvelteKit Vite plugin (recommended)

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-sveltekit/vite";

export default {
  plugins: [effectKit(), sveltekit()],
};
```

With the plugin installed, you can return an Effect (or a function returning
an Effect) directly from any standard SvelteKit route file (`+page.ts`,
`+page.server.ts`, `+layout(.server).ts`, `+server.ts`,
`hooks.(server|client).ts`):

```ts
// +page.server.ts
import { Effect } from "effect";

export const load = (event) => Effect.succeed({ id: event.params.id });
```

The plugin rewrites the export so it goes through the same runtime as the
explicit wrappers below; plain promise/value-returning functions pass through
unchanged.

#### Supported exports

| File                | Exports auto-wrapped                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `+page.ts`          | `load`                                                                 |
| `+page.server.ts`   | `load`, `actions`                                                      |
| `+layout.ts`        | `load`                                                                 |
| `+layout.server.ts` | `load`                                                                 |
| `+server.ts`        | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `fallback` |
| `hooks.ts`          | `reroute`                                                              |
| `hooks.server.ts`   | `handle`, `handleFetch`, `handleError`, `init`                         |
| `hooks.client.ts`   | `handleError`, `init`                                                  |

Config exports like `prerender`, `ssr`, `csr`, and `trailingSlash` — and the
universal `transport` hook (which is plain data, not a function) — are never
touched.

### App-wide runtime (share your services across requests)

Define your application's Effect services once as a `Layer`; the layer is
built lazily on the first request and shared for the lifetime of the server
process:

```ts
// src/lib/server/runtime.ts
import { makeServerRuntime } from "@thomasfosterau/effect-sveltekit/server";
import { Layer } from "effect";
import { Database } from "./database";

export const runtime = makeServerRuntime(Database.layer);
```

```ts
// src/routes/items/+page.server.ts
import { runtime } from "$lib/server/runtime";
import { Effect } from "effect";
import { Database } from "$lib/server/database";

export const load = runtime.serverLoad((event) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return { items: yield* db.listItems() };
  }),
);
```

The runtime exposes `serverLoad`, `action`, `actions`, `handle`, `handleFetch`,
`handleError`, `init`, `endpoint`, `runPromise`, and `dispose`. For universal
`load` functions there is a browser-safe counterpart, `makeUniversalRuntime`, in
`@thomasfosterau/effect-sveltekit`.

To make the same services available to bare-Effect exports handled by the
Vite plugin, point the plugin at the runtime module:

```ts
// vite.config.ts
effectKit({ serverRuntime: "$lib/server/runtime" });
```

### Effect deployment adapter

A SvelteKit [adapter](https://svelte.dev/docs/kit/adapters) (like
`@sveltejs/adapter-node`) whose production server is an Effect HTTP server
(`effect/unstable/http` + `@effect/platform-node`) — `Config`-based
configuration, request tracing spans, and graceful shutdown through Effect
scopes:

```js
// svelte.config.js
import adapter from "@thomasfosterau/effect-sveltekit/adapter";

export default {
  kit: { adapter: adapter() },
};
```

```bash
vite build
node build       # PORT, HOST, ORIGIN, PROTOCOL_HEADER, ... read from the env
```

The build also emits `build/handler.js`, which exports the whole SvelteKit
app as a composable Effect HTTP app — mount it inside an existing
`effect/unstable/http` server alongside your other routes:

```ts
import { handler } from "./build/handler.js";
import { HttpServer } from "effect/unstable/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";

const server = Layer.unwrap(Effect.map(handler, HttpServer.serve)).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);

NodeRuntime.runMain(Layer.launch(server));
```

Unlike `adapter-node`, the server output is not bundled: deploy `build/`
together with `package.json` and production `node_modules` (which must
include `@thomasfosterau/effect-svelte`, `effect`, and
`@effect/platform-node`).

### SvelteKit universal load

```ts
import { load, makeUniversalRuntime } from "@thomasfosterau/effect-sveltekit";
```

### SvelteKit server helpers

```ts
import {
  serverLoad,
  action,
  actions,
  endpoint,
  // hooks.server.ts hooks as Effects: Hooks.handle / handleFetch / handleError / init
  Hooks,
  // create a +server.ts endpoint from an Effect HttpApi / HttpRouter / route
  Endpoint,
  makeServerRuntime,
} from "@thomasfosterau/effect-sveltekit/server";
```

### SvelteKit endpoints backed by Effect

Create a `+server.ts` endpoint from an Effect [`HttpApi`](https://effect.website),
an `HttpRouter`, or a single route effect. Effect turns each of these into a Web
`fetch` handler; the `Endpoint` helpers wrap one as a SvelteKit `RequestHandler`.
Put it on a catch-all route and assign it to `fallback` so every method and
sub-path reaches it — `prefix` strips the SvelteKit mount path so the route's own
paths line up:

```ts
// src/routes/api/[...path]/+server.ts
import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
import { api } from "$lib/server/api";
import { ApiLive } from "$lib/server/handlers"; // HttpApiBuilder.group(...) + your services

export const fallback = Endpoint.fromApi(api, ApiLive, { prefix: "/api" });
```

`Endpoint.fromApi` supplies the platform services an `HttpApi` needs
(`HttpPlatform`, `FileSystem`, `Path`, `Etag`); `Endpoint.fromRouter` and
`Endpoint.fromHttpEffect` cover hand-built routers and single routes. The backing
layer is built once on the first request and shared; the returned handler carries
a `dispose()` for shutdown. Handlers receive an Effect-native `HttpServerRequest`
(built from `event.request`).

### SvelteKit client helpers

Effect wrappers for `$app/navigation` (browser-only), plus the remote-function
call helpers:

```ts
import {
  // $app/navigation: promise wrappers (goto, invalidate, ...) and lifecycle
  // events as Effect Streams (beforeNavigate/afterNavigate/onNavigate)
  Navigation,
  // $app/state: the current page as a Stream of snapshots
  State,
  // remote-function helpers (callQuery, callCommand, liveQueryStream, ...)
  Remote,
  // a reactive remote resource as an AsyncResult
  useRemoteQuery,
  // hooks.client.ts hooks as Effects: Hooks.handleError / Hooks.init
  Hooks,
} from "@thomasfosterau/effect-sveltekit/client";

// e.g. Navigation.goto('/done'), Navigation.invalidateAll(),
//      Remote.callQuery(getTodos), State.page()
```

`Navigation.beforeNavigate()` / `Navigation.afterNavigate()` bridge
`$app/navigation`'s callback-registration functions to `Stream`s,
`Navigation.onNavigate(fn => Effect)` runs an Effect per navigation (forwarding
any cleanup the Effect yields), and `State.page()` emits a shallow snapshot of
`$app/state`'s `page` initially and after each navigation. Like the bare
SvelteKit functions they wrap, these must be called during component
initialization (at the top of `<script>`).

### `transport` hook from Effect Schema

Move custom types (`Option`, `DateTime`, branded types, `Schema.Class`
instances, tagged errors, ...) across the server/client boundary — for `load`
data and remote functions — by building SvelteKit's universal `transport` hook
from Effect schemas (part of the universal `Hooks` namespace):

```ts
// src/hooks.ts
import { Hooks } from "@thomasfosterau/effect-sveltekit";
import { Schema } from "effect";

export const transport = Hooks.transport({
  Option: Schema.Option(Schema.Number),
  Date: Schema.Date,
});
```

### `$env` as an Effect `Config` source

Back Effect's `Config` with SvelteKit's environment, so app-layer services read
configuration from `$env`:

```ts
// src/lib/server/runtime.ts
import { env } from "$env/dynamic/private";
import { makeServerRuntime, sveltekitConfig } from "@thomasfosterau/effect-sveltekit/server";
import { Layer } from "effect";
import { Database } from "./database"; // its layer reads Config.string("DATABASE_URL")

export const runtime = makeServerRuntime(Database.layer.pipe(Layer.provide(sveltekitConfig(env))));
```

### SvelteKit hooks as Effects (`Hooks`)

Every SvelteKit hook has an explicit Effect wrapper, grouped into a `Hooks`
namespace per hook file (mirroring the auto-wrap table above):

| Import path                               | `Hooks` members                                | Runs on                                          |
| ----------------------------------------- | ---------------------------------------------- | ------------------------------------------------ |
| `@thomasfosterau/effect-sveltekit`        | `reroute`, `transport`, `transporter`          | universal runtime (`HttpClient` via event fetch) |
| `@thomasfosterau/effect-sveltekit/server` | `handle`, `handleFetch`, `handleError`, `init` | server runtime (`HttpClient` + `RequestEvent`)   |
| `@thomasfosterau/effect-sveltekit/client` | `handleError`, `init`                          | a bare Effect runtime                            |

```ts
// src/hooks.ts
import { Hooks } from "@thomasfosterau/effect-sveltekit";
import { Effect } from "effect";

export const reroute = Hooks.reroute((event) =>
  Effect.succeed(event.url.pathname === "/old" ? "/new" : undefined),
);
```

```ts
// src/hooks.server.ts
import { Hooks } from "@thomasfosterau/effect-sveltekit/server";
import { Effect } from "effect";

export const init = Hooks.init(Effect.logInfo("server starting up"));

export const handle = Hooks.handle(({ event, resolve }) =>
  Effect.gen(function* () {
    const start = Date.now();
    const response = yield* Effect.promise(() => resolve(event));
    yield* Effect.logInfo(`${event.url.pathname} -> ${response.status} (${Date.now() - start}ms)`);
    return response;
  }),
);

export const handleError = Hooks.handleError(({ error, event }) =>
  Effect.gen(function* () {
    const id = crypto.randomUUID();
    yield* Effect.logError(`${event.url.pathname} (${id})`, error);
    return { message: "Internal Error", id };
  }),
);
```

```ts
// src/hooks.client.ts
import { Hooks } from "@thomasfosterau/effect-sveltekit/client";
import { Effect } from "effect";

export const handleError = Hooks.handleError(({ error }) =>
  Effect.as(Effect.logError("client navigation failed", error), {
    message: "Something went wrong",
  }),
);
```

To additionally provide your application's services to the server hooks, use the
matching methods on an app-wide runtime (`runtime.handle`, `runtime.handleFetch`,
`runtime.handleError`, `runtime.init`). The same exports also work as bare
Effects (no explicit wrapper) when the `effectKit()` Vite plugin is enabled.

## Examples

The [`examples/`](./examples) directory contains three example apps, modelled
on widely used demo applications, that together exercise the entire API
surface:

| Example                                                        | App                                              | Demonstrates                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| [`examples/todomvc`](./examples/todomvc)                       | [TodoMVC](https://todomvc.com) (Svelte 5 + Vite) | `reactiveQuery`, `reactiveMutation`, `useInvalidateKeys`, `AsyncResult`, Effect services with localStorage       |
| [`examples/hacker-news`](./examples/hacker-news)               | Hacker News reader (SvelteKit)                   | `effectKit()` Vite plugin, `makeServerRuntime`, `effectAdapter`, load/action/endpoint wrappers, remote functions |
| [`examples/realtime-dashboard`](./examples/realtime-dashboard) | Market dashboard (Svelte 5 + Vite)               | `useStream`, `useSubscriptionRef`, `usePubSub`, `SignalEmitter`, scopes, interruption                            |

```bash
pnpm install
pnpm run build          # build both packages first (vp run -r build)
cd examples/todomvc     # (or hacker-news / realtime-dashboard)
pnpm run dev
```

See [`examples/README.md`](./examples/README.md) for the full API-to-example
coverage map.

## Development

This is a [Vite+](https://viteplus.dev) monorepo (`packages/svelte`,
`packages/sveltekit`, and the `examples/*` apps). Day-to-day commands, run from
the repository root:

```bash
vp install        # Install dependencies
vp check          # Format, lint, and type-check the whole workspace
vp run -r test    # Run every package's test suite (Vitest)
vp run -r build   # Build every package (tsdown)
```

If you don't have the `vp` global CLI installed, the same commands are available
through the root package scripts (`pnpm run check`, `pnpm run test`,
`pnpm run build`), or install it with:

```bash
curl -fsSL https://vite.plus | bash
```

Lint and format are configured once at the workspace root (`vite.config.ts`);
each package has its own `vite.config.ts` for `pack`/`test`.

### Project layout

```
packages/svelte/      @thomasfosterau/effect-svelte (Svelte 5 runes integration)
packages/sveltekit/   @thomasfosterau/effect-sveltekit (SvelteKit integration)
examples/             Example apps (TodoMVC, Hacker News, real-time dashboard)
vite.config.ts        Workspace Vite+ config (run cache, lint, fmt)
```

## Release workflow

Changesets is configured at the repository root and versions both packages.

```bash
vp run changeset   # Create a changeset
vp run version     # Apply pending changesets to the package versions
vp run release     # Build and publish to npm
```

## License

MIT
