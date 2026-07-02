/**
 * The runtime-agnostic core of the `use:enhance` bridge, kept free of any
 * `$app/*` import so it can be unit-tested outside a SvelteKit app build.
 */

import type { SubmitFunction } from "@sveltejs/kit";
import { Context, Effect, ManagedRuntime } from "effect";

/** The input SvelteKit passes to a `SubmitFunction` before the request is sent. */
export type SubmitInput = Parameters<SubmitFunction>[0];

/** The result callback a `SubmitFunction` may return, run once the action responds. */
type ResultCallback = Extract<Awaited<ReturnType<SubmitFunction>>, (...args: never) => unknown>;

/** The options passed to the result callback (`result`, `update`, ...). */
export type ResultOptions = Parameters<ResultCallback>[0];

/** A runtime the handler effects can run against (a `Context` or `ManagedRuntime`). */
export type EnhanceRuntime<R> = Context.Context<R> | ManagedRuntime.ManagedRuntime<R, never>;

/** Effect-based handlers for the two phases of an enhanced form submission. */
export interface EnhanceHandlers<R = never> {
  /**
   * Runs before the request is sent. Call `input.cancel()` to abort the
   * submission (the result phase then never runs). Use for optimistic UI or
   * validation.
   */
  readonly onSubmit?: (input: SubmitInput) => Effect.Effect<void, never, R>;
  /**
   * Runs once the action responds, with the `ActionResult` and SvelteKit's
   * `update()` (which applies the default behaviour — updating `page.form`,
   * resetting the form, invalidating). If omitted, SvelteKit's default
   * behaviour applies automatically.
   */
  readonly onResult?: (options: ResultOptions) => Effect.Effect<void, never, R>;
}

/** Options for {@link makeSubmitFunction}. */
export interface EnhanceOptions<R = never> {
  /**
   * The runtime to run the handler effects against. Omit when the handlers
   * require no services (`R = never`); they then run on the default runtime.
   */
  readonly runtime?: EnhanceRuntime<R>;
}

/** Run an `Effect<A, never, R>` on the given runtime (or the default when none). */
const runPromiseWith =
  <R>(runtime: EnhanceRuntime<R> | undefined) =>
  <A>(effect: Effect.Effect<A, never, R>): Promise<A> => {
    if (runtime === undefined) return Effect.runPromise(effect as Effect.Effect<A, never, never>);
    return Context.isContext(runtime)
      ? Effect.runPromiseWith(runtime)(effect)
      : runtime.runPromise(effect);
  };

/**
 * Build a SvelteKit `SubmitFunction` from Effect-based handlers. See
 * `Forms.enhance` for the public entry point and documentation.
 */
export const makeSubmitFunction = <R = never>(
  handlers: EnhanceHandlers<R>,
  options?: EnhanceOptions<R>,
): SubmitFunction => {
  const run = runPromiseWith(options?.runtime);
  return async (input) => {
    if (handlers.onSubmit) await run(handlers.onSubmit(input));
    // Returning `undefined` lets SvelteKit apply its default result behaviour.
    if (!handlers.onResult) return undefined;
    const onResult = handlers.onResult;
    return (resultOptions) => run(onResult(resultOptions));
  };
};
