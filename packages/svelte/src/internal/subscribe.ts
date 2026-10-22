import * as Arr from "effect/Array";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { createSubscriber } from "svelte/reactivity";
import { interruptFiber, runFork, type RuntimeLike } from "./run.js";

/**
 * Reactive bridges built on Svelte's [`createSubscriber`](https://svelte.dev/docs/svelte/svelte-reactivity#createSubscriber).
 *
 * `createSubscriber` is the idiomatic Svelte 5 primitive for turning an
 * external, push-based source into something the runes system can track. The
 * `start` callback runs the first time the returned `subscribe` function is
 * read inside an effect (including a template), and its teardown runs once the
 * last reader is destroyed — so a single Effect fiber backs any number of
 * readers, and is interrupted automatically on unmount. No `$effect` or manual
 * `$state` bookkeeping is required.
 */

/** The reactive view {@link streamState} returns. */
export interface StreamState<A, E> {
  /** The stream's lifecycle, carrying every value emitted so far. */
  readonly current: AsyncResult.AsyncResult<ReadonlyArray<A>, E>;
  /** Every value emitted so far, oldest first. */
  readonly values: ReadonlyArray<A>;
  /** The most recent value, or `undefined` before the first emission. */
  readonly latest: A | undefined;
}

/** The reactive view {@link valueState} returns. */
export interface ValueState<A> {
  /** The latest value (the initial one until the stream first emits). */
  readonly current: A;
}

/**
 * Subscribes to a `Stream`, accumulating every emitted value. Tracks the
 * stream's lifecycle as an {@link AsyncResult.AsyncResult} (waiting while the
 * stream is live, then settling on completion or failure).
 */
export function streamState<A, E, R>(
  runtime: RuntimeLike<R>,
  makeStream: () => Stream.Stream<A, E, R>,
): StreamState<A, E> {
  let values: Array<A> = [];
  let current: AsyncResult.AsyncResult<ReadonlyArray<A>, E> = AsyncResult.initial();

  const subscribe = createSubscriber((update) => {
    values = [];
    current = AsyncResult.initial<ReadonlyArray<A>, E>(true);

    const program = Stream.runForEach(makeStream(), (value) =>
      Effect.sync(() => {
        values = [...values, value];
        current = AsyncResult.success<ReadonlyArray<A>, E>(values, { waiting: true });
        update();
      }),
    ).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => {
          // Interruption is normal teardown; keep the last good state.
          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause)) return;
          current = AsyncResult.fromExitWithPrevious(
            Exit.map(exit, (): ReadonlyArray<A> => values),
            Option.some(current),
          );
          update();
        }),
      ),
    );

    const fiber = runFork(runtime)(program);
    return () => interruptFiber(fiber);
  });

  return {
    get current() {
      subscribe();
      return current;
    },
    get values() {
      subscribe();
      return values;
    },
    get latest() {
      subscribe();
      return Option.getOrUndefined(Arr.last(values));
    },
  };
}

/**
 * Subscribes to a `Stream` that always emits a current value (e.g. the
 * `changes` of a `SubscriptionRef`), tracking only the latest value.
 *
 * @param initial - the synchronous starting value, used before the subscription
 *   activates and during SSR (where effects do not run).
 */
export function valueState<A, E, R>(
  runtime: RuntimeLike<R>,
  initial: A,
  makeStream: () => Stream.Stream<A, E, R>,
): ValueState<A> {
  let value = initial;

  const subscribe = createSubscriber((update) => {
    const fiber = runFork(runtime)(
      Stream.runForEach(makeStream(), (next) =>
        Effect.sync(() => {
          value = next;
          update();
        }),
      ),
    );
    return () => interruptFiber(fiber);
  });

  return {
    get current() {
      subscribe();
      return value;
    },
  };
}
