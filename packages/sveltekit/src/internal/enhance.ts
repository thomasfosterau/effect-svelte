/**
 * The runtime-agnostic core of the `use:enhance` bridge, kept free of any
 * `$app/*` import so it can be unit-tested outside a SvelteKit app build.
 */

import type { SubmitFunction } from "$app/forms";
import { Context, Effect, ManagedRuntime } from "effect";

/** The input SvelteKit passes to a `SubmitFunction` before the request is sent. */
export type SubmitInput = Parameters<SubmitFunction>[0];

/** The result callback a `SubmitFunction` may return, run once the action responds. */
type ResultCallback = Extract<Awaited<ReturnType<SubmitFunction>>, (...args: never) => unknown>;

/** The options passed to the result callback (`result`, `update`, ...). */
export type ResultOptions = Parameters<ResultCallback>[0];

/** A runtime the handler effects can run against (a `Context` or `ManagedRuntime`). */
export type EnhanceRuntime<R> = Context.Context<R> | ManagedRuntime.ManagedRuntime<R, never>;

/**
 * Effect-based handlers for the two phases of an enhanced form submission.
 * `ESubmit` / `EResult` are the errors `onSubmit` / `onResult` may fail with;
 * a failure goes to {@link EnhanceOptions.onError}.
 */
export interface EnhanceHandlers<R = never, ESubmit = never, EResult = never> {
  /**
   * Runs before the request is sent. Call `input.cancel()` to abort the
   * submission (the result phase then never runs). Use for optimistic UI or
   * validation.
   *
   * If it fails with `ESubmit`, the submission is cancelled and the error goes
   * to `onError` (see {@link EnhanceOptions.onError}).
   */
  readonly onSubmit?: (input: SubmitInput) => Effect.Effect<void, ESubmit, R>;
  /**
   * Runs once the action responds, with the `ActionResult` and SvelteKit's
   * `update()` (which applies the default behaviour — updating `page.form`,
   * resetting the form, invalidating). If omitted, SvelteKit's default
   * behaviour applies automatically.
   *
   * If it fails with `EResult`, the error goes to `onError` (see
   * {@link EnhanceOptions.onError}); SvelteKit's default behaviour is not
   * applied in its place.
   */
  readonly onResult?: (options: ResultOptions) => Effect.Effect<void, EResult, R>;
}

/** Options for {@link makeSubmitFunction}. */
export interface EnhanceOptions<R = never, E = never> {
  /**
   * The runtime to run the handler effects against. Omit when the handlers
   * require no services (`R = never`); they then run on the default runtime.
   */
  readonly runtime?: EnhanceRuntime<R>;
  /**
   * Handles an error `onSubmit` or `onResult` failed with (`E`, inferred from
   * their error types), as `Effect.catch` would. It runs on the same runtime
   * and must not fail itself.
   *
   * Only failures reach it: a defect or interruption (in a handler or in
   * `onError`) still rejects the promise SvelteKit awaits, as does a failure
   * when `onError` is omitted (rejecting with the error itself, as if the
   * handler ended in `Effect.orDie`). SvelteKit does not catch that rejection:
   * it sends no request after a rejected `onSubmit`, applies no default result
   * after a rejected `onResult`, and the browser reports an unhandled
   * rejection.
   */
  readonly onError?: ((error: E) => Effect.Effect<void, never, R>) | undefined;
}

/** Run an `Effect<A, E, R>` on the given runtime (or the default when none). */
const runPromiseWith =
  <R>(runtime: EnhanceRuntime<R> | undefined) =>
  <A, E>(effect: Effect.Effect<A, E, R>): Promise<A> => {
    if (runtime === undefined) return Effect.runPromise(effect as Effect.Effect<A, E, never>);
    return Context.isContext(runtime)
      ? Effect.runPromiseWith(runtime)(effect)
      : runtime.runPromise(effect);
  };

/**
 * Build a SvelteKit `SubmitFunction` from Effect-based handlers. See
 * `Forms.enhance` for the public entry point and documentation.
 */
export const makeSubmitFunction = <R = never, ESubmit = never, EResult = never>(
  handlers: EnhanceHandlers<R, ESubmit, EResult>,
  options?: EnhanceOptions<R, NoInfer<ESubmit | EResult>>,
): SubmitFunction => {
  const run = runPromiseWith(options?.runtime);
  const onError = options?.onError;
  return async (input) => {
    if (handlers.onSubmit) {
      const submit = handlers.onSubmit(input);
      await run(
        onError === undefined
          ? submit
          : submit.pipe(
              Effect.catch((error) =>
                Effect.sync(() => input.cancel()).pipe(Effect.andThen(onError(error))),
              ),
            ),
      );
    }
    // Returning `undefined` lets SvelteKit apply its default result behaviour.
    if (!handlers.onResult) return undefined;
    const onResult = handlers.onResult;
    return (resultOptions) => {
      const result = onResult(resultOptions);
      return run(onError === undefined ? result : result.pipe(Effect.catch(onError)));
    };
  };
};
