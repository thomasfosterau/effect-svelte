import { Cause, Option } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";

/**
 * Convert an {@link AsyncResult.AsyncResult} into a `Promise`, so Effect-backed
 * state can drive Svelte 5's native async (`{#await}` blocks and
 * `<svelte:boundary>` suspense), which both consume a real thenable.
 *
 * Mapping:
 * - **Failure** → a rejected promise (with the typed error `E` when present,
 *   otherwise the squashed cause). Checked first, so a failure that carries a
 *   previous success still surfaces the error in the `{:catch}` block.
 * - **Holds a value** (a `Success`, including a waiting one during
 *   stale-while-revalidate) → a resolved promise, so the UI keeps showing data
 *   while a refresh is in flight.
 * - **Initial / waiting with no value** → a perpetually-pending promise, so the
 *   `{#await}` loading branch (or the boundary's `pending` snippet) shows.
 *
 * Callers should memoise the result (e.g. via `$derived`) so a fresh pending
 * promise is not produced on unrelated re-renders — a new promise identity is
 * only wanted when the underlying result transitions.
 */
export function resultToPromise<A, E>(result: AsyncResult.AsyncResult<A, E>): Promise<A> {
  if (AsyncResult.isFailure(result)) {
    const cause = AsyncResult.cause(result);
    const reason = Option.isSome(cause)
      ? Option.match(Cause.findErrorOption(cause.value), {
          onNone: () => Cause.squash(cause.value),
          onSome: (error) => error,
        })
      : new Error("AsyncResult failure with no cause");
    return rejected(reason);
  }

  const value = AsyncResult.value(result);
  if (Option.isSome(value)) return Promise.resolve(value.value);

  // Initial / waiting with no value yet: stay pending.
  return new Promise<A>(() => {});
}

/**
 * A rejected promise whose rejection is pre-observed with a no-op handler.
 *
 * Failures are surfaced as rejected promises from a `$derived`; a reactive
 * re-render can produce (and then discard) such a promise before anything
 * `await`s it. The no-op `catch` keeps that discarded value from tripping
 * Node's `unhandledRejection` warning, while the returned promise still rejects
 * for every real consumer (the `catch` runs on a separate branch).
 */
function rejected<A>(reason: unknown): Promise<A> {
  const promise = Promise.reject<A>(reason);
  promise.catch(() => {});
  return promise;
}
