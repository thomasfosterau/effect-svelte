/**
 * Effect deployment adapter for SvelteKit.
 *
 * Like `@sveltejs/adapter-node`, but the production server is an
 * `effect/unstable/http` HTTP server: requests are handled by an Effect HTTP
 * handler, configuration is read through `Config`, and startup/shutdown is
 * managed by Effect layers and scopes (SIGINT/SIGTERM trigger a graceful
 * shutdown that runs all finalizers).
 *
 * ```js
 * // svelte.config.js
 * import adapter from "@thomasfosterau/effect-sveltekit/adapter";
 *
 * const config = {
 *   kit: { adapter: adapter() },
 * };
 *
 * export default config;
 * ```
 *
 * The build output (`build/` by default) contains:
 *
 * - `index.js` — runs the production server: `node build`
 * - `handler.js` — exports the SvelteKit app as a composable Effect HTTP
 *   handler, for mounting inside an existing `effect/unstable/http` server
 * - `client/`, `server/`, `prerendered/`, `manifest.js` — the built app
 *
 * Unlike `adapter-node`, the server output is not bundled: the deployment
 * needs `node_modules` with the app's production dependencies installed
 * (including `@thomasfosterau/effect-sveltekit`, `effect`, and
 * `@effect/platform-node`).
 */

import { writeFileSync } from "node:fs";
import type { Adapter } from "@sveltejs/kit";

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
}

const PACKAGE = "@thomasfosterau/effect-sveltekit";

/** Template for the generated `<out>/handler.js`. */
const handlerTemplate = (envPrefix: string): string => `\
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { makeHandler } from "${PACKAGE}/adapter/handler";
import { Server } from "./server/index.js";
import { manifest, prerendered, base } from "./manifest.js";

const dir = dirname(fileURLToPath(import.meta.url));

/**
 * The SvelteKit application as a composable Effect HTTP handler.
 *
 * Serve it with the generated index.js, or mount it inside any
 * \`effect/unstable/http\` HTTP server.
 */
export const handler = makeHandler({
  Server,
  manifest,
  prerendered,
  base,
  dir,
  env: process.env,
  envPrefix: ${JSON.stringify(envPrefix)},
});
`;

/** Template for the generated `<out>/index.js`. */
const entryTemplate = (envPrefix: string): string => `\
import { serve } from "${PACKAGE}/adapter/serve";
import { handler } from "./handler.js";

serve(handler, { envPrefix: ${JSON.stringify(envPrefix)} });
`;

/**
 * Creates the Effect SvelteKit adapter.
 */
export function effectAdapter(options: EffectAdapterOptions = {}): Adapter {
  const { out = "build", precompress = true, envPrefix = "" } = options;

  return {
    name: `${PACKAGE}/adapter`,

    async adapt(builder) {
      const base = builder.config.kit.paths.base;

      builder.rimraf(out);
      builder.mkdirp(out);

      builder.log.minor("Copying assets");
      builder.writeClient(`${out}/client${base}`);
      builder.writePrerendered(`${out}/prerendered${base}`);

      if (precompress) {
        builder.log.minor("Compressing assets");
        await Promise.all([
          builder.compress(`${out}/client`),
          builder.compress(`${out}/prerendered`),
        ]);
      }

      builder.log.minor("Building server");
      builder.writeServer(`${out}/server`);

      writeFileSync(
        `${out}/manifest.js`,
        [
          `export const manifest = ${builder.generateManifest({ relativePath: "./server" })};`,
          `export const prerendered = new Set(${JSON.stringify(builder.prerendered.paths)});`,
          `export const base = ${JSON.stringify(base)};`,
        ].join("\n\n"),
      );

      builder.log.minor("Writing server entry");
      writeFileSync(`${out}/handler.js`, handlerTemplate(envPrefix));
      writeFileSync(`${out}/index.js`, entryTemplate(envPrefix));
    },

    supports: {
      // `read()` from `$app/server` is backed by the platform FileSystem.
      read: () => true,
    },
  };
}

export default effectAdapter;
