import { isHttpError, isRedirect } from "@sveltejs/kit";
import { Cause } from "effect";

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
export const causeToThrowable = (cause: Cause.Cause<unknown>): unknown => {
  const squashed = Cause.squash(cause);
  if (isRedirect(squashed) || isHttpError(squashed)) {
    return squashed;
  }
  return new EffectCauseError(Cause.pretty(cause), cause);
};
