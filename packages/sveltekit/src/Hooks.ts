/**
 * Effect helpers for SvelteKit's universal hooks (`src/hooks.ts`), exposed as
 * the `Hooks` namespace of `@thomasfosterau/effect-sveltekit`.
 *
 * The `reroute` hook is expressed as an Effect (running on the universal
 * runtime, with an `HttpClient` backed by the event's `fetch`), and the
 * universal `transport` hook is built from Effect schemas via {@link transport}
 * / {@link transporter}.
 *
 * @example
 * ```ts
 * // src/hooks.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit';
 * import { Effect, Schema } from 'effect';
 *
 * export const reroute = Hooks.reroute((event) =>
 *   Effect.succeed(event.url.pathname === '/old' ? '/new' : undefined),
 * );
 *
 * export const transport = Hooks.transport({
 *   Option: Schema.Option(Schema.Number),
 *   Date: Schema.Date,
 * });
 * ```
 */

import type { Reroute } from "@sveltejs/kit/hooks";
import { Effect } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { defaultUniversalRuntime } from "./internal/default-runtime.js";

/**
 * Wraps an Effect-based function as the SvelteKit universal
 * [`reroute`](https://svelte.dev/docs/kit/hooks#Universal-hooks-reroute) hook,
 * which rewrites the URL before routing. The effect runs on both the server and
 * the client and gets an `HttpClient` backed by the event's `fetch`.
 *
 * @example
 * ```ts
 * // src/hooks.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit';
 * import { Effect } from 'effect';
 *
 * export const reroute = Hooks.reroute((event) =>
 *   Effect.succeed(event.url.pathname === '/old' ? '/new' : undefined),
 * );
 * ```
 */
export function reroute(
  fn: (event: {
    url: URL;
    fetch: typeof globalThis.fetch;
  }) => Effect.Effect<string | void, unknown, HttpClient.HttpClient>,
): Reroute {
  return (event) => defaultUniversalRuntime().runPromise(event.fetch, fn(event));
}

/**
 * The universal `transport` hook built from Effect schemas: `transport`
 * assembles a whole `transport` object from a record of entries, `transporter`
 * builds a single round-tripping entry from a `Schema.Codec`, and
 * `markerTransporter` builds a deliberately-lossy entry for a non-POJO wrapper
 * whose contents should not round-trip. See {@link transport} for details.
 */
export {
  transport,
  transporter,
  markerTransporter,
  type MarkerTransporterOptions,
  type TransportEntry,
} from "./transport.js";

/**
 * The `transport` entry for the {@link ResponseHeaders} response-headers buffer
 * (`Hooks.transport({ ResponseHeaders: Hooks.responseHeadersTransporter })`).
 */
export { responseHeadersTransporter } from "./response-headers.js";
