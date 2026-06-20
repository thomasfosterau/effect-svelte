import type {
  Action,
  Actions,
  Handle,
  HandleFetch,
  HandleServerError,
  RequestEvent,
  ServerInit,
  ServerLoad,
} from "@sveltejs/kit";
import { Effect, Exit, Cause } from "effect";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import { makeServerRuntime, type ServerRuntime, type SvelteKitServices } from "./app-runtime.js";

export type { SvelteKitServices };

// Shared runtime (no application layer) backing the standalone wrappers.
// Created lazily so importing this module has no side effects.
let defaultRuntime: ServerRuntime | undefined;
const runtime = (): ServerRuntime => (defaultRuntime ??= makeServerRuntime());

/**
 * Wraps an Effect-based function to work as a SvelteKit server load function.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * SvelteKit control flow (`redirect()`, `error()`) raised inside the effect is
 * passed through to SvelteKit.
 *
 * To give effects access to your own application services, create an
 * app-wide runtime with {@link makeServerRuntime} and use its `serverLoad`
 * instead.
 *
 * @example
 * ```ts
 * import { serverLoad } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 * import * as HttpClient from 'effect/unstable/http/HttpClient';
 *
 * export const load = serverLoad((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const response = yield* client.get("https://api.example.com/data");
 *     return { data: yield* response.json };
 *   })
 * );
 * ```
 */
export function serverLoad<
  Params extends Record<string, string> = any,
  ParentData extends Record<string, any> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any,
>(
  fn: (
    event: RequestEvent<Params, RouteId>,
  ) => Effect.Effect<OutputData, unknown, SvelteKitServices>,
): ServerLoad<Params, ParentData, OutputData, RouteId> {
  return runtime().serverLoad(fn);
}

/**
 * Wraps an Effect-based function to work as a SvelteKit action handler.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { action } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const actions = {
 *   default: action((event) =>
 *     Effect.gen(function* () {
 *       const formData = yield* Effect.promise(() => event.request.formData());
 *       // Process form data
 *       return { success: true };
 *     })
 *   )
 * };
 * ```
 */
export function action<
  Params extends Record<string, string> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any,
>(
  fn: (
    event: RequestEvent<Params, RouteId>,
  ) => Effect.Effect<OutputData, unknown, SvelteKitServices>,
): Action<Params, OutputData, RouteId> {
  return runtime().action(fn);
}

/**
 * Creates SvelteKit actions from an object of Effect-based action handlers.
 * Each action will have access to platform services via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { actions } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const actions = actions({
 *   create: (event) => Effect.succeed({ created: true }),
 *   delete: (event) => Effect.succeed({ deleted: true })
 * });
 * ```
 */
export function actions<
  Params extends Record<string, string> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any,
>(
  actionsMap: Record<
    string,
    (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, SvelteKitServices>
  >,
): Actions<Params, OutputData, RouteId> {
  return runtime().actions(actionsMap);
}

/**
 * Wraps an Effect-based function to work as a SvelteKit hook.
 * The effect has access to platform services via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { handle as effectHandle } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const handle = effectHandle(({ event, resolve }) =>
 *   Effect.gen(function* () {
 *     // Add custom logic before resolve
 *     const response = yield* Effect.promise(() => resolve(event));
 *     // Add custom logic after resolve
 *     return response;
 *   })
 * );
 * ```
 */
export function handle(
  fn: (args: Parameters<Handle>[0]) => Effect.Effect<Response, unknown, SvelteKitServices>,
): Handle {
  return runtime().handle(fn);
}

/**
 * Wraps an Effect-based function to work as the SvelteKit
 * [`handleFetch`](https://svelte.dev/docs/kit/hooks#Server-hooks-handleFetch)
 * hook, which intercepts `event.fetch` calls made on the server (in `load`,
 * actions, endpoints, ...). The effect has access to platform services via the
 * SvelteKit runtime and produces the `Response` to use.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { handleFetch } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const handleFetch = handleFetch(({ request, fetch }) =>
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
  return runtime().handleFetch(fn);
}

/**
 * Wraps an Effect-based function to work as the SvelteKit server
 * [`handleError`](https://svelte.dev/docs/kit/hooks#Shared-hooks-handleError)
 * hook, which runs when an unexpected error is thrown while responding to a
 * request. The effect receives the error and request event and produces the
 * shape exposed to the client (your `App.Error`, or nothing).
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { handleError } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const handleError = handleError(({ error, event }) =>
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
  return runtime().handleError(fn);
}

/**
 * Wraps an Effect to work as the SvelteKit server
 * [`init`](https://svelte.dev/docs/kit/hooks#Shared-hooks-init) hook, which
 * runs once before the server responds to its first request. There is no
 * request event available, so the effect runs without per-request services.
 *
 * @example
 * ```ts
 * // src/hooks.server.ts
 * import { init } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 *
 * export const init = init(
 *   Effect.logInfo('server starting up')
 * );
 * ```
 */
export function init(effect: Effect.Effect<void, unknown>): ServerInit {
  return runtime().init(effect);
}

/**
 * Wraps an Effect-based function to work as a SvelteKit API endpoint handler.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * SvelteKit control flow (`redirect()`, `error()`) raised inside the effect is
 * passed through to SvelteKit. For any other failure, the error is logged
 * server-side and a generic error message is returned to clients. For
 * development/debugging, you can pass options to expose full error details.
 *
 * @example
 * ```ts
 * import { endpoint } from '@thomasfosterau/effect-sveltekit/server';
 * import { Effect } from 'effect';
 * import { json } from '@sveltejs/kit';
 * import * as HttpClient from 'effect/unstable/http/HttpClient';
 *
 * export const GET = endpoint((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const response = yield* client.get("https://api.example.com/data");
 *     return json(yield* response.json);
 *   })
 * );
 * ```
 */
export function endpoint<
  Params extends Record<string, string> = any,
  RouteId extends string | null = any,
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<Response, unknown, SvelteKitServices>,
  options?: { exposeErrors?: boolean },
): (event: RequestEvent<Params, RouteId>) => Promise<Response> {
  const { exposeErrors = false } = options ?? {};

  return async (event) => {
    const exit = await runtime().runPromiseExit(event as RequestEvent, fn(event));

    return Exit.match(exit, {
      onFailure: (cause) => {
        // Let SvelteKit handle its own control flow objects.
        const squashed = Cause.squash(cause);
        if (isRedirect(squashed) || isHttpError(squashed)) {
          throw squashed;
        }

        // Always log the full error server-side for debugging
        console.error("Endpoint error:", Cause.pretty(cause));

        // Return generic error message to client unless explicitly enabled
        const clientMessage = exposeErrors ? Cause.pretty(cause) : "Internal server error";

        return new Response(JSON.stringify({ error: clientMessage }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
      onSuccess: (value) => value,
    });
  };
}

/**
 * App-wide runtime: define your application's Effect services once and share
 * them across every request.
 */
export { makeServerRuntime, type ServerRuntime } from "./app-runtime.js";

/**
 * Export the SvelteKit runtime utilities for advanced use cases.
 */
export { SvelteKitRuntime, runWithSvelteKitRuntime, SvelteKitRequestEvent } from "./runtime.js";
export { RemoteFunction } from "./remote.server.js";

/**
 * SvelteKit `$env` ⇄ Effect `Config` (see {@link sveltekitConfig}), and the
 * Effect Schema ⇄ SvelteKit `transport` hook helpers (see {@link transport}).
 */
export { sveltekitConfig, sveltekitConfigProvider } from "./config.js";
export { transport, transporter } from "./transport.js";
