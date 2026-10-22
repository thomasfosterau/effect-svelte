import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import type * as AsyncResult from "effect/reactivity/AsyncResult";
import { interruptFiber, runFork, type RuntimeLike } from "./run.js";

/**
 * The reactive holder driven by {@link makeLiveStream}. The rune-backed
 * implementation lives in `live-stream.svelte.ts` (a `$state.raw` cell); this
 * interface keeps the orchestrator below rune-free so it can be unit-tested
 * with a plain fake (the same split as `makeResult` / `makeMutation`).
 *
 * The transitions follow the same stale-while-revalidate semantics as the rest
 * of the package: marking a result waiting preserves whatever value it already
 * holds, so the previous emission stays visible while a new subscription spins
 * up.
 */
export interface LiveResultState<A, E> {
  /** The current result. Read inside an effect or template to track it. */
  readonly current: AsyncResult.AsyncResult<A, E>;

  /**
   * Mark the current result as waiting, preserving any value it already holds
   * (a seeded `Success` becomes a waiting `Success`, an `Initial` a waiting
   * `Initial`).
   */
  startWaiting(): void;

  /**
   * Replace the result with a non-waiting `Success`. Each emission replaces the
   * previous one — live queries emit whole result sets, never appended deltas.
   */
  emit(value: A): void;

  /** Replace the result with a `Failure`, carrying the previous success forward. */
  failCause(cause: Cause.Cause<E>): void;
}

/** The controller {@link makeLiveStream} returns. */
export interface LiveStream<A, E, R> {
  /** Start a new subscription, returning a teardown that interrupts it. */
  readonly subscribe: (stream: Stream.Stream<A, E, R>) => () => void;
}

/**
 * Orchestrates a live `Stream` subscription against a {@link LiveResultState}.
 *
 * A single {@link makeLiveStream} instance is reused across re-subscriptions
 * (driven by the hook's `$effect`): every call to `subscribe` interrupts the
 * previous run and starts a fresh one, keeping the previous value visible as a
 * waiting `Success` in between (stale-while-revalidate).
 *
 * Interruption caused by the hook's own teardown / re-subscribe must never
 * surface as a `Failure` — only genuine failures (`Cause.hasFails`) and defects
 * (`Cause.hasDies`) settle the result to `Failure`.
 */
export function makeLiveStream<A, E, R>(
  runtime: RuntimeLike<R>,
  state: LiveResultState<A, E>,
): LiveStream<A, E, R> {
  // Identifies the live subscription. A superseded run's late emission (or
  // exit) is dropped by comparing against this token, so a fiber that is being
  // interrupted cannot clobber the value the newer subscription just set.
  let active: symbol | null = null;

  const subscribe = (stream: Stream.Stream<A, E, R>): (() => void) => {
    const token = Symbol();
    active = token;

    // Keep the previous value visible as a waiting `Success` while the new
    // subscription starts (stale-while-revalidate). On the very first run this
    // marks a seeded `Success` / bare `Initial` as waiting.
    state.startWaiting();

    const consume = Stream.runForEach(stream, (value) =>
      Effect.sync(() => {
        if (active !== token) return;
        // Each emission replaces the current value — never appends.
        state.emit(value);
      }),
    );

    // Yield once before consuming, so a synchronously-resolving stream cannot
    // write state *during* the `$effect` flush that started it (Svelte flags a
    // write-during-flush that the awaited `promise` reads back as an update
    // cycle). The subscription still starts on the very next microtask.
    const program = Effect.flatMap(Effect.yieldNow, () => consume).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (active !== token) return;
          // A completed stream leaves the last emission in place.
          if (Exit.isSuccess(exit)) return;
          const cause = exit.cause;
          // Teardown / re-subscribe interruption is normal lifecycle churn and
          // must not surface as a `Failure`; only real failures and defects do.
          if (Cause.hasFails(cause) || Cause.hasDies(cause)) {
            state.failCause(cause);
          }
        }),
      ),
    );

    const fiber = runFork(runtime)(program);

    return () => {
      if (active === token) active = null;
      interruptFiber(fiber);
    };
  };

  return { subscribe };
}
