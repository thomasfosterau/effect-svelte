# `@thomasfosterau/effect-sveltekit`: hooks, `transport` and `ResponseHeaders`

SvelteKit's hook files (`src/hooks.ts`, `src/hooks.server.ts`, `src/hooks.client.ts`) written as Effects, the universal `transport` hook built from Effect schemas, and a response-headers buffer that rides through `load` data. Related pages: [loads, actions, endpoints and runtimes](sveltekit-server.md), the [Vite plugin](sveltekit-vite-plugin.md).

- [Hooks as Effects (`Hooks`)](#hooks-as-effects-hooks)
- [`transport` hook from Effect Schema](#transport-hook-from-effect-schema)
- [Response-headers buffer (`ResponseHeaders`)](#response-headers-buffer-responseheaders)
- [Import the universal helpers by name](#import-the-universal-helpers-by-name)

## Hooks as Effects (`Hooks`)

Every SvelteKit hook has an explicit Effect wrapper, grouped into a `Hooks` namespace per hook file (mirroring the [Vite plugin's auto-wrap table](sveltekit-vite-plugin.md#supported-exports)). The universal members are also exported by name from the root entry; prefer those in `src/hooks.ts` (see [Import the universal helpers by name](#import-the-universal-helpers-by-name) for why):

| Import path                               | `Hooks` members                                                                          | Runs on                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `@thomasfosterau/effect-sveltekit`        | `reroute`, `transport`, `transporter`, `markerTransporter`, `responseHeadersTransporter` | universal runtime (`HttpClient` via event fetch) |
| `@thomasfosterau/effect-sveltekit/server` | `handle`, `handleFetch`, `handleError`, `init`                                           | server runtime (`HttpClient` + `RequestEvent`)   |
| `@thomasfosterau/effect-sveltekit/client` | `handleError`, `init`                                                                    | a bare Effect runtime                            |

```ts
// src/hooks.ts
import { reroute as effectReroute } from "@thomasfosterau/effect-sveltekit";
import { Effect } from "effect";

export const reroute = effectReroute((event) =>
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
    const response = yield* Effect.promise(async () => resolve(event));
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

To additionally provide your application's services to the server hooks, use the matching methods on an [app-wide runtime](sveltekit-server.md#app-wide-runtime) (`runtime.handle`, `runtime.handleFetch`, `runtime.handleError`, `runtime.init`). The same exports also work as bare Effects (no explicit wrapper) when the `effectKit()` Vite plugin is enabled.

## `transport` hook from Effect Schema

Move custom types (`Option`, `DateTime`, branded types, `Schema.Class` instances, tagged errors, ...) across the server/client boundary — for `load` data and remote functions — by building SvelteKit's universal `transport` hook from Effect schemas (also reachable as `Hooks.transport`):

```ts
// src/hooks.ts
import { transport as effectTransport } from "@thomasfosterau/effect-sveltekit";
import { Schema } from "effect";

export const transport = effectTransport({
  Option: Schema.Option(Schema.Number),
  Date: Schema.Date,
});
```

`transporter(schema)` builds a single round-tripping entry from a `Schema.Codec`, and `markerTransporter` builds a deliberately lossy entry for a non-POJO wrapper whose contents should not round-trip: the value is detected on the server and reconstructed fresh on the client.

## Response-headers buffer (`ResponseHeaders`)

SvelteKit's `setHeaders` refuses `set-cookie`, throws when a header is set twice, and is out of reach of components rendering during SSR. The usual answer is a mutable headers buffer on `event.locals` that loads (and SSR components, via `page.data`) append to and a `handle` copies onto the response. `ResponseHeaders` is that buffer: a real `Headers` that serialises to `{}`, with a transport entry that reconstructs it empty on the client (its contents never leave the server):

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
import {
  transport as effectTransport,
  responseHeadersTransporter,
} from "@thomasfosterau/effect-sveltekit";
export const transport = effectTransport({ ResponseHeaders: responseHeadersTransporter });

// src/hooks.server.ts
import { ResponseHeaders } from "@thomasfosterau/effect-sveltekit";
import type { Handle } from "@sveltejs/kit/hooks";

export const handle: Handle = async ({ event, resolve }) => {
  event.locals.headers = new ResponseHeaders();
  const response = await resolve(event);
  event.locals.headers.appendTo(response.headers); // appends, so every set-cookie survives
  return response;
};

// src/routes/+layout.server.ts — expose the same buffer to every page
export const load = ({ locals }) => ({ headers: locals.headers });
```

(`SvelteKitResponseHeaders`, the per-request _service_, wraps `setHeaders` for handler effects; `ResponseHeaders` is the buffer for everything `setHeaders` cannot do.)

## Import the universal helpers by name

Import the universal hook helpers by name, as above, rather than through the `Hooks` namespace. `src/hooks.ts` runs on every page, and the published build turns `Hooks` into a single object: `Hooks.transport` keeps `Hooks.reroute` and the default universal runtime (with Effect's `HttpClient`, `Stream` and `ManagedRuntime`) in the client bundle, while the named imports keep only the transport helpers. The same holds for `Remote`, whose members are also root exports (`callQuery`, `callCommand`, …).
