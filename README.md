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

Both packages target **Effect v4 (release candidate)** and require
`effect@>=4.0.0-rc.118`. All Effect ecosystem packages share a single version
number in v4 — keep `effect` and `@effect/platform-node` on the same
`4.0.0-rc.x` version.

For a plain Svelte 5 app:

```bash
npm install @thomasfosterau/effect-svelte effect@rc svelte
```

For SvelteKit, install the SvelteKit package (it pulls in
`@thomasfosterau/effect-svelte` for the runes hooks). The HTTP modules that
previously lived in `@effect/platform` are part of `effect` itself in v4 (under
`effect/http`), so no extra package is needed:

```bash
npm install @thomasfosterau/effect-sveltekit effect@rc svelte @sveltejs/kit
```

If you use the Effect deployment adapter, you additionally need
`@effect/platform-node` (the production server runs on it):

```bash
npm install @effect/platform-node@rc
```

## Usage

### Svelte runtime and hooks

Provide a runtime once at the root of your app, then run Effects from any
component. Every result-producing hook exposes the current state through a
`.current` property (the idiomatic Svelte 5 convention, matching `MediaQuery`
and `fromStore`), typed as Effect's native
[`AsyncResult`](https://effect.website) (`effect/reactivity/AsyncResult`):

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
  import { ClientContext } from "./context.ts";
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
lands — see #23). `useAtomResult` reads a query atom's `AsyncResult` —
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

To go the other way — Svelte → Effect — `Store.toStream(store)` turns any
Svelte readable store into a `Stream`, and `SignalEmitter` bridges reactive
`$state` into a `Stream`. The `Store` namespace also exposes the reverse
direction (`Store.fromStream`, `Store.fromSubscriptionRef`, `Store.fromPubSub`,
`Store.fromQueue`, `Store.fromRef`) for surfacing Effect sources as Svelte
stores.

### Native form actions

For SvelteKit page `actions`, the `Forms` namespace
(`@thomasfosterau/effect-sveltekit/client`) expresses progressive enhancement
with Effects: `Forms.enhance({ onSubmit, onResult })` builds a `SubmitFunction`
for `use:enhance`, and `Forms.applyAction` / `Forms.deserialize` wrap the
`$app/forms` helpers. (This complements `Remote.submitForm`, which covers remote
forms.)

## Recipes

See the [cookbook](./docs/cookbook.md) for recipes — consuming an
`Endpoint.fromApi` with a typed `apiClient`, reading build-time vs runtime
`$env` config with `readConfig` / `sveltekitConfig`, loading/error chrome around
an atom query, and a typeahead on `useDebouncedSearch`.

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

## Surface status: adopt vs drop (proposal, #81)

The three foundation apps (website, gardeneria, preferenceflow) use
`makeRuntimeAdapter(RequestRuntime.fromLocals(...), { translateError })` and the
`serverLoad` / `endpoint` it returns — and hand-write the pieces several other
surfaces are for. This table records, per surface, whether the apps should adopt
it or the package should drop it. **It is a proposal awaiting the owner's
verdict on #81; nothing has been removed.**

| Surface                                                                                                                  | What the apps do today                                                                                        | Proposal                                        | Reasoning                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Errors.toSvelteKit` (new)                                                                                               | hand-written `toSvelteKit` switch (`lib/server/effect/translate.ts`, ~113 LoC)                                | **Adopt**                                       | `kit.ts` becomes one `makeRuntimeAdapter` call over the app's catalogue (see above).                                                                                                                                                                                      |
| `ResponseHeaders` + `Hooks.responseHeadersTransporter` (new), `Hooks.transport` / `transporter` / `markerTransporter`    | a `Headers` wrapper (`lib/cache.ts`, ~93 LoC) and a hand-written `transport` (`hooks.ts`, ~31 LoC)            | **Adopt**                                       | The recipe above replaces both files.                                                                                                                                                                                                                                     |
| `Hooks.handle` / `handleFetch` / `handleError` / `init` (server), `Hooks.handleError` / `init` (client), `Hooks.reroute` | plain `Handle`s composed with `sequence` that populate `locals` and wrap `resolve`                            | **Keep; no app migration**                      | The apps' handles are SvelteKit glue, not Effect programs — wrapping them buys nothing. Adopt per hook only where the body is an Effect (e.g. `handleError` reporting through an Effect logger/PostHog layer). Small (~300 LoC) and exercised by the hacker-news example. |
| `Forms.enhance` / `applyAction` / `deserialize` (`./client`)                                                             | `enhanceForm(form)` → spreadable `<form>` props over `@thomasfosterau/effect-forms-svelte`'s `FormStore`      | **Drop (deprecate → remove in the next major)** | Form-action glue is moving to `effect-forms-svelte/kit` (effect-forms#2), which owns the form store the apps bind to; `Forms.enhance`'s callback shape does not fit that store. Remove once effect-forms#2 ships.                                                         |
| `sveltekitConfig` / `sveltekitConfigProvider` / `readConfig`                                                             | build-time `PUBLIC_*` catalogue via Kit 3's `defineEnvVars` + Standard Schema (`src/env.ts`, `public-env.ts`) | **Keep; adopt only for runtime `Config`**       | `defineEnvVars` is the right tool for the build-time public catalogue and stays in the apps. `sveltekitConfig` is for server layers that read `Config.*` from `$env/dynamic/private`; apps adopt it where a service reads `Config` (recipe above).                        |
| `effectKit()` Vite plugin (`./vite`, `./internal/auto`)                                                                  | explicit `serverLoad(...)` / `endpoint(...)` wrappers                                                         | **Drop candidate (deprecate)**                  | ~640 LoC of export rewriting (plus `magic-string`) that none of the apps use; they prefer the explicit wrappers, which are also what `makeRuntimeAdapter` returns. If deprecated, its "(recommended)" label above goes first.                                             |
| Remote functions (`RemoteFunction`, `Remote.*`, `useRemoteQuery`, validators)                                            | not used — website retired remote functions (website#1461)                                                    | **Freeze; decide with Kit 3 (#85)**             | Kit's remote functions are still experimental and change under Kit 3; porting them there is the cost of keeping them. Recommend deprecating unless a consumer appears by the Kit 3 move.                                                                                  |
| `Navigation` / `State` (`./client`)                                                                                      | not used                                                                                                      | Keep; no app migration                          | Small Effect wrappers over `$app/navigation` / `$app/state`; no maintenance pressure.                                                                                                                                                                                     |
| Effect deployment adapter (`./adapter`)                                                                                  | `@sveltejs/adapter-cloudflare`                                                                                | Keep; no app migration                          | Node deployment target used by the hacker-news example; the apps deploy to Workers.                                                                                                                                                                                       |

Two app-side patterns stay recipes rather than APIs:

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

Releases are automated with [Changesets](https://github.com/changesets/changesets)
and the **Release** GitHub workflow: changesets that land on `main` produce a
"Version Packages" PR, and merging it publishes the changed packages to npm. The
private example apps are excluded from versioning/publishing.

```bash
vp run changeset          # author a changeset
vp run changeset status   # preview pending releases
vp run version            # apply changesets locally (bumps + CHANGELOGs)
vp run release            # build all packages + changeset publish
```

Publishing uses npm **Trusted Publishing (OIDC)** — no long-lived token. See
**[`docs/RELEASING.md`](./docs/RELEASING.md)** for the full runbook, including
the one-time setup (enabling GitHub Actions to open the release PR, and adding a
trusted publisher for each package on npm).

## License

MIT
