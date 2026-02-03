import type {
  ServerLoad,
  RequestEvent,
  Actions,
  Action,
  Handle,
  Load,
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
 * import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
 * import { Effect } from 'effect';
 * import { HttpClient } from '@effect/platform';
 * 
 * export const load = SvelteKit.serverLoad((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const data = yield* client.get("https://api.example.com/data");
 *     return { data };
 *   })
 * );
 * ```
 */
function serverLoad<
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
 * Wraps an Effect-based function to work as a SvelteKit universal load function.
 * The effect will have access to platform services when running server-side.
 * 
 * @example
 * ```ts
 * import { SvelteKit } from '@thomasfosterau/effect-svelte';
 * import { Effect } from 'effect';
 * 
 * export const load = SvelteKit.load((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* processData();
 *     return { data };
 *   })
 * );
 * ```
 */
function load<
  Params extends Record<string, string> = any,
  InputData extends Record<string, unknown> | null = any,
  ParentData extends Record<string, unknown> = any,
  OutputData extends Record<string, unknown> | void = any,
  RouteId extends string | null = any
>(
  fn: (
    event: Parameters<Load<Params, InputData, ParentData, OutputData, RouteId>>[0]
  ) => Effect.Effect<OutputData, unknown, never>
): Load<Params, InputData, ParentData, OutputData, RouteId> {
  return async (event) => {
    // Universal loads can run on server or client, so we only provide runtime on server
    const runtime = (event as any).request ? SvelteKitRuntime.forRequest(event as any) : null;
    const effect = fn(event);
    const exit = runtime 
      ? await runtime.runPromiseExit(effect as Effect.Effect<OutputData, unknown, never>)
      : await Effect.runPromiseExit(effect);

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
 * import { SvelteKit } from '@thomasfosterau/effect-svelte/server';
 * import { Effect } from 'effect';
 * import { json } from '@sveltejs/kit';
 * import { HttpClient } from '@effect/platform';
 * 
 * export const GET = SvelteKit.endpoint((event) =>
 *   Effect.gen(function* () {
 *     const client = yield* HttpClient.HttpClient;
 *     const data = yield* client.get("https://api.example.com/data");
 *     return json(data);
 *   })
 * );
 * ```
 */
function endpoint<
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
 * SvelteKit namespace containing Effect adapters for SvelteKit.
 * Provides helpers for load functions, actions, endpoints, and hooks.
 */
export const SvelteKit = {
  load,
  serverLoad,
  action,
  actions,
  handle,
  endpoint,
} as const;

/**
 * Export the SvelteKit runtime utilities for advanced use cases.
 */
export { SvelteKitRuntime, runWithSvelteKitRuntime, SvelteKitRequestEvent } from "./runtime.js";
