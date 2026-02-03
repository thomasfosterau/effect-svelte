import type { Load } from "@sveltejs/kit";
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
 * Wraps an Effect-based function to work as a SvelteKit universal load function.
 * The effect will have access to platform services when running server-side.
 * 
 * @example
 * ```ts
 * import { load } from '@thomasfosterau/effect-svelte/kit';
 * import { Effect } from 'effect';
 * 
 * export const load = load((event) =>
 *   Effect.gen(function* () {
 *     const data = yield* processData();
 *     return { data };
 *   })
 * );
 * ```
 */
export function load<
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
