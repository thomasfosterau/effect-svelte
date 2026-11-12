# `@thomasfosterau/effect-sveltekit`: the Effect deployment adapter

A SvelteKit [adapter](https://svelte.dev/docs/kit/adapters) (like `@sveltejs/adapter-node`) whose production server is an Effect HTTP server (`effect/http` + `@effect/platform-node`) — `Config`-based configuration, request tracing spans, and graceful shutdown through Effect scopes. The generated app is a platform-neutral Effect `HttpApp`, so it can also run as a Web `fetch` handler on Cloudflare Workers.

- [Requirements](#requirements)
- [Use the adapter](#use-the-adapter)
- [Options](#options)
- [Build output and deployment](#build-output-and-deployment)
- [Runtime configuration](#runtime-configuration)
- [Mount the app in your own server (`handler.js`)](#mount-the-app-in-your-own-server-handlerjs)
- [The `fetch` target and asset sources](#the-fetch-target-and-asset-sources)
- [Entry points](#entry-points)

## Requirements

```bash
pnpm add @effect/platform-node
```

- The adapter writes the build with Effect's `FileSystem` service on Node's file system, so `@effect/platform-node` must be installed to build either target (`target: "fetch"` included, though a Workers deployment never loads it). A file operation that fails rejects the build with its `PlatformError`.
- Keep `effect` and `@effect/platform-node` on the same exact version.
- `@effect/platform-node` pulls in `undici`, which needs Node `>=22.19`, so the production server needs Node `>=22.19` even though the package itself (like SvelteKit 3) declares `>=22.17`.

## Use the adapter

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import adapter from "@thomasfosterau/effect-sveltekit/adapter";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit({ adapter: adapter() })],
});
```

```bash
vite build
node build       # PORT, HOST, ORIGIN, PROTOCOL_HEADER, ... read from the env
```

## Options

`effectAdapter(options)` (the default export of `…/adapter`) takes:

| Option        | Default   | What it does                                                                                                    |
| ------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `out`         | `"build"` | The directory to write the production build to                                                                  |
| `precompress` | `true`    | Precompress static assets and prerendered pages with gzip and brotli                                            |
| `envPrefix`   | `""`      | Prefix for the environment variables the production server reads                                                |
| `target`      | `"node"`  | `"node"`: a production Node HTTP server (`node build`). `"fetch"`: a Web `fetch` handler for Cloudflare Workers |

## Build output and deployment

The build output (`build/` by default) contains:

- `index.js` — runs the production server (`node build`); for `target: "fetch"` it exports `default { fetch }` instead;
- `handler.js` — exports the SvelteKit app as a composable Effect HTTP handler, for both targets;
- `client/`, `server/`, `prerendered/`, `server.js` (the SvelteKit `server` instance) and `manifest.js` (prerendered paths, base and app path) — the built app.

Unlike `adapter-node`, the server output is not bundled: deploy `build/` together with `package.json` and production `node_modules` (which must include `@thomasfosterau/effect-sveltekit`, `effect`, and `@effect/platform-node`).

On the `fetch` target there is no file system, so routes that use `read()` from `$app/server` are unsupported there.

## Runtime configuration

The Node server reads its configuration through Effect `Config` from the environment, with the names `adapter-node` uses, each behind `envPrefix`:

| Variable                                        | Default     | Used for                                         |
| ----------------------------------------------- | ----------- | ------------------------------------------------ |
| `PORT`                                          | `3000`      | The port to listen on                            |
| `HOST`                                          | `"0.0.0.0"` | The address to listen on                         |
| `ORIGIN`                                        | none        | The public origin of the app                     |
| `PROTOCOL_HEADER`, `HOST_HEADER`, `PORT_HEADER` | none        | Request headers a reverse proxy sets for the URL |
| `ADDRESS_HEADER`, `XFF_DEPTH` (default `1`)     | none        | Resolving the client address behind a proxy      |

SIGINT and SIGTERM trigger a graceful shutdown that runs every finalizer.

## Mount the app in your own server (`handler.js`)

The build also emits `build/handler.js`, which exports the whole SvelteKit app as a composable Effect HTTP app — mount it inside an existing `effect/http` server alongside your other routes:

```ts
import { handler } from "./build/handler.js";
import { HttpServer } from "effect/http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { createServer } from "node:http";

const server = Layer.unwrap(Effect.map(handler, (app) => HttpServer.serve(app))).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })),
);

NodeRuntime.runMain(Layer.launch(server));
```

`…/adapter/serve` is what the generated `index.js` uses: `serve(handler, options)` starts the server and runs it until the process is signalled, and `layer(handler, options)` is the same server as a `Layer` to launch yourself or merge into a larger application. Both take `envPrefix`, an extra `layer` merged into the server context (tracing, logging) and `disableLogger` to turn off the request logger.

## The `fetch` target and asset sources

`effectAdapter({ target: "fetch" })` generates a Web `fetch` entry that serves assets from the Workers `env.ASSETS` binding. To write the entry yourself, build the app with `makeHandlerWith` and convert it with `toWebHandler` (both from `…/adapter/handler`):

```ts
import {
  AssetSource,
  makeHandlerWith,
  toWebHandler,
} from "@thomasfosterau/effect-sveltekit/adapter/handler";
import { Layer } from "effect";
import { server } from "./server.js";

let fetchHandler;

export default {
  fetch(request, env, ctx) {
    // Built once: the layer, the app and the web handler are shared by every request.
    fetchHandler ??= toWebHandler(
      makeHandlerWith({
        server,
        env,
        assets: AssetSource.cloudflareAssets(env.ASSETS),
        read: (file) => {
          throw new Error(`read() is not supported on this deployment (${file})`);
        },
      }),
      Layer.empty, // provides the asset source's services; cloudflareAssets needs none
    );
    return fetchHandler(request);
  },
};
```

Asset serving is a pluggable `AssetSource`: `AssetSource.fileSystem` for Node, `AssetSource.cloudflareAssets(env.ASSETS)` for Workers (any object with a `fetch` works — R2, KV, a CDN passthrough), or a custom source. A source's `serveAsset` returns the response for an asset request, or `Option.none()` when the request is not an asset, in which case the app goes on to server-side rendering.

The app's error channel is `never`. Two tagged errors reach the platform as defects (a 500): `SvelteKitServerError`, when the SvelteKit server's `init` or `respond` rejects, and `AssetFetchError`, when a `cloudflareAssets` binding's `fetch` rejects.

## Entry points

| Entry point         | What it provides                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…/adapter`         | The adapter (`effectAdapter`, also the default export)                                                                                                            |
| `…/adapter/handler` | The SvelteKit app as an Effect HTTP app (`makeHandler`, `makeHandlerWith`, `AssetSource`, `toWebHandler`, the `SvelteKitServerError` / `AssetFetchError` defects) |
| `…/adapter/serve`   | The Node server the adapter's `index.js` runs (`serve`, `layer`)                                                                                                  |
