import type {
  ServerLoad,
  RequestEvent,
  Actions,
  Action,
  Handle,
} from "@sveltejs/kit";
import { Effect, Exit, Cause } from "effect";

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
 * 
 * @example
 * ```ts
 * import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
 * import { Effect } from 'effect';
 * 
 * export const load = SvelteKit.load((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* fetchData();
 *     return { data };
 *   })
 * );
 * ```
 */
function load<
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
 * Wraps an Effect-based function to work as a SvelteKit action handler.
 * 
 * @example
 * ```ts
 * import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
 * import { Effect } from 'effect';
 * 
 * export const actions = {
 *   default: SvelteKit.action((event) =>
 *     Effect.gen(function* () {
 *       const formData = yield* Effect.promise(() => event.request.formData());
 *       // Process form data
 *       return { success: true };
 *     })
 *   )
 * };
 * ```
 */
function action<
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
 * import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
 * import { Effect } from 'effect';
 * 
 * export const actions = SvelteKit.actions({
 *   create: (event) => Effect.succeed({ created: true }),
 *   delete: (event) => Effect.succeed({ deleted: true })
 * });
 * ```
 */
function actions<
  Params extends Record<string, string> = any,
  OutputData extends Record<string, any> | void = any,
  RouteId extends string | null = any
>(
  actionsMap: Record<
    string,
    (event: RequestEvent<Params, RouteId>) => Effect.Effect<OutputData, unknown>
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
 * 
 * @example
 * ```ts
 * import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
 * import { Effect } from 'effect';
 * 
 * export const handle = SvelteKit.handle(({ event, resolve }) =>
 *   Effect.gen(function* () {
 *     // Add custom logic before resolve
 *     const response = yield* Effect.promise(() => resolve(event));
 *     // Add custom logic after resolve
 *     return response;
 *   })
 * );
 * ```
 */
function handle(
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
 * import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
 * import { Effect } from 'effect';
 * import { json } from '@sveltejs/kit';
 * 
 * export const GET = SvelteKit.endpoint((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* fetchData();
 *     return json(data);
 *   })
 * );
 * ```
 */
function endpoint<
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

/**
 * SvelteKit namespace containing server-side Effect adapters.
 * Use these functions to wrap Effect programs for SvelteKit server-only contexts.
 */
export const SvelteKit = {
  load,
  action,
  actions,
  handle,
  endpoint,
} as const;
