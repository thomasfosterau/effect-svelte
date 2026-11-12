# `@thomasfosterau/effect-sveltekit`: client navigation, state and forms

The browser-only entry, `@thomasfosterau/effect-sveltekit/client`: Effect wrappers for `$app/navigation`, `$app/state` and `$app/forms`, realtime streams and the client hooks. Related pages: [remote functions](sveltekit-remote-functions.md) (the `Remote` namespace and `useRemoteQuery`), [hooks](sveltekit-hooks.md) (`Hooks.handleError` / `Hooks.init`).

- [The namespaces](#the-namespaces)
- [Prefer named imports](#prefer-named-imports)
- [Navigation](#navigation)
- [State](#state)
- [Snapshots and their `Option` fields](#snapshots-and-their-option-fields)
- [Native form actions (`Forms`)](#native-form-actions-forms)
- [Realtime](#realtime)

## The namespaces

```ts
import {
  // $app/navigation: promise wrappers (goto, invalidate, ...) and lifecycle
  // events as Effect Streams (beforeNavigate/afterNavigate/onNavigate)
  Navigation,
  // $app/state: page / navigating / updated as Streams, plus the
  // CurrentPage service
  State,
  // $app/forms: enhance, applyAction, deserialize
  Forms,
  // EventSource / WebSocket as Streams
  Realtime,
  // remote-function helpers (callQuery, callCommand, liveQueryStream, ...)
  Remote,
  // a reactive remote resource as an AsyncResult
  useRemoteQuery,
  // hooks.client.ts hooks as Effects: Hooks.handleError / Hooks.init
  Hooks,
} from "@thomasfosterau/effect-sveltekit/client";

// e.g. Navigation.goto('/done'), Navigation.refreshAll(),
//      Remote.callQuery(getTodos), State.page()
```

## Prefer named imports

Every member of `Navigation`, `State`, `Remote`, `Realtime`, `Forms` and `Hooks` is also a named export of `…/client` (`goto`, `page`, `callQuery`, `fromEventSource`, `enhance`, `handleError`, …), and the named imports are the ones to prefer in the browser bundle. The published build turns each namespace into a single object, so `Navigation.goto` also keeps `beforeNavigate`, `afterNavigate`, `onNavigate` and the navigation-event registry behind them, while `import { goto } from "@thomasfosterau/effect-sveltekit/client"` keeps only `goto` and what it uses.

## Navigation

`Navigation.goto`, `invalidate`, `invalidateAll`, `refreshAll`, `preloadData` and `preloadCode` fail with `Navigation.NavigationError` when SvelteKit rejects or throws: for example, `goto` to a URL outside the app, `preloadData` for an `href` outside the app, a navigation whose `beforeNavigate` / `onNavigate` callback throws, or any of them run during server rendering. The error's `operation` names the wrapper and its `cause` is SvelteKit's original reason; recover with `Effect.catchTag("NavigationError", ...)`.

`Navigation.beforeNavigate()` / `Navigation.afterNavigate()` bridge `$app/navigation`'s callback-registration functions to `Stream`s, `Navigation.onNavigate(fn => Effect)` runs an Effect per navigation (forwarding any cleanup the Effect yields), and `State.page()` emits a shallow snapshot of `$app/state`'s `page` initially and after each navigation. Like the bare SvelteKit functions they wrap, these must be called during component initialization (at the top of `<script>`).

The events of `Navigation.beforeNavigate()`, `afterNavigate()` and `onNavigate()` are SvelteKit's own navigation objects, not snapshots, and keep its `null`s.

## State

`State.page()` follows `afterNavigate` and must be called during component initialization. The rest of `State` watches `$app/state` directly, so it works anywhere on the client (not only during component initialization):

| Export                   | What it is                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `State.navigating()`     | `Stream<Option<NavigatingSnapshot>>` — `Some` while a navigation is in flight (`type`, `from`, `to`, `willUnload`, `delta`, `complete`), `None` when idle    |
| `State.updated()`        | `Stream<boolean>` — `updated.current`: whether a new app version has been deployed                                                                           |
| `State.checkForUpdate()` | `Effect<boolean, UpdateCheckError>` — `updated.check()` now; fails with `UpdateCheckError` if the check rejects                                              |
| `State.CurrentPage`      | A `Context` service: `get` (snapshot the page now) and `changes` (a stream that also emits on shallow routing and form results); provide `CurrentPage.layer` |

Each stream emits the current value on the next Svelte flush, then on every change, and stops watching when it ends or is interrupted. None of them fail.

```ts
import { State } from "@thomasfosterau/effect-sveltekit/client";
import { Effect, Option } from "effect";

// Any client Effect can read the page once CurrentPage.layer is provided
// (e.g. in the layer behind your client runtime).
const logPath = Effect.gen(function* () {
  const page = yield* (yield* State.CurrentPage).get;
  // `route.id` is an Option: None when no route is matched.
  const route = Option.getOrElse(page.route.id, () => "(no route)");
  yield* Effect.logInfo(`at ${page.url.pathname} (${route})`);
}).pipe(Effect.provide(State.CurrentPage.layer));
```

## Snapshots and their `Option` fields

The snapshots are this package's own plain-data copies, and model absence as an `Option` where `$app/state` has `null`:

| Snapshot field                    | Type                             | `None` means                                            |
| --------------------------------- | -------------------------------- | ------------------------------------------------------- |
| `PageSnapshot` `route.id`         | `Option<string>`                 | no route is matched                                     |
| `PageSnapshot` `error`            | `Option<App.Error>`              | the page has not failed                                 |
| `PageSnapshot` `shallow`          | `Option<{ params, route, url }>` | no shallow navigation has occurred                      |
| `NavigatingSnapshot` `from`, `to` | `Option<NavigationTarget>`       | SvelteKit's `from` / `to` is `null`                     |
| `NavigatingSnapshot` `delta`      | `Option<number>`                 | the navigation is not a back / forward (`popstate`) one |

The other fields (`url`, `params`, `status`, `data`, `state`, `form`; `type`, `willUnload`, `complete`) are SvelteKit's values, unchanged, as is a `NavigationTarget` itself. An `Option` is always truthy, so test it with `Option.isSome`: `{#if Option.isSome(nav.to)}{nav.to.value.url.pathname}{/if}` in a template, not `{#if nav.to}`.

## Native form actions (`Forms`)

For SvelteKit page `actions`, the `Forms` namespace expresses progressive enhancement with Effects: `Forms.enhance({ onSubmit, onResult, onError }, { runtime })` builds a `SubmitFunction` for `use:enhance`, and `Forms.applyAction` / `Forms.deserialize` wrap the `$app/forms` helpers, with the same type parameters (`Forms.deserialize<Success, Failure>(body)` takes both or neither, as `deserialize` does). `Forms.applyAction` fails with `Forms.ApplyActionError` (SvelteKit's original reason as its `cause`) when SvelteKit rejects or throws: for example, when the navigation that follows a `redirect` result fails, or when it runs during server rendering.

### The runtime

The handlers (and `onError`) run on `runtime`, a `Context` or `ManagedRuntime`. It is required, and checked to provide every service they require, as soon as any handler requires one: there is no ambient runtime to fall back on, so such a call without it does not type-check. Each handler may require different services; the runtime must provide all of them.

- A missing runtime is reported on the `Forms.enhance` call, and one that lacks a service on the runtime, never on a handler. The message may at first name only the services of the handlers TypeScript types first (such as an `onError` passed by name, before handlers whose parameters are not annotated), and the rest once the runtime provides those.
- Handlers that require no services run on the default runtime, and the options may be omitted.
- An absent handler, runtime or options argument is left out, not passed as `undefined` (`{ onResult: undefined }` and `{ runtime: undefined }` do not type-check under `exactOptionalPropertyTypes`).
- An effect typed as requiring `any` or `unknown` is treated as requiring no services, so no runtime is demanded.
- A function that wraps `Forms.enhance` for handlers requiring any `R` forwards its options as `...options: Forms.EnhanceOptionsArgs<R>`, which keeps them optional exactly when `R` is `never` (an `EnhanceOptions<R>`, whose runtime is optional, does not type-check there).

### Failures

`onSubmit` and `onResult` may fail. The `onError` handler receives the error, typed as the union of their error types, and runs on the same runtime; it must not fail itself. Write `onError` after the other handlers: written before one whose parameters are not annotated, it still type-checks, but its `error` parameter is `unknown`. A failed `onSubmit` also cancels the submission, and a failed `onResult` does not fall back to SvelteKit's default behaviour. Without `onError`, a failure is treated like a defect: the promise SvelteKit awaits rejects with the error, SvelteKit sends no request after a failed `onSubmit` and applies no default result after a failed `onResult`, and the browser reports an unhandled rejection. Defects and interruptions always take that path rather than reaching `onError`.

```ts
const submit = Forms.enhance({
  onResult: ({ result }) => Forms.applyAction(result),
  // error: ApplyActionError
  onError: (error) => Effect.logWarning("applyAction failed", error.cause),
});

const submitAndRecover = Forms.enhance({
  // Or recover inside the handler, so onResult cannot fail.
  onResult: ({ result }) =>
    Forms.applyAction(result).pipe(
      Effect.catchTag("ApplyActionError", (error) =>
        Effect.logWarning("applyAction failed", error.cause),
      ),
    ),
});
```

(This complements `Remote.submitForm`, which covers [remote forms](sveltekit-remote-functions.md#calling-remote-functions-remote).)

## Realtime

`Realtime.fromEventSource(url, options)` consumes a Server-Sent-Events endpoint (for example one served by [`Endpoint.fromStream`](sveltekit-server.md#endpoints-backed-by-effect)) as a `Stream` of `SseMessage`, and `Realtime.fromWebSocket(url, options)` consumes a `WebSocket` as a `Stream` of its message payloads. The source is opened when the stream is run and closed when its scope closes. `fromEventSource` fails with `EventSourceError` when the connection closes fatally or the `EventSource` constructor throws; `fromWebSocket` ends when the socket closes cleanly and fails with `WebSocketError` on an error, an unclean close or a constructor that throws. Both take an `implementation` option to replace the browser global (a polyfill, or a fake in tests).
