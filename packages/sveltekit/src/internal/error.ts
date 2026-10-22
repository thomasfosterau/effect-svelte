import {
  error as kitError,
  isHttpError,
  isRedirect,
  type HttpError,
  type Redirect,
} from "@sveltejs/kit";
import * as Cause from "effect/Cause";
import * as Predicate from "effect/Predicate";

/**
 * Custom error type that preserves the original Effect Cause.
 */
export class EffectCauseError extends Error {
  declare cause: Cause.Cause<unknown>;

  constructor(message: string, cause: Cause.Cause<unknown>) {
    super(message);
    this.name = "EffectCauseError";
    this.cause = cause;
  }
}

/**
 * Converts a failed Effect Cause into the value to `throw`.
 *
 * SvelteKit uses thrown `redirect()` and `error()` objects for control flow.
 * When one of those is raised inside an Effect (either thrown, surfacing as a
 * defect, or used as a typed failure) the original object is rethrown so
 * SvelteKit can handle it as intended. Anything else is wrapped in an
 * `EffectCauseError` that preserves the full Cause for debugging.
 */
export const causeToThrowable = (
  cause: Cause.Cause<unknown>,
): Redirect | HttpError | EffectCauseError => {
  const squashed = Cause.squash(cause);
  if (isRedirect(squashed) || isHttpError(squashed)) {
    return squashed;
  }
  return new EffectCauseError(Cause.pretty(cause), cause);
};

/**
 * The body {@link throwKitError} accepts: a message, or an `App.Error`-shaped
 * object (the shape of `SvelteKit.error`'s public `body`).
 */
export type KitErrorBody = string | Readonly<Record<string, unknown>>;

/**
 * `error()` with the message and the extra `App.Error` properties as separate
 * arguments. Kit's typed overloads only admit a third argument once the app
 * augments `App.Error`, which this library cannot see.
 */
// SAFETY: at runtime `error(status, message, properties)` accepts any
// properties object (it spreads it into the `HttpError` body); only its typed
// overload withholds the third argument until the app augments `App.Error`.
const kitErrorWith = kitError as (
  status: number,
  message?: string,
  properties?: Exclude<KitErrorBody, string>,
) => never;

/**
 * Throw SvelteKit's `error()` for a string or `App.Error`-shaped body, without
 * the `error(status, body)` overload Kit 3 deprecates (kit#16540): an object
 * body is split into `error(status, message, properties)`.
 *
 * The resulting `HttpError` is the one the deprecated overload built: `status`
 * always wins over a `status` field in the body, and a missing message becomes
 * Kit's default `Error: <status>`. A non-string `message` field (outside the
 * `App.Error` type) is dropped in favour of that default.
 */
export const throwKitError = (status: number, body?: KitErrorBody): never => {
  if (body === undefined || Predicate.isString(body)) return kitErrorWith(status, body);
  const { message, ...properties } = body;
  return kitErrorWith(status, Predicate.isString(message) ? message : undefined, properties);
};
