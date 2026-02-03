import type { Cause } from "effect";

/**
 * Represents the state of an async operation.
 * 
 * - `initial`: Operation has not started yet
 * - `pending`: Operation is in progress
 * - `success`: Operation completed successfully with a value
 * - `failure`: Operation failed with a Cause
 */
export type AsyncResult<A, E> =
  | { readonly _tag: 'initial' }
  | { readonly _tag: 'pending' }
  | { readonly _tag: 'success'; readonly value: A }
  | { readonly _tag: 'failure'; readonly cause: Cause.Cause<E> };

/**
 * Type guard to check if result is in initial state
 */
export function isInitial<A, E>(result: AsyncResult<A, E>): result is { readonly _tag: 'initial' } {
  return result._tag === 'initial';
}

/**
 * Type guard to check if result is in pending state
 */
export function isPending<A, E>(result: AsyncResult<A, E>): result is { readonly _tag: 'pending' } {
  return result._tag === 'pending';
}

/**
 * Type guard to check if result is in success state
 */
export function isSuccess<A, E>(result: AsyncResult<A, E>): result is { readonly _tag: 'success'; readonly value: A } {
  return result._tag === 'success';
}

/**
 * Type guard to check if result is in failure state
 */
export function isFailure<A, E>(result: AsyncResult<A, E>): result is { readonly _tag: 'failure'; readonly cause: Cause.Cause<E> } {
  return result._tag === 'failure';
}

/**
 * Pattern match on AsyncResult with exhaustive handling
 */
export function match<A, E, R>(
  result: AsyncResult<A, E>,
  handlers: {
    initial: () => R;
    pending: () => R;
    success: (value: A) => R;
    failure: (cause: Cause.Cause<E>) => R;
  }
): R {
  switch (result._tag) {
    case 'initial':
      return handlers.initial();
    case 'pending':
      return handlers.pending();
    case 'success':
      return handlers.success(result.value);
    case 'failure':
      return handlers.failure(result.cause);
  }
}
