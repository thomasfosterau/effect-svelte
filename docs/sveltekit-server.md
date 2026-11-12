# `@thomasfosterau/effect-sveltekit`: loads, actions, endpoints and runtimes

How to return Effects from a route's `load`, `actions` and `+server.ts` handlers, which runtime they run on, and how a failure becomes a SvelteKit response. Install instructions and the entry-point table are in the [package README](../packages/sveltekit/README.md). Related pages: [hooks, `transport` and `ResponseHeaders`](sveltekit-hooks.md), [remote functions](sveltekit-remote-functions.md), [testing](sveltekit-testing.md), the [Vite plugin](sveltekit-vite-plugin.md).

- [The wrappers](#the-wrappers)
- [App-wide runtime](#app-wide-runtime)
- [One runtime per request](#one-runtime-per-request)
- [Bring your own per-request runtime](#bring-your-own-per-request-runtime)
- [Boundary error translation](#boundary-error-translation)
- [Endpoints backed by Effect](#endpoints-backed-by-effect)
- [`$env` as an Effect `Config` source](#env-as-an-effect-config-source)
- [Other server exports](#other-server-exports)

## The wrappers

Wrap a route's `load` so it returns an Effect:

```ts
// src/routes/items/[id]/+page.server.ts
import { serverLoad } from "@thomasfosterau/effect-sveltekit/server";
import { Effect } from "effect";

export const load = serverLoad((event) => Effect.succeed({ id: event.params.id }));
```

The server wrappers come from `@thomasfosterau/effect-sveltekit/server`:

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

Universal `load` functions (`+page.ts`, `+layout.ts`) use the root entry, which runs on both server and client:

```ts
import { load, makeUniversalRuntime } from "@thomasfosterau/effect-sveltekit";
```

The standalone wrappers run on the default per-request runtime, whose services are `SvelteKitServices` (an `HttpClient` backed by the event's `fetch`, the `SvelteKitRequestEvent`, and the cookies / response-headers / locals services). To run on your own services, use an [app-wide runtime](#app-wide-runtime) or [bring your own per-request runtime](#bring-your-own-per-request-runtime). The explicit wrappers return real SvelteKit functions, so route `$types` work as usual. The optional [`effectKit()` Vite plugin](sveltekit-vite-plugin.md) lets route files export bare Effects instead.

## App-wide runtime

Define your application's Effect services once as a `Layer`; the layer is built lazily on the first request and shared for the lifetime of the server process:

```ts
// src/lib/server/runtime.ts
import { makeServerRuntime } from "@thomasfosterau/effect-sveltekit/server";
import { Layer } from "effect";
import { Database } from "./database";

export const runtime = makeServerRuntime(Database.layer);
```

```ts
// src/routes/items/+page.server.ts
import { runtime } from "#lib/server/runtime.ts";
import { Effect } from "effect";
import { Database } from "#lib/server/database.ts";

export const load = runtime.serverLoad((event) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return { items: yield* db.listItems() };
  }),
);
```

The runtime exposes `serverLoad`, `action`, `actions`, `handle`, `handleFetch`, `handleError`, `init`, `endpoint`, `requestRuntime`, `runPromise`, `runPromiseExit` and `dispose`, plus the underlying `ManagedRuntime` as `runtime`. For universal `load` functions there is a browser-safe counterpart, `makeUniversalRuntime`, in `@thomasfosterau/effect-sveltekit`.

The application layer is built outside of any request, so its services cannot depend on the per-request `SvelteKitRequestEvent` or `HttpClient`; pass request-specific data to service methods as arguments.

## One runtime per request

Wire the runtime's `handle` hook (or the auto-wrapped `handle` from the [Vite plugin](sveltekit-vite-plugin.md)) in `src/hooks.server.ts`. It creates a **per-request runtime** — the application layer's services plus the request's `HttpClient`/`SvelteKitRequestEvent`, built once and sharing a single request scope — and stores it on `event.locals`:

```ts
// src/hooks.server.ts
import { runtime } from "#lib/server/runtime.ts";
import { Effect } from "effect";

export const handle = runtime.handle(({ event, resolve }) =>
  Effect.promise(async () => resolve(event)),
);
```

With `handle` wired, every other wrapper for that runtime (`serverLoad`, `action`, `endpoint`, ...) runs each request's effects on the same per-request runtime — one `HttpClient`, one request scope — instead of rebuilding the request services per call. Reach the runtime yourself with `runtime.requestRuntime(event)` (for example from another hook in a `sequence`, to populate `event.locals`). It returns an `Option` (`effect/Option`): `Some` inside a request that went through this runtime's `handle`, `None` otherwise:

```ts
// e.g. authenticate once per request
export const handle = runtime.handle(({ event, resolve }) =>
  Effect.gen(function* () {
    const rt = runtime.requestRuntime(event);
    if (Option.isSome(rt)) {
      event.locals.user = yield* Effect.promise(() => rt.value.runPromise(Auth.currentUser));
    }
    return yield* Effect.promise(async () => resolve(event));
  }),
);
```

Wrappers from a _different_ runtime, or requests without `handle` wired, fall back to building the request services per call, so this is backward compatible.

## Bring your own per-request runtime

`makeRuntimeAdapter(provider, opts)` binds the server wrappers (`serverLoad`, `action`, `actions`, `endpoint`) to a `RequestRuntime` provider, so the handler effect's services are your own application catalogue (not `SvelteKitServices`). The providers:

- `RequestRuntime.fromLocals` adopts a runtime the consumer stashed on `event.locals`. It is resolved per call, so a mid-request rebuild is honoured.
- `RequestRuntime.fromLayerPerRequest` lets the package build and dispose one runtime per request, with `afterResponse` to route disposal through Cloudflare Workers' `ctx.waitUntil`.
- `RequestRuntime.fromManagedRuntime` / `RequestRuntime.fromLayer` reuse the build-once model.

`RemoteFunction.withRuntime(provider)` gives [remote functions](sveltekit-remote-functions.md) the same seam.

```ts
// src/lib/server/effect/kit.ts
import { makeRuntimeAdapter, RequestRuntime } from "@thomasfosterau/effect-sveltekit/server";

export const { serverLoad, action, actions, endpoint } = makeRuntimeAdapter(
  RequestRuntime.fromLocals((event) => event.locals.runtime),
);
```

## Boundary error translation

Pass `translateError` to `makeRuntimeAdapter`, `makeServerRuntime` or `RemoteFunction.withRuntime` to map a failed `Cause` to SvelteKit control flow (`error(404)`, `redirect()`, remote-form `invalid()`) instead of a generic 500. Without one, SvelteKit's own `error()` / `redirect()` pass through and anything else is a 500.

A translator stands where the wrapper would otherwise throw, so it only throws: its type is `KitErrorTranslator`, a function from the `Cause` to `never`. A form action is the one place SvelteKit has a _returned_ failure, `fail()`, so `action` / `actions` take their own translator, [`translateActionError`](#action-failures-fail-and-translateactionerror), which may return one.

### From a catalogue (`Errors.toSvelteKit`)

Rather than hand-writing that switch, pass your tagged error catalogue as data — keyed by `_tag` — and the app's `kit.ts` becomes one call:

```ts
// src/lib/server/effect/kit.ts
import {
  Errors,
  makeRuntimeAdapter,
  RequestRuntime,
} from "@thomasfosterau/effect-sveltekit/server";
import { error } from "@sveltejs/kit";
import type { AppError } from "#lib/errors.ts"; // NotFound | Unauthorized | Forbidden | Redirect | HttpError | JsonapiError

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

The squashed cause is matched, so a tagged error that surfaced as a defect is translated too. Anything outside the catalogue goes to `fallback` — by default `SvelteKit.translate` (Kit control-flow errors pass through; everything else is an `EffectCauseError` 500 carrying the full `Cause`); pass `{ fallback: Errors.rethrowSquashed }` to rethrow the original value unchanged for `handleError`. With the error union as the type argument, catalogue keys and each entry's callback are checked against it.

### Failing with SvelteKit control flow (`SvelteKit`)

The `SvelteKit` namespace has Effect-native versions of SvelteKit's control-flow calls: `SvelteKit.redirect`, `SvelteKit.error` and `SvelteKit.fail` fail the Effect with a tagged `KitRedirect`, `KitError` or `KitActionFailure` instead of throwing. `SvelteKit.translate`, the default translator, throws the first two as SvelteKit's `redirect()` / `error()` at the request boundary. `SvelteKit.makeTranslator(cases)` composes `translate` with your own cases, which run first; a case handles an error by throwing, and what it returns is ignored.

### Action failures (`fail()` and `translateActionError`)

An action reports a failure by returning `fail(status, data)`, which SvelteKit hands to the page as `form`. In an action wrapper (`action`, `actions`, the [Vite plugin](sveltekit-vite-plugin.md)'s auto-wrapped `actions`, and `runAction` in tests), a `SvelteKit.fail(status, data)` failure in the Effect's error type becomes that return value, and its `data` is part of the action's result type, so the route's `ActionData` includes it:

```ts
// src/routes/signup/+page.server.ts
import { actions as kitActions, SvelteKit } from "@thomasfosterau/effect-sveltekit/server";
import { Effect } from "effect";

export const actions = kitActions({
  // (event) => Promise<{ created: true } | ActionFailure<{ email: string }>>
  default: (event) =>
    Effect.gen(function* () {
      const email = yield* readEmail(event);
      if (yield* isTaken(email)) yield* SvelteKit.fail(422, { email: "already taken" });
      return { created: true as const };
    }),
});
```

Only a failure in the error channel is returned (the type is read from the Effect's error type). Outside a form action nothing can return a `fail()`: in a load, a hook, an endpoint or a remote function, a `KitActionFailure` is a 500 like any other untranslated failure.

To map _domain_ errors to `fail()`, give the actions their own translator, `translateActionError`. It is a `KitActionErrorTranslator<Data>`: a translator that may return `ActionFailure<Data>` as well as throw. `Errors.toSvelteKit` builds one when you name the failure as its second type argument (a function entry may then return `fail()`), and `SvelteKit.makeActionTranslator<Data>(cases, fallback)` builds one from cases that may return `fail()`:

```ts
// src/lib/server/effect/kit.ts
import {
  Errors,
  makeRuntimeAdapter,
  RequestRuntime,
} from "@thomasfosterau/effect-sveltekit/server";
import { fail, type ActionFailure } from "@sveltejs/kit";
import type { AppError } from "#lib/errors.ts";

// Throw-only: for loads and endpoints (and for actions, as the fallback below).
const translateError = Errors.toSvelteKit<AppError>({ NotFound: 404, Forbidden: 403 });

// Actions only: Invalid becomes fail(); everything else goes to translateError.
const translateActionError = Errors.toSvelteKit<AppError, ActionFailure<{ message: string }>>(
  { Invalid: (e) => fail(422, { message: e.message }) },
  { fallback: translateError },
);

export const { serverLoad, action, actions, endpoint } = makeRuntimeAdapter(
  RequestRuntime.fromLocals((event) => event.locals.runtime),
  { translateError, translateActionError },
);
```

Every action of that adapter then returns `… | ActionFailure<{ message: string }>`. `makeServerRuntime(layer, { translateError, translateActionError })` takes the same pair. Without `translateActionError` the actions use `translateError`: a throw-only translator is an action translator too, so one translator can serve loads and actions as long as it never returns.

`translateError` itself cannot return a `fail()`: passing a translator that does (to `translateError`, to `RemoteFunction.withRuntime`, or as a function entry of a catalogue without the second type argument) is a type error.

#### Migrating a shared translator that returned `fail()`

Before this change the translator type was `never`-returning but a translator could return `fail()` anyway, and one translator was shared by loads and actions. Split it:

1. Keep the throwing cases in the shared translator (`translateError`), and remove the `fail()` ones from it.
2. Put the `fail()` cases in an action translator that falls back to the shared one: `Errors.toSvelteKit<AppError, ActionFailure<Data>>({ … }, { fallback: translateError })`, or `SvelteKit.makeActionTranslator<Data>([…cases], translateError)`. A hand-written one is a function `(cause) => ActionFailure<Data>` that returns `fail()` or calls `translateError(cause)`.
3. Pass it as `translateActionError` beside `translateError`.

An action that only yields `SvelteKit.fail()` needs none of this.

## Endpoints backed by Effect

Create a `+server.ts` endpoint from an Effect [`HttpApi`](https://effect.website), an `HttpRouter`, or a single route effect. Effect turns each of these into a Web `fetch` handler; the `Endpoint` helpers wrap one as a SvelteKit `RequestHandler`. Put it on a catch-all route and assign it to `fallback` so every method and sub-path reaches it — `prefix` strips the SvelteKit mount path so the route's own paths line up:

```ts
// src/routes/api/[...path]/+server.ts
import { Endpoint } from "@thomasfosterau/effect-sveltekit/server";
import { api } from "#lib/server/api.ts";
import { ApiLive } from "#lib/server/handlers.ts"; // HttpApiBuilder.group(...) + your services

export const fallback = Endpoint.fromApi(api, ApiLive, { prefix: "/api" });
```

`Endpoint.fromApi` supplies the platform services an `HttpApi` needs (`HttpPlatform`, `FileSystem`, `Path`, `Etag`); `Endpoint.fromRouter` and `Endpoint.fromHttpEffect` cover hand-built routers and single routes. The backing layer is built once on the first request and shared; the returned handler carries a `dispose()` for shutdown. Handlers receive an Effect-native `HttpServerRequest` (built from `event.request`).

`Endpoint.fromStream(stream, options)` serves an Effect `Stream` as Server-Sent Events; consume it in the browser with [`Realtime.fromEventSource`](sveltekit-client.md#realtime).

For a single handler that returns a `Response`, `endpoint(fn)` wraps a function from the request event to an `Effect<Response>`. A failure that is not a SvelteKit `error()` / `redirect()` is logged and answered with a 500 JSON body, `{ error: "Internal server error" }`; pass `{ exposeErrors: true }` to send the pretty-printed cause instead.

The cookbook shows how to [call an `Endpoint.fromApi` with a typed client](cookbook.md#consume-an-endpointfromapi-with-a-typed-client-apiclient).

## `$env` as an Effect `Config` source

Back Effect's `Config` with SvelteKit's environment, so app-layer services read configuration from `$env`:

```ts
// src/lib/server/runtime.ts
import { env } from "$env/dynamic/private";
import { makeServerRuntime, sveltekitConfig } from "@thomasfosterau/effect-sveltekit/server";
import { Layer } from "effect";
import { Database } from "./database"; // its layer reads Config.String("DATABASE_URL")

export const runtime = makeServerRuntime(Database.layer.pipe(Layer.provide(sveltekitConfig(env))));
```

`sveltekitConfig`, `sveltekitConfigProvider` and `readConfig` are also exported from the root entry for universal code. The cookbook covers [build-time and runtime `$env` modules](cookbook.md#typed-config-from-env-build-time-vs-runtime-readconfig--sveltekitconfig).

## Other server exports

| Export                                                                                    | What it is                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `decodeParams`, `decodeSearchParams`, `decodeJson`, `decodeFormData`, `ParseError`        | Read and validate part of the current request against an Effect `Schema` or a Standard Schema; a validation failure fails with `ParseError` |
| `defer`                                                                                   | Start a slow effect in the background and hand SvelteKit its `Promise`, for streamed `load` data                                            |
| `SvelteKitCookies`, `SvelteKitResponseHeaders`, `SvelteKitLocals`, `requestServicesLayer` | The request's cookies, `setHeaders` and `locals` as services; part of `SvelteKitServices`                                                   |
| `SvelteKitRequestEvent`, `SvelteKitRuntime`, `runWithSvelteKitRuntime`                    | The current `RequestEvent` as a service, and the default per-request runtime                                                                |
| `KitError` / `KitErrorBody`, `KitRedirect`, `KitActionFailure`                            | The tagged failures behind `SvelteKit.error` / `redirect` / `fail`                                                                          |
| `RemoteFunction`, `RemoteFunctionUsageError`                                              | [Remote functions](sveltekit-remote-functions.md)                                                                                           |
| `ResponseHeaders`                                                                         | The [response-headers buffer](sveltekit-hooks.md#response-headers-buffer-responseheaders)                                                   |
