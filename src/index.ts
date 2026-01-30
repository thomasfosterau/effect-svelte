import type {
  ServerLoad,
  Load,
  RequestEvent,
  Actions,
  Action,
  Handle,
} from "@sveltejs/kit";
import { Effect, Exit, Cause } from "effect";

/**
 * Converts an Effect Cause to a more descriptive error message
 */
function causeToError(cause: Cause.Cause<unknown>): Error {
  const message = Cause.pretty(cause);
  const error = new Error(message);
  // Preserve the original cause for debugging
  (error as any).cause = cause;
  return error;
}

/**
 * Wraps an Effect-based function to work as a SvelteKit server load function.
 * 
 * @example
 * ```ts
 * import { effectServerLoad } from '@thomasfosterau/effect-svelte';
 * import { Effect } from 'effect';
 * 
 * export const load = effectServerLoad((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* fetchData();
 *     return { data };
 *   })
 * );
 * ```
 */
export function effectServerLoad<
  Params extends Record<string, string> = any,
  ParentData extends Record<string, any> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown>
): ServerLoad<Params, ParentData, OutputData, RouteId> {
  return async (event) => {
    const effect = fn(event);
    const exit = await Effect.runPromiseExit(effect);

    return Exit.match(exit, {
      onFailure: (cause) => {
        throw causeToError(cause);
      },
      onSuccess: (value) => value,
    }) as OutputData;
  };
}

/**
 * Wraps an Effect-based function to work as a SvelteKit universal load function.
 * 
 * @example
 * ```ts
 * import { effectLoad } from '@thomasfosterau/effect-svelte';
 * import { Effect } from 'effect';
 * 
 * export const load = effectLoad((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* processData();
 *     return { data };
 *   })
 * );
 * ```
 */
export function effectLoad<
  Params extends Record<string, string> = any,
  InputData extends Record<string, unknown> | null = any,
  ParentData extends Record<string, unknown> = any,
  OutputData extends Record<string, unknown> | void = any,
  RouteId extends string | null = any
>(
  fn: (
    event: Parameters<Load<Params, InputData, ParentData, OutputData, RouteId>>[0]
  ) => Effect.Effect<OutputData, unknown>
): Load<Params, InputData, ParentData, OutputData, RouteId> {
  return async (event) => {
    const effect = fn(event);
    const exit = await Effect.runPromiseExit(effect);

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
 * 
 * @example
 * ```ts
 * import { effectAction } from '@thomasfosterau/effect-svelte';
 * import { Effect } from 'effect';
 * 
 * export const actions = {
 *   default: effectAction((event) =>
 *     Effect.gen(function* () {
 *       const formData = yield* Effect.promise(() => event.request.formData());
 *       // Process form data
 *       return { success: true };
 *     })
 *   )
 * };
 * ```
 */
export function effectAction<
  Params extends Record<string, string> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown>
): Action<Params, OutputData, RouteId> {
  return async (event) => {
    const effect = fn(event);
    const exit = await Effect.runPromiseExit(effect);

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
 * 
 * @example
 * ```ts
 * import { effectActions } from '@thomasfosterau/effect-svelte';
 * import { Effect } from 'effect';
 * 
 * export const actions = effectActions({
 *   create: (event) => Effect.succeed({ created: true }),
 *   delete: (event) => Effect.succeed({ deleted: true })
 * });
 * ```
 */
export function effectActions<
  Params extends Record<string, string> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any
>(
  actions: Record<
    string,
    (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown>
  >
): Actions<Params, OutputData, RouteId> {
  const wrappedActions: Actions<Params, OutputData, RouteId> = {};

  for (const [key, action] of Object.entries(actions)) {
    wrappedActions[key] = effectAction(action);
  }

  return wrappedActions;
}

/**
 * Wraps an Effect-based function to work as a SvelteKit hook.
 * 
 * @example
 * ```ts
 * import { effectHandle } from '@thomasfosterau/effect-svelte';
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
export function effectHandle(
  fn: (args: Parameters<Handle>[0]) => Effect.Effect<Response, unknown>
): Handle {
  return async ({ event, resolve }) => {
    const effect = fn({ event, resolve });
    const exit = await Effect.runPromiseExit(effect);

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
 * 
 * @example
 * ```ts
 * import { effectEndpoint } from '@thomasfosterau/effect-svelte';
 * import { Effect } from 'effect';
 * import { json } from '@sveltejs/kit';
 * 
 * export const GET = effectEndpoint((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* fetchData();
 *     return json(data);
 *   })
 * );
 * ```
 */
export function effectEndpoint<
  Params extends Record<string, string> = any,
  RouteId extends string | null = any
>(
  fn: (event: RequestEvent<Params, RouteId>) => Effect.Effect<Response, unknown>
): (event: RequestEvent<Params, RouteId>) => Promise<Response> {
  return async (event) => {
    const effect = fn(event);
    const exit = await Effect.runPromiseExit(effect);

    return Exit.match(exit, {
      onFailure: (cause) => {
        const message = Cause.pretty(cause);
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      },
      onSuccess: (value) => value,
    });
  };
}
