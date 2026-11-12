# `@thomasfosterau/effect-sveltekit`: testing

`@thomasfosterau/effect-sveltekit/testing` has a fake `RequestEvent` and runners for unit-testing Effect-based loads, actions, endpoints and remote-function handlers without mocking the SvelteKit module graph or installing `$app/server`. It is not coupled to a test framework: the runners return plain promises.

- [A request event (`TestRequestEvent`)](#a-request-event-testrequestevent)
- [Loads, actions and endpoints](#loads-actions-and-endpoints)
- [Remote-function handlers (`runRemote`)](#remote-function-handlers-runremote)

## A request event (`TestRequestEvent`)

`TestRequestEvent(options)` creates a minimal `RequestEvent`. Every option is optional; omit what the handler under test does not read.

```ts
import { TestRequestEvent } from "@thomasfosterau/effect-sveltekit/testing";

const event = TestRequestEvent({
  url: "http://localhost/items/42",
  params: { id: "42" },
  locals: { user: { id: "u1", role: "admin" } },
  cookies: { session: "tok_test" },
});
```

| Option     | Default               | What it sets                                                                     |
| ---------- | --------------------- | -------------------------------------------------------------------------------- |
| `url`      | `"http://localhost/"` | The request URL (a `string` or a `URL`)                                          |
| `method`   | `"GET"`               | The HTTP method                                                                  |
| `headers`  | none                  | Headers of the underlying `Request`                                              |
| `body`     | none                  | The request body, for methods that accept one                                    |
| `params`   | `{}`                  | Route params                                                                     |
| `locals`   | `{}`                  | The initial `event.locals`, typed as your `App.Locals`                           |
| `cookies`  | none                  | Pre-seeded cookies as `{ name: value }`; `set` and `delete` show in later `get`s |
| `platform` | none                  | `event.platform`                                                                 |
| `fetch`    | `globalThis.fetch`    | `event.fetch`; pass a function to intercept or stub the handler's network calls  |

The event is a complete `RequestEvent` with test values: tracing is off (`event.tracing` holds no-op spans), `isRemoteRequest` is `false`, `route.id` is `null`, `setHeaders` does nothing and `getClientAddress()` returns `"127.0.0.1"`. Its in-memory cookies have no `Set-Cookie` parser: `cookies.parse` throws a `TestCookiesParseError`.

## Loads, actions and endpoints

`runServerLoad`, `runAction` and `runEndpoint` each take the handler (a function from the event to an Effect), the event and options, and return a promise of what SvelteKit would receive.

```ts
import { runServerLoad, TestRequestEvent } from "@thomasfosterau/effect-sveltekit/testing";
import { Effect } from "effect";

const data = await runServerLoad(
  (event) =>
    Effect.gen(function* () {
      const db = yield* Database;
      return { item: yield* db.findById(event.params.id) };
    }),
  TestRequestEvent({ params: { id: "1" } }),
  { layer: TestDatabase.layer },
);
```

| Option           | What it is                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layer`          | The `Layer` providing the handler's services. Omit it when the handler requires none                                                                       |
| `translateError` | Translates a failed `Cause` at the boundary. Defaults to `SvelteKit.translate`: Kit control flow passes through and anything else is an `EffectCauseError` |

The handler runs through `makeRuntimeAdapter` on `RequestRuntime.fromLayer(layer)`, so its services are exactly what `layer` provides, and a failure rejects the promise with what the translator throws (SvelteKit's `redirect` / `error`, or the `EffectCauseError`).

## Remote-function handlers (`runRemote`)

`runRemote(event, options)` returns a `{ run, runForm }` pair that runs a remote-function handler's Effect directly. The production `query` / `command` / `form` helpers find the request event through `$app/server`'s `getRequestEvent()`; here it is the `event` you pass. Use `run` for `query` / `command` handlers and `runForm` for `form` handlers that need the `issue` / `data` context.

```ts
import { runRemote, TestRequestEvent } from "@thomasfosterau/effect-sveltekit/testing";

const { run } = runRemote(TestRequestEvent(), { layer: TestDatabase.layer });

// The handler's Effect, not the remote function itself.
const items = await run(listItemsEffect());
```

Besides `layer` and `translateError`, `runRemote` takes `formError`, which maps a form handler's failure to SvelteKit field issues as [`RemoteFunction.withRuntime`'s `formError`](sveltekit-remote-functions.md#running-on-your-own-services-remotefunctionwithruntime) does.

The request services (`SvelteKitCookies`, `SvelteKitResponseHeaders`, `SvelteKitLocals`) are tagged services, so a test can also replace them with `Layer.succeed` stubs.
