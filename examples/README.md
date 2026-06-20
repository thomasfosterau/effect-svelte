# Examples

Example apps demonstrating the full surface area of the effect-svelte
package, modelled on widely used demo applications.

| Example                                      | App                                                   | Stack           | Focus                                                                               |
| -------------------------------------------- | ----------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| [`todomvc`](./todomvc)                       | [TodoMVC](https://todomvc.com)                        | Svelte 5 + Vite | `@thomasfosterau/effect-svelte` reactivity hooks (queries, mutations, invalidation) |
| [`hacker-news`](./hacker-news)               | Hacker News reader ([HNPWA](https://hnpwa.com)-style) | SvelteKit       | `@thomasfosterau/effect-sveltekit` (Vite plugin, wrappers, remote functions)        |
| [`realtime-dashboard`](./realtime-dashboard) | Market dashboard                                      | Svelte 5 + Vite | Streams, PubSub, SubscriptionRef, scopes, interruption                              |

## Running the examples

The examples are pnpm workspace members and consume the package by building
it first:

```bash
pnpm install
pnpm run build         # builds the library into dist/ (vp pack)
cd examples/<name>
pnpm run dev
```

Each example also has `typecheck` (svelte-check) and `build` scripts, which CI
runs for every example (`vp run --filter "example-*" typecheck|build`).

## API coverage

### `@thomasfosterau/effect-svelte`

| Export                                                          | Demonstrated in                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `provideRuntime`                                                | all examples (`App.svelte` / `+layout.svelte`)                                                     |
| `getRuntime`                                                    | realtime-dashboard — `lib/use-clock.svelte.ts` (custom hook)                                       |
| `SvelteRuntime` / `defaultSvelteRuntime`                        | todomvc + realtime-dashboard — `lib/runtime.ts`; hacker-news uses the default                      |
| `useEffect`                                                     | realtime-dashboard — `Connection.svelte` (run/interrupt); hacker-news — `bookmarks/+page.svelte`   |
| `useQuery`                                                      | hacker-news — `bookmarks/+page.svelte`                                                             |
| `useStream`                                                     | realtime-dashboard — `PriceTicker.svelte`, `SymbolSearch.svelte`                                   |
| `useDerived`                                                    | realtime-dashboard — `QuoteCard.svelte`                                                            |
| `useSubscriptionRef`                                            | realtime-dashboard — `Portfolio.svelte`                                                            |
| `usePubSub`                                                     | realtime-dashboard — `TradeFeed.svelte`                                                            |
| `useScope` / `useScopeCallback`                                 | realtime-dashboard — `Connection.svelte`                                                           |
| `reactiveQuery`                                                 | todomvc — `TodoApp.svelte`                                                                         |
| `reactiveMutation`                                              | todomvc — `TodoApp/TodoHeader/TodoItem/TodoFooter.svelte`; realtime-dashboard — `Portfolio.svelte` |
| `reactiveStream`                                                | realtime-dashboard — `Portfolio.svelte`                                                            |
| `useInvalidateKeys`                                             | todomvc — `TodoApp.svelte` (cross-tab sync)                                                        |
| `SignalEmitter`                                                 | realtime-dashboard — `SymbolSearch.svelte`                                                         |
| `AsyncResult` + `isInitial`/`isWaiting`/`isSuccess`/`isFailure` | todomvc, hacker-news, realtime-dashboard                                                           |
| `AsyncResult.match`                                             | realtime-dashboard — `QuoteCard.svelte`                                                            |
| `RuntimeLike`                                                   | realtime-dashboard — `lib/use-clock.svelte.ts`                                                     |

### `@thomasfosterau/effect-sveltekit`

| Export                                                                         | Demonstrated in (all in hacker-news)                     |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `effectKit()` Vite plugin                                                      | `vite.config.ts`                                         |
| Plugin: `serverRuntime` option (app-wide services)                             | `vite.config.ts` + `src/lib/server/runtime.ts`           |
| Plugin: bare-Effect `load`                                                     | `src/routes/[list=list]/[page]/+page.server.ts`          |
| Plugin: Effect-returning `handle`                                              | `src/hooks.server.ts`                                    |
| Plugin: plain-function pass-through                                            | `src/routes/+page.ts`                                    |
| `makeServerRuntime` (app-wide runtime)                                         | `src/lib/server/runtime.ts`                              |
| App runtime `serverLoad`                                                       | `src/routes/item/[id]/+page.server.ts`                   |
| App runtime `actions`                                                          | `src/routes/search/+page.server.ts`                      |
| App runtime `endpoint`                                                         | `src/routes/api/[list=list]/+server.ts`                  |
| `load` (universal wrapper)                                                     | `src/routes/user/[name]/+page.ts`                        |
| `serverLoad` / `actions` / `endpoint` (standalone)                             | available; the app-runtime forms are shown instead       |
| `handle` (explicit wrapper)                                                    | available; the plugin form is shown in `hooks.server.ts` |
| `effectAdapter` (Effect deployment adapter)                                    | `svelte.config.js` (`node build` to run it)              |
| `SvelteKitRuntime` (`forRequest`/`forFetch`/`extend`)                          | used by every wrapper; see `+layout.server.ts`           |
| `runWithSvelteKitRuntime`                                                      | `src/routes/+layout.server.ts`                           |
| `SvelteKitRequestEvent`                                                        | `src/routes/[list=list]/[page]/+page.server.ts`          |
| `RemoteFunction.query` / `.form` / `.command`                                  | `src/routes/bookmarks/bookmarks.remote.ts`               |
| `RemoteFunction.prerender` / `query.batch` / `query.live`                      | not demonstrated (same call shape as `query`)            |
| `Remote.callQuery` / `Remote.callCommandWithUpdates` / `Remote.submitForm`     | `src/routes/bookmarks/+page.svelte`                      |
| `Remote.callCommand` / `Remote.callPrerender` / `Remote.submitFormWithUpdates` | not demonstrated (same call shapes as the above)         |

**Also available (not exercised by the examples):** the svelte `Store` namespace
(`Store.toStream` / `Store.fromStream` / `Store.fromSubscriptionRef` /
`Store.fromPubSub` / `Store.fromQueue` / `Store.fromRef`); and, from
`@thomasfosterau/effect-sveltekit/client`, the `Navigation` namespace's
`beforeNavigate` / `afterNavigate` / `onNavigate`, `State.page`, and
`useRemoteQuery`.

## Notes

- **Plugin form vs. explicit wrappers.** The hacker-news example deliberately
  mixes both styles and its README explains the trade-off (generated `$types`
  only see through the explicit wrappers).
- **Network access.** hacker-news talks to the live Algolia HN API at
  runtime. The other two examples run fully offline.
