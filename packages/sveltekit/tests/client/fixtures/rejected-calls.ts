/**
 * Fallback signatures for the type-level tests in `forms.test.ts`: each accepts
 * a call that the function under test rejects and returns a {@link Rejected}
 * type, so the test can assert the rejection where a call under an
 * expect-error directive would not compile. Only the types are used: the test
 * merges them over the real function, and the values here are never called.
 *
 * The type parameters in this file are single-use (or unused) on purpose: a
 * fallback has to accept the explicit type arguments, or the handlers object of
 * whatever type, that the real signature turns down, and relates them to
 * nothing. `typescript/no-unnecessary-type-parameters` is off for this file
 * alone (the root `vite.config.ts` says why).
 */

import type { SubmitFunction } from "$app/forms";
import type * as Effect from "effect/Effect";
import { assert } from "vite-plus/test";
import type { EnhanceHandlers, ResultOptions, SubmitInput } from "../../../src/forms.js";

/** The type of a call that the function's own signature does not accept. */
export interface Rejected {
  readonly rejected: true;
}

/** What the `Forms.enhance` fallback returns for a call `Forms.enhance` rejects. */
export type RejectedSubmit = SubmitFunction & Rejected;

/** A handler's result, whatever it fails with or requires. */
type AnyHandlerResult = Effect.Effect<void, unknown, unknown>;

/** The handler keys `Forms.enhance` knows. */
type HandlerName = "onSubmit" | "onResult" | "onError";

interface RejectedEnhance {
  /**
   * Accepts any handlers and options. The constraint only gives unannotated
   * handler parameters their types: `Handlers` is inferred from the argument, so
   * it admits a key `Forms.enhance` does not know.
   */
  <
    Handlers extends {
      readonly onSubmit?: (input: SubmitInput) => AnyHandlerResult;
      readonly onResult?: (options: ResultOptions) => AnyHandlerResult;
      readonly onError?: (error: never) => AnyHandlerResult;
    },
  >(
    handlers: Handlers,
    ...options: ReadonlyArray<unknown>
  ): RejectedSubmit;
  /** Handlers whose values are not functions at all, such as an explicit `undefined`. */
  (
    handlers: Partial<Readonly<Record<HandlerName, EnhanceHandlers[HandlerName]>>>,
    ...options: ReadonlyArray<unknown>
  ): RejectedSubmit;
}

/** The fallback for `Forms.enhance`: any handlers and options, typed {@link RejectedSubmit}. */
export const rejectedEnhance: RejectedEnhance = () =>
  assert.fail("only its type is used: orRejected() returns the function itself");

/** Accepts one or two type arguments of any type, as `Forms.deserialize` does not. */
interface RejectedDeserialize {
  <_Success>(result: string): Rejected;
  <_Success, _Failure>(result: string): Rejected;
}

/** The fallback for `Forms.deserialize`: any type arguments, typed {@link Rejected}. */
export const rejectedDeserialize: RejectedDeserialize = () =>
  assert.fail("only its type is used: orRejected() returns the function itself");
