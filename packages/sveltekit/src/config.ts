/**
 * SvelteKit `$env` ⇄ Effect `Config`.
 *
 * Effect services read configuration through {@link Config} / a
 * {@link ConfigProvider}, while SvelteKit exposes configuration through its
 * `$env/static/*` and `$env/dynamic/*` virtual modules. These helpers bridge
 * the two: pass a SvelteKit env record and get back a `ConfigProvider` (or a
 * `Layer` that installs it), so any `Config.String("DATABASE_URL")` resolves
 * from SvelteKit's environment.
 *
 * ```ts
 * // src/lib/server/runtime.ts
 * import { env } from "$env/dynamic/private";
 * import { sveltekitConfig } from "@thomasfosterau/effect-sveltekit/server";
 * import { makeServerRuntime } from "@thomasfosterau/effect-sveltekit/server";
 * import { Layer } from "effect";
 * import { Database } from "./database";
 *
 * export const runtime = makeServerRuntime(
 *   // Database.layer reads Config.String("DATABASE_URL"), now backed by $env
 *   Database.layer.pipe(Layer.provide(sveltekitConfig(env))),
 * );
 * ```
 *
 * `ConfigProvider.fromEnv` joins/splits path segments on `_`, so nested config
 * (`Config.String("HOST").pipe(...nested("DATABASE"))`) resolves a
 * `DATABASE_HOST` env var just like it does from `process.env`.
 */

import { type Config, ConfigProvider, Effect, type Layer } from "effect";

/** Drop `undefined` values so the record satisfies `ConfigProvider.fromEnv`. */
const definedEntries = (env: Record<string, string | undefined>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
};

/**
 * Creates a {@link ConfigProvider} backed by a SvelteKit env record (e.g. the
 * `env` export of `$env/dynamic/private`, or `import.meta.env`-style objects).
 */
export const sveltekitConfigProvider = (
  env: Record<string, string | undefined>,
): ConfigProvider.ConfigProvider => ConfigProvider.fromEnv({ env: definedEntries(env) });

/**
 * Creates a `Layer` that installs {@link sveltekitConfigProvider} as the
 * ambient config provider. Provide it to a server/universal runtime so the
 * application layer's `Config` reads resolve from SvelteKit's environment.
 */
export const sveltekitConfig = (env: Record<string, string | undefined>): Layer.Layer<never> =>
  ConfigProvider.layer(sveltekitConfigProvider(env));

/**
 * Read a typed {@link Config} value directly from a SvelteKit env record, in
 * one call — the typed bridge for reading configuration without wiring a
 * provider into a runtime first.
 *
 * Which `$env` module you pass decides *when* the value is resolved:
 *
 * - `$env/static/public` / `$env/static/private` are **build-time** — inlined
 *   and fixed for the deployment (public values are safe in client bundles).
 * - `$env/dynamic/public` / `$env/dynamic/private` are **runtime** — read from
 *   the process environment per request, so they can change between deploys of
 *   the same build.
 *
 * @example
 * ```ts
 * // Build-time public config (usable on the client)
 * import { env } from "$env/static/public";
 * import { readConfig } from "@thomasfosterau/effect-sveltekit";
 * import { Config, Effect } from "effect";
 *
 * const settings = readConfig(
 *   env,
 *   Config.all({
 *     apiUrl: Config.String("PUBLIC_API_URL"),
 *     analytics: Config.String("PUBLIC_ANALYTICS_KEY").pipe(Config.withDefault("")),
 *   }),
 * );
 * // settings: Effect<{ apiUrl: string; analytics: string }, ConfigError>
 * ```
 */
export const readConfig = <A>(
  env: Record<string, string | undefined>,
  config: Config.Config<A>,
): Effect.Effect<A, Config.ConfigError> => Effect.provide(config, sveltekitConfig(env));
