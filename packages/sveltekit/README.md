# @thomasfosterau/effect-sveltekit

[Effect](https://effect.website) v4 for SvelteKit 3: wrappers that let a route's `load`, `actions`, `+server.ts` handlers, hooks and remote functions return Effects, client helpers for navigation, state and forms, an optional `effectKit()` Vite plugin, and a deployment adapter whose server is an Effect HTTP server. It does not replace SvelteKit's routing or data loading: every wrapper returns SvelteKit's own function types. The Svelte runes hooks (`useDerived`, `AsyncResult`, …) are in [`@thomasfosterau/effect-svelte`](https://www.npmjs.com/package/@thomasfosterau/effect-svelte).

## Install

```bash
pnpm add @thomasfosterau/effect-sveltekit effect svelte @sveltejs/kit
# the Effect deployment adapter additionally needs:
pnpm add @effect/platform-node
```

- `effect` (`^4.0.0`) and `svelte` (`^5.40.0`) are required peers. `@sveltejs/kit` (`^3.2.0`), `vite` (for `./vite`) and `@effect/platform-node` (`^4.0.0`, for `./adapter`) are optional peers.
- Keep a single copy of `effect`, and keep `effect` and `@effect/platform-node` on the same exact version. The HTTP modules that lived in `@effect/platform` in v3 are part of `effect` itself in v4 (`effect/http`), so no other Effect package is needed.
- `./adapter` needs `@effect/platform-node` installed at build time for either target, `target: "fetch"` included (a Workers deployment never loads it). Its production Node server needs Node `>=22.19`, although the package itself declares `>=22.17`.
- `@thomasfosterau/effect-svelte` is a dependency, so a compatible version is always installed alongside. To import its hooks in your own code, add it to your app's dependencies too: pnpm only lets a package import what it lists itself.

## Example

Wrap a route's `load` so it returns an Effect:

```ts
// src/routes/items/[id]/+page.server.ts
import { serverLoad } from "@thomasfosterau/effect-sveltekit/server";
import { Effect } from "effect";

export const load = serverLoad((event) => Effect.succeed({ id: event.params.id }));
```

The same wrappers exist for actions, endpoints and hooks, on the default per-request runtime or on your own services (`makeServerRuntime`, `makeRuntimeAdapter`).

## Entry points

| Entry point                        | What it provides                                                                                                                                                                                                | Docs                                                                                                                                                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@thomasfosterau/effect-sveltekit` | Universal (server and client): `load` / `makeUniversalRuntime`, `Remote`, `Hooks` (`reroute`, `transport`), `ResponseHeaders`, `sveltekitConfig` / `readConfig`, `apiClient`                                    | [Server](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-server.md), [hooks](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-hooks.md)                       |
| `…/server`                         | `serverLoad`, `action`, `actions`, `endpoint`, `Hooks`, `Endpoint`, `makeServerRuntime`, `makeRuntimeAdapter` / `RequestRuntime`, `Errors`, `SvelteKit`, `RemoteFunction`, request decoding (`decodeParams`, …) | [Server](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-server.md), [remote functions](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-remote-functions.md) |
| `…/client`                         | Browser-only `Navigation`, `State`, `Forms`, `Realtime`, `Remote` and `Hooks`, each also exported member by member, and `useRemoteQuery`                                                                        | [Client](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-client.md)                                                                                                                    |
| `…/vite`                           | The `effectKit()` Vite plugin, which wraps bare-Effect route exports                                                                                                                                            | [Vite plugin](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-vite-plugin.md)                                                                                                          |
| `…/testing`                        | A fake `RequestEvent` and runners for unit tests (`TestRequestEvent`, `runServerLoad`, `runAction`, `runEndpoint`, `runRemote`)                                                                                 | [Testing](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-testing.md)                                                                                                                  |
| `…/adapter`                        | The Effect deployment adapter (`effectAdapter`), for Node or a Web `fetch` handler                                                                                                                              | [Adapter](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-adapter.md)                                                                                                                  |
| `…/adapter/handler`                | The SvelteKit app as an Effect HTTP app (`makeHandler`, `makeHandlerWith`, `AssetSource`, `toWebHandler`)                                                                                                       | [Adapter](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-adapter.md)                                                                                                                  |
| `…/adapter/serve`                  | The Node server the adapter's `index.js` runs (`serve`, `layer`)                                                                                                                                                | [Adapter](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-adapter.md)                                                                                                                  |

`…/internal/auto` is imported by the code `effectKit()` generates; it is not a public API.

In the browser bundle prefer the named exports (`goto`, `callQuery`, `transport`, …) over the namespaces (`Navigation.goto`, …): the published build turns each namespace into one object, which keeps all of its members.

## Links

- Docs: [loads, actions, endpoints and runtimes](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-server.md) · [hooks, `transport` and `ResponseHeaders`](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-hooks.md) · [client navigation, state and forms](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-client.md) · [remote functions](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-remote-functions.md) · [deployment adapter](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-adapter.md) · [Vite plugin](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-vite-plugin.md) · [testing](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/sveltekit-testing.md)
- [Cookbook](https://github.com/thomasfosterau/effect-svelte/blob/trunk/docs/cookbook.md): a typed `apiClient` for an `Endpoint.fromApi`, build-time and runtime `$env` config, and app-side patterns.
- [Changelog](https://github.com/thomasfosterau/effect-svelte/blob/trunk/packages/sveltekit/CHANGELOG.md)
- [Repository](https://github.com/thomasfosterau/effect-svelte) and [issues](https://github.com/thomasfosterau/effect-svelte/issues)

## License

MIT
