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
 * - {@link SvelteKit.translate} — the base `ErrorTranslator` that converts those
 *   failures to the appropriate SvelteKit call at the request boundary.
 * - {@link SvelteKit.makeTranslator} — compose `translate` with your own
 *   domain-error cases (consumer cases run first).
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

import { fail as kitFail, redirect as kitRedirect } from "@sveltejs/kit";
import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
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
 * An Effect-native form-action failure. Yield via {@link SvelteKit.fail};
 * translated at the request boundary by {@link SvelteKit.translate}.
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
}

// ─── Translator types ────────────────────────────────────────────────────────

/**
 * A single domain-error case for {@link SvelteKit.makeTranslator}.
 *
 * Receives the squashed error value. Throw (e.g. `error()` / `redirect()`) to
 * handle the case; return normally to pass through to the next case.
 */
export type KitTranslatorCase = (error: unknown) => undefined | void;

/**
 * A boundary translator: turn a failed `Cause` into thrown SvelteKit control
 * flow or an `ActionFailure` return value.
 *
 * The Kit base translator ({@link SvelteKit.translate}) handles
 * {@link KitRedirect}, {@link KitError}, and {@link KitActionFailure}. Build a
 * custom translator via {@link SvelteKit.makeTranslator}.
 */
export type KitErrorTranslator = (cause: Cause.Cause<unknown>) => never;

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

  if (squashed instanceof KitActionFailure) {
    // fail() returns an ActionFailure (doesn't throw). SvelteKit detects it as
    // the action's return value. Typed as never to satisfy ErrorTranslator while
    // allowing makeRuntimeAdapter's `return translateError(cause)` to propagate
    // the ActionFailure to SvelteKit correctly at runtime.
    // SAFETY: the `never` only satisfies the `KitErrorTranslator` contract;
    // every caller returns the translator's result straight to SvelteKit, which
    // treats a returned `ActionFailure` as the action's failure response.
    return kitFail(squashed.status, squashed.data) as never;
  }

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
   * The turnkey boundary translator. Converts {@link KitRedirect} →
   * `redirect()`, {@link KitError} → `error()`, {@link KitActionFailure} →
   * `fail()`, and anything else → `EffectCauseError` (500).
   *
   * This is the default `translateError` for every server wrapper. To extend it
   * with your own domain errors, use {@link SvelteKit.makeTranslator}.
   */
  translate: baseTranslate,

  /**
   * Build a custom boundary translator by prepending domain-error cases before
   * the Kit base cases.
   *
   * Each case function receives the squashed error value. Throw (e.g. call
   * `error()` / `redirect()` from `@sveltejs/kit`) to handle the case; return
   * normally to pass through to the next case or the Kit base translator.
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
} as const;
