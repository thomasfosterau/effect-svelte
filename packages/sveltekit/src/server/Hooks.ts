/**
 * Effect wrappers for SvelteKit's server-side hooks (`src/hooks.server.ts`),
 * exposed as the `Hooks` namespace of `@thomasfosterau/effect-sveltekit/server`.
 *
 * Each helper turns an Effect (or a function returning one) into the
 * function-shaped export SvelteKit expects. Effects run on the SvelteKit server
 * runtime, so they have access to platform services (`HttpClient`, the
 * `RequestEvent`, ...). To additionally provide your application's services,
 * use the matching methods on an app-wide runtime from `makeServerRuntime`.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const handle = Hooks.handle(({ event, resolve }) =>
 *   Effect.gen(function* () {
 *     const response = yield* Effect.promise(() => resolve(event));
 *     yield* Effect.logInfo(`${event.url.pathname} -> ${response.status}`);
 *     return response;
 *   })
 * );
 * ```
 */

import type { Handle, HandleFetch, HandleServerError, ServerInit } from "@sveltejs/kit/hooks";
import { Effect } from "effect";
import type { SvelteKitServices } from "../app-runtime.js";
import { defaultServerRuntime } from "../internal/default-runtime.js";

/**
 * Wraps an Effect-based function as a SvelteKit
 * [`handle`](https://svelte.dev/docs/kit/hooks#Server-hooks-handle) hook, which
 * runs on every request and controls how the response is produced.
 *
 * SvelteKit control flow (`redirect()`, `error()`) raised inside the effect is
 * passed through to SvelteKit.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const handle = Hooks.handle(({ event, resolve }) =>
 *   Effect.gen(function* () {
 *     // custom logic before resolve
 *     const response = yield* Effect.promise(() => resolve(event));
 *     // custom logic after resolve
 *     return response;
 *   })
 * );
 * ```
 */
export function handle(
  fn: (args: Parameters<Handle>[0]) => Effect.Effect<Response, unknown, SvelteKitServices>,
): Handle {
  return defaultServerRuntime().handle(fn);
}

/**
 * Wraps an Effect-based function as a SvelteKit
 * [`handleFetch`](https://svelte.dev/docs/kit/hooks#Server-hooks-handleFetch)
 * hook, which intercepts `event.fetch` calls made on the server (in `load`,
 * actions, endpoints, ...). The effect produces the `Response` to use.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const handleFetch = Hooks.handleFetch(({ request, fetch }) =>
 *   Effect.gen(function* () {
 *     // Redirect internal API calls to the upstream service.
 *     const url = request.url.replace('https://api.internal', 'http://localhost:9999');
 *     return yield* Effect.promise(() => fetch(new Request(url, request)));
 *   })
 * );
 * ```
 */
export function handleFetch(
  fn: (args: Parameters<HandleFetch>[0]) => Effect.Effect<Response, unknown, SvelteKitServices>,
): HandleFetch {
  return defaultServerRuntime().handleFetch(fn);
}

/**
 * Wraps an Effect-based function as the SvelteKit server
 * [`handleError`](https://svelte.dev/docs/kit/hooks#Shared-hooks-handleError)
 * hook, which runs when an unexpected error is thrown while responding to a
 * request. The effect receives the error and request event and produces the
 * shape exposed to the client (your `App.Error`, or nothing).
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const handleError = Hooks.handleError(({ error, event }) =>
 *   Effect.gen(function* () {
 *     const id = crypto.randomUUID();
 *     yield* Effect.logError(`${event.url.pathname} (${id})`, error);
 *     return { message: 'Internal Error', id };
 *   })
 * );
 * ```
 */
export function handleError(
  fn: (
    args: Parameters<HandleServerError>[0],
  ) => Effect.Effect<Awaited<ReturnType<HandleServerError>>, unknown, SvelteKitServices>,
): HandleServerError {
  return defaultServerRuntime().handleError(fn);
}

/**
 * Wraps an Effect as the SvelteKit server
 * [`init`](https://svelte.dev/docs/kit/hooks#Shared-hooks-init) hook, which
 * runs once before the server responds to its first request. There is no
 * request event available, so the effect runs without per-request services.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { Hooks } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const init = Hooks.init(Effect.logInfo('server starting up'));
 * ```
 */
export function init(effect: Effect.Effect<void, unknown>): ServerInit {
  return defaultServerRuntime().init(effect);
}
