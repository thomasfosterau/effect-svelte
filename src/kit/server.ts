import type { ServerLoad, RequestEvent, Actions, Action, Handle } from "@sveltejs/kit";
import { Effect, Exit, Cause } from "effect";
import { isHttpError, isRedirect } from "@sveltejs/kit";
import type * as HttpClient from "@effect/platform/HttpClient";
import { SvelteKitRuntime, SvelteKitRequestEvent } from "./runtime.js";
import { causeToThrowable } from "./internal/error.js";

/**
 * The services that the SvelteKit runtime provides to every wrapped effect.
 */
export type SvelteKitServices = HttpClient.HttpClient | SvelteKitRequestEvent;

/**
 * Wraps an Effect-based function to work as a SvelteKit server load function.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * SvelteKit control flow (`redirect()`, `error()`) raised inside the effect is
 * passed through to SvelteKit.
 *
 * @example
 * ```ts
 * import { serverLoad } from '@thomasfosterau/effect-svelte/kit/server';
 * import { Effect } from 'effect';
 * import * as HttpClient from '@effect/platform/HttpClient';
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
  return async (event) => {
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn(event);
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<OutputData, unknown, never>);

    return Exit.match(exit, {
      onFailure: (cause) => {
        throw causeToThrowable(cause);
      },
      onSuccess: (value) => value,
    }) as OutputData;
  };
}

/**
 * Wraps an Effect-based function to work as a SvelteKit action handler.
 * The effect has access to platform services (HttpClient, the RequestEvent, etc.)
 * via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { action } from '@thomasfosterau/effect-svelte/kit/server';
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
  return async (event) => {
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn(event);
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<OutputData, unknown, never>);

    return Exit.match(exit, {
      onFailure: (cause) => {
        throw causeToThrowable(cause);
      },
      onSuccess: (value) => value,
    }) as OutputData;
  };
}

/**
 * Creates SvelteKit actions from an object of Effect-based action handlers.
 * Each action will have access to platform services via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { actions } from '@thomasfosterau/effect-svelte/kit/server';
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
  const wrappedActions: Actions<Params, OutputData, RouteId> = {};

  for (const [key, actionFn] of Object.entries(actionsMap)) {
    wrappedActions[key] = action(actionFn);
  }

  return wrappedActions;
}

/**
 * Wraps an Effect-based function to work as a SvelteKit hook.
 * The effect has access to platform services via the SvelteKit runtime.
 *
 * @example
 * ```ts
 * import { handle as effectHandle } from '@thomasfosterau/effect-svelte/kit/server';
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
  return async ({ event, resolve }) => {
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn({ event, resolve });
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<Response, unknown, never>);

    return Exit.match(exit, {
      onFailure: (cause) => {
        throw causeToThrowable(cause);
      },
      onSuccess: (value) => value,
    });
  };
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
 * import { endpoint } from '@thomasfosterau/effect-svelte/kit/server';
 * import { Effect } from 'effect';
 * import { json } from '@sveltejs/kit';
 * import * as HttpClient from '@effect/platform/HttpClient';
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
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn(event);
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<Response, unknown, never>);

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
 * Export the SvelteKit runtime utilities for advanced use cases.
 */
export { SvelteKitRuntime, runWithSvelteKitRuntime, SvelteKitRequestEvent } from "./runtime.js";
export { RemoteFunction } from "./remote.server.js";
