---
"@thomasfosterau/effect-sveltekit": minor
---

feat(sveltekit): add `/testing` subpath with framework-agnostic test utilities (#43)

Adds `@thomasfosterau/effect-sveltekit/testing` — a new subpath export with
plain-async helpers for unit-testing Effect-based SvelteKit handlers without
mocking `$app/server` or the SvelteKit module graph.

## New exports

### `TestRequestEvent(opts?)`

Creates a minimal `RequestEvent` for use in tests. Cookies are backed by an
in-memory `Map`; all fields are optional with sensible defaults:

```ts
const event = TestRequestEvent({
  url: "http://localhost/items/42",
  params: { id: "42" },
  locals: { user },
  cookies: { session: "tok_test" },
  method: "POST",
  headers: { "content-type": "application/json" },
  fetch: myMockFetch,
});
```

### `runServerLoad(fn, event, opts?)`

Run an Effect-based server `load` function under test, providing services via
`opts.layer`. Error translation defaults to `SvelteKit.translate`.

```ts
const data = await runServerLoad(
  (event) =>
    Effect.gen(function* () {
      const db = yield* Database;
      return { items: yield* db.list() };
    }),
  event,
  { layer: TestDatabase.layer },
);
```

### `runAction(fn, event, opts?)`

Run an Effect-based form action handler.

### `runEndpoint(fn, event, opts?)`

Run an Effect-based `+server.ts` endpoint handler, returning the `Response`.

### `runRemote(event, opts?)`

Build a `{ run, runForm }` pair for directly invoking remote-function Effect
handlers without going through `$app/server.getRequestEvent()`:

```ts
const { run } = runRemote(event, { layer: TestDatabase.layer });
const items = await run(listItemsEffect());
```

## Exported types

`TestRequestEventOptions`, `TestRunOptions<R>`, `RunRemoteOptions<R>`,
`RunHelpers`, `FormErrorMapper`.
