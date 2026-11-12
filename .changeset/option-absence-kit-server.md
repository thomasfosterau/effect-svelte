---
"@thomasfosterau/effect-sveltekit": minor
---

**Breaking:** the server, request and testing APIs model absence as `Option`
(`effect/Option`) instead of `null` / `undefined`, and no longer restate
SvelteKit's nullable types by hand (#213). Each changed export, and the
one-line migration:

- `ServerRuntime.requestRuntime(event)` (`makeServerRuntime(...).requestRuntime`)
  returned `RequestRuntime<R> | undefined` and now returns
  `Option.Option<RequestRuntime<R>>`: `Some` inside a request that went through
  this runtime's `handle`, `None` otherwise. Replace `rt?.runPromise(effect)`
  with `if (Option.isSome(rt)) await rt.value.runPromise(effect)`, or
  `Option.getOrUndefined(runtime.requestRuntime(event))` for the old value (an
  `Option` is always truthy, so `if (rt)` no longer tests for a runtime).
- `Endpoint.fromStream`'s per-element callbacks (`FromStreamOptions.event` as a
  function, and `FromStreamOptions.id`) returned `string | undefined` and now
  return `Option.Option<string>`: `Some(value)` sends the SSE field, `None`
  omits it for that element. Replace `id: (v) => v.id` with
  `id: (v) => Option.some(v.id)`, and a callback that returned `undefined` with
  one returning `Option.none()` (`Option.fromUndefinedOr(v.kind)` converts an
  optional field). A static `event: "name"` is unchanged.
- `KitTranslatorCase` (the cases of `SvelteKit.makeTranslator`) was
  `(error) => undefined | void` and is now `(error) => void`: a case throws to
  handle the error or returns to pass, and its result was always ignored.
  Existing cases compile unchanged.
- Options are declared `readonly x?: T` rather than `x?: T | undefined`:
  `ToSvelteKitOptions.fallback` and the `message` of a `{ status, message }`
  `CatalogueEntry` (`Errors.toSvelteKit`). With `exactOptionalPropertyTypes` on,
  passing an explicit `undefined` (`{ fallback: undefined }`) is now a type
  error: omit the key instead. Runtime behaviour is unchanged.
- The `RouteId` type parameter of `serverLoad`, `action`, `actions`, `endpoint`
  (standalone, on `ServerRuntime` and on `RuntimeAdapter`) and of `load` /
  `UniversalRuntime.load` was constrained to a hand-written `string | null` and
  is now constrained to SvelteKit's own `RequestEvent["route"]["id"]`; `load`'s
  `InputData` is constrained to SvelteKit's `LoadEvent["data"]`. Inferred calls
  and `./$types` annotations are unchanged. In an app with generated route
  types, an explicit `RouteId` type argument must be one of the app's route ids
  (or SvelteKit's "no route" value), exactly as `RequestEvent<Params, RouteId>`
  already required.
- `TestRequestEventOptions.body` (`…/testing`) is typed as `fetch`'s own
  `RequestInit["body"]` instead of a restated `BodyInit | null`: the same
  values, plus the explicit `undefined` that `RequestInit` itself admits.
- `prerender(handler, options)` (the form without a schema) now throws a
  `RemoteFunctionUsageError` when its second argument is a function, which its
  types already rejected.
