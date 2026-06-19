# effect-svelte

Effect integrations for Svelte 5 runes and SvelteKit, published as a single package:
`@thomasfosterau/effect-svelte`.

- `@thomasfosterau/effect-svelte` - Svelte 5 runes integration for Effect
- `@thomasfosterau/effect-svelte/kit` - SvelteKit helpers (universal)
- `@thomasfosterau/effect-svelte/kit/server` - SvelteKit server-only helpers
- `@thomasfosterau/effect-svelte/kit/client` - SvelteKit client-only helpers
- `@thomasfosterau/effect-svelte/kit/vite` - The `effectKit()` Vite plugin
- `@thomasfosterau/effect-svelte/kit/adapter` - The Effect deployment adapter

## Installation

This package targets **Effect v4 (beta)**. All Effect ecosystem packages share
a single version number in v4 — keep `effect` and `@effect/platform-node` on
the same `4.0.0-beta.x` version.

```bash
npm install @thomasfosterau/effect-svelte effect@beta svelte
```

If you use the SvelteKit helpers, you also need the (optional) `@sveltejs/kit`
peer dependency. The HTTP modules that previously lived in `@effect/platform`
are part of `effect` itself in v4 (under `effect/unstable/http`), so no extra
package is needed:

```bash
npm install @thomasfosterau/effect-svelte effect@beta svelte @sveltejs/kit
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
  import { provideRuntime, derived, AsyncResult } from "@thomasfosterau/effect-svelte";
  import { Effect } from "effect";

  provideRuntime();

  let userId = $state(1);
  const user = derived(() => fetchUser(userId));
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

The hooks (`useEffect`, `useQuery`, `derived`, `useStream`, `useSubscriptionRef`,
`usePubSub`, `reactiveQuery`, `reactiveStream`, `reactiveMutation`) all return a
handle with `.current` (plus `values`/`latest`/`run`/`refetch` where relevant).
`AsyncResult` and its combinators (`match`, `isSuccess`, `isWaiting`,
`getOrElse`, ...) are re-exported from the package root.

To go the other way — Svelte → Effect — `streamFromStore(store)` turns any
Svelte readable store into a `Stream`, and `SignalEmitter` bridges reactive
`$state` into a `Stream`.

### SvelteKit Vite plugin (recommended)

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-svelte/kit/vite";

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
import { makeServerRuntime } from "@thomasfosterau/effect-svelte/kit/server";
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

The runtime exposes `serverLoad`, `action`, `actions`, `handle`, `endpoint`,
`runPromise`, and `dispose`. For universal `load` functions there is a
browser-safe counterpart, `makeUniversalRuntime`, in
`@thomasfosterau/effect-svelte/kit`.

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
import adapter from "@thomasfosterau/effect-svelte/kit/adapter";

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
import { load, makeUniversalRuntime } from "@thomasfosterau/effect-svelte/kit";
```

### SvelteKit server helpers

```ts
import {
  serverLoad,
  action,
  actions,
  handle,
  endpoint,
  makeServerRuntime,
} from "@thomasfosterau/effect-svelte/kit/server";
```

### SvelteKit client helpers

Effect wrappers for `$app/navigation` (browser-only), plus the remote-function
call helpers:

```ts
import {
  goto,
  invalidate,
  invalidateAll,
  preloadData,
  // remote-function helpers
  callQuery,
  callCommand,
  liveQueryStream,
} from "@thomasfosterau/effect-svelte/kit/client";
```

### `transport` hook from Effect Schema

Move custom types (`Option`, `DateTime`, branded types, `Schema.Class`
instances, tagged errors, ...) across the server/client boundary — for `load`
data and remote functions — by building SvelteKit's universal `transport` hook
from Effect schemas:

```ts
// src/hooks.ts
import { transport } from "@thomasfosterau/effect-svelte/kit";
import { Schema } from "effect";

export const transport = transport({
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
import { makeServerRuntime, sveltekitConfig } from "@thomasfosterau/effect-svelte/kit/server";
import { Layer } from "effect";
import { Database } from "./database"; // its layer reads Config.string("DATABASE_URL")

export const runtime = makeServerRuntime(Database.layer.pipe(Layer.provide(sveltekitConfig(env))));
```

### `reroute` hook as an Effect

```ts
// src/hooks.ts
import { reroute } from "@thomasfosterau/effect-svelte/kit";
import { Effect } from "effect";

export const reroute = reroute((event) =>
  Effect.succeed(event.url.pathname === "/old" ? "/new" : undefined),
);
```

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
pnpm run build          # build the package first
cd examples/todomvc     # (or hacker-news / realtime-dashboard)
pnpm run dev
```

See [`examples/README.md`](./examples/README.md) for the full API-to-example
coverage map.

## Development

This repository is managed by [Vite+](https://viteplus.dev). Day-to-day
commands:

```bash
vp install   # Install dependencies
vp check     # Format, lint, and type-check
vp test      # Run the test suite (Vitest)
vp pack      # Build the library (tsdown)
```

If you don't have the `vp` global CLI installed, every command is also
available through the package scripts (`pnpm run check`, `pnpm run test`,
`pnpm run build`, ...), or install it with:

```bash
curl -fsSL https://vite.plus | bash
```

All tooling (build, test, lint, format) is configured in a single
`vite.config.ts` at the repository root.

### Project layout

```
src/           Svelte 5 runes integration (package root export)
src/kit/       SvelteKit helpers (./kit subpath exports)
tests/         Vitest test suite
examples/      Example apps (TodoMVC, Hacker News, real-time dashboard)
vite.config.ts Vite+ configuration (pack, test, lint, fmt)
```

## Release workflow

Changesets is configured at the repository root.

```bash
vp run changeset   # Create a changeset
vp run version     # Apply pending changesets to the package version
vp run release     # Build and publish to npm
```

## License

MIT
