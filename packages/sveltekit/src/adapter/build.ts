/**
 * The Effect SvelteKit adapter's build step: what `effectAdapter().adapt`
 * runs. It is an Effect program over the `FileSystem` service, so the adapter
 * entry (`./index.ts`) provides Node's file system and the tests a recording
 * one.
 */

import type { Builder } from "@sveltejs/kit";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

const PACKAGE = "@thomasfosterau/effect-sveltekit";

/** The resolved options of one adapter build: `EffectAdapterOptions`, defaults applied. */
export interface BuildOptions {
  /** The directory the production build is written to. */
  readonly out: string;
  /** Whether static assets and prerendered pages are precompressed. */
  readonly precompress: boolean;
  /** Prefix of the environment variables the production server reads. */
  readonly envPrefix: string;
  /** The deployment target of the generated `index.js`. */
  readonly target: "node" | "fetch";
}

/**
 * A string as a double-quoted JavaScript string literal, or a list of strings
 * as an array literal, for generated source.
 */
const jsLiteral = Schema.encodeSync(
  Schema.fromJsonString(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
);

/** Template for the generated `<out>/handler.js`. */
const handlerTemplate = (envPrefix: string): string => `\
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { makeHandler } from "${PACKAGE}/adapter/handler";
import { server } from "./server.js";
import { prerendered, base, appPath } from "./manifest.js";

const dir = dirname(fileURLToPath(import.meta.url));

/**
 * The SvelteKit application as a composable Effect HTTP handler.
 *
 * Serve it with the generated index.js, or mount it inside any
 * \`effect/http\` HTTP server.
 */
export const handler = makeHandler({
  server,
  appPath,
  prerendered,
  base,
  dir,
  env: process.env,
  envPrefix: ${jsLiteral(envPrefix)},
});
`;

/** Template for the generated Node `<out>/index.js`. */
const nodeEntryTemplate = (envPrefix: string): string => `\
import { serve } from "${PACKAGE}/adapter/serve";
import { handler } from "./handler.js";

serve(handler, { envPrefix: ${jsLiteral(envPrefix)} });
`;

/**
 * Template for the generated Cloudflare Workers `<out>/index.js`.
 *
 * Exports a module worker (`default { fetch }`). Static client assets and
 * prerendered pages are served from the `ASSETS` binding; everything else is
 * server-side rendered by the SvelteKit `HttpApp`.
 */
const fetchEntryTemplate = (envPrefix: string): string => `\
import * as Layer from "effect/Layer";
import { makeHandlerWith, AssetSource, toWebHandler } from "${PACKAGE}/adapter/handler";
import { server } from "./server.js";

let fetchHandler;

export default {
  /** @param {Request} request @param {Record<string, any>} env @param {any} ctx */
  fetch(request, env, ctx) {
    fetchHandler ??= toWebHandler(
      makeHandlerWith({
        server,
        env,
        envPrefix: ${jsLiteral(envPrefix)},
        // Static assets come from the Workers ASSETS binding (configure it to
        // serve the uploaded \`client/\` + \`prerendered/\` output).
        assets: AssetSource.cloudflareAssets(env.ASSETS),
        // \`read()\` from \`$app/server\` is not backed by a file system on workerd.
        read: (file) => {
          throw new Error(\`read() is not supported on this deployment (\${file})\`);
        },
      }),
      Layer.empty,
    );
    return fetchHandler(request);
  },
};
`;

/**
 * Writes the production build into `options.out` through SvelteKit's
 * `builder` and the `FileSystem` service, one step after another: the output
 * directory is emptied first, then the client, prerendered and server output
 * are copied (and compressed), `server.js` is generated, and `manifest.js`,
 * `handler.js` and `index.js` are written.
 *
 * Fails with the `PlatformError` of the file operation that failed. Whatever
 * a `builder` method throws, and a rejected `builder.compress`, surfaces as a
 * defect.
 */
export const writeBuild = (
  builder: Builder,
  options: BuildOptions,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const { out, precompress, envPrefix, target } = options;
    const fs = yield* FileSystem.FileSystem;
    const base = builder.config.paths.base;

    yield* fs.remove(out, { recursive: true, force: true });
    yield* fs.makeDirectory(out, { recursive: true });

    yield* Effect.sync(() => {
      builder.log.minor("Copying assets");
      builder.writeClient(`${out}/client${base}`);
      builder.writePrerendered(`${out}/prerendered${base}`);
    });

    if (precompress) {
      yield* Effect.sync(() => builder.log.minor("Compressing assets"));
      yield* Effect.forEach(
        [`${out}/client`, `${out}/prerendered`],
        // A rejection is SvelteKit's own failure: it passes through as it is.
        (directory) =>
          Effect.orDie(
            Effect.tryPromise({ try: () => builder.compress(directory), catch: (cause) => cause }),
          ),
        { concurrency: "unbounded", discard: true },
      );
    }

    yield* Effect.sync(() => {
      builder.log.minor("Building server");
      builder.writeServer(`${out}/server`);
      // `<out>/server.js` exports the SvelteKit `server` instance, with the
      // manifest of the (non-prerendered) routes baked in.
      builder.generateServerInstance(`${out}/server.js`, { serverDirectory: `${out}/server` });
    });

    yield* fs.writeFileString(
      `${out}/manifest.js`,
      [
        `export const prerendered = new Set(${jsLiteral(builder.prerendered.paths)});`,
        `export const base = ${jsLiteral(base)};`,
        `export const appPath = ${jsLiteral(builder.getAppPath())};`,
      ].join("\n\n"),
    );

    yield* Effect.sync(() => builder.log.minor("Writing server entry"));
    yield* fs.writeFileString(`${out}/handler.js`, handlerTemplate(envPrefix));
    yield* fs.writeFileString(
      `${out}/index.js`,
      target === "fetch" ? fetchEntryTemplate(envPrefix) : nodeEntryTemplate(envPrefix),
    );
  });
