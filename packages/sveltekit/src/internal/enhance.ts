/**
 * The runtime-agnostic core of the `use:enhance` bridge, kept free of any
 * `$app/*` import so it can be unit-tested outside a SvelteKit app build.
 */

import type { SubmitFunction } from "$app/forms";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import { runPromise } from "./run.js";

/** The input SvelteKit passes to a `SubmitFunction` before the request is sent. */
export type SubmitInput = Parameters<SubmitFunction>[0];

/** The result callback a `SubmitFunction` may return, run once the action responds. */
type ResultCallback = Extract<Awaited<ReturnType<SubmitFunction>>, (...args: never) => void>;

/** The options passed to the result callback (`result`, `update`, ...). */
export type ResultOptions = Parameters<ResultCallback>[0];

/** A runtime the handler effects can run against (a `Context` or `ManagedRuntime`). */
export type EnhanceRuntime<R> = Context.Context<R> | ManagedRuntime.ManagedRuntime<R, never>;

/**
 * Effect-based handlers for the two phases of an enhanced form submission,
 * plus `onError` for the errors they fail with. `ESubmit` / `EResult` are the
 * errors `onSubmit` / `onResult` may fail with, and `E` (their union by
 * default) the error `onError` receives. Each handler is called as a method of
 * the handlers object, so `this` in a handler written as a method is that
 * object. An absent handler is an omitted key, not one set to `undefined`.
 */
export interface EnhanceHandlers<
  R = never,
  ESubmit = never,
  EResult = never,
  E = ESubmit | EResult,
> {
  /**
   * Runs before the request is sent. Call `input.cancel()` to abort the
   * submission (the result phase then never runs). Use for optimistic UI or
   * validation.
   *
   * If it fails with `ESubmit`, the submission is cancelled and the error goes
   * to {@link EnhanceHandlers.onError | onError}.
   */
  readonly onSubmit?: (input: SubmitInput) => Effect.Effect<void, ESubmit, R>;
  /**
   * Runs once the action responds, with the `ActionResult` and SvelteKit's
   * `update()` (which applies the default behaviour — updating `page.form`,
   * resetting the form, invalidating). If omitted, SvelteKit's default
   * behaviour applies automatically.
   *
   * If it fails with `EResult`, the error goes to
   * {@link EnhanceHandlers.onError | onError}; SvelteKit's default behaviour
   * is not applied in its place.
   */
  readonly onResult?: (options: ResultOptions) => Effect.Effect<void, EResult, R>;
  /**
   * Handles an error `onSubmit` or `onResult` failed with (`E`, the union of
   * their error types), as `Effect.catch` would. It runs on the same runtime
   * and must not fail itself.
   *
   * Write it after `onSubmit` / `onResult` for `error` to be inferred
   * precisely. Written before a handler whose parameters are not annotated
   * (such as `onResult: ({ result }) => ...`), it still type-checks, but
   * `error` is `unknown`: TypeScript types `onError`'s parameter before it has
   * seen that handler's error type. An annotated parameter (or a function
   * passed by name) must accept every error the handlers fail with, in either
   * order.
   *
   * Only failures reach it: a defect or interruption (in a handler or in
   * `onError`) still rejects the promise SvelteKit awaits, as does a failure
   * when `onError` is omitted (rejecting with the error itself, as if the
   * handler ended in `Effect.orDie`). SvelteKit does not catch that rejection:
   * it sends no request after a rejected `onSubmit`, applies no default result
   * after a rejected `onResult`, and the browser reports an unhandled
   * rejection.
   */
  readonly onError?: (error: E) => Effect.Effect<void, never, R>;
}

/** Options for {@link makeSubmitFunction}. */
export interface EnhanceOptions<R = never> {
  /**
   * The runtime to run the handler effects against, providing every service
   * `R` they require. Required when the handlers (or `onError`) require
   * services; omit it when they require none (`R = never`), and they run on
   * the default runtime. Absent means the key is omitted, not `undefined`.
   */
  readonly runtime?: EnhanceRuntime<R>;
}

/**
 * The options argument of `Forms.enhance`, as a rest tuple: optional when the
 * handlers require no services (`R = never`), and otherwise required, with a
 * `runtime` that provides `R`. There is no ambient runtime to fall back on, so
 * handlers that require services and run without one would die with a
 * missing-service defect. A function that wraps `Forms.enhance` for a generic
 * `R` takes its options as `...options: EnhanceOptionsArgs<R>` and forwards
 * them unchanged.
 */
export type EnhanceOptionsArgs<R> = [R] extends [never]
  ? [options?: EnhanceOptions]
  : [options: EnhanceOptions<R> & { readonly runtime: EnhanceRuntime<R> }];

/** The handler names {@link makeSubmitFunction} accepts. */
export type EnhanceHandlerKey = keyof EnhanceHandlers;

/**
 * The default of a handler's error (`ESubmit` / `EResult`) while TypeScript
 * has not inferred it: for a handler it types after `onError`, for one it
 * skips in its first inference pass (a handler whose parameters are not
 * annotated), or for one that is absent (and left out by `Keys`).
 *
 * It is `any` so that every handler type-checks against it, whatever it fails
 * with: when a call does not type-check, TypeScript may report the errors
 * against its first-pass inference, and a handler that did not fit this
 * default would then be blamed for a missing or wrong runtime. Detected with
 * {@link IsErrorNotInferred}, never left in `onError`'s parameter type.
 */
export type ErrorNotInferred = any;

/** Whether `Errors` includes a handler error not inferred yet ({@link ErrorNotInferred}). */
export type IsErrorNotInferred<Errors> = 0 extends 1 & Errors ? true : false;

/**
 * The services a handler requires: `R`, or none while it is not inferred, as
 * for an absent handler. The default of a handler's requirements (`RSubmit` /
 * `RResult` / `RError` of {@link makeSubmitFunction}) while TypeScript has not
 * inferred them is `unknown`, which every handler's requirements are
 * assignable to (see {@link ErrorNotInferred} for why).
 *
 * Since `unknown` must count as none, so does every requirements type that
 * `unknown` is assignable to: an effect typed as requiring `any` or `unknown`
 * (to which a union with `unknown` collapses), such as one annotated
 * `Effect.Effect<void, never, any>`, is treated as requiring no services, so
 * no runtime is demanded for it. Such a type names no service a runtime could
 * be checked against, and only a top type fits every handler in TypeScript's
 * first inference pass.
 */
export type RequiredServices<R> = unknown extends R ? never : R;

/** The errors of the handlers named in `Keys`. */
export type HandlerErrors<Keys extends EnhanceHandlerKey, ESubmit, EResult> =
  | ("onSubmit" extends Keys ? ESubmit : never)
  | ("onResult" extends Keys ? EResult : never);

/**
 * The error an unannotated `onError` receives: the handlers' errors, or
 * `unknown` while one of them is not inferred yet (`onError` written before a
 * handler whose parameters are not annotated).
 */
export type OnErrorInput<Errors> = IsErrorNotInferred<Errors> extends true ? unknown : Errors;

/**
 * Requires `onError` to accept every error in `Errors` when its parameter is
 * annotated (`E` is then inferred from the annotation). The check waits while
 * a handler's error is not inferred yet, and applies once it is.
 */
export type OnErrorAccepts<R, Errors, E> =
  IsErrorNotInferred<Errors> extends true
    ? unknown
    : [Errors] extends [E]
      ? unknown
      : OnErrorMustAccept<R, Errors>;

/** The `onError` that {@link OnErrorAccepts} requires. */
export interface OnErrorMustAccept<R, Errors> {
  readonly onError?: (error: Errors) => Effect.Effect<void, never, R>;
}

/**
 * Run an `Effect<A, E, R>` on the given runtime (or the default when `None`).
 * The caller vouches that the runtime provides `R`, or that `R` is `never`
 * when there is none.
 */
const runPromiseWith =
  (runtime: Option.Option<EnhanceRuntime<never>>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> => {
    // SAFETY: `EnhanceOptionsArgs<R>` makes the runtime optional only when the
    // handlers require no services (`R` is `never`), and otherwise requires
    // one that provides `R`, so the runtime meets the effect's requirements.
    const provided = effect as Effect.Effect<A, E>;
    return Option.match(runtime, {
      onNone: () => runPromise(provided),
      onSome: (given) =>
        Context.isContext(given)
          ? Effect.runPromiseWith(given)(provided)
          : given.runPromise(provided),
    });
  };

/**
 * The handlers {@link makeSubmitFunction} accepts: {@link EnhanceHandlers},
 * with each handler's requirements in a parameter of its own (`RSubmit`,
 * `RResult`, `RError`). TypeScript infers one candidate per handler and does
 * not union them, so a single requirements parameter would reject handlers
 * that require different services even when the runtime provides them all.
 */
export type EnhanceHandlersBy<RSubmit, RResult, RError, ESubmit, EResult, E> = Pick<
  EnhanceHandlers<RSubmit, ESubmit, EResult, E>,
  "onSubmit"
> &
  Pick<EnhanceHandlers<RResult, ESubmit, EResult, E>, "onResult"> &
  Pick<EnhanceHandlers<RError, ESubmit, EResult, E>, "onError">;

/**
 * Build a SvelteKit `SubmitFunction` from Effect-based handlers. See
 * `Forms.enhance` for the public entry point and documentation.
 *
 * The type parameters are inferred, never written. `RSubmit`, `RResult` and
 * `RError` are the services each handler requires (see
 * {@link EnhanceHandlersBy}). `Keys` names the handlers present: it is
 * inferred from the keys of the handlers object, which TypeScript knows before
 * it types any handler, through the `Pick` of those handlers in the parameter
 * type (which adds nothing else to it). `E` (the error `onError` receives) is computed from their errors, or inferred from
 * `onError`'s parameter annotation and then checked against them, so a
 * handlers object type-checks whatever its property order (see
 * {@link EnhanceHandlers.onError}). The options argument, and its `runtime`,
 * are required when the handlers require any service, and the runtime must
 * provide all of them (see {@link EnhanceOptionsArgs}).
 *
 * When a call does not type-check, TypeScript may report it against its first
 * inference pass, which skips handlers whose parameters are not annotated. The
 * defaults of the handler parameters ({@link ErrorNotInferred} for the
 * errors, `unknown` for the requirements) accept any handler, so a missing or wrong
 * runtime is reported on the call or on the runtime, never on a handler.
 */
export const makeSubmitFunction = <
  RSubmit = unknown,
  RResult = unknown,
  RError = unknown,
  ESubmit = ErrorNotInferred,
  EResult = ErrorNotInferred,
  Keys extends EnhanceHandlerKey = never,
  E = OnErrorInput<HandlerErrors<Keys, ESubmit, EResult>>,
>(
  handlers: EnhanceHandlersBy<RSubmit, RResult, RError, ESubmit, EResult, E> &
    Pick<EnhanceHandlersBy<RSubmit, RResult, RError, ESubmit, EResult, E>, Keys> &
    NoInfer<OnErrorAccepts<RError, HandlerErrors<Keys, ESubmit, EResult>, E>>,
  // The requirements are inferred from the handlers alone; the runtime is
  // then checked against their union.
  ...rest: NoInfer<
    EnhanceOptionsArgs<
      RequiredServices<RSubmit> | RequiredServices<RResult> | RequiredServices<RError>
    >
  >
): SubmitFunction => {
  type R = RequiredServices<RSubmit> | RequiredServices<RResult> | RequiredServices<RError>;
  // `None` when the options, or their runtime, were left out.
  const run = runPromiseWith(Option.fromUndefinedOr(rest[0]?.runtime));
  // SAFETY: each handler requires a part of `R`, which the runtime provides in
  // full, and `E` is the union of the errors of the handlers present, so
  // `onError` accepts whatever either handler fails with (`ESubmit | EResult`,
  // the default of `EnhanceHandlers`' last parameter).
  const phases = handlers as EnhanceHandlers<R, ESubmit, EResult>;
  // Each handler is called as a method of the handlers object (`this` is
  // `handlers`), as 0.5.0 called `onSubmit`. `onError` is read once, here.
  const handleError = Option.map(
    Option.fromUndefinedOr(phases.onError),
    (onError) => (error: ESubmit | EResult) => onError.call(handlers, error),
  );
  return async (input) => {
    // `onSubmit` and `onResult` are read on each submission, so a handler
    // replaced on the handlers object after `enhance()` is the one that runs.
    // `onResult` is read once `onSubmit` has run, so `onSubmit` may set it.
    const submit = phases.onSubmit?.(input);
    if (submit !== undefined) {
      await run(
        Option.match(handleError, {
          onNone: () => submit,
          onSome: (handle) =>
            submit.pipe(
              Effect.catch((error) =>
                Effect.sync(() => input.cancel()).pipe(Effect.andThen(handle(error))),
              ),
            ),
        }),
      );
    }
    const { onResult } = phases;
    // Returning `undefined` lets SvelteKit apply its default result behaviour.
    if (!onResult) return undefined;
    return (resultOptions) => {
      const result = onResult.call(handlers, resultOptions);
      return run(
        Option.match(handleError, {
          onNone: () => result,
          onSome: (handle) => result.pipe(Effect.catch(handle)),
        }),
      );
    };
  };
};
