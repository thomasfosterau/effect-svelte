/**
 * Effect deployment adapter for SvelteKit.
 *
 * Like `@sveltejs/adapter-node`, but the production server is an
 * `effect/http` HTTP server: requests are handled by an Effect HTTP
 * handler, configuration is read through `Config`, and startup/shutdown is
 * managed by Effect layers and scopes (SIGINT/SIGTERM trigger a graceful
 * shutdown that runs all finalizers).
 *
 * ```js
 * // vite.config.ts
 * import { sveltekit } from "@sveltejs/kit/vite";
 * import adapter from "@thomasfosterau/effect-sveltekit/adapter";
 * import { defineConfig } from "vite";
 *
 * export default defineConfig({
 *   plugins: [sveltekit({ adapter: adapter() })],
 * });
 * ```
 *
 * The build output (`build/` by default) contains:
 *
 * - `index.js` — runs the production server: `node build`
 * - `handler.js` — exports the SvelteKit app as a composable Effect HTTP
 *   handler, for mounting inside an existing `effect/http` server
 * - `client/`, `server/`, `prerendered/`, `server.js` (the SvelteKit
 *   `server` instance), `manifest.js` (prerendered paths, base and app path) —
 *   the built app
 *
 * Unlike `adapter-node`, the server output is not bundled: the deployment
 * needs `node_modules` with the app's production dependencies installed
 * (including `@thomasfosterau/effect-sveltekit`, `effect`, and
 * `@effect/platform-node`).
 */

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import type { Adapter } from "@sveltejs/kit";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { writeBuild } from "./build.js";

/** Options for {@link effectAdapter}. */
export interface EffectAdapterOptions {
  /**
   * The directory to write the production build to.
   * @default "build"
   */
  readonly out?: string;
  /**
   * Precompress static assets and prerendered pages with gzip and brotli.
   * @default true
   */
  readonly precompress?: boolean;
  /**
   * Prefix for the environment variables the production server reads
   * (`PORT`, `HOST`, `ORIGIN`, `PROTOCOL_HEADER`, `HOST_HEADER`,
   * `PORT_HEADER`, `ADDRESS_HEADER`, `XFF_DEPTH`).
   * @default ""
   */
  readonly envPrefix?: string;
  /**
   * The deployment target for the generated entry:
   *
   * - `"node"` (default) — a production Node HTTP server (`node build`) on
   *   `@effect/platform-node`, serving assets from disk.
   * - `"fetch"` — a Web `fetch` handler suitable for Cloudflare Workers
   *   (`build/index.js` exports `default { fetch }`), serving assets from the
   *   `env.ASSETS` binding via `AssetSource.cloudflareAssets`.
   *
   * Both targets also write `build/handler.js` (the SvelteKit `HttpApp`), so you
   * can compose your own entry for any `effect/http` runtime.
   *
   * @default "node"
   */
  readonly target?: "node" | "fetch";
}

/**
 * Creates the Effect SvelteKit adapter.
 *
 * Its `adapt` hook writes the build with Effect's `FileSystem` service on
 * Node's file system (`@effect/platform-node`, which must be installed for
 * either target), on a runtime it creates for the build and disposes when the
 * build ends. The promise it returns rejects with the `PlatformError` of a
 * file operation that failed, or with whatever SvelteKit's builder threw.
 */
export function effectAdapter(options: EffectAdapterOptions = {}): Adapter {
  const { out = "build", precompress = true, envPrefix = "", target = "node" } = options;

  return {
    name: "@thomasfosterau/effect-sveltekit/adapter",

    adapt(builder) {
      // The build hook is a runtime boundary: SvelteKit calls it as a Promise
      // API, so the build runs on a runtime this call owns.
      const runtime = ManagedRuntime.make(NodeFileSystem.layer);
      // Disposed once the run has settled, not from inside it: on effect
      // 4.0.0 a runtime disposed by the program it is running never settles.
      return runtime
        .runPromise(writeBuild(builder, { out, precompress, envPrefix, target }))
        .finally(() => runtime.dispose());
    },

    supports: {
      // On Node, `read()` from `$app/server` is backed by the platform
      // FileSystem. On the `fetch` (Workers) target it has no file system, so
      // routes using `read()` are unsupported there.
      read: () => target !== "fetch",
    },
  };
}

export default effectAdapter;
