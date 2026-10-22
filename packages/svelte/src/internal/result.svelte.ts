import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { untrack } from "svelte";

/**
 * A reactive holder for an {@link AsyncResult.AsyncResult}, used by the hooks
 * that drive a result from a fiber's lifecycle (`useEffect`, `useDerived`,
 * `useReactiveQuery`, ...).
 *
 * The value lives in a `$state` field, so reassigning it through the methods
 * below re-runs any effect or template that read `current`. The transitions
 * follow Effect's native stale-while-revalidate semantics: marking a result as
 * waiting preserves the previous value, and settling a failure carries the last
 * success forward so the UI never has to flash back to a spinner.
 *
 * Only the `current` getter tracks. The transitions read the previous result
 * untracked, because the hooks call them from inside their own `$effect` (and a
 * synchronous Effect settles before `runFork` returns): a tracked read there
 * would make the effect depend on the state it writes, re-running it on every
 * transition until Svelte throws `effect_update_depth_exceeded`.
 */
export interface ResultState<A, E> {
  /** The current result. Read this inside an effect or template to track it. */
  readonly current: AsyncResult.AsyncResult<A, E>;

  /**
   * Mark the current result as waiting, preserving any value it already holds
   * (an `Initial` becomes a waiting `Initial`, a `Success` keeps its value).
   */
  startWaiting(): void;

  /** Reset back to the non-waiting `Initial` state. */
  reset(): void;

  /**
   * Settle from a fiber `Exit`. Interruptions are ignored (a new run is
   * presumably starting); successes and failures carry the previous value
   * forward.
   */
  settle(exit: Exit.Exit<A, E>): void;

  /** Replace the result with a non-waiting `Success`. */
  succeed(value: A): void;

  /**
   * Replace the result with a `Failure` (carrying the previous success
   * forward). Interrupt-only causes are ignored.
   */
  failCause(cause: Cause.Cause<E>): void;
}

/**
 * Creates a {@link ResultState}. Must be called during component
 * initialisation (it allocates `$state`).
 */
export function makeResult<A, E>(): ResultState<A, E> {
  let current = $state<AsyncResult.AsyncResult<A, E>>(AsyncResult.initial<A, E>());
  // The previous result, read without making the caller's effect depend on it.
  const previous = (): AsyncResult.AsyncResult<A, E> => untrack(() => current);

  return {
    get current() {
      return current;
    },
    startWaiting() {
      current = AsyncResult.waiting(previous());
    },
    reset() {
      current = AsyncResult.initial<A, E>();
    },
    settle(exit) {
      if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return;
      current = AsyncResult.fromExitWithPrevious(exit, Option.some(previous()));
    },
    succeed(value) {
      current = AsyncResult.success<A, E>(value);
    },
    failCause(cause) {
      if (Cause.hasInterrupts(cause)) return;
      current = AsyncResult.failureWithPrevious<A, E>(cause, { previous: Option.some(previous()) });
    },
  };
}
