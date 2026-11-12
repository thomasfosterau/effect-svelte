# `@thomasfosterau/effect-sveltekit`: the `effectKit()` Vite plugin

The [explicit wrappers](sveltekit-server.md#the-wrappers) are the primary API. The `effectKit()` Vite plugin (from `@thomasfosterau/effect-sveltekit/vite`) is an optional convenience on top of them: route files export bare Effects and the plugin wraps them. It needs `vite`, an optional peer of the package.

- [Set-up](#set-up)
- [What it does](#what-it-does)
- [App-wide runtimes](#app-wide-runtimes)
- [Supported exports](#supported-exports)

## Set-up

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { effectKit } from "@thomasfosterau/effect-sveltekit/vite";

export default {
  plugins: [effectKit(), sveltekit()],
};
```

## What it does

With the plugin installed, you can return an Effect (or a function returning an Effect) directly from any standard SvelteKit route file (`+page.ts`, `+page.server.ts`, `+layout(.server).ts`, `+server.ts`, `hooks.(server|client).ts`):

```ts
// +page.server.ts
import { Effect } from "effect";

export const load = (event) => Effect.succeed({ id: event.params.id });
```

The plugin rewrites the export so it goes through the same runtime as the explicit wrappers; plain promise/value-returning functions pass through unchanged, so the plugin is safe to enable on an existing project. SvelteKit's generated `$types` cannot see through the rewrite, so type a plugin-wrapped route's `data` prop yourself; explicit wrappers return real SvelteKit functions, so route `$types` work as usual.

The generated code imports `@thomasfosterau/effect-sveltekit/internal/auto`. That entry exists for the plugin; it is not a public API.

## App-wide runtimes

To make an [app-wide runtime](sveltekit-server.md#app-wide-runtime)'s services available to bare-Effect exports, point the plugin at the runtime module:

```ts
// vite.config.ts
effectKit({ serverRuntime: "#lib/server/runtime.ts" });
```

| Option          | What it is                                                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverRuntime` | Import specifier of a server-only module whose `runtime` (or default) export was created with `makeServerRuntime`. Effects in server route files (`+page.server.ts`, `+layout.server.ts`, `+server.ts`, `hooks.server.ts`) get its layer's services                   |
| `clientRuntime` | Import specifier of a universal module whose `runtime` (or default) export was created with `makeUniversalRuntime`. Effects in universal route files (`+page.ts`, `+layout.ts`, `hooks.client.ts`) get its layer's services. It must be safe to import in the browser |
| `include`       | Restrict the rewrite to a subset of file kinds (`"pageServer"`, `"page"`, `"layoutServer"`, `"layout"`, `"server"`, `"hooks"`, `"hooksServer"`, `"hooksClient"`). Defaults to all of them                                                                             |

## Supported exports

| File                | Exports auto-wrapped                                                   |
| ------------------- | ---------------------------------------------------------------------- |
| `+page.ts`          | `load`                                                                 |
| `+page.server.ts`   | `load`, `actions`                                                      |
| `+layout.ts`        | `load`                                                                 |
| `+layout.server.ts` | `load`                                                                 |
| `+server.ts`        | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`, `fallback` |
| `hooks.ts`          | `reroute`                                                              |
| `hooks.server.ts`   | `handle`, `handleFetch`, `handleError`, `init`                         |
| `hooks.client.ts`   | `handleError`, `init`                                                  |

Config exports like `prerender`, `ssr`, `csr`, and `trailingSlash` — and the universal `transport` hook (which is plain data, not a function) — are never touched.
