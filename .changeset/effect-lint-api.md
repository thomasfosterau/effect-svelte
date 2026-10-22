---
"@thomasfosterau/effect-svelte": minor
"@thomasfosterau/effect-sveltekit": minor
---

Tighten the public API to the Effect lint preset (#185). Breaking changes:

**effect-svelte**

- `getRuntime()` and `RuntimeContext.get()` throw the new exported `RuntimeNotFoundError` (a `Schema.TaggedError`, `_tag: "RuntimeNotFoundError"`, same `message`) instead of a plain `Error`.
- `useScope()` returns the new exported `ScopeRef` interface (`{ readonly current: Scope.Closeable | null }`).

**effect-sveltekit**

- The public error classes are now `Schema.TaggedError`s: `NavigationError`, `ApplyActionError`, `EventSourceError`, `WebSocketError`, `UpdateCheckError` and `ParseError`. Their `_tag`s, fields and constructors are unchanged; each now carries a schema (`cause` fields are `Schema.Defect()`), and constructing one validates its fields (`NavigationError`'s `operation` must be one of the listed operations).
- The `RemoteFunction` factories throw the new exported `RemoteFunctionUsageError` (same messages) instead of a plain `Error` when called with a schema but no handler, or when the installed SvelteKit lacks `query.live`.
- `QueryLiveFn` (and so `RemoteFunction.query.live` / `queryLive`) now returns SvelteKit's `RemoteLiveQueryFunction` instead of `RemoteQueryFunction`. The new type is what kit 3's `query.live` actually returns; the old one was wrong.
- `KitError.body` and `SvelteKit.error(status, body)` take the new exported `KitErrorBody`: a message string, or your app's `App.Error` with `status` optional (the body SvelteKit's own `error()` accepts) instead of any `Record<string, unknown>`. Declare extra fields on `App.Error` in `src/app.d.ts`.
- `KitActionFailure<T>`'s type parameter is unconstrained and defaults to `undefined`, as SvelteKit's `fail()`.
- `Errors.AnyTagged` is removed. `Errors.toSvelteKit` without a type argument now types its callbacks' error as `Tagged` (only `_tag`); pass your error union (`Errors.toSvelteKit<AppError>(…)`) to read its fields.
- `State`'s `CurrentPageShape` is renamed `CurrentPageService`, and `ReadonlyPage.data` is `App.PageData`.
- `useRemoteQuery` returns the new exported `RemoteQueryResult<T>` interface.
- `Remote.RemoteSubmit` and `Remote.submitForm` take SvelteKit 3's `submit()`, which resolves with a `boolean`.
- `TestRequestEvent`'s `locals` option is typed `App.Locals` and `platform` `App.Platform`.
- The adapter: `AssetSource.fileSystem` / `makeHandler`'s `prerendered` option accepts any `Iterable<string>` (the build's `Set` still works). A rejected SvelteKit `server.init` / `server.respond` or Cloudflare assets `fetch` is still a defect, now wrapping the rejection in the exported `SvelteKitServerError` / `AssetFetchError` (the original value is its `cause`).
- `Endpoint.fromStream`'s default `data:` encoder is Effect's JSON schema encoder; an element JSON cannot represent (such as a `bigint`) ends the stream with a defect.
- The endpoint error log (`Endpoint error: …`) is written through Effect's `Console` service; with the default `Console`, the output is unchanged.

The `effect-sveltekit` README now says why it lists `effect-svelte` as a dependency, and that an app importing `effect-svelte` itself must list it too (#186).
