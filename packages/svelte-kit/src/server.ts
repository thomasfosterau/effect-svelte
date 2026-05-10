import type {
  ServerLoad,
  RequestEvent,
  Actions,
  Action,
  Handle,
} from "@sveltejs/kit";
import { Effect, Exit, Cause } from "effect";
import { SvelteKitRuntime } from "./runtime.js";

/**
 * Custom error type that preserves the original Effect Cause.
 */
class EffectCauseError extends Error {
  declare cause: Cause.Cause<unknown>;

  constructor(message: string, cause: Cause.Cause<unknown>) {
    super(message);
    this.name = "EffectCauseError";
    this.cause = cause;
  }
}

/**
 * Converts an Effect Cause to a more descriptive error message
 */
function causeToError(cause: Cause.Cause<unknown>): Error {
  const message = Cause.pretty(cause);
  return new EffectCauseError(message, cause);
}

/**
 * Wraps an Effect-based function to work as a SvelteKit server load function.
 * The effect will have access to platform services (HttpClient, Fetch, etc.) via the SvelteKit runtime.
 * 
 * @example
 * ```ts
 * import { serverLoad } from '@thomasfosterau/effect-svelte-kit/server';
 * import { Effect } from 'effect';
 * import { HttpClient } from '@effect/platform';
 * 
 * export const load = serverLoad((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const data = yield* client.get("https://api.example.com/data");
 *     return { data };
 *   })
 * );
 * ```
 */
export function serverLoad<
  Params extends Record<string, string> = any,
  ParentData extends Record<string, any> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, never>
): ServerLoad<Params, ParentData, OutputData, RouteId> {
  return async (event) => {
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn(event);
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<OutputData, unknown, never>);

    return Exit.match(exit, {
      onFailure: (cause) => {
        throw causeToError(cause);
      },
      onSuccess: (value) => value,
    }) as OutputData;
  };
}

/**
 * Wraps an Effect-based function to work as a SvelteKit action handler.
 * The effect will have access to platform services (HttpClient, Fetch, etc.) via the SvelteKit runtime.
 * 
 * @example
 * ```ts
 * import { action } from '@thomasfosterau/effect-svelte-kit/server';
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
  RouteId extends string | null = any
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, never>
): Action<Params, OutputData, RouteId> {
  return async (event) => {
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn(event);
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<OutputData, unknown, never>);

    return Exit.match(exit, {
      onFailure: (cause) => {
        throw causeToError(cause);
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
 * import { actions } from '@thomasfosterau/effect-svelte-kit/server';
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
  RouteId extends string | null = any
>(
  actionsMap: Record<
    string,
    (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown, never>
  >
): Actions<Params, OutputData, RouteId> {
  const wrappedActions: Actions<Params, OutputData, RouteId> = {};

  for (const [key, actionFn] of Object.entries(actionsMap)) {
    wrappedActions[key] = action(actionFn);
  }

  return wrappedActions;
}

/**
 * Wraps an Effect-based function to work as a SvelteKit hook.
 * The effect will have access to platform services via the SvelteKit runtime.
 * 
 * @example
 * ```ts
 * import { handle } from '@thomasfosterau/effect-svelte-kit/server';
 * import { Effect } from 'effect';
 * 
 * export const handle = handle(({ event, resolve }) =>
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
  fn: (args: Parameters<Handle>[0]) => Effect.Effect<Response, unknown, never>
): Handle {
  return async ({ event, resolve }) => {
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn({ event, resolve });
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<Response, unknown, never>);

    return Exit.match(exit, {
      onFailure: (cause) => {
        throw causeToError(cause);
      },
      onSuccess: (value) => value,
    });
  };
}

/**
 * Wraps an Effect-based function to work as a SvelteKit API endpoint handler.
 * The effect will have access to platform services (HttpClient, Fetch, etc.) via the SvelteKit runtime.
 * 
 * By default, errors are logged server-side and a generic error message is returned to clients.
 * For development/debugging, you can pass options to expose full error details.
 * 
 * @example
 * ```ts
 * import { endpoint } from '@thomasfosterau/effect-svelte-kit/server';
 * import { Effect } from 'effect';
 * import { json } from '@sveltejs/kit';
 * import { HttpClient } from '@effect/platform';
 * 
 * export const GET = endpoint((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const data = yield* client.get("https://api.example.com/data");
 *     return json(data);
 *   })
 * );
 * ```
 */
export function endpoint<
  Params extends Record<string, string> = any,
  RouteId extends string | null = any
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<Response, unknown, never>,
  options?: { exposeErrors?: boolean }
): (event: RequestEvent<Params, RouteId>) => Promise<Response> {
  const { exposeErrors = false } = options ?? {};

  return async (event) => {
    const runtime = SvelteKitRuntime.forRequest(event);
    const effect = fn(event);
    const exit = await runtime.runPromiseExit(effect as Effect.Effect<Response, unknown, never>);

    return Exit.match(exit, {
      onFailure: (cause) => {
        // Always log the full error server-side for debugging
        console.error('Endpoint error:', Cause.pretty(cause));

        // Return generic error message to client unless explicitly enabled
        const clientMessage = exposeErrors
          ? Cause.pretty(cause)
          : 'Internal server error';

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
