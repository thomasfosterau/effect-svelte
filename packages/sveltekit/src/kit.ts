/**
 * Effect-native SvelteKit control-flow errors and a turnkey boundary translator.
 *
 * Every server consumer previously needed to hand-roll their own `translateError`
 * that mapped domain errors → `redirect()` / `error()` / `fail()`. This module
 * ships the catalogue those consumers all reinvented:
 *
 * - {@link KitRedirect}, {@link KitError}, {@link KitActionFailure} — tagged
 *   Effect failure types for each SvelteKit control-flow call.
 * - {@link SvelteKit.redirect}, {@link SvelteKit.error}, {@link SvelteKit.fail}
 *   — helpers that `yield*` a typed failure instead of throwing.
 * - {@link SvelteKit.translate} — the base `ErrorTranslator` that converts
 *   {@link KitRedirect} and {@link KitError} to the thrown SvelteKit call at the
 *   request boundary. A {@link KitActionFailure} is not thrown: the action
 *   wrappers return it as `fail()`'s `ActionFailure`
 *   ({@link SvelteKit.failuresReturned}).
 * - {@link SvelteKit.makeTranslator} — compose `translate` with your own
 *   domain-error cases (consumer cases run first);
 *   {@link SvelteKit.makeActionTranslator} — the same for form actions, whose
 *   cases may also return `fail()`.
 * - {@link KitErrorTranslator} — the translator contract. It only throws,
 *   except for a form action's ({@link KitActionErrorTranslator}), which may
 *   also return an `ActionFailure`.
 *
 * @example
 * ```ts
 * import { SvelteKit, makeRuntimeAdapter, RequestRuntime } from "@thomasfosterau/effect-sveltekit/server";
 * import { Effect } from "effect";
 *
 * // Yield kit errors instead of throwing:
 * const load = serverLoad(() =>
 *   Effect.gen(function* () {
 *     const user = yield* getUser;
 *     if (!user) yield* SvelteKit.redirect(303, "/login");
 *     if (!user.active) yield* SvelteKit.error(403, "Account disabled");
 *     return { user };
 *   })
 * );
 *
 * // Compose with your own domain errors:
 * import { error } from "@sveltejs/kit";
 * const { serverLoad } = makeRuntimeAdapter(
 *   RequestRuntime.fromLayer(AppLayer),
 *   {
 *     translateError: SvelteKit.makeTranslator([
 *       (e) => { if (e instanceof NotFound) error(404, "Not found"); },
 *     ]),
 *   },
 * );
 * ```
 */

import {
  fail as kitFail,
  isActionFailure,
  redirect as kitRedirect,
  type ActionFailure,
} from "@sveltejs/kit";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { causeToThrowable, throwKitError, type KitErrorBody } from "./internal/error.js";

// ─── Tagged error classes ────────────────────────────────────────────────────

/**
 * An Effect-native redirect. Yield via {@link SvelteKit.redirect}; translated
 * at the request boundary by {@link SvelteKit.translate}.
 */
export class KitRedirect extends Error {
  readonly _tag = "KitRedirect" as const;

  constructor(
    readonly status: 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308,
    readonly location: string | URL,
  ) {
    super(`Redirect to ${String(location)}`);
    this.name = "KitRedirect";
  }
}

/**
 * An Effect-native HTTP error. Yield via {@link SvelteKit.error}; translated
 * at the request boundary by {@link SvelteKit.translate}.
 */
export class KitError extends Error {
  readonly _tag = "KitError" as const;

  constructor(
    readonly status: number,
    readonly body?: KitErrorBody,
  ) {
    super(`HTTP ${status}`);
    this.name = "KitError";
  }
}

/**
 * An Effect-native form-action failure. Yield via {@link SvelteKit.fail}; the
 * action wrappers return it to SvelteKit as `fail(status, data)`
 * ({@link SvelteKit.failuresReturned}). Outside a form action nothing can
 * return it, so {@link SvelteKit.translate} throws it as an `EffectCauseError`
 * (a 500).
 */
export class KitActionFailure<T = undefined> extends Error {
  readonly _tag = "KitActionFailure" as const;

  constructor(
    readonly status: number,
    readonly data: T,
  ) {
    super(`Action failure ${status}`);
    this.name = "KitActionFailure";
  }

  /**
   * The `ActionFailure` SvelteKit's `fail(status, data)` builds for this
   * failure: what a form action returns to report it.
   */
  get actionFailure(): ActionFailure<T> {
    return kitFail(this.status, this.data);
  }
}

// ─── Translator types ────────────────────────────────────────────────────────

/**
 * A boundary translator: what a wrapper calls with the failed `Cause` of the
 * Effect it ran.
 *
 * `Returned` is what the translator may return instead of throwing. It is
 * `never` by default: a translator stands where the wrapper would otherwise
 * throw, so it throws SvelteKit control flow (`error()`, `redirect()`) or
 * anything else, and every wrapper accepts it. Only a form action has a
 * returned form of failure (`fail()`'s `ActionFailure`), so only the action
 * wrappers accept a translator that returns one: a
 * {@link KitActionErrorTranslator}.
 *
 * The Kit base translator ({@link SvelteKit.translate}) handles
 * {@link KitRedirect} and {@link KitError}. Build a custom translator via
 * {@link SvelteKit.makeTranslator} or `Errors.toSvelteKit`.
 */
export type KitErrorTranslator<Returned = never> = (cause: Cause.Cause<unknown>) => Returned;

/**
 * A form action's boundary translator: a {@link KitErrorTranslator} that may
 * also return `fail(status, data)`, which the action wrappers return to
 * SvelteKit as the action's result (so the route's `ActionData` includes
 * `Data`).
 *
 * Build one with {@link SvelteKit.makeActionTranslator} or
 * `Errors.toSvelteKit`, and pass it as `translateActionError` to
 * `makeRuntimeAdapter` / `makeServerRuntime` / `runAction`. A throw-only {@link KitErrorTranslator} is
 * one too, so an app can share one translator between its loads and actions.
 */
export type KitActionErrorTranslator<Data = undefined> = KitErrorTranslator<ActionFailure<Data>>;

/**
 * A single domain-error case for {@link SvelteKit.makeTranslator} and
 * {@link SvelteKit.makeActionTranslator}.
 *
 * Receives the squashed error value: whatever `Cause.squash` makes of the
 * failed `Cause` (the typed failure, a defect or an interruption error), so it
 * is `unknown` until the case narrows it, usually with `instanceof`. Throw
 * (e.g. `error()` / `redirect()`) to handle the case; return normally to pass
 * through to the next case.
 *
 * `Returned` is what a case may return to handle the error instead of
 * throwing. It is `never` by default: a case of `makeTranslator` has no
 * result, and whatever it returns is ignored. A case of
 * `makeActionTranslator` may return `fail()`'s `ActionFailure`; a throw-only
 * case is one of those too.
 */
export type KitTranslatorCase<Returned = never> = (
  error: ReturnType<typeof Cause.squash>,
) => void | Returned;

/**
 * The `ActionFailure` an action wrapper returns for the
 * {@link KitActionFailure}s in an Effect's error type `E`: `fail()`'s result,
 * with the `data` those failures carry.
 *
 * It follows the declared error type: one with no `KitActionFailure` member
 * (`never`, a union of other errors, and `unknown`, which declares nothing)
 * gives `never`, so nothing is added to the action's result type.
 */
export type ActionFailureOf<E> = DeclaredActionFailure<E>["actionFailure"];

/** The members of an error type that are {@link KitActionFailure}s. */
type DeclaredActionFailure<E> = Extract<E, KitActionFailure<unknown>>;

/** Whether a typed failure is one of its error type's {@link KitActionFailure}s. */
const isDeclaredActionFailure = <E>(error: E): error is DeclaredActionFailure<E> =>
  error instanceof KitActionFailure;

/**
 * Whether what a {@link KitTranslatorCase} returned is its `ActionFailure`
 * rather than nothing: SvelteKit's own `isActionFailure`.
 */
const isActionFailureOf = <Data>(
  returned: void | ActionFailure<Data>,
): returned is ActionFailure<Data> => isActionFailure(returned);

// ─── Base translator ─────────────────────────────────────────────────────────

const baseTranslate: KitErrorTranslator = (cause) => {
  const squashed = Cause.squash(cause);

  if (squashed instanceof KitRedirect) {
    // redirect() is typed as () => never — throws internally.
    kitRedirect(squashed.status, squashed.location);
  }

  if (squashed instanceof KitError) {
    // throwKitError() is typed as never: it always throws Kit's HttpError.
    throwKitError(squashed.status, squashed.body);
  }

  // A KitActionFailure lands here too: SvelteKit has no thrown form of
  // `fail()`, and only an action wrapper can return one (`failuresReturned`).
  throw causeToThrowable(cause);
};

// ─── Public namespace ─────────────────────────────────────────────────────────

/**
 * Effect-native SvelteKit control-flow helpers and the default boundary
 * translator.
 *
 * **Error types**: {@link KitRedirect}, {@link KitError}, {@link KitActionFailure}
 * are tagged Effect failures — use them with `Effect.catchTag`, `Match.tag`,
 * and `instanceof` checks.
 *
 * **Default translator**: `SvelteKit.translate` is wired in as the default
 * `translateError` for every server wrapper (`serverLoad`, `action`,
 * `makeRuntimeAdapter`, `RemoteFunction.withRuntime`, etc.).
 */
export const SvelteKit = {
  /**
   * Fail with a redirect. Equivalent to SvelteKit's `redirect()` but as an
   * Effect failure instead of a thrown exception.
   *
   * @example
   * ```ts
   * yield* SvelteKit.redirect(303, "/login");
   * ```
   */
  redirect: (
    status: 300 | 301 | 302 | 303 | 304 | 305 | 306 | 307 | 308,
    location: string | URL,
  ): Effect.Effect<never, KitRedirect> => Effect.fail(new KitRedirect(status, location)),

  /**
   * Fail with an HTTP error. Equivalent to SvelteKit's `error()` but as an
   * Effect failure instead of a thrown exception.
   *
   * @example
   * ```ts
   * yield* SvelteKit.error(404, "Not found");
   * yield* SvelteKit.error(403, { message: "Forbidden" });
   * ```
   */
  error: (status: number, body?: KitErrorBody): Effect.Effect<never, KitError> =>
    Effect.fail(new KitError(status, body)),

  /**
   * Fail with a form-action failure. Equivalent to SvelteKit's `fail()` but as
   * an Effect failure instead of a return value.
   *
   * @example
   * ```ts
   * yield* SvelteKit.fail(422, { email: "already taken" });
   * ```
   */
  fail: <T extends Record<string, unknown>>(
    status: number,
    data: T,
  ): Effect.Effect<never, KitActionFailure<T>> => Effect.fail(new KitActionFailure(status, data)),

  /**
   * The turnkey boundary translator. Throws {@link KitRedirect} as
   * `redirect()`, {@link KitError} as `error()`, SvelteKit's own thrown
   * `redirect()` / `error()` unchanged, and anything else as an
   * `EffectCauseError` (500). It never returns.
   *
   * That includes a {@link KitActionFailure}: `fail()` has no thrown form, so
   * the action wrappers return it before the translator runs
   * ({@link SvelteKit.failuresReturned}), and anywhere else it is a 500.
   *
   * This is the default `translateError` for every server wrapper. To extend it
   * with your own domain errors, use {@link SvelteKit.makeTranslator}.
   */
  translate: baseTranslate,

  /**
   * What makes an Effect a form action: its {@link KitActionFailure} failures
   * (`yield* SvelteKit.fail(status, data)`) become its result, as the
   * `ActionFailure` SvelteKit's `fail(status, data)` builds, which an action
   * reports by returning. Every action wrapper (`action`, `actions`,
   * `runAction`, the `effectKit()` plugin's) applies it before the boundary
   * translator sees the failure.
   *
   * The result's `data` type is read from the Effect's error type
   * ({@link ActionFailureOf}), so only a failure in the error channel is
   * returned. The other errors stay in the error channel, and a
   * `KitActionFailure` that was thrown (a defect) is left to the translator;
   * the returned Effect fails with whatever `effect` fails with otherwise.
   *
   * @example
   * ```ts
   * // Effect<{ saved: true } | ActionFailure<{ email: string }>, …>
   * const result = SvelteKit.failuresReturned(
   *   Effect.gen(function* () {
   *     if (taken) yield* SvelteKit.fail(422, { email: "already taken" });
   *     return { saved: true as const };
   *   }),
   * );
   * ```
   */
  failuresReturned: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | ActionFailureOf<E>, E, R> =>
    Effect.catchIf(effect, isDeclaredActionFailure, (failure) =>
      Effect.succeed(failure.actionFailure),
    ),

  /**
   * Build a custom boundary translator by prepending domain-error cases before
   * the Kit base cases.
   *
   * Each case function receives the squashed error value. Throw (e.g. call
   * `error()` / `redirect()` from `@sveltejs/kit`) to handle the case; return
   * normally to pass through to the next case or the Kit base translator
   * ({@link SvelteKit.translate}). What a case returns is ignored, so the
   * translator only throws and fits every wrapper's `translateError`; for a
   * form action whose cases return `fail()`, use
   * {@link SvelteKit.makeActionTranslator}.
   *
   * @example
   * ```ts
   * import { error } from "@sveltejs/kit";
   *
   * const translateError = SvelteKit.makeTranslator([
   *   (e) => { if (e instanceof NotFound) error(404, "Not found"); },
   *   (e) => { if (e instanceof Forbidden) error(403, "Forbidden"); },
   * ]);
   *
   * const { serverLoad } = makeRuntimeAdapter(
   *   RequestRuntime.fromLayer(AppLayer),
   *   { translateError },
   * );
   * ```
   */
  makeTranslator:
    (extraCases: ReadonlyArray<KitTranslatorCase>): KitErrorTranslator =>
    (cause) => {
      const squashed = Cause.squash(cause);
      Arr.forEach(extraCases, (matcher) => {
        matcher(squashed);
      });
      return baseTranslate(cause);
    },

  /**
   * Build a form action's boundary translator: {@link SvelteKit.makeTranslator}
   * whose cases may also return `fail(status, data)`.
   *
   * Each case function receives the squashed error value. Return `fail()`'s
   * `ActionFailure` to have the action return it to SvelteKit, throw (e.g.
   * `error()` / `redirect()`) to handle the case that way, or return nothing
   * to pass through to the next case; an error no case handles goes to
   * `fallback` (by default {@link SvelteKit.translate}), so the translator
   * throws whatever a case or the fallback throws. Pass the translator your
   * loads use as `fallback` to add `fail()` cases on top of it.
   *
   * `Data` is the type of the failures' data, which the action wrappers add to
   * the action's result. It is not inferred from the cases: give it as the
   * type argument (a union when the cases fail with different data).
   *
   * Only the action wrappers accept the result, as `translateActionError`.
   *
   * @example
   * ```ts
   * import { fail } from "@sveltejs/kit";
   *
   * const translateActionError = SvelteKit.makeActionTranslator<{ message: string }>(
   *   [(e) => (e instanceof Invalid ? fail(422, { message: e.message }) : undefined)],
   *   translateError, // the throw-only translator the loads use
   * );
   *
   * const { serverLoad, action } = makeRuntimeAdapter(
   *   RequestRuntime.fromLayer(AppLayer),
   *   { translateError, translateActionError },
   * );
   * ```
   */
  makeActionTranslator:
    <Data = never>(
      cases: ReadonlyArray<KitTranslatorCase<ActionFailure<NoInfer<Data>>>>,
      fallback: KitActionErrorTranslator<NoInfer<Data>> = baseTranslate,
    ): KitActionErrorTranslator<Data> =>
    (cause) => {
      const squashed = Cause.squash(cause);
      const returned = Arr.findFirst(cases, (matcher) =>
        Option.liftPredicate(matcher(squashed), isActionFailureOf<Data>),
      );
      return Option.getOrElse(returned, () => fallback(cause));
    },
} as const;
