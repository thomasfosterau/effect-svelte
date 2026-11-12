---
"@thomasfosterau/effect-svelte": minor
---

**Breaking:** absence is modelled as `Option` (`effect/Option`) across the
package instead of `null` / `undefined` (#213). Each changed export, and the
one-line migration:

- `useStream(...).latest`, `usePubSub(...).latest` and
  `useReactiveStream(...).latest` (`UseStreamReturn`, `UsePubSubReturn`,
  `UseReactiveStreamReturn` / `ReactiveStreamReturn`) were `A | undefined` and
  are now `Option.Option<A>`: `None` until the first emission. Use
  `Option.getOrUndefined(x.latest)` for the old value, or
  `{#if Option.isSome(x.latest)}{x.latest.value}{/if}` in a template (an
  `Option` is always truthy, so `{#if x.latest}` no longer tests for a value).
- `useEffect(...).setData` and `useQuery(...).setData` (`UseEffectReturn`,
  `UseQueryReturn`): an updater function received `previous: A | undefined` and
  now receives `previous: Option.Option<A>`, `None` while the result holds no
  value. Replace `previous ?? fallback` with
  `Option.getOrElse(previous, () => fallback)`. Passing a plain value is
  unchanged.
- `useMutation`'s `onSuccess`, `onError` and `onSettled` (`MutationCallbacks`,
  `UseMutationOptions`) received `context: C | undefined` and now receive
  `context: Option.Option<C>`: `Some` with what `onMutate` returned, `None`
  when no `onMutate` was given. Replace `context?.snapshot` with
  `Option.map(context, (c) => c.snapshot)`, or `Option.getOrUndefined(context)`
  for the old value.
- `useScope().current` (`ScopeRef`) was `Scope.Closeable | null` and is now
  `Option.Option<Scope.Closeable>`: `None` until the component mounts. Replace
  `if (scope.current)` with `if (Option.isSome(scope.current))` and read
  `scope.current.value`.
- Options are declared `readonly x?: T` rather than `x?: T | undefined`:
  `MakeAtomRegistryOptions.defaultIdleTTL` / `.initialValues`,
  `UseAtomOptions.registry`, `UseDebouncedSearchOptions.debounce` /
  `.errorMessage` / `.runtime` and `SignalEmitterOptions.bufferSize`. With
  `exactOptionalPropertyTypes` on, passing an explicit `undefined`
  (`{ registry: undefined }`) is now a type error: omit the key instead.
  Runtime behaviour is unchanged.
