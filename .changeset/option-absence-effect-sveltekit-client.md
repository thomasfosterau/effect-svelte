---
"@thomasfosterau/effect-sveltekit": minor
---

**Breaking:** the client state, navigation and forms surface
(`@thomasfosterau/effect-sveltekit/client`) models absence as `Option`
(`effect/Option`) instead of `null` / `undefined` (#213). Each changed export,
and the one-line migration:

- `State.PageSnapshot` (what `State.page()`, `State.CurrentPage`'s `get` and
  `changes` produce): `route.id` was `string | null` and is now
  `Option.Option<string>` (`None` when no route is matched); `error` was
  `App.Error | null` and is now `Option.Option<App.Error>` (`None` when the
  page has not failed); `shallow` was `{ params, route, url } | null` and is
  now an `Option` of that object (`None` when no shallow navigation has
  occurred). Replace `page.route.id ?? fallback` with
  `Option.getOrElse(page.route.id, () => fallback)`, and `if (page.error)` with
  `if (Option.isSome(page.error))`, reading `page.error.value`.
  `Option.getOrNull(page.error)` gives the old value. `url`, `params`,
  `status`, `data`, `state` and `form` are unchanged.
- `State.NavigatingSnapshot` (inside the `Option` that `State.navigating()`
  emits): `from` and `to` were `NavigationTarget | null` and are now
  `Option.Option<NavigationTarget>` (`None` where SvelteKit's is `null`);
  `delta` was `number | null` and is now `Option.Option<number>` (`Some` for a
  back / forward `popstate` navigation, `None` for every other type). Replace
  `nav.to?.url.pathname` with `Option.map(nav.to, (to) => to.url.pathname)`,
  and `nav.delta ?? 0` with `Option.getOrElse(nav.delta, () => 0)`. `type`,
  `willUnload` and `complete` are unchanged, and a `NavigationTarget` is still
  SvelteKit's own object.
- An `Option` is always truthy, so a template check such as `{#if nav.from}` or
  `{#if page.error}` no longer tests for a value: write
  `{#if Option.isSome(nav.from)}{nav.from.value.url.pathname}{/if}`.
- `Forms.EnhanceHandlers` (`onSubmit`, `onResult`, `onError`) and
  `Forms.EnhanceOptions` (`runtime`) are declared `readonly x?: T` rather than
  `x?: T | undefined`, and `Forms.EnhanceOptionsArgs<never>` is
  `[options?: EnhanceOptions]`. With `exactOptionalPropertyTypes` on,
  `Forms.enhance({ onResult: undefined })`,
  `Forms.enhance(handlers, { runtime: undefined })` and
  `Forms.enhance(handlers, undefined)` are now type errors: omit the key or the
  argument instead (to forward an optional handler, spread an object whose key
  is optional rather than passing a possibly-`undefined` value). Runtime
  behaviour is unchanged: a plain JavaScript caller that passes `undefined`
  still gets the behaviour of an absent handler.

Not changed: the events of `Navigation.beforeNavigate()`, `afterNavigate()` and
`onNavigate()` are SvelteKit's own navigation objects and keep its `null`s, and
`Forms.applyAction` / `Forms.deserialize` accept the same `Success` / `Failure`
types as before (their constraints are now read off `$app/forms`' `applyAction`
instead of being restated).
