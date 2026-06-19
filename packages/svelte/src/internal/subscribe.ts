import { Cause, Effect, Exit, Option, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
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

/**
 * Subscribes to a `Stream`, accumulating every emitted value. Tracks the
 * stream's lifecycle as an {@link AsyncResult.AsyncResult} (waiting while the
 * stream is live, then settling on completion or failure).
 */
export function streamState<A, E, R>(
  runtime: RuntimeLike<R>,
  makeStream: () => Stream.Stream<A, E, R>,
): {
  readonly current: AsyncResult.AsyncResult<ReadonlyArray<A>, E>;
  readonly values: ReadonlyArray<A>;
  readonly latest: A | undefined;
} {
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
            Exit.map(exit, () => values as ReadonlyArray<A>),
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
      return values.length > 0 ? values[values.length - 1] : undefined;
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
): { readonly current: A } {
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
