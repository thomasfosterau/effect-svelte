# `@thomasfosterau/effect-sveltekit`: remote functions

SvelteKit [remote functions](https://svelte.dev/docs/kit/remote-functions) with Effect handlers: define them on the server with `RemoteFunction`, call them as Effects with `Remote`, and read a reactive remote resource as an `AsyncResult` with `useRemoteQuery`. Related pages: [runtimes and error translation](sveltekit-server.md), [testing](sveltekit-testing.md).

- [Defining remote functions (`RemoteFunction`)](#defining-remote-functions-remotefunction)
- [Running on your own services (`RemoteFunction.withRuntime`)](#running-on-your-own-services-remotefunctionwithruntime)
- [Calling remote functions (`Remote`)](#calling-remote-functions-remote)
- [A remote resource as an `AsyncResult` (`useRemoteQuery`)](#a-remote-resource-as-an-asyncresult-useremotequery)

## Defining remote functions (`RemoteFunction`)

`RemoteFunction` (from `@thomasfosterau/effect-sveltekit/server`) has SvelteKit's `query` (with `query.batch` and `query.live`), `form`, `command` and `prerender`, each taking an Effect handler and returning SvelteKit's own type (`RemoteQueryFunction`, `RemoteForm`, …). Call them in your own `*.remote.ts` files:

```ts
// src/routes/todos/todos.remote.ts
import { RemoteFunction } from "@thomasfosterau/effect-sveltekit/server";
import { Effect, Schema } from "effect";

export const getTodos = RemoteFunction.query(() =>
  Effect.succeed([{ id: "1", text: "Write docs" }]),
);

export const getTodo = RemoteFunction.query(Schema.String, (id) =>
  Effect.succeed({ id, text: "Write docs" }),
);
```

- **Validators.** The validator argument is `"unchecked"`, a Standard Schema, or a bare Effect `Schema`, which is accepted and wrapped for you.
- **Runtime.** Handlers run on the default per-request runtime (`HttpClient` plus `SvelteKitRequestEvent`). A failure that is not a SvelteKit `error()` / `redirect()` becomes a 500.
- **`RemoteFunction.requested`** is SvelteKit's `requested` from `$app/server`, with SvelteKit's own signature: inside a remote `command` or `form`, the `{ arg, query }` entries for the `query` (or `query.live`) instances the client asked to refresh (or reconnect), up to `limit`.
- **`RemoteFunctionUsageError`** is thrown synchronously, when a remote function is defined, by a factory called with arguments no overload accepts (a schema with no handler), or by `requested` on a SvelteKit version that does not provide it. It is a programming error in the `*.remote.ts` module, never a request failure.

## Running on your own services (`RemoteFunction.withRuntime`)

`RemoteFunction.withRuntime(provider, opts)` binds `query`, `form`, `command` and `prerender` to a [`RequestRuntime` provider](sveltekit-server.md#bring-your-own-per-request-runtime), so their handlers run on your own application services. It takes two optional hooks:

- `translateError` maps a failed `Cause` to SvelteKit control flow, as for the [server wrappers](sveltekit-server.md#boundary-error-translation).
- `formError` maps a remote form handler's failure into SvelteKit field issues. It receives the squashed failure and the form's `{ issue, data }`, and may call `invalid()`, so a domain validation failure drives field-level invalidation rather than a generic failure. When given, it runs instead of `translateError` on the form's failure path.

```ts
// src/lib/server/effect/remote.ts
import { Errors, RemoteFunction, RequestRuntime } from "@thomasfosterau/effect-sveltekit/server";
import type { AppError } from "#lib/errors.ts";

export const { query, form, command, prerender } = RemoteFunction.withRuntime(
  RequestRuntime.fromLocals((event) => event.locals.runtime),
  { translateError: Errors.toSvelteKit<AppError>({ NotFound: 404 }) },
);
```

## Calling remote functions (`Remote`)

The `Remote` namespace turns a remote call into an Effect. It is exported from both the root entry and `…/client`, and every member is also a named export (`callQuery`, `callCommand`, …), which is the form to prefer in the browser bundle.

| Member                                                 | What it does                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `Remote.callQuery(query, input?)`                      | Calls a remote `query`, succeeding with its output                                                           |
| `Remote.callCommand(command, input?)`                  | Calls a remote `command`                                                                                     |
| `Remote.callCommandWithUpdates(command, input, ...qs)` | Calls a command and refreshes the given queries in the same round trip (single-flight mutation)              |
| `Remote.callPrerender(prerender, input?)`              | Calls a remote `prerender` function                                                                          |
| `Remote.submitForm(submit)`                            | Runs an enhanced remote form's `submit()`                                                                    |
| `Remote.submitFormWithUpdates(submit, ...qs)`          | Runs `submit()` and refreshes the given queries in the same round trip                                       |
| `Remote.liveQueryStream(liveQuery)`                    | A live query (`query.live(...)`) as a `Stream` of every update the server pushes (`Stream<Output, unknown>`) |

Each call fails with the remote call's rejection reason, typed `unknown` and passed through unchanged. On the client, a server-side `error()` arrives as SvelteKit's `HttpError`; a server-side `redirect()` navigates instead of failing (commands may not `redirect()`, and SvelteKit rejects one with an `Error`).

```ts
import { liveQueryStream } from "@thomasfosterau/effect-sveltekit/client";
import { useStream } from "@thomasfosterau/effect-svelte";
import { messages } from "./chat.remote";

const feed = useStream(liveQueryStream(messages()));
```

## A remote resource as an `AsyncResult` (`useRemoteQuery`)

`useRemoteQuery` (from `…/client`) bridges a reactive remote resource (`query(...)`, `query.live(...)`, `prerender(...)`) to the `AsyncResult` the `@thomasfosterau/effect-svelte` hooks expose, read through `.current`. The resource's `loading` flag becomes `waiting`, so a refresh keeps the previous `Success` on screen.

```svelte
<script lang="ts">
  import { useRemoteQuery } from "@thomasfosterau/effect-sveltekit/client";
  import { AsyncResult } from "@thomasfosterau/effect-svelte";
  import { getTodos } from "./todos.remote";

  const todos = useRemoteQuery(getTodos());
</script>

{#if AsyncResult.isSuccess(todos.current)}
  <ul>{#each todos.current.value as todo}<li>{todo.text}</li>{/each}</ul>
{/if}
```

To import `AsyncResult` (or any other `@thomasfosterau/effect-svelte` export) in your own code, list that package in your app's dependencies as well.
