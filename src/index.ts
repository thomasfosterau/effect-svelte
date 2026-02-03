import type {
  Load,
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
 * Wraps an Effect-based function to work as a SvelteKit universal load function.
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
 * SvelteKit namespace containing universal (client + server) Effect adapters.
 * Use these functions to wrap Effect programs for SvelteKit universal contexts.
 */
export const SvelteKit = {
  load,
} as const;

// ============================================================================
// Effect-Svelte Interoperability Library
// ============================================================================

// Layer 0: Runtime Context
export { provideRuntime, getRuntime } from "./context.svelte.js";

// Layer 1: Scope Primitive
export { useScope, useScopeCallback } from "./scope.svelte.js";

// Layer 2: Core Runners
export { useEffect, type UseEffectOptions, type UseEffectReturn } from "./effect.svelte.js";
export { useStream, type UseStreamReturn } from "./stream.svelte.js";

// Layer 3: Convenience Hooks
export { useDerivedEffect } from "./derived.svelte.js";
export { useQuery, type UseQueryReturn } from "./query.svelte.js";
export { useSubscriptionRef, usePubSub, type UsePubSubReturn } from "./subscription.svelte.js";

// Svelte-to-Effect Direction
export { SignalEmitter, createBoundedEmitter } from "./emitter.js";

// Types and Utilities
export type { AsyncResult } from "./types.js";
export { isInitial, isPending, isSuccess, isFailure, match } from "./utils.js";
