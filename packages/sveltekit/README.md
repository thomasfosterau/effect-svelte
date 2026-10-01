# @thomasfosterau/effect-sveltekit

Effect integration for SvelteKit: load/action/endpoint wrappers, remote
functions, an `effectKit()` Vite plugin, and an Effect HTTP deployment adapter.

It depends on
[`@thomasfosterau/effect-svelte`](https://www.npmjs.com/package/@thomasfosterau/effect-svelte)
for the Svelte runes hooks.

## Install

```bash
pnpm add @thomasfosterau/effect-sveltekit effect@rc svelte @sveltejs/kit
# the Effect deployment adapter additionally needs:
pnpm add @effect/platform-node@rc
```

`effect` (`>=4.0.0-rc.118`) and `svelte` (`^5.40.0`) are required peers;
`@sveltejs/kit` (`^2.0.0 || ^3.0.0-next.0`), `vite` (for `./vite`) and
`@effect/platform-node` (`>=4.0.0-rc.118`, for `./adapter`) are optional. The
HTTP modules that lived in `@effect/platform` in v3 are part of `effect` itself
in v4 (`effect/http`), so no other Effect package is needed. Keep a single copy
of `effect`, and keep `effect` and `@effect/platform-node` on the same
`4.0.0-rc.x` version.

## Usage

Wrap a route's `load` so it returns an Effect:

```ts
// src/routes/items/[id]/+page.server.ts
import { serverLoad } from "@thomasfosterau/effect-sveltekit/server";
import { Effect } from "effect";

export const load = serverLoad((event) => Effect.succeed({ id: event.params.id }));
```

The same wrappers exist for actions, endpoints and hooks, on the default
per-request runtime or on your own services (see
[App-wide runtime](#app-wide-runtime-share-your-services-across-requests)); the
`effectKit()` Vite plugin lets route files export bare Effects instead.

## API

| Entry point                        | What it provides                                                                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-sveltekit` | Universal helpers: `load` / `makeUniversalRuntime`, the `Remote` call namespace, `Hooks` (`reroute`, `transport`), `ResponseHeaders`, `sveltekitConfig` / `readConfig`, `apiClient`                                                                               |
| `…/server`                         | Server wrappers (`serverLoad`, `action`, `actions`, `endpoint`), `Hooks`, `Endpoint`, `makeServerRuntime`, the per-request runtime seam (`makeRuntimeAdapter` / `RequestRuntime`), `Errors`, `RemoteFunction`, request decoding (`decodeParams`, `decodeJson`, …) |
| `…/client`                         | Browser-only `Navigation`, `State`, `Remote`, `Realtime`, `Forms` and `Hooks` namespaces, and `useRemoteQuery`                                                                                                                                                    |
| `…/vite`                           | The `effectKit()` Vite plugin (auto-wraps bare-Effect route exports)                                                                                                                                                                                              |
| `…/adapter`                        | The Effect HTTP deployment adapter (`effectAdapter`)                                                                                                                                                                                                              |
| `…/adapter/handler`                | The SvelteKit app as an Effect HTTP app (`makeHandler`, `makeHandlerWith`, `AssetSource`, `toWebHandler`)                                                                                                                                                         |
| `…/adapter/serve`                  | The Node server the adapter's `index.js` runs (`serve`, `layer`)                                                                                                                                                                                                  |
| `…/testing`                        | A fake `RequestEvent` and runners for unit-testing server wrappers and remote functions (`TestRequestEvent`, `runServerLoad`, `runAction`, `runEndpoint`, `runRemote`)                                                                                            |
| `…/internal/auto`                  | Referenced by `effectKit()`'s generated code; not a public API                                                                                                                                                                                                    |

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
`handleError`, `init`, `endpoint`, `requestRuntime`, `runPromise`, and `dispose`.
For universal `load` functions there is a browser-safe counterpart,
`makeUniversalRuntime`, in `@thomasfosterau/effect-sveltekit`.

To make the same services available to bare-Effect exports handled by the
Vite plugin, point the plugin at the runtime module:

```ts
// vite.config.ts
effectKit({ serverRuntime: "$lib/server/runtime" });
```

#### One runtime per request

Wire the runtime's `handle` hook (or the auto-wrapped `handle` from the Vite
plugin) in `src/hooks.server.ts`. It creates a **per-request runtime** — the
application layer's services plus the request's `HttpClient`/`SvelteKitRequestEvent`,
built once and sharing a single request scope — and stores it on `event.locals`:

```ts
// src/hooks.server.ts
import { runtime } from "$lib/server/runtime";
import { Effect } from "effect";

export const handle = runtime.handle(({ event, resolve }) => Effect.promise(() => resolve(event)));
```

With `handle` wired, every other wrapper for that runtime (`serverLoad`,
`action`, `endpoint`, ...) runs each request's effects on the same per-request
runtime — one `HttpClient`, one request scope — instead of rebuilding the request
services per call. Reach the runtime yourself with `runtime.requestRuntime(event)`
(for example from another hook in a `sequence`, to populate `event.locals`):

```ts
// e.g. authenticate once per request
export const handle = runtime.handle(({ event, resolve }) =>
  Effect.gen(function* () {
    const rt = runtime.requestRuntime(event)!;
    event.locals.user = yield* Effect.promise(() => rt.runPromise(Auth.currentUser));
    return yield* Effect.promise(() => resolve(event));
  }),
);
```

Wrappers from a _different_ runtime, or requests without `handle` wired, fall
back to building the request services per call, so this is backward compatible.

### Effect deployment adapter

A SvelteKit [adapter](https://svelte.dev/docs/kit/adapters) (like
`@sveltejs/adapter-node`) whose production server is an Effect HTTP server
(`effect/http` + `@effect/platform-node`) — `Config`-based
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
`effect/http` server alongside your other routes:

```ts
import { handler } from "./build/handler.js";
import { HttpServer } from "effect/http";
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
include `@thomasfosterau/effect-sveltekit`, `effect`, and
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

### Boundary error translation from a catalogue (`Errors.toSvelteKit`)

Every server wrapper takes a `translateError` that turns a failed `Cause` into
SvelteKit control flow. Rather than hand-writing that switch, pass your tagged
error catalogue as data — keyed by `_tag` — and the app's `kit.ts` becomes one
call:

```ts
// src/lib/server/effect/kit.ts
import {
  Errors,
  makeRuntimeAdapter,
  RequestRuntime,
} from "@thomasfosterau/effect-sveltekit/server";
import { error } from "@sveltejs/kit";
import type { AppError } from "$lib/errors"; // NotFound | Unauthorized | Forbidden | Redirect | HttpError | JsonapiError

export const { serverLoad, endpoint } = makeRuntimeAdapter(
  RequestRuntime.fromLocals((event) => event.locals.runtime),
  {
    translateError: Errors.toSvelteKit<AppError>({
      NotFound: { status: 404, message: (e) => `${e.resource} ${e.id} not found` },
      Unauthorized: 401, // body: the error's own `message`, else its tag
      Forbidden: 403,
      Redirect: "redirect", // redirect(e.status, e.to)
      HttpError: "status", // error(e.status, e.message)
      JsonapiError: (e) => error(e.status, JSON.stringify(e.toDocument())), // full control
    }),
  },
);
```

The squashed cause is matched, so a tagged error that surfaced as a defect is
translated too. Anything outside the catalogue goes to `fallback` — by default
`SvelteKit.translate` (Kit control-flow errors pass through; everything else is
an `EffectCauseError` 500 carrying the full `Cause`); pass
`{ fallback: Errors.rethrowSquashed }` to rethrow the original value unchanged
for `handleError`. With the error union as the type argument, catalogue keys and
each entry's callback are checked against it.

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

### Response-headers buffer (`ResponseHeaders`)

SvelteKit's `setHeaders` refuses `set-cookie`, throws when a header is set
twice, and is out of reach of components rendering during SSR. The usual answer
is a mutable headers buffer on `event.locals` that loads (and SSR components,
via `page.data`) append to and a `handle` copies onto the response.
`ResponseHeaders` is that buffer: a real `Headers` that serialises to `{}`, with
a transport entry that reconstructs it empty on the client (its contents never
leave the server):

```ts
// src/app.d.ts
declare global {
  namespace App {
    interface Locals {
      headers: import("@thomasfosterau/effect-sveltekit").ResponseHeaders;
    }
  }
}

// src/hooks.ts
import { Hooks } from "@thomasfosterau/effect-sveltekit";
export const transport = Hooks.transport({ ResponseHeaders: Hooks.responseHeadersTransporter });

// src/hooks.server.ts
import { ResponseHeaders } from "@thomasfosterau/effect-sveltekit";
import type { Handle } from "@sveltejs/kit";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.headers = new ResponseHeaders();
  const response = await resolve(event);
  event.locals.headers.appendTo(response.headers); // appends, so every set-cookie survives
  return response;
};

// src/routes/+layout.server.ts — expose the same buffer to every page
export const load = ({ locals }) => ({ headers: locals.headers });
```

(`SvelteKitResponseHeaders`, the per-request _service_, wraps `setHeaders` for
handler effects; `ResponseHeaders` is the buffer for everything `setHeaders`
cannot do.)

### `$env` as an Effect `Config` source

Back Effect's `Config` with SvelteKit's environment, so app-layer services read
configuration from `$env`:

```ts
// src/lib/server/runtime.ts
import { env } from "$env/dynamic/private";
import { makeServerRuntime, sveltekitConfig } from "@thomasfosterau/effect-sveltekit/server";
import { Layer } from "effect";
import { Database } from "./database"; // its layer reads Config.String("DATABASE_URL")

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

### Native form actions

For SvelteKit page `actions`, the `Forms` namespace
(`@thomasfosterau/effect-sveltekit/client`) expresses progressive enhancement
with Effects: `Forms.enhance({ onSubmit, onResult })` builds a `SubmitFunction`
for `use:enhance`, and `Forms.applyAction` / `Forms.deserialize` wrap the
`$app/forms` helpers. (This complements `Remote.submitForm`, which covers remote
forms.)

### App-side patterns

Two SvelteKit app patterns are recipes rather than APIs:

- **Leaving an error page.** After an error page renders, client-side
  navigation can re-run loads against a stale context; the apps force a full
  reload instead:

  ```svelte
  <script lang="ts">
    import { beforeNavigate } from "$app/navigation";
    import { page } from "$app/state";

    beforeNavigate((navigation) => {
      if (page.error) {
        navigation.cancel();
        window.location.href = navigation.to?.url.href ?? "/";
      }
    });
  </script>
  ```

- **Paraglide.** The paraglide wiring (plugin shim, compile step, the
  `paraglide` handle and the `fillPattern` workaround) is SvelteKit/Vite-specific
  and not Effect, so it stays an app template rather than a `./paraglide` entry
  here.

### Recipes

See the [cookbook](../../docs/cookbook.md) for recipes — consuming an
`Endpoint.fromApi` with a typed `apiClient`, reading build-time vs runtime
`$env` config with `readConfig` / `sveltekitConfig`, loading/error chrome around
an atom query, and a typeahead on `useDebouncedSearch`.

## License

MIT
