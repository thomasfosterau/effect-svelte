# @thomasfosterau/effect-sveltekit

Effect v4-native integration for **SvelteKit**: write `load` functions, form
actions, endpoints, hooks, and remote functions as Effects; move custom types
across the server/client boundary with Effect Schema; and deploy on an Effect
HTTP server.

Part of the [`effect-svelte`](https://github.com/thomasfosterau/effect-svelte)
monorepo. Depends on
[`@thomasfosterau/effect-svelte`](https://www.npmjs.com/package/@thomasfosterau/effect-svelte)
for the Svelte runes hooks.

## Installation

```bash
npm install @thomasfosterau/effect-sveltekit effect@beta svelte @sveltejs/kit
# the Effect deployment adapter additionally needs:
npm install @effect/platform-node@beta
```

## Entry points

| Import                             | What it provides                                                                                                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-sveltekit` | universal helpers (`load`, the `Remote` call namespace, `transport`, `sveltekitConfig`, `reroute`)                                                                                                                               |
| `…/server`                         | server wrappers (`serverLoad`, `action`, `actions`, `handle`, `endpoint`), app runtimes (`makeServerRuntime` / `makeUniversalRuntime`), the per-request runtime seam (`makeRuntimeAdapter` / `RequestRuntime`), `RemoteFunction` |
| `…/client`                         | browser-only `Navigation` / `State` / `Remote` namespaces and `useRemoteQuery`                                                                                                                                                   |
| `…/vite`                           | the `effectKit()` Vite plugin (auto-wrap bare-Effect route exports)                                                                                                                                                              |
| `…/adapter`                        | the Effect HTTP deployment adapter                                                                                                                                                                                               |

## Example

```ts
// vite.config.ts — return Effects directly from route files
import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-sveltekit/vite";

export default { plugins: [effectKit(), sveltekit()] };
```

```ts
// +page.server.ts
import { Effect } from "effect";
export const load = (event) => Effect.succeed({ id: event.params.id });
```

## What's included

- **Effects as route exports** — explicit wrappers, app-wide runtimes (services
  built once per process), or the `effectKit()` plugin.
- **Bring-your-own per-request runtime** — `makeRuntimeAdapter(provider, opts)`
  binds the server wrappers to a `RequestRuntime` provider, so the handler
  effect's services are your own application catalogue (not `SvelteKitServices`).
  Adopt a runtime the consumer stashed on `event.locals`
  (`RequestRuntime.fromLocals`, resolved per call so a mid-request rebuild is
  honoured), let the package build + dispose one per request
  (`RequestRuntime.fromLayerPerRequest`, with `afterResponse` to route disposal
  through Cloudflare Workers' `ctx.waitUntil`), or reuse the build-once model
  (`fromManagedRuntime` / `fromLayer`). `RemoteFunction.withRuntime(provider)`
  gives remote functions the same seam.
- **Pluggable boundary error translation** — pass `translateError` to
  `makeRuntimeAdapter`, `makeServerRuntime`, or `RemoteFunction.withRuntime` to
  map a failed `Cause` to SvelteKit control flow (`error(404)`, `redirect()`,
  remote-form `invalid()`) instead of a generic 500.
- **Remote functions** — define with `RemoteFunction.*` (a bare Effect `Schema`
  validator is accepted and auto-wrapped), consume via the `Remote` namespace
  (`Remote.callQuery`, `Remote.liveQueryStream`, …); `useRemoteQuery` bridges a
  reactive remote resource to an `AsyncResult`. `RemoteFunction.withRuntime` also
  takes a `formError` hook to map a domain error into SvelteKit field issues.
- **`transport` ⇄ Effect Schema** (`Hooks.transport` / `transporter`, plus
  `Hooks.markerTransporter` for non-round-tripping wrappers) and **`$env` ⇄
  Effect `Config`**.
- **Client navigation/state** — the `Navigation` (`goto`/`invalidate`/… plus
  `beforeNavigate`/`afterNavigate`/`onNavigate` streams) and `State` (`page`)
  namespaces.
- **Effect deployment adapter** — the generated app is a platform-neutral
  Effect `HttpApp` (`makeHandlerWith`): serve it as a production Node HTTP server
  (`effect/http` + `@effect/platform-node`, the default) or as a Web
  `fetch` handler on Cloudflare Workers (`effectAdapter({ target: "fetch" })` /
  `toWebHandler`). Asset serving is a pluggable `AssetSource`
  (`AssetSource.fileSystem` for Node, `AssetSource.cloudflareAssets(env.ASSETS)`
  for Workers, or any custom source — R2, KV, a CDN passthrough).

See the [monorepo README](https://github.com/thomasfosterau/effect-svelte#readme)
for the full API and a runnable SvelteKit example.

## License

MIT
